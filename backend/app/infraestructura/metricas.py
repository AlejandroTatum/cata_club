"""Colector Prometheus a demanda para las tres colas outbox (issue #1309).

`GET /metrics` es la única otra pieza de este trabajo (ver `main.py`); ese
endpoint lo arma `prometheus-fastapi-instrumentator` y ya cubre latencia,
conteo por status e in-flight vía `Instrumentator().instrument(app)`. Lo que
falta -- y lo que vive acá -- es la profundidad de las tres colas: cuántas
filas siguen PENDIENTE por tabla y hace cuánto está esperando la más
antigua. Un socio que avisa porque un correo no llegó es el síntoma que este
issue busca reemplazar por una serie que un operador puede mirar antes.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from prometheus_client.core import GaugeMetricFamily
from prometheus_client.registry import Collector
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.dominio.modelos import (
    EnrollmentNotificacionOutbox,
    RecuperacionOutbox,
    VerificacionCorreoOutbox,
)
from app.infraestructura.db import SessionLocal

_log = logging.getLogger("cataclub.infraestructura.metricas")

ESTADO_PENDIENTE = "PENDIENTE"

# Techo de cada consulta del scrape (issue #1309, R3): sin esto, un Postgres
# colgado deja la sesión del scrape esperando indefinidamente -- retiene una
# conexión del pool (`db.py::engine`, `pool_size=10 + max_overflow=20`) Y el
# hilo del threadpool de FastAPI que corre el handler síncrono de `/metrics`
# (ver el comentario en `main.py`). Un scraper que reintenta cada N segundos
# apila scrapes colgados sobre el mismo pool que usan las requests de
# negocio, y termina agotándolo -- el mismo criterio que
# `TIMEOUT_SENTENCIA_POSTGRES_MS` en `main.py::_evaluar_readiness`, un techo
# corto porque el costo de fallar rápido (un `scrape_ok 0`) es minúsculo
# comparado con el de arrastrar el pool entero a una espera sin límite.
TIMEOUT_SCRAPE_SENTENCIA_MS = 2000

# (nombre real de tabla, clase ORM). El nombre expuesto en la etiqueta
# `tabla` es el `__tablename__`, no un alias: tiene que coincidir 1:1 con lo
# que un operador ve mirando la base directamente.
_TABLAS_OUTBOX: tuple[tuple[str, type], ...] = (
    (EnrollmentNotificacionOutbox.__tablename__, EnrollmentNotificacionOutbox),
    (RecuperacionOutbox.__tablename__, RecuperacionOutbox),
    (VerificacionCorreoOutbox.__tablename__, VerificacionCorreoOutbox),
)


def calcular_pendientes_por_tabla(db: Session) -> dict[str, tuple[int, float]]:
    """Para cada tabla outbox: `(filas PENDIENTE, edad en segundos de la más
    antigua; 0.0 si no hay ninguna)`.

    Una sola consulta agregada por tabla (`COUNT` + `MIN`), ambas cubiertas
    por el índice `..._pending_next` que el despacho ya usa (`status` es su
    columna más a la izquierda) -- no agrega presión de lectura nueva sobre
    las mismas tres tablas.
    """
    ahora = datetime.now(timezone.utc)
    resultado: dict[str, tuple[int, float]] = {}
    for nombre_tabla, modelo in _TABLAS_OUTBOX:
        cantidad, mas_antigua = db.execute(
            select(func.count(modelo.id), func.min(modelo.created_at))
            .where(modelo.status == ESTADO_PENDIENTE)
        ).one()
        if mas_antigua is None:
            edad_segundos = 0.0
        else:
            if mas_antigua.tzinfo is None:
                mas_antigua = mas_antigua.replace(tzinfo=timezone.utc)
            edad_segundos = max(0.0, (ahora - mas_antigua).total_seconds())
        resultado[nombre_tabla] = (cantidad or 0, edad_segundos)
    return resultado


def _familias_vacias() -> tuple[GaugeMetricFamily, GaugeMetricFamily, GaugeMetricFamily]:
    """Las tres familias de gauges, SIN muestras -- mismo nombre, help y
    labels que `ColectorOutbox.collect()` termina poblando. La usan tanto
    `describe()` (para declarar los nombres sin tocar la BD) como
    `collect()` (que arranca de acá y después las llena)."""
    gauge_pendientes = GaugeMetricFamily(
        "cata_outbox_pendientes",
        "Filas en estado PENDIENTE por tabla outbox.",
        labels=["tabla"],
    )
    gauge_edad = GaugeMetricFamily(
        "cata_outbox_pendiente_mas_antiguo_segundos",
        "Edad en segundos de la fila PENDIENTE mas antigua por tabla outbox (0 si no hay ninguna).",
        labels=["tabla"],
    )
    gauge_scrape_ok = GaugeMetricFamily(
        "cata_outbox_scrape_ok",
        "1 si la ultima consulta a las tablas outbox tuvo exito, 0 si fallo.",
    )
    return gauge_pendientes, gauge_edad, gauge_scrape_ok


class ColectorOutbox(Collector):
    """Colector Prometheus que corre sus consultas recién cuando `/metrics`
    lo pide -- no acumula estado entre scrapes, así que no hay contador que
    se desincronice de la base mientras nadie lo mira.

    Una falla de BD durante el scrape NO debe tumbar `/metrics` (issue
    #1309, criterio de cierre): se captura, se loguea y el scrape sigue con
    `cata_outbox_scrape_ok 0`, conservando las series HTTP que
    `prometheus-fastapi-instrumentator` ya agregó.

    `sesion_factory` es inyectable a propósito: los tests monkeypatchean la
    factory de la instancia registrada para simular la falla de BD sin
    tocar la conexión real -- ver `test_metricas.py`."""

    def __init__(self, sesion_factory=SessionLocal):
        self.sesion_factory = sesion_factory

    def describe(self):
        """Declara los NOMBRES de las tres series sin tocar la BD (issue
        #1309, defecto de import encontrado en revisión nativa).
        `CollectorRegistry` default de `prometheus_client`
        (`REGISTRY = CollectorRegistry(auto_describe=True)`) llama a
        `collect()` DENTRO de `register()` cuando un colector no define
        `describe()`, para saber qué nombres declara y detectar colisiones.

        Sin este método, `REGISTRY.register(colector_outbox)` en `main.py`
        corría el scrape completo -- abrir sesión, tres consultas -- al
        IMPORTAR el módulo, antes de que uvicorn sirviera un solo request:
        con Postgres todavía sin aceptar conexiones (orden de arranque de
        Compose, un restart de la base), el import se colgaba esperando el
        connect TCP, algo que `TIMEOUT_SCRAPE_SENTENCIA_MS` no cubre (ese
        timeout es un `SET LOCAL statement_timeout` DENTRO de una
        transacción ya abierta; nunca llega a correr ninguna sentencia si
        la conexión ni siquiera se estableció)."""
        return _familias_vacias()

    def collect(self):
        gauge_pendientes, gauge_edad, gauge_scrape_ok = _familias_vacias()

        db = None
        try:
            db = self.sesion_factory()
            # `SET LOCAL` -- no `SET` a secas -- así el techo dura solo la
            # transacción de este scrape: al cerrar la sesión (`finally`,
            # abajo) el rollback implícito lo descarta, y la conexión vuelve
            # al pool sin arrastrar el límite a quien la reciba después. El
            # alcance transaccional lo prueba
            # `test_metricas.py::test_scrape_fija_el_statement_timeout_y_no_escapa_de_su_transaccion`
            # (con `SET`, el límite sobrevive al commit de la conexión).
            db.execute(text(f"SET LOCAL statement_timeout = {TIMEOUT_SCRAPE_SENTENCIA_MS}"))
            for nombre_tabla, (cantidad, edad_segundos) in calcular_pendientes_por_tabla(db).items():
                gauge_pendientes.add_metric([nombre_tabla], cantidad)
                gauge_edad.add_metric([nombre_tabla], edad_segundos)
            gauge_scrape_ok.add_metric([], 1)
        except Exception:
            _log.warning("Scrape de métricas outbox: fallo la consulta a BD", exc_info=True)
            gauge_scrape_ok.add_metric([], 0)
        finally:
            if db is not None:
                db.close()

        yield gauge_pendientes
        yield gauge_edad
        yield gauge_scrape_ok


# Instancia única registrada en el REGISTRY default de prometheus_client
# (ver `main.py`): un solo colector por proceso, igual que el resto de las
# series que expone `/metrics`.
colector_outbox = ColectorOutbox()
