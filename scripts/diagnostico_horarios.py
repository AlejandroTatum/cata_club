"""
Diagnóstico de solo lectura de la superficie de horarios (issue #899).

Separa dos preguntas independientes a propósito, porque mezclarlas manda al
operador a mirar el lugar equivocado:

  EJE REVISIÓN   ¿qué código está corriendo?
  EJE CATÁLOGO   ¿qué datos sirve ese código, y llegan a la pantalla?

El runbook de interpretación y escalamiento vive en
`docs/operations/diagnostico-horarios.md`.

Stdlib puro — corre con `python3` sin dependencias de terceros ni la venv del
backend, igual que `scripts/qa_verify_build_sha.py`. Uso:

    python3 scripts/diagnostico_horarios.py [--json]

GARANTÍAS DE ESTE ARCHIVO:

  DIAGNOSTICA Y NUNCA REPARA. No escribe, no despliega, no muta nada — ni
  siquiera hace `git fetch`, que movería refs locales. La referencia esperada
  se lee tal como está en el clon; actualizarla es decisión del operador,
  antes de correr esto.

  CÓDIGO DE SALIDA SIEMPRE 0. Un hallazgo ES la salida esperada de un
  diagnóstico, no una falla de proceso (misma regla que
  `backend/scripts/inventario_anomalias_pagos.py`). Esto es un inventario, no
  un gate: si algún día un gate necesita fallar, que lea el `--json`.

  REDACCIÓN. El reporte emite SOLO SHAs, nombres de clase de hallazgo, la URL
  loopback fija y el texto del error de transporte. Nunca cadenas de
  conexión, credenciales, valores de entorno, rutas absolutas ni datos de
  personas. Los mensajes de error los construye este módulo y solo nombran la
  URL constante y el fallo de red.

  DETERMINISMO. Dos corridas equivalentes producen salida idéntica: los
  hallazgos van ordenados y el cuerpo del reporte no lleva timestamps ni
  duraciones.

QUÉ SIGNIFICA CADA CLASE:

  revision_drift             El SHA servido difiere de la revisión esperada.
                             Se puede determinar la revisión, y está mal.
  revision_unavailable       La revisión NO se pudo determinar: `sha:
                             "unknown"`, el endpoint no respondió, o falta el
                             campo. No es deriva. La distinción "no sé" contra
                             "sé, y está mal" es el valor entero de este
                             diagnóstico; un inventario que no puede decir "no
                             sé" termina adivinando.
  missing_dynamic_data       La fuente contestó bien y el catálogo está vacío,
                             o una categoría no llega entera a la pantalla.
  dynamic_source_unavailable La fuente no contestó, tardó de más, no devolvió
                             JSON, o devolvió una forma inválida. Un 502 de
                             `isPublicSchedules` es ESTO, nunca datos
                             faltantes: significa "no sé qué hay", no "no hay
                             nada" — el mismo error que llamarle deriva a un
                             `unknown`, en el otro eje.
  static_schedule_authority  Una lista ESTÁTICA de horarios todavía sirve una
                             superficie. Se REPORTA, no se repara: completar
                             esa migración es #789, y #899 la excluye de sus
                             objetivos.

La comparación de revisión es por IGUALDAD, no por ancestría: el objeto del
SHA servido puede no existir en el clon local (se construyó en CI), así que
`git merge-base` no es una pregunta que se pueda contestar acá.

ESPEJO DEL MAPPER — la advertencia importante de este archivo:

    `bloque_renderizable` y `categoria_renderizable` son una reimplementación
    en Python de `mapBlock`/`mapPublicSchedules`
    (`frontend/src/app/landing/schedule-data.ts`), y
    `catalogo_tiene_forma_valida` lo es de `isPublicSchedules`
    (`frontend/src/app/api/schedules/route.ts`).

    Hacen falta porque el mapper DESCARTA EN SILENCIO: un bloque con un día
    fuera de `DAY_LABELS`, con `days` vacío o con una hora que no matchea
    /^\\d{2}:\\d{2}$/ desaparece sin error, y si una categoría se queda sin
    bloques, desaparece entera. La respuesta HTTP se ve impecable mientras la
    pantalla muestra menos categorías. Un diagnóstico que solo compare
    payloads reportaría "todo alineado" justo cuando falta algo.

    Al ser un espejo, PUEDE QUEDAR DESACTUALIZADO si cambia el TypeScript.
    Se declara acá a propósito: un espejo con su salvedad escrita es más
    honesto que un verde falso. Si los criterios de la landing cambian, este
    módulo se actualiza con ellos.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

CLASE_DERIVA = "revision_drift"
CLASE_REVISION_INDETERMINADA = "revision_unavailable"
CLASE_DATOS_FALTANTES = "missing_dynamic_data"
CLASE_FUENTE_INDISPONIBLE = "dynamic_source_unavailable"
CLASE_AUTORIDAD_ESTATICA = "static_schedule_authority"

# El orden del glosario del docstring. `resumen` las lista SIEMPRE todas, aun
# en cero, para que la forma de la salida no dependa de los hallazgos.
CLASES = (
    CLASE_DERIVA,
    CLASE_REVISION_INDETERMINADA,
    CLASE_DATOS_FALTANTES,
    CLASE_FUENTE_INDISPONIBLE,
    CLASE_AUTORIDAD_ESTATICA,
)

ANFITRIONES_LOOPBACK_PERMITIDOS = frozenset({"localhost", "127.0.0.1", "::1"})

# URL fija, jamás tomada de argv: un valor de CLI acá sería en sí mismo una
# fuente de SSRF (regla S5144 de Sonar), no algo a validar después. Es la
# misma dirección que sirve `make qa-up` (docker-compose.override.yml).
URL_SALUD_FRONTEND = "http://localhost:3000/api/health"

REFERENCIA_ESPERADA = "origin/main"

# Lo que `/api/health` responde cuando `BUILD_SHA` no llegó a la imagen.
SHA_AUSENTE = "unknown"

_DETALLE_SHA_AUSENTE = (
    "El frontend responde, pero BUILD_SHA no llegó a la imagen: la ruta de "
    "publicación de CI pasa esa variable y verifica la revisión antes de "
    "publicar (issue #927), así que esta imagen no vino de ahí. No es "
    "deriva — la revisión no se puede determinar desde acá."
)

# Lo que se reporta como `observado` cuando la fuente no dejó nada que leer:
# no respondió, tardó de más, no devolvió JSON o devolvió una forma inválida.
# Es deliberadamente distinto de "0 categorías", que sí es una respuesta y
# significa que el club no publicó horarios. Una sola constante para que las
# dos lecturas no puedan divergir en el texto y terminar leyéndose como casos
# distintos.
OBSERVADO_SIN_RESPUESTA = "sin respuesta utilizable"

# El catálogo dinámico, por las dos bocas que lo sirven. El BFF de Next es lo
# que consume la landing; el backend directo permite distinguir "el backend no
# publica nada" de "el BFF no lo está pasando".
URL_CATALOGO_BFF = "http://localhost:3000/api/schedules"
URL_CATALOGO_BACKEND = "http://127.0.0.1:8000/api/v1/asistencias/horarios-publicos"

_RAIZ_REPO = Path(__file__).resolve().parent.parent
# Siempre relativa en la salida: el contrato de redacción prohíbe rutas
# absolutas, que además delatan el layout de la máquina del operador.
RUTA_RELATIVA_CONOCIMIENTO = "backend/app/servicios_negocio/conocimiento_club.json"
RUTA_CONOCIMIENTO_CLUB = _RAIZ_REPO / RUTA_RELATIVA_CONOCIMIENTO

# Espejo de DAY_LABELS y VALID_TIME (schedule-data.ts). Ver la advertencia
# sobre el espejo en el docstring del módulo.
DIAS_RENDERIZABLES = frozenset(
    {"LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES", "SABADO", "DOMINGO"}
)
_PATRON_HORA = re.compile(r"^\d{2}:\d{2}$")

# Dónde sigue mandando la lista estática. #789 la sacó SOLO de la landing.
_SUPERFICIES_ESTATICAS = (
    "el prompt del chatbot (backend/app/servicios_negocio/conocimiento_club.py:85,161)",
    "la página /ayuda (frontend/src/app/ayuda/faq-content.ts:88, FAQ_SCHEDULES)",
)


def validar_url_loopback(url: str) -> None:
    """Levanta RuntimeError si `url` no es http(s) contra loopback.

    Defensa en profundidad: aunque las URLs ya son constantes del módulo y no
    entradas de CLI, el esquema y el host se chequean igual ANTES de que la
    URL llegue a `urlopen`. Un chequeo de esquema solo no acota a DÓNDE puede
    ir el pedido; el allowlist explícito de loopback sí."""
    partes = urlparse(url)
    if partes.scheme not in ("http", "https"):
        raise RuntimeError(f"URL inválida ({url!r}): el esquema debe ser http o https")
    if partes.hostname not in ANFITRIONES_LOOPBACK_PERMITIDOS:
        raise RuntimeError(
            f"URL inválida ({url!r}): el host debe ser localhost/127.0.0.1/::1 "
            "(este diagnóstico solo consulta el stack local, no hosts arbitrarios)"
        )


def consultar_json(url: str) -> object:
    """GET `url` y devuelve su cuerpo JSON parseado.

    Cualquier falla levanta RuntimeError nombrando la URL: un error de red o
    un cuerpo inválido tienen que ser ruidosos, nunca un pase silencioso."""
    validar_url_loopback(url)
    try:
        with urllib.request.urlopen(url, timeout=10) as respuesta:  # noqa: S310
            cuerpo = respuesta.read()
    except OSError as exc:
        raise RuntimeError(f"no se pudo consultar {url}: {exc}") from exc

    try:
        return json.loads(cuerpo)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"{url} no devolvió JSON válido: {exc}") from exc


def obtener_sha_servido(url: str = URL_SALUD_FRONTEND) -> str:
    """Devuelve el campo `sha` que sirve `/api/health`.

    Un `sha` ausente o vacío NO se traduce a "unknown": eso lo decide el
    frontend cuando falta `BUILD_SHA`, y confundir "el campo no vino" con "el
    campo vino diciendo unknown" borraría de qué lado está el problema."""
    datos = consultar_json(url)
    sha = datos.get("sha") if isinstance(datos, dict) else None
    if not isinstance(sha, str) or not sha:
        raise RuntimeError(f"{url} no incluye el campo 'sha' en la respuesta")
    return sha


def obtener_sha_git(referencia: str) -> str:
    """SHA de `referencia` en el clon local, SIN hacer fetch (ver garantías)."""
    resultado = subprocess.run(
        ["git", "rev-parse", referencia],
        capture_output=True,
        text=True,
        check=False,
    )
    if resultado.returncode != 0:
        raise RuntimeError(
            f"'git rev-parse {referencia}' terminó con código "
            f"{resultado.returncode}: {resultado.stderr.strip()}"
        )
    return resultado.stdout.strip()


def _intentar(operacion) -> tuple[str | None, str | None]:
    """Corre un colector y devuelve (valor, error). La recolección NUNCA
    lanza: un colector caído es un hallazgo del reporte, no un crash."""
    try:
        return (operacion(), None)
    except RuntimeError as exc:
        return (None, str(exc))


def observar_revision() -> dict:
    """Recolecta el eje revisión. Todo I/O vive acá; la decisión es pura."""
    sha_servido, error_servido = _intentar(lambda: obtener_sha_servido(URL_SALUD_FRONTEND))
    sha_esperado, error_esperado = _intentar(lambda: obtener_sha_git(REFERENCIA_ESPERADA))
    sha_head, error_head = _intentar(lambda: obtener_sha_git("HEAD"))
    return {
        "referencia_esperada": REFERENCIA_ESPERADA,
        "url_salud": URL_SALUD_FRONTEND,
        "sha_esperado": sha_esperado,
        "error_sha_esperado": error_esperado,
        "sha_servido": sha_servido,
        "error_sha_servido": error_servido,
        # Contexto, nunca un hallazgo: que el clon local esté en otra rama es
        # lo normal en este repo (CLAUDE.md prohíbe commitear directo a main).
        "sha_head_local": sha_head,
        "error_sha_head_local": error_head,
    }


def bloque_renderizable(bloque: object) -> bool:
    """Espejo de `mapBlock`: ¿la landing conserva este bloque?

    Cada rechazo de acá es un bloque que desaparece de la pantalla SIN error
    en ninguna capa. Ver la advertencia sobre el espejo en el docstring."""
    if not isinstance(bloque, dict):
        return False
    dias = bloque.get("days")
    if not isinstance(dias, list) or not dias:
        return False
    if not all(isinstance(dia, str) and dia in DIAS_RENDERIZABLES for dia in dias):
        return False
    inicio, fin = bloque.get("startTime"), bloque.get("endTime")
    if not isinstance(inicio, str) or not isinstance(fin, str):
        return False
    return bool(_PATRON_HORA.match(inicio)) and bool(_PATRON_HORA.match(fin))


def _etiqueta_de(entrada: object) -> str | None:
    """Etiqueta de la categoría ya normalizada, o None si la landing la
    descartaría (`category` no string o en blanco)."""
    if not isinstance(entrada, dict):
        return None
    etiqueta = entrada.get("category")
    if not isinstance(etiqueta, str) or not etiqueta.strip():
        return None
    return etiqueta.strip()


def _bloques_de(entrada: object) -> list:
    bloques = entrada.get("blocks") if isinstance(entrada, dict) else None
    return bloques if isinstance(bloques, list) else []


def categoria_renderizable(entrada: object) -> bool:
    """Espejo de `mapPublicSchedules`: una categoría sin NINGÚN bloque
    renderizable se descarta entera (`slots.length === 0`)."""
    if _etiqueta_de(entrada) is None:
        return False
    return any(bloque_renderizable(bloque) for bloque in _bloques_de(entrada))


def catalogo_tiene_forma_valida(payload: object) -> bool:
    """Espejo de `isPublicSchedules` (route.ts). Es TODO-O-NADA: si esto da
    False, el BFF responde 502 y no se sirve NI UNA categoría.

    Es deliberadamente más permisivo que el mapper —acepta `days` vacío y
    cualquier string como hora—, y esa diferencia es justamente el hueco por
    donde pasa el descarte silencioso."""
    if not isinstance(payload, list):
        return False
    for categoria in payload:
        if not isinstance(categoria, dict):
            return False
        if not isinstance(categoria.get("category"), str):
            return False
        if not isinstance(categoria.get("blocks"), list):
            return False
        # `ages` es opcional (PublicScheduleCategoryDTO, #913): string, o
        # ausente/null cuando la categoría no publica etiqueta de edad.
        edades = categoria.get("ages")
        if edades is not None and not isinstance(edades, str):
            return False
        for bloque in categoria["blocks"]:
            if not isinstance(bloque, dict):
                return False
            dias = bloque.get("days")
            if not isinstance(dias, list) or not all(isinstance(d, str) for d in dias):
                return False
            if not isinstance(bloque.get("startTime"), str):
                return False
            if not isinstance(bloque.get("endTime"), str):
                return False
    return True


def resumir_catalogo(payload: object) -> dict:
    """Resumen redactado del catálogo: solo etiquetas y conteos, nunca el
    payload crudo. Ordenado por etiqueta para que la salida sea determinista."""
    categorias = []
    for entrada in payload if isinstance(payload, list) else []:
        etiqueta = _etiqueta_de(entrada)
        bloques = _bloques_de(entrada)
        renderizables = sum(1 for bloque in bloques if bloque_renderizable(bloque))
        categorias.append(
            {
                "etiqueta": etiqueta if etiqueta is not None else "(sin etiqueta)",
                "bloques": len(bloques),
                "bloques_renderizables": renderizables,
                "renderizable": etiqueta is not None and renderizables > 0,
            }
        )
    categorias.sort(key=lambda categoria: categoria["etiqueta"])
    return {
        "categorias": categorias,
        "total_categorias": len(categorias),
        "categorias_renderizables": sum(1 for c in categorias if c["renderizable"]),
    }


def obtener_catalogo(url: str) -> list:
    """Catálogo público de `url`, ya validado contra la forma publicada.

    Una forma inválida levanta RuntimeError en vez de devolver una lista
    vacía: "no sé qué hay" no puede colapsar a "no hay nada"."""
    payload = consultar_json(url)
    if not catalogo_tiene_forma_valida(payload):
        raise RuntimeError(
            f"{url} no devolvió la forma esperada de horarios públicos "
            "(mismo criterio que `isPublicSchedules`, que ante esto responde 502)"
        )
    return payload


def observar_catalogo(url: str) -> dict:
    """Observa una boca del catálogo. Nunca lanza: una fuente caída es un
    hallazgo del reporte, no un crash."""
    try:
        payload = obtener_catalogo(url)
    except RuntimeError as exc:
        return {
            "url": url,
            "error": str(exc),
            "categorias": None,
            "total_categorias": None,
            "categorias_renderizables": None,
        }
    return {"url": url, "error": None, **resumir_catalogo(payload)}


def observar_horarios_estaticos(ruta: Path | str) -> dict:
    """¿Queda una lista estática de horarios sirviendo alguna superficie?

    Lectura de archivo del repo, sin red. Un archivo ausente o sin `horarios`
    NO es un error: significa que la migración de #789 se completó y no hay
    autoridad estática que reportar."""
    observacion = {
        "ruta": RUTA_RELATIVA_CONOCIMIENTO,
        "entradas": 0,
        "categorias": [],
        "error": None,
    }
    ruta = Path(ruta)
    if not ruta.exists():
        return observacion
    try:
        datos = json.loads(ruta.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        # Solo el NOMBRE de la excepción: el texto de un OSError incluye la
        # ruta absoluta, que el contrato de redacción prohíbe emitir.
        return {
            **observacion,
            "entradas": None,
            "categorias": None,
            "error": (
                f"no se pudo leer {RUTA_RELATIVA_CONOCIMIENTO}: {type(exc).__name__}"
            ),
        }
    horarios = datos.get("horarios") if isinstance(datos, dict) else None
    if not isinstance(horarios, list):
        return observacion
    etiquetas = sorted(
        {
            horario["categoria"]
            for horario in horarios
            if isinstance(horario, dict) and isinstance(horario.get("categoria"), str)
        }
    )
    return {**observacion, "entradas": len(horarios), "categorias": etiquetas}


def observar() -> dict:
    """Recolecta los dos ejes. TODO el I/O del módulo vive acá y en los
    colectores; las decisiones de más abajo son puras."""
    return {
        "revision": observar_revision(),
        "catalogo": {
            "bff": observar_catalogo(URL_CATALOGO_BFF),
            "backend": observar_catalogo(URL_CATALOGO_BACKEND),
            "estaticos": observar_horarios_estaticos(RUTA_CONOCIMIENTO_CLUB),
        },
    }


def _hallazgo(clase: str, fuente: str, esperado: str, observado: str, detalle: str) -> dict:
    return {
        "clase": clase,
        "fuente": fuente,
        "esperado": esperado,
        "observado": observado,
        "detalle": detalle,
    }


def detectar_hallazgos_de_revision(observacion: dict) -> list[dict]:
    """Decisión PURA sobre una observación ya recolectada.

    Las dos fuentes se evalúan por separado: si ninguna se puede determinar,
    el reporte dice las dos cosas en vez de elegir una. La deriva solo se
    evalúa cuando AMBOS SHAs son conocidos — comparar contra un `None` o
    contra 'unknown' es exactamente el falso positivo que #899 elimina."""
    hallazgos: list[dict] = []

    fuente_servida = f"frontend {observacion['url_salud']}"
    if observacion["error_sha_servido"] is not None:
        hallazgos.append(
            _hallazgo(
                CLASE_REVISION_INDETERMINADA,
                fuente_servida,
                "un SHA de commit",
                OBSERVADO_SIN_RESPUESTA,
                observacion["error_sha_servido"],
            )
        )
    elif observacion["sha_servido"] == SHA_AUSENTE:
        hallazgos.append(
            _hallazgo(
                CLASE_REVISION_INDETERMINADA,
                fuente_servida,
                "un SHA de commit",
                SHA_AUSENTE,
                _DETALLE_SHA_AUSENTE,
            )
        )

    fuente_esperada = f"git {observacion['referencia_esperada']}"
    if observacion["error_sha_esperado"] is not None:
        hallazgos.append(
            _hallazgo(
                CLASE_REVISION_INDETERMINADA,
                fuente_esperada,
                f"el SHA de {observacion['referencia_esperada']}",
                OBSERVADO_SIN_RESPUESTA,
                observacion["error_sha_esperado"],
            )
        )

    if not hallazgos and observacion["sha_servido"] != observacion["sha_esperado"]:
        hallazgos.append(
            _hallazgo(
                CLASE_DERIVA,
                fuente_servida,
                observacion["sha_esperado"],
                observacion["sha_servido"],
                "El SHA servido no es la revisión esperada. Se comparó por "
                "igualdad contra "
                f"{observacion['referencia_esperada']} tal como está en el clon "
                "local, sin fetch.",
            )
        )

    return sorted(hallazgos, key=_clave_de_orden)


def _clave_de_orden(hallazgo: dict) -> tuple[str, str, str]:
    """Orden estable de los hallazgos: sin esto, dos corridas equivalentes
    podrían diferir solo en el orden y romper el determinismo."""
    return (hallazgo["clase"], hallazgo["fuente"], hallazgo["observado"])


def detectar_hallazgos_de_catalogo(observacion: dict) -> list[dict]:
    """Decisión PURA sobre una boca del catálogo ya observada.

    La distinción que importa: una fuente que no contestó (o contestó una
    forma inválida) es `dynamic_source_unavailable`, no datos faltantes. Un
    catálogo VACÍO PERO VÁLIDO sí es `missing_dynamic_data`: ahí el endpoint
    contestó perfecto y lo que falta son los datos."""
    fuente = f"catálogo {observacion['url']}"

    if observacion["error"] is not None:
        return [
            _hallazgo(
                CLASE_FUENTE_INDISPONIBLE,
                fuente,
                "un catálogo de horarios con la forma publicada",
                OBSERVADO_SIN_RESPUESTA,
                observacion["error"],
            )
        ]

    if observacion["total_categorias"] == 0:
        return [
            _hallazgo(
                CLASE_DATOS_FALTANTES,
                fuente,
                "al menos una categoría publicada",
                "0 categorías",
                "La fuente contestó bien y el catálogo está vacío: es un "
                "problema de datos, no de disponibilidad. El club no tiene "
                "horarios cargados, o no están publicados.",
            )
        ]

    hallazgos = []
    for categoria in observacion["categorias"]:
        renderizables = categoria["bloques_renderizables"]
        totales = categoria["bloques"]
        if categoria["renderizable"] and renderizables == totales:
            continue
        observado = f"«{categoria['etiqueta']}»: {renderizables} de {_frase_bloques(totales)}"
        if categoria["renderizable"]:
            detalle = (
                "La categoría se muestra INCOMPLETA: `mapBlock` descarta en "
                "silencio los bloques con un día fuera de DAY_LABELS, con "
                "`days` vacío o con horas que no matchean /^\\d{2}:\\d{2}$/."
            )
        else:
            detalle = (
                "La categoría DESAPARECE entera de la pantalla: "
                "`mapPublicSchedules` descarta toda categoría que se quede sin "
                "bloques renderizables. La respuesta HTTP se ve sana igual."
            )
        hallazgos.append(
            _hallazgo(
                CLASE_DATOS_FALTANTES,
                fuente,
                f"«{categoria['etiqueta']}» con {_frase_bloques(totales)}",
                observado,
                detalle,
            )
        )
    return sorted(hallazgos, key=_clave_de_orden)


def _frase_bloques(totales: int) -> str:
    """Concuerda el número con el sustantivo: este texto lo lee una persona
    operando bajo presión, no una máquina."""
    if totales == 1:
        return "1 bloque renderizable"
    return f"{totales} bloques renderizables"


def detectar_hallazgos_estaticos(observacion: dict) -> list[dict]:
    """Decisión PURA sobre la lista estática de horarios."""
    fuente = f"estático {observacion['ruta']}"

    if observacion["error"] is not None:
        return [
            _hallazgo(
                CLASE_FUENTE_INDISPONIBLE,
                fuente,
                "el catálogo estático legible",
                OBSERVADO_SIN_RESPUESTA,
                observacion["error"],
            )
        ]

    if not observacion["entradas"]:
        return []

    return [
        _hallazgo(
            CLASE_AUTORIDAD_ESTATICA,
            fuente,
            "ninguna lista estática de horarios sirviendo una superficie",
            f"{observacion['entradas']} entradas en horarios[]",
            "Todavía manda en: "
            + "; ".join(_SUPERFICIES_ESTATICAS)
            + ". #789 sacó la lista estática SOLO de la landing. Si estos "
            "horarios contradicen al catálogo dinámico, esas dos superficies "
            "muestran lo viejo. Esto se REPORTA, no se repara: completar la "
            "migración es #789, y #899 lo excluye de sus objetivos.",
        )
    ]


def construir_diagnostico(observacion: dict) -> dict:
    """Reporte completo de los dos ejes. `resumen` lista SIEMPRE las cinco
    clases, incluso en cero, para que la forma de la salida no dependa de los
    hallazgos."""
    catalogo = observacion["catalogo"]
    hallazgos = sorted(
        detectar_hallazgos_de_revision(observacion["revision"])
        + detectar_hallazgos_de_catalogo(catalogo["bff"])
        + detectar_hallazgos_de_catalogo(catalogo["backend"])
        + detectar_hallazgos_estaticos(catalogo["estaticos"]),
        key=_clave_de_orden,
    )
    return {
        "issue": 899,
        "ejes": ["revision", "catalogo"],
        "revision": observacion["revision"],
        "catalogo": catalogo,
        "hallazgos": hallazgos,
        "resumen": {
            clase: sum(1 for h in hallazgos if h["clase"] == clase) for clase in CLASES
        },
    }


def formatear_json(diagnostico: dict) -> str:
    return json.dumps(diagnostico, ensure_ascii=False, indent=2, sort_keys=True)


def _linea_de_catalogo(observacion: dict) -> str:
    if observacion["error"] is not None:
        return f"  {observacion['url']}: {OBSERVADO_SIN_RESPUESTA}"
    return (
        f"  {observacion['url']}: {observacion['total_categorias']} categorías, "
        f"{observacion['categorias_renderizables']} renderizables"
    )


def formatear_texto(diagnostico: dict) -> str:
    revision = diagnostico["revision"]
    catalogo = diagnostico["catalogo"]
    estaticos = catalogo["estaticos"]
    lineas = [
        "Diagnóstico de horarios (issue #899)",
        "",
        "REVISIÓN",
        f"  esperado ({revision['referencia_esperada']}): {revision['sha_esperado'] or '-'}",
        f"  servido  ({revision['url_salud']}): {revision['sha_servido'] or '-'}",
        f"  HEAD local (contexto): {revision['sha_head_local'] or '-'}",
        "",
        "CATÁLOGO",
        _linea_de_catalogo(catalogo["bff"]),
        _linea_de_catalogo(catalogo["backend"]),
        f"  {estaticos['ruta']}: "
        + (
            OBSERVADO_SIN_RESPUESTA
            if estaticos["error"] is not None
            else f"{estaticos['entradas']} entradas estáticas en horarios[]"
        ),
        "",
        "RESUMEN",
    ]
    for clase in CLASES:
        lineas.append(f"  {clase}: {diagnostico['resumen'][clase]}")
    lineas.append("")
    for hallazgo in diagnostico["hallazgos"]:
        lineas += [
            f"[{hallazgo['clase']}] {hallazgo['fuente']}",
            f"  esperado: {hallazgo['esperado']}",
            f"  observado: {hallazgo['observado']}",
            f"  detalle: {hallazgo['detalle']}",
        ]
    if not diagnostico["hallazgos"]:
        lineas.append("Sin hallazgos.")
    lineas += [
        "",
        "AVISO: las categorías 'renderizables' se cuentan con un ESPEJO en",
        "Python de mapBlock/mapPublicSchedules (schedule-data.ts). Si ese",
        "TypeScript cambia y este módulo no, el conteo queda desactualizado.",
        "Ver docs/operations/diagnostico-horarios.md para interpretar y escalar.",
    ]
    return "\n".join(lineas)


def main(argv: list[str] | None = None) -> int:
    # Código de salida SIEMPRE 0: esto es un inventario, no un gate.
    parser = argparse.ArgumentParser(
        description=(
            "Diagnóstico de solo lectura de la superficie de horarios "
            "(issue #899): distingue una revisión desplegada distinta de la "
            "esperada de un catálogo dinámico vacío o incompleto. Solo "
            "consulta URLs loopback fijas. No escribe ni repara nada."
        )
    )
    parser.add_argument("--json", action="store_true", help="Salida en JSON.")
    args = parser.parse_args(argv)

    diagnostico = construir_diagnostico(observar())
    print(formatear_json(diagnostico) if args.json else formatear_texto(diagnostico))
    return 0


if __name__ == "__main__":
    sys.exit(main())
