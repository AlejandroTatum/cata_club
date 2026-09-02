"""Límite de escritura de nombres propios (issue #875): la normalización de
`app/dominio/nombre_propio.py` tiene que morder en las DOS capas -- Pydantic
(`validadores.py`) y ORM (`@validates` de `modelos.py`) -- porque scripts y
altas masivas bypasean la primera. Ver `test_nombre_propio.py` para la regla
pura."""
from datetime import date

import pytest
from pydantic import ValidationError

from app.dominio.modelos import FichaMedica, Persona
from app.servicios_negocio.dtos.admin_cuenta_schemas import AdminCrearCuentaDTO
from app.servicios_negocio.dtos.enrollment_schemas import EnrollmentAlumnoDTO, EnrollmentFichaMedicaDTO, EnrollmentRepresentanteDTO
from app.servicios_negocio.dtos.persona_schemas import FichaMedicaCreateDTO, PersonaCreateDTO, PersonaUpdateDTO, RepresentadoCreateDTO

_PERSONA_KWARGS = dict(
    nombres="faby", apellidos="ESPINOZA", cedula="1710034065",
    fecha_nacimiento=date(2010, 5, 14), telefono="0991234567",
)
_CREDENCIALES = dict(correo="rep@test.com", contrasenia="clave1234")


def _instanciar(dto_cls):
    """Cada DTO de creación pide credenciales/tipo_cuenta distinto; esto
    solo arma el payload mínimo válido de cada uno."""
    if dto_cls is EnrollmentRepresentanteDTO:
        return dto_cls(**_PERSONA_KWARGS, **_CREDENCIALES)
    if dto_cls is AdminCrearCuentaDTO:
        return dto_cls(tipo_cuenta="ENTRENADOR", **_PERSONA_KWARGS, **_CREDENCIALES)
    return dto_cls(**_PERSONA_KWARGS)


@pytest.mark.parametrize("dto_cls", [
    PersonaCreateDTO, RepresentadoCreateDTO, EnrollmentAlumnoDTO,
    EnrollmentRepresentanteDTO, AdminCrearCuentaDTO,
])
def test_dto_de_creacion_normaliza_nombres_y_apellidos(dto_cls):
    dto = _instanciar(dto_cls)
    assert dto.nombres == "Faby"
    assert dto.apellidos == "Espinoza"


def test_persona_update_dto_normaliza_nombres_y_apellidos():
    dto = PersonaUpdateDTO(nombres="faby", apellidos="ESPINOZA")
    assert dto.nombres == "Faby"
    assert dto.apellidos == "Espinoza"


@pytest.mark.parametrize("campo, esperado", [
    ("nombres", "El nombre es obligatorio."),
    ("apellidos", "El apellido es obligatorio."),
])
def test_dto_rechaza_nombre_en_blanco_con_mensaje_en_castellano(campo, esperado):
    with pytest.raises(ValidationError) as exc_info:
        PersonaCreateDTO(**{**_PERSONA_KWARGS, campo: "   "})
    assert any(esperado in e["msg"] for e in exc_info.value.errors())


# --- contacto_emergencia: normalizado, None/vacío tolerados -----------------


def test_ficha_medica_create_dto_normaliza_contacto_emergencia():
    dto = FichaMedicaCreateDTO(
        tipo_sangre="O_POSITIVO", persona_id=1,
        contacto_emergencia="maría LÓPEZ", telefono_emergencia="0991234567",
    )
    assert dto.contacto_emergencia == "María López"


def test_ficha_medica_create_dto_tolera_contacto_emergencia_ausente():
    dto = FichaMedicaCreateDTO(tipo_sangre="O_POSITIVO", persona_id=1, telefono_emergencia="0991234567")
    assert dto.contacto_emergencia is None


def test_enrollment_ficha_medica_dto_normaliza_contacto_emergencia():
    dto = EnrollmentFichaMedicaDTO(
        tipo_sangre="O_POSITIVO",
        contacto_emergencia="maría LÓPEZ", telefono_emergencia="0991234567",
    )
    assert dto.contacto_emergencia == "María López"


# --- ORM: @validates normaliza al asignar el atributo ------------------------


def test_persona_orm_normaliza_nombres_y_apellidos_al_construir_y_reasignar():
    persona = Persona(**_PERSONA_KWARGS)
    assert persona.nombres == "Faby"
    assert persona.apellidos == "Espinoza"
    persona.nombres = "MARÍA josé"
    assert persona.nombres == "María José"


def test_ficha_medica_orm_normaliza_contacto_emergencia():
    ficha = FichaMedica(tipo_sangre="O_POSITIVO", contacto_emergencia="maría LÓPEZ")
    assert ficha.contacto_emergencia == "María López"


@pytest.mark.parametrize("valor", [None, ""])
def test_ficha_medica_orm_tolera_contacto_emergencia_ausente(valor):
    ficha = FichaMedica(tipo_sangre="O_POSITIVO", contacto_emergencia=valor)
    assert ficha.contacto_emergencia == valor


# --- Extremo a extremo: POST /personas con casing mixto -> respuesta canónica


def test_crear_persona_via_api_normaliza_nombres_en_la_respuesta(client):
    resp = client.post("/api/v1/personas/", json={
        "nombres": "faby", "apellidos": "ESPINOZA GÓMEZ", "cedula": "1710034065",
        "fecha_nacimiento": "2010-05-14", "telefono": "0991234567",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["nombres"] == "Faby"
    assert data["apellidos"] == "Espinoza Gómez"

    resp_get = client.get(f"/api/v1/personas/{data['id']}")
    assert resp_get.json()["nombres"] == "Faby"
