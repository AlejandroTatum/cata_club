from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import List

from app.infraestructura.db import obtener_sesion
from app.seguridad.gestor_auth import GestorAutenticacion
from app.servicios_negocio.gestor_permisos import GestorPermisos
from app.servicios_negocio.politica_acceso import (
    ADMINISTRADOR_O_ENTRENADOR, PoliticaAccesoPersona,
)
from app.servicios_negocio.ranking_servicio import (
    NivelRankingServicio, RankingServicio, NotificacionServicio,
)
from app.presentacion.schemas.base import PaginatedResponse
from app.presentacion.schemas.ranking_schemas import (
    NivelRankingCreateDTO, NivelRankingResponseDTO, NivelRankingConOcupacionDTO,
    TablaRankingItemDTO, PerfilRankingAlumnoDTO, NotificacionResponseDTO,
    AsignacionRankingResponseDTO, AlumnoConNivelDTO,
)

router = APIRouter(prefix="/ranking", tags=["ranking"])

ROL_ADMIN = ["ADMINISTRADOR"]
ROL_ADMIN_O_ENTRENADOR = ["ADMINISTRADOR", "ENTRENADOR"]


# --- Niveles de ranking (E03-RF001) -----------------------------------------
@router.post(
    "/niveles", response_model=NivelRankingResponseDTO, status_code=201,
    dependencies=[Depends(GestorPermisos(ROL_ADMIN))],
)
async def crear_nivel(datos: NivelRankingCreateDTO, db: Session = Depends(obtener_sesion)):
    return NivelRankingServicio(db).crear_nivel(datos)


@router.get(
    "/niveles", response_model=List[NivelRankingConOcupacionDTO],
    dependencies=[Depends(GestorAutenticacion.decodificar_token)],
)
async def listar_niveles(db: Session = Depends(obtener_sesion)):
    return NivelRankingServicio(db).listar_niveles_con_ocupacion()


# Paginado (issue #7): este listado crece con el padrón. Mismo contrato de
# `skip`/`limit` que `GET /personas/` y `GET /membresias/pagos` (tope 200).
@router.get(
    "/asignaciones", response_model=PaginatedResponse[AsignacionRankingResponseDTO],
    dependencies=[Depends(GestorPermisos(ROL_ADMIN_O_ENTRENADOR))],
)
async def listar_asignaciones(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(obtener_sesion),
):
    """Listado paginado de los alumnos en el ranking (con su nivel)."""
    items, total = RankingServicio(db).listar_asignaciones(skip=skip, limit=limit)
    return PaginatedResponse(items=items, total=total, skip=skip, limit=limit)


# Roster mínimo para la pantalla de asignación de nivel (admin `/ranking` y
# entrenador `/trainer/nivel`). El frontend lo pedía a `GET /personas/`, que es
# ADMINISTRADOR-only por exponer PII -> el entrenador recibía un 403 real y la
# página nunca cargaba. `AlumnoConNivelDTO` no expone PII, así que el permiso
# puede ser el mismo que ya tiene la mutación de esta pantalla
# (`PATCH /personas/{persona_id}/nivel`).
@router.get(
    "/alumnos-con-nivel", response_model=PaginatedResponse[AlumnoConNivelDTO],
    dependencies=[Depends(GestorPermisos(ROL_ADMIN_O_ENTRENADOR))],
)
async def listar_alumnos_con_nivel(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(obtener_sesion),
):
    """Página de alumnos con su nivel_ranking_id actual — accesible para
    ADMINISTRADOR y ENTRENADOR. Reemplaza la dependencia del panel de nivel
    con /personas/ (solo admin), que dejaba al entrenador sin acceso.
    Paginado (issue #7): con ~2000 alumnos la lista completa degradaba."""
    items, total = RankingServicio(db).listar_alumnos_con_nivel(skip=skip, limit=limit)
    return PaginatedResponse(items=items, total=total, skip=skip, limit=limit)


@router.get(
    "/niveles/{nivel_id}/tabla", response_model=List[TablaRankingItemDTO],
    dependencies=[Depends(GestorAutenticacion.decodificar_token)],
)
async def obtener_tabla_de_nivel(nivel_id: int, db: Session = Depends(obtener_sesion)):
    """E03-RF010: tabla de posiciones de un nivel."""
    return RankingServicio(db).obtener_tabla_de_nivel(nivel_id)


# --- Asignación de nivel (E03-RF002) ----------------------------------------
# Vive en `personas_router` (`PATCH /personas/{persona_id}/nivel`), no acá:
# es UNA operación idempotente sobre una persona, no dos endpoints (uno de
# alta y otro de movimiento) que obligaban a la UI a saber si el alumno ya
# tenía nivel. La lógica sigue siendo de este módulo -- ese router llama a
# `RankingServicio.asignar_nivel`, no la duplica.


# --- Perfil privado del alumno (E04-RF012) ----------------------------------
@router.get(
    "/{persona_id}/perfil", response_model=PerfilRankingAlumnoDTO,
    dependencies=[Depends(GestorAutenticacion.decodificar_token)],
)
async def obtener_perfil_alumno(
    persona_id: int,
    db: Session = Depends(obtener_sesion),
    token_payload: dict = Depends(GestorAutenticacion.decodificar_token),
):
    """Consulta privada: solo el propio alumno, su representante, o un
    ADMINISTRADOR/ENTRENADOR pueden verla.

    El criterio no cambió: antes estaba escrito a mano acá, ahora lo resuelve
    `PoliticaAccesoPersona` -- la misma regla única que usan personas,
    asistencias, pagos y ficha médica. `incluir_titular` queda en su default
    (`True`) porque este endpoint SÍ deja al propio alumno ver su perfil, y
    `roles_privilegiados` se pasa explícito para conservar al ENTRENADOR."""
    PoliticaAccesoPersona(db).exigir_acceso(
        persona_id_objetivo=persona_id,
        persona_id_solicitante=token_payload.get("persona_id"),
        roles_solicitante=token_payload.get("roles"),
        roles_privilegiados=ADMINISTRADOR_O_ENTRENADOR,
        mensaje="No puede consultar el perfil de ranking de otra persona",
    )
    return RankingServicio(db).obtener_perfil_alumno(persona_id)


# --- Notificaciones in-app ---------------------------------------------------
@router.get(
    "/notificaciones/mias", response_model=List[NotificacionResponseDTO],
    dependencies=[Depends(GestorAutenticacion.decodificar_token)],
)
async def listar_mis_notificaciones(
    db: Session = Depends(obtener_sesion),
    token_payload: dict = Depends(GestorAutenticacion.decodificar_token),
):
    persona_id = token_payload.get("persona_id")
    roles = token_payload.get("roles", [])
    servicio = NotificacionServicio(db)
    if "REPRESENTANTE" in roles:
        return servicio.listar_para_persona_y_hijos(persona_id)
    return servicio.listar_propias(persona_id)


@router.patch(
    "/notificaciones/{notificacion_id}/leer", response_model=NotificacionResponseDTO,
    dependencies=[Depends(GestorAutenticacion.decodificar_token)],
)
async def marcar_notificacion_leida(
    notificacion_id: int,
    db: Session = Depends(obtener_sesion),
    token_payload: dict = Depends(GestorAutenticacion.decodificar_token),
):
    return NotificacionServicio(db).marcar_leida(notificacion_id, token_payload.get("persona_id"))
