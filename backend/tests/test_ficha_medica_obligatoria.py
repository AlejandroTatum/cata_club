"""Issue #730: required medical data for public enrollment."""

import pytest
from pydantic import ValidationError

from app.dominio.cedula import cedula_valida
from app.dominio.modelos import FichaMedica
from app.servicios_negocio.dtos.enrollment_schemas import EnrollmentCreateDTO


def _ficha(**overrides) -> dict:
    cuerpo = {
        "tipo_sangre": "O_POSITIVO",
        "enfermedades": [],
        "contacto_emergencia": "María Torres",
        "telefono_emergencia": "0991112233",
    }
    cuerpo.update(overrides)
    return cuerpo


def _cuerpo_enrollment(secuencia: int, **overrides) -> dict:
    """Autoinscripción de un adulto: the supported account-creation path."""
    cuerpo = {
        "alumno": {
            "nombres": "Prueba",
            "apellidos": "SinFicha",
            "cedula": cedula_valida(secuencia),
            "fecha_nacimiento": "1995-03-04",
            "telefono": "0987654321",
        },
        "credenciales_alumno": {
            "correo": f"sinficha{secuencia}@example.com",
            "contrasenia": "password8",
        },
        "ficha_medica": _ficha(),
        "acepta_consentimientos": True,
    }
    cuerpo.update(overrides)
    return cuerpo


def test_enrollment_sin_ficha_medica_es_rechazado(client):
    cuerpo = _cuerpo_enrollment(701)
    del cuerpo["ficha_medica"]

    resp = client.post("/api/v1/enrollment/", json=cuerpo)

    assert resp.status_code == 422


def test_el_rechazo_del_enrollment_dice_en_castellano_qué_falta(client):
    cuerpo = _cuerpo_enrollment(702)
    del cuerpo["ficha_medica"]

    mensaje = client.post("/api/v1/enrollment/", json=cuerpo).json()["detail"]

    assert "Field required" not in mensaje
    assert "ficha médica" in mensaje.lower()
    assert "tipo de sangre" in mensaje.lower()
    assert "contacto de emergencia" in mensaje.lower()


def test_enrollment_con_ficha_medica_en_null_es_rechazado(client):
    resp = client.post("/api/v1/enrollment/", json=_cuerpo_enrollment(703, ficha_medica=None))

    assert resp.status_code == 422


def test_enrollment_con_ficha_medica_sigue_creando_la_ficha(client, db_session):
    resp = client.post("/api/v1/enrollment/", json=_cuerpo_enrollment(704))

    assert resp.status_code == 201
    persona_id = resp.json()["persona_id"]
    ficha = db_session.query(FichaMedica).filter(FichaMedica.persona_id == persona_id).one()
    assert ficha.contacto_emergencia == "María Torres"


def test_la_ficha_incompleta_sigue_rechazándose_campo_por_campo():
    for faltante in ("tipo_sangre", "contacto_emergencia", "telefono_emergencia"):
        ficha = _ficha()
        del ficha[faltante]
        with pytest.raises(ValidationError):
            EnrollmentCreateDTO(**_cuerpo_enrollment(715, ficha_medica=ficha))

    with pytest.raises(ValidationError):
        EnrollmentCreateDTO(**_cuerpo_enrollment(716, ficha_medica=_ficha(tipo_sangre="DESCONOCIDO")))
