"""
Tests del servicio de creación de cuentas admin (Flujo 1).

Cubre:
  - Creación exitosa para JUGADOR, REPRESENTANTE y MENOR.
  - Asignación correcta de roles según tipo de cuenta.
  - La respuesta NO incluye tokens de auto-login (issue #1015).
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

from app.dominio.cedula import cedula_valida
from app.dominio.enums import TipoRol
from app.dominio.modelos import Persona, Usuario
from app.servicios_negocio.dtos.admin_cuenta_schemas import AdminCrearCuentaDTO
from app.servicios_negocio.admin_cuenta_servicio import AdminCuentaServicio


# --- helpers ----------------------------------------------------------------

def _base_payload(**overrides) -> dict:
    data = {
        "tipo_cuenta": "JUGADOR",
        "nombres": "Carlos",
        "apellidos": "Ruiz",
        "cedula": cedula_valida(100),
        "fecha_nacimiento": "1995-06-15",
        "telefono": "0991234567",
        "correo": "carlos@test.com",
        "contrasenia": "clave12345",
        # Issue #730: el tipo por defecto de este helper es JUGADOR, que es un
        # alumno, y desde el issue un alumno no se da de alta sin ficha
        # médica. Los tests que sobreescriben `tipo_cuenta` a ENTRENADOR o
        # REPRESENTANTE la mandan igual y eso está bien: para ellos sigue
        # siendo opcional, no prohibida.
        "ficha_medica": {
            "tipo_sangre": "O_POSITIVO",
            "enfermedades": [],
            "contacto_emergencia": "María Torres",
            "telefono_emergencia": "0991112233",
        },
    }
    data.update(overrides)
    return data


def _crear_representante_adulto(db_session) -> Persona:
    """Crea un representante adulto (>= 18) en la BD para usar en tests de MENOR."""
    rep = Persona(
        nombres="María", apellidos="López", cedula=cedula_valida(102),
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

    assert result["persona_id"] > 0
    assert result["usuario_id"] > 0
    assert result["correo"] == "carlos@test.com"

    usuario = db_session.query(Usuario).filter(Usuario.correo == "carlos@test.com").one()
    roles = {r.tipo_rol for r in usuario.roles}
    assert roles == {TipoRol.ALUMNO}


def test_crear_cuenta_representante_asigna_solo_rol_representante(db_session):
    """Issue #762: `ROLES_POR_TIPO_CUENTA["REPRESENTANTE"]` entregaba
    REPRESENTANTE **y** ALUMNO, o sea que el alta administrativa fabricaba
    una cuenta multirol de fábrica."""
    datos = AdminCrearCuentaDTO(**_base_payload(
        tipo_cuenta="REPRESENTANTE",
        correo="representante@test.com",
    ))
    result = AdminCuentaServicio(db_session).crear_cuenta(datos)

    assert result["usuario_id"] > 0
    usuario = db_session.query(Usuario).filter(Usuario.correo == "representante@test.com").one()
    roles = {r.tipo_rol for r in usuario.roles}
    assert roles == {TipoRol.REPRESENTANTE}


def test_crear_cuenta_entrenador_asigna_solo_rol_entrenador(db_session):
    """Un entrenador entrena, no se matricula: recibe ENTRENADOR y nada más
    (desde el issue #762, REPRESENTANTE tampoco arrastra ALUMNO)."""
    datos = AdminCrearCuentaDTO(**_base_payload(
        tipo_cuenta="ENTRENADOR",
        correo="entrenador@test.com",
    ))
    result = AdminCuentaServicio(db_session).crear_cuenta(datos)

    assert result["usuario_id"] > 0
    usuario = db_session.query(Usuario).filter(Usuario.correo == "entrenador@test.com").one()
    roles = {r.tipo_rol for r in usuario.roles}
    assert roles == {TipoRol.ENTRENADOR}


def test_entrenador_menor_de_edad_rechazado(client, db_session):
    resp = client.post("/api/v1/personas/admin/cuentas", json=_base_payload(
        tipo_cuenta="ENTRENADOR",
        fecha_nacimiento="2020-01-01",
        correo="entrenador_menor@test.com",
    ))
    assert resp.status_code == 400
    assert "mayores de edad" in resp.json()["detail"]


def test_crear_cuenta_menor_asigna_rol_alumno(db_session):
    rep = _crear_representante_adulto(db_session)
    datos = AdminCrearCuentaDTO(**_base_payload(
        tipo_cuenta="MENOR",
        fecha_nacimiento="2015-06-15",
        correo="menor@test.com",
        representante_id=rep.id,
    ))
    result = AdminCuentaServicio(db_session).crear_cuenta(datos)

    assert result["usuario_id"] > 0
    usuario = db_session.query(Usuario).filter(Usuario.correo == "menor@test.com").one()
    roles = {r.tipo_rol for r in usuario.roles}
    assert roles == {TipoRol.ALUMNO}

    persona = db_session.query(Persona).get(result["persona_id"])
    assert persona.representante_id == rep.id


# --- Sin tokens de auto-login (issue #1015) --------------------------------

def test_crear_cuenta_no_devuelve_tokens_de_auto_login(db_session):
    """El llamador es el ADMINISTRADOR autenticado, nunca la cuenta recién
    creada -- emitir un par de tokens acá los deja vivos y sin dueño en el
    navegador del admin (issue #1015)."""
    datos = AdminCrearCuentaDTO(**_base_payload())
    result = AdminCuentaServicio(db_session).crear_cuenta(datos)

    assert "access_token" not in result
    assert "refresh_token" not in result
    assert "token_type" not in result
    assert result["persona_id"] > 0
    assert result["usuario_id"] > 0
    assert result["correo"] == "carlos@test.com"


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


# Auditoría 2026-08-10: una fecha de nacimiento de 1700 (326 años) pasaba sin
# aviso para JUGADOR/REPRESENTANTE/ENTRENADOR -- esta rama solo validaba el
# piso (`edad < EDAD_MAYORIA_EDAD`), nunca el techo. El fix de MENOR de la
# misma tanda usa `EDAD_MINIMA_ALUMNO`/`EDAD_MAXIMA_ALUMNO`; no hay una cota
# nueva para adultos, así que reutiliza `EDAD_MAXIMA_ALUMNO` (74): es el
# único techo de edad que el sistema define para una persona (desde el issue
# #762 ya no se deriva del rol, porque REPRESENTANTE no arrastra ALUMNO).
@pytest.mark.parametrize("tipo_cuenta,correo", [
    ("JUGADOR", "jugador_1700@test.com"),
    ("REPRESENTANTE", "representante_1700@test.com"),
    ("ENTRENADOR", "entrenador_1700@test.com"),
])
def test_edad_imposible_rechazada_para_cuentas_adultas(client, db_session, tipo_cuenta, correo):
    resp = client.post(
        "/api/v1/personas/admin/cuentas",
        json=_base_payload(
            tipo_cuenta=tipo_cuenta,
            fecha_nacimiento="1700-01-01",
            correo=correo,
        ),
    )
    assert resp.status_code == 400
    assert "74" in resp.json()["detail"]


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
        nombres="Menor", apellidos="Rep", cedula=cedula_valida(103),
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
        nombres="Ana", apellidos="Torres", cedula=cedula_valida(101),
    ))
    result = AdminCuentaServicio(db_session).crear_cuenta(datos)

    persona = db_session.query(Persona).get(result["persona_id"])
    assert persona.nombres == "Ana"
    assert persona.apellidos == "Torres"
    assert persona.cedula == cedula_valida(101)

    usuario = db_session.query(Usuario).filter(Usuario.persona_id == persona.id).one()
    assert usuario.correo == "carlos@test.com"
    # La contraseña se almacena hasheada, nunca en texto plano
    assert usuario.contrasenia != "clave12345"
    assert len(usuario.contrasenia) > 20
