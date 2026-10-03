"""Salud del sistema para "Actividad del club" (QA4 ADMB-N1).

Cruza el latido de los workers (`latido_workers`, escrito por Celery cada
minuto) con la edad del correo más antiguo en cola. Los correos salen por
tareas de Celery: sin latido no hay envío, aunque la app y la base estén bien.
"""
from app.servicios_negocio.dtos.actividad_schemas import ComponenteDegradado, SaludSistema

# El beat late cada 60 s y la clave expira a los 180 s: dos latidos perdidos
# (120 s) ya es una falla, sin esperar a que la clave desaparezca.
MAX_EDAD_LATIDO_S = 120
# Igual que el corte "warn" de notificaciones (30 min): un correo esperando más
# que eso no es una cola normal.
MAX_EDAD_OUTBOX_S = 30 * 60


def evaluar(edad_latido_s: float | None, outbox_mas_antiguo_s: int | None) -> SaludSistema:
    componentes: list[ComponenteDegradado] = []
    if edad_latido_s is None or edad_latido_s > MAX_EDAD_LATIDO_S:
        motivo = "heartbeat_missing" if edad_latido_s is None else "heartbeat_stale"
        componentes = [ComponenteDegradado(key=k, reason=motivo) for k in ("workers", "email", "outbox")]
    elif outbox_mas_antiguo_s is not None and outbox_mas_antiguo_s > MAX_EDAD_OUTBOX_S:
        componentes = [ComponenteDegradado(key=k, reason="outbox_stale") for k in ("email", "outbox")]
    degradado = bool(componentes)
    return SaludSistema(
        state="degraded" if degradado else "ok",
        degraded=degradado,
        heartbeatAgeSeconds=None if edad_latido_s is None else int(edad_latido_s),
        components=componentes,
    )
