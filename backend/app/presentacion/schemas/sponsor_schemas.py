"""DTOs para los logos públicos de patrocinadores (issue #503)."""
from pydantic import BaseModel, Field, field_validator

from app.presentacion.schemas.base import ResponseBase


class SponsorResponseDTO(ResponseBase, BaseModel):
    id: int
    nombre: str
    logo_url: str


class SponsorCreateDTO(BaseModel):
    nombre: str = Field(..., min_length=1, max_length=80)

    @field_validator("nombre")
    @classmethod
    def validar_nombre_no_vacio(cls, valor: str) -> str:
        if not valor.strip():
            raise ValueError("El nombre es obligatorio.")
        return valor
