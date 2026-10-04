"""DTOs para las entradas públicas de la galería (issue #1372)."""
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.servicios_negocio.dtos.base import ResponseBase


class EntradaGaleriaResponseDTO(ResponseBase, BaseModel):
    id: int
    titulo: str
    descripcion: str
    imagen_url: str
    orden: int
    visible: bool


# ADMB-33: los mismos topes de palabras que aplica la pantalla (`galeria/page.tsx`).
TITULO_MAX_PALABRAS = 8
DESCRIPCION_MAX_PALABRAS = 45


class EntradaGaleriaCreateDTO(BaseModel):
    titulo: str = Field(..., min_length=1, max_length=80)
    descripcion: str = Field(..., min_length=1, max_length=500)

    @field_validator("titulo")
    @classmethod
    def validar_titulo_no_vacio(cls, valor: str) -> str:
        if not valor.strip():
            raise ValueError("El título es obligatorio.")
        if len(valor.split()) > TITULO_MAX_PALABRAS:
            raise ValueError(f"El título no puede superar las {TITULO_MAX_PALABRAS} palabras.")
        return valor

    @field_validator("descripcion")
    @classmethod
    def validar_descripcion_no_vacia(cls, valor: str) -> str:
        if not valor.strip():
            raise ValueError("La descripción es obligatoria.")
        if len(valor.split()) > DESCRIPCION_MAX_PALABRAS:
            raise ValueError(f"La descripción no puede superar las {DESCRIPCION_MAX_PALABRAS} palabras.")
        return valor


class EntradaGaleriaUpdateDTO(EntradaGaleriaCreateDTO):
    """ADMB-34: mismos topes que el alta, más la visibilidad."""
    visible: bool = True


class MoverEntradaGaleriaDTO(BaseModel):
    direccion: Literal["subir", "bajar"]
