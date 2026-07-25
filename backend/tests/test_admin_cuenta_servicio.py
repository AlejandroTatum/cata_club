"""
Tests del servicio de creación de cuentas admin (Flujo 1).

Cubre:
  - Creación exitosa para JUGADOR, REPRESENTANTE y MENOR.
  - Asignación correcta de roles según tipo de cuenta.
  - Emisión de tokens JWT para auto-login.
  - Ficha médica opcional.
  - Validación de cédula duplicada.
  - Validación de correo duplicado.
  - Validación de edad: JUGADOR/REPRESENTANTE须 ser >= 18, MENOR须 ser < 18 y >= 5.
  - Validación: MENOR requiere representante_id.
  - Validación: representante_id debe existir y ser mayor de edad.
  - Validación Pydantic: cédula 10 dígitos, correo válido, contraseña >= 8 chars.
"""
from datetime import date

import pytest
from pydantic import ValidationError

from app.dominio.enums import TipoRol
from app.dominio.modelos import Persona, Usuario
from app.presentacion.schemas.admin_cuenta_schemas import AdminCrearCuentaDTO
from app.servicios_negocio.admin_cuenta_servicio import AdminCuentaServicio


# --- helpers ----------------------------------------------------------------

def _base_payload(**overrides) -> dict:
    data = {
        "tipo_cuenta": "JUGADOR",
        "nombres": "Carlos",
        "apellidos": "Ruiz",
        "cedula": "1712345678",
        "fecha_nacimiento": "1995-06-15",
        "telefono": "0991234567",
        "correo": "carlos@test.com",
        "contrasenia": "clave12345",
    }
    data.update(overrides)
    return data


def _crear_representante_adulto(db_session) -> Persona:
    """Crea un representante adulto (>= 18) en la BD para usar en tests de MENOR."""
    rep = Persona(
        nombres="María", apellidos="López", cedula="1790012345",
        fecha_nacimiento=date(1985, 3, 20), telefono="0998765432",
    )
    db_session.add(rep)
    db_session.commit()
    db_session.refresh(rep)
    return rep


# --- Happy paths por tipo -------------------------------------------------

def test_crear_cuenta_jugador_asigna_rol_alumno(db_session):
    datos = AdminCrearCuentaDTO(**_base_payload())
    result = AdminCuentaServicio(db_session).crear_cuenta(datos)

    assert "access_token" in result
    assert "refresh_token" in result
    assert result["token_type"] == "bearer"
    assert result["persona_id"] > 0

    usuario = db_session.query(Usuario).filter(Usuario.correo == "carlos@test.com").one()
    roles = {r.tipo_rol for r in usuario.roles}
    assert roles == {TipoRol.ALUMNO}


def test_crear_cuenta_representante_asigna_roles_representante_y_alumno(db_session):
    datos = AdminCrearCuentaDTO(**_base_payload(
        tipo_cuenta="REPRESENTANTE",
        correo="representante@test.com",
    ))
    result = AdminCuentaServicio(db_session).crear_cuenta(datos)

    assert "access_token" in result
    usuario = db_session.query(Usuario).filter(Usuario.correo == "representante@test.com").one()
    roles = {r.tipo_rol for r in usuario.roles}
    assert roles == {TipoRol.REPRESENTANTE, TipoRol.ALUMNO}


def test_crear_cuenta_menor_asigna_rol_alumno(db_session):
    rep = _crear_representante_adulto(db_session)
    datos = AdminCrearCuentaDTO(**_base_payload(
        tipo_cuenta="MENOR",
        fecha_nacimiento="2015-06-15",
        correo="menor@test.com",
        representante_id=rep.id,
    ))
    result = AdminCuentaServicio(db_session).crear_cuenta(datos)

    assert "access_token" in result
    usuario = db_session.query(Usuario).filter(Usuario.correo == "menor@test.com").one()
    roles = {r.tipo_rol for r in usuario.roles}
    assert roles == {TipoRol.ALUMNO}

    persona = db_session.query(Persona).get(result["persona_id"])
    assert persona.representante_id == rep.id


# --- Ficha médica opcional ------------------------------------------------

def test_crear_cuenta_con_ficha_medica(db_session):
    payload = _base_payload(ficha_medica={
        "tipo_sangre": "O_POSITIVO",
        "enfermedades": ["Asma"],
        "alergias": "Polen",
        "contacto_emergencia": "María López",
        "telefono_emergencia": "0998765432",
    })
    datos = AdminCrearCuentaDTO(**payload)
    result = AdminCuentaServicio(db_session).crear_cuenta(datos)

    persona = db_session.query(Persona).get(result["persona_id"])
    assert persona.ficha_medica is not None
    assert persona.ficha_medica.tipo_sangre.value == "O_POSITIVO"
    assert [e.nombre_enfermedad for e in persona.ficha_medica.enfermedades] == ["Asma"]


# --- Validación: cédula duplicada ------------------------------------------

def test_crear_cuenta_cedula_duplicada_rechazada(client, db_session):
    AdminCuentaServicio(db_session).crear_cuenta(
        AdminCrearCuentaDTO(**_base_payload())
    )
    resp = client.post(
        "/api/v1/personas/admin/cuentas",
        json=_base_payload(correo="otro@test.com"),
    )
    assert resp.status_code == 400
    assert "cédula" in resp.json()["detail"].lower()


# --- Validación: correo duplicado ------------------------------------------

def test_crear_cuenta_correo_duplicado_rechazada(client, db_session):
    AdminCuentaServicio(db_session).crear_cuenta(
        AdminCrearCuentaDTO(**_base_payload())
    )
    resp = client.post(
        "/api/v1/personas/admin/cuentas",
        json=_base_payload(cedula="1798765432"),
    )
    assert resp.status_code == 400
    assert "correo" in resp.json()["detail"].lower()


# --- Validación de edad ----------------------------------------------------

def test_jugador_menor_de_edad_rechazado(client, db_session):
    resp = client.post(
        "/api/v1/personas/admin/cuentas",
        json=_base_payload(
            fecha_nacimiento="2015-06-15",
            correo="menor@test.com",
        ),
    )
    assert resp.status_code == 400
    assert "mayor" in resp.json()["detail"].lower()


def test_representante_menor_de_edad_rechazado(client, db_session):
    resp = client.post(
        "/api/v1/personas/admin/cuentas",
        json=_base_payload(
            tipo_cuenta="REPRESENTANTE",
            fecha_nacimiento="2015-06-15",
            correo="repmenor@test.com",
        ),
    )
    assert resp.status_code == 400
    assert "mayor" in resp.json()["detail"].lower()


def test_menor_mayor_de_edad_rechazado(client, db_session):
    rep = _crear_representante_adulto(db_session)
    resp = client.post(
        "/api/v1/personas/admin/cuentas",
        json=_base_payload(
            tipo_cuenta="MENOR",
            fecha_nacimiento="1990-01-01",
            correo="adulto@test.com",
            representante_id=rep.id,
        ),
    )
    assert resp.status_code == 400
    assert "mayor de edad" in resp.json()["detail"].lower()


def test_menor_menor_de_5_anos_rechazado(client, db_session):
    rep = _crear_representante_adulto(db_session)
    resp = client.post(
        "/api/v1/personas/admin/cuentas",
        json=_base_payload(
            tipo_cuenta="MENOR",
            fecha_nacimiento="2026-06-15",
            correo="bebe@test.com",
            representante_id=rep.id,
        ),
    )
    assert resp.status_code == 400
    assert "edad" in resp.json()["detail"].lower()


# --- Validación: representante_id ------------------------------------------

def test_menor_sin_representante_id_rechazado(client, db_session):
    resp = client.post(
        "/api/v1/personas/admin/cuentas",
        json=_base_payload(
            tipo_cuenta="MENOR",
            fecha_nacimiento="2015-06-15",
            correo="menor@test.com",
        ),
    )
    assert resp.status_code == 400
    assert "representante" in resp.json()["detail"].lower()


def test_menor_representante_inexistente_rechazado(client, db_session):
    resp = client.post(
        "/api/v1/personas/admin/cuentas",
        json=_base_payload(
            tipo_cuenta="MENOR",
            fecha_nacimiento="2015-06-15",
            correo="menor@test.com",
            representante_id=99999,
        ),
    )
    assert resp.status_code == 404
    assert "representante" in resp.json()["detail"].lower()


def test_menor_representante_menor_de_edad_rechazado(client, db_session):
    rep_menor = Persona(
        nombres="Menor", apellidos="Rep", cedula="1790099999",
        fecha_nacimiento=date(2012, 1, 1), telefono="0999999999",
    )
    db_session.add(rep_menor)
    db_session.commit()
    db_session.refresh(rep_menor)

    resp = client.post(
        "/api/v1/personas/admin/cuentas",
        json=_base_payload(
            tipo_cuenta="MENOR",
            fecha_nacimiento="2015-06-15",
            correo="menor@test.com",
            representante_id=rep_menor.id,
        ),
    )
    assert resp.status_code == 400
    assert "mayor de edad" in resp.json()["detail"].lower()


# --- Validación Pydantic (schema-level) ------------------------------------

def test_cedula_corta_rechazada():
    with pytest.raises(ValidationError) as exc_info:
        AdminCrearCuentaDTO(**_base_payload(cedula="12345"))
    assert "cedula" in str(exc_info.value).lower()


def test_cedula_con_letras_rechazada():
    with pytest.raises(ValidationError):
        AdminCrearCuentaDTO(**_base_payload(cedula="ABCDEFGHIJ"))


def test_correo_invalido_rechazado():
    with pytest.raises(ValidationError):
        AdminCrearCuentaDTO(**_base_payload(correo="no-es-correo"))


def test_contrasenia_corta_rechazada():
    with pytest.raises(ValidationError) as exc_info:
        AdminCrearCuentaDTO(**_base_payload(contrasenia="123"))
    assert "contrasenia" in str(exc_info.value).lower()


def test_tipo_cuenta_invalido_rechazado():
    with pytest.raises(ValidationError):
        AdminCrearCuentaDTO(**_base_payload(tipo_cuenta="INVALIDO"))


def test_nombres_vacios_rechazados():
    """Empty nombres should be rejected at Pydantic validation level."""
    with pytest.raises(ValidationError) as exc_info:
        AdminCrearCuentaDTO(**_base_payload(nombres=""))
    assert "nombres" in str(exc_info.value).lower()


# --- Sin permisos (requiere ADMINISTRADOR) ---------------------------------

def test_crear_cuenta_sin_permisos_admin_da_403(client_sin_permisos):
    resp = client_sin_permisos.post(
        "/api/v1/personas/admin/cuentas",
        json=_base_payload(),
    )
    assert resp.status_code == 403


def test_crear_cuenta_sin_token_da_401(client_sin_token):
    resp = client_sin_token.post(
        "/api/v1/personas/admin/cuentas",
        json=_base_payload(),
    )
    assert resp.status_code == 401


# --- Persistencia verificada -----------------------------------------------

def test_persona_y_usuario_persisten_correctamente(db_session):
    datos = AdminCrearCuentaDTO(**_base_payload(
        nombres="Ana", apellidos="Torres", cedula="1712345678",
    ))
    result = AdminCuentaServicio(db_session).crear_cuenta(datos)

    persona = db_session.query(Persona).get(result["persona_id"])
    assert persona.nombres == "Ana"
    assert persona.apellidos == "Torres"
    assert persona.cedula == "1712345678"

    usuario = db_session.query(Usuario).filter(Usuario.persona_id == persona.id).one()
    assert usuario.correo == "carlos@test.com"
    # La contraseña se almacena hasheada, nunca en texto plano
    assert usuario.contrasenia != "clave12345"
    assert len(usuario.contrasenia) > 20
