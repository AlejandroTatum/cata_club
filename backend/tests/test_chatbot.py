"""
Tests del endpoint público del chatbot de FAQ (POST /api/v1/chatbot/consultar).

Mockea el cliente `openai.OpenAI` (apuntado al gateway OpenCode Zen; no pega
contra la API real). Cubre:
  - Request válido -> 200 con campo `respuesta`.
  - `mensaje` vacío -> 422 (validación de Pydantic).
  - Presupuesto de tiempo del cliente openai (timeout + reintentos) por debajo
    del abort del BFF.
  - Mapeo de cada falla del proveedor a su propio status (429/504/503/502).
"""
from types import SimpleNamespace

import httpx
import openai
import pytest

import app.presentacion.routers.chatbot_router as chatbot_router_mod
import app.servicios_negocio.chatbot_servicio as chatbot_servicio_mod


class _FakeCompletions:
    def __init__(self, texto: str):
        self._texto = texto

    def create(self, **kwargs):
        mensaje = SimpleNamespace(content=self._texto)
        choice = SimpleNamespace(message=mensaje)
        return SimpleNamespace(choices=[choice])


class _FakeChat:
    def __init__(self, texto: str):
        self.completions = _FakeCompletions(texto)


class _FakeOpenAIClient:
    def __init__(self, texto: str = "Podés ver tus pagos en Mi Cuenta.", **kwargs):
        self.chat = _FakeChat(texto)
        self.kwargs = kwargs


class _FakeCompletionsQueFalla:
    def __init__(self, excepcion: Exception):
        self._excepcion = excepcion

    def create(self, **kwargs):
        raise self._excepcion


class _FakeOpenAIClientQueFalla:
    def __init__(self, excepcion: Exception, **kwargs):
        self.chat = SimpleNamespace(completions=_FakeCompletionsQueFalla(excepcion))
        self.kwargs = kwargs


def _mockear_cliente_openai(monkeypatch, texto: str = "Podés ver tus pagos en Mi Cuenta."):
    """Devuelve una lista donde se acumulan los kwargs con los que se
    construyó el cliente, para poder inspeccionar timeout/max_retries."""
    construidos: list[dict] = []

    def _fabricar(**kwargs):
        construidos.append(kwargs)
        return _FakeOpenAIClient(texto, **kwargs)

    monkeypatch.setattr(chatbot_servicio_mod.openai, "OpenAI", _fabricar)
    return construidos


def _mockear_cliente_openai_que_falla(monkeypatch, excepcion: Exception):
    monkeypatch.setattr(
        chatbot_servicio_mod.openai,
        "OpenAI",
        lambda **kwargs: _FakeOpenAIClientQueFalla(excepcion, **kwargs),
    )


def _respuesta_httpx(status_code: int) -> httpx.Response:
    return httpx.Response(
        status_code=status_code,
        request=httpx.Request("POST", "https://opencode.ai/zen/v1/chat/completions"),
    )


def test_consultar_responde_200_con_respuesta(client, monkeypatch):
    _mockear_cliente_openai(monkeypatch)

    resp = client.post("/api/v1/chatbot/consultar", json={"mensaje": "¿Cómo veo mis pagos?"})

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert "respuesta" in data
    assert data["respuesta"] == "Podés ver tus pagos en Mi Cuenta."


def test_consultar_con_historial_responde_200(client, monkeypatch):
    _mockear_cliente_openai(monkeypatch, texto="Sí, claro.")

    resp = client.post(
        "/api/v1/chatbot/consultar",
        json={
            "mensaje": "¿Y las clases extra?",
            "historial": [
                {"rol": "usuario", "texto": "Hola"},
                {"rol": "asistente", "texto": "Hola, ¿en qué te ayudo?"},
            ],
        },
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["respuesta"] == "Sí, claro."


def test_consultar_mensaje_vacio_da_422(client, monkeypatch):
    _mockear_cliente_openai(monkeypatch)

    resp = client.post("/api/v1/chatbot/consultar", json={"mensaje": ""})

    assert resp.status_code == 422


# --- Presupuesto de tiempo -------------------------------------------------
# El BFF (frontend/src/app/api/chatbot/route.ts) aborta a los 30s. Si el
# backend puede tardar más, sigue gastando tokens contra un cliente que ya se
# fue. El SDK de openai por defecto usa 600s y 2 reintentos, así que hay que
# fijarlos explícitamente.


def test_cliente_openai_fija_timeout_y_reintentos(client, monkeypatch):
    construidos = _mockear_cliente_openai(monkeypatch)

    client.post("/api/v1/chatbot/consultar", json={"mensaje": "Hola"})

    assert construidos, "no se construyó el cliente openai"
    kwargs = construidos[-1]
    assert "timeout" in kwargs, "el cliente openai debe fijar timeout explícito"
    assert "max_retries" in kwargs, "el cliente openai debe fijar max_retries explícito"


def test_presupuesto_de_tiempo_queda_bajo_el_abort_del_bff():
    presupuesto = chatbot_servicio_mod.TIMEOUT_LLM_SEGUNDOS * (
        1 + chatbot_servicio_mod.MAX_REINTENTOS_LLM
    )
    assert presupuesto < chatbot_servicio_mod.TIMEOUT_BFF_SEGUNDOS


# --- Mapeo de fallas del proveedor ------------------------------------------
# RateLimitError, APITimeoutError y APIConnectionError son todas subclases de
# APIError: colapsarlas en un solo 502 borraba la distinción que el usuario
# necesita ver ("espera un momento" vs "tardó demasiado" vs "está caído").


@pytest.mark.parametrize(
    ("excepcion", "status_esperado"),
    [
        (
            openai.RateLimitError(
                "rate limited", response=_respuesta_httpx(429), body=None
            ),
            429,
        ),
        (
            openai.APITimeoutError(
                request=httpx.Request("POST", "https://opencode.ai/zen/v1/chat/completions")
            ),
            504,
        ),
        (
            openai.APIConnectionError(
                request=httpx.Request("POST", "https://opencode.ai/zen/v1/chat/completions")
            ),
            503,
        ),
        (
            openai.APIError(
                "boom",
                request=httpx.Request("POST", "https://opencode.ai/zen/v1/chat/completions"),
                body=None,
            ),
            502,
        ),
    ],
    ids=["rate_limit", "timeout", "conexion", "generico"],
)
def test_falla_del_proveedor_mapea_a_su_propio_status(
    client, monkeypatch, excepcion, status_esperado
):
    _mockear_cliente_openai_que_falla(monkeypatch, excepcion)

    resp = client.post("/api/v1/chatbot/consultar", json={"mensaje": "Hola"})

    assert resp.status_code == status_esperado, resp.text
    assert resp.json()["detail"]


def test_cada_falla_tiene_su_propio_mensaje(client, monkeypatch):
    mensajes = set()
    fallas = [
        openai.RateLimitError("rate limited", response=_respuesta_httpx(429), body=None),
        openai.APITimeoutError(
            request=httpx.Request("POST", "https://opencode.ai/zen/v1/chat/completions")
        ),
        openai.APIConnectionError(
            request=httpx.Request("POST", "https://opencode.ai/zen/v1/chat/completions")
        ),
        openai.APIError(
            "boom",
            request=httpx.Request("POST", "https://opencode.ai/zen/v1/chat/completions"),
            body=None,
        ),
    ]
    for falla in fallas:
        _mockear_cliente_openai_que_falla(monkeypatch, falla)
        resp = client.post("/api/v1/chatbot/consultar", json={"mensaje": "Hola"})
        mensajes.add(resp.json()["detail"])

    assert len(mensajes) == len(fallas), f"mensajes repetidos: {mensajes}"


# --- Rate limit del endpoint ------------------------------------------------


def test_limite_del_endpoint_es_de_rafaga_y_no_por_minuto():
    limite = chatbot_router_mod.LIMITE_CONSULTAS
    # Una ventana de 1 minuto es inalcanzable a ~4s por llamada: la ventana
    # rota antes de que un cliente secuencial pueda agotarla.
    assert "minute" not in limite
    assert "second" in limite


def test_limite_del_endpoint_es_parseable_por_slowapi():
    # En ambiente de test el limiter es un NoOp (ver rate_limit.py), así que un
    # error de sintaxis en la cadena solo explotaría en producción. Se valida
    # acá contra el parser real de `limits`, que es el que usa slowapi.
    from limits import parse_many

    limites = parse_many(chatbot_router_mod.LIMITE_CONSULTAS)

    assert len(limites) == 2
