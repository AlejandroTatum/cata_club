"""
Tests de `CircuitoBreaker` (degradacion-controlada, slice 2): máquina de
estados CERRADO/ABIERTO/SEMIABIERTO, en proceso, sin dependencias externas.

Todos los tests usan un reloj falso inyectable (nunca `time.sleep` real ni
`time.monotonic` real): el diseño exige un reloj inyectable justamente para
que estas pruebas sean deterministas y rápidas (Decisión E del diseño).

Sección de registro/observabilidad (operacion-observable, slice 1a): el
registro a nivel de módulo se puebla desde `__init__`, así que estos tests
importan los módulos productivos (`cloudinary_cliente`, `notificaciones_
servicio`) para forzar la construcción de sus breakers -- sin escribir una
sola línea en esos archivos (ver Requirement: Breaker self-registration).
"""
import json
import threading
import time

from app.soporte_transversal.circuito_breaker import CircuitoBreaker, resumen_circuitos


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


# =============================================================================
# Registro/observabilidad (operacion-observable, slice 1a): `_REGISTRO` a
# nivel de módulo, poblado desde `__init__`, y su accesor `resumen_circuitos()`.
# =============================================================================

# --- 10. Ambos breakers productivos aparecen en el registro, con cero
# escrituras en los archivos que los construyen ------------------------------
def test_ambos_breakers_productivos_aparecen_en_el_registro():
    # Importar los módulos productivos es lo único necesario para que sus
    # instancias de módulo (`_circuito_cloudinary`, `_circuito_smtp`) se
    # construyan y se auto-registren desde `CircuitoBreaker.__init__` -- sin
    # tocar una sola línea de `cloudinary_cliente.py` ni de
    # `notificaciones_servicio.py` (Requirement: Breaker self-registration).
    import app.infraestructura.cloudinary_cliente  # noqa: F401
    import app.infraestructura.notificaciones_servicio  # noqa: F401

    resumen = resumen_circuitos()

    assert "cloudinary" in resumen
    assert "smtp" in resumen


# --- 11. Instanciación repetida con el mismo nombre: last-wins, sin excepción
def test_instanciacion_repetida_mismo_nombre_es_last_wins():
    reloj_viejo = RelojFalso()
    breaker_viejo = CircuitoBreaker(
        nombre="repetido_test", umbral_fallos=1, cooldown_segundos=30.0, reloj=reloj_viejo,
    )
    breaker_viejo.registrar_fallo()  # abre el breaker viejo (umbral=1)
    assert breaker_viejo.estado == "abierto"

    # Una segunda instancia con el MISMO nombre no debe lanzar excepción, y
    # debe reemplazar la entrada del registro (Decisión 2: last-wins, silent).
    breaker_nuevo = CircuitoBreaker(
        nombre="repetido_test", umbral_fallos=3, cooldown_segundos=30.0, reloj=RelojFalso(),
    )

    resumen = resumen_circuitos()

    assert resumen["repetido_test"]["estado"] == "cerrado"
    assert resumen["repetido_test"]["fallos_consecutivos"] == 0
    assert breaker_nuevo.estado == "cerrado"


# --- 12. `resumen_circuitos()` refleja el estado actual, JSON-serializable --
def test_resumen_circuitos_refleja_estado_actual_y_es_json_serializable():
    breaker = CircuitoBreaker(
        nombre="resumen_con_fallos", umbral_fallos=5, cooldown_segundos=30.0,
        reloj=RelojFalso(),
    )
    breaker.registrar_fallo()
    breaker.registrar_fallo()

    resumen = resumen_circuitos()

    assert resumen["resumen_con_fallos"]["estado"] == "cerrado"
    assert resumen["resumen_con_fallos"]["fallos_consecutivos"] == 2
    # No debe lanzar: prueba real de que el resultado es JSON-serializable,
    # no solo "parece" serializable.
    codificado = json.dumps(resumen)
    assert '"resumen_con_fallos"' in codificado


# --- 13. `resumen_circuitos()` nunca toma el lock por-instancia (Decisión 2
# del diseño: lectura sucia aceptada, documentada) ----------------------------
def test_resumen_circuitos_no_toma_el_lock_de_instancia():
    breaker = CircuitoBreaker(
        nombre="dirty_read_test", umbral_fallos=1, cooldown_segundos=30.0,
        reloj=RelojFalso(),
    )
    liberar = threading.Event()

    def _mantener_lock_tomado():
        breaker._lock.acquire()
        liberar.wait(timeout=2.0)
        breaker._lock.release()

    hilo = threading.Thread(target=_mantener_lock_tomado)
    hilo.start()
    try:
        # Esperar activamente a que `hilo` realmente tome el lock antes de
        # medir (evita una carrera donde `resumen_circuitos()` corre antes
        # de que el otro hilo haya llamado `acquire()`).
        #
        # La espera va acotada a propósito: `threading.Lock` no garantiza
        # equidad, así que un `hilo` hambreado -- o que nunca llegue a
        # `acquire()` por un fallo al arrancar -- dejaría este bucle girando
        # para siempre. Sin la cota, ese caso cuelga la suite en vez de
        # fallar; con ella, falla diciendo exactamente qué pasó.
        limite = time.monotonic() + 2.0
        while breaker._lock.acquire(blocking=False):
            breaker._lock.release()
            if time.monotonic() >= limite:
                raise AssertionError(
                    "el hilo auxiliar nunca tomó `_lock`: sin contención real "
                    "la medición de abajo no probaría nada"
                )
            time.sleep(0.001)

        # Si `resumen_circuitos()` tomara `self._lock`, esta llamada se
        # bloquearía hasta que `hilo` libere el lock (hasta 2s). Un
        # `threading.Lock` no es reentrante y no distingue el thread
        # llamador, así que esto es una prueba real, no una suposición.
        inicio = time.monotonic()
        resumen = resumen_circuitos()
        transcurrido = time.monotonic() - inicio
    finally:
        liberar.set()
        hilo.join()

    assert transcurrido < 0.5
    # El breaker nunca registró un fallo; el único propósito del hilo
    # paralelo es retener `_lock`, no mutar estado.
    assert resumen["dirty_read_test"]["estado"] == "cerrado"
    assert resumen["dirty_read_test"]["fallos_consecutivos"] == 0


# --- 14. Aislamiento entre tests vía el camino de reset existente
# (`reiniciar()`, `circuito_breaker.py:131-133`) -----------------------------
# Decisión 2 del diseño: el registro NO se limpia entre tests (perdería a
# los dos breakers productivos, que solo se re-registran con un nuevo
# import). El aislamiento real lo da `reiniciar()`: el registro guarda la
# instancia VIVA, así que un reset es visible a través de él de inmediato --
# sin él, el estado corrupto de un "test A" (p. ej. ABIERTO tras fallos)
# quedaría filtrado hacia cualquier lectura posterior del registro (un
# "test B" simulado acá), incluso entre módulos de test distintos.
def test_reiniciar_es_visible_de_inmediato_a_traves_del_registro():
    # "Test A": registra un breaker y lo fuerza a ABIERTO.
    breaker = CircuitoBreaker(
        nombre="aislamiento_registro", umbral_fallos=1, cooldown_segundos=30.0,
        reloj=RelojFalso(),
    )
    breaker.registrar_fallo()
    assert resumen_circuitos()["aislamiento_registro"]["estado"] == "abierto"
    assert resumen_circuitos()["aislamiento_registro"]["fallos_consecutivos"] == 1

    # Camino de reset existente (`reiniciar()`), como hace el fixture
    # autouse `_reiniciar_circuitos_breaker` de `conftest.py` entre tests.
    breaker.reiniciar()

    # "Test B": una lectura posterior del registro NUNCA debe ver el estado
    # corrupto de test A -- el reset es visible de inmediato, sin necesidad
    # de remover ni reconstruir la entrada del registro.
    resumen_tras_reset = resumen_circuitos()
    assert resumen_tras_reset["aislamiento_registro"]["estado"] == "cerrado"
    assert resumen_tras_reset["aislamiento_registro"]["fallos_consecutivos"] == 0
