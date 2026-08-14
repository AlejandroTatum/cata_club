"""
TRA-4 (issue #111): freno progresivo por cuenta contra fuerza bruta de login.

Antes, el único tope era el rate limiter genérico (60/minuto por IP,
`auth_router.py:21`), que no protege a una cuenta puntual: reparte el ataque
entre varias IPs, o simplemente entra dentro del cupo por minuto. La decisión
de negocio (docs/product/decisiones-de-negocio-2026-08-11.md, sección 3) descarta un
bloqueo duro -- eso regala un ataque nuevo, dejar a un socio afuera sin saber
ninguna contraseña -- y elige un retraso creciente por CUENTA: 1s al tercer
intento fallido, 2s al cuarto, 4s al quinto, duplicando, techo de 60s. Un
login exitoso resetea el contador.

Anti-enumeración: el contador y el retraso se aplican sobre el string de
correo tal cual llega, ANTES de saber si existe un Usuario con ese correo --
así la curva de retraso de una cuenta real con contraseña incorrecta es
indistinguible de la de una cuenta inexistente (ver el último test).
"""
from datetime import date

import pytest

from app.dominio.cedula import cedula_valida
from app.dominio.excepciones import CredencialesInvalidas
from app.dominio.modelos import Persona, Usuario
from app.seguridad.gestor_auth import GestorAutenticacion
from app.servicios_negocio import auth_servicio as auth_servicio_modulo
from app.servicios_negocio.auth_servicio import AuthServicio


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


@pytest.fixture(autouse=True)
def _limpiar_contador_intentos():
    """El contador vive en un dict a nivel de módulo (simplificación aceptada,
    ver docstring de `AuthServicio.login`) -- se limpia entre tests para que
    los intentos de un test no se filtren al siguiente."""
    auth_servicio_modulo._INTENTOS_FALLIDOS_LOGIN.clear()
    yield
    auth_servicio_modulo._INTENTOS_FALLIDOS_LOGIN.clear()


class _SleeperEspia:
    """Sleeper falso: registra con qué segundos lo llamaron y nunca duerme de
    verdad (BRIEF.md: ningún test hace un sleep real de varios segundos)."""

    def __init__(self):
        self.llamadas = []

    def __call__(self, segundos):
        self.llamadas.append(segundos)


def test_primeros_dos_intentos_fallidos_no_retrasan(db_session):
    _crear_usuario(db_session, correo="ana@cataclub.test")
    espia = _SleeperEspia()
    servicio = AuthServicio(db_session, dormir=espia)

    for _ in range(2):
        with pytest.raises(CredencialesInvalidas):
            servicio.login("ana@cataclub.test", "contraseña-incorrecta")

    assert espia.llamadas == []


def test_tercer_intento_fallido_retrasa_un_segundo(db_session):
    _crear_usuario(db_session, correo="ana@cataclub.test")
    espia = _SleeperEspia()
    servicio = AuthServicio(db_session, dormir=espia)

    for _ in range(3):
        with pytest.raises(CredencialesInvalidas):
            servicio.login("ana@cataclub.test", "mal")

    assert espia.llamadas == [1]


def test_retraso_duplica_y_tiene_techo_de_60_segundos(db_session):
    _crear_usuario(db_session, correo="ana@cataclub.test")
    espia = _SleeperEspia()
    servicio = AuthServicio(db_session, dormir=espia)

    for _ in range(10):
        with pytest.raises(CredencialesInvalidas):
            servicio.login("ana@cataclub.test", "mal")

    # Intentos 3..10 -> 1, 2, 4, 8, 16, 32, 64(techo->60), 128(techo->60)
    assert espia.llamadas == [1, 2, 4, 8, 16, 32, 60, 60]


def test_contador_es_por_cuenta_no_global(db_session):
    _crear_usuario(db_session, correo="ana@cataclub.test", cedula="1710034065")
    _crear_usuario(db_session, correo="beto@cataclub.test", cedula=cedula_valida(150))
    espia = _SleeperEspia()
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
    espia = _SleeperEspia()
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
    espia_real = _SleeperEspia()
    servicio_real = AuthServicio(db_session, dormir=espia_real)
    espia_fantasma = _SleeperEspia()
    servicio_fantasma = AuthServicio(db_session, dormir=espia_fantasma)

    for _ in range(5):
        with pytest.raises(CredencialesInvalidas):
            servicio_real.login("ana@cataclub.test", "mal")
        with pytest.raises(CredencialesInvalidas):
            servicio_fantasma.login("no-existe@cataclub.test", "lo-que-sea")

    assert espia_real.llamadas == espia_fantasma.llamadas == [1, 2, 4]
