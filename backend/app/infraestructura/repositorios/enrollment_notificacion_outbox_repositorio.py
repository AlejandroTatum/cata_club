from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.dominio.modelos import EnrollmentNotificacionOutbox

MAX_ATTEMPTS = 6


class EnrollmentNotificacionOutboxRepositorio:
    def __init__(self, db: Session):
        self.db = db

    def crear(self, admin_persona_id: int, alumno_persona_id: int, mensaje: str):
        event = EnrollmentNotificacionOutbox(
            admin_persona_id=admin_persona_id,
            alumno_persona_id=alumno_persona_id,
            mensaje=mensaje,
        )
        self.db.add(event)
        self.db.flush()
        return event

    def claim_pending(self, lease_minutes: int = 10):
        now = datetime.now(timezone.utc)
        stale = now - timedelta(minutes=lease_minutes)
        stmt = (
            select(EnrollmentNotificacionOutbox)
            .where(
                or_(
                    and_(
                        EnrollmentNotificacionOutbox.status == "PENDIENTE",
                        EnrollmentNotificacionOutbox.attempts < MAX_ATTEMPTS,
                        EnrollmentNotificacionOutbox.next_attempt_at <= now,
                    ),
                    # Sin el tope de intentos acá: una fila reclamada en su
                    # último intento (`attempts` llega a MAX_ATTEMPTS al
                    # reclamarla) cuyo worker muere antes de `requeue` queda
                    # `ENVIANDO` para siempre si este branch también exige
                    # `attempts < MAX_ATTEMPTS`. El siguiente `requeue` ya
                    # resuelve a `AGOTADO` porque `attempts >= MAX_ATTEMPTS`.
                    and_(
                        EnrollmentNotificacionOutbox.status == "ENVIANDO",
                        EnrollmentNotificacionOutbox.claimed_at < stale,
                    ),
                ),
            )
            .order_by(EnrollmentNotificacionOutbox.next_attempt_at, EnrollmentNotificacionOutbox.id)
            .with_for_update(skip_locked=True)
            .limit(1)
        )
        event = self.db.execute(stmt).scalar_one_or_none()
        if event:
            event.status = "ENVIANDO"
            event.claimed_at = now
            event.attempts += 1
        return event

    def requeue(self, event, error: Exception) -> None:
        now = datetime.now(timezone.utc)
        event.status = "AGOTADO" if event.attempts >= MAX_ATTEMPTS else "PENDIENTE"
        event.next_attempt_at = now + timedelta(minutes=min(2 ** max(event.attempts - 1, 0), 60))
        event.claimed_at = None
        event.last_error_redacted = f"{type(error).__name__}: delivery failed"

    def mark_sent(self, event) -> None:
        event.status = "ENVIADO"
        event.sent_at = datetime.now(timezone.utc)
        event.claimed_at = None
