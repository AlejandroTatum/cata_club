from pydantic import BaseModel, Field

from app.presentacion.schemas.base import ResponseBase


class DashboardStatsDTO(ResponseBase, BaseModel):
    total_personas: int = Field(..., examples=[59])
    active_memberships: int = Field(..., examples=[30])
    pending_payments: int = Field(..., examples=[5])
    today_schedules: int = Field(..., examples=[8])
    personas_sin_membresia: int = Field(..., examples=[12])
