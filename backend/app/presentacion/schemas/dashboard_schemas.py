from pydantic import BaseModel, Field

from app.servicios_negocio.dtos.base import ResponseBase


class DashboardStatsDTO(ResponseBase, BaseModel):
    total_personas: int = Field(..., examples=[59])
    # Población que puede tener membresía (alumnos): denominador correcto de
    # "MEMBRESÍAS ACTIVAS · X de Y". `total_personas` incluye administrador y
    # entrenador, que nunca tienen membresía, y alimenta otra tarjeta.
    total_alumnos: int = Field(..., examples=[55])
    active_memberships: int = Field(..., examples=[30])
    pending_payments: int = Field(..., examples=[5])
    today_schedules: int = Field(..., examples=[8])
    personas_sin_membresia: int = Field(..., examples=[12])
