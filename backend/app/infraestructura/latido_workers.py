"""Latido de Celery para el monitor externo (PC-2).

El beat despacha `registrar_latido` cada minuto y un worker lo ejecuta y
escribe `CLAVE` en Redis con TTL. Que la clave exista prueba beat, broker y
worker vivos a la vez; si cualquiera muere, el TTL la hace expirar.

Es una señal PARA EL MONITOR EXTERNO (`/health/workers`). Ningún healthcheck
de Docker ni `autoheal` debe leerla: un cuelgue de Celery reiniciaría el
backend.
"""
from datetime import datetime, timezone

CLAVE = "cataclub:latido:workers"

# Tres intervalos del beat (60 s): tolera dos latidos perdidos antes de dar 503.
TTL_SEGUNDOS = 180


def registrar(cliente_redis) -> None:
    cliente_redis.set(CLAVE, datetime.now(timezone.utc).isoformat(), ex=TTL_SEGUNDOS)


def vivo(cliente_redis) -> bool:
    """Redis caído cuenta como muerto: la sonda nunca debe terminar en 500."""
    try:
        return cliente_redis.get(CLAVE) is not None
    except Exception:
        return False


def edad_segundos(cliente_redis, ahora: datetime) -> float | None:
    """Segundos desde el último latido, o `None` si falta, es ilegible o Redis
    no responde (para el estado del sistema, "no sé" cuenta como degradado)."""
    try:
        crudo = cliente_redis.get(CLAVE)
        if crudo is None:
            return None
        if isinstance(crudo, bytes):
            crudo = crudo.decode()
        marca = datetime.fromisoformat(crudo)
    except Exception:
        return None
    if marca.tzinfo is None:
        marca = marca.replace(tzinfo=timezone.utc)
    return max(0.0, (ahora - marca).total_seconds())
