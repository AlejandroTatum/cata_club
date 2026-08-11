from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool
from typing import List, Optional
from datetime import date

from app.infraestructura.db import obtener_sesion
from app.soporte_transversal.tiempo import hoy_club
from app.infraestructura.generador_pdf import construir_respuesta_pdf, generar_reporte_pdf
from app.presentacion.schemas.asistencia_schemas import (
    AsistenciaCreateDTO, AsistenciaResponseDTO, CategoriaCreateDTO, CategoriaResponseDTO,
    CategoriaUpdateDTO, HorarioCreateDTO, HorarioUpdateDTO, HorarioResponseDTO,
    AlumnoHorarioCreateDTO, AlumnoHorarioDetalleDTO, AsignacionAlumnoHorarioResponseDTO,
    UltimaListaDTO,
)
from app.presentacion.schemas.base import PaginatedResponse
from app.seguridad.gestor_auth import GestorAutenticacion
from app.servicios_negocio.asistencia_servicio import AsistenciaServicio
from app.servicios_negocio.gestor_permisos import GestorPermisos
from app.servicios_negocio.politica_acceso import (
    ADMINISTRADOR_O_ENTRENADOR, PoliticaAccesoPersona,
)

router = APIRouter(prefix="/asistencias", tags=["Asistencias"])


def _validar_rango_de_fechas(fecha_inicio: Optional[date], fecha_fin: Optional[date]) -> None:
    """Rechaza un rango invertido con el MISMO 422 y el mismo texto que los
    reportes de personas y de pagos (`personas_router`,
    `membresias_pagos_router`). Sin esto, invertir las fechas devolvía 200 con
    una lista vacía: una respuesta silenciosa y equivocada.

    A diferencia de sus hermanos (que usan `>=`), aquí se compara con `>`
    porque el filtro del repositorio es inclusivo en ambos extremos
    (`>= fecha_inicio`, `<= fecha_fin`): un reporte de un solo día se pide con
    `fecha_inicio == fecha_fin` y es una consulta legítima."""
    if fecha_inicio is None or fecha_fin is None:
        return
    if fecha_inicio > fecha_fin:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="La fecha de inicio debe ser anterior a la fecha de fin.",
        )


# Catálogo de categorías (M1): el frontend lo consulta acá en vez de
# espejarlo a mano (ver `frontend/src/services/categorias.ts`). Lectura para
# cualquier autenticado, igual que `/horarios`.
@router.get(
    "/categorias",
    response_model=List[CategoriaResponseDTO],
    dependencies=[Depends(GestorAutenticacion.decodificar_token)],
)
def listar_categorias(db: Session = Depends(obtener_sesion)):
    return AsistenciaServicio(db).listar_categorias()


# ABM de categorías (docs/fixes/24-abm-categorias.md): alta/edición/baja
# atómica de la categoria + sus días + sus horarios, en una sola operación
# (pedido del dueño). ADMIN-only, como el resto de la escritura sobre
# `/horarios` que muta el catálogo (PUT/DELETE), no el tier más permisivo
# de POST /horarios (que además admite ENTRENADOR).
@router.post(
    "/categorias", response_model=CategoriaResponseDTO, status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(GestorPermisos(["ADMINISTRADOR"]))],
)
async def crear_categoria(datos: CategoriaCreateDTO, db: Session = Depends(obtener_sesion)):
    return AsistenciaServicio(db).crear_categoria(datos)


@router.put(
    "/categorias/{codigo}", response_model=CategoriaResponseDTO,
    dependencies=[Depends(GestorPermisos(["ADMINISTRADOR"]))],
)
async def actualizar_categoria(
    codigo: str, datos: CategoriaUpdateDTO, db: Session = Depends(obtener_sesion),
):
    return AsistenciaServicio(db).actualizar_categoria(codigo, datos)


@router.delete(
    "/categorias/{codigo}", status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(GestorPermisos(["ADMINISTRADOR"]))],
)
async def eliminar_categoria(codigo: str, db: Session = Depends(obtener_sesion)):
    AsistenciaServicio(db).eliminar_categoria(codigo)


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
    categoria: Optional[str] = Query(default=None),
    db: Session = Depends(obtener_sesion),
):
    return AsistenciaServicio(db).listar_horarios(categoria)


@router.post("/", response_model=AsistenciaResponseDTO, status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(GestorPermisos(["ADMINISTRADOR", "ENTRENADOR"]))])
async def registrar_asistencia(datos: AsistenciaCreateDTO, db: Session = Depends(obtener_sesion)):
    return AsistenciaServicio(db).registrar_asistencia(datos)


# Historial de asistencia de una persona: dato sensible (presencia/régimen).
# Exigir solo autenticación no alcanzaba: con los ids consecutivos, cualquier
# sesión del club podía reconstruir la rutina de presencia de cualquier otro
# socio -- incluidos los menores. Mismo criterio que el resto de las lecturas
# por `persona_id`: dueño, su representante, o staff (que legítimamente lo
# necesita para tomar asistencia).
@router.get(
    "/persona/{persona_id}",
    response_model=PaginatedResponse[AsistenciaResponseDTO],
    dependencies=[Depends(GestorAutenticacion.decodificar_token)],
)
async def historial_asistencia_persona(
    persona_id: int,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    token_payload: dict = Depends(GestorAutenticacion.decodificar_token),
    db: Session = Depends(obtener_sesion),
):
    PoliticaAccesoPersona(db).exigir_acceso(
        persona_id_objetivo=persona_id,
        persona_id_solicitante=token_payload.get("persona_id"),
        roles_solicitante=token_payload.get("roles", []),
        roles_privilegiados=ADMINISTRADOR_O_ENTRENADOR,
        mensaje="No puede consultar el historial de asistencia de otra persona",
    )
    items, total = AsistenciaServicio(db).historial_por_persona(persona_id, skip=skip, limit=limit)
    return PaginatedResponse(items=items, total=total, skip=skip, limit=limit)


# --- E02-RF005: reporte de asistencia por horario, periodo o alumno --------
# Paginado (issue #7 / TRA-6): mismo contrato skip/limit (tope 200) que
# GET /personas/ y GET /membresias/pagos. El export a PDF de abajo llama al
# mismo servicio SIN paginar -- ver su propio comentario.
@router.get(
    "/reportes",
    response_model=PaginatedResponse[AsistenciaResponseDTO],
    dependencies=[Depends(GestorPermisos(["ADMINISTRADOR", "ENTRENADOR"]))],
)
async def reporte_asistencia(
    horario_id: Optional[int] = Query(default=None),
    persona_id: Optional[int] = Query(default=None),
    fecha_inicio: Optional[date] = Query(default=None),
    fecha_fin: Optional[date] = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(obtener_sesion),
):
    _validar_rango_de_fechas(fecha_inicio, fecha_fin)
    servicio = AsistenciaServicio(db)
    items = servicio.generar_reporte(
        horario_id=horario_id, persona_id=persona_id,
        fecha_inicio=fecha_inicio, fecha_fin=fecha_fin,
        skip=skip, limit=limit,
    )
    total = servicio.contar_reporte(
        horario_id=horario_id, persona_id=persona_id,
        fecha_inicio=fecha_inicio, fecha_fin=fecha_fin,
    )
    return PaginatedResponse(items=items, total=total, skip=skip, limit=limit)


# --- Exportación a PDF del reporte de asistencia ----------------------------
# IMPORTANTE: a diferencia del endpoint JSON de arriba (que permite
# ADMINISTRADOR y ENTRENADOR), este export PDF exige exclusivamente
# ADMINISTRADOR. Es una restricción intencional del capability
# `report-pdf-export` -- no es un descuido a "corregir".
# `generar_reporte_pdf` es CPU-bound (renderizado ReportLab síncrono); se
# ejecuta vía `run_in_threadpool` para no bloquear el event loop de asyncio
# (un solo worker uvicorn) — mismo motivo por el que
# `generar_comprobante_pago_pdf` corre en una tarea de Celery, no inline.
@router.get(
    "/reportes/pdf",
    dependencies=[Depends(GestorPermisos(["ADMINISTRADOR"]))],
)
async def reporte_asistencia_pdf(
    horario_id: Optional[int] = Query(default=None),
    persona_id: Optional[int] = Query(default=None),
    fecha_inicio: Optional[date] = Query(default=None),
    fecha_fin: Optional[date] = Query(default=None),
    db: Session = Depends(obtener_sesion),
):
    _validar_rango_de_fechas(fecha_inicio, fecha_fin)
    registros = AsistenciaServicio(db).generar_reporte(
        horario_id=horario_id, persona_id=persona_id,
        fecha_inicio=fecha_inicio, fecha_fin=fecha_fin,
    )
    columnas = ["Fecha", "Horario", "Estudiante", "Estado"]
    filas = [
        [
            r.fecha_entrenamiento.strftime("%d/%m/%Y"),
            f"{r.horario.dia_semana.value} {r.horario.hora_inicio.strftime('%H:%M')}"
            f"–{r.horario.hora_fin.strftime('%H:%M')}",
            f"{r.persona.nombres} {r.persona.apellidos}",
            r.estado.value,
        ]
        for r in registros
    ]
    pdf_bytes = await run_in_threadpool(
        generar_reporte_pdf,
        titulo="Reporte de Asistencia",
        columnas=columnas,
        filas=filas,
    )
    # Día del CLUB: la fecha del nombre de archivo es la que un humano lee
    # para saber de cuándo es el reporte. Uno descargado a las 19:30 del lunes
    # no puede llamarse con la fecha del martes.
    fecha_iso = hoy_club().isoformat()
    return construir_respuesta_pdf(pdf_bytes, f"reporte-asistencia_{fecha_iso}.pdf")


# --- Panel del entrenador: "últimas listas del club" (Fix 8, DSH-2) --------
# Sin autor a propósito: `Asistencia` no guarda quién tomó la lista
# (modelos.py:536, deliberado) -- §8 de decisiones-de-negocio-2026-08-11.md.
# Cero migración: se computa de Asistencia + HorarioEntrenamiento, lo mismo
# que ya existía. Mismo tier de permiso que `/reportes` (ADMINISTRADOR y
# ENTRENADOR): ninguno de los dos roles necesita el nombre de un alumno para
# esta tarjeta, solo el horario, la fecha y los cuatro conteos.
@router.get(
    "/ultimas-listas",
    response_model=List[UltimaListaDTO],
    dependencies=[Depends(GestorPermisos(["ADMINISTRADOR", "ENTRENADOR"]))],
)
async def listar_ultimas_listas(
    limit: int = Query(default=5, ge=1, le=20),
    db: Session = Depends(obtener_sesion),
):
    return AsistenciaServicio(db).listar_ultimas_listas(limit)


# --- Asignación directa Alumno ↔ Categoria (todos sus horarios) ------------
# El club inscribe por mes completo, nunca por día suelto: `horario_id` en el
# body solo ancla la categoria, y el servicio inscribe al alumno en TODOS los
# horarios vigentes de esa categoria en una única transacción. Por eso la
# respuesta es una lista (una fila por horario) y no un único DTO.
@router.post(
    "/asignar-alumno",
    response_model=AsignacionAlumnoHorarioResponseDTO,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(GestorPermisos(["ADMINISTRADOR", "ENTRENADOR"]))],
)
async def asignar_alumno_a_horario(
    datos: AlumnoHorarioCreateDTO, db: Session = Depends(obtener_sesion)
):
    return AsistenciaServicio(db).asignar_alumno_a_horario(datos)


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


# SEC-1: roster completo del horario (nombre, edad y persona_id de cada
# alumno inscrito). Antes solo exigia token valido -- cualquier sesion
# autenticada (alumno, representante) podia enumerar esos datos de CUALQUIER
# horario. No hay ownership que aplicar aca (el recurso es un horario, no una
# persona) ni carve-out para el propio inscrito: el DTO expone tambien a los
# compañeros. Mismo gate que su hermano `desasignar_alumno_de_horario` (:170).
# Quien necesita "mis horarios" tiene `GET /asistencias/alumnos/{id}/horarios`
# (ownership-gated, sin cambios).
# Paginado (issue #7): la nómina de un horario crece con el padrón. Mismo
# contrato de `skip`/`limit` que `GET /personas/` (tope 200).
@router.get(
    "/horarios/{horario_id}/alumnos",
    response_model=PaginatedResponse[AlumnoHorarioDetalleDTO],
    dependencies=[Depends(GestorPermisos(["ADMINISTRADOR", "ENTRENADOR"]))],
)
async def listar_alumnos_por_horario(
    horario_id: int,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(obtener_sesion),
):
    items, total = AsistenciaServicio(db).listar_alumnos_por_horario(
        horario_id, skip=skip, limit=limit
    )
    return PaginatedResponse(items=items, total=total, skip=skip, limit=limit)


# TRA-7: roster de TODOS los horarios en una sola consulta -- reemplaza las
# 26 llamadas (una por horario, vía el endpoint de arriba) que /groups hacía
# para armar el conteo "N inscriptos" de cada categoría. Los horarios son un
# catálogo fijo (26 hoy, no crece con el padrón): esto consolida las
# consultas, no cambia cuántas filas viajan. Mismo gate que su hermano
# per-horario. Deliberadamente SIN paginar: el volumen agregado ya viajaba
# completo hoy, solo que repartido en 26 respuestas.
@router.get(
    "/horarios/alumnos",
    response_model=List[AlumnoHorarioDetalleDTO],
    dependencies=[Depends(GestorPermisos(["ADMINISTRADOR", "ENTRENADOR"]))],
)
async def listar_roster_de_todos_los_horarios(db: Session = Depends(obtener_sesion)):
    return AsistenciaServicio(db).listar_roster_de_todos_los_horarios()


# Los horarios asignados a un alumno dicen dónde está y a qué hora. El portal
# del alumno/representante lo consume con el `persona_id` seleccionado (ver
# `frontend/src/app/student/page.tsx`), que siempre es el propio o el de un
# representado: la política no le cambia nada al uso legítimo.
@router.get(
    "/alumnos/{persona_id}/horarios",
    response_model=List[AlumnoHorarioDetalleDTO],
    dependencies=[Depends(GestorAutenticacion.decodificar_token)],
)
async def listar_horarios_por_alumno(
    persona_id: int,
    token_payload: dict = Depends(GestorAutenticacion.decodificar_token),
    db: Session = Depends(obtener_sesion),
):
    PoliticaAccesoPersona(db).exigir_acceso(
        persona_id_objetivo=persona_id,
        persona_id_solicitante=token_payload.get("persona_id"),
        roles_solicitante=token_payload.get("roles", []),
        roles_privilegiados=ADMINISTRADOR_O_ENTRENADOR,
        mensaje="No puede consultar los horarios de otro alumno",
    )
    return AsistenciaServicio(db).listar_horarios_por_alumno(persona_id)
