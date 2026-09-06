"""
Paridad de rutas: lo que el frontend consume contra lo que FastAPI sirve
(issue #792, criterio de cierre 1).

CI corre dos suites que nunca se leen entre sí: los tests del backend pasan
contra la ruta NUEVA con `TestClient`, los del frontend pasan contra un
`fetch` simulado con la ruta VIEJA hardcodeada. Ninguno de los dos falla si
alguien renombra una ruta — verde en ambos lados, 404 en producción.

Este archivo lee el límite de lenguaje en las dos direcciones, igual que
`tipo-notificacion-parity.test.ts` lo hace para los enums:

1. Extrae, de TypeScript, cada string `/api/v1/...` que el frontend arma
   para llamar al backend — tanto el código de producción (`src/app/api/**`,
   `src/lib/server/**`) como los strings que los tests del frontend afirman
   contra un `fetch` mockeado. Son dos costuras distintas: una rompe con un
   404 real, la otra deja pasar un test verde contra un mock desactualizado
   — el criterio de cierre pide cubrir ambas.
2. Lee `app.openapi()["paths"]` de la app real de pruebas (mismo patrón que
   `test_configuracion.py::test_openapi_sigue_sirviendose_en_la_app_de_pruebas`).
3. Compara cada ruta extraída, segmento por segmento, contra las plantillas
   de OpenAPI (`{persona_id}` matchea cualquier segmento).

La dirección inversa —rutas del backend que el frontend nunca llama— es
legítima (endpoints públicos, scripts de administración) y no se afirma
aquí, solo se reporta.
"""
from __future__ import annotations

import difflib
import os
import re
from dataclasses import dataclass
from pathlib import Path

from main import app

# ---------------------------------------------------------------------------
# Ubicación de los fuentes, resuelta desde este archivo — nunca desde cwd
# (ver `frontend/src/types/__tests__/tipo-notificacion-parity.test.ts`, que
# resuelve `REPO_ROOT` del mismo modo desde `__dirname`).
# ---------------------------------------------------------------------------
_THIS_FILE = Path(__file__).resolve()
REPO_ROOT = _THIS_FILE.parents[2]
FRONTEND_SRC = REPO_ROOT / "frontend" / "src"
FRONTEND_ROOT = REPO_ROOT / "frontend"

# Los únicos lugares donde el BFF arma una URL de backend (ver
# `src/lib/server/bff-helpers.ts`, `backend-client.ts`, `auth.ts`,
# `paged-fetch.ts`, `proxy-membresia-action.ts`): cada uno de estos nombres
# recibe el path del backend como literal en su sitio de llamada. Si un sitio
# nuevo arma una URL por fuera de esta lista, `test_el_parser_encuentra_rutas_de_produccion`
# es la que se entera primero — cae por debajo del piso y avisa.
_KNOWN_BACKEND_CALL_FUNCS = (
    "backendFetch",
    "backendFetchAuthed",
    "backendUrl",
    "proxyToBackend",
    "publicCatalogGet",
    "anonymousAuthPost",
    "proxyMembresiaAction",
    "fetchAllPages",
    "proxyBackendGet",
    "proxyBackendPdfGet",
)

# Expresiones `${...}` que —por convención del repo— siempre representan un
# query string YA armado con su propio `?` (o vacío), nunca un segmento de
# ruta. La convención real es que un id de ruta siempre está precedido por
# `/` directo (`/${id}`); estas son las únicas excepciones observadas, donde
# el `${...}` queda pegado al segmento anterior sin `/` de por medio.
# `test_el_allowlist_de_sufijos_de_query_sigue_haciendo_falta` falla si
# alguna deja de usarse — así esta lista no puede quedarse desactualizada.
_QUERY_SUFFIX_EXPRESSIONS = ("query", "queryString", "suffix", "request.nextUrl.search")

# Expresiones `${...}` que abren un literal y nombran la base de un servicio
# AJENO al backend de la app. La premisa de este archivo -- que todo
# `/api/v1/...` en un test del frontend apunta a nuestro backend -- es cierta
# salvo acá: Mailpit, el buzón del stack de QA, sirve su propia API bajo el
# mismo prefijo `/api/v1` (`/api/v1/search`, `/api/v1/messages`). Sin esta
# lista, un helper que lee correo desde un spec live hace fallar el test
# afirmando que el frontend consume rutas que el backend no expone -- y tiene
# razón: no las expone, son de otro servicio.
#
# Solo se saltean los literales que EMPIEZAN con `${<nombre>}`, o sea los que
# nombran la base explícitamente. Una ruta nuestra escrita a secas
# (`/api/v1/auth/login`) sigue verificándose igual.
# `test_el_allowlist_de_bases_ajenas_sigue_haciendo_falta` falla si alguna
# deja de usarse, para que esta lista no se quede desactualizada.
_BASES_DE_SERVICIOS_AJENOS = ("MAILPIT_BASE_URL",)

_LITERAL = r'(?:`([^`]*)`|"([^"]*)"|\'([^\']*)\')'
_BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.DOTALL)


def _strip_block_comments(text: str) -> str:
    """Removes `/** ... */` docblocks before scanning for literals.

    Without this, a JSDoc comment that mentions a route in backticks for
    documentation purposes (e.g. `` `POST /api/v1/enrollment/` `` inside a
    `/** ... */` block) is indistinguishable from real code to a regex.
    Preserves line numbers by replacing the comment with the same number of
    newlines it contained.
    """
    return _BLOCK_COMMENT.sub(lambda m: "\n" * m.group(0).count("\n"), text)


def _literal_group(match: re.Match) -> str:
    return next(g for g in match.groups() if g is not None)


@dataclass(frozen=True)
class RutaEncontrada:
    """A `/...` path literal found in a TypeScript source, with its origin."""

    literal: str
    archivo: str
    linea: int
    origen: str  # "producción" | "test"

    def ubicacion(self) -> str:
        return f"{self.archivo}:{self.linea}"


def _extraer_rutas_de_produccion() -> list[RutaEncontrada]:
    """Every backend path literal the BFF actually sends, from its own call
    sites (`src/app/api/**/route.ts`, `src/lib/server/*.ts`) — not from the
    shared helpers' own bodies, which take `path` as a parameter."""
    dirs = [FRONTEND_SRC / "app" / "api", FRONTEND_SRC / "lib" / "server"]
    archivos: list[Path] = []
    for d in dirs:
        archivos.extend(sorted(d.rglob("*.ts")))
    archivos = [
        f for f in archivos
        if "__tests__" not in f.parts and not f.name.endswith(".test.ts")
    ]

    llamada_re = re.compile(
        r"(?<!function )(?:" + "|".join(re.escape(n) for n in _KNOWN_BACKEND_CALL_FUNCS) + r")"
        r"\s*(?:<[^>]*>)?\s*\(\s*(?:request\s*,\s*)?" + _LITERAL
    )
    get_backend_url_re = re.compile(r"`\$\{getBackendApiUrl\(\)\}([^`]*)`")
    backend_path_key_re = re.compile(r"backendPath:\s*" + _LITERAL)
    build_path_key_re = re.compile(r"buildPath:\s*\([^)]*\)\s*=>\s*" + _LITERAL)

    encontradas: list[RutaEncontrada] = []
    for archivo in archivos:
        texto = _strip_block_comments(archivo.read_text())
        rel = str(archivo.relative_to(REPO_ROOT))

        for regex in (llamada_re, backend_path_key_re, build_path_key_re):
            for m in regex.finditer(texto):
                literal = _literal_group(m)
                if not literal.startswith("/"):
                    continue
                linea = texto.count("\n", 0, m.start()) + 1
                encontradas.append(RutaEncontrada(literal, rel, linea, "producción"))

        for m in get_backend_url_re.finditer(texto):
            literal = m.group(1)
            if not literal.startswith("/"):
                continue
            linea = texto.count("\n", 0, m.start()) + 1
            encontradas.append(RutaEncontrada(literal, rel, linea, "producción"))

    return encontradas


def _extraer_rutas_de_tests() -> list[RutaEncontrada]:
    """Every `/api/v1/...` string a frontend TEST asserts against a mocked
    `fetch` — regardless of host (`http://localhost:8000/...`,
    `http://backend/...`), and regardless of whether it lives under
    `src/**/__tests__/**` or `frontend/tests/**`.

    La única excepción son los literales que empiezan nombrando la base de un
    servicio ajeno (`_BASES_DE_SERVICIOS_AJENOS`): esos `/api/v1/...` no son
    nuestros y no tienen por qué estar en `app.openapi()`."""
    archivos = sorted(FRONTEND_ROOT.rglob("*.ts")) + sorted(FRONTEND_ROOT.rglob("*.tsx"))
    archivos = [f for f in archivos if "node_modules" not in f.parts]
    archivos = [
        f for f in archivos
        if "__tests__" in f.parts
        or "/tests/" in str(f)
        or f.name.endswith((".test.ts", ".test.tsx", ".spec.ts"))
    ]

    literal_re = re.compile(r'[`"\']([^`"\']*api/v1/[^`"\']*)[`"\']')

    encontradas: list[RutaEncontrada] = []
    for archivo in archivos:
        texto = _strip_block_comments(archivo.read_text())
        rel = str(archivo.relative_to(REPO_ROOT))
        for m in literal_re.finditer(texto):
            crudo = m.group(1)
            if any(crudo.startswith("${" + nombre + "}") for nombre in _BASES_DE_SERVICIOS_AJENOS):
                continue
            idx = crudo.find("api/v1/")
            path = "/" + crudo[idx:]
            linea = texto.count("\n", 0, m.start()) + 1
            encontradas.append(RutaEncontrada(path, rel, linea, "test"))

    return encontradas


def _quitar_query_string(literal: str) -> str:
    """Strips everything from a literal `?` onward, then drops a trailing
    `${<query-suffix-expr>}` — the one shape a literal `?` can't catch,
    because the `?` lives inside the interpolated value, not the source."""
    if "?" in literal:
        literal = literal.split("?", 1)[0]
    for nombre in _QUERY_SUFFIX_EXPRESSIONS:
        token = "${" + nombre + "}"
        if literal.endswith(token):
            literal = literal[: -len(token)]
    return literal


def _ruta_completa(ruta: RutaEncontrada) -> str:
    """Frontend paths are bare (`/auth/login`) — `BACKEND_API_URL` supplies
    the `/api/v1` prefix at runtime (see `getBackendApiUrl` in `auth.ts`).
    Test literals already carry it in full (`http://host/api/v1/...`)."""
    sin_query = _quitar_query_string(ruta.literal)
    if ruta.origen == "test":
        return sin_query
    return "/api/v1" + sin_query


def _coincide_con_plantilla(segmentos_ruta: list[str], segmentos_plantilla: list[str]) -> bool:
    """A path matches an OpenAPI template segment-by-segment: equal literal
    segments, or the template segment is `{param}` — matching a concrete
    value (`"5"`, `"PREINFANTIL"`) from a test, or a `${...}`-normalized
    wildcard from production code, alike."""
    if len(segmentos_ruta) != len(segmentos_plantilla):
        return False
    for real, plantilla in zip(segmentos_ruta, segmentos_plantilla):
        if plantilla.startswith("{") and plantilla.endswith("}"):
            continue
        if real != plantilla:
            return False
    return True


def _rutas_openapi_v1() -> list[str]:
    with_test_env = os.environ.get("AMBIENTE") == "test"
    assert with_test_env, "Este archivo asume AMBIENTE=test (lo fija tests/conftest.py)."
    todas = app.openapi()["paths"].keys()
    return sorted(p for p in todas if p.startswith("/api/v1/"))


def _candidatos_cercanos(ruta: str, universo: list[str], n: int = 3) -> list[str]:
    return difflib.get_close_matches(ruta, universo, n=n, cutoff=0.4)


def _verificar_paridad(rutas: list[RutaEncontrada], openapi_paths: list[str]) -> None:
    """Shared comparison for both origins — same normalization, same
    matcher — with failures grouped by origin so the message says whether
    the offending string came from production code or from a test."""
    plantillas = [(p, p.split("/")) for p in openapi_paths]

    fallas: list[str] = []
    for ruta in rutas:
        completa = _ruta_completa(ruta)
        segmentos = completa.split("/")
        if any(_coincide_con_plantilla(segmentos, tsegs) for _, tsegs in plantillas):
            continue
        candidatos = _candidatos_cercanos(completa, openapi_paths)
        candidatos_txt = ", ".join(candidatos) if candidatos else "(ninguno parecido)"
        fallas.append(
            f"  [{ruta.origen}] {ruta.literal!r} -> {completa!r}\n"
            f"    en {ruta.ubicacion()}\n"
            f"    candidatos en openapi: {candidatos_txt}"
        )

    if fallas:
        cuerpo = "\n".join(fallas)
        raise AssertionError(
            f"{len(fallas)} ruta(s) que el frontend consume no existen en "
            f"app.openapi()[\"paths\"]:\n{cuerpo}\n\n"
            "Si el backend renombró la ruta, el frontend quedó apuntando al "
            "string viejo — CI pasaba en los dos lados y producción daría 404."
        )


# ---------------------------------------------------------------------------
# Guardas del parser — un regex roto dejaría la comparación real vacía en
# ambos lados y el test pasaría por accidente (mismo motivo que las dos
# primeras pruebas de tipo-notificacion-parity.test.ts).
# ---------------------------------------------------------------------------

def test_el_parser_encuentra_rutas_openapi():
    assert len(_rutas_openapi_v1()) >= 50


def test_el_parser_encuentra_rutas_de_produccion():
    rutas = _extraer_rutas_de_produccion()
    distintas = {_ruta_completa(r) for r in rutas}
    assert len(distintas) >= 50


def test_el_parser_encuentra_rutas_de_tests():
    rutas = _extraer_rutas_de_tests()
    distintas = {_ruta_completa(r) for r in rutas}
    assert len(distintas) >= 30


def test_el_allowlist_de_sufijos_de_query_sigue_haciendo_falta():
    """`_QUERY_SUFFIX_EXPRESSIONS` es la única lista "de confianza" de este
    archivo — un nombre que nadie usa ya es un nombre que hay que borrar,
    o deja de proteger nada y nadie se entera."""
    dirs = [FRONTEND_SRC / "app" / "api", FRONTEND_SRC / "lib" / "server"]
    texto_completo = "\n".join(
        f.read_text() for d in dirs for f in d.rglob("*.ts") if "__tests__" not in f.parts
    )
    sin_uso = [
        nombre for nombre in _QUERY_SUFFIX_EXPRESSIONS
        if ("${" + nombre + "}") not in texto_completo
    ]
    assert sin_uso == [], f"sufijos ya sin ningún uso real: {sin_uso}"


def test_el_allowlist_de_bases_ajenas_sigue_haciendo_falta():
    """Mismo criterio que el candado de arriba: una base ajena que ya nadie
    usa es un agujero abierto en la verificación sin que nadie se entere."""
    archivos = [
        f for f in sorted(FRONTEND_ROOT.rglob("*.ts"))
        if "node_modules" not in f.parts
    ]
    texto_completo = "\n".join(f.read_text() for f in archivos)
    sin_uso = [
        nombre for nombre in _BASES_DE_SERVICIOS_AJENOS
        if ("${" + nombre + "}") not in texto_completo
    ]
    assert sin_uso == [], f"bases ajenas ya sin ningún uso real: {sin_uso}"


# ---------------------------------------------------------------------------
# Dirección inversa — informativa, nunca se afirma (ver docstring del
# módulo): una ruta del backend que el frontend no llama es legítima
# (endpoint público, script de administración). No es un test aparte porque
# no hay nada que afirmar — solo se imprime, colgada de la corrida del test
# real de abajo, para no fabricar una aserción vacía solo para tener un
# `test_` que la muestre.
# ---------------------------------------------------------------------------

def _imprimir_rutas_del_backend_sin_llamar(rutas_encontradas: list[RutaEncontrada], openapi_paths: list[str]) -> None:
    llamadas = {_ruta_completa(r) for r in rutas_encontradas}
    plantillas_llamadas = [c.split("/") for c in llamadas]
    sin_llamar = [
        p for p in openapi_paths
        if not any(_coincide_con_plantilla(seg, p.split("/")) for seg in plantillas_llamadas)
    ]
    print(f"\nRutas de OpenAPI sin ninguna llamada encontrada en el frontend ({len(sin_llamar)}):")
    for p in sin_llamar:
        print(f"  {p}")


# ---------------------------------------------------------------------------
# La comparación real (criterio de cierre 1 del issue #792)
# ---------------------------------------------------------------------------

def test_las_rutas_de_produccion_existen_en_openapi():
    """El costurón real: si el backend renombra una ruta, este es el test
    que se entera — antes de que lo haga un 404 en producción."""
    rutas = _extraer_rutas_de_produccion()
    openapi_paths = _rutas_openapi_v1()
    todas_las_llamadas = rutas + _extraer_rutas_de_tests()
    _imprimir_rutas_del_backend_sin_llamar(todas_las_llamadas, openapi_paths)
    _verificar_paridad(rutas, openapi_paths)


def test_las_rutas_afirmadas_en_tests_del_frontend_existen_en_openapi():
    """El ángulo original del issue: un string `/api/v1/...` que un test del
    frontend afirma contra un `fetch` mockeado puede quedar viejo sin que
    ese test — ni ningún otro — se entere. `fetch` no sabe que el backend
    cambió; solo lo sabe `app.openapi()`."""
    _verificar_paridad(_extraer_rutas_de_tests(), _rutas_openapi_v1())
