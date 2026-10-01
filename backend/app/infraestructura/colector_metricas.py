"""Colector de métricas del club (issue #1314): una instantánea por minuto.

Una iteración (`recolectar`) hace UN scrape HTTP de `/metrics` por la red de
Compose y UN insert en `metrica_instantanea`, más lecturas baratas de lo que
`/metrics` no expone: conexiones de Postgres (`pg_stat_activity`), memoria y
cola de Redis, presencia, y el archivo que escribe el cron del host.

Por qué un scrape de `/metrics` y no consultar directo: ahí ya vive la
contabilidad HTTP (histogramas por ruta, conteo por status) y los gauges del
outbox (#1309); el colector la reutiliza en vez de duplicarla.

Los contadores de `/metrics` son ACUMULADOS desde el arranque del backend. La
instantánea guarda DELTAS contra el scrape anterior, que se recuerda en Redis
(`CLAVE_ESTADO_PREVIO`): el worker de Celery corre con `--concurrency=1`, así
que no hay carreras sobre esa clave. Un reinicio del backend se detecta porque
un acumulado BAJA; en ese caso el valor actual es el delta (todo lo ocurrido
desde que arrancó). Sin estado previo (primer scrape, Redis vacío o un hueco
mayor a `MAX_HUECO_S`) no se inventa ningún delta: las columnas quedan NULL.

Agregados nada más: ni IPs, ni identidades, ni versiones. Las rutas son
plantillas (`/api/v1/personas/{persona_id}`), nunca URLs concretas.
"""
from __future__ import annotations

import json
import logging
import re
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

from prometheus_client.parser import text_string_to_metric_families
from sqlalchemy import delete, text
from sqlalchemy.orm import Session

from app.dominio.modelos import ActividadUsuario, MetricaInstantanea
from app.infraestructura.metricas import BUCKETS_LATENCIA_POR_RUTA, TIMEOUT_SCRAPE_SENTENCIA_MS
from app.soporte_transversal.configuracion import settings
from app.soporte_transversal.tiempo import hoy_club

_log = logging.getLogger("cataclub.infraestructura.colector_metricas")

CLAVE_ESTADO_PREVIO = "metricas:estado_previo"
TTL_ESTADO_PREVIO_S = 900
# Un hueco mayor a esto entre dos scrapes (colector caído, deploy) hace que el
# delta ya no represente "el último minuto": se descarta en vez de promediarlo.
MAX_HUECO_S = 300
# Frescura del archivo del host: pasados 3 minutos sin reescribirse (el cron
# corre cada 1) el cron está caído y el dato ya no describe el presente.
MAX_EDAD_HOST_S = 180
TIMEOUT_SCRAPE_HTTP_S = 5
COLA_CELERY = "celery"
# Retención. Instantáneas: el rango máximo de "Métricas avanzadas" (7 d).
# Actividad: el de "Resumen" son 30 días más el día en curso; 35 deja margen.
RETENCION_INSTANTANEAS = timedelta(days=7)
RETENCION_ACTIVIDAD_DIAS = 35
MAX_RUTAS_POR_INSTANTANEA = 15

# Rutas de sondeo: las pide la infraestructura (healthchecks, este mismo
# scrape), no los usuarios. Contarlas inflaría las peticiones por minuto y
# achicaría la latencia mostrada. "none" es el handler que la librería asigna a
# lo que no matchea ninguna ruta (404 de escáneres): cuenta como petición y
# como error 4xx, pero no es una ruta con nombre para el ranking.
RUTAS_DE_SONDEO = frozenset({"/metrics", "/health", "/health/ready", "/"})
RUTA_SIN_PLANTILLA = "none"

_LES = tuple(f"{b:g}" for b in BUCKETS_LATENCIA_POR_RUTA) + ("+Inf",)
_LIMITES_FINITOS_MS = tuple(b * 1000 for b in BUCKETS_LATENCIA_POR_RUTA)
_NOMBRE_CONTENEDOR = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$")


def _normalizar_le(valor: str) -> str:
    return "+Inf" if valor == "+Inf" else f"{float(valor):g}"


@dataclass
class LecturaScrape:
    """Acumulados (desde el arranque del backend) leídos de un scrape."""

    peticiones: float = 0.0
    errores_4xx: float = 0.0
    errores_5xx: float = 0.0
    # "METHOD /plantilla" -> acumulados por borde, en el orden de `_LES`.
    rutas: dict[str, list[float]] = field(default_factory=dict)
    logins_ok: float = 0.0
    logins_fallidos: float = 0.0
    outbox_pendientes: int | None = None
    outbox_mas_antiguo_s: float | None = None

    def a_json(self) -> dict:
        return {
            "peticiones": self.peticiones, "errores_4xx": self.errores_4xx, "errores_5xx": self.errores_5xx,
            "rutas": self.rutas, "logins_ok": self.logins_ok, "logins_fallidos": self.logins_fallidos,
        }

    @classmethod
    def de_json(cls, datos: dict) -> "LecturaScrape":
        return cls(
            peticiones=datos["peticiones"], errores_4xx=datos["errores_4xx"], errores_5xx=datos["errores_5xx"],
            rutas={k: list(v) for k, v in datos["rutas"].items()},
            logins_ok=datos["logins_ok"], logins_fallidos=datos["logins_fallidos"],
        )


@dataclass
class Delta:
    intervalo_s: int | None = None
    peticiones: int | None = None
    errores_4xx: int | None = None
    errores_5xx: int | None = None
    logins_ok: int | None = None
    logins_fallidos: int | None = None
    latencia: list[int] | None = None
    rutas: dict[str, list[int]] = field(default_factory=dict)


def _acumular_peticion(lectura: LecturaScrape, etiquetas: dict, valor: float) -> None:
    if etiquetas.get("handler") in RUTAS_DE_SONDEO:
        return
    lectura.peticiones += valor
    if etiquetas.get("status") == "4xx":
        lectura.errores_4xx += valor
    elif etiquetas.get("status") == "5xx":
        lectura.errores_5xx += valor


def _acumular_login(lectura: LecturaScrape, etiquetas: dict, valor: float) -> None:
    if etiquetas.get("resultado") == "ok":
        lectura.logins_ok = valor
    elif etiquetas.get("resultado") == "fallido":
        lectura.logins_fallidos = valor


def parsear_exposicion(texto: str) -> LecturaScrape:
    lectura = LecturaScrape()
    por_ruta: dict[str, dict[str, float]] = {}
    pendientes: list[float] = []
    antiguedades: list[float] = []
    scrape_ok = 1.0
    for familia in text_string_to_metric_families(texto):
        for muestra in familia.samples:
            nombre, etiquetas, valor = muestra.name, muestra.labels, muestra.value
            if nombre == "http_requests_total":
                _acumular_peticion(lectura, etiquetas, valor)
            elif nombre == "http_request_duration_seconds_bucket":
                handler = etiquetas.get("handler", "")
                if handler not in RUTAS_DE_SONDEO and handler != RUTA_SIN_PLANTILLA:
                    clave = f"{etiquetas.get('method', '')} {handler}"
                    por_ruta.setdefault(clave, {})[_normalizar_le(etiquetas["le"])] = valor
            elif nombre == "cata_login_total":
                _acumular_login(lectura, etiquetas, valor)
            elif nombre == "cata_outbox_pendientes":
                pendientes.append(valor)
            elif nombre == "cata_outbox_pendiente_mas_antiguo_segundos":
                antiguedades.append(valor)
            elif nombre == "cata_outbox_scrape_ok":
                scrape_ok = valor
    # Buckets de otra versión del backend (deploy en curso): la ruta se omite.
    lectura.rutas = {
        clave: [bordes[le] for le in _LES] for clave, bordes in por_ruta.items() if all(le in bordes for le in _LES)
    }
    if scrape_ok and pendientes:
        lectura.outbox_pendientes = int(sum(pendientes))
        lectura.outbox_mas_antiguo_s = max(antiguedades, default=0.0)
    return lectura


def _delta_contador(previo: float, actual: float) -> int:
    return int(actual if actual < previo else actual - previo)


def calcular_delta(previa: LecturaScrape | None, actual: LecturaScrape, intervalo_s: int | None) -> Delta:
    if previa is None or intervalo_s is None:
        return Delta()
    delta = Delta(
        intervalo_s=intervalo_s,
        peticiones=_delta_contador(previa.peticiones, actual.peticiones),
        errores_4xx=_delta_contador(previa.errores_4xx, actual.errores_4xx),
        errores_5xx=_delta_contador(previa.errores_5xx, actual.errores_5xx),
        logins_ok=_delta_contador(previa.logins_ok, actual.logins_ok),
        logins_fallidos=_delta_contador(previa.logins_fallidos, actual.logins_fallidos),
    )
    total = [0] * len(_LES)
    for clave, acumulados in actual.rutas.items():
        anteriores = previa.rutas.get(clave)
        if anteriores is None or acumulados[-1] < anteriores[-1]:
            por_borde = [int(v) for v in acumulados]  # ruta nueva o reinicio: todo es nuevo
        else:
            por_borde = [max(0, int(a - p)) for a, p in zip(acumulados, anteriores)]
        if por_borde[-1] == 0:
            continue
        delta.rutas[clave] = por_borde
        total = [t + v for t, v in zip(total, por_borde)]
    delta.latencia = total
    return delta


def percentil_ms(acumulados: list[int] | list[float], cuantil: float) -> float | None:
    """Percentil en milisegundos sobre buckets ACUMULADOS (como
    `histogram_quantile` de Prometheus): interpola linealmente dentro del
    bucket que contiene el rango. Lo que cae en el bucket `+Inf` se acota al
    último borde finito (10 s): no se conoce, solo que es al menos eso."""
    total = acumulados[-1]
    if not total:
        return None
    rango = cuantil * total
    previo_n = 0.0
    previo_limite = 0.0
    for limite, n in zip(_LIMITES_FINITOS_MS, acumulados):
        if n >= rango:
            if n == previo_n:
                return limite
            return previo_limite + (limite - previo_limite) * (rango - previo_n) / (n - previo_n)
        previo_n, previo_limite = n, limite
    return _LIMITES_FINITOS_MS[-1]


# --- host -----------------------------------------------------------------
def leer_host(archivo: Path | str | None, ahora: datetime) -> dict | None:
    """Lee el JSON que escribe `scripts/metrics/host-snapshot.sh`.

    Devuelve None -- "no disponible", nunca una excepción ni un cero -- si el
    archivo falta, no se puede leer, está mal formado o tiene más de
    `MAX_EDAD_HOST_S`. Solo pasa lo que el esquema espera: un campo extra del
    archivo (un hostname, una IP) no llega a la base.
    """
    if archivo is None:
        return None
    try:
        crudo = json.loads(Path(archivo).read_text())
        escrito_en = datetime.fromtimestamp(int(crudo["escrito_en"]), tz=timezone.utc)
        if (ahora - escrito_en).total_seconds() > MAX_EDAD_HOST_S:
            return None
        host = {
            "actualizado_en": escrito_en,
            "cpu_pct": float(crudo["cpu_pct"]),
            "ram_usada_mb": int(crudo["ram_usada_mb"]),
            "ram_total_mb": int(crudo["ram_total_mb"]),
            "swap_usada_mb": int(crudo["swap_usada_mb"]),
            "swap_total_mb": int(crudo["swap_total_mb"]),
            "disco_pct": float(crudo["disco_pct"]),
        }
    except (OSError, ValueError, KeyError, TypeError):
        return None
    contenedores = []
    for item in crudo.get("contenedores") or []:
        try:
            nombre = item["nombre"]
            if not isinstance(nombre, str) or not _NOMBRE_CONTENEDOR.match(nombre):
                continue
            contenedores.append(
                {"nombre": nombre, "usado_mb": int(item["usado_mb"]), "limite_mb": int(item["limite_mb"])}
            )
        except (KeyError, ValueError, TypeError):
            continue
    host["contenedores"] = contenedores
    return host


# --- fuentes por defecto ----------------------------------------------------
def scrapear_metricas() -> str:
    with urllib.request.urlopen(settings.metricas_url_scrape, timeout=TIMEOUT_SCRAPE_HTTP_S) as respuesta:  # noqa: S310
        return respuesta.read().decode("utf-8")


def _estado_de_redis(redis_cliente) -> tuple[int | None, float | None, float | None]:
    try:
        memoria = redis_cliente.info("memory")
        cola = redis_cliente.llen(COLA_CELERY)
    except Exception:
        _log.warning("Colector: Redis no respondió", exc_info=True)
        return None, None, None
    mb = 1024 * 1024
    maximo = memoria.get("maxmemory") or 0
    return int(cola), memoria["used_memory"] / mb, (maximo / mb if maximo else None)


def _estado_de_postgres(db: Session) -> tuple[int | None, int | None]:
    try:
        # Mismo techo que los gauges de `/metrics` (#1309/#1313).
        db.execute(text(f"SET LOCAL statement_timeout = {TIMEOUT_SCRAPE_SENTENCIA_MS}"))
        usadas = db.execute(
            text("SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()")
        ).scalar_one()
        maximo = db.execute(text("SELECT current_setting('max_connections')::int")).scalar_one()
        return int(usadas), int(maximo)
    except Exception:
        _log.warning("Colector: no se pudo leer pg_stat_activity", exc_info=True)
        db.rollback()
        return None, None


def _cargar_previo(redis_cliente, ahora: datetime) -> tuple[LecturaScrape | None, int | None]:
    try:
        crudo = redis_cliente.get(CLAVE_ESTADO_PREVIO)
        if not crudo:
            return None, None
        guardado = json.loads(crudo)
        intervalo = round(ahora.timestamp() - guardado["t"])
        if not 0 < intervalo <= MAX_HUECO_S:
            return None, None
        return LecturaScrape.de_json(guardado["lectura"]), intervalo
    except Exception:
        _log.warning("Colector: estado previo ilegible; se omiten los deltas", exc_info=True)
        return None, None


def _guardar_previo(redis_cliente, ahora: datetime, lectura: LecturaScrape) -> None:
    try:
        redis_cliente.setex(
            CLAVE_ESTADO_PREVIO, TTL_ESTADO_PREVIO_S,
            json.dumps({"t": ahora.timestamp(), "lectura": lectura.a_json()}),
        )
    except Exception:
        _log.warning("Colector: no se pudo guardar el estado previo", exc_info=True)


def _rutas_para_guardar(delta: Delta) -> list[dict]:
    """Las rutas con más tráfico del minuto, ya partidas en método y plantilla."""
    ordenadas = sorted(delta.rutas.items(), key=lambda kv: kv[1][-1], reverse=True)
    resultado = []
    for clave, buckets in ordenadas[:MAX_RUTAS_POR_INSTANTANEA]:
        metodo, _, ruta = clave.partition(" ")
        resultado.append({"m": metodo, "r": ruta, "b": buckets})
    return resultado


def recolectar(
    db: Session,
    *,
    ahora: datetime,
    scrapear: Callable[[], str] = scrapear_metricas,
    redis_cliente,
    archivo_host: Path | str | None,
    conectados: Callable[[datetime], dict | None],
) -> MetricaInstantanea | None:
    """Una iteración: scrapea, calcula deltas, inserta y confirma. Devuelve la
    fila, o None si el scrape falló (backend caído): sin lectura no hay
    instantánea, y la AUSENCIA de filas es lo que el resumen lee como "sin
    datos recientes"."""
    ahora = ahora.replace(microsecond=0)
    try:
        lectura = parsear_exposicion(scrapear())
    except Exception:
        _log.warning("Colector: no se pudo leer /metrics", exc_info=True)
        return None

    previa, intervalo = _cargar_previo(redis_cliente, ahora)
    delta = calcular_delta(previa, lectura, intervalo)
    _guardar_previo(redis_cliente, ahora, lectura)

    cola, redis_usado, redis_max = _estado_de_redis(redis_cliente)
    conexiones, conexiones_max = _estado_de_postgres(db)
    presentes = conectados(ahora)
    host = leer_host(archivo_host, ahora)

    fila = MetricaInstantanea(
        capturada_en=ahora,
        intervalo_s=delta.intervalo_s,
        peticiones=delta.peticiones,
        errores_5xx=delta.errores_5xx,
        errores_4xx=delta.errores_4xx,
        latencia_buckets=delta.latencia,
        rutas=_rutas_para_guardar(delta) if delta.latencia is not None else None,
        outbox_pendientes=lectura.outbox_pendientes,
        outbox_mas_antiguo_s=None if lectura.outbox_mas_antiguo_s is None else int(lectura.outbox_mas_antiguo_s),
        cola_celery=cola,
        db_conexiones=conexiones,
        db_conexiones_max=conexiones_max,
        redis_usado_mb=redis_usado,
        redis_max_mb=redis_max,
        logins_ok=delta.logins_ok,
        logins_fallidos=delta.logins_fallidos,
        conectados=None if presentes is None else presentes["total"],
        conectados_por_rol=None if presentes is None else presentes["por_rol"],
    )
    if host is not None:
        fila.host_actualizado_en = host["actualizado_en"]
        fila.host_cpu_pct = host["cpu_pct"]
        fila.host_ram_usada_mb = host["ram_usada_mb"]
        fila.host_ram_total_mb = host["ram_total_mb"]
        fila.host_swap_usada_mb = host["swap_usada_mb"]
        fila.host_swap_total_mb = host["swap_total_mb"]
        fila.host_disco_pct = host["disco_pct"]
        fila.host_contenedores = host["contenedores"]
    db.add(fila)
    db.commit()
    return fila




def purgar(db: Session, ahora: datetime) -> tuple[int, int]:
    """Borra lo que ya no puede dibujarse. Devuelve (instantáneas, actividad)
    borradas. No hace commit: lo decide la tarea."""
    instantaneas = db.execute(
        delete(MetricaInstantanea).where(MetricaInstantanea.capturada_en < ahora - RETENCION_INSTANTANEAS)
    ).rowcount
    actividad = db.execute(
        delete(ActividadUsuario).where(
            ActividadUsuario.fecha < hoy_club(ahora) - timedelta(days=RETENCION_ACTIVIDAD_DIAS)
        )
    ).rowcount
    return instantaneas, actividad
