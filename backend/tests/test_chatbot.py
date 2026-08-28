"""
Tests del endpoint público del chatbot de FAQ (POST /api/v1/chatbot/consultar).

Mockea el cliente `openai.OpenAI` (apuntado al gateway OpenCode Zen; no pega
contra la API real). Cubre:
  - Request válido -> 200 con campo `respuesta`.
  - `mensaje` vacío -> 422 (validación de Pydantic).
  - Presupuesto de tiempo del cliente openai (timeout + reintentos) por debajo
    del abort del BFF.
  - Degradación de CUALQUIER falla del proveedor al respaldo local, siempre con
    HTTP 200 (el status del proveedor NO se traslada al cliente: ver
    `_respuesta_local` en chatbot_servicio.py).
  - Observabilidad de esa degradación: toda falla deja un log con el tipo de
    excepción y el status, y ningún log arrastra la credencial (issue #766).
  - Modelo y gateway tomados de configuración, y la lista de modelos de
    respaldo (issue #766).
"""
import logging
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


def _configurar_modelos(monkeypatch, *, principal: str, respaldo: str = "") -> None:
    """Fija la cadena de modelos que va a intentar el servicio. Los tests que
    dependen del orden NO pueden heredar el default del repositorio: cambiarlo
    los volvería rojos sin que hubiera una regresión."""
    monkeypatch.setattr(chatbot_servicio_mod.settings, "chatbot_modelo", principal)
    monkeypatch.setattr(
        chatbot_servicio_mod.settings, "chatbot_modelos_respaldo_raw", respaldo
    )


def test_consultar_responde_200_con_respuesta(client, monkeypatch):
    _mockear_cliente_openai(monkeypatch)

    resp = client.post("/api/v1/chatbot/consultar", json={"mensaje": "¿Cómo veo mis pagos?"})

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert "respuesta" in data
    assert data["respuesta"] == "Podés ver tus pagos en Mi Cuenta."


def test_el_modelo_y_el_gateway_salen_de_la_configuracion(client, monkeypatch):
    """Reemplaza al viejo `test_consultar_envia_modelo_y_gateway_vigentes`
    (issue #766), que afirmaba `model == "mimo-v2.5-free"` contra un mock que
    capturaba kwargs: una tautología que pasaba con cualquier string, incluido
    un id retirado. Lo verificable no es el VALOR de la constante sino que el
    valor VIAJE desde la configuración hasta el cliente -- con valores que
    ningún default puede producir por casualidad, este test se pone rojo si
    alguien vuelve a hardcodear el modelo o el gateway."""
    _configurar_modelos(monkeypatch, principal="modelo-de-prueba-8f2c", respaldo="")
    monkeypatch.setattr(
        chatbot_servicio_mod.settings,
        "opencode_base_url",
        "https://gateway-de-prueba.invalid/v1",
    )
    capturado = {}

    class _Completions:
        def create(self, **kwargs):
            capturado["request"] = kwargs
            return SimpleNamespace(
                choices=[SimpleNamespace(message=SimpleNamespace(content="OK"))]
            )

    class _Cliente:
        def __init__(self, **kwargs):
            capturado["cliente"] = kwargs
            self.chat = SimpleNamespace(completions=_Completions())

    monkeypatch.setattr(chatbot_servicio_mod.openai, "OpenAI", _Cliente)

    resp = client.post("/api/v1/chatbot/consultar", json={"mensaje": "Hola"})

    assert resp.status_code == 200, resp.text
    assert capturado["cliente"]["base_url"] == "https://gateway-de-prueba.invalid/v1"
    assert capturado["request"]["model"] == "modelo-de-prueba-8f2c"


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
            200,
        ),
        (
            openai.APITimeoutError(
                request=httpx.Request("POST", "https://opencode.ai/zen/v1/chat/completions")
            ),
            200,
        ),
        (
            openai.APIConnectionError(
                request=httpx.Request("POST", "https://opencode.ai/zen/v1/chat/completions")
            ),
            200,
        ),
        (
            openai.APIError(
                "boom",
                request=httpx.Request("POST", "https://opencode.ai/zen/v1/chat/completions"),
                body=None,
            ),
            200,
        ),
    ],
    ids=["rate_limit", "timeout", "conexion", "generico"],
)
def test_falla_del_proveedor_degrada_a_respuesta_local(client, monkeypatch, excepcion, status_esperado):
    _mockear_cliente_openai_que_falla(monkeypatch, excepcion)
    resp = client.post("/api/v1/chatbot/consultar", json={"mensaje": "¿Cómo veo mis pagos?"})
    assert resp.status_code == 200, resp.text
    assert "Mi Cuenta" in resp.json()["respuesta"]
    assert "no está disponible" in resp.json()["respuesta"]


def test_pregunta_desconocida_en_fallback_es_honesta(client, monkeypatch):
    _mockear_cliente_openai_que_falla(monkeypatch, openai.APIConnectionError(request=httpx.Request("POST", "https://opencode.ai/zen/v1/chat/completions")))
    resp = client.post("/api/v1/chatbot/consultar", json={"mensaje": "¿Cuál es el clima?"})
    assert resp.status_code == 200, resp.text
    assert "No cuento con esa información" in resp.json()["respuesta"]
    assert "administrador del club" in resp.json()["respuesta"]


def test_mensaje_en_el_limite_maximo_responde(client, monkeypatch):
    _mockear_cliente_openai(monkeypatch)
    resp = client.post("/api/v1/chatbot/consultar", json={"mensaje": "x" * 2000})
    assert resp.status_code == 200, resp.text


def test_mensaje_sobre_el_limite_da_422(client, monkeypatch):
    _mockear_cliente_openai(monkeypatch)
    resp = client.post("/api/v1/chatbot/consultar", json={"mensaje": "x" * 2001})
    assert resp.status_code == 422, resp.text


def test_falla_del_proveedor_conocida_entrega_fallback(client, monkeypatch):
    _mockear_cliente_openai_que_falla(monkeypatch, openai.APITimeoutError(request=httpx.Request("POST", "https://opencode.ai/zen/v1/chat/completions")))

    resp = client.post("/api/v1/chatbot/consultar", json={"mensaje": "¿Cómo veo mis pagos?"})

    assert resp.status_code == 200, resp.text
    assert "Mi Cuenta" in resp.json()["respuesta"]


def test_cada_falla_entrega_una_respuesta_local(client, monkeypatch):
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
        assert resp.status_code == 200, resp.text
        mensajes.add(resp.json()["respuesta"])

    assert mensajes


# --- Credencial ausente (issue #337) ----------------------------------------
# `openai.OpenAI(api_key="")` levanta `OpenAIError` en el CONSTRUCTOR -- antes
# de que exista el try/except de `consultar()` que maneja las otras cuatro
# fallas del proveedor. Este test NO mockea `openai.OpenAI`: usa el SDK real
# para reproducir el fallo tal como ocurre en un despliegue sin
# OPENCODE_API_KEY, que es exactamente el estado de un despliegue nuevo.


def test_credencial_ausente_no_escapa_al_manejo_de_fallas(client, monkeypatch):
    monkeypatch.setattr(chatbot_servicio_mod.settings, "opencode_api_key", "")

    resp = client.post("/api/v1/chatbot/consultar", json={"mensaje": "Hola"})

    assert resp.status_code == 200, resp.text
    assert resp.json()["respuesta"]


# --- Credencial incompleta y no filtrado (issue #645) -----------------------
# Una credencial INCOMPLETA (comillas, espacios, el placeholder de los
# ejemplos) es distinta de una ausente: el SDK la acepta como cadena y el
# rechazo llega desde el gateway, en tiempo de request. El respaldo local
# tiene que cubrir ese caso igual, y la respuesta que ve el usuario nunca
# puede arrastrar el valor configurado.

CLAVE_FALSA_PARA_FUGAS = "clave-inventada-solo-para-tests-qwx9v8u7t6"


def _fragmentos(clave: str, largo: int = 8) -> list[str]:
    return [clave[i : i + largo] for i in range(len(clave) - largo + 1)]


@pytest.mark.parametrize(
    "clave",
    ["<api-key>", f'"{CLAVE_FALSA_PARA_FUGAS}"', f" {CLAVE_FALSA_PARA_FUGAS}"],
)
def test_credencial_incompleta_tambien_degrada_al_respaldo_local(client, monkeypatch, clave):
    monkeypatch.setattr(chatbot_servicio_mod.settings, "opencode_api_key", clave)
    _mockear_cliente_openai_que_falla(
        monkeypatch,
        openai.APIError(
            "invalid api key",
            request=httpx.Request("POST", "https://opencode.ai/zen/v1/chat/completions"),
            body=None,
        ),
    )

    resp = client.post("/api/v1/chatbot/consultar", json={"mensaje": "¿Cómo veo mis pagos?"})

    assert resp.status_code == 200, resp.text
    assert "Mi Cuenta" in resp.json()["respuesta"]


def test_la_respuesta_del_endpoint_nunca_arrastra_la_credencial_configurada(
    client, monkeypatch
):
    """El cuerpo de la respuesta es lo único que el chatbot expone a un
    cliente ANÓNIMO: el endpoint es público y sin auth."""
    monkeypatch.setattr(
        chatbot_servicio_mod.settings, "opencode_api_key", CLAVE_FALSA_PARA_FUGAS
    )
    _mockear_cliente_openai_que_falla(
        monkeypatch,
        openai.APIError(
            f"upstream rechazó la credencial {CLAVE_FALSA_PARA_FUGAS}",
            request=httpx.Request("POST", "https://opencode.ai/zen/v1/chat/completions"),
            body=None,
        ),
    )

    resp = client.post("/api/v1/chatbot/consultar", json={"mensaje": "Hola"})

    assert resp.status_code == 200, resp.text
    for fragmento in _fragmentos(CLAVE_FALSA_PARA_FUGAS):
        assert fragmento not in resp.text, (
            "la respuesta pública del chatbot arrastró un fragmento de la "
            "credencial; el texto del error del proveedor no puede llegar al "
            "cliente"
        )


# --- Observabilidad de la falla del proveedor (issue #766) ------------------
# El chatbot devolvía HTTP 200 con el respaldo local ante CUALQUIER falla del
# proveedor y no emitía un solo log. Un id de modelo retirado, una cuota
# agotada, una clave revocada y una clave con los `<>` del placeholder pegados
# producían exactamente la misma salida observable, así que la única vía de
# diagnóstico era entrar por SSH y hacer un probe a mano. Costó una hora
# encontrar un error de dos caracteres en el `.env`.
#
# Estos tests NO cambian lo que ve el usuario (sigue siendo 200 + respaldo):
# exigen que el operador pueda distinguir las causas leyendo los logs.

LOGGER_CHATBOT = "cataclub.chatbot"


@pytest.fixture()
def logs_del_chatbot(caplog, monkeypatch):
    """`caplog` ya capturando todo lo que emita `cataclub.chatbot`.

    El `monkeypatch` de `disabled` no es cosmético y no relaja nada: la suite
    corre las migraciones de Alembic al arrancar, y el `fileConfig` de Alembic
    usa `disable_existing_loggers=True` por default, así que todo logger
    `cataclub.*` ya creado llega APAGADO a los tests. En el proceso real eso no
    pasa (`configuracion_logging.configurar_logging` fija
    `disable_existing_loggers: False`). Es el mismo workaround que usa
    `test_cloudinary_cliente.py` para su propio logger."""
    monkeypatch.setattr(chatbot_servicio_mod.logger, "disabled", False)
    with caplog.at_level(logging.DEBUG):
        yield caplog


def _registros_del_chatbot(caplog) -> list[logging.LogRecord]:
    return [r for r in caplog.records if r.name == LOGGER_CHATBOT]


@pytest.mark.parametrize(
    ("excepcion", "tipo_esperado", "status_esperado"),
    [
        (
            openai.RateLimitError("rate limited", response=_respuesta_httpx(429), body=None),
            "RateLimitError",
            "429",
        ),
        (
            openai.AuthenticationError(
                "Invalid API key.", response=_respuesta_httpx(401), body=None
            ),
            "AuthenticationError",
            "401",
        ),
        (
            openai.NotFoundError(
                "model_not_found", response=_respuesta_httpx(404), body=None
            ),
            "NotFoundError",
            "404",
        ),
        (
            openai.InternalServerError(
                "upstream boom", response=_respuesta_httpx(502), body=None
            ),
            "InternalServerError",
            "502",
        ),
    ],
    ids=["rate_limit", "credencial_rechazada", "modelo_retirado", "gateway_caido"],
)
def test_toda_falla_del_proveedor_deja_un_log_con_el_tipo_y_el_status(
    client, monkeypatch, logs_del_chatbot, excepcion, tipo_esperado, status_esperado
):
    """El criterio 1 del issue #766: sin esto, lo demás no sirve. El nombre de
    la excepción y el status son lo que separa "clave rechazada" de "modelo
    retirado" de "gateway caído" en `docker compose logs backend`."""
    _configurar_modelos(monkeypatch, principal="modelo-unico-de-prueba", respaldo="")
    _mockear_cliente_openai_que_falla(monkeypatch, excepcion)

    resp = client.post(
        "/api/v1/chatbot/consultar", json={"mensaje": "¿Cómo veo mis pagos?"}
    )

    assert resp.status_code == 200, resp.text
    registros = _registros_del_chatbot(logs_del_chatbot)
    assert registros, (
        f"una {tipo_esperado} del proveedor no dejó ningún registro en el "
        f"logger '{LOGGER_CHATBOT}'; el operador no tiene nada que grepear"
    )
    texto = " ".join(r.getMessage() for r in registros)
    assert tipo_esperado in texto, f"el log no nombra el tipo de excepción: {texto!r}"
    assert status_esperado in texto, f"el log no incluye el status HTTP: {texto!r}"


def test_una_falla_sin_status_http_igual_deja_un_log_que_lo_dice(
    client, monkeypatch, logs_del_chatbot
):
    """`APIConnectionError` y `APITimeoutError` no llegan a tener respuesta, así
    que no hay status. El log tiene que salir igual: "no hubo status" es en sí
    mismo el dato que separa "el gateway respondió mal" de "no se llegó al
    gateway"."""
    _configurar_modelos(monkeypatch, principal="modelo-unico-de-prueba", respaldo="")
    _mockear_cliente_openai_que_falla(
        monkeypatch,
        openai.APIConnectionError(
            request=httpx.Request("POST", "https://opencode.ai/zen/v1/chat/completions")
        ),
    )

    resp = client.post("/api/v1/chatbot/consultar", json={"mensaje": "Hola"})

    assert resp.status_code == 200, resp.text
    registros = _registros_del_chatbot(logs_del_chatbot)
    assert registros, "una falla de conexión no dejó ningún registro"
    assert "APIConnectionError" in " ".join(r.getMessage() for r in registros)


def test_la_credencial_ausente_tambien_deja_un_log(
    client, monkeypatch, logs_del_chatbot
):
    """`openai.OpenAI(api_key="")` levanta `OpenAIError` en el CONSTRUCTOR. Es
    el fallo más probable de un despliegue nuevo y era el más invisible: ni
    siquiera llegaba a haber una request."""
    monkeypatch.setattr(chatbot_servicio_mod.settings, "opencode_api_key", "")

    resp = client.post("/api/v1/chatbot/consultar", json={"mensaje": "Hola"})

    assert resp.status_code == 200, resp.text
    assert _registros_del_chatbot(logs_del_chatbot), (
        "un despliegue sin OPENCODE_API_KEY no deja ningún registro"
    )


@pytest.mark.parametrize(
    "envoltura",
    ["{clave}", "<{clave}>", '"{clave}"'],
    ids=["clave_pelada", "placeholder_con_corchetes", "entre_comillas"],
)
def test_ningun_log_del_chatbot_arrastra_la_credencial(
    client, monkeypatch, logs_del_chatbot, envoltura
):
    """El test que más importa del issue #766. El proveedor puede devolver la
    credencial dentro del mensaje de error, y el objeto `request` del SDK lleva
    el header `Authorization` completo: un `logger.exception` descuidado, o un
    `%s` sobre el error crudo, escribe la clave en un archivo de log que se
    rota, se copia y se comparte.

    Se afirma sobre `caplog.text`, que incluye el traceback formateado
    (`exc_info`), no solo el mensaje -- justamente para que un
    `logger.exception` que vuelque la request no pase inadvertido. Y se busca
    CUALQUIER ventana de 8 caracteres de la clave, no la clave entera: un
    prefijo del secreto ya es el secreto."""
    clave = envoltura.format(clave=CLAVE_FALSA_PARA_FUGAS)
    monkeypatch.setattr(chatbot_servicio_mod.settings, "opencode_api_key", clave)
    _configurar_modelos(monkeypatch, principal="modelo-unico-de-prueba", respaldo="")
    request_con_authorization = httpx.Request(
        "POST",
        "https://opencode.ai/zen/v1/chat/completions",
        headers={"Authorization": f"Bearer {clave}"},
    )
    _mockear_cliente_openai_que_falla(
        monkeypatch,
        openai.AuthenticationError(
            f"Invalid API key: {clave}",
            response=httpx.Response(status_code=401, request=request_con_authorization),
            body=None,
        ),
    )

    resp = client.post("/api/v1/chatbot/consultar", json={"mensaje": "Hola"})

    assert resp.status_code == 200, resp.text
    assert _registros_del_chatbot(logs_del_chatbot), (
        "sin ningún registro este test pasaría en vacío; la falla tiene que "
        "haber quedado logueada para que buscar la credencial signifique algo"
    )
    for fragmento in _fragmentos(CLAVE_FALSA_PARA_FUGAS):
        assert fragmento not in logs_del_chatbot.text, (
            f"un log del chatbot arrastró el fragmento {fragmento!r} de la "
            "credencial configurada; ningún log puede contener el secreto ni "
            "una parte suya"
        )


# --- Cadena de modelos de respaldo (issue #766) -----------------------------
# Un modelo gratuito se retira sin aviso: el commit 22a0189 cambió
# `deepseek-v4-flash-free` por `mimo-v2.5-free` justamente por eso. Con un
# único id hardcodeado, una retirada tumba el chatbot hasta que alguien
# despliegue código. Con una cadena, el siguiente id atiende la consulta.
#
# El criterio de reintento es angosto A PROPÓSITO: solo se pasa al siguiente
# modelo cuando la falla es ATRIBUIBLE AL ID (404 `model_not_found`). Una clave
# inválida, una cuota agotada o un gateway caído fallan IGUAL con todos los
# modelos: reintentar solo gasta el presupuesto de 30s del BFF y le hace
# esperar de más al usuario para llegar al mismo respaldo local.


def _cliente_que_registra_intentos(monkeypatch, fallas: dict) -> list[str]:
    """Devuelve la lista (en orden) de los modelos que se le pidieron al
    gateway. `fallas` mapea id de modelo -> excepción a levantar."""
    intentos: list[str] = []

    class _Completions:
        def create(self, **kwargs):
            modelo = kwargs["model"]
            intentos.append(modelo)
            if modelo in fallas:
                raise fallas[modelo]
            return SimpleNamespace(
                choices=[SimpleNamespace(message=SimpleNamespace(content=f"OK {modelo}"))]
            )

    class _Cliente:
        def __init__(self, **kwargs):
            self.chat = SimpleNamespace(completions=_Completions())

    monkeypatch.setattr(chatbot_servicio_mod.openai, "OpenAI", _Cliente)
    return intentos


def _modelo_retirado() -> openai.NotFoundError:
    return openai.NotFoundError(
        "model_not_found", response=_respuesta_httpx(404), body=None
    )


def test_un_modelo_retirado_pasa_al_siguiente_de_la_lista(client, monkeypatch):
    _configurar_modelos(
        monkeypatch, principal="modelo-retirado", respaldo="modelo-vivo,modelo-de-sobra"
    )
    intentos = _cliente_que_registra_intentos(
        monkeypatch, {"modelo-retirado": _modelo_retirado()}
    )

    resp = client.post("/api/v1/chatbot/consultar", json={"mensaje": "Hola"})

    assert resp.status_code == 200, resp.text
    assert resp.json()["respuesta"] == "OK modelo-vivo"
    assert intentos == ["modelo-retirado", "modelo-vivo"], (
        "la cadena de modelos no se recorrió en orden, o no se detuvo en el "
        f"primero que respondió: {intentos}"
    )


def test_si_todos_los_modelos_estan_retirados_se_entrega_el_respaldo_local(
    client, monkeypatch
):
    _configurar_modelos(monkeypatch, principal="retirado-a", respaldo="retirado-b")
    intentos = _cliente_que_registra_intentos(
        monkeypatch,
        {"retirado-a": _modelo_retirado(), "retirado-b": _modelo_retirado()},
    )

    resp = client.post(
        "/api/v1/chatbot/consultar", json={"mensaje": "¿Cómo veo mis pagos?"}
    )

    assert resp.status_code == 200, resp.text
    assert "Mi Cuenta" in resp.json()["respuesta"]
    assert "no está disponible" in resp.json()["respuesta"]
    assert intentos == ["retirado-a", "retirado-b"]


@pytest.mark.parametrize(
    "excepcion",
    [
        openai.AuthenticationError(
            "Invalid API key.", response=_respuesta_httpx(401), body=None
        ),
        openai.PermissionDeniedError(
            "forbidden", response=_respuesta_httpx(403), body=None
        ),
        openai.RateLimitError("rate limited", response=_respuesta_httpx(429), body=None),
        openai.InternalServerError(
            "upstream boom", response=_respuesta_httpx(502), body=None
        ),
        openai.APITimeoutError(
            request=httpx.Request("POST", "https://opencode.ai/zen/v1/chat/completions")
        ),
        openai.APIConnectionError(
            request=httpx.Request("POST", "https://opencode.ai/zen/v1/chat/completions")
        ),
    ],
    ids=["401", "403", "429", "502", "timeout", "conexion"],
)
def test_una_falla_ajena_al_modelo_no_gasta_la_cadena_de_respaldo(
    client, monkeypatch, excepcion
):
    """Una clave inválida falla idéntico con TODOS los modelos. Recorrer la
    cadena entera no la arregla: solo multiplica la latencia contra un
    presupuesto de 30s que el BFF ya está contando."""
    _configurar_modelos(monkeypatch, principal="primario", respaldo="respaldo-1,respaldo-2")
    intentos = _cliente_que_registra_intentos(monkeypatch, {"primario": excepcion})

    resp = client.post("/api/v1/chatbot/consultar", json={"mensaje": "Hola"})

    assert resp.status_code == 200, resp.text
    assert intentos == ["primario"], (
        f"se reintentó con otro modelo tras una {type(excepcion).__name__}, "
        f"que va a fallar igual en todos: {intentos}"
    )


def test_la_cadena_de_modelos_ignora_vacios_y_duplicados(monkeypatch):
    """El CSV lo escribe un operador a mano en el `.env`: una coma de más o el
    id principal repetido no puede costar una llamada extra al gateway."""
    _configurar_modelos(
        monkeypatch, principal=" primario ", respaldo=" respaldo , , primario ,respaldo"
    )

    assert chatbot_servicio_mod.modelos_a_intentar() == ["primario", "respaldo"]


def test_la_cadena_de_modelos_respeta_el_presupuesto_del_bff(client, monkeypatch):
    """Aun con fallas atribuibles al modelo, la cadena no puede seguir
    intentando después del presupuesto: el BFF aborta a los 30s y el usuario ya
    se fue."""
    _configurar_modelos(monkeypatch, principal="retirado-a", respaldo="retirado-b")
    intentos = _cliente_que_registra_intentos(
        monkeypatch,
        {"retirado-a": _modelo_retirado(), "retirado-b": _modelo_retirado()},
    )
    # Se reemplaza la REFERENCIA al módulo `time` dentro de chatbot_servicio, no
    # `time.monotonic` global: parchear el módulo real le cambia el reloj a
    # httpx, a SQLAlchemy y a pytest mismo, y la suite se cuelga.
    lecturas = iter([0.0, chatbot_servicio_mod.PRESUPUESTO_TOTAL_SEGUNDOS + 1.0])
    reloj_congelado = SimpleNamespace(monotonic=lambda: next(lecturas, 1e9))
    monkeypatch.setattr(chatbot_servicio_mod, "time", reloj_congelado)

    resp = client.post("/api/v1/chatbot/consultar", json={"mensaje": "Hola"})

    assert resp.status_code == 200, resp.text
    assert intentos == ["retirado-a"], (
        f"se intentó otro modelo con el presupuesto ya agotado: {intentos}"
    )


def test_el_presupuesto_total_no_supera_el_abort_del_bff():
    assert (
        chatbot_servicio_mod.PRESUPUESTO_TOTAL_SEGUNDOS
        < chatbot_servicio_mod.TIMEOUT_BFF_SEGUNDOS
    )


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
