"""ENT-08 (QA3): `justificativo` es VARCHAR(255); un texto más largo debe
dar 422 en el DTO, no un 500 al insertar."""
import pytest
from pydantic import ValidationError

from app.servicios_negocio.dtos.asistencia_schemas import (
    AsistenciaCorreccionDTO,
    AsistenciaCreateDTO,
)


def _crear(justificativo):
    return AsistenciaCreateDTO(
        fecha_entrenamiento="2026-01-05", estado="JUSTIFICADO",
        justificativo=justificativo, persona_id=1, horario_id=1,
    )


def _corregir(justificativo):
    return AsistenciaCorreccionDTO(
        estado="JUSTIFICADO", justificativo=justificativo, motivo="error de carga",
    )


@pytest.mark.parametrize("construir", [_crear, _corregir])
def test_justificativo_de_255_caracteres_se_acepta(construir):
    assert len(construir("a" * 255).justificativo) == 255


@pytest.mark.parametrize("construir", [_crear, _corregir])
def test_justificativo_de_256_caracteres_se_rechaza(construir):
    with pytest.raises(ValidationError):
        construir("a" * 256)
