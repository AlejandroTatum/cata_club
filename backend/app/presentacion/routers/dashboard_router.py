from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.infraestructura.db import obtener_sesion
from app.soporte_transversal.tiempo import ahora_club
from app.dominio.enums import DiaSemana, EstadoMembresia, EstadoPago, TipoRol
from app.dominio.modelos import HorarioEntrenamiento, Membresia, Pago, Persona, Rol, Usuario
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
    persona_activa = Persona.activo.is_(True)
    total_personas = db.query(func.count(Persona.id)).filter(persona_activa).scalar() or 0

    # Población que puede tener membresía: alumnos. Con Usuario, el rol ALUMNO
    # decide; SIN Usuario también es alumno (un menor representado sin
    # credenciales no recibe Usuario — `PersonaServicio.crear_representado` —
    # pero entrena y paga membresía). Solo administrador y entrenador quedan
    # fuera: nunca tienen membresía y distorsionan el denominador de
    # "MEMBRESÍAS ACTIVAS · X de Y".
    es_alumno = Persona.usuario.has(
        Usuario.roles.any(Rol.tipo_rol == TipoRol.ALUMNO)
    ) | ~Persona.usuario.has()

    total_alumnos = db.query(func.count(Persona.id)).filter(persona_activa, es_alumno).scalar() or 0

    active_memberships = (
        db.query(func.count(Membresia.id))
        .join(Persona, Membresia.persona_id == Persona.id)
        .filter(persona_activa, Membresia.estado == EstadoMembresia.ACTIVA)
        .scalar()
        or 0
    )

    pending_payments = (
        db.query(func.count(Pago.id))
        .join(Persona, Pago.persona_id == Persona.id)
        .join(Membresia, Pago.membresia_id == Membresia.id)
        .filter(
            persona_activa,
            Membresia.estado != EstadoMembresia.SUSPENDIDA,
            Pago.estado_pago == EstadoPago.PENDIENTE_VALIDACION,
        )
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

    # "Por regularizar" = alumnos sin membresía ACTIVA. Contar solo a quienes
    # no tienen NINGUNA membresía histórica ocultaba a los vencidos/inactivos.
    personas_sin_membresia = (
        db.query(func.count(Persona.id))
        .filter(
            persona_activa,
            es_alumno,
            ~Persona.membresias.any(Membresia.estado == EstadoMembresia.ACTIVA),
            ~Persona.membresias.any(Membresia.estado == EstadoMembresia.SUSPENDIDA),
        )
        .scalar()
        or 0
    )

    return DashboardStatsDTO(
        total_personas=total_personas,
        total_alumnos=total_alumnos,
        active_memberships=active_memberships,
        pending_payments=pending_payments,
        today_schedules=today_schedules,
        personas_sin_membresia=personas_sin_membresia,
    )
