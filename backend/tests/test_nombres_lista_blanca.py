"""ADM-05 (QA3): los nombres y apellidos de persona solo admiten letras
Unicode, espacios, apóstrofo, guion y punto. Cualquier otro carácter (dígitos,
`<`, `&`, emoji...) se rechaza con 422 en castellano."""
import pytest
from pydantic import BaseModel, ValidationError

from app.servicios_negocio.dtos.validadores import ApellidoValidado, NombreValidado


class _DTONombre(BaseModel):
    nombres: NombreValidado
    apellidos: ApellidoValidado


@pytest.mark.parametrize("valor", [
    "María José", "Núñez", "Peña", "Ángel de la Cruz", "O'Brien",
    "Ana-María", "Jr.", "Çağlar", "Müller",
])
def test_nombres_legitimos_se_aceptan(valor):
    dto = _DTONombre(nombres=valor, apellidos=valor)
    assert dto.nombres and dto.apellidos


@pytest.mark.parametrize("valor", [
    "<b>Ana", "Ana & Co", "Ana2", "Ana_Pérez", "Ana@Pérez", "Ana😀", "Ana/Pérez",
    "Ana;DROP", "Ana(1)", '"Ana"',
])
@pytest.mark.parametrize("campo", ["nombres", "apellidos"])
def test_caracteres_fuera_de_lista_blanca_se_rechazan(campo, valor):
    payload = {"nombres": "Ana", "apellidos": "Pérez", campo: valor}
    with pytest.raises(ValidationError) as exc_info:
        _DTONombre(**payload)
    assert any("solo puede contener letras" in e["msg"] for e in exc_info.value.errors())
