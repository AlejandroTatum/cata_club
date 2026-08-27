"""
Issue #733: `POST /auth/login` era un vector de denegación de servicio SIN
autenticar. `_INTENTOS_FALLIDOS_LOGIN` (auth_servicio.py) es un dict a nivel
de módulo, keyeado sobre `correo.strip().lower()` -- el input crudo del
atacante, sin tope de longitud ni de tamaño de mapa. Un correo nunca visto
antes solo se borra con un login EXITOSO en esa clave exacta, que nunca pasa
para un string al azar, así que cada intento fallido con un correo distinto
queda retenido para siempre.

Medido contra el stack corriendo: un username de 100.006 caracteres fue
aceptado (401, no 422) y 40 requests en 0.5s movieron el RSS del backend de
154.9 a 159.5 MiB (~115 KB retenidos por request, para siempre). Con los 320m
que `docker-compose.prod.yml` asigna al backend y el techo propio del rate
limiter (60 req/min/IP), eso alcanza el OOM-kill en menos de media hora.

Dos mitades independientes:
  1. Tope de longitud en la capa de FORM (`auth_router.py`): un username más
     largo que cualquier dirección de correo real se rechaza con 422 ANTES
     de convertirse en clave del dict.
  2. Cota del propio mapa (`_MAX_ENTRADAS_INTENTOS_LOGIN` +
     `_TTL_INTENTOS_LOGIN_SEGUNDOS` en auth_servicio.py): aun con claves de
     longitud acotada, un atacante puede acuñar direcciones distintas sin
     límite, así que el mapa necesita desalojo propio.

No repite acá la curva de retraso completa contra una cuenta real -- ya
existe, sin cambios, en `test_auth_freno_login.py::
test_retraso_duplica_y_tiene_techo_de_60_segundos`, y sigue en verde después
de este fix: eso YA prueba la no-regresión. Lo que sí es específico de esta
suite (`test_cuenta_atacada_no_es_desalojada_por_relleno_de_entradas_falsas`
más abajo) es que esa misma cuenta sobrevive un relleno de basura antes de
llegar a su 3er fallo -- el escenario que el desalojo por tamaño podría
romper si estuviera mal elegido.
"""
import pytest

from app.dominio.excepciones import CredencialesInvalidas
from app.servicios_negocio import auth_servicio as auth_servicio_modulo
from app.servicios_negocio.auth_servicio import AuthServicio
from tests.fabricas_auth import SleeperEspia, crear_usuario_auth


def _rellenar_mapa_con_claves_distintas(cantidad: int, prefijo: str) -> None:
    """Ataque de amplitud: registra `cantidad` intentos fallidos contra
    `cantidad` claves DISTINTAS (sin DB, sin HTTP -- llama directo al helper
    de registro). Compartido por los dos tests de la cota de tamaño: uno
    prueba el tope global, el otro que ese desalojo no se lleva puesta a una
    cuenta bajo ataque real -- cada uno agrega su propia aserción distinta
    después de llamar a esto, así que no se pierde qué prueba qué."""
    for i in range(cantidad):
        auth_servicio_modulo._registrar_intento_fallido(f"{prefijo}{i}@ejemplo.test")


@pytest.fixture(autouse=True)
def _limpiar_contador_intentos():
    auth_servicio_modulo._INTENTOS_FALLIDOS_LOGIN.clear()
    yield
    auth_servicio_modulo._INTENTOS_FALLIDOS_LOGIN.clear()


# --- Mitad 1: tope de longitud en la capa de form ---------------------------

def test_username_demasiado_largo_se_rechaza_sin_crear_entrada(client):
    """Un username de 100.006 caracteres (el que se usó para medir el bug
    contra el stack real) debe rechazarse con 422 -- estructuralmente
    imposible como correo -- y jamás debe llegar a `AuthServicio.login`, así
    que no debe crear ninguna entrada en el mapa de intentos fallidos."""
    username_oversized = "a" * 100_006

    respuesta = client.post(
        "/api/v1/auth/login",
        data={"username": username_oversized, "password": "lo-que-sea"},
    )

    assert respuesta.status_code == 422
    assert len(auth_servicio_modulo._INTENTOS_FALLIDOS_LOGIN) == 0


def test_username_en_el_limite_no_se_rechaza_por_longitud(client, db_session):
    """Un correo de longitud real (dentro de RFC 5321) no debe verse afectado
    por el tope -- sigue respondiendo 401 (credenciales inválidas), no 422."""
    crear_usuario_auth(db_session, correo="ana@cataclub.test", contrasenia="clave-correcta")

    respuesta = client.post(
        "/api/v1/auth/login",
        data={"username": "ana@cataclub.test", "password": "mal"},
    )

    assert respuesta.status_code == 401


# --- Mitad 2: cota del mapa ---------------------------------------------------

def test_mapa_de_intentos_fallidos_no_crece_sin_limite():
    """Ataque de amplitud: muchas direcciones DISTINTAS, cada una de longitud
    válida. Sin cota, cada una queda para siempre. Se llama directamente al
    helper de registro (sin DB, sin HTTP) para poder probar el tope real de
    producción (`_MAX_ENTRADAS_INTENTOS_LOGIN`) sin que el test se vuelva
    lento."""
    limite = auth_servicio_modulo._MAX_ENTRADAS_INTENTOS_LOGIN

    _rellenar_mapa_con_claves_distintas(limite + 500, prefijo="atacante")

    assert len(auth_servicio_modulo._INTENTOS_FALLIDOS_LOGIN) <= limite


def test_cuenta_atacada_no_es_desalojada_por_relleno_de_entradas_falsas(db_session):
    """El desalojo por tamaño no debe destruir la protección de una cuenta
    REALMENTE atacada: si el atacante intercala intentos contra `ana` con el
    relleno de basura, la clave de `ana` -- tocada en cada uno de sus propios
    intentos -- debe sobrevivir el relleno (LRU: lo último tocado es lo
    último en desalojarse)."""
    crear_usuario_auth(db_session, correo="ana@cataclub.test")
    espia = SleeperEspia()
    servicio = AuthServicio(db_session, dormir=espia)

    with pytest.raises(CredencialesInvalidas):
        servicio.login("ana@cataclub.test", "mal")
    with pytest.raises(CredencialesInvalidas):
        servicio.login("ana@cataclub.test", "mal")

    # Relleno: bastante menos que el límite, tocando `ana` de nuevo al final
    # -- simula al atacante intercalando basura mientras sigue insistiendo
    # sobre la cuenta real.
    _rellenar_mapa_con_claves_distintas(
        auth_servicio_modulo._MAX_ENTRADAS_INTENTOS_LOGIN // 4, prefijo="relleno",
    )

    # 3er fallo real sobre ana: si su entrada sobrevivió, dispara el freno de
    # 1s (intentos 3..N ya vistos en test_auth_freno_login.py).
    with pytest.raises(CredencialesInvalidas):
        servicio.login("ana@cataclub.test", "mal")

    assert espia.llamadas == [1]
