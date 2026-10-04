"""ADM-05 (QA3) y REG-08 (QA4): los nombres y apellidos de persona solo
admiten letras Unicode (tildes, ñ, ü), espacios, apóstrofo y guion, con al
menos 2 letras. Cualquier otro carácter (dígitos, punto, `<`, `&`, emoji...)
se rechaza con 422 en castellano y el mensaje NOMBRA el carácter."""
import pytest
from pydantic import BaseModel, ValidationError

from app.servicios_negocio.dtos.validadores import ApellidoValidado, NombreValidado


class _DTONombre(BaseModel):
    nombres: NombreValidado
    apellidos: ApellidoValidado


@pytest.mark.parametrize("valor", [
    "María José", "Núñez", "Peña", "Ángel de la Cruz", "O'Brien",
    "Ana-María", "Çağlar", "Müller", "Li", "Al", "Ng", "Muñoz", "ÑANDÚ", "Güemes",
    "D'Angelo", "Pérez-Mora", "Juan dos Santos",
])
def test_nombres_legitimos_se_aceptan(valor):
    dto = _DTONombre(nombres=valor, apellidos=valor)
    assert dto.nombres and dto.apellidos


@pytest.mark.parametrize("valor, caracteres", [
    ("<b>Ana", ["<", ">"]), ("Ana & Co", ["&"]), ("Ana2", ["2"]), ("Ana_Pérez", ["_"]),
    ("Ana@Pérez", ["@"]), ("Ana😀", ["😀"]), ("Ana/Pérez", ["/"]),
    ("Ana;DROP", [";"]), ("Ana(1)", ["(", "1", ")"]), ('"Ana"', ['"']),
    ("Juan123", ["1", "2", "3"]), ("Dr. Pérez", ["."]), ("Jr.", ["."]),
    ("Pérez×Mora", ["×"]), ("L·l", ["·"]),
])
@pytest.mark.parametrize("campo, etiqueta", [("nombres", "El nombre"), ("apellidos", "El apellido")])
def test_caracteres_fuera_de_lista_blanca_se_rechazan_nombrandolos(campo, etiqueta, valor, caracteres):
    payload = {"nombres": "Ana", "apellidos": "Pérez", campo: valor}
    with pytest.raises(ValidationError) as exc_info:
        _DTONombre(**payload)
    esperado = f"{etiqueta} no puede contener " + ", ".join(f"“{c}”" for c in caracteres) + "."
    assert [e["msg"] for e in exc_info.value.errors()] == [f"Value error, {esperado}"]


@pytest.mark.parametrize("valor", ["A", "J", "-", "'", "A-", "- -"])
@pytest.mark.parametrize("campo, etiqueta", [("nombres", "El nombre"), ("apellidos", "El apellido")])
def test_menos_de_dos_letras_se_rechaza(campo, etiqueta, valor):
    payload = {"nombres": "Ana", "apellidos": "Pérez", campo: valor}
    with pytest.raises(ValidationError) as exc_info:
        _DTONombre(**payload)
    assert any(f"{etiqueta} debe tener al menos 2 letras." in e["msg"] for e in exc_info.value.errors())


@pytest.mark.parametrize("valor, esperado", [
    ("juan dos santos", "Juan dos Santos"),
    ("MARÍA DE LA CRUZ", "María de la Cruz"),
    ("de la torre", "De la Torre"),
    ("ana DEL valle", "Ana del Valle"),
    ("carlos von braun", "Carlos von Braun"),
    ("pedro van der berg", "Pedro van Der Berg"),
    ("rosa da silva", "Rosa da Silva"),
    ("luis das neves", "Luis das Neves"),
    ("los santos", "Los Santos"),
    ("pedro y pablo", "Pedro y Pablo"),
    ("ana las heras", "Ana las Heras"),
])
def test_particulas_en_minuscula_en_medio_y_mayuscula_al_inicio(valor, esperado):
    assert _DTONombre(nombres=valor, apellidos=valor).nombres == esperado
