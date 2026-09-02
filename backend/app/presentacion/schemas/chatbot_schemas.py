"""
DTOs del endpoint público del chatbot de FAQ (asistente de navegación de la
app). No persiste nada en base de datos: el historial de la conversación
viaja completo en cada request (lo mantiene el cliente).
"""
from typing import List, Optional

from pydantic import BaseModel, Field

from app.servicios_negocio.dtos.base import ResponseBase


class ChatbotConsultaDTO(BaseModel):
    """Request del widget de chat. `historial` es opcional y lo arma el
    cliente con los últimos turnos de la conversación (rol + texto); el
    servicio solo usa los últimos N para acotar el costo/tokens."""
    mensaje: str = Field(..., min_length=1, max_length=2000, examples=["¿Cómo registro un pago?"])
    historial: Optional[List[dict]] = Field(
        default=None,
        description="Turnos previos de la conversación: [{rol: 'usuario'|'asistente', texto: str}, ...]",
    )


class ChatbotRespuestaDTO(ResponseBase, BaseModel):
    """Respuesta del asistente para un turno de la conversación."""
    respuesta: str = Field(..., examples=["Para registrar un pago, andá a Pagos > Nuevo pago..."])
