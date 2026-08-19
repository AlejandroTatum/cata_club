from datetime import date, datetime, time, timezone
from typing import Optional
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.dominio.modelos import Pago, ComprobantePago, CoberturaBonificada, CorreccionPago
from app.dominio.enums import EstadoPago


def _rango_fecha_registro(fecha_inicio: Optional[date], fecha_fin: Optional[date]):
    """Convierte fechas (inclusive, sin hora) a límites datetime tz-aware para
    filtrar `Pago.fecha_registro`. Mismo criterio que
    `personas_router.reporte_nuevos_por_periodo` (00:00:00 / 23:59:59.999999
    UTC), para que el comportamiento sea consistente entre reportes."""
    inicio = datetime.combine(fecha_inicio, time.min, tzinfo=timezone.utc) if fecha_inicio else None
    fin = datetime.combine(fecha_fin, time.max, tzinfo=timezone.utc) if fecha_fin else None
    return inicio, fin


class PagoRepositorio:
    def __init__(self, db: Session):
        self.db = db

    def obtener_por_id(self, pago_id: int) -> Optional[Pago]:
        return self.db.get(Pago, pago_id)

    def obtener_membresia_id(self, pago_id: int) -> Optional[int]:
        """Lee SOLO la columna `membresia_id` de un pago -- una consulta de
        una sola columna, NUNCA `Session.get(Pago, ...)` (issue #400/5b,
        hallazgo del revisor). `corregir_pago` necesita conocer la
        `Membresia` de un pago ANTES de poder lockearla (para respetar el
        orden Membresia-primero, Pago-después), pero un `Session.get(Pago,
        pago_id)` sin lock, en la MISMA sesión que después llama
        `obtener_por_id_con_bloqueo(pago_id)`, deja el objeto `Pago` YA
        cacheado en el identity map -- y `Session.get(..., with_for_
        update=True)` sobre un id que el identity map ya tiene puede
        devolver la instancia cacheada SIN emitir un `SELECT` nuevo,
        dejando el lock (y el refresh de atributos) silenciosamente sin
        efecto. Una consulta de columna suelta (`select(Pago.membresia_id)`)
        nunca crea ni toca una instancia ORM de `Pago`, así que no hay
        identity map que ensuciar."""
        stmt = select(Pago.membresia_id).where(Pago.id == pago_id)
        return self.db.execute(stmt).scalar_one_or_none()

    def obtener_por_id_con_bloqueo(self, pago_id: int) -> Optional[Pago]:
        """Lee el pago con `SELECT ... FOR UPDATE`: la fila queda bloqueada
        hasta el commit/rollback de esta transacción. Dos validaciones
        concurrentes del mismo pago se serializan en Postgres: la segunda
        espera y relee el estado ya commiteado por la primera (con lo que la
        guardia de estado de `validar_pago` la rechaza)."""
        return self.db.get(Pago, pago_id, with_for_update=True)

    def listar(
        self,
        estado_pago: Optional[EstadoPago] = None,
        skip: int = 0,
        limit: int = 50,
        fecha_inicio: Optional[date] = None,
        fecha_fin: Optional[date] = None,
    ) -> list[Pago]:
        """Lista pagos para la cola de validación del Administrador.
        `joinedload(Pago.persona)` evita el problema N+1: el servicio necesita
        el nombre de cada persona para armar PagoListItemDTO y sin esto
        dispararía una query aparte por cada fila."""
        stmt = select(Pago).options(joinedload(Pago.persona))
        if estado_pago is not None:
            stmt = stmt.where(Pago.estado_pago == estado_pago)
        inicio, fin = _rango_fecha_registro(fecha_inicio, fecha_fin)
        if inicio is not None:
            stmt = stmt.where(Pago.fecha_registro >= inicio)
        if fin is not None:
            stmt = stmt.where(Pago.fecha_registro <= fin)
        stmt = stmt.order_by(Pago.fecha_registro.desc()).offset(skip).limit(limit)
        return list(self.db.execute(stmt).scalars().all())

    def listar_por_persona(self, persona_id: int) -> list[Pago]:
        """Historial completo (cualquier estado) de los pagos de una persona.
        Sin `joinedload(Pago.persona)`: a diferencia de `listar()`, aquí la
        persona ya es conocida por quien solicita (dueño/representante/admin),
        así que no hay N+1 que evitar -- el response DTO tampoco expone
        `persona_nombre_completo`."""
        stmt = (
            select(Pago)
            .where(Pago.persona_id == persona_id)
            .order_by(Pago.fecha_registro.desc())
        )
        return list(self.db.execute(stmt).scalars().all())

    def contar(
        self,
        estado_pago: Optional[EstadoPago] = None,
        fecha_inicio: Optional[date] = None,
        fecha_fin: Optional[date] = None,
    ) -> int:
        """Cuenta el total de pagos (opcionalmente filtrados por estado y/o rango de fecha_registro)."""
        from sqlalchemy import func
        stmt = select(func.count()).select_from(Pago)
        if estado_pago is not None:
            stmt = stmt.where(Pago.estado_pago == estado_pago)
        inicio, fin = _rango_fecha_registro(fecha_inicio, fecha_fin)
        if inicio is not None:
            stmt = stmt.where(Pago.fecha_registro >= inicio)
        if fin is not None:
            stmt = stmt.where(Pago.fecha_registro <= fin)
        return self.db.execute(stmt).scalar_one()

    def existe_pendiente_para_membresia(self, membresia_id: int) -> bool:
        """True si la membresía tiene al menos un pago PENDIENTE_VALIDACION."""
        stmt = select(func.count()).select_from(Pago).where(
            Pago.membresia_id == membresia_id,
            Pago.estado_pago == EstadoPago.PENDIENTE_VALIDACION,
        )
        return self.db.execute(stmt).scalar_one() > 0

    def fecha_fin_maxima_aprobada(self, membresia_id: int) -> Optional[date]:
        """`fecha_fin` más lejana entre los pagos APROBADOS de una membresía,
        o `None` si nunca tuvo uno. Es el ancla desde donde
        `PagoServicio.registrar_pago` extiende la cobertura de un pago
        nuevo (fix período de cobertura, PAG-5): retoma el pago pendiente
        de validación, así que solo cuentan los que el club ya validó."""
        stmt = select(func.max(Pago.fecha_fin)).where(
            Pago.membresia_id == membresia_id,
            Pago.estado_pago == EstadoPago.APROBADO,
        )
        return self.db.execute(stmt).scalar_one_or_none()

    def cobertura_aprobada_en_rango(
        self,
        membresia_id: int,
        fecha_inicio: date,
        fecha_fin: date,
        *,
        excluir_pago_id: Optional[int] = None,
    ) -> bool:
        """True si la membresía ya tiene un pago APROBADO cuyo período [fecha_inicio, fecha_fin]
        se solapa con el rango dado (issue #284: la regularización no puede pisar
        cobertura ya aprobada).

        `excluir_pago_id` (issue #400/5b): `PagoServicio.corregir_pago` corrige
        las fechas del PROPIO pago -- sin excluirlo, la fila que se está
        corrigiendo (todavía con sus valores VIEJOS en esta misma consulta)
        se solaparía trivialmente consigo misma y el chequeo de superposición
        rechazaría cualquier corrección de fecha. `regularizar_deuda` no pasa
        este argumento (crea un `Pago` nuevo, nunca corrige uno existente),
        así que el default `None` preserva su comportamiento sin cambios."""
        stmt = select(func.count()).select_from(Pago).where(
            Pago.membresia_id == membresia_id,
            Pago.estado_pago == EstadoPago.APROBADO,
            Pago.fecha_inicio <= fecha_fin,
            Pago.fecha_fin >= fecha_inicio,
        )
        if excluir_pago_id is not None:
            stmt = stmt.where(Pago.id != excluir_pago_id)
        return self.db.execute(stmt).scalar_one() > 0

    def cobertura_aprobada_en_rango_medio_abierto(
        self, membresia_id: int, fecha_inicio: date, fecha_fin: date,
    ) -> bool:
        """Variante de `cobertura_aprobada_en_rango` con semántica de rango
        MEDIO ABIERTO `[fecha_inicio, fecha_fin)` -- issue #400/4d, usada
        SOLO por `PagoServicio.aplicar_beneficio_bonificado`.

        Por qué NO reutilizar `cobertura_aprobada_en_rango` (que usa `<=`/`>=`,
        rango CERRADO): esa función la llama `regularizar_deuda` con fechas
        explícitas del admin, donde "cerrado" nunca importó en la práctica.
        Acá los períodos se anclan automáticamente unos sobre otros
        (`fecha_fin` de uno == `fecha_inicio` del siguiente, misma convención
        que `_sumar_meses`/la restricción de exclusión `'[)'`), así que un
        rango CERRADO confundiría dos períodos ADYACENTES (que no se pisan)
        con dos que se solapan de verdad -- exactamente el bug que reprodujo
        `test_segunda_aplicacion_ancla_sobre_la_cobertura_bonificada_previa`
        contra Postgres real antes de este fix."""
        stmt = select(func.count()).select_from(Pago).where(
            Pago.membresia_id == membresia_id,
            Pago.estado_pago == EstadoPago.APROBADO,
            Pago.fecha_inicio < fecha_fin,
            Pago.fecha_fin > fecha_inicio,
        )
        return self.db.execute(stmt).scalar_one() > 0

    def crear(self, pago: Pago) -> Pago:
        self.db.add(pago)
        self.db.commit()
        self.db.refresh(pago)
        return pago

    def guardar_cambios(self, pago: Pago) -> Pago:
        self.db.commit()
        self.db.refresh(pago)
        return pago

    def listar_correcciones_por_pago(self, pago_id: int) -> list[CorreccionPago]:
        """Historial completo de correcciones financieras de un pago (issue
        #400/5b), orden cronológico de escritura -- el rastro que el issue
        exige que sea "conservado" tiene que ser CONSULTABLE, no solo
        escribible."""
        stmt = (
            select(CorreccionPago)
            .where(CorreccionPago.pago_id == pago_id)
            .order_by(CorreccionPago.fecha_registro, CorreccionPago.id)
        )
        return list(self.db.execute(stmt).scalars().all())


class ComprobantePagoRepositorio:
    def __init__(self, db: Session):
        self.db = db

    def crear(self, comprobante: ComprobantePago) -> ComprobantePago:
        self.db.add(comprobante)
        self.db.commit()
        self.db.refresh(comprobante)
        return comprobante


class CoberturaBonificadaRepositorio:
    """Acceso a datos de `CoberturaBonificada` (issue #400, slice 4d). Fino
    a propósito, mismo reparto de responsabilidades que
    `AsignacionDescuentoRepositorio`/`BeneficioServicio`: qué constituye un
    período "ya cubierto", la resolución del beneficio y la traducción del
    `IntegrityError` de la carrera viven en `PagoServicio`, no acá."""

    def __init__(self, db: Session):
        self.db = db

    def fecha_fin_maxima(self, membresia_id: int) -> Optional[date]:
        """`fecha_fin` más lejana entre las coberturas bonificadas ya
        otorgadas de una membresía, o `None` si nunca tuvo una. Mismo rol que
        `PagoRepositorio.fecha_fin_maxima_aprobada` para el otro lado del
        ancla: `PagoServicio.aplicar_beneficio_bonificado` combina ambos
        máximos (issue #400: "derivada exactamente como un pago normal,
        anclando contra AMBAS tablas") para no pisar cobertura ya otorgada
        por cualquiera de los dos caminos."""
        stmt = select(func.max(CoberturaBonificada.fecha_fin)).where(
            CoberturaBonificada.membresia_id == membresia_id,
        )
        return self.db.execute(stmt).scalar_one_or_none()

    def existe_en_rango(self, membresia_id: int, fecha_inicio: date, fecha_fin: date) -> bool:
        """True si la membresía ya tiene una cobertura bonificada cuyo
        período se solapa con el rango dado. Contraparte de
        `PagoRepositorio.cobertura_aprobada_en_rango_medio_abierto` para la
        otra tabla -- `PagoServicio.aplicar_beneficio_bonificado` consulta
        las DOS antes de otorgar (pre-check, camino primario de error); la
        restricción de exclusión `ex_cobertura_bonificada_periodo_no_solapa`
        es la red de seguridad ante la carrera que este pre-check no puede
        ver.

        Semántica de rango MEDIO ABIERTO `[fecha_inicio, fecha_fin)`, EXACTA
        pareja de `daterange(fecha_inicio, fecha_fin, '[)')` de la
        restricción de exclusión (mismo motivo que la variante `_medio_
        abierto` de `PagoRepositorio`): dos otorgamientos consecutivos donde
        el segundo arranca justo donde terminó el primero NO se solapan."""
        stmt = select(func.count()).select_from(CoberturaBonificada).where(
            CoberturaBonificada.membresia_id == membresia_id,
            CoberturaBonificada.fecha_inicio < fecha_fin,
            CoberturaBonificada.fecha_fin > fecha_inicio,
        )
        return self.db.execute(stmt).scalar_one() > 0

    def existe_en_rango_cerrado(self, membresia_id: int, fecha_inicio: date, fecha_fin: date) -> bool:
        """Variante de `existe_en_rango` con semántica de rango CERRADO
        (`<=`/`>=`) -- hallazgo del revisor (issue #400/4d): `regularizar_
        deuda` recibe fechas EXPLÍCITAS del admin (no auto-ancladas), igual
        que su propio `PagoRepositorio.cobertura_aprobada_en_rango` (con el
        que corre en paralelo, ver `PagoServicio._hay_cobertura_en_rango`) --
        usar la variante medio-abierta acá sería inconsistente entre las dos
        mitades del mismo chequeo y podría dejar pasar un backdate que roza
        el borde de una cobertura bonificada ya otorgada."""
        stmt = select(func.count()).select_from(CoberturaBonificada).where(
            CoberturaBonificada.membresia_id == membresia_id,
            CoberturaBonificada.fecha_inicio <= fecha_fin,
            CoberturaBonificada.fecha_fin >= fecha_inicio,
        )
        return self.db.execute(stmt).scalar_one() > 0

    def crear(self, cobertura: CoberturaBonificada) -> CoberturaBonificada:
        self.db.add(cobertura)
        self.db.commit()
        self.db.refresh(cobertura)
        return cobertura
