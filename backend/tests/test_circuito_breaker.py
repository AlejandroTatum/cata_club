"""
Tests de `CircuitoBreaker` (degradacion-controlada, slice 2): máquina de
estados CERRADO/ABIERTO/SEMIABIERTO, en proceso, sin dependencias externas.

Todos los tests usan un reloj falso inyectable (nunca `time.sleep` real ni
`time.monotonic` real): el diseño exige un reloj inyectable justamente para
que estas pruebas sean deterministas y rápidas (Decisión E del diseño).
"""
import threading

from app.soporte_transversal.circuito_breaker import CircuitoBreaker


class RelojFalso:
    """Reloj monotónico falso: arranca en `inicio` y solo avanza cuando se
    lo pide explícitamente `avanzar()`, nunca con el paso real del tiempo."""

    def __init__(self, inicio: float = 0.0):
        self._ahora = inicio

    def __call__(self) -> float:
        return self._ahora

    def avanzar(self, segundos: float) -> None:
        self._ahora += segundos


def _crear_breaker(umbral: int = 3, cooldown: float = 30.0, reloj=None) -> CircuitoBreaker:
    return CircuitoBreaker(
        nombre="test", umbral_fallos=umbral, cooldown_segundos=cooldown,
        reloj=reloj or RelojFalso(),
    )


# --- 1. El umbral de fallos abre el circuito --------------------------------
def test_umbral_de_fallos_abre_el_circuito():
    breaker = _crear_breaker(umbral=3)

    breaker.registrar_fallo()
    assert breaker.estado == "cerrado"
    assert breaker.permitir() is True  # todavía por debajo del umbral

    breaker.registrar_fallo()
    assert breaker.estado == "cerrado"

    breaker.registrar_fallo()

    assert breaker.estado == "abierto"
    assert breaker.fallos_consecutivos == 3


# --- 2. ABIERTO no admite llamadas mientras el cooldown no venció -----------
def test_abierto_no_permite_llamadas():
    reloj = RelojFalso()
    breaker = _crear_breaker(umbral=1, cooldown=30.0, reloj=reloj)
    breaker.registrar_fallo()
    assert breaker.estado == "abierto"

    reloj.avanzar(10.0)  # no alcanza el cooldown de 30s

    assert breaker.permitir() is False
    assert breaker.estado == "abierto"


# --- 3. Al vencer el cooldown se admite EXACTAMENTE una sonda ---------------
def test_semiabierto_admite_una_sola_sonda():
    reloj = RelojFalso()
    breaker = _crear_breaker(umbral=1, cooldown=30.0, reloj=reloj)
    breaker.registrar_fallo()

    reloj.avanzar(30.0)

    assert breaker.permitir() is True
    assert breaker.estado == "semiabierto"
    assert breaker.permitir() is False  # la sonda ya está en curso


# --- 4. Sonda exitosa cierra el circuito ------------------------------------
def test_sonda_exitosa_cierra_el_circuito():
    reloj = RelojFalso()
    breaker = _crear_breaker(umbral=1, cooldown=30.0, reloj=reloj)
    breaker.registrar_fallo()
    reloj.avanzar(30.0)
    breaker.permitir()

    breaker.registrar_exito()

    assert breaker.estado == "cerrado"
    assert breaker.fallos_consecutivos == 0
    assert breaker.permitir() is True


# --- 5. Sonda fallida reabre con un cooldown fresco -------------------------
def test_sonda_fallida_reabre_el_circuito():
    reloj = RelojFalso()
    breaker = _crear_breaker(umbral=1, cooldown=30.0, reloj=reloj)
    breaker.registrar_fallo()
    reloj.avanzar(30.0)
    breaker.permitir()

    breaker.registrar_fallo()

    assert breaker.estado == "abierto"
    assert breaker.permitir() is False  # el cooldown se reinició desde AHORA

    reloj.avanzar(30.0)
    assert breaker.permitir() is True  # nueva sonda tras el nuevo cooldown


# --- 6. Un éxito reinicia el contador de fallos consecutivos ----------------
def test_exito_reinicia_el_contador_de_fallos():
    breaker = _crear_breaker(umbral=3)
    breaker.registrar_fallo()
    breaker.registrar_fallo()
    assert breaker.fallos_consecutivos == 2

    breaker.registrar_exito()

    assert breaker.fallos_consecutivos == 0
    assert breaker.estado == "cerrado"


# --- 7. Bajo concurrencia, exactamente un caller obtiene la sonda -----------
def test_una_sola_sonda_bajo_concurrencia():
    reloj = RelojFalso()
    breaker = _crear_breaker(umbral=1, cooldown=30.0, reloj=reloj)
    breaker.registrar_fallo()
    reloj.avanzar(30.0)

    resultados: list[bool] = []
    barrera = threading.Barrier(10)

    def _intentar() -> None:
        barrera.wait()
        resultados.append(breaker.permitir())

    hilos = [threading.Thread(target=_intentar) for _ in range(10)]
    for hilo in hilos:
        hilo.start()
    for hilo in hilos:
        hilo.join()

    assert resultados.count(True) == 1
    assert breaker.estado == "semiabierto"


# --- 8. Defensivo: un fallo reportado mientras ya está ABIERTO no hace nada -
# (un llamador que respeta el contrato consulta `permitir()` antes de llamar
# al proveedor y nunca llega acá; esto cubre el caso de un llamador que no lo
# respetó, sin romper el estado del circuito).
def test_registrar_fallo_mientras_abierto_es_no_op():
    reloj = RelojFalso()
    breaker = _crear_breaker(umbral=1, cooldown=30.0, reloj=reloj)
    breaker.registrar_fallo()
    assert breaker.estado == "abierto"

    breaker.registrar_fallo()

    assert breaker.estado == "abierto"
    assert breaker.permitir() is False


# --- 9. `reiniciar()` vuelve a CERRADO desde cualquier estado ---------------
def test_reiniciar_vuelve_a_cerrado_y_limpia_el_contador():
    reloj = RelojFalso()
    breaker = _crear_breaker(umbral=1, cooldown=30.0, reloj=reloj)
    breaker.registrar_fallo()
    assert breaker.estado == "abierto"

    breaker.reiniciar()

    assert breaker.estado == "cerrado"
    assert breaker.fallos_consecutivos == 0
    assert breaker.permitir() is True
