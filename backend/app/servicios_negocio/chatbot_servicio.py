"""
Servicio del chatbot de FAQ (asistente de navegación de la app).

MVP intencionalmente simple: no hay RAG ni vector store. El contenido de las
preguntas frecuentes se embebe directo en el system prompt (constante
`_FAQ_CONTENIDO` de este módulo) porque no hay volumen de contenido que
justifique algo más sofisticado. No toca la base de datos.

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
import time
import unicodedata
from typing import List, Optional

import openai

from app.soporte_transversal.configuracion import settings

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

# --- Contenido de las FAQ, embebido directo en el system prompt -------------
# Nota: a propósito NO se listan rutas/URLs (/trainer/attendance, /groups, etc.)
# — solo nombres de sección tal como aparecen en el menú — porque el chatbot
# tiene instrucción explícita de no mencionar rutas técnicas en sus respuestas.
_FAQ_CONTENIDO = """
Generales:
- Para iniciar sesión, el usuario ingresa su correo y contraseña en la pantalla de login. Si olvidó la
  contraseña, existe recuperación de contraseña vía correo electrónico desde la misma pantalla de login.
- Cada rol ve una parte distinta de la app: el administrador tiene acceso completo a la gestión del club
  (miembros, grupos, pagos, asistencia, reportes); el entrenador ve lo operativo del día a día
  (tomar asistencia, historial de asistencia); el
  representante/estudiante ve únicamente "Mi Cuenta", con su propia información.
- Los horarios de las clases (día y hora) los define y gestiona el administrador desde "Horarios".
  No hay entrenadores asignados a horarios: cada clase la da el entrenador disponible.

Horarios de clases por categoría (días y horas fijos del club):
- Formativo (5 a 10 años): Lunes a Viernes, de 15:00 a 16:00.
- Infantil (8 a 12 años): Lunes a Viernes, de 16:00 a 17:00.
- Juvenil (mayores de 12 años): Lunes a Viernes, de 17:00 a 18:00.
- Competitivo (Selección): Lunes a Sábado, de 18:00 a 20:00.
- Adultos (mayores de 18 años): Lunes a Viernes, de 20:00 a 21:15.

Representante/Estudiante (sección "Mi Cuenta"):
- Puede ver el estado de sus pagos y de su membresía desde "Mi Cuenta".
- Puede consultar su propio historial de asistencia desde "Mi Cuenta"; cada registro muestra el día y
  horario de esa clase, así que ahí también se ve el horario de sus entrenamientos.
- La ficha médica (alergias, enfermedades, tipo de sangre, contacto de emergencia) se ve y se
  corrige desde "Mi Cuenta". La de un hijo o dependiente, su REPRESENTANTE; la propia, un socio
  MAYOR DE EDAD que gestiona su propia cuenta. El ADMINISTRADOR puede corregir cualquiera. La
  ficha de un menor no la edita el menor: la corrige su representante o un administrador.

Entrenador:
- Toma la asistencia de cualquier grupo desde la sección "Asistencia".
- Puede ver el historial de asistencias registradas desde "Historial Asistencia".

Administrador:
- Gestiona horarios y grupos (día y hora) desde "Horarios".
- Registra pagos y membresías desde "Membresías y Pagos".
- Genera reportes desde "Reportes".
""".strip()

_INSTRUCCIONES = """
Eres el asistente virtual de "Cata Club", una app de gestión de un club deportivo (asistencias,
membresías y pagos, fichas médicas, horarios y grupos). Tu única función es ayudar a los
usuarios a entender CÓMO USAR la app, basándote exclusivamente en la información de FAQ que se te da a
continuación.

Reglas:
1. Responde solo preguntas sobre cómo usar la app, apoyándote en el contenido de FAQ provisto. Si la
   pregunta no está cubierta por esa información, di que no cuentas con esa información y sugiere
   contactar a un administrador del club — nunca inventes funcionalidades que no aparecen ahí.
2. Sé muy conciso. Si la respuesta es una sola idea, usa 1 a 3 oraciones cortas. Si implica varios
   elementos (ej. varios horarios, varios pasos), estructúrala como una lista: una línea por elemento,
   cada línea empezando con "• " (viñeta simple), sin meter todo en un párrafo corrido. Nunca un muro
   de texto en un solo bloque.
3. NUNCA menciones rutas, URLs ni nombres técnicos de páginas (nada de "/trainer/attendance",
   "/groups", etc.). Refiérete siempre a las secciones por su nombre visible en el menú, tal como
   aparecen en la FAQ (ej. "Mi Cuenta", "Horarios"), como lo haría una persona explicándole
   a otra dónde hacer clic.
4. Usa español neutro de Ecuador: trata al usuario de "usted" (nunca "tú" ni "vos", ni conjugaciones
   de voseo como "podés" o "tenés"), con un tono cordial y profesional, sin modismos de otros países
   (nada de "che", "boludo", "vale", "tío", etc.).
5. Responde siempre en el mismo idioma en el que escribe el usuario; si no puedes determinarlo, responde
   en español.
6. Texto plano únicamente: nunca uses sintaxis markdown (nada de **negrita**, _cursiva_ ni backticks).
   Las viñetas "• " sí están permitidas y se muestran bien (ver regla 2) — no son markdown, es el
   único formato de lista que soporta el chat. El nombre de una sección puede ir entre comillas
   normales si hace falta destacarlo.
""".strip()

SYSTEM_PROMPT = f"{_INSTRUCCIONES}\n\n--- FAQ de Cata Club ---\n{_FAQ_CONTENIDO}"

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
            try:
                # El cliente se construye ACÁ DENTRO, no en __init__ (issue
                # #337): settings.opencode_api_key viene de OPENCODE_API_KEY en
                # .env (vía Settings/pydantic-settings, igual que el resto de la
                # config de la app) — os.environ.get(...) directo NO se popula
                # solo desde .env, así que hay que pasarlo explícito al cliente
                # openai (a diferencia de anthropic.Anthropic(), que sí lee la
                # env var automáticamente).
                # timeout/max_retries explícitos: sin ellos el SDK usa 600s y 2
                # reintentos y el backend sobrevive al abort del BFF (ver la
                # cuenta del presupuesto de tiempo arriba).
                #
                # Construirlo en __init__ dejaba `openai.OpenAI(api_key="")`
                # fuera de este try/except: sin OPENCODE_API_KEY configurada, el
                # SDK levanta `OpenAIError: Missing credentials` en el
                # CONSTRUCTOR -- antes de que existiera el bloque protegido, así
                # que ninguno de los `except` de abajo podía verlo y el fallo más
                # probable de un despliegue nuevo escapaba como 500 sin manejar.
                client = openai.OpenAI(
                    base_url=settings.opencode_base_url,
                    api_key=settings.opencode_api_key,
                    timeout=TIMEOUT_LLM_SEGUNDOS,
                    max_retries=MAX_REINTENTOS_LLM,
                )
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
                if not _sigue_la_cadena(error, posicion, modelos, limite):
                    break
                continue
            return self._limpiar_markdown(respuesta.choices[0].message.content or "")
        return self._respuesta_local(mensaje)

    @staticmethod
    def _respuesta_local(mensaje: str) -> str:
        """Responde desde la FAQ embebida si el proveedor no está disponible."""
        normalizado = unicodedata.normalize("NFD", mensaje.lower())
        normalizado = "".join(c for c in normalizado if unicodedata.category(c) != "Mn")
        normalizado = re.sub(r"[^a-z0-9 ]", " ", normalizado)
        normalizado = re.sub(r"\s+", " ", normalizado).strip()
        respuestas = (
            (("contrasena", "clave", "login", "iniciar sesion"), "Para iniciar sesión, ingrese su correo y contraseña en la pantalla de login. Si olvidó la contraseña, use la recuperación de contraseña vía correo electrónico desde esa pantalla."),
            (("pago", "membresia"), "Puede ver el estado de sus pagos y de su membresía desde Mi Cuenta. El administrador registra pagos y membresías desde Membresías y Pagos."),
            (("asistencia", "entrenamiento"), "Puede consultar su propio historial de asistencia desde Mi Cuenta. Cada registro muestra el día y horario de esa clase."),
            (("ficha medica", "alergia", "tipo de sangre", "emergencia"), "La ficha médica se ve y se corrige desde Mi Cuenta; la de un hijo o dependiente la corrige su representante o un administrador."),
            (("horario", "clase", "formativo", "infantil", "juvenil", "competitivo", "adulto"), "Los horarios de las clases los define y gestiona el administrador desde Horarios."),
            (("report",), "El administrador genera reportes desde Reportes."),
        )
        for terminos, respuesta in respuestas:
            if any(termino in normalizado for termino in terminos):
                return "El asistente externo no está disponible en este momento. " + respuesta
        return "El asistente externo no está disponible en este momento. No cuento con esa información; contacte a un administrador del club."

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
