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
from datetime import date

from app.dominio.modelos import Persona, Usuario
from app.seguridad.gestor_auth import GestorAutenticacion
from app.servicios_negocio import auth_servicio as auth_servicio_modulo


def _crear_usuario(db_session, correo="ana@cataclub.test", cedula="1710034065", contrasenia="clave12345"):
    persona = Persona(
        nombres="Ana", apellidos="Torres", cedula=cedula,
        fecha_nacimiento=date(1990, 1, 1), telefono="0991234567",
    )
    db_session.add(persona)
    db_session.flush()
    usuario = Usuario(
        correo=correo,
        contrasenia=GestorAutenticacion.obtener_hash_contrasenia(contrasenia),
        persona_id=persona.id,
    )
    db_session.add(usuario)
    db_session.commit()
    return usuario


def _limpiar_contador_intentos():
    """No es fixture autouse: se llama explícitamente al principio y al
    final del test (mismo patrón de limpieza que `test_auth_freno_login.py`,
    duplicado local para no importar de otro archivo de test), así el
    contador de intentos fallidos -- que vive en un dict a nivel de módulo --
    no se filtra desde/hacia otros tests de la suite."""
    auth_servicio_modulo._INTENTOS_FALLIDOS_LOGIN.clear()


def test_login_penalizado_no_bloquea_el_event_loop(db_session, client):
    _limpiar_contador_intentos()
    try:
        _crear_usuario(db_session, correo="ana@cataclub.test", contrasenia="clave-correcta")

        # 2 fallos consecutivos: no penalizan (ver `_calcular_retraso_login`),
        # solo dejan el contador en 2 para que el 3ro sea el que dispara 1s.
        for _ in range(2):
            respuesta = client.post(
                "/api/v1/auth/login",
                data={"username": "ana@cataclub.test", "password": "mal"},
            )
            assert respuesta.status_code == 401

        # El 3er fallo consecutivo penaliza con 1s de `time.sleep` REAL
        # (`_calcular_retraso_login(3) == 1`). Se dispara en un hilo aparte
        # para poder medir OTRO request (`GET /health`) desde el hilo
        # principal mientras ese sleep todavía está en curso.
        a_punto_de_loguear = threading.Event()
        resultado_tercer_intento = {}

        def _disparar_tercer_intento_fallido():
            a_punto_de_loguear.set()
            resultado_tercer_intento["respuesta"] = client.post(
                "/api/v1/auth/login",
                data={"username": "ana@cataclub.test", "password": "mal"},
            )

        hilo = threading.Thread(target=_disparar_tercer_intento_fallido)
        hilo.start()
        a_punto_de_loguear.wait()
        # Margen fijo, no arbitrario: le da tiempo al POST de cruzar el
        # `TestClient` -> ASGI -> `AuthServicio.login` -> `_penalizar_intento_
        # fallido` y entrar al `time.sleep(1)` real ANTES de que el hilo
        # principal dispare `/health`. 0.1s alcanza sobrado frente al 1s de
        # penalización y es chico frente al margen de aserción (200ms) de
        # abajo, así que no infla el tiempo total del test de forma notoria.
        time.sleep(0.1)

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
