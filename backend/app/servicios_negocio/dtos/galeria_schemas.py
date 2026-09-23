"""DTOs para las entradas públicas de la galería (issue #1372)."""
from pydantic import BaseModel, Field, field_validator

from app.servicios_negocio.dtos.base import ResponseBase


class EntradaGaleriaResponseDTO(ResponseBase, BaseModel):
    id: int
    titulo: str
    descripcion: str
    imagen_url: str


class EntradaGaleriaCreateDTO(BaseModel):
    titulo: str = Field(..., min_length=1, max_length=80)
    descripcion: str = Field(..., min_length=1, max_length=500)

    @field_validator("titulo")
    @classmethod
    def validar_titulo_no_vacio(cls, valor: str) -> str:
        if not valor.strip():
            raise ValueError("El título es obligatorio.")
        return valor

    @field_validator("descripcion")
    @classmethod
    def validar_descripcion_no_vacia(cls, valor: str) -> str:
        if not valor.strip():
            raise ValueError("La descripción es obligatoria.")
        return valor
