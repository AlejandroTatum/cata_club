"""
Diagnóstico de solo lectura de la superficie de horarios (issue #899) — eje
REVISIÓN: responde "¿qué código está corriendo?" y nada más.

Este archivo es la primera mitad del diagnóstico. La segunda (eje CATÁLOGO:
`missing_dynamic_data`, `dynamic_source_unavailable`,
`static_schedule_authority`) llega en el PR encadenado, junto con el runbook
`docs/operations/diagnostico-horarios.md`. Los dos ejes son independientes a
propósito: "qué código corre" y "qué datos sirve" son preguntas distintas, y
mezclarlas manda al operador a mirar el lugar equivocado.

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

  revision_drift        El SHA servido difiere de la revisión esperada. Se
                        puede determinar la revisión, y está mal.
  revision_unavailable  La revisión NO se pudo determinar: `sha: "unknown"`,
                        el endpoint no respondió, o falta el campo. No es
                        deriva. La distinción "no sé" contra "sé, y está mal"
                        es el valor entero de este diagnóstico; un inventario
                        que no puede decir "no sé" termina adivinando.

La comparación es por IGUALDAD, no por ancestría: el objeto del SHA servido
puede no existir en el clon local (se construyó en CI), así que `git
merge-base` no es una pregunta que se pueda contestar acá.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import urllib.request
from urllib.parse import urlparse

CLASE_DERIVA = "revision_drift"
CLASE_REVISION_INDETERMINADA = "revision_unavailable"

ANFITRIONES_LOOPBACK_PERMITIDOS = frozenset({"localhost", "127.0.0.1", "::1"})

# URL fija, jamás tomada de argv: un valor de CLI acá sería en sí mismo una
# fuente de SSRF (regla S5144 de Sonar), no algo a validar después. Es la
# misma dirección que sirve `make qa-up` (docker-compose.override.yml).
URL_SALUD_FRONTEND = "http://localhost:3000/api/health"

REFERENCIA_ESPERADA = "origin/main"

# Lo que `/api/health` responde cuando `BUILD_SHA` no llegó a la imagen.
SHA_AUSENTE = "unknown"

_DETALLE_SHA_AUSENTE = (
    "El frontend responde, pero BUILD_SHA no llegó a la imagen: "
    "docker-compose.override.yml es el ÚNICO compose que lo pasa, así que una "
    "imagen de producción siempre reporta 'unknown'. No es deriva — la "
    "revisión no se puede determinar desde acá."
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
                "sin respuesta utilizable",
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
                "sin respuesta utilizable",
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

    return sorted(hallazgos, key=lambda h: (h["clase"], h["fuente"], h["observado"]))


def construir_diagnostico(observacion: dict) -> dict:
    """Reporte completo. `resumen` lista SIEMPRE las dos clases, incluso en
    cero, para que la forma de la salida no dependa de los hallazgos."""
    hallazgos = detectar_hallazgos_de_revision(observacion)
    return {
        "issue": 899,
        "eje": "revision",
        "revision": observacion,
        "hallazgos": hallazgos,
        "resumen": {
            clase: sum(1 for h in hallazgos if h["clase"] == clase)
            for clase in (CLASE_DERIVA, CLASE_REVISION_INDETERMINADA)
        },
    }


def formatear_json(diagnostico: dict) -> str:
    return json.dumps(diagnostico, ensure_ascii=False, indent=2, sort_keys=True)


def formatear_texto(diagnostico: dict) -> str:
    revision = diagnostico["revision"]
    lineas = [
        "Diagnóstico de horarios — eje revisión (issue #899)",
        "",
        f"  esperado ({revision['referencia_esperada']}): {revision['sha_esperado'] or '-'}",
        f"  servido  ({revision['url_salud']}): {revision['sha_servido'] or '-'}",
        f"  HEAD local (contexto): {revision['sha_head_local'] or '-'}",
        "",
    ]
    for clase, cantidad in sorted(diagnostico["resumen"].items()):
        lineas.append(f"{clase}: {cantidad}")
    lineas.append("")
    for hallazgo in diagnostico["hallazgos"]:
        lineas += [
            f"[{hallazgo['clase']}] {hallazgo['fuente']}",
            f"  esperado: {hallazgo['esperado']}",
            f"  observado: {hallazgo['observado']}",
            f"  detalle: {hallazgo['detalle']}",
        ]
    if not diagnostico["hallazgos"]:
        lineas.append("Sin hallazgos en el eje revisión.")
    lineas += [
        "",
        "AVISO: este eje NO dice nada sobre los datos que sirve esa revisión.",
        "Un catálogo de horarios vacío con la revisión correcta es otro",
        "problema, con sus propias clases de hallazgo.",
    ]
    return "\n".join(lineas)


def main(argv: list[str] | None = None) -> int:
    # Código de salida SIEMPRE 0: esto es un inventario, no un gate.
    parser = argparse.ArgumentParser(
        description=(
            "Diagnóstico de solo lectura del eje revisión de la superficie de "
            f"horarios (issue #899). Siempre consulta {URL_SALUD_FRONTEND}, la "
            "URL loopback fija. No escribe ni repara nada."
        )
    )
    parser.add_argument("--json", action="store_true", help="Salida en JSON.")
    args = parser.parse_args(argv)

    diagnostico = construir_diagnostico(observar_revision())
    print(formatear_json(diagnostico) if args.json else formatear_texto(diagnostico))
    return 0


if __name__ == "__main__":
    sys.exit(main())
