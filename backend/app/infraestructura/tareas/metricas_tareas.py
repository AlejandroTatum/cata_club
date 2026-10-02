"""Tareas del colector de métricas y su retención (issue #1314)."""
import logging
from datetime import datetime, timezone

import redis

from app.infraestructura import colector_metricas, presencia
from app.infraestructura.db import SessionLocal
from app.infraestructura.tareas.celery_app import celery_app
from app.soporte_transversal.configuracion import settings

_log = logging.getLogger("cataclub.tareas.metricas")

# Redis del colector: sus propios timeouts cortos. Un Redis mudo no puede dejar
# la tarea colgada hasta el límite duro de Celery, que pisaría a la siguiente.
_TIMEOUT_REDIS_S = 2


# Límites propios, por debajo del minuto del beat: una corrida que se alarga
# no debe solaparse con la siguiente en un worker de `--concurrency=1`.
@celery_app.task(
    name="app.infraestructura.tareas.metricas_tareas.capturar_metricas",
    soft_time_limit=40,
    time_limit=50,
)
def capturar_metricas() -> bool:
    """Una instantánea (ver `colector_metricas.recolectar`). Devuelve False, sin
    lanzar, cuando no hubo dato: un backend caído no debe llenar el log de
    tracebacks de Celery cada minuto; la ausencia de filas ya lo cuenta."""
    cliente_redis = redis.Redis.from_url(
        settings.redis_url, socket_connect_timeout=_TIMEOUT_REDIS_S, socket_timeout=_TIMEOUT_REDIS_S,
    )
    with SessionLocal() as db:
        fila = colector_metricas.recolectar(
            db,
            ahora=datetime.now(timezone.utc),
            scrapear=lambda: colector_metricas.scrapear_metricas(),
            redis_cliente=cliente_redis,
            archivo_host=settings.metricas_archivo_host,
            conectados=presencia.contar,
        )
    return fila is not None


@celery_app.task(name="app.infraestructura.tareas.metricas_tareas.purgar_metricas_y_actividad")
def purgar_metricas_y_actividad() -> dict:
    with SessionLocal() as db:
        instantaneas, actividad = colector_metricas.purgar(db, datetime.now(timezone.utc))
        db.commit()
    return {"instantaneas": instantaneas, "actividad": actividad}
