"""Candado del campo `puedeEntrenar` en `GET /auth/me`.

Es el hecho que el frontend necesita para mostrar el lado jugador a una cuenta
ADMINISTRADOR o ENTRENADOR (un rol por cuenta, jugador por membresía): la MISMA
regla que `MembresiaRepositorio.puede_entrenar` (ACTIVA o VENCIDA sobre la
Persona de la cuenta), calculada en el servidor y nunca inferida del rol.
"""
import pytest

from app.dominio.enums import EstadoMembresia, TipoRol
from tests.test_auth_activation import _crear_usuario, _token


def _me(client_sin_token, usuario):
    respuesta = client_sin_token.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {_token(usuario)}"},
    )
    assert respuesta.status_code == 200, respuesta.text
    return respuesta.json()


@pytest.mark.parametrize("rol", [TipoRol.ADMINISTRADOR, TipoRol.ENTRENADOR])
@pytest.mark.parametrize(
    ("estado", "esperado"),
    [
        (EstadoMembresia.ACTIVA, True),
        (EstadoMembresia.VENCIDA, True),
        (EstadoMembresia.SUSPENDIDA, False),
        (EstadoMembresia.INACTIVA, False),
        (None, False),
    ],
)
def test_me_expone_puede_entrenar_segun_la_membresia_propia(
    client_sin_token, db_session, rol, estado, esperado,
):
    usuario = _crear_usuario(
        db_session, correo=f"staff-{rol.value}-{estado}@cataclub.test",
        correo_verificado=True, estado_membresia=estado, rol=rol,
    )

    assert _me(client_sin_token, usuario)["puedeEntrenar"] is esperado


def test_me_puede_entrenar_no_depende_del_rol_alumno_sino_de_la_membresia(client_sin_token, db_session):
    sin_membresia = _crear_usuario(
        db_session, correo="alumno-sin-membresia@cataclub.test", correo_verificado=True,
    )

    assert _me(client_sin_token, sin_membresia)["puedeEntrenar"] is False
