"""Respuesta agregada del portal del alumno (issue #1592)."""
from datetime import date
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
    # Total del historial completo: `historial` es solo la ventana reciente,
    # y el cliente pagina el resto con `GET /asistencias/persona/{id}`.
    historial_total: int = 0
    membresias: List[MembresiaResponseDTO]
    # Bloqueo por impago (#1768), por perfil: el titular y cada representado se
    # bloquean por separado. `cubierto_hasta` es el fin de su cobertura (el
    # «venció el {fecha}» del banner); no viaja ningún monto adeudado.
    bloqueado_por_impago: bool = False
    cubierto_hasta: Optional[date] = None


class PortalAlumnoResponseDTO(ResponseBase, BaseModel):
    titular: PortalPerfilDTO
    representados: List[PortalPerfilDTO]
    horarios: List[HorarioResponseDTO]
    tipos: List[TipoMembresiaResponseDTO]


class PortalBloqueoRepresentadoDTO(ResponseBase, BaseModel):
    persona_id: int
    bloqueado_por_impago: bool


class PortalBloqueosResponseDTO(ResponseBase, BaseModel):
    """Solo el estado de bloqueo (#1787): lo que la compuerta del BFF necesita
    por pedido, sin el agregado del portal."""
    representados: List[PortalBloqueoRepresentadoDTO]
