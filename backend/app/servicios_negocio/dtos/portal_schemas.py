"""Respuesta agregada del portal del alumno (issue #1592)."""
from typing import List, Optional

from pydantic import BaseModel

from app.servicios_negocio.dtos.asistencia_schemas import AsistenciaResponseDTO, HorarioResponseDTO
from app.servicios_negocio.dtos.base import ResponseBase
from app.servicios_negocio.dtos.membresia_pago_schemas import MembresiaResponseDTO, TipoMembresiaResponseDTO
from app.servicios_negocio.dtos.persona_schemas import PersonaResponseDTO


class PortalRepresentanteDTO(ResponseBase, BaseModel):
    nombres: str
    apellidos: str


class PortalPerfilDTO(ResponseBase, BaseModel):
    """Lo que el BFF antes armaba con una llamada por recurso y por perfil."""
    persona: PersonaResponseDTO
    representante: Optional[PortalRepresentanteDTO] = None
    historial: List[AsistenciaResponseDTO]
    membresias: List[MembresiaResponseDTO]


class PortalAlumnoResponseDTO(ResponseBase, BaseModel):
    titular: PortalPerfilDTO
    representados: List[PortalPerfilDTO]
    horarios: List[HorarioResponseDTO]
    tipos: List[TipoMembresiaResponseDTO]
