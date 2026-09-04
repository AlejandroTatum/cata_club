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
