from fastapi import APIRouter, Depends, Response, status, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import date

from app.dominio.enums import Categoria
from app.infraestructura.db import obtener_sesion
from app.infraestructura.generador_pdf import generar_reporte_pdf
from app.presentacion.schemas.asistencia_schemas import (
    AsistenciaCreateDTO, AsistenciaResponseDTO, HorarioCreateDTO, HorarioUpdateDTO, HorarioResponseDTO,
    AlumnoHorarioCreateDTO, AlumnoHorarioDetalleDTO,
)
from app.seguridad.gestor_auth import GestorAutenticacion
from app.servicios_negocio.asistencia_servicio import AsistenciaServicio
from app.servicios_negocio.gestor_permisos import GestorPermisos

router = APIRouter(prefix="/asistencias", tags=["Asistencias"])


@router.post("/horarios", response_model=HorarioResponseDTO, status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(GestorPermisos(["ADMINISTRADOR", "ENTRENADOR"]))])
async def crear_horario(datos: HorarioCreateDTO, db: Session = Depends(obtener_sesion)):
    return AsistenciaServicio(db).crear_horario(datos)


@router.put("/horarios/{horario_id}", response_model=HorarioResponseDTO,
             dependencies=[Depends(GestorPermisos(["ADMINISTRADOR"]))])
async def actualizar_horario(horario_id: int, datos: HorarioUpdateDTO, db: Session = Depends(obtener_sesion)):
    return AsistenciaServicio(db).actualizar_horario(horario_id, datos)


@router.delete("/horarios/{horario_id}", status_code=status.HTTP_204_NO_CONTENT,
               dependencies=[Depends(GestorPermisos(["ADMINISTRADOR"]))])
async def eliminar_horario(horario_id: int, db: Session = Depends(obtener_sesion)):
    AsistenciaServicio(db).eliminar_horario(horario_id)


# Listado de horarios: lectura para cualquier autenticado (no anónimo).
@router.get(
    "/horarios",
    response_model=List[HorarioResponseDTO],
    dependencies=[Depends(GestorAutenticacion.decodificar_token)],
)
def listar_horarios(
    categoria: Optional[Categoria] = Query(default=None),
    db: Session = Depends(obtener_sesion),
):
    return AsistenciaServicio(db).listar_horarios(categoria)


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


# --- Asignación directa Alumno ↔ Horario ------------------------------------
@router.post(
    "/asignar-alumno",
    response_model=AlumnoHorarioDetalleDTO,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(GestorPermisos(["ADMINISTRADOR", "ENTRENADOR"]))],
)
async def asignar_alumno_a_horario(
    datos: AlumnoHorarioCreateDTO, db: Session = Depends(obtener_sesion)
):
    servicio = AsistenciaServicio(db)
    servicio.asignar_alumno_a_horario(datos)
    return servicio.listar_alumnos_por_horario(datos.horario_id)[-1]


@router.delete(
    "/desasignar-alumno",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(GestorPermisos(["ADMINISTRADOR", "ENTRENADOR"]))],
)
async def desasignar_alumno_de_horario(
    persona_id: int = Query(...),
    horario_id: int = Query(...),
    db: Session = Depends(obtener_sesion),
):
    AsistenciaServicio(db).desasignar_alumno_de_horario(persona_id, horario_id)


@router.get(
    "/horarios/{horario_id}/alumnos",
    response_model=List[AlumnoHorarioDetalleDTO],
    dependencies=[Depends(GestorAutenticacion.decodificar_token)],
)
async def listar_alumnos_por_horario(
    horario_id: int, db: Session = Depends(obtener_sesion)
):
    return AsistenciaServicio(db).listar_alumnos_por_horario(horario_id)


@router.get(
    "/alumnos/{persona_id}/horarios",
    response_model=List[AlumnoHorarioDetalleDTO],
    dependencies=[Depends(GestorAutenticacion.decodificar_token)],
)
async def listar_horarios_por_alumno(
    persona_id: int, db: Session = Depends(obtener_sesion)
):
    return AsistenciaServicio(db).listar_horarios_por_alumno(persona_id)
