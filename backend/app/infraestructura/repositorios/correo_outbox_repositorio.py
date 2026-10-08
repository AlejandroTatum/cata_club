"""Reclamo con lease y backoff de la cola genérica de correos (issue #1710).

Gemelo de `verificacion_correo_outbox_repositorio.py`: misma política de
reintentos porque el problema es el mismo -- entregar un correo sin perderlo
cuando el proveedor SMTP falla --, y una política distinta para esta cola
sería una diferencia sin razón.
"""
from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, or_, select

from app.dominio.modelos import CorreoOutbox
from app.infraestructura.repositorios import outbox_auditoria_entrega as auditoria

MAX_ATTEMPTS = 6


class CorreoOutboxRepositorio:
    def __init__(self, db):
        self.db = db

    def claim_pending(self, lease_minutes=10):
        """`skip_locked`: dos workers concurrentes toman filas distintas en vez
        de bloquearse uno contra el otro. No commitea -- eso es del llamador."""
        now = datetime.now(timezone.utc)
        stale = now - timedelta(minutes=lease_minutes)
        stmt = (
            select(CorreoOutbox)
            .where(
                CorreoOutbox.expires_at > now,
                CorreoOutbox.attempts < MAX_ATTEMPTS,
                or_(
                    and_(
                        CorreoOutbox.status == "PENDIENTE",
                        CorreoOutbox.next_attempt_at <= now,
                    ),
                    # Lease vencido: el worker que la reclamó se cayó sin
                    # resolverla, así que la fila vuelve a estar disponible.
                    and_(
                        CorreoOutbox.status == "ENVIANDO",
                        CorreoOutbox.claimed_at < stale,
                    ),
                ),
            )
            .order_by(CorreoOutbox.next_attempt_at, CorreoOutbox.id)
            .with_for_update(skip_locked=True)
            .limit(1)
        )
        evento = self.db.execute(stmt).scalar_one_or_none()
        if evento:
            evento.status, evento.claimed_at = "ENVIANDO", now
            evento.attempts += 1
        return evento

    def requeue(self, evento, error):
        """Backoff exponencial con techo de 60 min; `AGOTADO` en el último
        intento. Del error se guarda SOLO su clase: el detalle puede contener
        la dirección de destino o credenciales del proveedor."""
        now = datetime.now(timezone.utc)
        evento.status = "AGOTADO" if evento.attempts >= MAX_ATTEMPTS else "PENDIENTE"
        evento.next_attempt_at = now + timedelta(
            minutes=min(2 ** max(evento.attempts - 1, 0), 60)
        )
        evento.claimed_at = None
        evento.last_error_redacted = f"{type(error).__name__}: delivery failed"
        auditoria.marcar_entrega_resuelta(evento)

    def mark_sent(self, evento):
        evento.status, evento.sent_at, evento.claimed_at = (
            "ENVIADO",
            datetime.now(timezone.utc),
            None,
        )
        auditoria.marcar_entrega_resuelta(evento)
