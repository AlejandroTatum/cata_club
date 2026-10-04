"""
TRA-4 (issue #111): freno progresivo por cuenta contra fuerza bruta de login.

Antes, el único tope era el rate limiter genérico (60/minuto por IP,
`auth_router.py:21`), que no protege a una cuenta puntual: reparte el ataque
entre varias IPs, o simplemente entra dentro del cupo por minuto. La decisión
de negocio (docs/product/decisiones-de-negocio-2026-08-11.md, sección 3) descarta un
bloqueo duro -- eso regala un ataque nuevo, dejar a un socio afuera sin saber
ninguna contraseña -- y elige un retraso creciente por CUENTA: 1s al tercer
intento fallido, 2s al cuarto, 4s al quinto, duplicando, techo de 8s. Un
login exitoso resetea el contador.

Anti-enumeración: el contador y el retraso se aplican sobre el string de
correo tal cual llega, ANTES de saber si existe un Usuario con ese correo --
así la curva de retraso de una cuenta real con contraseña incorrecta es
indistinguible de la de una cuenta inexistente (ver el último test).
"""
import pytest

from app.dominio.cedula import cedula_valida
from app.dominio.excepciones import CredencialesInvalidas
from app.servicios_negocio import auth_servicio as auth_servicio_modulo
from app.seguridad.gestor_auth import GestorAutenticacion
from app.servicios_negocio.auth_servicio import AuthServicio, LoginEnEnfriamiento
from tests.fabricas_auth import SleeperEspia, crear_usuario_auth as _crear_usuario


@pytest.fixture(autouse=True)
def _limpiar_contador_intentos():
    """El contador vive en un dict a nivel de módulo (simplificación aceptada,
    ver docstring de `AuthServicio.login`) -- se limpia entre tests para que
    los intentos de un test no se filtren al siguiente."""
    auth_servicio_modulo._INTENTOS_FALLIDOS_LOGIN.clear()
    yield
    auth_servicio_modulo._INTENTOS_FALLIDOS_LOGIN.clear()


def test_primeros_dos_intentos_fallidos_no_retrasan(db_session):
    _crear_usuario(db_session, correo="ana@cataclub.test")
    espia = SleeperEspia()
    servicio = AuthServicio(db_session, dormir=espia)

    for _ in range(2):
        with pytest.raises(CredencialesInvalidas):
            servicio.login("ana@cataclub.test", "contraseña-incorrecta")

    assert espia.llamadas == []


def test_tercer_intento_fallido_retrasa_un_segundo(db_session):
    _crear_usuario(db_session, correo="ana@cataclub.test")
    espia = SleeperEspia()
    servicio = AuthServicio(db_session, dormir=espia)

    for _ in range(3):
        with pytest.raises(CredencialesInvalidas):
            servicio.login("ana@cataclub.test", "mal")

    assert espia.llamadas == [1]


def test_retraso_duplica_y_tiene_techo_de_8_segundos(db_session):
    _crear_usuario(db_session, correo="ana@cataclub.test")
    espia = SleeperEspia()
    servicio = AuthServicio(db_session, dormir=espia)

    for _ in range(10):
        with pytest.raises(CredencialesInvalidas):
            servicio.login("ana@cataclub.test", "mal")

    # Intentos 3..10 -> 1, 2, 4, 8, 16(techo->8), 32(techo->8), 64, 128 (techo->8)
    assert espia.llamadas == [1, 2, 4, 8, 8, 8, 8, 8]


def test_techo_de_8_segundos_cabe_en_el_timeout_de_la_interfaz(db_session):
    """REG-02: la interfaz corta a los 10 s; ninguna espera puede acercarse."""
    assert auth_servicio_modulo._TECHO_RETRASO_SEGUNDOS == 8


def test_el_techo_acota_la_espera_no_el_conteo_de_intentos(db_session):
    """REG-02: el techo recorta solo el sleep. El contador sigue creciendo
    (el freno no se relaja ni se reinicia al llegar al techo), y un login
    exitoso lo resetea igual que antes."""
    _crear_usuario(db_session, correo="ana@cataclub.test", contrasenia="clave-correcta")
    espia = SleeperEspia()
    reloj = lambda: 1_000.0  # noqa: E731 -- el reloj no importa acá
    servicio = AuthServicio(db_session, dormir=espia, reloj=reloj)

    for _ in range(10):
        with pytest.raises(CredencialesInvalidas):
            servicio.login("ana@cataclub.test", "mal")

    assert auth_servicio_modulo._INTENTOS_FALLIDOS_LOGIN["ana@cataclub.test"][0] == 10
    assert max(espia.llamadas) == 8

    # Solo el éxito resetea el contador (el enfriamiento de 15 min ya venció).
    servicio = AuthServicio(db_session, dormir=espia, reloj=lambda: 1_000.0 + 15 * 60)
    servicio.login("ana@cataclub.test", "clave-correcta")
    assert "ana@cataclub.test" not in auth_servicio_modulo._INTENTOS_FALLIDOS_LOGIN


def test_contador_es_por_cuenta_no_global(db_session):
    _crear_usuario(db_session, correo="ana@cataclub.test", cedula="1710034065")
    _crear_usuario(db_session, correo="beto@cataclub.test", cedula=cedula_valida(150))
    espia = SleeperEspia()
    servicio = AuthServicio(db_session, dormir=espia)

    for _ in range(3):
        with pytest.raises(CredencialesInvalidas):
            servicio.login("ana@cataclub.test", "mal")
    assert espia.llamadas == [1]

    # beto nunca falló antes: su tercer intento fallido también debe ser el
    # PRIMERO que dispara retraso, no heredar el contador de ana.
    espia.llamadas.clear()
    for _ in range(3):
        with pytest.raises(CredencialesInvalidas):
            servicio.login("beto@cataclub.test", "mal")
    assert espia.llamadas == [1]


def test_login_exitoso_resetea_el_contador(db_session):
    _crear_usuario(db_session, correo="ana@cataclub.test", contrasenia="clave-correcta")
    espia = SleeperEspia()
    servicio = AuthServicio(db_session, dormir=espia)

    for _ in range(2):
        with pytest.raises(CredencialesInvalidas):
            servicio.login("ana@cataclub.test", "mal")

    resultado = servicio.login("ana@cataclub.test", "clave-correcta")
    assert "access_token" in resultado

    espia.llamadas.clear()
    # Si el contador NO se resetea, este sería el 3er fallo acumulado (debería
    # retrasar); si se reseteó, es el 1ro (no debe retrasar).
    with pytest.raises(CredencialesInvalidas):
        servicio.login("ana@cataclub.test", "mal")
    assert espia.llamadas == []


def test_cuenta_inexistente_sigue_la_misma_curva_de_retraso_que_una_real(db_session):
    """Anti-enumeración: nada distingue por timing una cuenta real con
    contraseña incorrecta de una que directamente no existe."""
    _crear_usuario(db_session, correo="ana@cataclub.test")
    espia_real = SleeperEspia()
    servicio_real = AuthServicio(db_session, dormir=espia_real)
    espia_fantasma = SleeperEspia()
    servicio_fantasma = AuthServicio(db_session, dormir=espia_fantasma)

    for _ in range(5):
        with pytest.raises(CredencialesInvalidas):
            servicio_real.login("ana@cataclub.test", "mal")
        with pytest.raises(CredencialesInvalidas):
            servicio_fantasma.login("no-existe@cataclub.test", "lo-que-sea")

    assert espia_real.llamadas == espia_fantasma.llamadas == [1, 2, 4]


# --- REG-02: enfriamiento de 15 minutos tras 10 fallos consecutivos -----------
# El techo de 8 s acota la espera de cada intento, pero ya no frena a quien
# insiste. Este es el freno que lo compensa: la cuenta deja de aceptar intentos
# (también el de la contraseña correcta) durante 15 minutos, y se rechaza SIN
# correr bcrypt.

class RelojFalso:
    """Reloj monotónico controlado por el test: nunca espera de verdad."""

    def __init__(self, ahora: float = 1_000.0):
        self.ahora = ahora

    def __call__(self) -> float:
        return self.ahora

    def avanzar(self, segundos: float) -> None:
        self.ahora += segundos


def _servicio(db_session, reloj=None):
    return AuthServicio(db_session, dormir=SleeperEspia(), reloj=reloj or RelojFalso())


def _fallar(servicio, veces, correo="ana@cataclub.test"):
    for _ in range(veces):
        with pytest.raises(CredencialesInvalidas):
            servicio.login(correo, "mal")


def test_el_decimo_fallo_sigue_siendo_401_y_el_siguiente_intento_se_rechaza(db_session):
    _crear_usuario(db_session, correo="ana@cataclub.test", contrasenia="clave-correcta")
    servicio = _servicio(db_session)

    _fallar(servicio, 10)

    with pytest.raises(LoginEnEnfriamiento) as info:
        servicio.login("ana@cataclub.test", "mal")
    assert info.value.segundos_restantes == 15 * 60


def test_antes_del_decimo_fallo_no_hay_enfriamiento(db_session):
    _crear_usuario(db_session, correo="ana@cataclub.test", contrasenia="clave-correcta")
    servicio = _servicio(db_session)

    _fallar(servicio, 9)

    assert servicio.login("ana@cataclub.test", "clave-correcta")["access_token"]


def test_la_clave_correcta_tambien_se_rechaza_y_sin_correr_bcrypt(db_session, monkeypatch):
    _crear_usuario(db_session, correo="ana@cataclub.test", contrasenia="clave-correcta")
    servicio = _servicio(db_session)
    _fallar(servicio, 10)

    def _bcrypt_prohibido(*args, **kwargs):
        raise AssertionError("durante el enfriamiento no se debe verificar la contraseña")

    monkeypatch.setattr(
        auth_servicio_modulo.GestorAutenticacion, "verificar_contrasenia", _bcrypt_prohibido,
    )
    monkeypatch.setattr(servicio.repo, "obtener_por_correo", _bcrypt_prohibido)

    with pytest.raises(LoginEnEnfriamiento):
        servicio.login("ana@cataclub.test", "clave-correcta")


def test_los_intentos_rechazados_no_duermen_ni_prolongan_el_enfriamiento(db_session):
    _crear_usuario(db_session, correo="ana@cataclub.test")
    reloj = RelojFalso()
    espia = SleeperEspia()
    servicio = AuthServicio(db_session, dormir=espia, reloj=reloj)
    _fallar(servicio, 10)
    dormidas = list(espia.llamadas)

    reloj.avanzar(10 * 60)
    for _ in range(5):
        with pytest.raises(LoginEnEnfriamiento) as info:
            servicio.login("ana@cataclub.test", "mal")
    assert espia.llamadas == dormidas
    assert info.value.segundos_restantes == 5 * 60


def test_el_enfriamiento_vence_a_los_15_minutos(db_session):
    _crear_usuario(db_session, correo="ana@cataclub.test", contrasenia="clave-correcta")
    reloj = RelojFalso()
    servicio = _servicio(db_session, reloj)
    _fallar(servicio, 10)

    reloj.avanzar(15 * 60 - 1)
    with pytest.raises(LoginEnEnfriamiento):
        servicio.login("ana@cataclub.test", "clave-correcta")

    reloj.avanzar(1)
    assert servicio.login("ana@cataclub.test", "clave-correcta")["access_token"]


def test_tras_vencer_el_siguiente_fallo_reentra_al_enfriamiento_de_inmediato(db_session):
    _crear_usuario(db_session, correo="ana@cataclub.test")
    reloj = RelojFalso()
    servicio = _servicio(db_session, reloj)
    _fallar(servicio, 10)

    reloj.avanzar(15 * 60)
    _fallar(servicio, 1)  # el 11.º: 401 y vuelve a bloquear

    with pytest.raises(LoginEnEnfriamiento) as info:
        servicio.login("ana@cataclub.test", "mal")
    assert info.value.segundos_restantes == 15 * 60


def test_un_exito_tras_vencer_resetea_el_contador(db_session):
    _crear_usuario(db_session, correo="ana@cataclub.test", contrasenia="clave-correcta")
    reloj = RelojFalso()
    servicio = _servicio(db_session, reloj)
    _fallar(servicio, 10)
    reloj.avanzar(15 * 60)
    servicio.login("ana@cataclub.test", "clave-correcta")

    _fallar(servicio, 1)  # contador nuevo: el 1.º fallo no bloquea

    assert servicio.login("ana@cataclub.test", "clave-correcta")["access_token"]


def test_restablecer_la_contrasenia_limpia_enfriamiento_y_contador(db_session):
    usuario = _crear_usuario(db_session, correo="ana@cataclub.test", contrasenia="clave-correcta")
    servicio = _servicio(db_session)
    _fallar(servicio, 10)
    with pytest.raises(LoginEnEnfriamiento):
        servicio.login("ana@cataclub.test", "clave-correcta")

    token = GestorAutenticacion.crear_token_recuperacion("ana@cataclub.test", usuario.version_contrasenia)
    servicio.restablecer_contrasenia(token, "clave-nueva-123")

    assert "ana@cataclub.test" not in auth_servicio_modulo._INTENTOS_FALLIDOS_LOGIN
    assert servicio.login("ana@cataclub.test", "clave-nueva-123")["access_token"]


def test_cuenta_inexistente_sigue_el_mismo_enfriamiento_que_una_real(db_session):
    """Anti-enumeración: mismo conteo, mismo rechazo y mismos segundos."""
    _crear_usuario(db_session, correo="ana@cataclub.test")
    reloj = RelojFalso()
    servicio = _servicio(db_session, reloj)
    _fallar(servicio, 10, "ana@cataclub.test")
    _fallar(servicio, 10, "no-existe@cataclub.test")
    reloj.avanzar(60)

    with pytest.raises(LoginEnEnfriamiento) as real:
        servicio.login("ana@cataclub.test", "mal")
    with pytest.raises(LoginEnEnfriamiento) as fantasma:
        servicio.login("no-existe@cataclub.test", "mal")

    assert real.value.segundos_restantes == fantasma.value.segundos_restantes == 14 * 60
    assert str(real.value) == str(fantasma.value)


def test_la_clave_del_enfriamiento_ignora_mayusculas_y_espacios(db_session):
    _crear_usuario(db_session, correo="ana@cataclub.test")
    servicio = _servicio(db_session)
    _fallar(servicio, 10, "  ANA@cataclub.test ")

    with pytest.raises(LoginEnEnfriamiento):
        servicio.login("ana@cataclub.test", "mal")


def test_el_enfriamiento_es_por_cuenta(db_session):
    _crear_usuario(db_session, correo="ana@cataclub.test", cedula="1710034065")
    _crear_usuario(db_session, correo="beto@cataclub.test", cedula=cedula_valida(150), contrasenia="clave-beto")
    servicio = _servicio(db_session)
    _fallar(servicio, 10, "ana@cataclub.test")

    assert servicio.login("beto@cataclub.test", "clave-beto")["access_token"]


def test_el_mapa_sigue_acotado_aun_con_enfriamientos(db_session):
    for i in range(auth_servicio_modulo._MAX_ENTRADAS_INTENTOS_LOGIN + 50):
        for _ in range(10):
            auth_servicio_modulo._registrar_intento_fallido(f"x{i}@ejemplo.test")
    assert len(auth_servicio_modulo._INTENTOS_FALLIDOS_LOGIN) <= auth_servicio_modulo._MAX_ENTRADAS_INTENTOS_LOGIN


def test_el_endpoint_responde_429_con_codigo_y_retry_after_durante_el_enfriamiento(db_session, client):
    _crear_usuario(db_session, correo="ana@cataclub.test", contrasenia="clave-correcta")
    for _ in range(10):
        auth_servicio_modulo._registrar_intento_fallido("ana@cataclub.test")

    for correo, clave in (("ana@cataclub.test", "clave-correcta"), ("no-existe@cataclub.test", "x")):
        if correo != "ana@cataclub.test":
            for _ in range(10):
                auth_servicio_modulo._registrar_intento_fallido(correo)
        respuesta = client.post("/api/v1/auth/login", data={"username": correo, "password": clave})
        assert respuesta.status_code == 429
        assert respuesta.json()["codigo"] == "login_enfriamiento"
        assert respuesta.json()["message"] == (
            "Demasiados intentos fallidos. Por seguridad, espera 15 minutos o restablece tu contraseña."
        )
        assert 0 < int(respuesta.headers["Retry-After"]) <= 15 * 60
