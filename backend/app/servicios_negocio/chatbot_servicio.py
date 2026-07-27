"""
Servicio del chatbot de FAQ (asistente de navegación de la app).

MVP intencionalmente simple: no hay RAG ni vector store. El contenido de las
preguntas frecuentes se embebe directo en el system prompt (constante
`_FAQ_CONTENIDO` de este módulo) porque no hay volumen de contenido que
justifique algo más sofisticado. No toca la base de datos.

Proveedor: DeepSeek servido a través del gateway OpenAI-compatible
"OpenCode Zen" (https://opencode.ai/zen/v1). Se usa el paquete `openai`
apuntado a ese `base_url` — es el cliente idiomático para cualquier gateway
OpenAI-compatible (retries y excepciones tipadas gratis), en vez de
reimplementar la llamada HTTP a mano.

MODELO_CHATBOT = "deepseek-v4-flash-free" (tier gratuito) es TEMPORAL, solo
para la demo — la suscripción paga "OpenCode Go" (modelo `deepseek-v4-flash`
contra el endpoint propio https://opencode.ai/zen/go/v1) está sin crédito
disponible. Cuando se resuelva el billing de Go, volver a `deepseek-v4-flash`
+ `https://opencode.ai/zen/go/v1`.
"""
import re
from typing import List, Optional

import openai
from fastapi import HTTPException, status

from app.soporte_transversal.configuracion import settings

OPENCODE_ZEN_BASE_URL = "https://opencode.ai/zen/v1"
MODELO_CHATBOT = "deepseek-v4-flash-free"
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

# --- Contenido de las FAQ, embebido directo en el system prompt -------------
# Nota: a propósito NO se listan rutas/URLs (/trainer/attendance, /groups, etc.)
# — solo nombres de sección tal como aparecen en el menú — porque el chatbot
# tiene instrucción explícita de no mencionar rutas técnicas en sus respuestas.
_FAQ_CONTENIDO = """
Generales:
- Para iniciar sesión, el usuario ingresa su correo y contraseña en la pantalla de login. Si olvidó la
  contraseña, existe recuperación de contraseña vía correo electrónico desde la misma pantalla de login.
- Cada rol ve una parte distinta de la app: el administrador tiene acceso completo a la gestión del club
  (miembros, grupos, pagos, asistencia, niveles, reportes); el entrenador ve solo lo referido a su/s
  grupo/s (tomar asistencia, historial de asistencia, nivel técnico de sus alumnos); el
  representante/estudiante ve únicamente "Mi Cuenta", con su propia información.
- Los horarios de las clases (día y hora) los define y gestiona el administrador desde "Gestión de
  Horarios"; cada horario queda asociado a un grupo/nivel y a un entrenador.

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
- La ficha médica (alergias, contacto de emergencia) la gestiona el ADMINISTRADOR, no el propio
  estudiante/representante directamente — si necesita actualizarla, debe pedírselo a un administrador.

Entrenador:
- Toma la asistencia de su grupo desde la sección "Asistencia".
- Puede ver el historial de asistencia que él mismo cargó desde "Historial Asistencia".
- Puede actualizar el nivel técnico (principiante, intermedio o avanzado) de un alumno desde la sección
  "Nivel".

Administrador:
- Gestiona horarios y grupos (día, hora, entrenador asignado) desde "Gestión de Horarios".
- Registra pagos y membresías desde "Membresías y Pagos".
- Genera reportes desde "Reportes".
- La sección "Ranking" ya no es una clasificación competitiva: es donde se asignan alumnos a
  niveles/grupos de entrenamiento (principiante, intermedio, avanzado), con un cupo mínimo y máximo por
  nivel.
""".strip()

_INSTRUCCIONES = """
Eres el asistente virtual de "Cata Club", una app de gestión de un club deportivo (asistencias,
membresías y pagos, fichas médicas, niveles, horarios y grupos). Tu única función es ayudar a los
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
   aparecen en la FAQ (ej. "Mi Cuenta", "Gestión de Horarios"), como lo haría una persona explicándole
   a otra dónde hacer clic.
4. Usa español neutro de Ecuador: trata al usuario de "tú" (nunca "vos" ni conjugaciones de voseo
   como "podés" o "tenés"), con un tono cordial y profesional, sin modismos de otros países (nada de
   "che", "boludo", "vale", "tío", etc.).
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

    def __init__(self) -> None:
        # settings.opencode_api_key viene de OPENCODE_API_KEY en .env (vía
        # Settings/pydantic-settings, igual que el resto de la config de la
        # app) — os.environ.get(...) directo NO se popula solo desde .env,
        # así que hay que pasarlo explícito al cliente openai (a diferencia
        # de anthropic.Anthropic(), que sí lee la env var automáticamente).
        # timeout/max_retries explícitos: sin ellos el SDK usa 600s y 2
        # reintentos y el backend sobrevive al abort del BFF (ver la cuenta del
        # presupuesto de tiempo arriba).
        self._client = openai.OpenAI(
            base_url=OPENCODE_ZEN_BASE_URL,
            api_key=settings.opencode_api_key,
            timeout=TIMEOUT_LLM_SEGUNDOS,
            max_retries=MAX_REINTENTOS_LLM,
        )

    def consultar(self, mensaje: str, historial: Optional[List[dict]] = None) -> str:
        mensajes = self._construir_mensajes(mensaje, historial)
        try:
            respuesta = self._client.chat.completions.create(
                model=MODELO_CHATBOT,
                max_tokens=MAX_TOKENS_RESPUESTA,
                messages=mensajes,
            )
        # El orden importa: RateLimitError, APITimeoutError y APIConnectionError
        # son todas subclases de APIError, así que van de lo más específico a lo
        # más general. Antes se capturaban las cuatro en un solo `except` con un
        # único 502, y el usuario no podía distinguir "esperá un momento" de
        # "el asistente está caído" ni de "tardó demasiado".
        except openai.RateLimitError as exc:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=(
                    "El asistente está recibiendo demasiadas consultas. "
                    "Espera unos segundos e inténtalo de nuevo."
                ),
            ) from exc
        except openai.APITimeoutError as exc:
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail="El asistente tardó demasiado en responder. Vuelve a intentarlo.",
            ) from exc
        except openai.APIConnectionError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="El asistente no está disponible en este momento. Inténtalo más tarde.",
            ) from exc
        except openai.APIError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="No se pudo contactar al asistente. Inténtalo de nuevo en un momento.",
            ) from exc

        return self._limpiar_markdown(respuesta.choices[0].message.content or "")

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
