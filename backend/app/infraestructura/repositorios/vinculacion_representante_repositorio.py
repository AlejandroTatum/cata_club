"""Persistencia del ledger append-only de representación."""
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.dominio.modelos import VinculacionRepresentante


class VinculacionRepresentanteRepositorio:
    """Escribe evidencia sin cambiar la relación actual ni cerrar transacciones."""

    def __init__(self, db: Session):
        self.db = db

    def obtener_por_clave(self, idempotency_key: str) -> Optional[VinculacionRepresentante]:
        return self.db.scalar(
            select(VinculacionRepresentante).where(
                VinculacionRepresentante.idempotency_key == idempotency_key
            )
        )

    def registrar(
        self,
        *,
        persona_id: int,
        actor_persona_id: int,
        representante_anterior_id: Optional[int],
        representante_nuevo_id: Optional[int],
        operacion: str,
        origen: str,
        idempotency_key: Optional[str],
        request_fingerprint: Optional[str],
    ) -> VinculacionRepresentante:
        if (idempotency_key is None) != (request_fingerprint is None):
            raise ValueError("idempotency key and fingerprint must be paired")

        if idempotency_key is not None:
            existente = self.obtener_por_clave(idempotency_key)
            if existente is not None:
                if existente.request_fingerprint != request_fingerprint:
                    raise ValueError("idempotency key has a different fingerprint")
                return existente

        evento = VinculacionRepresentante(
            persona_id=persona_id,
            actor_persona_id=actor_persona_id,
            representante_anterior_id=representante_anterior_id,
            representante_nuevo_id=representante_nuevo_id,
            operacion=operacion,
            origen=origen,
            idempotency_key=idempotency_key,
            request_fingerprint=request_fingerprint,
        )
        self.db.add(evento)
        self.db.flush()
        return evento
