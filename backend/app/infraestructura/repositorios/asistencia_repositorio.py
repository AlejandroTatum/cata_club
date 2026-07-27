from datetime import date
from typing import Optional, List
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.dominio.modelos import Asistencia, HorarioEntrenamiento, AlumnoHorario
from app.dominio.enums import Categoria
from app.infraestructura.repositorios.eliminacion_segura import eliminar_o_error_de_dominio


class HorarioRepositorio:
    def __init__(self, db: Session):
        self.db = db

    def obtener_por_id(self, horario_id: int) -> Optional[HorarioEntrenamiento]:
        return self.db.get(HorarioEntrenamiento, horario_id)

    def listar(self, categoria: Optional[Categoria] = None) -> List[HorarioEntrenamiento]:
        stmt = (
            select(HorarioEntrenamiento)
            .options(joinedload(HorarioEntrenamiento.entrenador))
        )
        if categoria is not None:
            stmt = stmt.where(HorarioEntrenamiento.categoria == categoria)
        return list(self.db.execute(stmt).scalars().unique().all())

    def crear(self, horario: HorarioEntrenamiento) -> HorarioEntrenamiento:
        self.db.add(horario)
        self.db.commit()
        self.db.refresh(horario)
        return horario

    def actualizar(self, horario: HorarioEntrenamiento) -> HorarioEntrenamiento:
        self.db.commit()
        self.db.refresh(horario)
        return horario

    def eliminar(self, horario: HorarioEntrenamiento) -> None:
        eliminar_o_error_de_dominio(
            self.db, horario,
            "No se puede eliminar este horario porque tiene asistencias "
            "registradas o alumnos asignados. Elimina esos registros primero.",
        )


class AsistenciaRepositorio:
    def __init__(self, db: Session):
        self.db = db

    def crear(self, asistencia: Asistencia) -> Asistencia:
        self.db.add(asistencia)
        self.db.commit()
        self.db.refresh(asistencia)
        return asistencia

    def actualizar(self, asistencia: Asistencia) -> Asistencia:
        self.db.commit()
        self.db.refresh(asistencia)
        return asistencia

    def buscar_por_persona_horario_fecha(
        self, persona_id: int, horario_id: int, fecha_entrenamiento: date
    ) -> Optional[Asistencia]:
        """Busca un registro de Asistencia ya existente para la misma
        combinación (persona, horario, fecha) -- usado para convertir
        `registrar_asistencia` en un upsert y evitar duplicados cuando se
        re-registra la asistencia de una sesión ya tomada."""
        stmt = select(Asistencia).where(
            Asistencia.persona_id == persona_id,
            Asistencia.horario_id == horario_id,
            Asistencia.fecha_entrenamiento == fecha_entrenamiento,
        )
        return self.db.execute(stmt).scalars().first()

    def listar_por_persona(self, persona_id: int) -> List[Asistencia]:
        stmt = (
            select(Asistencia)
            .options(
                joinedload(Asistencia.persona),
                joinedload(Asistencia.entrenador),
                joinedload(Asistencia.horario),
            )
            .where(Asistencia.persona_id == persona_id)
        )
        return list(self.db.execute(stmt).scalars().all())

    def listar_reporte(
        self,
        horario_id: Optional[int] = None,
        persona_id: Optional[int] = None,
        fecha_inicio=None,
        fecha_fin=None,
    ) -> List[Asistencia]:
        """E02-RF005: reporte de asistencia por horario, periodo o alumno.
        Los tres filtros son opcionales y combinables."""
        query = self.db.query(Asistencia).options(
            joinedload(Asistencia.persona),
            joinedload(Asistencia.entrenador),
            joinedload(Asistencia.horario),
        )
        if horario_id is not None:
            query = query.filter(Asistencia.horario_id == horario_id)
        if persona_id is not None:
            query = query.filter(Asistencia.persona_id == persona_id)
        if fecha_inicio is not None:
            query = query.filter(Asistencia.fecha_entrenamiento >= fecha_inicio)
        if fecha_fin is not None:
            query = query.filter(Asistencia.fecha_entrenamiento <= fecha_fin)
        return query.order_by(Asistencia.fecha_entrenamiento.desc()).all()


class AlumnoHorarioRepositorio:
    def __init__(self, db: Session):
        self.db = db

    def crear(self, alumno_horario: AlumnoHorario) -> AlumnoHorario:
        self.db.add(alumno_horario)
        self.db.commit()
        self.db.refresh(alumno_horario)
        return alumno_horario

    def eliminar(self, alumno_horario: AlumnoHorario) -> None:
        self.db.delete(alumno_horario)
        self.db.commit()

    def obtener_por_persona_y_horario(
        self, persona_id: int, horario_id: int
    ) -> Optional[AlumnoHorario]:
        stmt = select(AlumnoHorario).where(
            AlumnoHorario.persona_id == persona_id,
            AlumnoHorario.horario_id == horario_id,
        )
        return self.db.execute(stmt).scalars().first()

    def listar_por_horario(self, horario_id: int) -> List[AlumnoHorario]:
        stmt = (
            select(AlumnoHorario)
            .options(joinedload(AlumnoHorario.persona))
            .where(AlumnoHorario.horario_id == horario_id)
        )
        return list(self.db.execute(stmt).scalars().unique().all())

    def listar_por_persona(self, persona_id: int) -> List[AlumnoHorario]:
        stmt = (
            select(AlumnoHorario)
            .options(joinedload(AlumnoHorario.horario))
            .where(AlumnoHorario.persona_id == persona_id)
        )
        return list(self.db.execute(stmt).scalars().unique().all())


