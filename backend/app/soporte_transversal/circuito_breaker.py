"""
Máquina de estados de circuit breaker en proceso, por adaptador (Cloudinary,
SMTP). Ver diseño (Decisión E, sdd/degradacion-controlada): estado en
memoria por proceso, reloj inyectable (`time.monotonic` por defecto, nunca
reloj de pared -- un salto NTP no debe corromper el cooldown) y
`threading.Lock` porque FastAPI corre los endpoints síncronos en un
threadpool: `_subir()` (y su análogo SMTP) ven llamadas concurrentes de
verdad, y el estado SEMIABIERTO debe admitir exactamente UNA sonda, nunca
dos en simultáneo.

Topología que justifica el estado en proceso, sin Redis compartido: EXACTAMENTE
un proceso Uvicorn, y Celery con `--concurrency=2` reciclando sus hijos cada
100 tareas (`--max-tasks-per-child=100`). El estado converge de forma
independiente en cada uno de esos procesos; acotado a una sonda desperdiciada
por reciclo, documentado, no silencioso -- Redis-compartido se evaluó y se
descartó a propósito (ver diseño).
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Callable


logger = logging.getLogger("cataclub.circuito")

CERRADO = "cerrado"
ABIERTO = "abierto"
SEMIABIERTO = "semiabierto"

# --- Registro de observabilidad (operacion-observable, slice 1a) -----------
# Diccionario a nivel de módulo, poblado desde `CircuitoBreaker.__init__` --
# ningún adaptador (`cloudinary_cliente.py`, `notificaciones_servicio.py`)
# necesita tocarse: construir el breaker YA lo registra. Guardado por un
# lock de módulo separado del `_lock` por-instancia: escribir una entrada del
# registro nunca compite con el hot path de `permitir()`.
#
# Colisión de clave: last-wins, silencioso (Decisión 2 del diseño).
# `test_circuito_breaker.py` construye legítimamente muchos breakers con
# nombres repetidos y relojes falsos; lanzar rompería la recolección de
# pruebas -- convertiría un diagnóstico en una caída. Se documenta acá en vez
# de intentar prevenir la colisión.
#
# Sin limpieza entre tests: vaciar el diccionario tiraría también las dos
# instancias productivas registradas al importar (`cloudinary`, `smtp`), que
# no se re-registran solas sin un nuevo import del módulo. Los tests deben
# afirmar sobre las entradas que ellos mismos crearon (subconjunto), nunca
# sobre la igualdad completa del diccionario.
_REGISTRO: dict[str, "CircuitoBreaker"] = {}
_registro_lock = threading.Lock()


class CircuitoBreaker:
    """Circuit breaker CLOSED/OPEN/HALF-OPEN clásico, con los tres estados
    nombrados en español (`cerrado`/`abierto`/`semiabierto`) para que los
    logs y un futuro endpoint de salud (Track A, ciclo de observabilidad)
    hablen el mismo idioma que el resto del código de dominio.

    Contrato de uso (ver diseño, sección Interfaces/Contracts):
      - `permitir()`: SIEMPRE se consulta antes de llamar al proveedor
        externo. `False` significa "no llames, el circuito está ABIERTO".
      - `registrar_exito()` / `registrar_fallo()`: reportan el resultado de
        la llamada real, y solo deben invocarse cuando `permitir()` devolvió
        `True` para esa misma invocación.
      - `reiniciar()`: vuelve a CERRADO desde cero; lo usa el arranque del
        proceso y el fixture de aislamiento de pruebas (`tests/conftest.py`).

    Esta clase NUNCA reintenta ni envuelve una llamada en un loop: solo
    decide si la llamada debe hacerse, y registra su resultado. El
    invariante de un único intento por llamada vive en el adaptador
    (`cloudinary_cliente.py::_subir`), no acá.
    """

    def __init__(
        self,
        nombre: str,
        umbral_fallos: int,
        cooldown_segundos: float,
        reloj: Callable[[], float] = time.monotonic,
    ) -> None:
        self._nombre = nombre
        self._umbral_fallos = umbral_fallos
        self._cooldown_segundos = cooldown_segundos
        self._reloj = reloj
        self._lock = threading.Lock()
        self._estado = CERRADO
        self._fallos_consecutivos = 0
        self._momento_apertura = 0.0

        with _registro_lock:
            _REGISTRO[nombre] = self

    @property
    def estado(self) -> str:
        return self._estado

    @property
    def fallos_consecutivos(self) -> int:
        return self._fallos_consecutivos

    def permitir(self) -> bool:
        """`False` implica que el llamador NO debe invocar al proveedor.

        En ABIERTO con el cooldown ya vencido, esta misma llamada hace la
        transición a SEMIABIERTO y es, ella misma, la ÚNICA sonda admitida:
        toda llamada posterior mientras siga en SEMIABIERTO devuelve `False`
        hasta que `registrar_exito()`/`registrar_fallo()` resuelva el
        estado. El lock hace esto seguro bajo llamadas concurrentes reales
        (varios threads del pool sync de FastAPI evaluando esto a la vez).
        """
        with self._lock:
            if self._estado == CERRADO:
                return True

            if self._estado == ABIERTO:
                if self._reloj() - self._momento_apertura < self._cooldown_segundos:
                    return False
                self._transicionar(SEMIABIERTO)
                return True

            # SEMIABIERTO: la sonda ya fue admitida por otra llamada; hasta
            # que se resuelva (éxito o fallo) no se admite una segunda.
            return False

    def registrar_exito(self) -> None:
        with self._lock:
            self._fallos_consecutivos = 0
            if self._estado == SEMIABIERTO:
                self._transicionar(CERRADO)

    def registrar_fallo(self) -> None:
        with self._lock:
            if self._estado == SEMIABIERTO:
                # La sonda falló: se reabre con un cooldown fresco, medido
                # desde AHORA, no desde el momento de la apertura original.
                self._momento_apertura = self._reloj()
                self._transicionar(ABIERTO)
                return

            if self._estado == ABIERTO:
                # Defensivo: un llamador que respetó `permitir()` nunca
                # debería reportar un fallo estando ya ABIERTO. No hay
                # transición que hacer ni contador que tocar.
                return

            self._fallos_consecutivos += 1
            if self._fallos_consecutivos >= self._umbral_fallos:
                self._momento_apertura = self._reloj()
                self._transicionar(ABIERTO)

    def reiniciar(self) -> None:
        """Vuelve a CERRADO desde cero. La usa el arranque del proceso y el
        fixture de aislamiento de pruebas (`tests/conftest.py`), para que el
        estado dejado por un test no se filtre al siguiente."""
        with self._lock:
            self._estado = CERRADO
            self._fallos_consecutivos = 0
            self._momento_apertura = 0.0

    def _transicionar(self, nuevo_estado: str) -> None:
        """Aplica la transición y emite el log estructurado correspondiente.
        Asume que el caller YA tiene el lock tomado -- este método no vuelve
        a tomarlo, así que nunca se llama fuera de un bloque `with
        self._lock`."""
        anterior = self._estado
        self._estado = nuevo_estado
        extra = {
            "circuito": self._nombre,
            "estado_anterior": anterior,
            "estado_nuevo": nuevo_estado,
            "fallos_consecutivos": self._fallos_consecutivos,
        }

        if anterior == CERRADO and nuevo_estado == ABIERTO:
            logger.error(
                "Circuito %s ABIERTO tras %d fallos consecutivos; cooldown %.0fs",
                self._nombre, self._fallos_consecutivos, self._cooldown_segundos,
                extra=extra,
            )
        elif anterior == ABIERTO and nuevo_estado == SEMIABIERTO:
            logger.warning(
                "Circuito %s SEMIABIERTO: se admite una llamada de prueba",
                self._nombre, extra=extra,
            )
        elif anterior == SEMIABIERTO and nuevo_estado == CERRADO:
            logger.info(
                "Circuito %s CERRADO: el proveedor respondió",
                self._nombre, extra=extra,
            )
        elif anterior == SEMIABIERTO and nuevo_estado == ABIERTO:
            logger.error(
                "Circuito %s reABIERTO: la llamada de prueba falló",
                self._nombre, extra=extra,
            )


def resumen_circuitos() -> dict[str, dict[str, object]]:
    """Accesor de solo lectura para observabilidad (operacion-observable,
    slice 1a): devuelve un resumen JSON-serializable de cada breaker
    registrado (nombre, estado, fallos consecutivos).

    Decisión 2 del diseño, explícita y NO accidental: lee `_estado` y
    `_fallos_consecutivos` de cada breaker SIN tomar `self._lock`. Se acepta
    una lectura sucia benigna: (a) bajo el GIL de CPython, leer un atributo
    `str`/`int` es atómico -- nunca un valor a medio escribir, a lo sumo
    microsegundos de antigüedad; (b) es un diagnóstico pensado para un futuro
    `/health` (P2), donde esa antigüedad no importa; (c) tomar el lock
    por-entrada haría que una lectura de diagnóstico compita con el hot path
    de `permitir()` -- exactamente la inversión de prioridades que esta
    funcionalidad existe para evitar. Consecuencia aceptada: `estado` y
    `fallos_consecutivos` de una misma entrada pueden provenir de instantes
    distintos.

    Solo lee `_REGISTRO` bajo `_registro_lock` (una operación O(1) de
    iteración de dict, no de escritura del hot path); nunca toca `_lock` de
    ninguna instancia.
    """
    with _registro_lock:
        entradas = list(_REGISTRO.items())

    return {
        nombre: {
            "estado": breaker._estado,
            "fallos_consecutivos": breaker._fallos_consecutivos,
        }
        for nombre, breaker in entradas
    }
