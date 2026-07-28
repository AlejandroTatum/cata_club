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


# --- Asignación de nivel (E03-RF002) ----------------------------------------
class AsignarNivelDTO(BaseModel):
    """Cuerpo de `PATCH /personas/{persona_id}/nivel`: el nivel al que va el
    alumno, y nada más. La persona viaja en la URL, no en el cuerpo.

    `None` NO es "no me dijeron nada": es el estado "sin nivel". Es la única
    forma que existe de desasignar a un alumno -- antes no había ninguna,
    porque el endpoint de movimiento exigía un destino.

    Por eso el campo es obligatorio aunque admita `None` (`Field(...)`):
    mandar `{}` no es "dejalo como está", es un cuerpo incompleto."""
    nivel_ranking_id: Optional[int] = Field(...)


# --- Ranking (fila por persona) ---------------------------------------------
class RankingResponseDTO(ResponseBase, BaseModel):
    """Response de `PATCH /personas/{persona_id}/nivel`.

    Solo lleva la identidad de la fila y el nivel asignado: los campos del
    ranking competitivo (`puntaje_acumulado`, `posicion_actual`, `participo`,
    `esta_en_ranking`) fueron eliminados junto con sus columnas.
    """

    id: int = Field(..., examples=[1])
    persona_id: int = Field(..., examples=[1])
    nivel_ranking_id: Optional[int] = Field(default=None, examples=[2])


class TablaRankingItemDTO(ResponseBase, BaseModel):
    """Fila del roster de un nivel: identificación del alumno, sin exponer el
    resto del Ranking. Ya NO expone `posicion_actual`/`puntaje_acumulado`
    (congelados sin escritor tras remover `cerrar_mes()`) ni
    `esta_en_ranking` (eliminado: pertenecer al roster de un nivel ya es la
    respuesta). Este endpoint sigue existiendo porque también es el roster
    que usa la asistencia del entrenador y el mapeo de miembros (ver
    apply-progress de `limpieza-asistencia-y-nivel-entrenador` slice E)."""
    persona_id: int
    persona_nombre_completo: str


# --- Perfil del alumno (E04-RF012) ------------------------------------------
class PerfilRankingAlumnoDTO(ResponseBase, BaseModel):
    """Ya NO expone `posicion_actual`/`puntaje_acumulado` (frozen forever
    sin escritor desde que se removió `cerrar_mes()`, slice B2) ni
    `esta_en_ranking` (eliminado). `nivel_ranking_id` en null es el estado
    "sin nivel asignado": es el único dato que distingue a un alumno
    asignado de uno que todavía no lo está."""
    persona_id: int
    nivel_ranking_id: Optional[int] = None
    nivel_ranking_nombre: Optional[str] = None


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
    expone `posicion_actual`/`puntaje_acumulado` -- ver slice E -- ni
    `esta_en_ranking` (eliminado)."""
    persona_id: int
    persona_nombre_completo: str
    nivel_ranking_id: int
    nivel_ranking_nombre: Optional[str] = None
    nivel_ranking_numero: int


class AlumnoConNivelDTO(ResponseBase, BaseModel):
    """Listado ligero de alumnos con su nivel_ranking_id (o null si no tienen).
    Accesible para ADMINISTRADOR y ENTRENADOR. Reemplaza el /personas/ (solo
    admin) que la página /trainer/nivel no podía consumir."""
    persona_id: int
    nombres: str
    apellidos: str
    nivel_ranking_id: Optional[int] = None
