from pydantic import BaseModel
from datetime import date, time, datetime
from typing import Optional

from app.dominio.enums import EstadoAsistencia, DiaSemana
from app.presentacion.schemas.base import ResponseBase


class HorarioCreateDTO(BaseModel):
    dia_semana: DiaSemana
    hora_inicio: time
    hora_fin: time
    entrenador_id: int


class HorarioResponseDTO(ResponseBase, HorarioCreateDTO):
    id: int
    # Additive, response-only: el modelo ya tiene esta FK (nullable) pero
    # HorarioCreateDTO no la acepta -- crear/editar el vínculo queda fuera de
    # alcance (ver design "Schedule→group linkage"). Solo se expone para que
    # el frontend derive el roster de un horario ya ligado a un nivel.
    nivel_ranking_id: Optional[int] = None


class AsistenciaCreateDTO(BaseModel):
    fecha_entrenamiento: date
    estado: EstadoAsistencia
    justificativo: Optional[str] = None
    estado_justificativo: Optional[bool] = None
    persona_id: int
    entrenador_id: int
    horario_id: int


class AsistenciaResponseDTO(ResponseBase, BaseModel):
    id: int
    fecha_entrenamiento: date
    fecha_registro: datetime
    estado: EstadoAsistencia
    justificativo: Optional[str] = None
    estado_justificativo: Optional[bool] = None
    persona_id: int
    entrenador_id: int
    horario_id: int
