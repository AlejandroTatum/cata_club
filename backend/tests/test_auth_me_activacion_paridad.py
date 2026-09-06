"""Candado de paridad entre el claim de activación del token y el DTO de
`/auth/me` (#1056).

`claims_estandar` (login, refresh y el auto-login de alta pública) y
`obtener_perfil` (`GET /auth/me`) responden la misma pregunta -- "¿esta
cuenta puede entrar a los módulos?" -- pero antes de este cambio lo hacían
desde DOS armados independientes: nada impedía que mañana solo uno de los
dos se actualizara al agregar o cambiar una condición de la compuerta.

Este test hace el round-trip REAL (login -> me) para una matriz de usuarios
(rol × correo_verificado × estado de alta presencial) y compara el claim
`activacion_completa` decodificado del access token contra el campo
`activacionCompleta` del DTO, sin mockear la compuerta: si el cálculo
volviera a divergir en alguno de los dos caminos, este test lo detecta.

El armado de usuarios (`_crear_usuario`) se reutiliza tal cual de
`test_auth_activation.py` en vez de reimplementarse acá: ya cubre la misma
matriz rol × correo_verificado × estado de membresía, y duplicar ese
andamiaje sería exactamente el tipo de duplicación que este issue (#1056)
busca evitar en el código de producción.
"""
import jwt
import pytest

from app.soporte_transversal.configuracion import settings
from app.dominio.enums import EstadoMembresia, TipoRol
from tests.test_auth_activation import _CONTRASENIA, _crear_usuario


@pytest.mark.parametrize(
    ("rol", "correo_verificado", "estado_membresia"),
    [
        (TipoRol.ADMINISTRADOR, False, None),
        (TipoRol.ADMINISTRADOR, True, None),
        (TipoRol.ENTRENADOR, False, None),
        (TipoRol.ENTRENADOR, True, EstadoMembresia.ACTIVA),
        (TipoRol.ALUMNO, False, None),
        (TipoRol.ALUMNO, True, None),
        (TipoRol.ALUMNO, False, EstadoMembresia.ACTIVA),
        (TipoRol.ALUMNO, True, EstadoMembresia.ACTIVA),
        (TipoRol.ALUMNO, True, EstadoMembresia.VENCIDA),
    ],
)
def test_claim_de_token_y_campo_de_me_coinciden_siempre(
    client_sin_token, db_session, rol, correo_verificado, estado_membresia,
):
    correo = f"paridad-{rol.value}-{correo_verificado}-{estado_membresia}@cataclub.test".lower()
    _crear_usuario(
        db_session, correo=correo, correo_verificado=correo_verificado,
        estado_membresia=estado_membresia, rol=rol,
    )

    # Login REAL: emite el par de tokens vía `claims_estandar`.
    login_resp = client_sin_token.post(
        "/api/v1/auth/login",
        data={"username": correo, "password": _CONTRASENIA},
    )
    assert login_resp.status_code == 200, login_resp.text
    access_token = login_resp.json()["access_token"]
    claim_del_token = jwt.decode(
        access_token, settings.jwt_secret_key, algorithms=[settings.jwt_algoritmo],
    )["activacion_completa"]

    # /auth/me REAL, con el token recién emitido: arma su propia respuesta.
    me_resp = client_sin_token.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {access_token}"},
    )
    assert me_resp.status_code == 200, me_resp.text
    campo_del_dto = me_resp.json()["activacionCompleta"]

    assert claim_del_token == campo_del_dto
