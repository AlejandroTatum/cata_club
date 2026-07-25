"""
Schemas del módulo de Ranking (E03), agregado en la integración con el
frontend. El "nivel de ranking" reemplaza al concepto de "Grupo" que se
había explorado del lado frontend: aquí un nivel ES el grupo de
entrenamiento (confirmado con el equipo), no dos cosas separadas.
"""
from pydantic import BaseModel, Field, computed_field
from datetime import datetime
from typing import Optional

from app.dominio.enums import TipoNotificacion
from app.presentacion.schemas.base import ResponseBase


# --- NivelRanking (E03-RF001) ------------------------------------------------
class NivelRankingCreateDTO(BaseModel):
    numero_nivel: int = Field(..., ge=1)
    nombre: Optional[str] = Field(default=None, max_length=80)


class NivelRankingResponseDTO(ResponseBase, BaseModel):
    id: int
    numero_nivel: int
    nombre: Optional[str] = None
    capacidad_minima: int
    capacidad_maxima: int

    @computed_field
    @property
    def nivel_categoria(self) -> str:
        """Categoría agrupada para el frontend: 1-3 avanzado (mejor nivel), 4-6 intermedio, 7-10 principiante."""
        if self.numero_nivel <= 3:
            return "avanzado"
        elif self.numero_nivel <= 6:
            return "intermedio"
        return "principiante"


class NivelRankingConOcupacionDTO(NivelRankingResponseDTO):
    """Igual a NivelRankingResponseDTO, agregando la ocupación actual para
    que el Administrador vea de un vistazo si un nivel necesita rebalanceo
    (RF001 exige un mínimo de 6, que aquí NO se bloquea de forma dura -- ver
    docstring de NivelRanking en modelos.py -- pero sí se informa)."""
    personas_actuales: int
    cupos_disponibles: int
    necesita_revision: bool  # True si personas_actuales < capacidad_minima


# --- Asignación de nivel inicial (E03-RF002) --------------------------------
class AsignarNivelInicialDTO(BaseModel):
    persona_id: int
    nivel_ranking_id: int


# --- Ranking (fila por persona) ---------------------------------------------
class RankingResponseDTO(ResponseBase, BaseModel):
    """Response de asignar-nivel-inicial/mover-de-nivel.

    `puntaje_acumulado` y `posicion_actual` quedan congelados (el cierre
    mensual RF007 era su único escritor, removido en slice B2 de
    `limpieza-asistencia-y-nivel-entrenador`). Se mantienen acá solo por
    compatibilidad de shape con estos dos endpoints; ningún consumidor del
    frontend los lee. Los DTOs de solo-lectura del ranking
    (`TablaRankingItemDTO`, `PerfilRankingAlumnoDTO`,
    `AsignacionRankingResponseDTO`) ya no los exponen.
    """

    id: int = Field(..., examples=[1])
    persona_id: int = Field(..., examples=[1])
    puntaje_acumulado: int = Field(..., examples=[150])
    posicion_actual: Optional[int] = Field(default=None, examples=[1])
    participo: bool = Field(..., examples=[True])
    esta_en_ranking: bool = Field(..., examples=[True])
    nivel_ranking_id: Optional[int] = Field(default=None, examples=[2])


class TablaRankingItemDTO(ResponseBase, BaseModel):
    """Fila del roster de un nivel: identificación del alumno + su estado de
    ranking, sin exponer el resto del Ranking. Ya NO expone
    `posicion_actual`/`puntaje_acumulado`: quedaron congelados para siempre
    tras remover `cerrar_mes()` (único escritor, slice B2) -- mostrarlos
    seguía siendo un dato "vivo" falso. Este endpoint sigue existiendo porque
    también es el roster que usa la asistencia del entrenador y el mapeo de
    miembros (ver apply-progress de `limpieza-asistencia-y-nivel-entrenador`
    slice E)."""
    persona_id: int
    persona_nombre_completo: str
    esta_en_ranking: bool


# --- Perfil del alumno (E04-RF012) ------------------------------------------
class PerfilRankingAlumnoDTO(ResponseBase, BaseModel):
    """Ya NO expone `posicion_actual`/`puntaje_acumulado` (frozen forever
    sin escritor desde que se removió `cerrar_mes()`, slice B2) -- ver
    slice E."""
    persona_id: int
    nivel_ranking_id: Optional[int] = None
    nivel_ranking_nombre: Optional[str] = None
    esta_en_ranking: bool


# --- Notificaciones -----------------------------------------------------------
class NotificacionResponseDTO(ResponseBase, BaseModel):
    id: int
    tipo: TipoNotificacion
    mensaje: str
    leida: bool
    fecha_creacion: datetime
    entidad_relacionada_id: Optional[int] = None


# --- Listados para frontend (Phase 1) ----------------------------------------
class AsignacionRankingResponseDTO(ResponseBase, BaseModel):
    """Fila de un alumno en el ranking (para listado de asignaciones). Ya NO
    expone `posicion_actual`/`puntaje_acumulado` -- ver slice E."""
    persona_id: int
    persona_nombre_completo: str
    nivel_ranking_id: int
    nivel_ranking_nombre: Optional[str] = None
    nivel_ranking_numero: int
    esta_en_ranking: bool


class AlumnoConNivelDTO(ResponseBase, BaseModel):
    """Listado ligero de alumnos con su nivel_ranking_id (o null si no tienen).
    Accesible para ADMINISTRADOR y ENTRENADOR. Reemplaza el /personas/ (solo
    admin) que la página /trainer/nivel no podía consumir."""
    persona_id: int
    nombres: str
    apellidos: str
    nivel_ranking_id: Optional[int] = None
