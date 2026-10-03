"""REG-01 (QA3): U+0000 en un nombre, apellido o contraseña llegaba a
PostgreSQL (que no admite NUL en `text`) y terminaba en 500. Se rechaza en la
capa de DTO con un 422 en castellano."""
import pytest
from pydantic import BaseModel, ValidationError

from app.dominio.contrasenia import validar_contrasenia
from app.servicios_negocio.dtos.validadores import (
    ApellidoValidado,
    ContraseniaValidada,
    NombreValidado,
)


class _DTONombre(BaseModel):
    nombres: NombreValidado
    apellidos: ApellidoValidado


class _DTOContrasenia(BaseModel):
    contrasenia: ContraseniaValidada


@pytest.mark.parametrize("campo", ["nombres", "apellidos"])
def test_nombre_y_apellido_rechazan_nul(campo):
    payload = {"nombres": "Ana", "apellidos": "Pérez", campo: "Ana\x00Pérez"}
    with pytest.raises(ValidationError) as exc_info:
        _DTONombre(**payload)
    assert any("caracteres no permitidos" in e["msg"] for e in exc_info.value.errors())


def test_contrasenia_rechaza_nul():
    with pytest.raises(ValidationError) as exc_info:
        _DTOContrasenia(contrasenia="clave\x00segura123")
    assert any("caracteres no permitidos" in e["msg"] for e in exc_info.value.errors())


def test_dominio_contrasenia_rechaza_nul():
    with pytest.raises(ValueError, match="caracteres no permitidos"):
        validar_contrasenia("clave\x00segura123")
