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
from app.servicios_negocio.auth_servicio import AuthServicio
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
    servicio = AuthServicio(db_session, dormir=espia)

    for _ in range(10):
        with pytest.raises(CredencialesInvalidas):
            servicio.login("ana@cataclub.test", "mal")

    assert auth_servicio_modulo._INTENTOS_FALLIDOS_LOGIN["ana@cataclub.test"][0] == 10
    assert max(espia.llamadas) == 8

    # Ni una clave correcta salta el freno: sigue pasando por la misma
    # verificación, y solo el éxito resetea el contador.
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
