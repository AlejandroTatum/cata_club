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


class AsignacionAlumnoHorarioResponseDTO(ResponseBase, BaseModel):
    """Respuesta de `POST /asignar-alumno`.

    INS-6 (decisión de negocio #4, 2026-08-11): la cuota vencida NO bloquea
    la asignación -- se asigna igual, y esta respuesta lleva el aviso NO
    BLOQUEANTE que el admin ve. Deliberadamente un DTO propio y no un campo
    agregado a `AlumnoHorarioDetalleDTO`: ese DTO también lo usan
    `listar_alumnos_por_horario`/`listar_horarios_por_alumno` (listados de
    roster), y sumarle ahí una consulta de membresía por fila sería un N+1
    en endpoints que este fix no toca. El dato es plano (booleano + días) a
    propósito: la oración en castellano ("Ariana tiene la cuota vencida
    hace 14 días") la arma el frontend, que ya conoce el nombre del alumno."""
    asignaciones: list[AlumnoHorarioDetalleDTO]
    membresia_vencida: bool
    dias_vencida: Optional[int] = None
