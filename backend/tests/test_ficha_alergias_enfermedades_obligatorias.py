"""Issue #1574: alergias y enfermedades son obligatorias en toda ficha médica.

Quien no tiene, escribe «Ninguno»: se guarda como declaración explícita
(`alergias="Ninguna"`, enfermedades vacías) y nunca como una enfermedad
llamada «Ninguno». Las fichas legadas con campos vacíos se siguen leyendo.
"""
import pytest
from pydantic import ValidationError

from app.dominio.modelos import FichaMedica
from app.servicios_negocio.dtos.enrollment_schemas import (
    EnrollmentFichaMedicaDTO,
    EnrollmentFichaMedicaMenorDTO,
)
from app.servicios_negocio.dtos.persona_schemas import (
    FichaMedicaCreateDTO,
    FichaMedicaUpdateDTO,
)

_BASE = {"tipo_sangre": "O_POSITIVO"}
_ADULTO = {**_BASE, "contacto_emergencia": "Ana Pérez", "telefono_emergencia": "0991234567"}
_CREATE = {**_BASE, "persona_id": 1, "telefono_emergencia": "0991234567"}

_DTOS_ESCRITURA = [
    (EnrollmentFichaMedicaDTO, _ADULTO),
    (EnrollmentFichaMedicaMenorDTO, _BASE),
    (FichaMedicaCreateDTO, _CREATE),
]


def _mensajes(exc: pytest.ExceptionInfo) -> str:
    return " ".join(e["msg"] for e in exc.value.errors())


@pytest.mark.parametrize("dto_cls,base", _DTOS_ESCRITURA)
@pytest.mark.parametrize("alergias", [None, "", "   "])
def test_alergias_vacias_se_rechazan_en_castellano(dto_cls, base, alergias):
    with pytest.raises(ValidationError) as exc:
        dto_cls(**base, alergias=alergias, enfermedades=["Asma"])

    assert 'Escribe tus alergias o "Ninguno" si no tienes' in _mensajes(exc)


@pytest.mark.parametrize("dto_cls,base", _DTOS_ESCRITURA)
@pytest.mark.parametrize("enfermedades", [None, [], ["", "  "]])
def test_enfermedades_vacias_se_rechazan_en_castellano(dto_cls, base, enfermedades):
    kwargs = {**base, "alergias": "Polen"}
    if enfermedades is not None:
        kwargs["enfermedades"] = enfermedades

    with pytest.raises(ValidationError) as exc:
        dto_cls(**kwargs)

    assert 'Escribe tus enfermedades o "Ninguno" si no tienes' in _mensajes(exc)


@pytest.mark.parametrize("variante", ["Ninguno", "ninguno", "Ninguna", "ningúno", "  NINGUNA "])
def test_ninguno_se_guarda_como_declaracion_sin_crear_enfermedad(variante):
    dto = EnrollmentFichaMedicaMenorDTO(**_BASE, alergias=variante, enfermedades=[variante])

    assert dto.alergias == "Ninguna"
    assert dto.enfermedades == []


def test_ninguno_mezclado_con_enfermedades_reales_solo_conserva_las_reales():
    dto = EnrollmentFichaMedicaMenorDTO(**_BASE, alergias="Polen", enfermedades=["Ninguno", "Asma"])

    assert dto.enfermedades == ["Asma"]


def test_patch_rechaza_alergias_o_enfermedades_vacias_si_vienen():
    with pytest.raises(ValidationError):
        FichaMedicaUpdateDTO(alergias=None)
    with pytest.raises(ValidationError):
        FichaMedicaUpdateDTO(alergias="  ")
    with pytest.raises(ValidationError):
        FichaMedicaUpdateDTO(enfermedades=[])


def test_patch_que_no_menciona_los_campos_sigue_siendo_valido():
    dto = FichaMedicaUpdateDTO(telefono_emergencia="0991234567")

    assert dto.alergias is None and dto.enfermedades is None


def test_post_general_sin_alergias_responde_422(client):
    persona = client.post(
        "/api/v1/personas/",
        json={
            "nombres": "Ana", "apellidos": "Torres", "cedula": "1710034065",
            "fecha_nacimiento": "2010-05-14", "telefono": "0991234567",
        },
    ).json()

    resp = client.post(
        "/api/v1/fichas-medicas/",
        json={
            "tipo_sangre": "O_POSITIVO", "persona_id": persona["id"],
            "enfermedades": ["Ninguno"], "telefono_emergencia": "0991112233",
        },
    )

    assert resp.status_code == 422
    assert "alergias" in resp.text.lower()


def test_ninguno_por_http_no_crea_enfermedad_en_el_catalogo(client, db_session):
    persona = client.post(
        "/api/v1/personas/",
        json={
            "nombres": "Ana", "apellidos": "Torres", "cedula": "1710034065",
            "fecha_nacimiento": "2010-05-14", "telefono": "0991234567",
        },
    ).json()

    resp = client.post(
        "/api/v1/fichas-medicas/",
        json={
            "tipo_sangre": "O_POSITIVO", "persona_id": persona["id"],
            "alergias": "ninguno", "enfermedades": ["Ningúna"], "telefono_emergencia": "0991112233",
        },
    )

    assert resp.status_code == 201
    assert resp.json()["alergias"] == "Ninguna"
    assert resp.json()["enfermedades"] == []


def test_ficha_legada_con_campos_vacios_se_sigue_leyendo(db_session, client):
    persona = client.post(
        "/api/v1/personas/",
        json={
            "nombres": "Ana", "apellidos": "Torres", "cedula": "1710034065",
            "fecha_nacimiento": "2010-05-14", "telefono": "0991234567",
        },
    ).json()
    db_session.add(FichaMedica(tipo_sangre="O_POSITIVO", persona_id=persona["id"]))
    db_session.commit()

    resp = client.get(f"/api/v1/fichas-medicas/persona/{persona['id']}")

    assert resp.status_code == 200
    assert resp.json()["alergias"] is None
    assert resp.json()["enfermedades"] == []


def test_upsert_por_patch_que_crea_la_ficha_exige_alergias_y_enfermedades(client, db_session):
    persona = client.post(
        "/api/v1/personas/",
        json={
            "nombres": "Ana", "apellidos": "Torres", "cedula": "1710034065",
            "fecha_nacimiento": "2010-05-14", "telefono": "0991234567",
        },
    ).json()

    resp = client.patch(
        f"/api/v1/fichas-medicas/persona/{persona['id']}",
        json={"tipo_sangre": "O_POSITIVO", "telefono_emergencia": "0991112233"},
    )

    assert resp.status_code == 400
    assert "Ninguno" in resp.text
