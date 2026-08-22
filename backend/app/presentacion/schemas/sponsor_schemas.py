"""DTOs para los logos públicos de patrocinadores (issue #503)."""
from pydantic import BaseModel, Field

from app.presentacion.schemas.base import ResponseBase


class SponsorResponseDTO(ResponseBase, BaseModel):
    id: int
    nombre: str
    logo_url: str


class SponsorCreateDTO(BaseModel):
    nombre: str = Field(..., min_length=1, max_length=80)
