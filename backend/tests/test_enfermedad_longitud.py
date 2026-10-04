"""REG-03 (QA3): cada enfermedad se guarda como una fila de
`Enfermedades.nombre_enfermedad` (`String(150)`); un texto más largo rompía el
alta con 500. El tope se aplica por elemento, con 422 en castellano."""
import pytest
from pydantic import ValidationError

from app.servicios_negocio.dtos.enrollment_schemas import (
    EnrollmentFichaMedicaDTO,
    EnrollmentFichaMedicaMenorDTO,
)
from app.servicios_negocio.dtos.persona_schemas import FichaMedicaCreateDTO, FichaMedicaUpdateDTO

_LARGA = "x" * 151
_EXACTA = "x" * 150


def _kwargs(dto_cls, enfermedades):
    base = {"tipo_sangre": "O_POSITIVO", "alergias": "Ninguna", "enfermedades": enfermedades}
    if dto_cls is EnrollmentFichaMedicaDTO:
        base.update(contacto_emergencia="Ana Pérez", telefono_emergencia="0991234567")
    if dto_cls is FichaMedicaCreateDTO:
        base.update(persona_id=1, telefono_emergencia="0991234567")
    return base


_DTOS = [EnrollmentFichaMedicaDTO, EnrollmentFichaMedicaMenorDTO, FichaMedicaCreateDTO, FichaMedicaUpdateDTO]


@pytest.mark.parametrize("dto_cls", _DTOS)
def test_enfermedad_de_mas_de_150_caracteres_se_rechaza(dto_cls):
    with pytest.raises(ValidationError) as exc_info:
        dto_cls(**_kwargs(dto_cls, ["Asma", _LARGA]))
    assert any("150 caracteres" in e["msg"] for e in exc_info.value.errors())


@pytest.mark.parametrize("dto_cls", _DTOS)
def test_enfermedad_de_150_caracteres_se_acepta(dto_cls):
    dto = dto_cls(**_kwargs(dto_cls, [_EXACTA]))
    assert dto.enfermedades == [_EXACTA]
