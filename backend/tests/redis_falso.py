"""Redis en memoria con solo los comandos que usan `app/infraestructura/presencia.py`
(sorted sets y `SET NX EX`) y `app/infraestructura/redis_intentos_login.py`
(hashes con TTL). Existe para no depender de un Redis real en la suite --
igual que el resto de los tests, que mockean el broker de Celery.

`reloj` gobierna el vencimiento de los TTL (`expire`): un test que quiere
probar una ventana le pasa un reloj controlado y lo avanza, sin esperar.

Cuenta cada ida y vuelta (`viajes`): el contrato de la presencia es "UNA
operación Redis por usuario y minuto", y eso se prueba contando.
"""
from __future__ import annotations

import time
from typing import Callable


class RedisFalso:
    def __init__(self, falla: bool = False, reloj: Callable[[], float] = time.time) -> None:
        self.zsets: dict[str, dict[str, float]] = {}
        self.claves: dict[str, str] = {}
        self.hashes: dict[str, dict[str, str]] = {}
        self.vence: dict[str, float] = {}
        self.viajes = 0
        self.falla = falla
        self._reloj = reloj

    def _purgar_vencidas(self) -> None:
        ahora = self._reloj()
        for clave in [c for c, hasta in self.vence.items() if ahora >= hasta]:
            del self.vence[clave]
            self.zsets.pop(clave, None)
            self.claves.pop(clave, None)
            self.hashes.pop(clave, None)

    def _existe(self, clave: str) -> bool:
        return clave in self.zsets or clave in self.claves or clave in self.hashes

    # --- comandos (los usa tanto el pipeline como el cliente directo) ----
    def _ejecutar(self, comando: str, *args, **kwargs):
        self._purgar_vencidas()
        if comando == "zadd":
            clave, mapa = args
            self.zsets.setdefault(clave, {}).update({k: float(v) for k, v in mapa.items()})
            return len(mapa)
        if comando == "zremrangebyscore":
            clave, minimo, maximo = args
            z = self.zsets.get(clave, {})
            borrar = [m for m, s in z.items() if float(minimo) <= s <= float(maximo)]
            for m in borrar:
                del z[m]
            return len(borrar)
        if comando == "zcount":
            clave, minimo, maximo = args
            minimo = float("-inf") if minimo == "-inf" else float(minimo)
            maximo = float("inf") if maximo == "+inf" else float(maximo)
            return sum(1 for s in self.zsets.get(clave, {}).values() if minimo <= s <= maximo)
        if comando == "set":
            clave, valor = args
            if kwargs.get("nx") and clave in self.claves:
                return None
            self.claves[clave] = valor
            return True
        return self._ejecutar_hashes_y_ttl(comando, *args)

    def _ejecutar_hashes_y_ttl(self, comando: str, *args):
        if comando == "expire":
            clave, segundos = args
            if not self._existe(clave):
                return False
            self.vence[clave] = self._reloj() + int(segundos)
            return True
        if comando == "ttl":
            (clave,) = args
            if not self._existe(clave):
                return -2
            return int(self.vence[clave] - self._reloj()) if clave in self.vence else -1
        if comando == "hincrby":
            clave, campo, delta = args
            h = self.hashes.setdefault(clave, {})
            h[campo] = str(int(h.get(campo, "0")) + int(delta))
            return int(h[campo])
        if comando == "hset":
            clave, campo, valor = args
            h = self.hashes.setdefault(clave, {})
            nuevo = campo not in h
            h[campo] = str(valor)
            return int(nuevo)
        if comando == "hget":
            clave, campo = args
            return self.hashes.get(clave, {}).get(campo)
        if comando == "delete":
            borradas = 0
            for clave in args:
                existia = self._existe(clave)
                self.zsets.pop(clave, None)
                self.claves.pop(clave, None)
                self.hashes.pop(clave, None)
                self.vence.pop(clave, None)
                borradas += int(existia)
            return borradas
        raise NotImplementedError(comando)

    def pipeline(self, transaction: bool = False):
        return _Pipeline(self)

    def __getattr__(self, comando: str):
        if comando.startswith("_"):
            raise AttributeError(comando)

        def _directo(*args, **kwargs):
            if self.falla:
                raise ConnectionError("redis caído (falso)")
            self.viajes += 1
            return self._ejecutar(comando, *args, **kwargs)

        return _directo


class _Pipeline:
    def __init__(self, redis: RedisFalso) -> None:
        self._redis = redis
        self._cola: list[tuple[str, tuple, dict]] = []

    def __getattr__(self, comando: str):
        if comando.startswith("_"):
            raise AttributeError(comando)

        def _encolar(*args, **kwargs):
            self._cola.append((comando, args, kwargs))
            return self

        return _encolar

    def execute(self):
        if self._redis.falla:
            raise ConnectionError("redis caído (falso)")
        self._redis.viajes += 1
        return [self._redis._ejecutar(c, *a, **k) for c, a, k in self._cola]
