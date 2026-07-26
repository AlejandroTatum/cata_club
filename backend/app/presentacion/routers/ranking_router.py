from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import List

from app.infraestructura.db import obtener_sesion
from app.seguridad.gestor_auth import GestorAutenticacion
from app.servicios_negocio.gestor_permisos import GestorPermisos
from app.servicios_negocio.ranking_servicio import (
    NivelRankingServicio, RankingServicio, NotificacionServicio,
)
from app.presentacion.schemas.ranking_schemas import (
    NivelRankingCreateDTO, NivelRankingResponseDTO, NivelRankingConOcupacionDTO,
    AsignarNivelInicialDTO, RankingResponseDTO, TablaRankingItemDTO,
    PerfilRankingAlumnoDTO, NotificacionResponseDTO, AsignacionRankingResponseDTO,
    AlumnoConNivelDTO,
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


@router.get(
    "/asignaciones", response_model=List[AsignacionRankingResponseDTO],
    dependencies=[Depends(GestorPermisos(ROL_ADMIN_O_ENTRENADOR))],
)
async def listar_asignaciones(db: Session = Depends(obtener_sesion)):
    """Listado de todos los alumnos en el ranking (con su nivel y posición)."""
    return RankingServicio(db).listar_asignaciones()


# Roster mínimo para la pantalla de asignación de nivel (admin `/ranking` y
# entrenador `/trainer/nivel`). El frontend lo pedía a `GET /personas/`, que es
# ADMINISTRADOR-only por exponer PII -> el entrenador recibía un 403 real y la
# página nunca cargaba. `AlumnoConNivelDTO` no expone PII, así que el permiso
# puede ser el mismo que ya tienen las dos mutaciones de esta pantalla
# (`asignar-nivel-inicial` y `mover-de-nivel`).
@router.get(
    "/alumnos-con-nivel", response_model=List[AlumnoConNivelDTO],
    dependencies=[Depends(GestorPermisos(ROL_ADMIN_O_ENTRENADOR))],
)
async def listar_alumnos_con_nivel(db: Session = Depends(obtener_sesion)):
    """Lista ligera de alumnos con su nivel_ranking_id actual — accesible para
    ADMINISTRADOR y ENTRENADOR. Reemplaza la dependencia del panel de nivel
    con /personas/ (solo admin), que lasciaba al entrenador sin acceso."""
    return RankingServicio(db).listar_alumnos_con_nivel()


@router.get(
    "/niveles/{nivel_id}/tabla", response_model=List[TablaRankingItemDTO],
    dependencies=[Depends(GestorAutenticacion.decodificar_token)],
)
async def obtener_tabla_de_nivel(nivel_id: int, db: Session = Depends(obtener_sesion)):
    """E03-RF010: tabla de posiciones de un nivel."""
    return RankingServicio(db).obtener_tabla_de_nivel(nivel_id)


# --- Asignación de nivel inicial (E03-RF002) --------------------------------
@router.post(
    "/asignar-nivel-inicial", response_model=RankingResponseDTO, status_code=201,
    dependencies=[Depends(GestorPermisos(ROL_ADMIN_O_ENTRENADOR))],
)
async def asignar_nivel_inicial(datos: AsignarNivelInicialDTO, db: Session = Depends(obtener_sesion)):
    return RankingServicio(db).asignar_nivel_inicial(datos)


@router.patch(
    "/{persona_id}/mover-de-nivel", response_model=RankingResponseDTO,
    dependencies=[Depends(GestorPermisos(ROL_ADMIN_O_ENTRENADOR))],
)
async def mover_de_nivel(persona_id: int, nuevo_nivel_id: int, db: Session = Depends(obtener_sesion)):
    """Aplica manualmente un ascenso/descenso decidido por el
    Entrenador/Administrador."""
    return RankingServicio(db).mover_de_nivel(persona_id, nuevo_nivel_id)


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
    ADMINISTRADOR/ENTRENADOR pueden verla."""
    roles = token_payload.get("roles", [])
    solicitante_id = token_payload.get("persona_id")
    es_propio = solicitante_id == persona_id
    if not es_propio and not any(r in ROL_ADMIN_O_ENTRENADOR for r in roles):
        from app.dominio.excepciones import PermisosInsuficientes
        from app.infraestructura.repositorios.persona_repositorio import PersonaRepositorio
        persona_objetivo = PersonaRepositorio(db).obtener_por_id(persona_id)
        es_representante = (
            persona_objetivo is not None
            and persona_objetivo.representante_id == solicitante_id
        )
        if not es_representante:
            raise PermisosInsuficientes("No puede consultar el perfil de ranking de otra persona")
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
