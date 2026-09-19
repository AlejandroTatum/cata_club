"""Límite de escritura de nombres propios (issue #875): la normalización de
`app/dominio/nombre_propio.py` tiene que morder en las DOS capas -- Pydantic
(`validadores.py`) y ORM (`@validates` de `modelos.py`) -- porque scripts y
altas masivas bypasean la primera. Ver `test_nombre_propio.py` para la regla
pura."""
from datetime import date

import pytest
from pydantic import ValidationError

from app.dominio.modelos import FichaMedica, Persona
from app.servicios_negocio.dtos.enrollment_schemas import EnrollmentAlumnoDTO, EnrollmentFichaMedicaDTO, EnrollmentRepresentanteDTO
from app.servicios_negocio.dtos.persona_schemas import FichaMedicaCreateDTO, PersonaCreateDTO, PersonaUpdateDTO, RepresentadoCreateDTO

_PERSONA_KWARGS = dict(
    nombres="faby", apellidos="ESPINOZA", cedula="1710034065",
    fecha_nacimiento=date(2010, 5, 14), telefono="0991234567",
)
_CREDENCIALES = dict(correo="rep@test.com", contrasenia="clave12345")


def _instanciar(dto_cls, **overrides):
    """Cada DTO de creación pide credenciales/tipo_cuenta distinto; esto
    solo arma el payload mínimo válido de cada uno. `overrides` reemplaza
    campos puntuales de `_PERSONA_KWARGS` (issue #1323: nombres/apellidos
    con los topes bajo prueba)."""
    kwargs = {**_PERSONA_KWARGS, **overrides}
    if dto_cls is EnrollmentRepresentanteDTO:
        return dto_cls(**kwargs, **_CREDENCIALES)
    return dto_cls(**kwargs)


@pytest.mark.parametrize("dto_cls", [
    PersonaCreateDTO, RepresentadoCreateDTO, EnrollmentAlumnoDTO,
    EnrollmentRepresentanteDTO,
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


# --- Issue #1323: topes realistas (5 palabras, 20 letras/palabra, 60 total) --
# Espejo exacto del frontend (`identity-validation.ts::personNameRule`): un
# tester en staging pegó una frase entera en «Nombres» y la regla la aceptó
# porque solo medía composición, nunca plausibilidad. Cada fixture de abajo
# viola UNA sola causa, para que el mensaje se pueda atribuir sin ambigüedad.

_PALABRA_DE_20_LETRAS = "A" + "a" * 19
_PALABRA_DE_19_LETRAS = "A" + "a" * 18
_PALABRA_DE_21_LETRAS = "A" + "a" * 20
_NOMBRE_DE_SEIS_PALABRAS = "Ana Beatriz Carla Diana Elena Flor"
# 20 + 1 + 20 + 1 + 19 = 61 caracteres; ningún token supera las 20 letras ni
# hay más de 5 palabras -- aísla la causa "más de 60 caracteres".
_NOMBRE_DE_SESENTA_Y_UN_CARACTERES = (
    f"{_PALABRA_DE_20_LETRAS} {_PALABRA_DE_20_LETRAS} {_PALABRA_DE_19_LETRAS}"
)


@pytest.mark.parametrize("dto_cls", [
    PersonaCreateDTO, RepresentadoCreateDTO, EnrollmentAlumnoDTO,
    EnrollmentRepresentanteDTO,
])
@pytest.mark.parametrize("campo, valor, esperado", [
    ("nombres", _NOMBRE_DE_SEIS_PALABRAS, "no puede tener más de 5 palabras."),
    ("apellidos", _NOMBRE_DE_SEIS_PALABRAS, "no puede tener más de 5 palabras."),
    ("nombres", _PALABRA_DE_21_LETRAS, "no puede tener una palabra de más de 20 letras."),
    ("apellidos", _PALABRA_DE_21_LETRAS, "no puede tener una palabra de más de 20 letras."),
    ("nombres", _NOMBRE_DE_SESENTA_Y_UN_CARACTERES, "no puede tener más de 60 caracteres."),
    ("apellidos", _NOMBRE_DE_SESENTA_Y_UN_CARACTERES, "no puede tener más de 60 caracteres."),
])
def test_dto_rechaza_topes_de_nombre_y_apellido(dto_cls, campo, valor, esperado):
    with pytest.raises(ValidationError) as exc_info:
        _instanciar(dto_cls, **{campo: valor})
    assert any(esperado in e["msg"] for e in exc_info.value.errors())


@pytest.mark.parametrize("dto_cls", [
    PersonaCreateDTO, RepresentadoCreateDTO, EnrollmentAlumnoDTO,
    EnrollmentRepresentanteDTO,
])
@pytest.mark.parametrize("campo", ["nombres", "apellidos"])
@pytest.mark.parametrize("valor", [
    "María de los Ángeles",
    "De la Cruz Andrade",
    "Jean-Pierre O'Neil",
])
def test_dto_acepta_nombres_compuestos_reales_bajo_los_topes(dto_cls, campo, valor):
    dto = _instanciar(dto_cls, **{campo: valor})
    assert getattr(dto, campo)


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
