"""
Schemas de las notificaciones in-app.

Extraído de `ranking_schemas.py`: las notificaciones nunca fueron parte del
ranking competitivo, solo compartían módulo por historia de implementación.
Con el ranking eliminado por completo, este DTO queda en su propio archivo.
"""
from pydantic import BaseModel
from datetime import datetime
from typing import Optional

from app.dominio.enums import TipoNotificacion
from app.presentacion.schemas.base import ResponseBase


class NotificacionResponseDTO(ResponseBase, BaseModel):
    id: int
    tipo: TipoNotificacion
    mensaje: str
    leida: bool
    fecha_creacion: datetime
    entidad_relacionada_id: Optional[int] = None
