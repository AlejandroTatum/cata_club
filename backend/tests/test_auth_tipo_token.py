"""
Confusión de tipo de token (E01-RF002/RF003).

`GestorAutenticacion.crear_token_acceso` estampa `type=access`, y tanto el
refresh token como el token de recuperación llevan su propio `type`. El
endpoint `/auth/refresh` ya verifica que lo que recibe sea `type=refresh`,
pero la dependencia de autenticación general (`decodificar_token`) no
verificaba nada: aceptaba CUALQUIER JWT firmado con la clave del sistema.

Consecuencia: un refresh token (vida de 7 días) o un token de recuperación
de contraseña (que viaja por correo) servían como bearer de autenticación
para todo endpoint que solo exige "estar autenticado", contradiciendo lo que
el propio docstring de `crear_token_refresco` promete.
"""
from datetime import date

import pytest

from app.dominio.enums import TipoRol
from app.dominio.modelos import Persona, Rol, Usuario
from app.seguridad.gestor_auth import GestorAutenticacion


@pytest.fixture()
def usuario_real(db_session):
    """Persona + Usuario reales, para que `/auth/me` pueda resolver el `sub`."""
    persona = Persona(
        nombres="Ana", apellidos="Torres", cedula="1710034065",
        fecha_nacimiento=date(1990, 1, 1), telefono="0991234567",
    )
    db_session.add(persona)
    db_session.flush()
    db_session.add(Usuario(
        correo="ana@cataclub.test", contrasenia="hash", persona_id=persona.id,
        roles=[Rol(tipo_rol=TipoRol.ALUMNO, descripcion="Alumno")],
    ))
    db_session.commit()
    return persona


def test_refresh_token_no_autentica_endpoints_de_negocio(client_sin_token, usuario_real):
    """Un refresh token solo sirve para pedir un access token en /auth/refresh."""
    refresh = GestorAutenticacion.crear_token_refresco(
        {"sub": "ana@cataclub.test", "persona_id": usuario_real.id}, version_sesion=1
    )
    respuesta = client_sin_token.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {refresh}"}
    )
    assert respuesta.status_code == 401


def test_token_de_recuperacion_no_autentica_endpoints_de_negocio(client_sin_token, usuario_real):
    """Un enlace de recuperación interceptado no debe valer como sesión.

    Es el caso más grave de los dos: el token viaja por correo y su uso como
    bearer no incrementa `version_contrasenia`, así que la víctima nunca ve
    señal de que su cuenta fue leída.
    """
    recuperacion = GestorAutenticacion.crear_token_recuperacion("ana@cataclub.test", 0)
    respuesta = client_sin_token.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {recuperacion}"}
    )
    assert respuesta.status_code == 401


def test_access_token_si_autentica(client_sin_token, usuario_real):
    """Contraparte positiva: el access token legítimo sigue funcionando."""
    access = GestorAutenticacion.crear_token_acceso(
        {"sub": "ana@cataclub.test", "persona_id": usuario_real.id, "roles": ["ALUMNO"]}, version_sesion=1
    )
    respuesta = client_sin_token.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {access}"}
    )
    assert respuesta.status_code == 200
    assert respuesta.json()["correo"] == "ana@cataclub.test"
