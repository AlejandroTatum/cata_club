"""
POST /auth/contrasenia/cambiar -- cambio de contraseña desde el perfil (FAM-17).

Verifica la contraseña actual, aplica la misma política que el restablecimiento,
rechaza una nueva igual a la actual y revoca las OTRAS sesiones: bombea el epoch
y reemite un par nuevo para que el caller siga autenticado.
"""
from datetime import date

import pytest

from app.dominio.enums import TipoRol
from app.dominio.modelos import Persona, Rol, Usuario
from app.seguridad.gestor_auth import GestorAutenticacion

URL = "/api/v1/auth/contrasenia/cambiar"
ACTUAL = "claveActual123"


@pytest.fixture()
def usuario_real(db_session):
    persona = Persona(
        nombres="Ana", apellidos="Torres", cedula="1710034065",
        fecha_nacimiento=date(1990, 1, 1), telefono="0991234567",
    )
    db_session.add(persona)
    db_session.flush()
    db_session.add(Usuario(
        correo="ana@cataclub.test",
        contrasenia=GestorAutenticacion.obtener_hash_contrasenia(ACTUAL),
        persona_id=persona.id,
        roles=[Rol(tipo_rol=TipoRol.ALUMNO, descripcion="Alumno")],
    ))
    db_session.commit()
    return persona.usuario


def _bearer(usuario: Usuario) -> dict:
    token = GestorAutenticacion.crear_token_acceso(
        {"sub": usuario.correo, "persona_id": usuario.persona_id, "roles": ["ALUMNO"]},
        version_sesion=usuario.version_sesion,
    )
    return {"Authorization": f"Bearer {token}"}


def _cambiar(client, usuario, actual=ACTUAL, nueva="claveNueva456"):
    return client.post(
        URL,
        json={"contrasenia_actual": actual, "nueva_contrasenia": nueva},
        headers=_bearer(usuario),
    )


def test_requiere_autenticacion(client_sin_token):
    respuesta = client_sin_token.post(
        URL, json={"contrasenia_actual": ACTUAL, "nueva_contrasenia": "claveNueva456"}
    )
    assert respuesta.status_code == 401


def test_contrasenia_actual_incorrecta_se_rechaza_sin_cambiar_nada(
    client_sin_token, usuario_real, db_session
):
    hash_previo = usuario_real.contrasenia
    version_previa = usuario_real.version_sesion

    respuesta = _cambiar(client_sin_token, usuario_real, actual="otraClave999")

    assert respuesta.status_code == 400, respuesta.text
    assert "actual" in respuesta.json()["detail"].lower()
    db_session.refresh(usuario_real)
    assert usuario_real.contrasenia == hash_previo
    assert usuario_real.version_sesion == version_previa


def test_nueva_igual_a_la_actual_se_rechaza(client_sin_token, usuario_real):
    respuesta = _cambiar(client_sin_token, usuario_real, nueva=ACTUAL)

    assert respuesta.status_code == 400, respuesta.text
    assert "distinta" in respuesta.json()["detail"].lower()


def test_nueva_que_incumple_la_politica_se_rechaza(client_sin_token, usuario_real):
    respuesta = _cambiar(client_sin_token, usuario_real, nueva="corta")

    assert respuesta.status_code == 422


def test_exito_cambia_la_clave_y_revoca_otras_sesiones_manteniendo_la_actual(
    client_sin_token, usuario_real, db_session
):
    headers_previos = _bearer(usuario_real)
    version_sesion_previa = usuario_real.version_sesion
    version_contrasenia_previa = usuario_real.version_contrasenia

    respuesta = client_sin_token.post(
        URL,
        json={"contrasenia_actual": ACTUAL, "nueva_contrasenia": "claveNueva456"},
        headers=headers_previos,
    )

    assert respuesta.status_code == 200, respuesta.text
    cuerpo = respuesta.json()
    db_session.refresh(usuario_real)
    assert GestorAutenticacion.verificar_contrasenia("claveNueva456", usuario_real.contrasenia)
    assert usuario_real.version_sesion == version_sesion_previa + 1
    assert usuario_real.version_contrasenia == version_contrasenia_previa + 1

    # Otra sesión (token previo) queda revocada...
    assert client_sin_token.get("/api/v1/auth/me", headers=headers_previos).status_code == 401
    # ...y la actual sigue viva con el par reemitido.
    nuevo = {"Authorization": f"Bearer {cuerpo['access_token']}"}
    assert client_sin_token.get("/api/v1/auth/me", headers=nuevo).status_code == 200
