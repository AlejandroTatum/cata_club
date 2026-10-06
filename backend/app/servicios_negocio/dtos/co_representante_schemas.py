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
    datos: Optional[DatosInvitadoDTO] = None


class InvitacionCoRepresentanteResponseDTO(ResponseBase, BaseModel):
    """`REQUIERE_DATOS`: el correo no tiene cuenta y falta `datos` -- no se
    hizo nada. `INVITADO`: se creó la cuenta y se envió el enlace de
    contraseña. `VINCULADO`: la cuenta REPRESENTANTE ya existía; solo se
    vinculó."""
    estado: Literal["REQUIERE_DATOS", "INVITADO", "VINCULADO"]
    persona_ids: List[int] = []


class GuardianDeMenorDTO(ResponseBase, BaseModel):
    persona_id: int
    nombres: str
    apellidos: str
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
