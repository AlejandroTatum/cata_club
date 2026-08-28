"""
Fuente única del conocimiento del club (issue #768).

## Qué problema resuelve

El mismo conocimiento existía tres veces y nadie lo sincronizaba: el bloque
`_FAQ_CONTENIDO` de `chatbot_servicio.py` (2.135 caracteres), el FAQ navegable
de `frontend/src/app/ayuda/faq-content.ts` (6.419) y los atajos del chat
(2.291). Cambiar un horario obligaba a acordarse de los tres; tocar uno solo
dejaba al asistente contradiciendo a la página de ayuda, con total seguridad y
sin que nada se pusiera rojo.

`conocimiento_club.json`, al lado de este módulo, es ahora la única definición.
Este módulo la carga, la valida y la serializa al texto que viaja en el system
prompt; la página de ayuda renderiza la misma definición para humanos.

## Por qué un archivo de datos, y no un endpoint ni un generador

La restricción que decide es de despliegue, no de gusto: los contextos de build
de Docker son `./backend` y `./frontend` por separado
(`docker-compose.override.yml` y los dos jobs de imagen en CI), y cada Dockerfile
hace `COPY . .` dentro del suyo. Un archivo compartido en la raíz del repo NO
entraría a ninguna de las dos imágenes. Las tres salidas posibles, y por qué
esta:

  · **Endpoint del backend que la página de ayuda consulta.** Convierte texto
    estático en una dependencia de runtime: `/ayuda` es alcanzable sin sesión y
    es justo donde va alguien cuando algo no funciona — dejarla en blanco
    cuando la API está caída es peor que el problema que resuelve. Además el
    guardián de divergencia pasaría a ser un test de integración, lento y
    frágil, en vez de una comparación offline.
  · **Generar código Python desde el frontend (o al revés) con un paso de
    build.** Un generador se pudre: alguien edita la fuente, no lo corre, y el
    artefacto derivado queda mintiendo hasta que alguien lo nota.
  · **Un archivo de datos, y un espejo copiado byte a byte dentro del otro
    contexto** — lo elegido. No hay transformación que pueda estar sutilmente
    mal: el guardián es una igualdad de bytes. `pnpm type-check` valida la forma
    del JSON contra la interfaz de TypeScript (`resolveJsonModule` infiere el
    tipo literal del contenido), así que el costo clásico de un archivo de datos
    — perder seguridad de tipos — casi no se paga acá.

Lo que se cede: existe un archivo derivado (`frontend/src/data/club-knowledge.json`)
que puede quedar viejo. Por eso hay dos candados, y ninguno depende de que
alguien se acuerde: `tests/test_conocimiento_club.py` compara el espejo byte a
byte contra este archivo, y el guardián de divergencia del frontend compara el
DOM renderizado de `/ayuda` contra los bytes exactos del prompt. Un espejo viejo
renderiza contenido viejo y pone rojo al segundo.

## Qué NO entra acá

Nada que no sea información pública del club. El endpoint del chatbot no pide
autenticación (`chatbot_router.py`, sin `GestorPermisos`), así que todo lo que
se agregue a este archivo queda a disposición de cualquiera que sepa preguntar.
"""
import json
from pathlib import Path
from typing import Dict, List

RUTA_CONOCIMIENTO = Path(__file__).with_name("conocimiento_club.json")

# Instantánea del prompt exacto que se le envía al modelo. Es un artefacto
# derivado, regenerado por `scripts/sincronizar_conocimiento.py` y clavado al
# valor vivo por la suite. Existe para que el guardián de divergencia del
# frontend pueda comparar su DOM renderizado contra lo que el modelo realmente
# recibe, sin levantar Python; de paso, deja el prompt visible en el diff de
# cualquier PR que lo agrande.
RUTA_INSTANTANEA_PROMPT = Path(__file__).with_name("prompt_sistema.txt")

_SECCIONES = ("club", "ubicacion", "contacto", "horarios", "faq", "atajos")


def cargar_conocimiento() -> dict:
    """El archivo canónico, validado.

    La validación es deliberadamente estructural y no de contenido: lo que
    tiene que fallar temprano es una sección faltante o un horario incompleto,
    porque eso produciría un prompt mutilado que igual se envía. Lo que dice el
    club sobre sí mismo no lo puede juzgar un validador."""
    datos = json.loads(RUTA_CONOCIMIENTO.read_text(encoding="utf-8"))
    faltantes = [seccion for seccion in _SECCIONES if seccion not in datos]
    if faltantes:
        raise ValueError(
            f"conocimiento_club.json no tiene {', '.join(faltantes)}"
        )
    for horario in datos["horarios"]:
        vacios = [campo for campo in ("categoria", "edades", "dias", "horas") if not horario.get(campo)]
        if vacios:
            raise ValueError(
                f"horario incompleto ({horario.get('categoria', '?')}): falta {', '.join(vacios)}"
            )
    return datos


def respuestas_por_pregunta(conocimiento: dict) -> Dict[str, str]:
    """Índice pregunta -> respuesta de todo el FAQ.

    Lo consume el respaldo local del chatbot: cuando el proveedor no atiende, la
    respuesta que se entrega es la canónica, no una cuarta copia escrita a
    mano."""
    return {
        entrada["pregunta"]: entrada["respuesta"]
        for seccion in conocimiento["faq"]
        for entrada in seccion["entradas"]
    }


def respuesta_de_contacto(conocimiento: dict) -> str:
    """Dónde queda el club y a qué número se escribe, en una oración.

    No es una entrada del FAQ: es la misma ubicación y el mismo contacto del
    archivo canónico, redactados para el respaldo local del chatbot. Se compone
    acá y no allá justamente para que no exista una séptima redacción de la
    dirección del club en el repositorio."""
    ubicacion = conocimiento["ubicacion"]
    numeros = " o al ".join(conocimiento["contacto"]["whatsapp"])
    return (
        f"El club queda en {ubicacion['direccion']} "
        f"({ubicacion['referencia'].lower()}, Plus Code {ubicacion['plus_code']}). "
        f"Puede escribir por WhatsApp al {numeros}."
    )


def texto_para_prompt(conocimiento: dict) -> str:
    """El conocimiento serializado tal como viaja en el system prompt.

    Formato plano y regular a propósito: `- Categoría (edades): días, de HH:MM
    a HH:MM.` y pares `P:`/`R:`. El guardián de divergencia del frontend lee
    justamente esas formas para reconciliarlas con el DOM de `/ayuda`, así que
    cambiarlas es cambiar un contrato entre los dos lados, no solo el estilo."""
    club = conocimiento["club"]
    ubicacion = conocimiento["ubicacion"]
    contacto = conocimiento["contacto"]

    lineas: List[str] = [
        "Sobre el club:",
        f"- {club['resumen']}",
        f"- Misión: {club['mision']}",
        f"- Visión: {club['vision']}",
        "",
        "Valores del club:",
    ]
    lineas += [f"- {valor['nombre']}: {valor['descripcion']}" for valor in club["valores"]]

    lineas += [
        "",
        "Dónde queda y cómo se lo contacta:",
        f"- Dirección: {ubicacion['direccion']}",
        f"- Referencia: {ubicacion['referencia']}",
        f"- Plus Code: {ubicacion['plus_code']}",
    ]
    lineas += [f"- WhatsApp: {numero}" for numero in contacto["whatsapp"]]
    lineas += [
        f"- Facebook: {contacto['facebook']}",
        f"- Instagram: {contacto['instagram']}",
        f"- {contacto['nota']}",
        "",
        "Horarios de clases por categoría (días y horas fijos del club):",
    ]
    lineas += [
        f"- {horario['categoria']} ({horario['edades']}): {horario['dias']}, de {horario['horas']}."
        for horario in conocimiento["horarios"]
    ]

    lineas += ["", "Preguntas frecuentes:"]
    for seccion in conocimiento["faq"]:
        lineas += ["", f"[{seccion['titulo']}]"]
        for entrada in seccion["entradas"]:
            lineas += [f"P: {entrada['pregunta']}", f"R: {entrada['respuesta']}"]

    return "\n".join(lineas)


# --- Instrucciones de comportamiento ----------------------------------------
# Viven acá, y no en `chatbot_servicio`, por una razón operativa: este módulo no
# importa `settings`, así que el script que regenera la instantánea del prompt
# puede armarlo entero sin `.env` ni base de datos. El servicio del chatbot
# reexporta `SYSTEM_PROMPT` y sigue siendo el dueño de la llamada al proveedor.
_INSTRUCCIONES = """
Eres el asistente virtual de "Cata Club", un club de tenis de mesa, y de su app de gestión
(asistencias, membresías y pagos, fichas médicas, horarios y grupos). Tu función es ayudar a los
usuarios a entender CÓMO USAR la app y a resolver las dudas más comunes sobre el club —horarios,
categorías, ubicación y contacto— basándote exclusivamente en la información que se te da a
continuación.

Reglas:
1. Responde solo preguntas sobre el club o sobre cómo usar la app, apoyándote en la información
   provista. Si la pregunta no está cubierta por esa información, di que no cuentas con esa
   información y sugiere contactar a un administrador del club — nunca inventes funcionalidades,
   horarios, valores ni datos de contacto que no aparezcan ahí.
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

CONOCIMIENTO = cargar_conocimiento()

SYSTEM_PROMPT = (
    f"{_INSTRUCCIONES}\n\n--- Información de Cata Club ---\n"
    f"{texto_para_prompt(CONOCIMIENTO)}"
)
