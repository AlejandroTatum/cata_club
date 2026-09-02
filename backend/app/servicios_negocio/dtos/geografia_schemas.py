from pydantic import BaseModel, Field
from typing import Optional

from app.servicios_negocio.dtos.base import ResponseBase


# --- Pais ---
class PaisCreateDTO(BaseModel):
    nombre: str = Field(..., max_length=100)


class PaisResponseDTO(ResponseBase, PaisCreateDTO):
    id: int


class ProvinciaDTO(ResponseBase, BaseModel):
    id: int
    nombre: str
    pais_id: int


# --- Provincia ---
class ProvinciaCreateDTO(BaseModel):
    nombre: str = Field(..., max_length=100)
    pais_id: int


class ProvinciaResponseDTO(ResponseBase, ProvinciaCreateDTO):
    id: int


# --- Canton ---
class CantonCreateDTO(BaseModel):
    nombre: str = Field(..., max_length=100)
    provincia_id: int


class CantonResponseDTO(ResponseBase, CantonCreateDTO):
    id: int


# --- Direccion ---
class DireccionCreateDTO(BaseModel):
    barrio: str
    calle_principal: str
    calle_secundaria: Optional[str] = None
    numero_casa: Optional[str] = None
    canton_id: int


class DireccionResponseDTO(ResponseBase, DireccionCreateDTO):
    id: int
