from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.dominio.excepciones import OperacionInvalida
from app.dominio.modelos import AlumnoHorario, CategoriaHorario, HorarioEntrenamiento


class CategoriaRepositorio:
    """Lee y escribe `categoria_horario` (+ sus `categoria_horario_dia`) --
    la única fuente de la que `hora_inicio`/`hora_fin`/días permitidos se
    derivan.

    ABM del admin (docs/archive/fixes/24-abm-categorias.md): `crear_con_horarios`,
    `guardar_edicion` y `eliminar_con_horarios` son operaciones COMPUESTAS
    a propósito -- cada una hace UN solo `commit()` para la categoria y
    todo lo que cambia junto con ella (sus `categoria_horario_dia`, los
    `horario_entrenamiento` que crea/borra, y el `alumno_horario` que
    purga o backfillea). `AsistenciaServicio` es quien decide QUÉ armar
    (validaciones, bloqueo por historial); este repositorio solo garantiza
    que se aplique TODO junto o nada."""

    def __init__(self, db: Session):
        self.db = db

    def listar(self) -> List[CategoriaHorario]:
        stmt = select(CategoriaHorario).options(joinedload(CategoriaHorario.dias_permitidos))
        return list(self.db.execute(stmt).unique().scalars().all())

    def obtener_por_codigo(self, codigo: str) -> Optional[CategoriaHorario]:
        stmt = (
            select(CategoriaHorario)
            .options(joinedload(CategoriaHorario.dias_permitidos))
            .where(CategoriaHorario.codigo == codigo)
        )
        return self.db.execute(stmt).unique().scalar_one_or_none()

    def existe_codigo(self, codigo: str) -> bool:
        stmt = select(CategoriaHorario.codigo).where(CategoriaHorario.codigo == codigo)
        return self.db.execute(stmt).first() is not None

    def existe_label(self, label: str, excluir_codigo: Optional[str] = None) -> bool:
        stmt = select(CategoriaHorario.codigo).where(CategoriaHorario.label == label)
        if excluir_codigo is not None:
            stmt = stmt.where(CategoriaHorario.codigo != excluir_codigo)
        return self.db.execute(stmt).first() is not None

    def crear_con_horarios(
        self, categoria: CategoriaHorario, horarios: List[HorarioEntrenamiento],
    ) -> CategoriaHorario:
        """Alta atómica: la fila de categoria (con sus `dias_permitidos` ya
        colgados vía relationship) y un `horario_entrenamiento` por día, en
        UNA transacción -- nunca una categoria sin horarios ni un horario
        sin categoria a medio crear."""
        self.db.add(categoria)
        self.db.add_all(horarios)
        try:
            self.db.commit()
        except IntegrityError as error:
            self.db.rollback()
            raise OperacionInvalida(
                "No se pudo crear la categoría: revisá que el nombre no esté "
                "repetido.",
            ) from error
        self.db.refresh(categoria)
        return categoria

    def guardar_edicion(
        self,
        categoria: CategoriaHorario,
        horarios_nuevos: List[HorarioEntrenamiento],
        alumno_horario_nuevos: List[AlumnoHorario],
        horarios_a_borrar: List[HorarioEntrenamiento],
        alumno_horario_a_borrar: List[AlumnoHorario],
    ) -> CategoriaHorario:
        """Edición atómica: la categoria mutada (label/horas ya asignados
        por el caller), los `categoria_horario_dia` que cambiaron (vía la
        colección `categoria.dias_permitidos`, ya reconciliada por el
        caller -- cascade="all, delete-orphan" se encarga de esos deletes),
        los `horario_entrenamiento` nuevos (días agregados) y a borrar
        (días quitados, ya validados SIN asistencias por el caller), y el
        `alumno_horario` de backfill/purga que va con ellos. Todo en UNA
        transacción: si algo choca contra integridad referencial, se
        revierte completo -- ningún día queda a medio aplicar."""
        for a in alumno_horario_a_borrar:
            self.db.delete(a)
        for h in horarios_a_borrar:
            self.db.delete(h)
        self.db.add_all(horarios_nuevos)
        self.db.add_all(alumno_horario_nuevos)
        try:
            self.db.commit()
        except IntegrityError as error:
            self.db.rollback()
            raise OperacionInvalida(
                "No se pudo guardar la categoría: revisá que el nombre no "
                "esté repetido y que los días no se dupliquen.",
            ) from error
        self.db.refresh(categoria)
        return categoria

    def eliminar_con_horarios(
        self,
        categoria: CategoriaHorario,
        horarios: List[HorarioEntrenamiento],
        alumno_horario_a_borrar: List[AlumnoHorario],
    ) -> None:
        """Baja atómica de la categoria entera: purga el `alumno_horario`
        de cada horario, borra los horarios, y borra la categoria (sus
        `categoria_horario_dia` caen por cascade="all, delete-orphan"). El
        caller (`AsistenciaServicio.eliminar_categoria`) ya validó que
        NINGÚN horario tiene asistencias -- ver ese método."""
        for a in alumno_horario_a_borrar:
            self.db.delete(a)
        for h in horarios:
            self.db.delete(h)
        self.db.delete(categoria)
        try:
            self.db.commit()
        except IntegrityError as error:
            self.db.rollback()
            raise OperacionInvalida(
                f'No se puede eliminar la categoría "{categoria.label}" '
                "porque tiene registros asociados.",
            ) from error
