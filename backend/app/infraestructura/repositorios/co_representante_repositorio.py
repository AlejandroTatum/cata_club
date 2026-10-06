"""Acceso a datos del segundo guardián (issue #1666). El `commit()` es del
caso de uso (`CoRepresentanteServicio`)."""
from datetime import datetime
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.dominio.modelos import CoRepresentante, CoRepresentanteEvento, CoRepresentanteInvitacion


class CoRepresentanteRepositorio:
    def __init__(self, db: Session):
        self.db = db

    # --- Vínculo activo ------------------------------------------------------
    def obtener_por_persona(self, persona_id: int) -> Optional[CoRepresentante]:
        return self.db.execute(
            select(CoRepresentante).where(CoRepresentante.persona_id == persona_id)
        ).scalar_one_or_none()

    def existe(self, persona_id: int, co_representante_id: int) -> bool:
        return self.db.execute(
            select(CoRepresentante.id).where(
                CoRepresentante.persona_id == persona_id,
                CoRepresentante.co_representante_id == co_representante_id,
            )
        ).first() is not None

    def crear(self, vinculo: CoRepresentante) -> CoRepresentante:
        self.db.add(vinculo)
        self.db.flush()
        return vinculo

    def eliminar(self, vinculo: CoRepresentante) -> None:
        self.db.delete(vinculo)
        self.db.flush()

    def listar_de_co_representante(self, co_representante_id: int) -> list[CoRepresentante]:
        return list(self.db.execute(
            select(CoRepresentante).where(CoRepresentante.co_representante_id == co_representante_id)
        ).scalars())

    # --- Invitaciones --------------------------------------------------------
    def obtener_pendiente(self, persona_id: int) -> Optional[CoRepresentanteInvitacion]:
        return self.db.execute(
            select(CoRepresentanteInvitacion).where(
                CoRepresentanteInvitacion.persona_id == persona_id,
                CoRepresentanteInvitacion.aceptada_en.is_(None),
                CoRepresentanteInvitacion.cancelada_en.is_(None),
            )
        ).scalar_one_or_none()

    def listar_pendientes_de_cuenta(self, co_representante_id: int) -> list[CoRepresentanteInvitacion]:
        """Invitaciones pendientes que CREARON la cuenta de `co_representante_id`
        (una por menor, si se la invitó para varios hijos a la vez)."""
        return list(self.db.execute(
            select(CoRepresentanteInvitacion).where(
                CoRepresentanteInvitacion.co_representante_id == co_representante_id,
                CoRepresentanteInvitacion.aceptada_en.is_(None),
                CoRepresentanteInvitacion.cancelada_en.is_(None),
            ).order_by(CoRepresentanteInvitacion.id)
        ).scalars())

    def obtener_invitacion(self, invitacion_id: int) -> Optional[CoRepresentanteInvitacion]:
        return self.db.get(CoRepresentanteInvitacion, invitacion_id)

    def crear_invitacion(self, invitacion: CoRepresentanteInvitacion) -> CoRepresentanteInvitacion:
        self.db.add(invitacion)
        self.db.flush()
        return invitacion

    def cancelar_pendiente(self, invitacion: CoRepresentanteInvitacion, ahora: datetime) -> None:
        invitacion.cancelada_en = ahora
        self.db.flush()

    # --- Ledger --------------------------------------------------------------
    def registrar_evento(self, evento: CoRepresentanteEvento) -> CoRepresentanteEvento:
        self.db.add(evento)
        self.db.flush()
        return evento

    def listar_eventos(self, persona_id: int) -> list[CoRepresentanteEvento]:
        return list(self.db.execute(
            select(CoRepresentanteEvento)
            .where(CoRepresentanteEvento.persona_id == persona_id)
            .order_by(CoRepresentanteEvento.fecha.desc(), CoRepresentanteEvento.id.desc())
        ).scalars())
