"""Configuración de logging del proceso backend (issue #554).

Antes de este módulo NO existía configuración de logging en la app: uvicorn
arranca sin `--log-config`, así que el logger raíz quedaba sin handlers.
Consecuencia: todo INFO/DEBUG de `cataclub.*` (los `_log.info` de main.py,
los servicios de negocio) se descartaba en silencio vía `logging.lastResort`,
y los WARNING+ salían a stderr pelados — sin timestamp, sin nivel, sin nombre
de logger y sin el `request_id` que el middleware de correlación ya calcula.

`configurar_logging()` instala vía `dictConfig` UN StreamHandler a stdout
sobre el logger RAÍZ (todos los `cataclub.*` propagan hasta ahí), con
timestamp, nivel, nombre del logger, `request_id` y mensaje, al nivel que
fija el ajuste `LOG_LEVEL` (default INFO). Sin proveedores externos: Sentry/
OTel son una decisión de producto aparte, no de este módulo.

Convivencia con uvicorn: `disable_existing_loggers=False` y SOLO el raíz
configurado. Los loggers `uvicorn`, `uvicorn.error` y `uvicorn.access`
conservan sus propios handlers y su `propagate=False`, así que el access log
sigue saliendo igual que siempre y no se duplica por el raíz.

Convivencia con Celery: los workers (docker-compose.yml, servicios
`celery-worker` y `celery-beat`) NO llaman a esta función, a propósito.
Celery configura su propio logging al arrancar y, con el default
`worker_hijack_root_logger=True`, REEMPLAZA los handlers del raíz por los
suyos: cualquier cosa que se instale acá antes sería pisada, y pelear ese
hijack (desactivarlo + señales `setup_logging`) cambiaría el formato que los
`--loglevel=info` de los workers ya emiten hoy. Bajo Celery los registros de
`cataclub.*` ya llegan a los handlers del hijack por propagación al raíz —
no hay pérdida que arreglar ahí.
"""
import logging
from logging.config import dictConfig
from typing import Optional

from app.soporte_transversal.configuracion import settings

# Formato único del proceso. `request_id` viene del extra que pasan los
# handlers de main.py; `FiltroRequestId` garantiza que el atributo exista en
# TODO registro (default "-"), así un log de un módulo que no conoce la
# correlación jamás rompe el formateo con un KeyError.
_FORMATO = (
    "%(asctime)s %(levelname)s %(name)s [request_id=%(request_id)s] %(message)s"
)

# Guard de idempotencia: `configurar_logging()` corre en el import de main.py,
# y las suites de test re-importan main sin re-crear el proceso. Sin el guard,
# cada re-import re-ejecutaría dictConfig y pisaría los handlers que pytest
# (caplog/capsys) cuelga del raíz durante una prueba.
_ya_configurado = False


class FiltroRequestId(logging.Filter):
    """Inyecta `request_id="-"` en los registros que no lo traen.

    Un formatter con `%(request_id)s` lanza si el atributo falta; este filtro
    convierte esa bomba en un default inocuo, sin obligar a cada caller a
    acordarse del extra.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        if not hasattr(record, "request_id"):
            record.request_id = "-"
        return True


def configurar_logging(nivel: Optional[str] = None, *, forzar: bool = False) -> None:
    """Configura el logger raíz del proceso. Llamar UNA vez, al arrancar.

    `nivel` sobreescribe `settings.log_level` (lo usan las pruebas).
    `forzar=True` re-aplica la configuración aunque ya haya corrido — solo
    para pruebas, donde capsys sustituye stdout y el handler viejo quedaría
    apuntando al stream anterior. dictConfig REEMPLAZA los handlers del raíz,
    así que ni siquiera `forzar` puede acumular duplicados.
    """
    global _ya_configurado
    if _ya_configurado and not forzar:
        return

    dictConfig(
        {
            "version": 1,
            # False: los loggers ya creados (uvicorn, celery, terceros)
            # conservan sus handlers y su configuración; acá solo se define
            # el raíz.
            "disable_existing_loggers": False,
            "filters": {
                "request_id": {"()": FiltroRequestId},
            },
            "formatters": {
                "estandar": {"format": _FORMATO},
            },
            "handlers": {
                "stdout": {
                    "class": "logging.StreamHandler",
                    "stream": "ext://sys.stdout",
                    "formatter": "estandar",
                    "filters": ["request_id"],
                },
            },
            "root": {
                "handlers": ["stdout"],
                "level": (nivel or settings.log_level).upper(),
            },
        }
    )
    _ya_configurado = True
