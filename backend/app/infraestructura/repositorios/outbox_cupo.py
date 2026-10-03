"""
Diferimiento por tope diario de correos de las colas de salida (QA3, MAIL-CAP).

Cuando el cupo diario del proveedor se agota, la entrega de una fila del
outbox no falló ni se completó: no hay NADA que reintentar hoy. Por eso no
pasa por `requeue` (que gasta un intento y usa backoff de minutos) sino por
`diferir_hasta_manana`: la fila sigue `PENDIENTE`, recupera el intento que el
reclamo le cobró y no vuelve a ser elegible hasta que el contador del día
siguiente (UTC, el mismo día de `contador_correo_diario`) arranque de cero.
El beat de cada cola, que ya corre cada minuto, la recoge sola.

La marca en `last_error_redacted` es lo que permite contar cuántas filas
esperan por el cupo sin una columna nueva.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from app.dominio.modelos import RecuperacionOutbox, VerificacionCorreoOutbox
from app.infraestructura.repositorios import outbox_auditoria_entrega as auditoria

MARCA_CUPO_AGOTADO = "CupoCorreoDiarioAgotado"

VIGENCIA_TRAS_DIFERIR = timedelta(hours=24)

_COLAS_CON_CUPO = (RecuperacionOutbox, VerificacionCorreoOutbox)


def inicio_del_dia_siguiente_utc(ahora: datetime | None = None) -> datetime:
    ahora = ahora or datetime.now(timezone.utc)
    return datetime.combine(
        ahora.date() + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc
    )


def diferir_hasta_manana(evento) -> None:
    """Devuelve la fila a `PENDIENTE` sin costo para ella: el reclamo cobró un
    intento y la entrega iniciada sumó una, y ninguna de las dos ocurrió."""
    evento.status = "PENDIENTE"
    evento.attempts = max((evento.attempts or 0) - 1, 0)
    evento.entregas_intentadas = max((evento.entregas_intentadas or 0) - 1, 0)
    evento.next_attempt_at = inicio_del_dia_siguiente_utc()
    # Sin esto una fila que vence hoy se retira como "nunca enviada" antes de
    # poder reintentarse: mientras espera el cupo, su vigencia se corre.
    evento.expires_at = max(
        evento.expires_at, evento.next_attempt_at + VIGENCIA_TRAS_DIFERIR
    )
    evento.claimed_at = None
    evento.last_error_redacted = f"{MARCA_CUPO_AGOTADO}: diferido hasta el día siguiente"
    auditoria.marcar_entrega_resuelta(evento)


def contar_en_espera_por_cupo(db) -> int:
    """Filas que hoy esperan por el tope diario de correos (todas las colas)."""
    return sum(
        db.execute(
            select(func.count(modelo.id)).where(
                modelo.status == "PENDIENTE",
                modelo.last_error_redacted.like(f"{MARCA_CUPO_AGOTADO}%"),
            )
        ).scalar_one()
        for modelo in _COLAS_CON_CUPO
    )
