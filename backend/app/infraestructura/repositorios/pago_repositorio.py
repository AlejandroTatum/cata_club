from datetime import date, datetime, time, timezone
from typing import Optional
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.dominio.modelos import Pago, ComprobantePago
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

    def crear(self, pago: Pago) -> Pago:
        self.db.add(pago)
        self.db.commit()
        self.db.refresh(pago)
        return pago

    def guardar_cambios(self, pago: Pago) -> Pago:
        self.db.commit()
        self.db.refresh(pago)
        return pago


class ComprobantePagoRepositorio:
    def __init__(self, db: Session):
        self.db = db

    def crear(self, comprobante: ComprobantePago) -> ComprobantePago:
        self.db.add(comprobante)
        self.db.commit()
        self.db.refresh(comprobante)
        return comprobante
