"""
Cobertura de comportamiento del arreglo de infraestructura para issue #235:
el rate limit anónimo era global (compartido por todo internet) en vez de
por visitante, porque el backend nunca veía la IP real -- su peer TCP
siempre era el contenedor del frontend (BFF).

El arreglo necesita las DOS mitades (ninguna alcanza sola):
  1. uvicorn corre con `--proxy-headers --forwarded-allow-ips=<red interna>`
     (backend/Dockerfile) para que reescriba `scope["client"]` a partir de
     `X-Forwarded-For`, SOLO cuando el peer inmediato es la red interna de
     Docker -- nunca "*", o cualquiera podría forjar su propia cabecera y
     estrenar cubo en cada request (peor que el bug original).
  2. `clave_cliente` (rate_limit.py) sigue leyendo `get_remote_address`, que
     lee `request.client.host` -- una vez que (1) reescribe ese campo, la
     clave cambia sola, sin tocar `clave_cliente`.

Esta suite NO usa `main.app` (fixture `client` de conftest.py): en
AMBIENTE=test el limiter activo es `_NoOpLimiter` (ver rate_limit.py) y el
handler 429 real nunca se registra ahí. En su lugar arma su propia app
mínima con un `Limiter` real + el mismo handler que `main.py` registra en
producción, envuelta en el `ProxyHeadersMiddleware` de uvicorn -- exactamente
la pieza que la topología real inserta ENTRE Caddy/frontend y la app ASGI, y
que un TestClient contra `main.app` nunca ejercita.

`--forwarded-allow-ips` se lee del Dockerfile real (no se hardcodea acá): si
alguien lo afloja a "*" o lo cambia sin actualizar esta suite, estas pruebas
igual seleccionan un peer DENTRO de ese rango vía `ipaddress`, así que solo
la regla estructural (`test_forwarded_allow_ips_no_es_comodin`) puede
detectar el comodín -- las pruebas de comportamiento no dependen del valor
exacto, solo de que exista una restricción real.
"""
import ipaddress
import re
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from app.soporte_transversal.rate_limit import clave_cliente
from main import _manejador_limite_excedido

RUTA_DOCKERFILE = Path(__file__).resolve().parent.parent / "Dockerfile"

# IP pública real (DNS de Google) -- garantizada fuera de CUALQUIER rango
# privado que `--forwarded-allow-ips` pueda declarar (RFC 1918), así que
# sirve como "atacante fuera de la red interna" sin acoplarse al valor
# concreto elegido en el Dockerfile.
PEER_NO_CONFIABLE = "8.8.8.8"


def _cmd_dockerfile() -> str:
    """Devuelve SOLO la línea `CMD` real -- no el archivo entero. Los
    comentarios de arriba (incluido el que explica esta misma decisión)
    también contienen el texto `--forwarded-allow-ips=...` entre backticks
    de markdown; buscar en el archivo completo matchea ESE texto primero y
    no el `CMD` real."""
    for linea in RUTA_DOCKERFILE.read_text().splitlines():
        if linea.strip().startswith("CMD"):
            return linea
    raise AssertionError("Dockerfile no declara un CMD")


def _forwarded_allow_ips_del_dockerfile() -> str:
    coincidencia = re.search(r"--forwarded-allow-ips=([^\s\"]+)", _cmd_dockerfile())
    assert coincidencia, "El CMD de uvicorn no declara --forwarded-allow-ips"
    return coincidencia.group(1)


def _peer_dentro_de_la_red_confiable() -> str:
    """Primer host utilizable de la primera red declarada en
    --forwarded-allow-ips -- simula el peer TCP real en producción (el
    contenedor `frontend`, dentro de la red interna de docker compose)."""
    primera_red = _forwarded_allow_ips_del_dockerfile().split(",")[0].strip()
    red = ipaddress.ip_network(primera_red)
    return str(next(red.hosts()))


# --- Guardias estructurales sobre el Dockerfile -----------------------------

def test_dockerfile_habilita_proxy_headers():
    assert "--proxy-headers" in _cmd_dockerfile()


def test_forwarded_allow_ips_no_es_comodin():
    """CRÍTICO de seguridad: `*` deja que cualquiera en internet forje su
    propia X-Forwarded-For y estrene cubo en cada request -- sería PEOR que
    el bug original (ver issue #235)."""
    valor = _forwarded_allow_ips_del_dockerfile()
    assert valor not in ("*", "'*'")
    for red in valor.split(","):
        assert ipaddress.ip_network(red.strip()).is_private


# --- App mínima que replica el cableado real de main.py --------------------

def _armar_app(limite: str) -> tuple[FastAPI, Limiter]:
    # Sin `headers_enabled=True` a propósito -- mismo motivo que
    # `rate_limit._crear_limiter()`: ver su comentario y
    # `_manejador_limite_excedido` en main.py.
    limiter = Limiter(key_func=clave_cliente)
    app = FastAPI()
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _manejador_limite_excedido)

    @app.get("/probe")
    @limiter.limit(limite)
    async def probe(request: Request):
        return {"clave": clave_cliente(request)}

    return app, limiter


def _cliente(limite: str, peer: str) -> TestClient:
    app, _ = _armar_app(limite)
    confiables = _forwarded_allow_ips_del_dockerfile()
    envuelta = ProxyHeadersMiddleware(app, trusted_hosts=confiables)
    return TestClient(envuelta, client=(peer, 12345))


# --- (a) Dos visitantes con XFF distinto tienen cubos separados ------------

def test_dos_visitantes_con_xff_distinto_tienen_cubos_separados():
    peer = _peer_dentro_de_la_red_confiable()
    cliente = _cliente("2/minute", peer)

    # Visitante A agota su cubo de 2.
    assert cliente.get("/probe", headers={"x-forwarded-for": "198.51.100.10"}).status_code == 200
    assert cliente.get("/probe", headers={"x-forwarded-for": "198.51.100.10"}).status_code == 200
    respuesta_a = cliente.get("/probe", headers={"x-forwarded-for": "198.51.100.10"})
    assert respuesta_a.status_code == 429

    # Visitante B, mismo peer TCP (mismo Caddy/frontend), XFF distinto: su
    # cubo sigue intacto -- si el arreglo no funcionara, compartirían clave y
    # esto también daría 429 (exactamente la ronda 5/6 del issue #235).
    respuesta_b = cliente.get("/probe", headers={"x-forwarded-for": "198.51.100.20"})
    assert respuesta_b.status_code == 200
    assert respuesta_b.json()["clave"] != "ip:198.51.100.10"


def test_claves_resueltas_reflejan_cada_xff():
    peer = _peer_dentro_de_la_red_confiable()
    cliente = _cliente("10/minute", peer)
    clave_a = cliente.get("/probe", headers={"x-forwarded-for": "198.51.100.30"}).json()["clave"]
    clave_b = cliente.get("/probe", headers={"x-forwarded-for": "198.51.100.40"}).json()["clave"]
    assert clave_a == "ip:198.51.100.30"
    assert clave_b == "ip:198.51.100.40"


# --- (b) Un peer fuera de la red confiable no puede falsificar su XFF ------

def test_peer_no_confiable_no_puede_falsificar_xff():
    cliente = _cliente("10/minute", PEER_NO_CONFIABLE)

    clave_1 = cliente.get("/probe", headers={"x-forwarded-for": "1.1.1.1"}).json()["clave"]
    clave_2 = cliente.get("/probe", headers={"x-forwarded-for": "2.2.2.2"}).json()["clave"]

    # El XFF se ignora por completo: ambas "identidades" forjadas resuelven
    # al mismo peer TCP real, así que NO pueden separar cubos.
    assert clave_1 == clave_2 == f"ip:{PEER_NO_CONFIABLE}"


def test_peer_no_confiable_comparte_un_solo_cubo_pese_a_xff_distinto():
    cliente = _cliente("1/minute", PEER_NO_CONFIABLE)
    assert cliente.get("/probe", headers={"x-forwarded-for": "1.1.1.1"}).status_code == 200
    # Mismo peer, XFF distinto: si pudiera forjarlo tendría un cubo nuevo.
    respuesta = cliente.get("/probe", headers={"x-forwarded-for": "9.9.9.9"})
    assert respuesta.status_code == 429


# --- (c) El 429 trae Retry-After y respeta el contrato {detail, message} ---

def test_429_incluye_retry_after_y_respeta_contrato_detail_message():
    peer = _peer_dentro_de_la_red_confiable()
    cliente = _cliente("1/minute", peer)
    cliente.get("/probe", headers={"x-forwarded-for": "203.0.113.50"})
    respuesta = cliente.get("/probe", headers={"x-forwarded-for": "203.0.113.50"})

    assert respuesta.status_code == 429
    assert "retry-after" in respuesta.headers
    assert int(respuesta.headers["retry-after"]) > 0

    cuerpo = respuesta.json()
    assert cuerpo["detail"] == cuerpo["message"]
    assert isinstance(cuerpo["detail"], str) and cuerpo["detail"]
    assert "error" not in cuerpo
