"""H4 (QA4, review de C18): REG-08 endureció la lista blanca de nombres, pero
las filas que ya estaban guardadas antes (p. ej. «Jr.», o con un «·») no
pueden quedar bloqueando una edición ajena. Un nombre NUEVO o CAMBIADO sigue
sujeto a la regla completa; uno SIN CAMBIOS se acepta tal cual."""
import unicodedata
from datetime import date

import pytest
from pydantic import BaseModel, ValidationError

from app.dominio.modelos import Persona
from app.servicios_negocio.dtos.validadores import ApellidoValidado, NombreValidado


def _persona_guardada(db_session, nombres="Ana", apellidos="Torres"):
    persona = Persona(
        nombres=nombres, apellidos=apellidos, cedula="1710034065",
        fecha_nacimiento=date(1990, 1, 1), telefono="0991230000",
    )
    db_session.add(persona)
    db_session.commit()
    db_session.refresh(persona)
    return persona


@pytest.mark.parametrize("apellidos", ["Torres Jr.", "Pérez·Mora"])
def test_nombre_guardado_sin_cambios_no_bloquea_editar_otro_campo(client, db_session, apellidos):
    persona = _persona_guardada(db_session, apellidos=apellidos)

    resp = client.patch(
        f"/api/v1/personas/{persona.id}",
        json={"nombres": "Ana", "apellidos": apellidos, "telefono": "0987654321"},
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["telefono"] == "0987654321"
    assert resp.json()["apellidos"] == apellidos


def test_nombre_guardado_reenviado_en_forma_nfd_cuenta_como_sin_cambios(client, db_session):
    persona = _persona_guardada(db_session, apellidos="Núñez Jr.")

    resp = client.patch(
        f"/api/v1/personas/{persona.id}",
        json={"apellidos": unicodedata.normalize("NFD", "Núñez Jr."), "telefono": "0987654321"},
    )

    assert resp.status_code == 200, resp.text


def test_nombre_cambiado_a_uno_invalido_se_rechaza_nombrando_el_caracter(client, db_session):
    persona = _persona_guardada(db_session, apellidos="Torres Jr.")

    resp = client.patch(f"/api/v1/personas/{persona.id}", json={"apellidos": "Torres Jr.3"})

    assert resp.status_code in (400, 422)
    assert resp.json()["detail"] == "El apellido no puede contener “.”, “3”."


def test_nombre_nuevo_invalido_sobre_fila_valida_se_rechaza(client, db_session):
    persona = _persona_guardada(db_session)

    resp = client.patch(f"/api/v1/personas/{persona.id}", json={"nombres": "Ana3"})

    assert resp.status_code in (400, 422)
    assert resp.json()["detail"] == "El nombre no puede contener “3”."


def test_nombre_vacio_sigue_dando_el_mensaje_de_obligatorio(client, db_session):
    persona = _persona_guardada(db_session, apellidos="Torres Jr.")

    resp = client.patch(f"/api/v1/personas/{persona.id}", json={"apellidos": ""})

    assert resp.status_code == 422
    assert resp.json()["detail"] == "El apellido es obligatorio."


# R3-mark-parity: mismas reglas de marcas combinantes y separadores que
# `personNameRule` del frontend.
class _DTONombre(BaseModel):
    nombres: NombreValidado
    apellidos: ApellidoValidado


@pytest.mark.parametrize("valor", [
    "\u0301Ana", "Ana \u0301Pérez", "Ana-\u0301Pérez", "3\u0301Ana",
])
def test_marca_combinante_sin_letra_previa_se_rechaza(valor):
    with pytest.raises(ValidationError):
        _DTONombre(nombres=valor, apellidos="Pérez")


@pytest.mark.parametrize("valor", ["Ana--Pérez", "Ana-'Pérez", "-Ana", "Ana-", "'Ana", "Ana'"])
def test_separador_repetido_o_en_el_borde_se_rechaza(valor):
    with pytest.raises(ValidationError):
        _DTONombre(nombres=valor, apellidos="Pérez")


@pytest.mark.parametrize("valor", ["Mun\u0303oz", "Nu\u0301n\u0303ez", "Mu\u0308ller"])
def test_nombre_en_nfd_se_acepta_igual_que_en_nfc(valor):
    dto = _DTONombre(nombres=valor, apellidos="Pérez")
    assert unicodedata.is_normalized("NFC", dto.nombres)
