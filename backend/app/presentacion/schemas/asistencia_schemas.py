from pydantic import BaseModel
from datetime import date, time, datetime
from typing import Optional

from app.dominio.enums import EstadoAsistencia, DiaSemana, Categoria
from app.presentacion.schemas.base import ResponseBase


class HorarioCreateDTO(BaseModel):
    """`hora_inicio`/`hora_fin` NO son campos de entrada: el servicio los
    deriva server-side de la fila `categoria_horario` de `categoria` para
    que el contrato nunca pueda desviarse de los horarios fijos de negocio.

    Sin `entrenador_id`: el club no asigna entrenadores a horarios -- la
    clase la da el entrenador disponible (issue #13,
    docs/concepto-alcance-modelo.md §4)."""
    categoria: Categoria
    dia_semana: DiaSemana


class HorarioUpdateDTO(BaseModel):
    categoria: Optional[Categoria] = None
    dia_semana: Optional[DiaSemana] = None


class HorarioResponseDTO(ResponseBase, HorarioCreateDTO):
    id: int
    hora_inicio: time
    hora_fin: time


class CategoriaResponseDTO(ResponseBase, BaseModel):
    """Una fila de `categoria_horario`: el frontend la consulta acá en vez
    de espejarla a mano (ver `frontend/src/services/categorias.ts`)."""
    codigo: str
    label: str
    hora_inicio: time
    hora_fin: time
    dias: list[DiaSemana]


class AsistenciaCreateDTO(BaseModel):
    fecha_entrenamiento: date
    estado: EstadoAsistencia
    justificativo: Optional[str] = None
    estado_justificativo: Optional[bool] = None
    persona_id: int
    horario_id: int


class AsistenciaResponseDTO(ResponseBase, BaseModel):
    id: int
    fecha_entrenamiento: date
    fecha_registro: datetime
    estado: EstadoAsistencia
    justificativo: Optional[str] = None
    estado_justificativo: Optional[bool] = None
    persona_id: int
    horario_id: int


# --- Asignación directa Alumno ↔ Horario ------------------------------------
class AlumnoHorarioCreateDTO(BaseModel):
    persona_id: int
    horario_id: int


class AlumnoHorarioResponseDTO(ResponseBase, BaseModel):
    id: int
    persona_id: int
    horario_id: int
    fecha_asignacion: datetime


class UltimaListaDTO(ResponseBase, BaseModel):
    """Una sesión (horario + fecha) con al menos una Asistencia registrada,
    con sus cuatro conteos. Sin autor a propósito: `Asistencia` no guarda
    quién tomó la lista (modelos.py:536, deliberado) -- ver
    decisiones-de-negocio-2026-08-11.md §8. Usada por el panel del
    entrenador para "las últimas listas del club"."""
    horario_id: int
    fecha_entrenamiento: date
    dia_semana: DiaSemana
    hora_inicio: time
    hora_fin: time
    presentes: int
    tardanzas: int
    justificados: int
    ausentes: int
    total: int


class AlumnoHorarioDetalleDTO(ResponseBase, BaseModel):
    """DTO con información de persona y horario para listados."""
    id: int
    persona_id: int
    persona_nombre_completo: str
    edad: int
    horario_id: int
    horario_dia: DiaSemana
    horario_hora_inicio: time
    horario_hora_fin: time
    fecha_asignacion: datetime
