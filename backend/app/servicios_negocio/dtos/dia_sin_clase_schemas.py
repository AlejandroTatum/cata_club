"""DTOs de los días sin clase del club (issue #1665)."""
from datetime import date
from typing import Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from app.dominio.modelos import DiaSinClase
from app.servicios_negocio.dtos.base import ResponseBase


class DiaSinClaseResponseDTO(ResponseBase, BaseModel):
    id: int
    fecha_inicio: date
    fecha_fin: date
    motivo: str


class DiaSinClaseCreadoResponseDTO(DiaSinClaseResponseDTO):
    """Respuesta del alta: informa si el aviso a los socios quedó encolado."""
    aviso_encolado: bool


def _motivo_sin_espacios(valor: str) -> str:
    limpio = valor.strip()
    if not limpio:
        raise ValueError("El motivo es obligatorio.")
    return limpio


class DiaSinClaseCreateDTO(BaseModel):
    fecha_inicio: date
    # Un solo día: se omite `fecha_fin` y vale `fecha_inicio`.
    fecha_fin: Optional[date] = None
    motivo: str = Field(..., min_length=1, max_length=DiaSinClase.MOTIVO_MAX)

    _validar_motivo = field_validator("motivo")(_motivo_sin_espacios)

    @model_validator(mode="after")
    def validar_rango(self) -> "DiaSinClaseCreateDTO":
        if self.fecha_fin is None:
            self.fecha_fin = self.fecha_inicio
        if self.fecha_fin < self.fecha_inicio:
            raise ValueError("La fecha final no puede ser anterior a la inicial.")
        return self


class DiaSinClaseUpdateDTO(DiaSinClaseCreateDTO):
    """Edición completa: mismos campos y reglas que el alta."""
