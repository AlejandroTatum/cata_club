from datetime import date
from typing import Optional, List
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.dominio.modelos import Asistencia, HorarioEntrenamiento, AlumnoHorario, Persona
from app.infraestructura.repositorios.eliminacion_segura import eliminar_o_error_de_dominio


class HorarioRepositorio:
    def __init__(self, db: Session):
        self.db = db

    def obtener_por_id(self, horario_id: int) -> Optional[HorarioEntrenamiento]:
        return self.db.get(HorarioEntrenamiento, horario_id)

    def listar(self, categoria: Optional[str] = None) -> List[HorarioEntrenamiento]:
        stmt = select(HorarioEntrenamiento)
        if categoria is not None:
            stmt = stmt.where(HorarioEntrenamiento.categoria == categoria)
        return list(self.db.execute(stmt).scalars().unique().all())

    def tiene_asistencias(self, horario_id: int) -> bool:
        """¿Tiene este horario algún registro de `Asistencia`? Usado por
        `AsistenciaServicio.actualizar_categoria`/`eliminar_categoria` para
        bloquear -- ANTES de tocar nada -- quitar un día o borrar una
        categoria entera cuando hay historial: "no se borra historial" es
        la decisión (docs/archive/fixes/24-abm-categorias.md), y chequear antes
        evita depender de parsear un `IntegrityError` de un DELETE en lote
        para saber CUÁL día bloqueó."""
        stmt = select(Asistencia.id).where(Asistencia.horario_id == horario_id)
        return self.db.execute(stmt).first() is not None

    def existe_categoria_dia(self, categoria: str, dia_semana) -> bool:
        """INS-3: ¿ya hay una fila para este (categoria, dia_semana)? Usado
        por `AsistenciaServicio.crear_horario` para rechazar el duplicado
        con un mensaje legible ANTES de que lo haga el UNIQUE de la base
        (`uq_horario_categoria_dia`, migración `b7e4a9f2c6d1`)."""
        stmt = select(HorarioEntrenamiento.id).where(
            HorarioEntrenamiento.categoria == categoria,
            HorarioEntrenamiento.dia_semana == dia_semana,
        )
        return self.db.execute(stmt).first() is not None

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

    def listar_por_persona(
        self, persona_id: int, skip: int = 0, limit: Optional[int] = None
    ) -> List[Asistencia]:
        # Más reciente primero, con el id de desempate para que el orden sea
        # TOTAL -- lo que hace determinista al OFFSET/LIMIT (issue #7, mismo
        # criterio que `MembresiaRepositorio.listar`).
        stmt = (
            select(Asistencia)
            .options(
                joinedload(Asistencia.persona),
                joinedload(Asistencia.horario),
            )
            .where(Asistencia.persona_id == persona_id)
            .order_by(Asistencia.fecha_entrenamiento.desc(), Asistencia.id.desc())
            .offset(skip)
        )
        if limit is not None:
            stmt = stmt.limit(limit)
        return list(self.db.execute(stmt).scalars().all())

    def contar_por_persona(self, persona_id: int) -> int:
        """Total del historial de ESA persona -- mismo filtro que
        `listar_por_persona`, para que el `total` del envelope paginado
        cuente el historial completo y no la página."""
        stmt = (
            select(func.count())
            .select_from(Asistencia)
            .where(Asistencia.persona_id == persona_id)
        )
        return self.db.execute(stmt).scalar_one()

    def listar_reporte(
        self,
        horario_id: Optional[int] = None,
        persona_id: Optional[int] = None,
        fecha_inicio=None,
        fecha_fin=None,
        skip: int = 0,
        limit: Optional[int] = None,
    ) -> List[Asistencia]:
        """E02-RF005: reporte de asistencia por horario, periodo o alumno.
        Los tres filtros son opcionales y combinables. `skip`/`limit` quedan
        opcionales (no forzados por el endpoint JSON, ver issue #7 / TRA-6)
        porque el export a PDF (`AsistenciaServicio.generar_reporte` sin
        argumentos) necesita el conjunto completo en una sola consulta."""
        query = self._query_reporte(horario_id, persona_id, fecha_inicio, fecha_fin)
        # Id de desempate: `fecha_entrenamiento` sola no da un orden TOTAL
        # (varias sesiones el mismo día), y sin eso el OFFSET/LIMIT puede
        # repetir o saltear filas entre páginas.
        query = query.order_by(Asistencia.fecha_entrenamiento.desc(), Asistencia.id.desc())
        query = query.offset(skip)
        if limit is not None:
            query = query.limit(limit)
        return query.all()

    def contar_reporte(
        self,
        horario_id: Optional[int] = None,
        persona_id: Optional[int] = None,
        fecha_inicio=None,
        fecha_fin=None,
    ) -> int:
        """Total del conjunto FILTRADO (mismos filtros que `listar_reporte`),
        no de la tabla entera -- para que el `total` del envelope paginado
        sea el del reporte pedido."""
        return self._query_reporte(horario_id, persona_id, fecha_inicio, fecha_fin).count()

    def _query_reporte(self, horario_id, persona_id, fecha_inicio, fecha_fin):
        query = self.db.query(Asistencia).options(
            joinedload(Asistencia.persona),
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
        return query

    def listar_ultimas_sesiones(self, limit: int = 5) -> List[dict]:
        """Las últimas `limit` sesiones (pares horario_id + fecha) que
        tienen al menos una Asistencia, más recientes primero, con un
        conteo por estado -- todo derivado de `Asistencia` +
        `HorarioEntrenamiento`, sin tabla nueva (ver §8 de
        decisiones-de-negocio-2026-08-11.md).

        Dos consultas: una para encontrar los `limit` pares más recientes,
        otra por par para sus conteos. `limit` está acotado (tope 20 en el
        router) así que el N+1 es del mismo tamaño pequeño ya aceptado en
        `fetchPersonaNameMap` del frontend, no una consulta por fila de
        `Asistencia`."""
        pares_stmt = (
            select(
                Asistencia.fecha_entrenamiento,
                Asistencia.horario_id,
                HorarioEntrenamiento.dia_semana,
                HorarioEntrenamiento.hora_inicio,
                HorarioEntrenamiento.hora_fin,
            )
            .join(HorarioEntrenamiento, HorarioEntrenamiento.id == Asistencia.horario_id)
            .group_by(
                Asistencia.fecha_entrenamiento, Asistencia.horario_id,
                HorarioEntrenamiento.dia_semana, HorarioEntrenamiento.hora_inicio,
                HorarioEntrenamiento.hora_fin,
            )
            .order_by(Asistencia.fecha_entrenamiento.desc(), HorarioEntrenamiento.hora_inicio.desc())
            .limit(limit)
        )
        pares = self.db.execute(pares_stmt).all()

        sesiones: List[dict] = []
        for fecha, horario_id, dia_semana, hora_inicio, hora_fin in pares:
            conteo_stmt = (
                select(Asistencia.estado, func.count())
                .where(
                    Asistencia.horario_id == horario_id,
                    Asistencia.fecha_entrenamiento == fecha,
                )
                .group_by(Asistencia.estado)
            )
            conteos = dict(self.db.execute(conteo_stmt).all())
            sesiones.append({
                "horario_id": horario_id,
                "fecha_entrenamiento": fecha,
                "dia_semana": dia_semana,
                "hora_inicio": hora_inicio,
                "hora_fin": hora_fin,
                "conteos": conteos,
            })
        return sesiones


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

    def crear_muchos(self, alumnos_horario: List[AlumnoHorario]) -> List[AlumnoHorario]:
        """Persists every row in ONE transaction: the club enrolls a student
        into a whole training categoria at once (full month, never a loose
        weekday), so this either lands every row or none of them -- a single
        commit instead of one per row, which would leave the categoria
        half-enrolled if a later row failed."""
        self.db.add_all(alumnos_horario)
        self.db.commit()
        for alumno_horario in alumnos_horario:
            self.db.refresh(alumno_horario)
        return alumnos_horario

    def eliminar_muchos(self, alumnos_horario: List[AlumnoHorario]) -> None:
        """Mirror of `crear_muchos`: removes every row in ONE transaction."""
        for alumno_horario in alumnos_horario:
            self.db.delete(alumno_horario)
        self.db.commit()

    def eliminar_por_horario(self, horario_id: int) -> None:
        """Removes every AlumnoHorario row pinned to this ONE horario_id --
        used when the row itself is about to be deleted (e.g. an admin drops
        one día from a categoria's schedule). Deliberately narrower than
        `eliminar_muchos`/the categoria-wide fan-out in
        `AsistenciaServicio.desasignar_alumno_de_horario`: unenrolling a
        student because their whole categoria was chosen is a different
        question from cleaning up the one row that is being deleted."""
        stmt = select(AlumnoHorario).where(AlumnoHorario.horario_id == horario_id)
        filas = list(self.db.execute(stmt).scalars().all())
        for fila in filas:
            self.db.delete(fila)
        self.db.commit()

    def listar_por_horario_sin_filtro(self, horario_id: int) -> List[AlumnoHorario]:
        """Todas las filas de un horario, sin filtrar por alumno activo ni
        paginar -- el mismo conjunto que recorre `eliminar_por_horario`,
        pero SIN comprometer la transacción acá: usado por
        `AsistenciaServicio.actualizar_categoria`/`eliminar_categoria`,
        que arma un lote de deletes y los aplica en un único `commit()`
        vía `CategoriaRepositorio` (edición/baja atómica de la
        categoria)."""
        stmt = select(AlumnoHorario).where(AlumnoHorario.horario_id == horario_id)
        return list(self.db.execute(stmt).scalars().all())

    def listar_personas_de_horarios(self, horario_ids: List[int]) -> set[int]:
        """`persona_id` únicos inscriptos en cualquiera de estos horarios --
        el roster actual de una categoria (por la inscripción atómica, todo
        alumno de la categoria está en TODOS sus horarios vigentes, así que
        cualquiera de ellos alcanza para reconstruirlo). Usado para
        backfillear el `alumno_horario` de un día recién agregado a una
        categoria con alumnos ya inscriptos."""
        if not horario_ids:
            return set()
        stmt = (
            select(AlumnoHorario.persona_id)
            .where(AlumnoHorario.horario_id.in_(horario_ids))
            .distinct()
        )
        return set(self.db.execute(stmt).scalars().all())

    def obtener_por_persona_y_horario(
        self, persona_id: int, horario_id: int
    ) -> Optional[AlumnoHorario]:
        stmt = select(AlumnoHorario).where(
            AlumnoHorario.persona_id == persona_id,
            AlumnoHorario.horario_id == horario_id,
        )
        return self.db.execute(stmt).scalars().first()

    def listar_por_horario(
        self, horario_id: int, skip: int = 0, limit: Optional[int] = None
    ) -> List[AlumnoHorario]:
        stmt = (
            select(AlumnoHorario)
            .options(joinedload(AlumnoHorario.persona))
            .join(Persona, Persona.id == AlumnoHorario.persona_id)
            # Baja lógica: es la nómina OPERATIVA de la clase (la hoja de
            # asistencia del entrenador). Alguien que ya no está en el club no
            # puede figurar como presente ni ausente de una clase de hoy.
            .where(AlumnoHorario.horario_id == horario_id, Persona.activo.is_(True))
            # Se lee como la nómina de la clase: por apellidos y nombres del
            # alumno, con el id de la asignación de desempate para que el
            # orden sea TOTAL y no dependa del motor. Ese orden total es
            # también lo que hace determinista al OFFSET/LIMIT (issue #7).
            .order_by(Persona.apellidos.asc(), Persona.nombres.asc(), AlumnoHorario.id.asc())
            .offset(skip)
        )
        if limit is not None:
            stmt = stmt.limit(limit)
        return list(self.db.execute(stmt).scalars().unique().all())

    def listar_activos_de_todos_los_horarios(self) -> List[AlumnoHorario]:
        """Roster completo de TODOS los horarios en UNA consulta (TRA-7):
        reemplaza las 26 llamadas de `listar_por_horario` (una por horario,
        fijas -- no crecen con el padrón) que alimentaban el conteo "N
        inscriptos" de /groups. Mismo filtro de baja lógica que su hermano;
        `.horario` va eager-loaded para que `_a_detalle_dto` no dispare una
        consulta lazy por cada uno de los ~26 horarios distintos."""
        stmt = (
            select(AlumnoHorario)
            .options(joinedload(AlumnoHorario.persona), joinedload(AlumnoHorario.horario))
            .join(Persona, Persona.id == AlumnoHorario.persona_id)
            .where(Persona.activo.is_(True))
        )
        return list(self.db.execute(stmt).scalars().unique().all())

    def contar_por_horario(self, horario_id: int) -> int:
        """Total de alumnos ACTIVOS del horario: el mismo filtro que
        `listar_por_horario`, para que el `total` del envelope paginado
        cuente la nómina completa de la clase y no la página."""
        stmt = (
            select(func.count())
            .select_from(AlumnoHorario)
            .join(Persona, Persona.id == AlumnoHorario.persona_id)
            .where(AlumnoHorario.horario_id == horario_id, Persona.activo.is_(True))
        )
        return self.db.execute(stmt).scalar_one()

    def listar_por_persona(self, persona_id: int) -> List[AlumnoHorario]:
        stmt = (
            select(AlumnoHorario)
            .options(joinedload(AlumnoHorario.horario))
            .where(AlumnoHorario.persona_id == persona_id)
        )
        return list(self.db.execute(stmt).scalars().unique().all())


