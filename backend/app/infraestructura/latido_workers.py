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
