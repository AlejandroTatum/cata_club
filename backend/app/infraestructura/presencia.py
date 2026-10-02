"""Presencia "conectados ahora" y puerta de la primera petición por franja
(issue #1314).

Por qué Redis y no una columna: "conectados en los últimos 5 min" se pregunta
cada minuto y se escribe en CADA petición autenticada; contra la base serían
escrituras calientes sobre `usuario` (o una tabla nueva) en el camino de todas
las requests. Redis ya está en el stack (broker de Celery) y un sorted set
responde "cuántos en la ventana" con `ZCOUNT`, O(log n).

Costo: la dependencia de autenticación llama a `tocar` en cada petición, pero
una memoria local por proceso la reduce a UNA ida y vuelta a Redis (un
pipeline) por usuario y minuto; el resto es una consulta a un dict. El
pipeline hace `ZADD` al sorted set global y al del rol, recorta lo vencido y
renueva el TTL de las claves, y con un `SET NX EX` decide si esta es la
primera petición del usuario en la franja de 2 h (compartido entre procesos y
reinicios: solo entonces se escribe `actividad_usuario`).

Fail-open: si Redis no responde, `tocar` no lanza -- la puerta de franja cae a
la memoria local (una escritura redundante por proceso y franja, inocua porque
el INSERT es `ON CONFLICT DO NOTHING`) y `contar` devuelve None.

Privacidad: el miembro del sorted set es el id del usuario, que nunca sale de
Redis; la API solo expone conteos.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Iterable

import redis

from app.infraestructura import actividad
from app.dominio.enums import TipoRol
from app.soporte_transversal.configuracion import settings

_log = logging.getLogger("cataclub.infraestructura.presencia")

VENTANA_CONECTADOS_S = 300
INTERVALO_TOQUE_S = 60
TTL_CLAVES_S = 2 * VENTANA_CONECTADOS_S
TTL_PUERTA_FRANJA_S = 2 * 3600 + 600  # una franja más un margen
TIMEOUT_REDIS_S = 0.25
MAX_USUARIOS_EN_MEMORIA = 5000

CLAVE_TODOS = "presencia:todos"
_PREFIJO_ROL = "presencia:rol:"

ROLES_CONTADOS = tuple(rol.value for rol in TipoRol)

# Cliente perezoso: `from_url` no abre conexión, pero se difiere igual para
# que importar el módulo nunca dependa de la configuración de Redis.
_cliente_redis = None

# usuario_id -> (instante del último toque, (fecha, franja) de ese toque)
_ultimo_toque: dict[int, tuple[float, tuple]] = {}
_ultimo_aviso_falla = 0.0


def reiniciar_estado_local() -> None:
    _ultimo_toque.clear()


def _cliente():
    global _cliente_redis
    if _cliente_redis is None:
        _cliente_redis = redis.Redis.from_url(
            settings.redis_url,
            socket_connect_timeout=TIMEOUT_REDIS_S,
            socket_timeout=TIMEOUT_REDIS_S,
            retry_on_timeout=False,
        )
    return _cliente_redis


def _clave_rol(rol: str) -> str:
    return f"{_PREFIJO_ROL}{rol}"


def _avisar_falla(error: Exception) -> None:
    """Un aviso por minuto como mucho: con Redis caído, cada usuario fallaría
    cada minuto y el log se llenaría de lo mismo."""
    global _ultimo_aviso_falla
    ahora = datetime.now(timezone.utc).timestamp()
    if ahora - _ultimo_aviso_falla >= 60:
        _ultimo_aviso_falla = ahora
        _log.warning("Presencia: Redis no responde (%s); se omite el toque", type(error).__name__)


def _podar_memoria(ts: float) -> None:
    if len(_ultimo_toque) <= MAX_USUARIOS_EN_MEMORIA:
        return
    vencidos = [uid for uid, (visto, _) in _ultimo_toque.items() if ts - visto > VENTANA_CONECTADOS_S]
    for uid in vencidos:
        del _ultimo_toque[uid]
    if len(_ultimo_toque) > MAX_USUARIOS_EN_MEMORIA:
        _ultimo_toque.clear()


def tocar(usuario_id: int, roles: Iterable[str], ahora: datetime | None = None) -> bool:
    """Marca al usuario como visto. Devuelve True si es su primera petición
    en la franja actual del club (la señal para escribir la actividad)."""
    ahora = ahora or datetime.now(timezone.utc)
    ts = ahora.timestamp()
    franja_actual = actividad.fecha_y_franja_del_club(ahora)

    previo = _ultimo_toque.get(usuario_id)
    if previo is not None and ts - previo[0] < INTERVALO_TOQUE_S and previo[1] == franja_actual:
        return False
    _ultimo_toque[usuario_id] = (ts, franja_actual)
    _podar_memoria(ts)
    primera_local = previo is None or previo[1] != franja_actual

    miembro = str(usuario_id)
    claves = [CLAVE_TODOS, *(_clave_rol(rol) for rol in roles if rol in ROLES_CONTADOS)]
    fecha, franja = franja_actual
    puerta = f"presencia:franja:{usuario_id}:{fecha.isoformat()}:{franja}"
    try:
        tuberia = _cliente().pipeline(transaction=False)
        for clave in claves:
            tuberia.zadd(clave, {miembro: ts})
            tuberia.zremrangebyscore(clave, "-inf", ts - VENTANA_CONECTADOS_S)
            tuberia.expire(clave, TTL_CLAVES_S)
        tuberia.set(puerta, "1", nx=True, ex=TTL_PUERTA_FRANJA_S)
        return bool(tuberia.execute()[-1])
    except Exception as error:
        _avisar_falla(error)
        return primera_local


def contar(ahora: datetime | None = None) -> dict | None:
    """Conectados en los últimos 5 minutos: `{"total", "por_rol"}`, o None si
    Redis no responde (el colector lo guarda como "sin dato", no como 0)."""
    ts = (ahora or datetime.now(timezone.utc)).timestamp()
    desde = ts - VENTANA_CONECTADOS_S
    try:
        tuberia = _cliente().pipeline(transaction=False)
        tuberia.zcount(CLAVE_TODOS, desde, "+inf")
        for rol in ROLES_CONTADOS:
            tuberia.zcount(_clave_rol(rol), desde, "+inf")
        resultados = tuberia.execute()
    except Exception as error:
        _avisar_falla(error)
        return None
    return {"total": int(resultados[0]), "por_rol": dict(zip(ROLES_CONTADOS, map(int, resultados[1:])))}


def registrar_primera_de_franja(usuario_id: int) -> None:
    """Escribe la actividad de la franja. Separado de `tocar` para que la
    dependencia de autenticación lo llame solo cuando `tocar` dijo True (y
    para que los tests lo intercepten sin tocar la base compartida)."""
    actividad.registrar_actividad_aislada(usuario_id)
