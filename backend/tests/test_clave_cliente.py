"""
Cobertura de comportamiento de `clave_cliente` (Slice 0,
sdd/api-abuse-protection).

Es la única pieza de este cambio directamente testeable a nivel unitario:
`clave_cliente` es una función común que recibe un `Request`, sin pasar por
`_NoOpLimiter` (que en `AMBIENTE=test` descarta cualquier decorador y no deja
nada inspeccionable en runtime -- ver `test_limite_tasa_pagos.py`).

Se construye el `Request` a mano desde un scope ASGI, sin servidor real: es
lo mínimo que necesita `clave_cliente` (headers + client), y evita acoplar
esta prueba a la base de datos o al ciclo de vida completo de la app.

El eje de esta suite es D1/D2 del diseño: `clave_cliente` verifica la firma
del JWT (nunca confía en un claim sin verificar) y NUNCA lanza -- token
ausente, mal formado, expirado o de un `type` distinto a `access` deben
resolver de forma determinística a la clave por IP, no a un 500.
"""
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from starlette.requests import Request

from app.soporte_transversal import rate_limit
from app.soporte_transversal.configuracion import settings
from app.soporte_transversal.rate_limit import PREFIJO_IP, PREFIJO_USUARIO, clave_cliente


def _request(headers: dict[str, str] | None = None, client: tuple[str, int] | None = ("203.0.113.7", 12345)) -> Request:
    """Construye un `starlette.requests.Request` desde un scope ASGI mínimo,
    sin levantar ningún servidor -- `clave_cliente` solo lee `headers` y
    `client`, así que es todo lo que este scope necesita declarar."""
    headers_asgi = [(nombre.lower().encode(), valor.encode()) for nombre, valor in (headers or {}).items()]
    scope = {"type": "http", "headers": headers_asgi, "client": client}
    return Request(scope)


def _token_valido(sub: str = "ana@cataclub.test", **overrides) -> str:
    payload = {
        "sub": sub,
        "type": "access",
        "sver": 1,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=30),
    }
    payload.update(overrides)
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algoritmo)


def _bearer(token: str) -> dict[str, str]:
    return {"authorization": f"Bearer {token}"}


def test_token_de_acceso_valido_devuelve_clave_por_usuario():
    token = _token_valido(sub="ana@cataclub.test")
    assert clave_cliente(_request(_bearer(token))) == f"{PREFIJO_USUARIO}ana@cataclub.test"


def test_dos_usuarios_distintos_producen_claves_distintas():
    clave_ana = clave_cliente(_request(_bearer(_token_valido(sub="ana@cataclub.test"))))
    clave_beto = clave_cliente(_request(_bearer(_token_valido(sub="beto@cataclub.test"))))
    assert clave_ana != clave_beto
    assert clave_ana == f"{PREFIJO_USUARIO}ana@cataclub.test"
    assert clave_beto == f"{PREFIJO_USUARIO}beto@cataclub.test"


def test_token_con_firma_falsificada_cae_a_ip():
    """Firmado con una clave distinta a la del servidor -- simula un token
    forjado. NUNCA debe devolver una clave `usuario:`, aunque el payload
    decodificado sin verificar tuviera un `sub` con forma válida."""
    token = jwt.encode(
        {"sub": "atacante@cataclub.test", "type": "access", "exp": datetime.now(timezone.utc) + timedelta(minutes=30)},
        "clave-que-el-servidor-no-conoce",
        algorithm=settings.jwt_algoritmo,
    )
    clave = clave_cliente(_request(_bearer(token)))
    assert not clave.startswith(PREFIJO_USUARIO)
    assert clave.startswith(PREFIJO_IP)


def test_token_alg_none_cae_a_ip():
    """`alg=none` es el ataque clásico de "sin verificar firma": pinnear
    `algorithms=[...]` en el decode debe rechazarlo."""
    token = jwt.encode(
        {"sub": "atacante@cataclub.test", "type": "access"},
        key=None,
        algorithm="none",
    )
    clave = clave_cliente(_request(_bearer(token)))
    assert clave.startswith(PREFIJO_IP)


def test_token_expirado_cae_a_ip():
    token = _token_valido(exp=datetime.now(timezone.utc) - timedelta(minutes=1))
    clave = clave_cliente(_request(_bearer(token)))
    assert clave.startswith(PREFIJO_IP)


@pytest.mark.parametrize("tipo", ["refresh", "reset_password", ""])
def test_token_con_type_distinto_de_access_cae_a_ip(tipo):
    token = _token_valido(type=tipo)
    clave = clave_cliente(_request(_bearer(token)))
    assert clave.startswith(PREFIJO_IP)


def test_sin_header_de_autorizacion_cae_a_ip():
    clave = clave_cliente(_request())
    assert clave == f"{PREFIJO_IP}203.0.113.7"


def test_header_bearer_con_token_vacio_cae_a_ip():
    clave = clave_cliente(_request({"authorization": "Bearer "}))
    assert clave.startswith(PREFIJO_IP)


def test_header_con_esquema_no_bearer_cae_a_ip():
    token = _token_valido()
    clave = clave_cliente(_request({"authorization": f"Basic {token}"}))
    assert clave.startswith(PREFIJO_IP)


def test_header_malformado_sin_espacio_cae_a_ip():
    clave = clave_cliente(_request({"authorization": "Bearer"}))
    assert clave.startswith(PREFIJO_IP)


def test_sub_no_string_cae_a_ip():
    token = _token_valido(sub=12345)
    clave = clave_cliente(_request(_bearer(token)))
    assert clave.startswith(PREFIJO_IP)


def test_sin_cliente_remoto_no_lanza_y_cae_a_ip_loopback():
    """`request.client is None` (posible detrás de ciertos transports ASGI):
    `get_remote_address` ya lo maneja devolviendo "127.0.0.1"; esta prueba
    fija que `clave_cliente` no agrega ninguna excepción propia encima."""
    clave = clave_cliente(_request(client=None))
    assert clave == f"{PREFIJO_IP}127.0.0.1"


# --- Wiring: el `Limiter` real usa `clave_cliente` como `key_func` ----------
#
# `_NoOpLimiter` (activo en AMBIENTE=test) oculta este cableado por completo
# -- su `.limit(...)` descarta el decorador y no queda ningún `Limiter` real
# para inspeccionar. `_crear_limiter()` se llama acá directo, con
# `settings.ambiente` parchado a un valor distinto de "test", para poder
# ejercitar la rama que sí construye un `Limiter` de slowapi.
#
# slowapi 0.1.10 no publica ningún getter público para el `key_func` de un
# `Limiter` ya construido: `dir(Limiter)`/`dir(instancia)` confirma que el
# único lugar donde queda ese valor es el atributo con guion bajo
# `_key_func` -- privado y no documentado. En vez de depender en silencio de
# ese detalle interno de slowapi, esta prueba abre su PROPIO seam: espía la
# llamada al `Limiter` tal como la hace `rate_limit.py` y captura el
# `key_func` con el que NUESTRO código invoca el constructor. Ese punto sí es
# API pública y estable de slowapi (`key_func` es un parámetro obligatorio y
# documentado de `Limiter.__init__`), así que el seam no depende de nada
# privado en ningún lado.
def test_crear_limiter_usa_clave_cliente_fuera_de_ambiente_test(monkeypatch):
    capturado = {}

    class _LimiterEspia:
        def __init__(self, *, key_func, **_kwargs):
            capturado["key_func"] = key_func

    monkeypatch.setattr(rate_limit, "Limiter", _LimiterEspia)
    monkeypatch.setattr(rate_limit.settings, "ambiente", "production")

    resultado = rate_limit._crear_limiter()

    assert capturado["key_func"] is clave_cliente
    assert isinstance(resultado, _LimiterEspia)


def test_crear_limiter_usa_noop_en_ambiente_test(monkeypatch):
    """Regresión del comportamiento previo: en AMBIENTE=test sigue sin
    tocar slowapi en absoluto."""
    monkeypatch.setattr(rate_limit.settings, "ambiente", "test")
    assert isinstance(rate_limit._crear_limiter(), rate_limit._NoOpLimiter)
