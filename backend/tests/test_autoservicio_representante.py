"""Issue #1318: autoservicio "jugador → representante".

`POST /personas/me/representados` deja que un adulto autogestionado (con o
sin membresía propia) agregue su PRIMER dependiente sin pasar por
administración. La identidad sale SIEMPRE del token (`persona_id`), nunca
del body. Si la cuenta no tiene el rol REPRESENTANTE, este comando lo
otorga en la MISMA transacción que crea al representado (#762/#1137, vía
`RolServicio.establecer_capacidad_representante`) y reemite el par de
tokens -- el `sub` no cambia, pero los roles sí viajan en el JWT.

Los tests de nivel servicio usan JWTs REALES (no `dependency_overrides`)
porque el rol de la cuenta CAMBIA durante la llamada: solo decodificando el
token reemitido se puede afirmar qué rol quedó embebido (mismo criterio que
`tests/test_auth_activation.py::_token`).
"""
from datetime import date

import jwt
import pytest

from app.dominio.cedula import cedula_valida
from app.dominio.enums import EstadoMembresia, TipoRol
from app.dominio.excepciones import EntidadDuplicada, OperacionInvalida, PermisosInsuficientes
from app.dominio.mensajes import MENSAJE_CORREO_SIN_VERIFICAR
from app.dominio.modelos import Persona, Rol, Usuario
from app.seguridad.gestor_auth import GestorAutenticacion
from app.servicios_negocio.dtos.persona_schemas import RepresentadoCreateDTO
from app.servicios_negocio.persona_servicio import PersonaServicio
from app.soporte_transversal.configuracion import settings
from tests.fabricas_pagos import crear_membresia_orm, crear_tipo_membresia_orm


# --- fábricas ------------------------------------------------------------

def _cuenta(
    db_session, *, seed: int, tipo_rol: TipoRol | None,
    fecha_nacimiento: date = date(1990, 1, 1),
    correo_verificado: bool = True,
    representante_id: int | None = None,
) -> Usuario:
    # `trg_relacion_representacion_valida` (i1141relinteg) rechaza el alta O
    # el re-enlace de un ADULTO a un representante, sin importar el camino de
    # escritura -- ni siquiera un admin puede hacerlo por esa vía. Un adulto
    # representado real (test 4) solo existe porque envejeció en el sitio
    # como menor vinculado; mismo patrón que
    # `test_roles.py::_persona`. La fila nace menor -- el trigger la deja
    # pasar --, y luego se envejece con un UPDATE que NO toca
    # `representante_id` (el trigger solo corre `OF representante_id`).
    vinculado = representante_id is not None
    persona = Persona(
        nombres="Marta", apellidos="Reyes", cedula=cedula_valida(seed),
        fecha_nacimiento=date(2015, 1, 1) if vinculado else fecha_nacimiento,
        telefono="0991234567", representante_id=representante_id,
    )
    db_session.add(persona)
    db_session.flush()
    if vinculado:
        persona.fecha_nacimiento = fecha_nacimiento
        db_session.flush()

    roles: list[Rol] = []
    if tipo_rol is not None:
        rol = db_session.query(Rol).filter(Rol.tipo_rol == tipo_rol).first()
        if rol is None:
            rol = Rol(tipo_rol=tipo_rol, descripcion=tipo_rol.value.capitalize())
            db_session.add(rol)
            db_session.flush()
        roles = [rol]

    usuario = Usuario(
        correo=f"cuenta{seed}@cataclub.test", contrasenia="hash",
        persona_id=persona.id, correo_verificado=correo_verificado, roles=roles,
    )
    db_session.add(usuario)
    db_session.commit()
    db_session.refresh(usuario)
    return usuario


def _datos_dependiente(seed: int) -> RepresentadoCreateDTO:
    return RepresentadoCreateDTO(
        nombres="Luis", apellidos="Reyes", cedula=cedula_valida(seed),
        fecha_nacimiento=date(2015, 1, 1), telefono=None,
    )


def _token(usuario: Usuario) -> str:
    return GestorAutenticacion.crear_token_acceso(
        {
            "sub": usuario.correo, "persona_id": usuario.persona_id,
            "roles": [r.tipo_rol.value for r in usuario.roles],
        },
        version_sesion=usuario.version_sesion,
    )


def _roles_del_token(token: str) -> list[str]:
    payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algoritmo])
    # El refresh token no lleva roles (`AuthServicio._emitir_par_tokens` solo
    # le copia `sub`/`persona_id`/`activacion_completa`) -- `.get` en vez de
    # indexar, para que ese caso se lea como "ninguno" en vez de reventar.
    return payload.get("roles", [])


# --- 1. Camino feliz: ALUMNO adulto pasa a REPRESENTANTE -------------------

def test_alumno_adulto_crea_representado_y_pasa_a_representante(db_session):
    representante = _cuenta(db_session, seed=900, tipo_rol=TipoRol.ALUMNO)
    tipo = crear_tipo_membresia_orm(db_session)
    membresia = crear_membresia_orm(db_session, representante.persona, tipo, EstadoMembresia.ACTIVA)
    db_session.commit()

    representado, tokens = PersonaServicio(db_session).crear_representado_propio(
        representante.persona_id, _datos_dependiente(901),
    )

    assert representado.representante_id == representante.persona_id

    db_session.refresh(representante)
    assert {rol.tipo_rol for rol in representante.roles} == {TipoRol.REPRESENTANTE}

    db_session.refresh(membresia)
    assert membresia.estado == EstadoMembresia.ACTIVA  # intacta

    assert _roles_del_token(tokens["access_token"]) == ["REPRESENTANTE"]
    assert _roles_del_token(tokens["refresh_token"]) == []  # el refresh no lleva roles


# --- 2. Ya es REPRESENTANTE: sin cambio de rol -----------------------------

def test_representante_existente_no_cambia_de_rol(db_session):
    representante = _cuenta(db_session, seed=902, tipo_rol=TipoRol.REPRESENTANTE)

    representado, tokens = PersonaServicio(db_session).crear_representado_propio(
        representante.persona_id, _datos_dependiente(903),
    )

    assert representado.representante_id == representante.persona_id
    db_session.refresh(representante)
    assert {rol.tipo_rol for rol in representante.roles} == {TipoRol.REPRESENTANTE}
    assert _roles_del_token(tokens["access_token"]) == ["REPRESENTANTE"]


# --- 3. Menor: rechazado ----------------------------------------------------

def test_menor_no_puede_autoservicio(db_session):
    menor = _cuenta(db_session, seed=904, tipo_rol=TipoRol.ALUMNO, fecha_nacimiento=date(2015, 1, 1))

    with pytest.raises(OperacionInvalida):
        PersonaServicio(db_session).crear_representado_propio(
            menor.persona_id, _datos_dependiente(905),
        )


# --- 4. Adulto ya representado: rechazado -----------------------------------

def test_representado_no_puede_autoservicio(db_session):
    tutor = _cuenta(db_session, seed=906, tipo_rol=TipoRol.REPRESENTANTE)
    representado_adulto = _cuenta(
        db_session, seed=907, tipo_rol=TipoRol.ALUMNO, representante_id=tutor.persona_id,
    )

    with pytest.raises(OperacionInvalida):
        PersonaServicio(db_session).crear_representado_propio(
            representado_adulto.persona_id, _datos_dependiente(908),
        )


# --- 5. Correo sin verificar: 403 con el mensaje de #790 -------------------

def test_correo_sin_verificar_responde_403_con_el_mensaje_de_790(db_session):
    representante = _cuenta(
        db_session, seed=909, tipo_rol=TipoRol.ALUMNO, correo_verificado=False,
    )

    with pytest.raises(PermisosInsuficientes) as error:
        PersonaServicio(db_session).crear_representado_propio(
            representante.persona_id, _datos_dependiente(910),
        )
    assert str(error.value) == MENSAJE_CORREO_SIN_VERIFICAR


# --- 6. Staff (ADMINISTRADOR/ENTRENADOR): rechazado, sin tocar roles -------

@pytest.mark.parametrize("rol_staff", [TipoRol.ADMINISTRADOR, TipoRol.ENTRENADOR])
def test_staff_no_puede_autoservicio(db_session, rol_staff):
    staff = _cuenta(db_session, seed=911, tipo_rol=rol_staff)

    with pytest.raises(OperacionInvalida):
        PersonaServicio(db_session).crear_representado_propio(
            staff.persona_id, _datos_dependiente(912),
        )

    db_session.refresh(staff)
    assert {rol.tipo_rol for rol in staff.roles} == {rol_staff}  # sin tocar


# --- 7. Transaccional: un fallo tras el cambio de rol no deja nada a medias -

def test_fallo_tras_el_cambio_de_rol_no_persiste_nada(db_session):
    representante = _cuenta(db_session, seed=913, tipo_rol=TipoRol.ALUMNO)
    datos = _datos_dependiente(914)
    # Sembrar de antemano una Persona con la MISMA cédula que el dependiente:
    # `crear_representado` choca contra ella con `EntidadDuplicada` DESPUÉS
    # de que `establecer_capacidad_representante` ya flusheó el cambio de rol.
    db_session.add(Persona(
        nombres="Otra", apellidos="Persona", cedula=datos.cedula,
        fecha_nacimiento=date(2010, 1, 1), telefono="0990000000",
    ))
    db_session.commit()

    with pytest.raises(EntidadDuplicada):
        PersonaServicio(db_session).crear_representado_propio(representante.persona_id, datos)

    db_session.rollback()
    db_session.refresh(representante)
    assert {rol.tipo_rol for rol in representante.roles} == {TipoRol.ALUMNO}


# --- 8. Nivel HTTP: la identidad sale del token, GestorPermisos filtra -----

def test_endpoint_me_representados_via_http(client_sin_token, db_session):
    representante = _cuenta(db_session, seed=915, tipo_rol=TipoRol.ALUMNO)
    datos = _datos_dependiente(916)

    respuesta = client_sin_token.post(
        "/api/v1/personas/me/representados",
        json={
            "nombres": datos.nombres, "apellidos": datos.apellidos,
            "cedula": datos.cedula, "fecha_nacimiento": str(datos.fecha_nacimiento),
        },
        headers={"Authorization": f"Bearer {_token(representante)}"},
    )
    assert respuesta.status_code == 201, respuesta.text
    cuerpo = respuesta.json()
    assert cuerpo["representado"]["representanteId"] == representante.persona_id
    assert "accessToken" in cuerpo and "refreshToken" in cuerpo


def test_endpoint_me_representados_rechaza_a_un_entrenador(client_sin_token, db_session):
    entrenador = _cuenta(db_session, seed=917, tipo_rol=TipoRol.ENTRENADOR)
    datos = _datos_dependiente(918)

    respuesta = client_sin_token.post(
        "/api/v1/personas/me/representados",
        json={
            "nombres": datos.nombres, "apellidos": datos.apellidos,
            "cedula": datos.cedula, "fecha_nacimiento": str(datos.fecha_nacimiento),
        },
        headers={"Authorization": f"Bearer {_token(entrenador)}"},
    )
    assert respuesta.status_code == 403
