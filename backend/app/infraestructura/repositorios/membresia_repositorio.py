from typing import Optional, List
from datetime import date, datetime
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.dominio.modelos import Membresia, TipoMembresia, Pago, HistorialEstadoMembresia
from app.dominio.enums import EstadoMembresia, EstadoPago


class TipoMembresiaRepositorio:
    def __init__(self, db: Session):
        self.db = db

    def obtener_por_id(self, tipo_id: int) -> Optional[TipoMembresia]:
        return self.db.get(TipoMembresia, tipo_id)

    def listar(self) -> List[TipoMembresia]:
        return self.db.query(TipoMembresia).all()

    def crear(self, tipo: TipoMembresia) -> TipoMembresia:
        self.db.add(tipo)
        self.db.commit()
        self.db.refresh(tipo)
        return tipo

    def guardar_cambios(self, tipo: TipoMembresia) -> TipoMembresia:
        """Persiste una tarifa ya mutada por el servicio (issue #394). Mismo
        patrón que `DescuentoRepositorio.guardar_cambios`: quién decide QUÉ
        cambia es el servicio; el repositorio solo confirma."""
        self.db.commit()
        self.db.refresh(tipo)
        return tipo


class MembresiaRepositorio:
    def __init__(self, db: Session):
        self.db = db

    def obtener_por_id(self, membresia_id: int) -> Optional[Membresia]:
        stmt = (
            select(Membresia)
            .options(
                joinedload(Membresia.persona),
                joinedload(Membresia.tipo_membresia),
            )
            .where(Membresia.id == membresia_id)
        )
        return self.db.execute(stmt).scalars().first()

    def listar_por_ids(self, membresia_ids: list[int]) -> List[Membresia]:
        """Trae varias membresías por id en una sola consulta (issue #326,
        deuda en bloque). Sin `joinedload` a propósito, a diferencia de
        `obtener_por_id`: la deuda en bloque solo necesita `estado`/
        `monto_aplicado`, no `persona`/`tipo_membresia` precargados."""
        if not membresia_ids:
            return []
        stmt = select(Membresia).where(Membresia.id.in_(membresia_ids))
        return list(self.db.execute(stmt).scalars().all())

    def obtener_por_id_con_bloqueo(self, membresia_id: int) -> Optional[Membresia]:
        """Lee la membresía con `SELECT ... FOR UPDATE`: mismo patrón que
        `PagoRepositorio.obtener_por_id_con_bloqueo` (issue #8, ver su
        docstring), aplicado acá porque `PagoServicio.suspender_membresia`/
        `reactivar_membresia` (issue #400/5a) tienen la MISMA clase de
        carrera que `validar_pago` ya resolvió con ese lock.

        Por qué el índice único parcial `uq_membresia_activa_por_persona`
        NO alcanza para esto: protege que una fila DISTINTA ocupe el mismo
        slot (persona_id, estado operativo), pero dos transiciones
        concurrentes sobre LA MISMA fila (dos `reactivar_membresia(X)` a la
        vez) actualizan la fila que YA ocupa el slot -- ninguna colisiona
        contra el índice, así que Postgres deja pasar a las dos. Sin este
        lock, ambas leen `estado == SUSPENDIDA` antes de que cualquiera
        commitee, ambas pasan la guardia de estado de origen, y las dos
        escriben su propia fila de `HistorialEstadoMembresia` -- dos
        transiciones auditadas para un solo hecho lógico, con
        `fecha_efectiva_ultima_reactivacion` (`MAX(fecha_efectiva)`)
        decidiendo cuál "gana" según quién puso la fecha más tardía, no
        según quién llegó primero.

        Sin `joinedload` a propósito (a diferencia de `obtener_por_id`):
        `FOR UPDATE` con un LEFT OUTER JOIN es inválido en Postgres salvo
        que se acote con `of=`, y ninguno de los dos métodos que usan este
        lock necesita `persona`/`tipo_membresia` precargados -- `reactivar_
        membresia` resuelve el tipo aparte, por `tipo_membresia_id`."""
        return self.db.get(Membresia, membresia_id, with_for_update=True)

    def contar_activas(self) -> int:
        stmt = (
            select(func.count())
            .select_from(Membresia)
            .where(Membresia.estado == EstadoMembresia.ACTIVA)
        )
        return self.db.execute(stmt).scalar_one()

    def crear(self, membresia: Membresia) -> Membresia:
        self.db.add(membresia)
        self.db.commit()
        self.db.refresh(membresia)
        return membresia

    def guardar_cambios(self, membresia: Membresia) -> Membresia:
        """Persiste cambios hechos sobre una entidad ya adjunta a la sesión
        (ej. cambio de estado disparado por otro servicio)."""
        self.db.commit()
        self.db.refresh(membresia)
        return membresia

    # ------------------------------------------------------------------
    # Consultas orientadas a automatizaciones / reglas de dominio
    # ------------------------------------------------------------------
    def listar_membresias_activas_por_representante(
        self, representante_id: int, en_fecha: date
    ) -> List[Membresia]:
        """
        Devuelve las membresías ACTIVAS de los representados por
        `representante_id` (hijos/representados) cuya ventana de vigencia
        cubre `en_fecha`. Se usa para:
          - Alertas de vencimiento (granularidad: por persona)
          - Regla Familiar E04-RF002 (contar miembros activos de la familia).

        La vigencia se deriva del último Pago APROBADO (pago.fecha_inicio <=
        en_fecha <= pago.fecha_fin), ya que Membresia no tiene fecha_vencimiento
        propia (decisión de diseño: reusar Pago.fecha_fin).
        """
        from app.dominio.modelos import Persona, Pago
        from app.dominio.enums import EstadoPago

        stmt = (
            select(Membresia)
            .join(Pago, Pago.membresia_id == Membresia.id)
            .join(Persona, Persona.id == Membresia.persona_id)
            .where(
                Membresia.estado == EstadoMembresia.ACTIVA,
                Pago.estado_pago == EstadoPago.APROBADO,
                Persona.representante_id == representante_id,
                Pago.fecha_inicio <= en_fecha,
                Pago.fecha_fin >= en_fecha,
            )
        )
        return list(self.db.scalars(stmt).unique().all())

    def contar_membresias_activas_familia(
        self, representante_id: int, en_fecha: date
    ) -> int:
        """Atajo de `listar_membresias_activas_por_representante` que devuelve
        solo el conteo. Útil para E04-RF002."""
        return len(self.listar_membresias_activas_por_representante(representante_id, en_fecha))

    def listar_por_persona(self, persona_id: int) -> List[Membresia]:
        stmt = (
            select(Membresia)
            .options(
                joinedload(Membresia.persona),
                joinedload(Membresia.tipo_membresia),
            )
            .where(Membresia.persona_id == persona_id)
        )
        return list(self.db.execute(stmt).scalars().unique().all())

    def tiene_deudas_pendientes(self, persona_id: int) -> bool:
        """True si la persona tiene deudas pendientes que impiden independizarse.

        Dos condiciones bloqueantes:
        1. Membresía INACTIVA sin ningún pago APROBADO (nunca pagó).
        2. Cualquier membresía con al menos un pago PENDIENTE_VALIDACION
           (pago enviado, esperando revisión del admin).
        """
        from sqlalchemy import and_, exists

        # Condición 1: membresía INACTIVA sin pago APROBADO
        stmt_inactiva_sin_pago = (
            exists()
            .where(
                and_(
                    Pago.membresia_id == Membresia.id,
                    Pago.estado_pago == EstadoPago.APROBADO,
                )
            )
        )
        inactiva_sin_pago = (
            self.db.query(Membresia)
            .filter(
                Membresia.persona_id == persona_id,
                Membresia.estado == EstadoMembresia.INACTIVA,
                ~stmt_inactiva_sin_pago,
            )
            .first()
            is not None
        )
        if inactiva_sin_pago:
            return True

        # Condición 2: pago PENDIENTE_VALIDACION en cualquier membresía
        stmt_pendiente = (
            exists()
            .where(
                and_(
                    Pago.membresia_id == Membresia.id,
                    Membresia.persona_id == persona_id,
                    Pago.estado_pago == EstadoPago.PENDIENTE_VALIDACION,
                )
            )
        )
        return self.db.query(stmt_pendiente).scalar()

    def listar(self, skip: int = 0, limit: int = 200) -> List[Membresia]:
        """Listado paginado de todas las membresías. Útil para dashboards
        que necesitan conocer el estado de todas las membresías sin hacer
        N+1 consultas individuales."""
        stmt = (
            select(Membresia)
            .options(
                joinedload(Membresia.persona),
                joinedload(Membresia.tipo_membresia),
            )
            # Lo más reciente primero, mismo criterio que
            # `PagoRepositorio.listar`: el admin reconoce una membresía por
            # cuándo se activó, y las últimas altas son las que revisa. El id
            # desempata las activadas en el mismo instante para que el orden
            # sea TOTAL — sin eso, `OFFSET/LIMIT` podría repetir o saltear
            # filas entre páginas.
            .order_by(Membresia.fecha_activacion.desc(), Membresia.id.desc())
            .offset(skip)
            .limit(limit)
        )
        return list(self.db.execute(stmt).scalars().unique().all())


class HistorialEstadoMembresiaRepositorio:
    """Issue #400 (slice 5a): huella auditable de transiciones de estado.

    Sin `crear()` propio a propósito: `PagoServicio.suspender_membresia`/
    `reactivar_membresia` agregan la fila a la sesión con `db.add()` y la
    commitean JUNTO con el cambio de `Membresia.estado` (un solo
    `guardar_cambios` para los dos objetos) -- mismo patrón que
    `_activar_membresia_con_red_de_seguridad` + `repo.guardar_cambios(pago)`
    en `validar_pago`. Partir la escritura en dos commits dejaría una
    ventana donde el estado cambió pero la auditoría todavía no, o viceversa."""

    def __init__(self, db: Session):
        self.db = db

    def fecha_efectiva_ultima_reactivacion(self, membresia_id: int) -> Optional[datetime]:
        """`fecha_efectiva` de la transición MÁS RECIENTE hacia ACTIVA, o
        `None` si esta membresía nunca se reactivó.

        Por qué hace falta: `calcular_meses_adeudados` necesita saber si el
        ancla de deuda (`fecha_fin` de la última cobertura aprobada) quedó
        VIEJA por una suspensión -- el issue #400 exige que "los meses entre
        el fin de cobertura y la reactivación no generan deuda", así que el
        reloj de mora debe arrancar de nuevo en la fecha de reactivación
        cuando esa fecha es MÁS RECIENTE que el fin de la cobertura (ver
        docstring de `PagoServicio.calcular_meses_adeudados`)."""
        stmt = (
            select(HistorialEstadoMembresia.fecha_efectiva)
            .where(
                HistorialEstadoMembresia.membresia_id == membresia_id,
                HistorialEstadoMembresia.estado_nuevo == EstadoMembresia.ACTIVA,
            )
            # `id.desc()` desempata (issue #400, hallazgo del revisor): dos
            # filas con la MISMA `fecha_efectiva` (posible ahora que
            # `PagoServicio._validar_fecha_efectiva` exige no-decreciente,
            # no estrictamente creciente) deben resolverse por orden real de
            # escritura, no por un empate arbitrario del planner.
            .order_by(HistorialEstadoMembresia.fecha_efectiva.desc(), HistorialEstadoMembresia.id.desc())
            .limit(1)
        )
        return self.db.execute(stmt).scalar_one_or_none()

    def fecha_efectiva_ultima_reactivacion_bulk(self, membresia_ids: list[int]) -> dict[int, datetime]:
        """Versión agrupada de `fecha_efectiva_ultima_reactivacion`: UN
        `MAX(fecha_efectiva)` agrupado por membresía, en vez de N consultas
        (issue #326, deuda en bloque). El desempate por `id.desc()` de la
        versión de una sola fila no hace falta acá -- el agregado `MAX()`
        ya da el mismo valor sin necesitar la fila entera."""
        if not membresia_ids:
            return {}
        stmt = (
            select(HistorialEstadoMembresia.membresia_id, func.max(HistorialEstadoMembresia.fecha_efectiva))
            .where(
                HistorialEstadoMembresia.membresia_id.in_(membresia_ids),
                HistorialEstadoMembresia.estado_nuevo == EstadoMembresia.ACTIVA,
            )
            .group_by(HistorialEstadoMembresia.membresia_id)
        )
        return dict(self.db.execute(stmt).all())

    def ultima_transicion(self, membresia_id: int) -> Optional[HistorialEstadoMembresia]:
        """La fila de `HistorialEstadoMembresia` escrita MÁS RECIENTEMENTE
        para esta membresía (por orden real de inserción, `id DESC`), o
        `None` si todavía no tiene ninguna.

        Por qué existe (issue #400, hallazgo del revisor): sin esto, un
        `fecha_efectiva` retroactivo en una transición POSTERIOR podía
        quedar por delante de una transición ANTERIOR en el tiempo real --
        ej. reactivar hoy con `fecha_efectiva` de hace un año, cuando ya
        existía una suspensión con `fecha_efectiva` de hace un mes. Eso
        rompería `fecha_efectiva_ultima_reactivacion` (que asume que la
        fila con la `fecha_efectiva` más alta ES la más reciente) y además
        no tiene sentido de negocio: una transición no puede regir ANTES de
        que la anterior haya regido. `PagoServicio._validar_fecha_efectiva`
        usa esto para exigir una secuencia no-decreciente."""
        stmt = (
            select(HistorialEstadoMembresia)
            .where(HistorialEstadoMembresia.membresia_id == membresia_id)
            .order_by(HistorialEstadoMembresia.id.desc())
            .limit(1)
        )
        return self.db.execute(stmt).scalars().first()
