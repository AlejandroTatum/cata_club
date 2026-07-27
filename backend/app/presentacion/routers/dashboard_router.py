from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.infraestructura.db import obtener_sesion
from app.soporte_transversal.tiempo import ahora_club
from app.dominio.enums import DiaSemana, EstadoMembresia, EstadoPago
from app.dominio.modelos import HorarioEntrenamiento, Membresia, Pago, Persona
from app.presentacion.schemas.dashboard_schemas import DashboardStatsDTO
from app.servicios_negocio.gestor_permisos import GestorPermisos

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])

# La zona horaria del club vivía aquí (`ZoneInfo("America/Guayaquil")`).
# Ahora es única y compartida: `app/soporte_transversal/tiempo.py`.
_WEEKDAY_MAP = {
    0: DiaSemana.LUNES,
    1: DiaSemana.MARTES,
    2: DiaSemana.MIERCOLES,
    3: DiaSemana.JUEVES,
    4: DiaSemana.VIERNES,
    5: DiaSemana.SABADO,
    6: DiaSemana.DOMINGO,
}


@router.get(
    "/stats",
    response_model=DashboardStatsDTO,
    dependencies=[Depends(GestorPermisos(["ADMINISTRADOR"]))],
)
async def dashboard_stats(db: Session = Depends(obtener_sesion)) -> DashboardStatsDTO:
    total_personas = db.query(func.count(Persona.id)).scalar() or 0

    active_memberships = (
        db.query(func.count(Membresia.id))
        .filter(Membresia.estado == EstadoMembresia.ACTIVA)
        .scalar()
        or 0
    )

    pending_payments = (
        db.query(func.count(Pago.id))
        .filter(Pago.estado_pago == EstadoPago.PENDIENTE_VALIDACION)
        .scalar()
        or 0
    )

    today_weekday = _WEEKDAY_MAP[ahora_club().weekday()]
    today_schedules = (
        db.query(func.count(HorarioEntrenamiento.id))
        .filter(HorarioEntrenamiento.dia_semana == today_weekday)
        .scalar()
        or 0
    )

    personas_sin_membresia = (
        db.query(func.count(Persona.id))
        .filter(~select(Membresia.id).where(Membresia.persona_id == Persona.id).correlate(Persona).exists())
        .scalar()
        or 0
    )

    return DashboardStatsDTO(
        total_personas=total_personas,
        active_memberships=active_memberships,
        pending_payments=pending_payments,
        today_schedules=today_schedules,
        personas_sin_membresia=personas_sin_membresia,
    )
