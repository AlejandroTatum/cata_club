"""
Servicio del chatbot de FAQ (asistente de navegación de la app).

MVP intencionalmente simple: no hay RAG ni vector store. El conocimiento del
club se embebe entero en el system prompt, serializado desde
`conocimiento_club.json` (ver `conocimiento_club.py`), porque no hay volumen de
contenido que justifique algo más sofisticado: el corpus legítimo completo
—FAQ, horarios, ubicación, contacto— entra en unos 2.500 tokens, y montar
pgvector, una tabla de embeddings y una llamada de embedding por consulta
costaría más que mandarlo todo. No toca la base de datos.

Ese archivo es además la ÚNICA copia del conocimiento (issue #768): la página
`/ayuda` renderiza la misma definición para humanos, y un guardián de
divergencia compara el DOM que ve una familia contra los bytes exactos de este
prompt.

Proveedor: MiMo servido a través del gateway OpenAI-compatible
"OpenCode Zen" (https://opencode.ai/zen/v1). Se usa el paquete `openai`
apuntado a ese `base_url` — es el cliente idiomático para cualquier gateway
OpenAI-compatible (retries y excepciones tipadas gratis), en vez de
reimplementar la llamada HTTP a mano.

El chatbot usa el modelo gratuito vigente de OpenCode Zen; el ID se mantiene
sin prefijo porque es la convención de la API de la aplicación. El gateway y el
id del modelo NO viven acá: son configuración (`OPENCODE_BASE_URL`,
`CHATBOT_MODELO`, `CHATBOT_MODELOS_RESPALDO`), porque un modelo del tier
gratuito se retira sin aviso y cambiarlo no puede exigir un deploy de código
(issue #766).

Observabilidad: toda falla del proveedor deja un registro en el logger
`cataclub.chatbot` con el tipo de excepción y el status HTTP. Es la única
señal que tiene el operador, porque el usuario recibe siempre un 200 con la
respuesta de la FAQ local. Sin ese log, un id retirado, una cuota agotada, una
clave revocada y una clave con los `<>` del placeholder pegados producen
exactamente la misma salida observable.
"""
import logging
import re
import threading
import time
import unicodedata
from typing import List, Optional, Tuple

import openai

from app.servicios_negocio import conocimiento_club
from app.soporte_transversal.circuito_breaker import CircuitoBreaker
from app.soporte_transversal.configuracion import settings
from app.soporte_transversal.resiliencia import (
    CIRCUITO_CHATBOT_COOLDOWN_SEGUNDOS,
    CIRCUITO_CHATBOT_UMBRAL_FALLOS,
)

logger = logging.getLogger("cataclub.chatbot")

# El tier gratuito consume tokens en "razonamiento" interno de forma poco
# predecible -- se vio vaciar un presupuesto de 1024 sin dejar nada para la
# respuesta visible (finish_reason="length", reasoning_tokens=1024). 4096 le
# da margen de sobra sin impacto real de costo (tier gratuito).
MAX_TOKENS_RESPUESTA = 4096
MAX_TURNOS_HISTORIAL = 6

# --- Presupuesto de tiempo --------------------------------------------------
# El BFF (frontend/src/app/api/chatbot/route.ts, CHATBOT_TIMEOUT_MS) aborta la
# request a los 30s. El SDK de openai, si no se le fija nada, usa 600s de
# timeout y 2 reintentos: es decir, el backend podía seguir reintentando (y
# gastando tokens) durante minutos contra un cliente que ya colgó, y el usuario
# solo veía "no se pudo contactar" sin que nadie cortara nada.
#
# Presupuesto: TIMEOUT_LLM_SEGUNDOS * (1 + MAX_REINTENTOS_LLM) = 12 * 2 = 24s,
# que deja ~6s de margen bajo los 30s del BFF para la red y el resto del
# handler. La latencia real medida contra el tier gratuito es de ~3-6s, así que
# 12s por intento solo se agota cuando el gateway realmente está degradado.
# Si se toca CHATBOT_TIMEOUT_MS en el BFF, hay que rehacer esta cuenta.
TIMEOUT_BFF_SEGUNDOS = 30.0
TIMEOUT_LLM_SEGUNDOS = 12.0
MAX_REINTENTOS_LLM = 1
# Techo de pared para la CADENA COMPLETA de modelos, no para un intento. La
# cadena solo avanza ante un 404 `model_not_found`, que es una respuesta del
# gateway y llega en un round trip (`_base_client._should_retry` solo reintenta
# 408/409/429/5xx, o lo que pida el header `x-should-retry`, nunca un 404 a
# secas), así que en la práctica nunca se toca. Está igual porque el
# costo de equivocarse es asimétrico: sin techo, N modelos configurados podrían
# multiplicar la latencia contra un BFF que aborta a los 30s y dejar al usuario
# esperando por nada para llegar al mismo respaldo local.
PRESUPUESTO_TOTAL_SEGUNDOS = TIMEOUT_LLM_SEGUNDOS * (1 + MAX_REINTENTOS_LLM)

# --- Circuit breaker del gateway (issue #834) -------------------------------
# Una única instancia a nivel de módulo, igual que `_circuito_cloudinary` y
# `_circuito_smtp` (Decisión E de sdd/degradacion-controlada: estado en
# memoria por proceso, reloj monotónico y lock, sin Redis compartido).
#
# Qué compra acá: sin breaker, CADA consulta durante una caída del gateway
# paga el presupuesto completo de 24s para terminar entregando la misma FAQ
# local que ya estaba disponible en el primer milisegundo. Con el proveedor
# caído no hay nada que ganar preguntando de nuevo: la respuesta correcta ya
# se conoce y es gratis.
_circuito_chatbot = CircuitoBreaker(
    nombre="chatbot",
    umbral_fallos=CIRCUITO_CHATBOT_UMBRAL_FALLOS,
    cooldown_segundos=CIRCUITO_CHATBOT_COOLDOWN_SEGUNDOS,
)

# --- Cliente del SDK, memoizado por configuración (issue #834) --------------
# El cliente se construía DENTRO del bucle de modelos, así que cada intento de
# cada consulta estrenaba un `openai.OpenAI` -- y con él un pool de conexiones
# httpx nuevo, es decir un handshake TCP+TLS completo contra el gateway que se
# tiraba a la basura al terminar la request. Reusar la instancia reusa la
# conexión.
#
# La clave del caché es la CONFIGURACIÓN, no un flag de "ya construido": el
# contrato vigente es que cambiar el `.env` y recrear el contenedor alcanza
# (mismo razonamiento que el docstring de `modelos_a_intentar`), y un caché
# ciego lo rompería dejando servido un cliente con la credencial vieja. Si la
# clave cambia, el cliente anterior se descarta.
#
# El lock no es decorativo: desde el issue #834 el router corre `consultar` en
# el threadpool de FastAPI, así que dos consultas simultáneas evalúan esto en
# hilos distintos de verdad.
_cliente_lock = threading.Lock()
_cliente_memoizado: Optional[Tuple[Tuple[str, str], "openai.OpenAI"]] = None


def _cliente_openai() -> "openai.OpenAI":
    """Cliente del gateway para la configuración vigente.

    `timeout`/`max_retries` explícitos: sin ellos el SDK usa 600s y 2
    reintentos, y el backend sobrevive al abort del BFF gastando tokens contra
    un cliente que ya colgó (ver la cuenta del presupuesto de tiempo arriba).

    `api_key` explícito y no `os.environ`: `settings.opencode_api_key` viene de
    OPENCODE_API_KEY vía Settings/pydantic-settings, igual que el resto de la
    config de la app; `os.environ.get(...)` NO se popula solo desde el `.env`
    (a diferencia de `anthropic.Anthropic()`, que sí lee la env var sola).

    IMPORTANTE para quien mueva esta llamada: sin OPENCODE_API_KEY configurada
    el SDK levanta `OpenAIError: Missing credentials` en el CONSTRUCTOR, no en
    la request. Por eso `ChatbotServicio.consultar` la invoca DENTRO de su
    `try` (issue #337): construida fuera del bloque protegido, el fallo más
    probable de un despliegue nuevo vuelve a escaparse como un 500 sin manejar.
    """
    global _cliente_memoizado
    clave = (settings.opencode_base_url, settings.opencode_api_key)
    with _cliente_lock:
        if _cliente_memoizado is not None and _cliente_memoizado[0] == clave:
            return _cliente_memoizado[1]
        cliente = openai.OpenAI(
            base_url=settings.opencode_base_url,
            api_key=settings.opencode_api_key,
            timeout=TIMEOUT_LLM_SEGUNDOS,
            max_retries=MAX_REINTENTOS_LLM,
        )
        _cliente_memoizado = (clave, cliente)
        return cliente


def reiniciar_cliente() -> None:
    """Descarta el cliente memoizado. La usa el fixture de aislamiento de la
    suite (`tests/conftest.py`), gemelo del que reinicia los circuit breakers:
    sin esto, un test que monkeypatchea `openai.OpenAI` deja SU doble cacheado
    y el test siguiente lo hereda sin pedirlo."""
    global _cliente_memoizado
    with _cliente_lock:
        _cliente_memoizado = None


# Fallas del proveedor que degradan a la FAQ local. Se conserva el catch
# explícito: errores de autenticación de la app, de seguridad o de programación
# que estén fuera de OpenAIError no se convierten en éxito.
_FALLAS_DEL_PROVEEDOR = (
    openai.RateLimitError,
    openai.APITimeoutError,
    openai.APIConnectionError,
    openai.APIError,
    openai.OpenAIError,
)

# Largo de la ventana que se busca al comprobar que un detalle del proveedor no
# arrastra la credencial. 8 caracteres es mucho menos que cualquier clave real,
# así que la comprobación es deliberadamente paranoica: un PREFIJO del secreto
# ya es el secreto.
_VENTANA_DE_FUGA = 8

# Techo del detalle que se copia al log. El mensaje útil del gateway es corto
# ("Invalid API key.", "model_not_found"); un cuerpo largo solo llena el log.
_MAX_DETALLE = 300


def modelos_a_intentar() -> List[str]:
    """Cadena de ids a intentar, en orden. Se lee de `settings` en cada
    consulta, no al importar el módulo: cambiar `CHATBOT_MODELO` en el `.env`
    y recrear el contenedor tiene que alcanzar."""
    return settings.chatbot_modelos


def _status_http(error: Exception) -> Optional[int]:
    """El status que devolvió el gateway, o `None` cuando no hubo respuesta
    (timeout, DNS, conexión rechazada, o la credencial ausente que revienta en
    el constructor del cliente). Distinguir los dos casos es justamente lo que
    separa "el gateway respondió mal" de "no se llegó al gateway"."""
    status = getattr(error, "status_code", None)
    return status if isinstance(status, int) else None


def _es_atribuible_al_modelo(error: Exception) -> bool:
    """¿Vale la pena reintentar con OTRO id de modelo?

    Solo un 404 `model_not_found`, que es exactamente la retirada de un modelo
    gratuito. Todo lo demás -- 401/403 (clave revocada o con los `<>` del
    placeholder), 429 (cuota de la CUENTA), 5xx y los fallos de red -- falla
    idéntico con cualquier id: reintentar no lo arregla, solo gasta el
    presupuesto de 30s del BFF y hace esperar de más al usuario para entregarle
    el mismo respaldo local."""
    return _status_http(error) == 404


def _detalle_seguro(error: Exception) -> str:
    """Mensaje del proveedor, acotado y GARANTIZADO sin la credencial.

    El proveedor puede devolver la clave dentro del texto del error y el objeto
    `request` del SDK lleva el header `Authorization` completo. Primero se
    aplica la redacción de la casa (reemplazo exacto, igual que
    `cloudinary_cliente._redactar_detalle_sensible`); después se comprueba que
    no haya sobrevivido NINGUNA ventana de la clave, y si sobrevivió alguna se
    descarta el detalle entero. Perder el mensaje del gateway es barato: el
    tipo de excepción y el status, que nunca pueden contener el secreto, ya
    identifican la causa."""
    detalle = str(error)[:_MAX_DETALLE]
    clave = settings.opencode_api_key
    if not clave:
        return detalle
    detalle = detalle.replace(clave, "[REDACTADA]")
    for inicio in range(len(clave) - _VENTANA_DE_FUGA + 1):
        if clave[inicio : inicio + _VENTANA_DE_FUGA] in detalle:
            return "[detalle omitido: contenía la credencial configurada]"
    return detalle


def _sigue_la_cadena(
    error: Exception, posicion: int, modelos: List[str], limite: float
) -> bool:
    """Tras una falla YA registrada, ¿tiene sentido probar el siguiente id?"""
    if not _es_atribuible_al_modelo(error):
        return False
    if posicion + 1 >= len(modelos):
        return False
    if time.monotonic() >= limite:
        logger.error(
            "Chatbot: presupuesto de %ss agotado; quedaron modelos sin "
            "intentar (%s) y se entrega la FAQ local",
            PRESUPUESTO_TOTAL_SEGUNDOS,
            ", ".join(modelos[posicion + 1 :]),
        )
        return False
    return True


def _registrar_falla(error: Exception, modelo: str) -> None:
    """Una línea por falla, grepeable por `cataclub.chatbot`.

    NUNCA `logger.exception` ni `exc_info=True`: el traceback del SDK arrastra
    el objeto `request`, y con él el header `Authorization`. Lo que el operador
    necesita para separar las causas es el tipo y el status, y ambos se
    construyen a mano acá."""
    status = _status_http(error)
    logger.error(
        "Falla del proveedor del chatbot: %s status=%s modelo=%s gateway=%s detalle=%s",
        type(error).__name__,
        status if status is not None else "sin-respuesta",
        modelo,
        settings.opencode_base_url,
        _detalle_seguro(error),
    )

# --- Conocimiento del club, serializado de su archivo canónico ---------------
# Ya no vive acá una copia propia (issue #768). `conocimiento_club.json` es la
# única definición y la página `/ayuda` renderiza esa misma definición para
# humanos, así que un horario o un precio no se pueden cambiar en un lado y
# quedar viejos en el otro.
#
# Nota que sobrevive al cambio: a propósito NO se listan rutas/URLs
# (/trainer/attendance, /groups, etc.) — solo nombres de sección tal como
# aparecen en el menú — porque el chatbot tiene instrucción explícita de no
# mencionar rutas técnicas en sus respuestas.
CONOCIMIENTO = conocimiento_club.CONOCIMIENTO

# Índice pregunta -> respuesta para el respaldo local. La ubicación y el
# contacto no son una entrada del FAQ, así que entran con una clave propia:
# también salen del archivo canónico, redactadas por `conocimiento_club`.
_CLAVE_CONTACTO = "¿Dónde queda el club y cómo lo contacto?"
_RESPUESTAS_CANONICAS = {
    **conocimiento_club.respuestas_por_pregunta(CONOCIMIENTO),
    _CLAVE_CONTACTO: conocimiento_club.respuesta_de_contacto(CONOCIMIENTO),
}

# El prompt completo (instrucciones + conocimiento) se arma en
# `conocimiento_club`, que NO importa `settings`: así el script que regenera la
# instantánea del prompt puede armarlo sin un `.env` configurado, que es
# justamente la condición en la que alguien edita el conocimiento del club.
SYSTEM_PROMPT = conocimiento_club.SYSTEM_PROMPT

# --- Tamaño del prompt, medido y anotado (issue #768, criterio 4) ------------
# De dónde se parte, para que el próximo que lo agrande sepa qué está
# agrandando. Antes de unificar el conocimiento el prompt eran 4.121 caracteres
# ≈ 1.030 tokens, de los cuales 2.135 caracteres (≈ 533 tokens) eran el bloque
# de FAQ escrito a mano; el resto son las instrucciones de comportamiento.
# Después de incorporar el FAQ completo de la web, la ubicación, el contacto y
# lo que el club dice de sí mismo: 7.450 caracteres ≈ 1.862 tokens. El corpus
# legítimo entero, entonces, cuesta menos del doble de lo que ya se enviaba.
#
# La estimación es caracteres/4, el mismo método con el que se midió el prompt
# viejo — sirve para comparar dos mediciones hechas igual, no para presupuestar
# contra el proveedor. Contar tokens de verdad exigiría un tokenizador del
# modelo, que no es una dependencia que valga la pena para vigilar un techo.
PROMPT_SISTEMA_CARACTERES = len(SYSTEM_PROMPT)
PROMPT_SISTEMA_TOKENS_APROX = PROMPT_SISTEMA_CARACTERES // 4

# El mismo número, escrito a mano. Es redundante a propósito: la suite exige
# que coincida con el calculado, así que agrandar el conocimiento obliga a
# tocar esta línea y el crecimiento aparece en el diff en vez de pasar
# inadvertido.
PROMPT_SISTEMA_TOKENS_MEDIDOS = 1_862

# Techo deliberado, no un límite del proveedor. Superarlo no rompe nada por sí
# solo; lo que hace es obligar a una decisión explícita en vez de dejar que el
# prompt crezca de a poco. El corpus legítimo completo del club está muy por
# debajo, así que llegar acá significa que entró algo que habría que revisar.
#
# Lo que este techo NO protege: `MAX_TOKENS_RESPUESTA`. En la API
# OpenAI-compatible `max_tokens` acota los tokens GENERADOS, no la suma con la
# entrada, así que un prompt más largo no le come presupuesto a la respuesta.
# Lo que sí crece con el prompt es la latencia de prefill y el consumo de
# contexto, y contra eso juega el presupuesto de tiempo de más arriba.
TECHO_PROMPT_SISTEMA_TOKENS = 2_400

_ROLES_VALIDOS = {"usuario": "user", "asistente": "assistant"}


class ChatbotServicio:
    """Envuelve la llamada al gateway OpenCode Zen (OpenAI-compatible) para
    el chatbot de FAQ."""

    def consultar(self, mensaje: str, historial: Optional[List[dict]] = None) -> str:
        """Devuelve la respuesta del modelo, o la de la FAQ local si ningún
        modelo de la cadena pudo atender.

        Lo que ve el usuario NO cambia según la causa: siempre un texto, nunca
        un status de error (el endpoint responde 200 en todos los casos). La
        diferencia entre las causas vive en el log, no en la respuesta."""
        mensajes = self._construir_mensajes(mensaje, historial)
        modelos = modelos_a_intentar()
        limite = time.monotonic() + PRESUPUESTO_TOTAL_SEGUNDOS
        for posicion, modelo in enumerate(modelos):
            # El breaker se consulta antes de CADA intento, no una vez por
            # consulta: cada id de la cadena es una llamada real al gateway.
            if not _circuito_chatbot.permitir():
                # Sin traceback y sin el error crudo, mismas reglas que
                # `_registrar_falla`: nada que pueda arrastrar la credencial.
                logger.error(
                    "Chatbot: circuito ABIERTO, no se llama al gateway (%s); se "
                    "entrega la FAQ local sin gastar el presupuesto de %ss",
                    settings.opencode_base_url,
                    PRESUPUESTO_TOTAL_SEGUNDOS,
                )
                break
            try:
                # El cliente se pide ACÁ DENTRO, no en __init__ ni fuera del
                # try (issue #337): sin OPENCODE_API_KEY configurada el SDK
                # levanta `OpenAIError: Missing credentials` en el CONSTRUCTOR,
                # y `_cliente_openai()` construye cuando la configuración
                # cambió. Fuera de este bloque protegido, ninguno de los
                # `except` de abajo podría verlo y el fallo más probable de un
                # despliegue nuevo volvería a escaparse como un 500 sin manejar.
                client = _cliente_openai()
                respuesta = client.chat.completions.create(
                    model=modelo,
                    max_tokens=MAX_TOKENS_RESPUESTA,
                    messages=mensajes,
                )
            except _FALLAS_DEL_PROVEEDOR as error:
                # El log es lo ÚNICO que distingue las causas entre sí (issue
                # #766): el usuario recibe el mismo 200 con la FAQ local para
                # todas, sin importar si fue la clave, la cuota o el modelo.
                _registrar_falla(error, modelo)
                if _es_atribuible_al_modelo(error):
                    # Un 404 `model_not_found` NO es una falla del proveedor:
                    # es una RESPUESTA del gateway, así que prueba que está
                    # vivo. Contarlo como fallo abriría el circuito ante una
                    # retirada rutinaria de un modelo del tier gratuito y
                    # cortaría la cadena de respaldo justo cuando existe para
                    # eso (issue #766), dejando la FAQ local con un modelo
                    # bueno a un salto de distancia.
                    #
                    # Además RESUELVE la sonda: si el circuito venía en
                    # SEMIABIERTO, no reportar nada lo dejaría ahí para
                    # siempre -- `permitir()` devuelve `False` en SEMIABIERTO
                    # hasta que alguien registre éxito o fallo.
                    _circuito_chatbot.registrar_exito()
                else:
                    _circuito_chatbot.registrar_fallo()
                if not _sigue_la_cadena(error, posicion, modelos, limite):
                    break
                continue
            _circuito_chatbot.registrar_exito()
            return self._limpiar_markdown(respuesta.choices[0].message.content or "")
        return self._respuesta_local(mensaje)

    @staticmethod
    def _respuesta_local(mensaje: str) -> str:
        """Responde desde el conocimiento canónico si el proveedor no atiende.

        Esta tabla enruta términos a una PREGUNTA del FAQ; la respuesta se
        busca en `conocimiento_club.json` y nunca se escribe acá. Antes cada
        una de estas ramas tenía su propio texto a mano — una cuarta copia del
        mismo conocimiento, que además ya se había quedado corta: con el
        proveedor caído el bot no sabía nada que no estuviera en esas seis
        líneas.

        El orden importa: la primera regla que matchea gana, así que las más
        específicas van primero (una pregunta sobre varios representados
        también menciona "hijo", pero no es una pregunta sobre pagos)."""
        normalizado = unicodedata.normalize("NFD", mensaje.lower())
        normalizado = "".join(c for c in normalizado if unicodedata.category(c) != "Mn")
        normalizado = re.sub(r"[^a-z0-9 ]", " ", normalizado)
        normalizado = re.sub(r"\s+", " ", normalizado).strip()
        rutas = (
            (("hijo", "dependiente", "representado"), "Represento a más de un hijo. ¿Cómo cambio entre ellos?"),
            (("ficha medica", "alergia", "tipo de sangre", "emergencia"), "Necesito corregir la ficha médica. ¿Puedo hacerlo yo?"),
            (("whatsapp", "telefono", "numero", "contacto", "direccion", "ubicacion", "donde queda", "como llego"), _CLAVE_CONTACTO),
            (("cuesta", "precio", "mensualidad", "cuota", "tarifa"), "¿Cuánto cuesta la mensualidad?"),
            (("pago", "membresia", "comprobante"), "¿Dónde veo si mi pago fue aprobado?"),
            # Después de "pago": "aprobé un pago por error, ¿puedo revertirlo?"
            # es una pregunta sobre pagos, no sobre la barra de asistencia.
            (("equivoque", "deshacer", "revertir", "marque mal"), "Me equivoqué al marcar. ¿Puedo deshacerlo?"),
            (("asistencia", "entrenamiento", "entreno"), "¿Dónde veo la asistencia?"),
            (("horario", "clase", "formativo", "infantil", "juvenil", "competitivo", "adulto"), "¿Cuáles son los horarios?"),
            (("report",), "¿Dónde genero los reportes del club?"),
            # "sesion" es ambiguo (una sesión de entrenamiento también lo dice),
            # así que esta regla va última: para ese caso ya matcheó
            # "entrenamiento" más arriba.
            (("contrasena", "clave", "login", "sesion"), "¿Cómo inicio sesión?"),
        )
        aviso = "El asistente externo no está disponible en este momento. "
        for terminos, pregunta in rutas:
            if any(termino in normalizado for termino in terminos):
                return aviso + _RESPUESTAS_CANONICAS[pregunta]
        return aviso + "No cuento con esa información; contacte a un administrador del club."

    @staticmethod
    def _limpiar_markdown(texto: str) -> str:
        """El widget renderiza texto plano (sin parser de markdown), pero el
        modelo no respeta de forma confiable la instrucción de no usar
        markdown en el system prompt — se lo vio emitir **negrita** igual.
        Defensa server-side: sacar el marcado más común en vez de depender
        de que el modelo obedezca la instrucción."""
        texto = re.sub(r"\*\*(.+?)\*\*", r"\1", texto)  # **negrita**
        texto = re.sub(r"__(.+?)__", r"\1", texto)  # __negrita__
        texto = re.sub(r"(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)", r"\1", texto)  # *cursiva*
        texto = re.sub(r"`([^`]+)`", r"\1", texto)  # `código`
        # Listas en guion/asterisco markdown -> viñeta simple (sí soportada, ver
        # regla 6 del prompt); una línea ya en "• " queda intacta (no matchea).
        texto = re.sub(r"^\s*[-*]\s+", "• ", texto, flags=re.MULTILINE)
        return texto.strip()

    @staticmethod
    def _construir_mensajes(mensaje: str, historial: Optional[List[dict]]) -> List[dict]:
        """Mapea `historial` (turnos {rol, texto} del cliente) a mensajes
        user/assistant alternados, tomando solo los últimos N para acotar
        tokens/costo. Si el historial es inválido o no arranca en "usuario"
        (rompería la alternancia user-first), se descarta por completo y se
        trata como un turno nuevo — nunca se rompe la request por un
        historial malformado. Esta lógica es agnóstica del proveedor (no
        depende de la forma Anthropic/OpenAI de los mensajes), por eso se
        reusa tal cual del servicio anterior.

        El primer mensaje de la lista es siempre el system prompt — en la
        API OpenAI-compatible el system prompt va como un mensaje más
        (role="system"), no como un parámetro top-level separado."""
        turnos: List[dict] = [{"role": "system", "content": SYSTEM_PROMPT}]

        if isinstance(historial, list) and historial:
            recortado = historial[-MAX_TURNOS_HISTORIAL:]
            candidatos: List[dict] = []
            valido = True
            rol_esperado = "user"
            for turno in recortado:
                if not isinstance(turno, dict):
                    valido = False
                    break
                rol_crudo = turno.get("rol")
                texto = turno.get("texto")
                rol_api = _ROLES_VALIDOS.get(rol_crudo)
                if rol_api is None or not isinstance(texto, str) or not texto.strip():
                    valido = False
                    break
                if rol_api != rol_esperado:
                    valido = False
                    break
                candidatos.append({"role": rol_api, "content": texto})
                rol_esperado = "assistant" if rol_esperado == "user" else "user"

            if valido:
                turnos.extend(candidatos)

        turnos.append({"role": "user", "content": mensaje})
        return turnos
