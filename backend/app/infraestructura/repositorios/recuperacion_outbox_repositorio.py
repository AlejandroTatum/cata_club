from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, or_, select

from app.dominio.modelos import RecuperacionOutbox


MAX_ATTEMPTS = 6


class RecuperacionOutboxRepositorio:
    def __init__(self, db):
        self.db = db

    def claim_pending(self, lease_minutes=10):
        now = datetime.now(timezone.utc)
        stale = now - timedelta(minutes=lease_minutes)
        stmt = (
            select(RecuperacionOutbox)
            .where(
                RecuperacionOutbox.expires_at > now,
                RecuperacionOutbox.attempts < MAX_ATTEMPTS,
                or_(
                    and_(
                        RecuperacionOutbox.status == "PENDIENTE",
                        RecuperacionOutbox.next_attempt_at <= now,
                    ),
                    and_(
                        RecuperacionOutbox.status == "ENVIANDO",
                        RecuperacionOutbox.claimed_at < stale,
                    ),
                ),
            )
            .order_by(RecuperacionOutbox.next_attempt_at, RecuperacionOutbox.id)
            .with_for_update(skip_locked=True)
            .limit(1)
        )
        event = self.db.execute(stmt).scalar_one_or_none()
        if event:
            event.status, event.claimed_at = "ENVIANDO", now
            event.attempts += 1
        return event

    def requeue(self, event, error):
        now = datetime.now(timezone.utc)
        event.status = "AGOTADO" if event.attempts >= MAX_ATTEMPTS else "PENDIENTE"
        event.next_attempt_at = now + timedelta(
            minutes=min(2 ** max(event.attempts - 1, 0), 60)
        )
        event.claimed_at = None
        event.last_error_redacted = f"{type(error).__name__}: delivery failed"

    def mark_sent(self, event):
        event.status, event.sent_at, event.claimed_at = (
            "ENVIADO",
            datetime.now(timezone.utc),
            None,
        )
