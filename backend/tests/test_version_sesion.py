"""
version_sesion (E01 sesión): epoch monotónico en Usuario que permite
invalidar sesiones ya emitidas ("cerrar mis otras sesiones"), siguiendo el
mismo patrón que `version_contrasenia` (E01-RF003) pero en un dominio de
invalidación independiente (ver diseño: reusar version_contrasenia acoplaría
"cerrar sesiones" con "cambiar contraseña", que son eventos no relacionados).

Este archivo cubre solo la parte B1 (columna + migración + emisión inerte del
claim `sver`). La parte B2 (enforcement real) vive en test_epoch_valido.py y
en las pruebas de revocación agregadas a test_auth_tipo_token.py.
"""
import jwt
import pytest

from app.dominio.modelos import Usuario
from app.seguridad.gestor_auth import GestorAutenticacion
from app.soporte_transversal.configuracion import settings


def test_usuario_tiene_columna_version_sesion_con_server_default_uno():
    """La columna debe existir, ser NOT NULL y tener server_default='1' --
    igual que el gap que cierra sobre `version_contrasenia` (que solo tenía
    default de Python, no de servidor): un INSERT crudo que la salte no debe
    dejar la columna en NULL."""
    columna = Usuario.__table__.columns["version_sesion"]
    assert columna.nullable is False
    assert columna.server_default is not None
    assert columna.server_default.arg == "1"


def test_usuario_nuevo_arranca_en_version_sesion_uno(db_session):
    """Valor por defecto en Python al construir un Usuario en memoria (antes
    de tocar la BD), coherente con `version_contrasenia`."""
    from datetime import date

    from app.dominio.modelos import Persona

    persona = Persona(
        nombres="Zoe", apellidos="Paredes", cedula="1712345678",
        fecha_nacimiento=date(1995, 3, 3), telefono="0990001111",
    )
    db_session.add(persona)
    db_session.flush()
    usuario = Usuario(correo="zoe@cataclub.test", contrasenia="hash", persona_id=persona.id)
    db_session.add(usuario)
    db_session.commit()
    db_session.refresh(usuario)
    assert usuario.version_sesion == 1


def _decodificar(token: str) -> dict:
    return jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algoritmo])


@pytest.mark.parametrize("version_sesion_actual", [1, 7])
def test_crear_token_acceso_emite_claim_sver_con_version_sesion_actual(version_sesion_actual):
    """Emisión INERTE (B1): el claim `sver` viaja en el access token con el
    valor real de version_sesion, pero nada lo valida todavía en este slice."""
    token = GestorAutenticacion.crear_token_acceso(
        {"sub": "x@cataclub.test"}, version_sesion=version_sesion_actual
    )
    payload = _decodificar(token)
    assert payload["sver"] == version_sesion_actual


@pytest.mark.parametrize("version_sesion_actual", [1, 4])
def test_crear_token_refresco_emite_claim_sver_con_version_sesion_actual(version_sesion_actual):
    """Misma emisión inerte, ahora en el refresh token -- necesaria para que
    B2 pueda comparar `sver` en /auth/refresh sin reemitir el par completo."""
    token = GestorAutenticacion.crear_token_refresco(
        {"sub": "x@cataclub.test"}, version_sesion=version_sesion_actual
    )
    payload = _decodificar(token)
    assert payload["sver"] == version_sesion_actual
