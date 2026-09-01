"""El contrato de rutas entre el BFF de Next y los routers de FastAPI (issue #900).

El BFF nunca escribe `/api/v1`: ese tramo vive en `BACKEND_API_URL`
(`frontend/src/lib/server/auth.ts`). Cada handler pasa una ruta **relativa** a
ese prefijo, y del lado del backend la misma cadena es
`APIRouter(prefix=...)` más la ruta del decorador. Las dos mitades tienen que
coincidir exactamente: esa igualdad es lo que este gate compara.

El gate corre offline. No importa la aplicación FastAPI, no abre Postgres y no
levanta el frontend: la suite de raíz corre sin bloque `env:` en CI. Lee los
routers y los handlers como texto, igual que `tests/test_glossary_contract.py`
lee el glosario y que `tipo-notificacion-parity.test.ts` lee el enum.

Alcance: **rutas**. Los enums y los campos obligatorios del contrato son el
issue hermano (PR 2) y no se verifican acá.
"""

import re
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[1]
ROUTERS = RAIZ / "backend" / "app" / "presentacion" / "routers"
MONTAJE = RAIZ / "backend" / "main.py"
RUTAS_BFF = RAIZ / "frontend" / "src" / "app" / "api"
SERVIDOR = RAIZ / "frontend" / "src" / "lib" / "server"
CONTRATO = RAIZ / "docs" / "operations" / "bff-contract.md"

# El prefijo de montaje no participa de la comparación: las dos mitades que se
# comparan son relativas a él. Se verifica aparte que el montaje sea uniforme.
PREFIJO_MONTAJE = "/api/v1"

# Los ayudantes por los que el BFF habla con el backend. Anclar a ellos es lo
# que evita que la prosa de un JSDoc (`/trainer/attendance`, `/personas/{id}`)
# entre como si fuera una ruta consumida.
AYUDANTES = (
    "backendFetch",
    "backendFetchAuthed",
    "proxyToBackend",
    "proxyBackendGet",
    "proxyBackendPdfGet",
    "publicCatalogGet",
    "backendUrl",
    "fetchAllPages",
    "proxyMembresiaAction",
    "anonymousAuthPost",
)

# Dos ayudantes (`postCatalogResource`, `patchCatalogResource`) no reciben la
# ruta como argumento posicional sino dentro de un objeto de opciones. Ahí el
# ancla es la propiedad, no la llamada.
PROPIEDADES_DE_RUTA = ("backendPath", "buildPath")

# Los archivos cuyo trabajo *es* reenviar una ruta recibida por parámetro. Ahí
# una llamada sin literal es correcta; en un handler de `app/api` sería una ruta
# que este gate no puede ver.
CAPA_DE_AYUDANTES = frozenset(
    {"backend-client.ts", "bff-helpers.ts", "paged-fetch.ts", "proxy-membresia-action.ts"}
)

PARAMETRO = "{param}"

# Pisos del propio parser: si una expresión regular se rompe y deja de matchear,
# el gate quedaría verde por vacío. Un piso global no alcanza, porque perder una
# superficie entera (las 3 URL crudas, o los 10 sitios de `lib/server`) se
# escondería detrás de los ~98 de `route.ts`. Por eso el piso es por superficie.
# Los números son holgados respecto de lo medido: detectan un parser roto, no
# congelan el inventario.
PISOS = {
    "backend:routers": 80,
    "bff:handlers": 85,
    "bff:servidor": 8,
    "bff:url-cruda": 3,
}

_DECORADOR = re.compile(r"@router\.(?:get|post|put|patch|delete)\(")
_PREFIJO_ROUTER = re.compile(r'APIRouter\(\s*prefix="([^"]+)"')
_MONTAJE_ROUTER = re.compile(r'include_router\(\s*(\w+)\.router,\s*prefix="([^"]+)"')
# Mismo delimitador de apertura y cierre, sin saltos de línea: una ruta es un
# literal de una sola línea, con comillas o con backticks.
_LITERAL = re.compile(r'(?P<c>["`])(?P<ruta>/[^"`\n]*)(?P=c)')
# El `<T>` opcional es el argumento de tipo de `fetchAllPages<BackendPagoListItem>(`.
_LLAMADA = re.compile(
    r"(?<!function )\b(?:" + "|".join(AYUDANTES) + r")(?:<[^<>()]*>)?\s*\("
)
_PROPIEDAD = re.compile(r"\b(?:" + "|".join(PROPIEDADES_DE_RUTA) + r")\s*:")
# Las tres llamadas que arman la URL a mano y esquivan los ayudantes.
_BASE_CRUDA = re.compile(r"\$\{getBackendApiUrl\(\)\}(?P<ruta>/[^`\n]*)")
# El guardián del guardián: todo ayudante exportado que reciba una ruta.
_EXPORTADA = re.compile(r"export\s+(?:async\s+)?function\s+(\w+)\s*(?:<[^<>]*>)?\s*\(")
_PARAMETRO_RUTA = re.compile(r"\b\w*[Pp]ath\s*:\s*string")
_SEGMENTO_INTERPOLADO = re.compile(r"(?<=/)\$\{[^{}]*\}(?=/|$)")
_SUFIJO_INTERPOLADO = re.compile(r"\$\{[^{}]*\}.*$")
_PARAMETRO_DECLARADO = re.compile(r"\{[^{}]*\}")


def _fin_de_ventana(texto: str, desde: int, lineas: int) -> int:
    """El índice hasta donde se busca el literal de ruta de una llamada."""
    fin = desde
    for _ in range(lineas):
        salto = texto.find("\n", fin)
        if salto < 0:
            return len(texto)
        fin = salto + 1
    return fin


def normalizar_consumida(bruta: str) -> str:
    """Lleva una ruta consumida por el BFF a su forma comparable.

    Recorta desde el primer `?`, reemplaza por un marcador toda interpolación
    que ocupe un segmento entero (`/personas/${personaId}` es un parámetro de
    ruta) y descarta la interpolación que se pega a un segmento sin barra
    (`/membresias/mias${query}` es un sufijo de query, no un segmento).
    """
    ruta = bruta.split("?", 1)[0]
    ruta = _SEGMENTO_INTERPOLADO.sub(PARAMETRO, ruta)
    return _SUFIJO_INTERPOLADO.sub("", ruta)


def normalizar_declarada(bruta: str) -> str:
    """El backend nombra sus parámetros (`{codigo}`) y el BFF interpola valores.

    Se comparan posiciones, no nombres: los dos lados colapsan al mismo marcador.
    """
    return _PARAMETRO_DECLARADO.sub(PARAMETRO, bruta)


def rutas_declaradas(fuente: str) -> set[str]:
    """Las rutas que declara un router, leídas del texto del archivo.

    El decorador aparece en dos formas: la ruta va en la misma línea que
    `@router.get(` o en la siguiente. Se busca el primer literal de ruta dentro
    de esa ventana.
    """
    prefijo = _PREFIJO_ROUTER.search(fuente)
    if prefijo is None:
        return set()
    declaradas = set()
    for decorador in _DECORADOR.finditer(fuente):
        ventana = _fin_de_ventana(fuente, decorador.end(), 2)
        literal = _LITERAL.search(fuente, decorador.end(), ventana)
        if literal is not None:
            declaradas.add(normalizar_declarada(prefijo.group(1) + literal.group("ruta")))
    return declaradas


def rutas_consumidas(fuente: str) -> tuple[list[str], int]:
    """Las rutas que consume un archivo del BFF, más las llamadas opacas.

    Una llamada es opaca cuando su ruta no es un literal sino una variable: el
    gate no puede verla y se cuenta aparte para que no desaparezca en silencio.
    """
    rutas = [normalizar_consumida(cruda.group("ruta")) for cruda in _BASE_CRUDA.finditer(fuente)]
    for propiedad in _PROPIEDAD.finditer(fuente):
        literal = _LITERAL.search(fuente, propiedad.end(), _fin_de_ventana(fuente, propiedad.end(), 1))
        if literal is not None:
            rutas.append(normalizar_consumida(literal.group("ruta")))
    opacas = 0
    for llamada in _LLAMADA.finditer(fuente):
        ventana = _fin_de_ventana(fuente, llamada.end(), 4)
        literal = _LITERAL.search(fuente, llamada.end(), ventana)
        if literal is None:
            opacas += 1
        else:
            rutas.append(normalizar_consumida(literal.group("ruta")))
    return rutas, opacas


def ayudantes_con_ruta() -> set[str]:
    """Los ayudantes exportados de `lib/server` que reciben una ruta.

    Es el guardián del guardián por el lado de la cobertura: si alguien agrega
    un ayudante nuevo con un parámetro `path`/`backendPath` y no lo declara en
    `AYUDANTES`, sus llamadas quedarían fuera del gate sin que nada avise.
    """
    encontrados = set()
    for archivo in SERVIDOR.glob("*.ts"):
        fuente = archivo.read_text(encoding="utf-8")
        for exportada in _EXPORTADA.finditer(fuente):
            if _PARAMETRO_RUTA.search(_lista_de_parametros(fuente, exportada.end() - 1)):
                encontrados.add(exportada.group(1))
    return encontrados


def _lista_de_parametros(texto: str, apertura: int) -> str:
    """El texto entre el paréntesis de apertura de una firma y su cierre."""
    profundidad = 0
    for indice in range(apertura, len(texto)):
        profundidad += (texto[indice] == "(") - (texto[indice] == ")")
        if profundidad == 0:
            return texto[apertura : indice + 1]
    return texto[apertura:]


def verificar_cobertura(consumos: list[tuple[str, str]], declaradas: set[str]) -> None:
    """El gate: toda ruta consumida por el BFF tiene que estar declarada.

    Falla nombrando la ruta y el archivo que la consume, en orden estable.
    Un conjunto vacío de cualquiera de los dos lados también falla: sin eso el
    gate quedaría verde por no haber comparado nada.
    """
    assert consumos, "conjunto de rutas consumidas vacío"
    assert declaradas, "conjunto de rutas declaradas vacío"
    huerfanas = sorted({par for par in consumos if par[0] not in declaradas})
    detalle = "\n".join(f"  {ruta}  ←  {archivo}" for ruta, archivo in huerfanas)
    assert not huerfanas, f"el BFF consume rutas que ningún router declara:\n{detalle}"


@pytest.fixture(scope="module")
def declaradas() -> set[str]:
    return {
        ruta
        for archivo in sorted(ROUTERS.glob("*_router.py"))
        for ruta in rutas_declaradas(archivo.read_text(encoding="utf-8"))
    }


def archivos_bff() -> list[Path]:
    """Los archivos del BFF que el gate lee: los handlers y la capa de servidor."""
    return sorted([*RUTAS_BFF.rglob("route.ts"), *SERVIDOR.glob("*.ts")])


def inventario_bff() -> tuple[list[tuple[str, str]], list[str]]:
    pares: list[tuple[str, str]] = []
    sitios_opacos: list[str] = []
    for archivo in archivos_bff():
        rutas, opacas = rutas_consumidas(archivo.read_text(encoding="utf-8"))
        nombre = str(archivo.relative_to(RAIZ))
        pares.extend((ruta, nombre) for ruta in rutas)
        sitios_opacos.extend([nombre] * opacas)
    return pares, sitios_opacos


def conteo_por_superficie(consumos: list[tuple[str, str]], declaradas: set[str]) -> dict[str, int]:
    """Lo extraído de cada superficie por separado.

    `bff:url-cruda` se solapa con `bff:handlers` a propósito: son las mismas
    tres llamadas de `route.ts`, contadas aparte porque son las que esquivan a
    los ayudantes y desaparecerían sin ruido detrás del resto.
    """
    return {
        "backend:routers": len(declaradas),
        "bff:handlers": sum(1 for _, archivo in consumos if "/app/api/" in archivo),
        "bff:servidor": sum(1 for _, archivo in consumos if "/lib/server/" in archivo),
        "bff:url-cruda": sum(
            len(_BASE_CRUDA.findall(archivo.read_text(encoding="utf-8")))
            for archivo in archivos_bff()
        ),
    }


@pytest.fixture(scope="module")
def consumos() -> list[tuple[str, str]]:
    return inventario_bff()[0]


@pytest.fixture(scope="module")
def opacas() -> list[str]:
    return inventario_bff()[1]


class TestMontaje:
    """La premisa del gate: las dos mitades se comparan porque el montaje es uniforme."""

    def test_todos_los_routers_se_montan_bajo_el_mismo_prefijo(self):
        montajes = _MONTAJE_ROUTER.findall(MONTAJE.read_text(encoding="utf-8"))
        assert montajes, "no se leyó ningún include_router en backend/main.py"
        assert {prefijo for _, prefijo in montajes} == {PREFIJO_MONTAJE}

    def test_se_monta_exactamente_un_router_por_archivo_de_router(self):
        montajes = _MONTAJE_ROUTER.findall(MONTAJE.read_text(encoding="utf-8"))
        montados = {nombre for nombre, _ in montajes}
        assert montados == {archivo.stem for archivo in ROUTERS.glob("*_router.py")}

    def test_el_bff_nunca_escribe_el_prefijo_de_montaje(self, consumos):
        escritas = sorted({par for par in consumos if par[0].startswith(PREFIJO_MONTAJE)})
        assert not escritas, f"rutas que duplican {PREFIJO_MONTAJE}: {escritas}"


class TestCobertura:
    def test_toda_ruta_consumida_por_el_bff_esta_declarada(self, consumos, declaradas):
        verificar_cobertura(consumos, declaradas)

    def test_ningun_handler_arma_su_ruta_con_una_variable(self, opacas):
        fuera = sorted({sitio for sitio in opacas if Path(sitio).name not in CAPA_DE_AYUDANTES})
        assert not fuera, f"rutas no literales, invisibles para el gate: {fuera}"

    def test_la_capa_de_ayudantes_sigue_siendo_la_unica_que_reenvia_rutas(self, opacas):
        assert {Path(sitio).name for sitio in opacas} == CAPA_DE_AYUDANTES

    def test_ningun_ayudante_con_ruta_queda_fuera_del_ancla(self):
        sin_anclar = sorted(ayudantes_con_ruta() - set(AYUDANTES))
        assert not sin_anclar, f"ayudantes que reciben una ruta y el gate no mira: {sin_anclar}"

    def test_las_rutas_no_consumidas_quedan_libres_de_cambiar(self, consumos, declaradas):
        libres = declaradas - {ruta for ruta, _ in consumos}
        assert libres, "sin rutas no consumidas el permiso de cambio sería vacío"
        verificar_cobertura(consumos, declaradas - libres)


class TestElGateNoEsVacio:
    """Las triangulaciones del issue #900, como regresión permanente."""

    def test_una_ruta_consumida_sin_declaracion_pone_el_gate_rojo(self, consumos, declaradas):
        inventada = [*consumos, ("/asistencias/inventada", "frontend/src/app/api/x/route.ts")]
        with pytest.raises(AssertionError, match="ningún router declara"):
            verificar_cobertura(inventada, declaradas)

    def test_el_fallo_nombra_la_ruta_y_el_archivo_que_la_consume(self, declaradas):
        with pytest.raises(AssertionError, match=r"/asistencias/inventada.*route\.ts"):
            verificar_cobertura([("/asistencias/inventada", "app/api/x/route.ts")], declaradas)

    def test_borrar_una_ruta_no_consumida_no_pone_el_gate_rojo(self, consumos, declaradas):
        libres = declaradas - {ruta for ruta, _ in consumos}
        verificar_cobertura(consumos, declaradas - {sorted(libres)[0]})

    def test_renombrar_una_ruta_no_consumida_no_pone_el_gate_rojo(self, consumos, declaradas):
        libres = declaradas - {ruta for ruta, _ in consumos}
        renombrada = declaradas - {sorted(libres)[0]} | {"/asistencias/otro-nombre-cualquiera"}
        verificar_cobertura(consumos, renombrada)

    def test_un_conjunto_de_consumos_vacio_falla(self, declaradas):
        with pytest.raises(AssertionError, match="consumidas vacío"):
            verificar_cobertura([], declaradas)

    def test_un_conjunto_de_declaradas_vacio_falla(self, consumos):
        with pytest.raises(AssertionError, match="declaradas vacío"):
            verificar_cobertura(consumos, set())

    def test_un_parser_de_routers_roto_no_declara_nada(self):
        assert rutas_declaradas('router = APIRouter(prefix="/x")\n@router.obtener("/y")\n') == set()

    def test_un_parser_del_bff_roto_no_consume_nada(self):
        assert rutas_consumidas('await traerDelBackend("/asistencias/horarios");\n') == ([], 0)

    def test_ninguna_superficie_cae_por_debajo_de_su_piso(self, consumos, declaradas):
        medido = conteo_por_superficie(consumos, declaradas)
        flojas = {nombre: medido[nombre] for nombre, piso in PISOS.items() if medido[nombre] < piso}
        assert not flojas, f"parser roto o superficie perdida: {flojas} (pisos {PISOS})"


class TestNormalizacion:
    def test_un_segmento_interpolado_es_un_parametro_de_ruta(self):
        assert normalizar_consumida("/personas/${personaId}/foto") == "/personas/{param}/foto"

    def test_un_parametro_declarado_colapsa_al_mismo_marcador(self):
        assert normalizar_declarada("/personas/{persona_id}/foto") == "/personas/{param}/foto"

    def test_una_interpolacion_final_sin_barra_es_un_sufijo_de_query(self):
        assert normalizar_consumida("/membresias/mias${query}") == "/membresias/mias"

    def test_la_query_literal_se_recorta_desde_el_primer_signo(self):
        assert normalizar_consumida("/personas/?limit=${LIMITE}") == "/personas/"

    def test_la_ruta_raiz_de_un_router_conserva_su_barra(self):
        declaradas = rutas_declaradas('router = APIRouter(prefix="/sponsors")\n@router.get("/")\n')
        assert declaradas == {"/sponsors/"}

    def test_el_decorador_multilinea_declara_igual_que_el_de_una_linea(self):
        fuente = 'router = APIRouter(prefix="/asistencias")\n@router.get(\n    "/categorias",\n)\n'
        assert rutas_declaradas(fuente) == {"/asistencias/categorias"}

    def test_una_llamada_multilinea_consume_igual_que_la_de_una_linea(self):
        fuente = 'proxyBackendPdfGet(\n  request,\n  `/asistencias/reportes/pdf${q}`,\n)\n'
        assert rutas_consumidas(fuente) == (["/asistencias/reportes/pdf"], 0)

    def test_una_url_armada_a_mano_tambien_se_consume(self):
        fuente = "fetch(`${getBackendApiUrl()}/chatbot/consultar`, {\n"
        assert rutas_consumidas(fuente) == (["/chatbot/consultar"], 0)

    def test_una_llamada_con_ruta_variable_se_cuenta_como_opaca(self):
        assert rutas_consumidas("fetch(backendUrl(path), {\n  method: init.method,\n});\n")[1] == 1

    def test_la_prosa_de_un_jsdoc_no_entra_como_ruta_consumida(self):
        assert rutas_consumidas("/** Ver `/trainer/attendance` y `/personas/{id}`. */\n") == ([], 0)


class TestContratoDocumentado:
    def test_el_contrato_operativo_documenta_las_tres_superficies(self):
        contrato = CONTRATO.read_text(encoding="utf-8")
        for evidencia in ("BACKEND_API_URL", "app/api", "lib/server", *AYUDANTES):
            assert evidencia in contrato, evidencia

    def test_el_contrato_declara_de_que_gate_es_continuacion(self):
        contrato = CONTRATO.read_text(encoding="utf-8")
        assert "glossary-contract.md" in contrato
        assert "#903" in contrato and "#900" in contrato
