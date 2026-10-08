"""Reclamo con lease y backoff, compartido por las colas de correo.

Recuperación (#764), verificación (#790) y la cola genérica de correos
(#1710) entregan por SMTP con la MISMA política de reintentos: una política
distinta por cola sería una diferencia sin razón que alguien descubriría a las
malas. Antes cada cola tenía su copia de esta clase, y las copias ya se habían
separado: verificación no tenía el arreglo del #791 para el lease vencido en
el último intento. Ahora la política vive una sola vez y cada cola solo dice
sobre qué modelo trabaja.
"""
from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, or_, select

from app.infraestructura.repositorios import outbox_auditoria_entrega as auditoria

MAX_ATTEMPTS = 6


class ColaConLeaseRepositorio:
    """Subclases fijan `modelo`: una tabla con `status`, `attempts`,
    `next_attempt_at`, `claimed_at`, `expires_at`, `sent_at` y
    `last_error_redacted`."""

    modelo = None

    def __init__(self, db):
        self.db = db

    def claim_pending(self, lease_minutes=10):
        """`skip_locked`: dos workers concurrentes toman filas distintas en vez
        de bloquearse uno contra el otro. No commitea -- eso es del llamador."""
        modelo = self.modelo
        now = datetime.now(timezone.utc)
        stale = now - timedelta(minutes=lease_minutes)
        stmt = (
            select(modelo)
            .where(
                modelo.expires_at > now,
                or_(
                    and_(
                        modelo.status == "PENDIENTE",
                        modelo.next_attempt_at <= now,
                        modelo.attempts < MAX_ATTEMPTS,
                    ),
                    # Lease vencido: el worker que la reclamó se cayó sin
                    # resolverla. Sin el tope de intentos acá (issue #791):
                    # una fila reclamada en su último intento cuyo worker
                    # muere antes de `requeue` quedaría `ENVIANDO` para
                    # siempre, porque ninguna limpieza retira `ENVIANDO`. El
                    # `requeue` siguiente ya la resuelve a `AGOTADO`.
                    and_(
                        modelo.status == "ENVIANDO",
                        modelo.claimed_at < stale,
                    ),
                ),
            )
            .order_by(modelo.next_attempt_at, modelo.id)
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
        # Un fallo TAMBIÉN es un desenlace: la marca va acá y no en el
        # llamador para que no exista un camino que la olvide (issue #839).
        auditoria.marcar_entrega_resuelta(evento)

    def mark_sent(self, evento):
        evento.status, evento.sent_at, evento.claimed_at = (
            "ENVIADO",
            datetime.now(timezone.utc),
            None,
        )
        auditoria.marcar_entrega_resuelta(evento)
