"""Tarea de latido del beat/worker (PC-2); ver `latido_workers`."""
import redis

from app.infraestructura import latido_workers
from app.infraestructura.tareas.celery_app import celery_app
from app.soporte_transversal.configuracion import settings

_TIMEOUT_REDIS_S = 2


def _cliente_redis() -> redis.Redis:
    return redis.Redis.from_url(
        settings.redis_url,
        socket_connect_timeout=_TIMEOUT_REDIS_S,
        socket_timeout=_TIMEOUT_REDIS_S,
    )


@celery_app.task(
    name="app.infraestructura.tareas.latido_tareas.registrar_latido",
    soft_time_limit=10,
    time_limit=20,
)
def registrar_latido() -> bool:
    latido_workers.registrar(_cliente_redis())
    return True
