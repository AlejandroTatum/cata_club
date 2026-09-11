"""Issue #1132 (cierre): autoservicio de membresía propia.

Contrato final:
  - "Inscribirme como jugador" para un representante puro pasa por un
    endpoint dedicado, `POST /membresias/propia`, que matricula SIEMPRE a
    quien llama y nunca a otra Persona -- el DTO no tiene ningún campo
    `persona_id`, así que no hay ningún payload que apunte a un tercero.
  - No amplía la autorización admin-only de `POST /membresias/`.
  - Reusa `MembresiaServicio.crear_membresia` entera: nace INACTIVA, no
    asigna ni exige ningún rol, y un duplicado ACTIVA/SUSPENDIDA se rechaza
    con el mismo mensaje que ya cubre `test_rol_unico_por_cuenta.py` /
    `test_ciclo_integral_issue_400.py`.
"""
import pytest

from app.dominio.cedula import cedula_valida
from app.dominio.enums import EstadoMembresia, TipoRol
from app.dominio.excepciones import OperacionInvalida
from app.dominio.modelos import Persona, Rol, Usuario
from app.seguridad.gestor_auth import GestorAutenticacion
from app.servicios_negocio.membresia_pago_servicio import (
    MENSAJE_MEMBRESIA_ACTIVA_DUPLICADA, MembresiaServicio,
)
from tests.fabricas_pagos import (
    crear_membresia_orm, crear_persona_orm, crear_tipo_membresia_orm,
)


# --- fábricas ----------------------------------------------------------------

def _crear_representante(sesion, cedula: str) -> Persona:
    """Persona + Usuario con, a lo sumo, un rol REPRESENTANTE -- mismo
    patrón que `test_rol_unico_por_cuenta.py::_crear_cuenta_con_rol`."""
    persona = crear_persona_orm(sesion, cedula, nombres="Marta", apellidos="Reyes")
    rol = sesion.query(Rol).filter(Rol.tipo_rol == TipoRol.REPRESENTANTE).first()
    if rol is None:
        rol = Rol(tipo_rol=TipoRol.REPRESENTANTE, descripcion="Representante")
        sesion.add(rol)
        sesion.flush()
    usuario = Usuario(
        correo=f"rep{cedula}@cataclub.test", contrasenia="hash",
        persona_id=persona.id, roles=[rol],
    )
    sesion.add(usuario)
    sesion.commit()
    sesion.refresh(usuario)
    return persona


# --- 1. Camino feliz: nace INACTIVA, sobre la propia persona -----------------

def test_representante_puede_matricularse_a_si_mismo_y_nace_inactiva(db_session):
    representante = _crear_representante(db_session, cedula_valida(740))
    tipo = crear_tipo_membresia_orm(db_session)

    membresia = MembresiaServicio(db_session).crear_membresia_propia(
        persona_id=representante.id, tipo_membresia_id=tipo.id,
    )

    assert membresia.persona_id == representante.id
    assert membresia.estado == EstadoMembresia.INACTIVA


# --- 2. No asigna ningún rol: conserva REPRESENTANTE únicamente -------------

def test_matricularse_a_si_mismo_no_toca_ningun_rol(db_session):
    representante = _crear_representante(db_session, cedula_valida(741))
    tipo = crear_tipo_membresia_orm(db_session)
    usuario = db_session.query(Usuario).filter(Usuario.persona_id == representante.id).one()

    MembresiaServicio(db_session).crear_membresia_propia(
        persona_id=representante.id, tipo_membresia_id=tipo.id,
    )

    db_session.refresh(usuario)
    assert {rol.tipo_rol for rol in usuario.roles} == {TipoRol.REPRESENTANTE}


# --- 3. Duplicado ACTIVA/SUSPENDIDA se rechaza, mismo mensaje ---------------

@pytest.mark.parametrize("estado_previo", [EstadoMembresia.ACTIVA, EstadoMembresia.SUSPENDIDA])
def test_matricularse_a_si_mismo_rechaza_si_ya_tiene_una_membresia_operativa(
    db_session, estado_previo,
):
    representante = _crear_representante(db_session, cedula_valida(742))
    tipo = crear_tipo_membresia_orm(db_session)
    crear_membresia_orm(db_session, representante, tipo, estado_previo)
    db_session.commit()

    with pytest.raises(OperacionInvalida) as error:
        MembresiaServicio(db_session).crear_membresia_propia(
            persona_id=representante.id, tipo_membresia_id=tipo.id,
        )
    assert str(error.value) == MENSAJE_MEMBRESIA_ACTIVA_DUPLICADA


# --- 4. Nivel HTTP: persona_id siempre sale del token, nunca del body -------

def _autenticar_como(persona_id: int, roles: list[str]) -> None:
    from main import app
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": "sesion@cataclub.test", "persona_id": persona_id, "roles": roles,
    }


def test_endpoint_propia_deriva_persona_del_token_e_ignora_persona_id_del_body(
    client, db_session,
):
    """El endpoint admin-only `POST /membresias/` sigue exigiendo
    ADMINISTRADOR (no se amplía) mientras `POST /membresias/propia` matricula
    a quien llama, incluso si el body intenta declarar `persona_id` de otra
    persona -- `MembresiaPropiaCreateDTO` no tiene ese campo, así que
    Pydantic lo ignora en silencio (mismo comportamiento documentado para
    `MembresiaCreateDTO` y `monto_aplicado`)."""
    quien_llama = crear_persona_orm(db_session, cedula_valida(743), nombres="Quien", apellidos="Llama")
    victima = crear_persona_orm(db_session, cedula_valida(744), nombres="Otra", apellidos="Persona")
    tipo = crear_tipo_membresia_orm(db_session)
    db_session.commit()

    _autenticar_como(quien_llama.id, ["REPRESENTANTE"])
    respuesta = client.post(
        "/api/v1/membresias/propia",
        json={"tipo_membresia_id": tipo.id, "persona_id": victima.id},
    )
    assert respuesta.status_code == 201, respuesta.text
    cuerpo = respuesta.json()
    assert cuerpo["personaId"] == quien_llama.id
    assert cuerpo["estado"] == "INACTIVA"

    # La ruta admin-only original sigue siendo eso: admin-only.
    _autenticar_como(quien_llama.id, ["REPRESENTANTE"])
    respuesta_admin_only = client.post(
        "/api/v1/membresias/",
        json={"persona_id": quien_llama.id, "tipo_membresia_id": tipo.id},
    )
    assert respuesta_admin_only.status_code == 403


def test_endpoint_propia_sin_token_responde_401(client_sin_token):
    respuesta = client_sin_token.post(
        "/api/v1/membresias/propia", json={"tipo_membresia_id": 1},
    )
    assert respuesta.status_code == 401
