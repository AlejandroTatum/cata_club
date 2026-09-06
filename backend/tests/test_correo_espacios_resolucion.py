"""Los cuatro caminos que resuelven una cuenta por correo, contra una fila
cuyo `correo` almacenado tiene espacios al borde (issue #1023).

`UsuarioFichaRepositorio.obtener_por_correo` recortaba el INPUT
(`correo.strip().lower()`) pero comparaba contra `lower(correo)`, la
columna cruda: una fila con espacios al inicio o al fin quedaba agrupada
como la MISMA identidad que su gemela sin espacios en
`ix_usuario_correo_lower` y en `scripts/auditar_colisiones_correo.py`,
pero inalcanzable por login, registro, recuperación y restablecimiento.

Ese desalineamiento solo puede materializarse hoy vía una escritura que
bypasee `CorreoValidado` (`dtos/validadores.py`), que ya normaliza con
`strip().lower()` en cada alta/edición desde la app -- por ejemplo, un
operador reconciliando una colisión reportada por el audit que conserva a
mano la fila con espacios. Por eso se siembra directo por ORM
(`db_session`), nunca vía un DTO ni vía `client` (que sí pasaría por
`CorreoValidado` y jamás produciría la fila que este archivo necesita)."""
import pytest

from app.dominio.cedula import cedula_valida
from app.dominio.excepciones import EntidadDuplicada
from app.dominio.modelos import RecuperacionOutbox, Usuario
from app.seguridad.gestor_auth import GestorAutenticacion
from app.servicios_negocio.auth_servicio import AuthServicio
from app.servicios_negocio.dtos.auth_schemas import RegistroUsuarioDTO
from tests.fabricas_pagos import crear_persona_orm

CONTRASENIA = "unaClaveSegura1"
# `.test` es un TLD reservado (RFC 2606): `EmailStr` de `RegistroUsuarioDTO`
# lo rechaza como no enrutable, a diferencia de las filas sembradas directo
# por ORM en el resto de este repo. `x.com` es el dominio que ya usan los
# demás tests que sí pasan por ese DTO (`test_correo_race_condicion.py`).
CORREO_CON_ESPACIOS = " espacios@x.com "
CORREO_LIMPIO = "espacios@x.com"


def _sembrar_cuenta_con_espacios(db_session, secuencia: int) -> Usuario:
    """Simula la fila legada que este issue describe: `correo` guardado con
    espacios al borde, imposible de producir por ningún camino de la app
    desde que `CorreoValidado` normaliza (issue #1021)."""
    persona = crear_persona_orm(db_session, cedula_valida(secuencia))
    usuario = Usuario(
        correo=CORREO_CON_ESPACIOS,
        contrasenia=GestorAutenticacion.obtener_hash_contrasenia(CONTRASENIA),
        persona_id=persona.id,
        correo_verificado=True,
    )
    db_session.add(usuario)
    db_session.commit()
    db_session.refresh(usuario)
    return usuario


# --- Camino 1: login ----------------------------------------------------------

def test_login_resuelve_la_fila_con_espacios_por_la_direccion_limpia(db_session):
    _sembrar_cuenta_con_espacios(db_session, 9001)
    servicio = AuthServicio(db_session)

    resultado = servicio.login(CORREO_LIMPIO, CONTRASENIA)

    assert "access_token" in resultado and "refresh_token" in resultado


# --- Camino 2: registro (rechaza el duplicado en vez de crear una segunda
# cuenta indistinguible) ------------------------------------------------------

def test_registro_detecta_como_duplicado_el_correo_de_la_fila_con_espacios(db_session):
    _sembrar_cuenta_con_espacios(db_session, 9002)
    otra_persona = crear_persona_orm(db_session, cedula_valida(9003))
    db_session.commit()
    servicio = AuthServicio(db_session)

    with pytest.raises(EntidadDuplicada):
        servicio.registrar_usuario(
            RegistroUsuarioDTO(
                cedula=otra_persona.cedula,
                correo=CORREO_LIMPIO,
                contrasenia="otraClaveSegura1",
            )
        )


# --- Camino 3: recuperación ----------------------------------------------------

def test_recuperacion_encola_para_la_fila_con_espacios(db_session):
    usuario = _sembrar_cuenta_con_espacios(db_session, 9004)
    servicio = AuthServicio(db_session)

    servicio.solicitar_recuperacion(CORREO_LIMPIO)

    assert (
        db_session.query(RecuperacionOutbox)
        .filter(RecuperacionOutbox.usuario_id == usuario.id)
        .count()
        == 1
    ), "una dirección desconocida y una fila inalcanzable responden igual -- 0 filas"


# --- Camino 4: restablecimiento ------------------------------------------------

def test_restablecimiento_encuentra_la_fila_con_espacios_via_el_token(db_session):
    usuario = _sembrar_cuenta_con_espacios(db_session, 9005)
    # El token de recuperación se acuña con `usuario.correo` -- el valor
    # CRUDO almacenado, espacios incluidos (ver
    # `recuperacion_tareas._enviar_enlace`), no con la dirección que el
    # usuario tipeó para pedirlo.
    token = GestorAutenticacion.crear_token_recuperacion(
        usuario.correo, usuario.version_contrasenia
    )
    servicio = AuthServicio(db_session)

    servicio.restablecer_contrasenia(token, "contraseniaNueva1")

    db_session.refresh(usuario)
    assert GestorAutenticacion.verificar_contrasenia(
        "contraseniaNueva1", usuario.contrasenia
    )
