"""
`CorreoValidado` canonicaliza la dirección de correo (issue #1016, ADR-3):
`strip` + minúsculas, para que el valor que un DTO deja listo para guardar
sea EL MISMO que `UsuarioRepositorio.obtener_por_correo` ya busca
(`func.lower(correo) == correo.strip().lower()`, issue #827). Sin esto,
`Juan@Gmail.com` se guardaba tal cual mientras la búsqueda seguía siendo
case-insensitive: dos registros con distinta capitalización de la misma
casilla pasaban el pre-check y solo el índice único (ADR-3/ADR-4) atrapaba
la carrera -- este test cubre la mitad de canonicalización de entrada, no
esa carrera (ver `tests/test_indices_consultas_reales.py` y la migración
para el resto).
"""
import pytest
from pydantic import BaseModel, ValidationError

from app.servicios_negocio.dtos.validadores import CorreoValidado


class _DTOCorreo(BaseModel):
    correo: CorreoValidado


def test_correo_validado_canonicaliza_espacios_y_mayusculas():
    dto = _DTOCorreo(correo=" Juan@Gmail.COM ")
    assert dto.correo == "juan@gmail.com"


def test_correo_validado_ya_canonico_no_cambia():
    dto = _DTOCorreo(correo="juan@gmail.com")
    assert dto.correo == "juan@gmail.com"


def test_correo_validado_rechaza_formato_invalido():
    with pytest.raises(ValidationError):
        _DTOCorreo(correo="no-es-un-correo")


def test_correo_validado_rechaza_mas_de_100_caracteres():
    # REG-02 (QA3): `Usuario.correo` es String(100); un correo más largo
    # llegaba al INSERT y terminaba en 500.
    largo = "a" * 90 + "@ejemplo.com"
    assert len(largo) > 100
    with pytest.raises(ValidationError) as exc_info:
        _DTOCorreo(correo=largo)
    assert any("100 caracteres" in e["msg"] for e in exc_info.value.errors())


def test_correo_validado_acepta_exactamente_100_caracteres():
    exacto = "a" * (100 - len("@ejemplo.com")) + "@ejemplo.com"
    assert len(exacto) == 100
    assert _DTOCorreo(correo=exacto).correo == exacto
