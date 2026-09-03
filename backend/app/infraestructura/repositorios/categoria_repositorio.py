from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.dominio.modelos import AlumnoHorario, CategoriaHorario, HorarioEntrenamiento


class CategoriaRepositorio:
    """Lee y escribe `categoria_horario` (+ sus `categoria_horario_dia`) --
    la única fuente de la que `hora_inicio`/`hora_fin`/días permitidos se
    derivan.

    ABM del admin (docs/archive/fixes/24-abm-categorias.md): `crear_con_horarios`,
    `guardar_edicion` y `eliminar_con_horarios` son operaciones COMPUESTAS
    a propósito -- cada una hace UN solo `flush()` para la categoria y
    todo lo que cambia junto con ella (sus `categoria_horario_dia`, los
    `horario_entrenamiento` que crea/borra, y el `alumno_horario` que
    purga o backfillea). `AsistenciaServicio` es quien decide QUÉ armar
    (validaciones, bloqueo por historial) Y quién comitea, en UN solo
    `commit()` de caso de uso (issue #831): este repositorio solo garantiza
    que se aplique TODO junto o nada dentro de esa transacción.

    Antes (issue original de este método) cada una de las tres atrapaba su
    propio `IntegrityError` y hacía `rollback()` acá adentro -- un
    "transaction script" a nivel de repositorio que, dentro de un caso de
    uso más grande, revertiría trabajo YA flusheado por OTRO repositorio.
    Ninguna de las tres ramas tiene cobertura de test (son una red de
    seguridad ante una carrera que las validaciones de `AsistenciaServicio`
    ya descartan en el camino normal); se retira la traducción a
    `OperacionInvalida` y se deja propagar el `IntegrityError` crudo -- el
    caso de uso o el cierre de la sesión revierten la transacción."""

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
        self.db.flush()
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
        self.db.flush()
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
        self.db.flush()
