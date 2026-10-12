"""
#1653 S6: el contador de intentos fallidos de login vive en Redis, no en la
memoria de cada worker.

Antes (TRA-4 / #733) era un dict a nivel de módulo: con N workers el
atacante tenía N contadores y N enfriamientos independientes, y un reinicio
los borraba. Ahora el conteo y el enfriamiento son un hash por cuenta con TTL
en Redis, compartido entre procesos.

Los umbrales, la curva de retraso y las respuestas de bloqueo no cambiaron
(siguen cubiertos por `test_auth_freno_login.py`); acá se prueba lo que sí
cambió: dónde vive el estado.

Política cuando Redis no responde: FAIL-OPEN, igual que la presencia
(`app/infraestructura/presencia.py`). El login no puede depender de la
disponibilidad del broker: caído Redis, el freno por cuenta se apaga (queda el
rate limiter por IP) pero nadie queda afuera.
"""
import logging

import pytest

from app.dominio.excepciones import CredencialesInvalidas
from app.infraestructura import redis_intentos_login
from app.servicios_negocio import auth_servicio as auth_servicio_modulo
from app.servicios_negocio.auth_servicio import AuthServicio, LoginEnEnfriamiento
from tests.fabricas_auth import SleeperEspia, crear_usuario_auth
from tests.redis_falso import RedisFalso


class RelojFalso:
    def __init__(self, ahora: float = 1_000_000.0):
        self.ahora = ahora

    def __call__(self) -> float:
        return self.ahora

    def avanzar(self, segundos: float) -> None:
        self.ahora += segundos


@pytest.fixture()
def reloj():
    return RelojFalso()


@pytest.fixture()
def redis_falso(monkeypatch, reloj):
    falso = RedisFalso(reloj=reloj)
    monkeypatch.setattr(redis_intentos_login, "_cliente_redis", falso)
    return falso


def _servicio(db_session, reloj, espia=None):
    return AuthServicio(db_session, dormir=espia or SleeperEspia(), reloj=reloj)


def _fallar(servicio, veces, correo="ana@cataclub.test"):
    for _ in range(veces):
        with pytest.raises(CredencialesInvalidas):
            servicio.login(correo, "mal")


def _intentos(redis_falso, correo="ana@cataclub.test") -> int:
    # Por el comando (no por `.hashes`) para que el fake aplique los vencimientos.
    return int(redis_falso.hget(redis_intentos_login.clave_redis(correo), "intentos") or 0)


def test_no_queda_estado_de_intentos_en_la_memoria_del_proceso():
    assert not hasattr(auth_servicio_modulo, "_INTENTOS_FALLIDOS_LOGIN")


def test_cada_fallo_incrementa_el_contador_en_redis(db_session, redis_falso, reloj):
    crear_usuario_auth(db_session, correo="ana@cataclub.test")
    servicio = _servicio(db_session, reloj)

    for esperado in (1, 2, 3):
        _fallar(servicio, 1)
        assert _intentos(redis_falso) == esperado


def test_la_clave_es_normalizada_y_de_largo_fijo(redis_falso):
    # El correo es input crudo del atacante: la clave de Redis no puede
    # heredar su largo ni exponerlo (#733).
    corta = redis_intentos_login.clave_redis("ana@cataclub.test")
    larga = redis_intentos_login.clave_redis("a" * 100_006)

    assert len(corta) == len(larga)
    assert "ana@cataclub.test" not in corta


def test_el_umbral_de_diez_fallos_bloquea_y_responde_con_los_segundos_restantes(db_session, redis_falso, reloj):
    crear_usuario_auth(db_session, correo="ana@cataclub.test", contrasenia="clave-correcta")
    servicio = _servicio(db_session, reloj)

    _fallar(servicio, 9)
    assert servicio.login("ana@cataclub.test", "clave-correcta")["access_token"]
    _fallar(servicio, 10)

    reloj.avanzar(60)
    with pytest.raises(LoginEnEnfriamiento) as info:
        servicio.login("ana@cataclub.test", "clave-correcta")
    assert info.value.segundos_restantes == 14 * 60


def test_un_login_exitoso_borra_la_clave_de_redis(db_session, redis_falso, reloj):
    crear_usuario_auth(db_session, correo="ana@cataclub.test", contrasenia="clave-correcta")
    servicio = _servicio(db_session, reloj)
    _fallar(servicio, 4)
    assert _intentos(redis_falso) == 4

    servicio.login("ana@cataclub.test", "clave-correcta")

    assert redis_intentos_login.clave_redis("ana@cataclub.test") not in redis_falso.hashes


def test_la_ventana_deslizante_de_15_minutos_expira_la_clave_idle(db_session, redis_falso, reloj):
    crear_usuario_auth(db_session, correo="ana@cataclub.test")
    servicio = _servicio(db_session, reloj)
    _fallar(servicio, 2)

    reloj.avanzar(15 * 60 - 1)
    assert _intentos(redis_falso) == 2

    reloj.avanzar(1)
    assert _intentos(redis_falso) == 0

    # Contador nuevo: el 1.º fallo no cuenta como 3.º, no retrasa.
    espia = SleeperEspia()
    _fallar(_servicio(db_session, reloj, espia), 1)
    assert espia.llamadas == []


def test_cada_fallo_renueva_la_ventana(db_session, redis_falso, reloj):
    crear_usuario_auth(db_session, correo="ana@cataclub.test")
    servicio = _servicio(db_session, reloj)

    for _ in range(3):
        _fallar(servicio, 1)
        reloj.avanzar(10 * 60)  # nunca llega a 15 min de silencio

    assert _intentos(redis_falso) == 3


def test_el_contador_sobrevive_al_enfriamiento_y_vence_15_minutos_despues(db_session, redis_falso, reloj):
    crear_usuario_auth(db_session, correo="ana@cataclub.test")
    servicio = _servicio(db_session, reloj)
    _fallar(servicio, 10)

    reloj.avanzar(15 * 60)  # vence el enfriamiento; el contador sigue vivo
    assert _intentos(redis_falso) == 10
    _fallar(servicio, 1)  # el 11.º reentra de inmediato
    with pytest.raises(LoginEnEnfriamiento):
        servicio.login("ana@cataclub.test", "mal")

    reloj.avanzar(30 * 60)
    assert _intentos(redis_falso) == 0


def test_toda_clave_escrita_tiene_ttl(db_session, redis_falso, reloj):
    # Esencia de #733: nada retenido para siempre.
    servicio = _servicio(db_session, reloj)
    for i in range(20):
        _fallar(servicio, 1, correo=f"atacante{i}@ejemplo.test")
    _fallar(servicio, 10, correo="victima@ejemplo.test")

    assert redis_falso.hashes
    assert set(redis_falso.hashes) <= set(redis_falso.vence)


def test_dos_instancias_comparten_el_conteo_y_el_enfriamiento(db_session, redis_falso, reloj):
    crear_usuario_auth(db_session, correo="ana@cataclub.test", contrasenia="clave-correcta")
    worker_a = _servicio(db_session, reloj)
    worker_b = _servicio(db_session, reloj)

    _fallar(worker_a, 5)
    _fallar(worker_b, 5)  # el 10.º, visto desde otro worker, dispara el bloqueo

    for worker in (worker_a, worker_b):
        with pytest.raises(LoginEnEnfriamiento):
            worker.login("ana@cataclub.test", "clave-correcta")


def test_el_retraso_progresivo_cuenta_los_fallos_de_todos_los_workers(db_session, redis_falso, reloj):
    crear_usuario_auth(db_session, correo="ana@cataclub.test")
    espia_a, espia_b = SleeperEspia(), SleeperEspia()
    worker_a = _servicio(db_session, reloj, espia_a)
    worker_b = _servicio(db_session, reloj, espia_b)

    _fallar(worker_a, 2)
    _fallar(worker_b, 1)  # 3.er fallo del conjunto: 1 s

    assert espia_a.llamadas == []
    assert espia_b.llamadas == [1]


def test_exito_en_un_worker_resetea_el_contador_de_los_demas(db_session, redis_falso, reloj):
    crear_usuario_auth(db_session, correo="ana@cataclub.test", contrasenia="clave-correcta")
    espia_b = SleeperEspia()
    worker_a = _servicio(db_session, reloj)
    worker_b = _servicio(db_session, reloj, espia_b)
    _fallar(worker_b, 2)

    worker_a.login("ana@cataclub.test", "clave-correcta")
    _fallar(worker_b, 1)

    assert espia_b.llamadas == []


# --- Redis no responde: fail-open --------------------------------------------

@pytest.fixture()
def redis_caido(monkeypatch, reloj):
    caido = RedisFalso(falla=True, reloj=reloj)
    monkeypatch.setattr(redis_intentos_login, "_cliente_redis", caido)
    monkeypatch.setattr(redis_intentos_login, "_ultimo_aviso_falla", 0.0)
    return caido


def test_con_redis_caido_el_login_correcto_sigue_funcionando(db_session, redis_caido, reloj):
    crear_usuario_auth(db_session, correo="ana@cataclub.test", contrasenia="clave-correcta")

    assert _servicio(db_session, reloj).login("ana@cataclub.test", "clave-correcta")["access_token"]


def test_con_redis_caido_la_contrasenia_incorrecta_sigue_siendo_401_sin_retraso(db_session, redis_caido, reloj):
    crear_usuario_auth(db_session, correo="ana@cataclub.test")
    espia = SleeperEspia()
    servicio = _servicio(db_session, reloj, espia)

    _fallar(servicio, 12)  # nunca LoginEnEnfriamiento, nunca 500

    assert espia.llamadas == []


def test_con_redis_caido_se_avisa_en_el_log_una_sola_vez(db_session, redis_caido, reloj, caplog):
    crear_usuario_auth(db_session, correo="ana@cataclub.test")
    servicio = _servicio(db_session, reloj)

    with caplog.at_level(logging.WARNING, logger=redis_intentos_login._log.name):
        _fallar(servicio, 3)

    avisos = [r for r in caplog.records if "Redis" in r.getMessage()]
    assert len(avisos) == 1


def test_al_volver_redis_el_freno_se_reanuda(db_session, monkeypatch, reloj):
    crear_usuario_auth(db_session, correo="ana@cataclub.test")
    caido = RedisFalso(falla=True, reloj=reloj)
    monkeypatch.setattr(redis_intentos_login, "_cliente_redis", caido)
    monkeypatch.setattr(redis_intentos_login, "_ultimo_aviso_falla", 0.0)
    espia = SleeperEspia()
    servicio = _servicio(db_session, reloj, espia)
    _fallar(servicio, 5)
    assert espia.llamadas == []

    caido.falla = False
    _fallar(servicio, 3)

    assert espia.llamadas == [1]


def test_reiniciar_la_contrasenia_con_redis_caido_no_falla(db_session, redis_caido, reloj):
    usuario = crear_usuario_auth(db_session, correo="ana@cataclub.test", contrasenia="clave-correcta")
    from app.seguridad.gestor_auth import GestorAutenticacion

    token = GestorAutenticacion.crear_token_recuperacion("ana@cataclub.test", usuario.version_contrasenia)
    _servicio(db_session, reloj).restablecer_contrasenia(token, "clave-nueva-123")

    assert _servicio(db_session, reloj).login("ana@cataclub.test", "clave-nueva-123")["access_token"]
