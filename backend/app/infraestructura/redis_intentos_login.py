"""Almacén Redis del freno de login por cuenta (TRA-4, REG-02, #1653 S6).

Antes el contador era un dict por proceso: con varios workers (PERF-12) el
atacante tenía una cuenta y un enfriamiento independientes por worker, y un
reinicio los borraba. Acá vive en un hash por cuenta, compartido entre
procesos y réplicas, con TTL:

    login:intentos:<sha256(clave)>  ->  {intentos, enfriada_hasta}

La POLÍTICA (umbrales, curva de retraso, duración del enfriamiento) sigue en
`auth_servicio`; este módulo solo guarda y lee. `enfriada_hasta` es un
instante de reloj de pared (`time.time`), no monotónico, porque lo leen otros
procesos.

Cota de memoria (#733): la clave se hashea, así que su largo es fijo aunque el
input del atacante no lo sea, y TODA escritura renueva un TTL -- no queda nada
retenido para siempre. Reemplaza al tope de 50.000 entradas con desalojo LRU
del dict: ahora la cota es el TTL (el Redis del stack tiene `maxmemory` con
`noeviction`; si se llenara, la escritura falla y rige el fail-open de abajo).

Fail-open, igual que `presencia`: si Redis no responde NO se lanza -- el
login no puede depender del broker. Con Redis caído el freno por cuenta se
apaga (queda el rate limiter por IP de `auth_router`), no se bloquea a nadie y
se avisa en el log a lo sumo una vez por minuto.
"""
from __future__ import annotations

import hashlib
import logging
import time

import redis

from app.soporte_transversal.configuracion import settings

_log = logging.getLogger("cataclub.infraestructura.redis_intentos_login")

TIMEOUT_REDIS_S = 0.25
_PREFIJO = "login:intentos:"

# Cliente perezoso: `from_url` no abre conexión, pero se difiere igual para
# que importar el módulo nunca dependa de la configuración de Redis.
_cliente_redis = None
_ultimo_aviso_falla = 0.0


def _cliente():
    global _cliente_redis
    if _cliente_redis is None:
        _cliente_redis = redis.Redis.from_url(
            settings.redis_url,
            socket_connect_timeout=TIMEOUT_REDIS_S,
            socket_timeout=TIMEOUT_REDIS_S,
            retry_on_timeout=False,
            decode_responses=True,
        )
    return _cliente_redis


def clave_redis(clave: str) -> str:
    """Clave de Redis de una cuenta; `clave` ya viene normalizada (trim +
    minúsculas) por `AuthServicio.login`."""
    return _PREFIJO + hashlib.sha256(clave.encode("utf-8")).hexdigest()


def _avisar_falla(error: Exception) -> None:
    """Un aviso por minuto como mucho: con Redis caído cada intento de login
    fallaría igual y el log se llenaría de lo mismo."""
    global _ultimo_aviso_falla
    ahora = time.time()
    if ahora - _ultimo_aviso_falla >= 60:
        _ultimo_aviso_falla = ahora
        _log.warning(
            "Freno de login: Redis no responde (%s); el freno por cuenta queda desactivado",
            type(error).__name__,
        )


def incrementar(clave: str, ttl_s: int) -> int:
    """Suma un fallo a `clave`, renueva su TTL (deslizante) y devuelve el
    total. 0 si Redis no responde."""
    key = clave_redis(clave)
    try:
        tuberia = _cliente().pipeline(transaction=True)
        tuberia.hincrby(key, "intentos", 1)
        tuberia.expire(key, ttl_s)
        return int(tuberia.execute()[0])
    except Exception as error:
        _avisar_falla(error)
        return 0


def marcar_enfriamiento(clave: str, hasta: float, ttl_s: int) -> None:
    """Fija el fin del enfriamiento y estira el TTL de la clave a `ttl_s`
    (el contador debe sobrevivir al enfriamiento, ver `auth_servicio`)."""
    key = clave_redis(clave)
    try:
        tuberia = _cliente().pipeline(transaction=True)
        tuberia.hset(key, "enfriada_hasta", repr(hasta))
        tuberia.expire(key, ttl_s)
        tuberia.execute()
    except Exception as error:
        _avisar_falla(error)


def enfriada_hasta(clave: str) -> float | None:
    """Fin del enfriamiento de `clave`, o None si no hay (o Redis no
    responde). Solo lee: rechazar un intento no toca el estado."""
    try:
        valor = _cliente().hget(clave_redis(clave), "enfriada_hasta")
    except Exception as error:
        _avisar_falla(error)
        return None
    return float(valor) if valor is not None else None


def olvidar(clave: str) -> None:
    """Borra el contador y el enfriamiento de `clave` (login exitoso o
    restablecimiento de contraseña)."""
    try:
        _cliente().delete(clave_redis(clave))
    except Exception as error:
        _avisar_falla(error)
