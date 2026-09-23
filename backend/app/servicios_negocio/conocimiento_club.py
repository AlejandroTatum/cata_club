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
Este módulo la carga, la valida y la serializa a la instantánea de texto que
comparten los consumidores; la página de ayuda renderiza la misma definición
para humanos. (El chatbot que motivó la unificación se retiró después; el
conocimiento estático quedó, porque `/ayuda` y la landing lo siguen usando.)

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
DOM renderizado de `/ayuda` contra los bytes exactos de la instantánea de
conocimiento. Un espejo viejo renderiza contenido viejo y pone rojo al segundo.

## Qué NO entra acá

Nada que no sea información pública del club. La página de ayuda no pide
autenticación, así que todo lo que se agregue a este archivo queda a
disposición de cualquiera que la abra.
"""
import json
from pathlib import Path
from typing import List

RUTA_CONOCIMIENTO = Path(__file__).with_name("conocimiento_club.json")

# Instantánea del bloque de conocimiento serializado (`texto_para_prompt`).
# Es un artefacto derivado, regenerado por `scripts/sincronizar_conocimiento.py`
# y clavado al valor vivo por la suite. Existe para que el guardián de
# divergencia del frontend pueda comparar su DOM renderizado contra esos mismos
# bytes sin levantar Python; de paso, deja el conocimiento visible en el diff
# de cualquier PR que lo agrande. (Nació como el system prompt del chatbot; el
# nombre del archivo sobrevivió al chatbot porque los guardianes lo leen.)
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


def texto_para_prompt(conocimiento: dict) -> str:
    """El conocimiento serializado tal como viaja en la instantánea compartida.

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


CONOCIMIENTO = cargar_conocimiento()
