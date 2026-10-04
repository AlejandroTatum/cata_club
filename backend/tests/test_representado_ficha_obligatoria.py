"""QA4 FAM-10: al agregar un dependiente (menor) la ficha médica es obligatoria,
y su teléfono de emergencia NO se pide: es el de la cuenta del representante.
"""
from datetime import date

import pytest
from pydantic import ValidationError

from app.dominio.cedula import cedula_valida
from app.dominio.enums import TipoSangre
from app.dominio.modelos import Persona
from app.servicios_negocio.dtos.persona_schemas import FichaMedicaUpdateDTO, RepresentadoCreateDTO
from app.servicios_negocio.ficha_medica_servicio import FichaMedicaServicio


def _representante(db_session, sufijo=0):
    persona = Persona(
        nombres="Marta", apellidos="Solís", cedula=cedula_valida(9500 + sufijo),
        fecha_nacimiento=date(1985, 3, 20), telefono="0987654321",
    )
    db_session.add(persona)
    db_session.flush()
    return persona


def _cuerpo(sufijo, **extra):
    return {
        "nombres": "Ana", "apellidos": "Solís", "cedula": cedula_valida(9600 + sufijo),
        "fecha_nacimiento": "2015-05-14", **extra,
    }


def test_representado_sin_ficha_medica_se_rechaza_en_el_dto():
    with pytest.raises(ValidationError) as error:
        RepresentadoCreateDTO(**{**_cuerpo(1), "fecha_nacimiento": date(2015, 5, 14)})
    assert "ficha_medica" in str(error.value)


def test_representado_sin_ficha_medica_devuelve_422_y_no_crea_nada(client, db_session):
    representante = _representante(db_session, 2)
    respuesta = client.post(f"/api/v1/personas/{representante.id}/representados", json=_cuerpo(2))
    assert respuesta.status_code == 422
    assert db_session.query(Persona).filter(Persona.cedula == cedula_valida(9602)).first() is None


def test_representado_con_ficha_medica_se_crea_con_ficha(client, db_session):
    representante = _representante(db_session, 3)
    respuesta = client.post(
        f"/api/v1/personas/{representante.id}/representados",
        json=_cuerpo(3, ficha_medica={"tipo_sangre": "O_POSITIVO", "alergias": "Ninguna", "enfermedades": ["Ninguno"]}),
    )
    assert respuesta.status_code == 201, respuesta.text
    hija = db_session.query(Persona).filter(Persona.cedula == cedula_valida(9603)).one()
    assert hija.ficha_medica.tipo_sangre == TipoSangre.O_POSITIVO
    assert hija.ficha_medica.telefono_emergencia is None


def test_ficha_de_un_representado_no_exige_telefono_de_emergencia(db_session):
    """El teléfono de emergencia del menor es el del representante: guardar la
    ficha con solo el tipo de sangre es válido."""
    representante = _representante(db_session, 4)
    hijo = Persona(
        nombres="Iker", apellidos="Solís", cedula=cedula_valida(9604),
        fecha_nacimiento=date(2015, 5, 14), telefono=None, representante_id=representante.id,
    )
    db_session.add(hijo)
    db_session.commit()

    ficha = FichaMedicaServicio(db_session).actualizar_por_persona(
        hijo.id,
        FichaMedicaUpdateDTO(
            tipo_sangre=TipoSangre.A_POSITIVO, alergias="Ninguna", enfermedades=["Ninguno"],
        ),
    )
    assert ficha.tipo_sangre == TipoSangre.A_POSITIVO
    # Ya con ficha: un parche que no toca el teléfono tampoco lo exige.
    ficha = FichaMedicaServicio(db_session).actualizar_por_persona(
        hijo.id, FichaMedicaUpdateDTO(alergias="Polvo"),
    )
    assert ficha.alergias == "Polvo"


def test_ficha_de_un_adulto_sigue_exigiendo_telefono_de_emergencia(db_session):
    from app.dominio.excepciones import OperacionInvalida

    adulto = _representante(db_session, 5)
    db_session.commit()
    with pytest.raises(OperacionInvalida) as error:
        FichaMedicaServicio(db_session).actualizar_por_persona(
            adulto.id, FichaMedicaUpdateDTO(tipo_sangre=TipoSangre.A_POSITIVO),
        )
    assert "teléfono de emergencia" in str(error.value)
