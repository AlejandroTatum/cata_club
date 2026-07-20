from fastapi import APIRouter, Depends, status, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import date

from app.infraestructura.db import obtener_sesion
from app.presentacion.schemas.asistencia_schemas import (
    AsistenciaCreateDTO, AsistenciaResponseDTO, HorarioCreateDTO, HorarioResponseDTO,
)
from app.seguridad.gestor_auth import GestorAutenticacion
from app.servicios_negocio.asistencia_servicio import AsistenciaServicio
from app.servicios_negocio.gestor_permisos import GestorPermisos

router = APIRouter(prefix="/asistencias", tags=["Asistencias"])


@router.post("/horarios", response_model=HorarioResponseDTO, status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(GestorPermisos(["ADMINISTRADOR", "ENTRENADOR"]))])
async def crear_horario(datos: HorarioCreateDTO, db: Session = Depends(obtener_sesion)):
    return AsistenciaServicio(db).crear_horario(datos)


# Listado de horarios: lectura para cualquier autenticado (no anónimo).
@router.get(
    "/horarios",
    response_model=List[HorarioResponseDTO],
    dependencies=[Depends(GestorAutenticacion.decodificar_token)],
)
def listar_horarios(db: Session = Depends(obtener_sesion)):
    return AsistenciaServicio(db).listar_horarios()


@router.post("/", response_model=AsistenciaResponseDTO, status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(GestorPermisos(["ADMINISTRADOR", "ENTRENADOR"]))])
async def registrar_asistencia(datos: AsistenciaCreateDTO, db: Session = Depends(obtener_sesion)):
    return AsistenciaServicio(db).registrar_asistencia(datos)


# Historial de asistencia de una persona: dato sensible (presencia/régimen),
# requiere autenticación (no anónimo).
@router.get(
    "/persona/{persona_id}",
    response_model=List[AsistenciaResponseDTO],
    dependencies=[Depends(GestorAutenticacion.decodificar_token)],
)
async def historial_asistencia_persona(persona_id: int, db: Session = Depends(obtener_sesion)):
    return AsistenciaServicio(db).historial_por_persona(persona_id)


# --- E02-RF005: reporte de asistencia por horario, periodo o alumno --------
@router.get(
    "/reportes",
    response_model=List[AsistenciaResponseDTO],
    dependencies=[Depends(GestorPermisos(["ADMINISTRADOR", "ENTRENADOR"]))],
)
async def reporte_asistencia(
    horario_id: Optional[int] = Query(default=None),
    persona_id: Optional[int] = Query(default=None),
    fecha_inicio: Optional[date] = Query(default=None),
    fecha_fin: Optional[date] = Query(default=None),
    db: Session = Depends(obtener_sesion),
):
    return AsistenciaServicio(db).generar_reporte(
        horario_id=horario_id, persona_id=persona_id,
        fecha_inicio=fecha_inicio, fecha_fin=fecha_fin,
    )
