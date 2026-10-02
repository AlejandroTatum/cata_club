"""Redis en memoria con solo los comandos que usa `app/infraestructura/presencia.py`
(sorted sets y `SET NX EX`). Existe para no depender de un Redis real en la
suite -- igual que el resto de los tests, que mockean el broker de Celery.

Cuenta cada ida y vuelta (`viajes`): el contrato de la presencia es "UNA
operación Redis por usuario y minuto", y eso se prueba contando.
"""
from __future__ import annotations


class RedisFalso:
    def __init__(self, falla: bool = False) -> None:
        self.zsets: dict[str, dict[str, float]] = {}
        self.claves: dict[str, str] = {}
        self.viajes = 0
        self.falla = falla

    # --- comandos (los usa tanto el pipeline como el cliente directo) ----
    def _ejecutar(self, comando: str, *args, **kwargs):
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
        if comando == "expire":
            return True
        if comando == "set":
            clave, valor = args
            if kwargs.get("nx") and clave in self.claves:
                return None
            self.claves[clave] = valor
            return True
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
