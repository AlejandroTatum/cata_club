"""DTOs del segundo guardián de un menor (issue #1666)."""
from datetime import date
from typing import List, Literal, Optional

from pydantic import BaseModel, Field

from app.servicios_negocio.dtos.base import ResponseBase
from app.servicios_negocio.dtos.validadores import (
    ApellidoValidado, CedulaValidada, CorreoValidado, NombreValidado, TelefonoValidado,
)

#: Máximo de hijos que una sola invitación puede cubrir.
MAX_PERSONAS_POR_INVITACION = 10


class DatosInvitadoDTO(BaseModel):
    """Datos de la persona a la que la invitación le CREA la cuenta. Solo se
    exigen cuando el correo no tiene cuenta; mismas validaciones que el alta
    de un entrenador."""
    nombres: NombreValidado = Field(...)
    apellidos: ApellidoValidado = Field(...)
    cedula: CedulaValidada = Field(..., max_length=32)
    fecha_nacimiento: date
    telefono: TelefonoValidado = Field(..., max_length=32)


class InvitarCoRepresentanteDTO(BaseModel):
    persona_ids: List[int] = Field(..., min_length=1, max_length=MAX_PERSONAS_POR_INVITACION)
    correo: CorreoValidado = Field(..., max_length=100)
    # Siempre se envían: se usan solo si el correo no tiene cuenta, y la
    # respuesta no puede delatar si la tiene.
    datos: DatosInvitadoDTO


class InvitacionCoRepresentanteResponseDTO(ResponseBase, BaseModel):
    """Respuesta ÚNICA, sin importar qué pasó con el correo."""
    mensaje: str


class InvitacionRecibidaDTO(ResponseBase, BaseModel):
    id: int
    nombre_menor: str
    nombre_invitante: str


class GuardianDeMenorDTO(ResponseBase, BaseModel):
    """Con `PENDIENTE` solo viaja el correo que el principal escribió."""
    persona_id: Optional[int] = None
    nombres: Optional[str] = None
    apellidos: Optional[str] = None
    correo: Optional[str] = None
    estado: Literal["ACTIVO", "PENDIENTE"]


class MenorConGuardianesDTO(ResponseBase, BaseModel):
    """Un menor del que el solicitante es guardián. `rol` es el del
    SOLICITANTE; `segundo_guardian` solo viaja al principal. `completo`:
    ya hay dos guardianes (tope de la decisión del dueño)."""
    persona_id: int
    nombres: str
    apellidos: str
    rol: Literal["PRINCIPAL", "SEGUNDO"]
    segundo_guardian: Optional[GuardianDeMenorDTO] = None
    completo: bool
