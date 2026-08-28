"""Reclamo con lease y backoff del outbox de verificación de correo.

Gemelo de `recuperacion_outbox_repositorio.py` (issue #790): misma política de
reintentos porque el problema es el mismo -- entregar un enlace por correo sin
perderlo cuando el proveedor SMTP falla -- y porque una política distinta para
cada cola sería una diferencia sin razón que alguien tendría que descubrir a
las malas.
"""
from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, or_, select

from app.dominio.modelos import VerificacionCorreoOutbox


MAX_ATTEMPTS = 6


class VerificacionCorreoOutboxRepositorio:
    def __init__(self, db):
        self.db = db

    def claim_pending(self, lease_minutes=10):
        """`skip_locked`: dos workers concurrentes toman filas distintas en vez
        de bloquearse uno contra el otro. No commitea -- eso es del llamador."""
        now = datetime.now(timezone.utc)
        stale = now - timedelta(minutes=lease_minutes)
        stmt = (
            select(VerificacionCorreoOutbox)
            .where(
                VerificacionCorreoOutbox.expires_at > now,
                VerificacionCorreoOutbox.attempts < MAX_ATTEMPTS,
                or_(
                    and_(
                        VerificacionCorreoOutbox.status == "PENDIENTE",
                        VerificacionCorreoOutbox.next_attempt_at <= now,
                    ),
                    # Lease vencido: el worker que la reclamó se cayó sin
                    # resolverla, así que la fila vuelve a estar disponible.
                    and_(
                        VerificacionCorreoOutbox.status == "ENVIANDO",
                        VerificacionCorreoOutbox.claimed_at < stale,
                    ),
                ),
            )
            .order_by(VerificacionCorreoOutbox.next_attempt_at, VerificacionCorreoOutbox.id)
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

    def mark_sent(self, evento):
        evento.status, evento.sent_at, evento.claimed_at = (
            "ENVIADO",
            datetime.now(timezone.utc),
            None,
        )
