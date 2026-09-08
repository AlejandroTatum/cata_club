"""
Issue #311: el freno progresivo de login (TRA-4) bloquea el event loop.

`AuthServicio.login` corre síncronamente dentro del `async def login` de
`auth_router.py`. Cuando el freno penaliza un intento fallido (ver
`AuthServicio._penalizar_intento_fallido`), llama a `self._dormir(retraso)`,
que en producción ES `time.sleep` real (el router no inyecta un `dormir`
falso, a diferencia de los tests unitarios de `test_auth_freno_login.py`).
Un `time.sleep` DENTRO de una coroutine, sin `await`, retiene el único hilo
del event loop de Uvicorn: mientras un atacante fuerza logins fallidos
contra una cuenta y el freno escala, NINGÚN otro cliente puede ser
atendido -- ni siquiera `GET /health`, que no toca DB ni auth.

Este test es de integración real (ASGI real, sleep real de 1s) a propósito:
fakear el sleeper -- como hace `test_auth_freno_login.py` -- probaría que
el CÁLCULO del retraso es correcto, no que el SERVIDOR sigue respondiendo
mientras ese retraso corre. Solo un sleep real, disparado en un hilo aparte
mientras se mide otro request en el hilo principal, prueba lo segundo.
"""
import threading
import time

from app.servicios_negocio import auth_servicio as auth_servicio_modulo
from tests.fabricas_auth import crear_usuario_auth as _crear_usuario


def _limpiar_contador_intentos():
    """No es fixture autouse: se llama explícitamente al principio y al
    final del test (mismo patrón de limpieza que `test_auth_freno_login.py`,
    duplicado local para no importar de otro archivo de test), así el
    contador de intentos fallidos -- que vive en un dict a nivel de módulo --
    no se filtra desde/hacia otros tests de la suite."""
    auth_servicio_modulo._INTENTOS_FALLIDOS_LOGIN.clear()


def test_login_penalizado_no_bloquea_el_event_loop(db_session, client, monkeypatch):
    _limpiar_contador_intentos()
    try:
        _crear_usuario(db_session, correo="ana@cataclub.test", contrasenia="clave-correcta")

        # Synchronize on entry to the actual sleeper, not on the thread merely
        # being scheduled. The constructor patch is needed because AuthServicio
        # captures time.sleep in its default argument at import time.
        sleeper_started = threading.Event()
        real_sleep = time.sleep

        def _observable_sleep(retraso):
            sleeper_started.set()
            real_sleep(retraso)

        init_original = auth_servicio_modulo.AuthServicio.__init__

        def _init_with_observable_sleeper(self, db, dormir=real_sleep):
            init_original(self, db, dormir=_observable_sleep)

        monkeypatch.setattr(
            auth_servicio_modulo.AuthServicio,
            "__init__",
            _init_with_observable_sleeper,
        )

        # 2 fallos consecutivos: no penalizan (ver `_calcular_retraso_login`),
        # solo dejan el contador en 2 para que el 3ro sea el que dispara 1s.
        for _ in range(2):
            respuesta = client.post(
                "/api/v1/auth/login",
                data={"username": "ana@cataclub.test", "password": "mal"},
            )
            assert respuesta.status_code == 401

        # El 3er fallo entra al sleep REAL en un hilo aparte, mientras el hilo
        # principal mide OTRO request (`GET /health`).
        resultado_tercer_intento = {}

        def _disparar_tercer_intento_fallido():
            resultado_tercer_intento["respuesta"] = client.post(
                "/api/v1/auth/login",
                data={"username": "ana@cataclub.test", "password": "mal"},
            )

        hilo = threading.Thread(target=_disparar_tercer_intento_fallido)
        hilo.start()
        assert sleeper_started.wait(timeout=1.0), "el login no entró al sleeper"

        inicio = time.monotonic()
        respuesta_salud = client.get("/health")
        duracion_salud = time.monotonic() - inicio

        hilo.join()

        assert respuesta_salud.status_code == 200
        assert resultado_tercer_intento["respuesta"].status_code == 401
        # Si el event loop estuviera bloqueado por el `time.sleep(1)` del
        # freno, `/health` tardaría cerca de 1s (lo que reste del sleep en
        # curso). 200ms deja margen razonable arriba de la duración normal
        # (unos pocos ms) sin acercarse al ~1000ms del bug.
        assert duracion_salud < 0.2, (
            f"GET /health tardó {duracion_salud:.3f}s mientras el freno de "
            "login dormía -- el event loop parece bloqueado"
        )
    finally:
        _limpiar_contador_intentos()
