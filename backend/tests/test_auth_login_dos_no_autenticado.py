"""
Issue #733: `POST /auth/login` era un vector de denegación de servicio SIN
autenticar. El contador de intentos fallidos (hoy en Redis, antes un dict a
nivel de módulo en auth_servicio.py) se keyea sobre `correo.strip().lower()`
-- el input crudo del atacante, sin tope de longitud ni de tamaño. Un correo nunca visto
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
  2. Cota del propio almacén (TTL en cada escritura + clave hasheada de
     largo fijo, ver `redis_intentos_login.py`): aun con claves de longitud
     acotada, un atacante puede acuñar direcciones distintas sin límite, así
     que nada puede quedar retenido para siempre.

No repite acá la curva de retraso completa contra una cuenta real -- ya
existe en `test_auth_freno_login.py::test_retraso_duplica_y_tiene_techo_de_
8_segundos`. Lo específico de esta suite es que el relleno de basura no se
lleva puesta a la cuenta atacada.
"""
import pytest

from app.dominio.excepciones import CredencialesInvalidas
from app.infraestructura import redis_intentos_login
from app.servicios_negocio import auth_servicio as auth_servicio_modulo
from app.servicios_negocio.auth_servicio import AuthServicio
from tests.fabricas_auth import SleeperEspia, crear_usuario_auth


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
    assert not redis_intentos_login._cliente().hashes


def test_username_en_el_limite_no_se_rechaza_por_longitud(client, db_session):
    """Un correo de longitud real (dentro de RFC 5321) no debe verse afectado
    por el tope -- sigue respondiendo 401 (credenciales inválidas), no 422."""
    crear_usuario_auth(db_session, correo="ana@cataclub.test", contrasenia="clave-correcta")

    respuesta = client.post(
        "/api/v1/auth/login",
        data={"username": "ana@cataclub.test", "password": "mal"},
    )

    assert respuesta.status_code == 401


# --- Mitad 2: cota del almacén -----------------------------------------------
# El dict por proceso y su tope LRU de 50.000 entradas desaparecieron con la
# migración a Redis (#1653 S6): la cota ahora es el TTL de CADA escritura y la
# clave hasheada, de largo fijo. El comportamiento de TTL deslizante y de
# supervivencia al enfriamiento se prueba en `test_auth_login_contador_redis.py`.

def test_ataque_de_amplitud_deja_solo_claves_con_ttl_y_de_largo_fijo(db_session):
    """Muchas direcciones DISTINTAS, cada una de longitud válida: ninguna
    queda retenida para siempre (todas vencen) ni crece con el input."""
    redis_falso = redis_intentos_login._cliente()
    for i in range(300):
        auth_servicio_modulo._registrar_intento_fallido(f"atacante{i}@ejemplo.test")
    auth_servicio_modulo._registrar_intento_fallido("a" * 254 + "@ejemplo.test")

    assert len(redis_falso.hashes) == 301
    assert set(redis_falso.hashes) <= set(redis_falso.vence)
    assert len({len(clave) for clave in redis_falso.hashes}) == 1


def test_cuenta_atacada_mantiene_su_conteo_entre_relleno_de_entradas_falsas(db_session):
    """Sin desalojo por tamaño, el relleno de basura no puede llevarse puesta
    la cuenta REALMENTE atacada: su 3.er fallo sigue disparando el freno."""
    crear_usuario_auth(db_session, correo="ana@cataclub.test")
    espia = SleeperEspia()
    servicio = AuthServicio(db_session, dormir=espia)

    for _ in range(2):
        with pytest.raises(CredencialesInvalidas):
            servicio.login("ana@cataclub.test", "mal")
    for i in range(2_000):
        auth_servicio_modulo._registrar_intento_fallido(f"relleno{i}@ejemplo.test")
    with pytest.raises(CredencialesInvalidas):
        servicio.login("ana@cataclub.test", "mal")

    assert espia.llamadas == [1]
