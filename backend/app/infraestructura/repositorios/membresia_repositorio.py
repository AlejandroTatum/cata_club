from typing import Optional, List
from datetime import date
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.dominio.modelos import Membresia, TipoMembresia, Pago
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
          - Alertas de vencimiento (的家庭ar: por persona)
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
        """Listado paginado de todas las membresías. Útil para dashboards
        que necesitan conocer el estado de todas las membresías sin hacer
        N+1 consultas individuales."""
        stmt = (
            select(Membresia)
            .options(
                joinedload(Membresia.persona),
                joinedload(Membresia.tipo_membresia),
            )
            .offset(skip)
            .limit(limit)
        )
        return list(self.db.execute(stmt).scalars().unique().all())
