"""El contrato entre el BFF de Next y los routers de FastAPI (issue #900).

El BFF nunca escribe `/api/v1`: ese tramo vive en `BACKEND_API_URL`
(`frontend/src/lib/server/auth.ts`). Cada handler pasa una ruta **relativa** a
ese prefijo, y del lado del backend la misma cadena es
`APIRouter(prefix=...)` más la ruta del decorador. Las dos mitades tienen que
coincidir exactamente: esa igualdad es lo que este gate compara.

El gate corre offline. No importa la aplicación FastAPI, no abre Postgres y no
levanta el frontend: la suite de raíz corre sin bloque `env:` en CI. Lee los
routers y los handlers como texto, igual que `tests/test_glossary_contract.py`
lee el glosario y que `tipo-notificacion-parity.test.ts` lee el enum.

El archivo tiene dos mitades. La primera compara **rutas**: toda ruta que el BFF
consume tiene que estar declarada por algún router. La segunda compara **lo que
viaja por esas rutas**: los enums compartidos y los campos que los validadores
del BFF exigen de cada DTO.

Las dos derivas que la biyección de enums encontró (issue #935: `SUSPENDIDA`
en `EstadoMembresia`, `REGULARIZACION` en `TipoPago`) están corregidas — el
frontend ya declara los dos valores y `DIVERGENCIAS_INVENTARIADAS` quedó
vacío. La mecánica del inventario sigue acá: la exención es por VALOR y nunca
por enum, para que una deriva futura en el mismo enum siga poniendo el gate en
rojo.
"""

import re
from pathlib import Path
from typing import NamedTuple

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
        assert "glossary-contract.md" in contrato, "no se cita el gate del glosario"
        assert "#903" in contrato, "no se cita el issue del gate del glosario"
        assert "#900" in contrato, "no se cita el issue de este gate"


# ===========================================================================
# Enums compartidos y campos obligatorios (PR 2 del issue #900)
# ===========================================================================
#
# Las rutas coinciden; lo que viaja por ellas es otro contrato. Los enums de
# `backend/app/dominio/enums.py` NO tienen todos la misma relación con el
# frontend, y un gate que asumiera una sola se equivocaría en la mayoría. Se
# declaran cuatro relaciones, explícitas:
#
#   (a) Identidad     — una unión de TypeScript nombra los mismos valores.
#   (b) Traducción    — un `Record<>` los lleva 1:1 a códigos de la aplicación.
#   (c) Muchos a uno  — el pliegue es una decisión documentada, no una deriva.
#   (d) Excluido / sin contraparte — la fuente de verdad no es el enum, o no
#       hay nada del otro lado del límite que lo consuma.
#
# Todo enum cae en exactamente una. Un enum nuevo sin clasificar pone el gate
# en rojo: esa es la parte que no envejece.

ENUMS = RAIZ / "backend" / "app" / "dominio" / "enums.py"
ESQUEMAS = RAIZ / "backend" / "app" / "presentacion" / "schemas"
FRONTEND = RAIZ / "frontend" / "src"


class ParDeEnum(NamedTuple):
    """(a) Un enum del backend y la declaración de TS que nombra sus mismos valores."""

    enum: str
    archivo: str
    declaracion: str


class MapaTraducido(NamedTuple):
    """(b) El par de `Record<>` que traduce un enum a códigos de la aplicación.

    Acá la biyección no es contra una unión con los valores del backend sino
    sobre el CONJUNTO DE CLAVES y el CONJUNTO DE VALORES del mapa: el frontend
    nunca ve `"LUNES"`, ve `"lun"`.
    """

    enum: str
    archivo: str
    mapa: str
    inverso: str
    union: str
    archivo_union: str


class Divergencia(NamedTuple):
    """Una deriva ya inventariada: valor exacto, quién lo agregó, quién la arregla."""

    enum: str
    valor: str
    origen: str
    seguimiento: str


PARES_DE_ENUM = (
    ParDeEnum("TipoRol", "types/domain.ts", "BackendTipoRol"),
    ParDeEnum("TipoSangre", "types/domain.ts", "TipoSangre"),
    ParDeEnum("TipoNotificacion", "types/domain.ts", "TipoNotificacion"),
    ParDeEnum("EstadoPago", "lib/server/payments-adapter.ts", "BackendEstadoPago"),
    ParDeEnum("EstadoPago", "lib/status-badges.ts", "EstadoPago"),
    ParDeEnum("TipoPago", "lib/server/payments-adapter.ts", "BackendTipoPago"),
    ParDeEnum("EstadoMembresia", "lib/membership-status.ts", "BackendEstadoMembresia"),
    ParDeEnum("DiaSemana", "lib/server/attendance-adapter.ts", "BackendDiaSemana"),
    ParDeEnum("EstadoAsistencia", "lib/server/attendance-adapter.ts", "BackendEstadoAsistencia"),
)

MAPAS_TRADUCIDOS = (
    MapaTraducido(
        "DiaSemana", "lib/server/attendance-adapter.ts",
        "DIA_SEMANA_BACKEND_TO_FRONTEND", "DIA_SEMANA_FRONTEND_TO_BACKEND",
        "DiaSemana", "types/domain.ts",
    ),
    MapaTraducido(
        "EstadoAsistencia", "lib/server/attendance-adapter.ts",
        "ESTADO_ASISTENCIA_BACKEND_TO_FRONTEND", "ESTADO_ASISTENCIA_FRONTEND_TO_BACKEND",
        "EstadoAsistencia", "types/domain.ts",
    ),
)

# (b) `TipoRol` es identidad Y traducción a la vez, igual que `DiaSemana`: la
# unión `BackendTipoRol` nombra sus valores y DOS mapas los llevan a `UserRole`.
# Los dos mapas dicen hoy lo mismo, pero no están tipados igual, y esa
# diferencia es la que este gate cubre:
#
#   `USER_ROLE_BY_BACKEND_ROLE` es `Record<BackendTipoRol, UserRole>`: agregar
#   un rol a la unión rompe la compilación de ese archivo, que es el aviso.
#   `BACKEND_ROLE_TO_USER_ROLE` es `Record<string, UserRole>`, exhaustivo sobre
#   nada: el mismo rol nuevo compila sin ruido, sale `undefined` en
#   `lib/server/auth.ts:717` y lo descarta el `.filter` de la línea siguiente.
#
# O sea: un rol agregado al backend detiene el build por el camino del cliente
# y desaparece callado por el del servidor. Es la misma forma de falla que
# motivó `tipo-notificacion-parity.test.ts` -- un `Record<>` que parece
# exhaustivo y está indexado demasiado flojo para serlo. Verificar el conjunto
# de claves acá es justamente lo que su tipo no puede verificar.
#
# Además se comparan los dos mapas entre sí: son dos copias a mano de la misma
# tabla y nada en el sistema de tipos las relaciona.
MAPAS_DE_ROL = (
    ("lib/auth-utils.ts", "USER_ROLE_BY_BACKEND_ROLE", "BackendTipoRol"),
    ("lib/server/auth.ts", "BACKEND_ROLE_TO_USER_ROLE", "string"),
)

# `"unsupported"` no es un rol que el backend emita: es el centinela que
# devuelve `resolveSessionRole` (`lib/server/auth.ts:723`) cuando ningún rol
# conocido matcheó. No participa de la biyección contra `TipoRol`; se nombra
# acá en vez de quedar fuera por omisión.
CENTINELA_DE_ROL = "unsupported"

# (c) `MEMBERSHIP_STATUS_BY_ESTADO` (`lib/membership-status.ts:14`) pliega dos
# estados del backend en un solo código de pantalla. Está documentado en las
# líneas 11-13 de ese archivo: `PaymentValidationRequest.currentMembershipStatus`
# no tiene valor `"inactiva"`, y una membresía creada sin ningún pago aprobado
# se lee como `"vencida"`. Por eso acá se verifica el conjunto de CLAVES y NO
# se exige que los valores sean distintos: exigirlo denunciaría la decisión.
# `SUSPENDIDA` (issue #935) no se pliega: tiene su propio código de pantalla,
# porque no acumula deuda mientras dura y confundirla con `"vencida"` sería
# incorrecto.
PLIEGUE_MEMBRESIA = ("lib/membership-status.ts", "MEMBERSHIP_STATUS_BY_ESTADO", "BackendEstadoMembresia")
PLIEGUE_ESPERADO = {
    "INACTIVA": "vencida",
    "VENCIDA": "vencida",
    "ACTIVA": "activa",
    "SUSPENDIDA": "suspendida",
}

# Todo `Record<>` que este gate lee, aplanado. Sólo se usa para medir el piso
# del parser de mapas: si la regex se rompe, el total cae y se denuncia.
TODOS_LOS_MAPAS = (
    *[(m.archivo, m.mapa) for m in MAPAS_TRADUCIDOS],
    *[(m.archivo, m.inverso) for m in MAPAS_TRADUCIDOS],
    *[(archivo, mapa) for archivo, mapa, _ in MAPAS_DE_ROL],
    PLIEGUE_MEMBRESIA[:2],
)

# (d) Excluido: la fuente de verdad no es el enum. Mismo criterio -- y mismo
# enum -- que `backend/tests/test_drift_enums_postgres.py:70` excluye con
# `_ENUMS_SIN_COLUMNA_POSTGRES = {"Categoria"}`.
ENUMS_EXCLUIDOS = {
    "Categoria": (
        "la tabla `categoria_horario` es la fuente de verdad (enums.py:56-65), no el enum. "
        "`services/categorias.ts:32` declara `export type Categoria = string` A PROPÓSITO: "
        "una unión cerrada volvería a descartar en silencio los códigos que un admin agrega "
        "sin deploy. Una biyección acá exigiría congelar justo lo que se decidió no congelar."
    ),
}

# (d) Sin contraparte: nada cruza el límite. Se nombran uno por uno en vez de
# dejarlos fuera por omisión -- si mañana alguno se expone al BFF, agregarlo a
# `PARES_DE_ENUM` es un cambio visible en el diff, y borrarlo de acá también.
ENUMS_SIN_CONTRAPARTE = {
    "TipoManoDominante": "sólo entra por `EnrollmentAntecedentesDTO`; ninguna pantalla lo declara",
    "TipoModalidad": "modalidad del plan; el BFF no la tipa",
    "TipoEscuela": "dato de la institución; no viaja tipado al frontend",
    "NivelTecnicoAlumno": "sólo entra por `EnrollmentAntecedentesDTO`; sus valores llevan un espacio",
    "EfectoCoberturaCorreccion": "rastro de auditoría de `PagoServicio.corregir_pago`; no sale a pantalla",
}

CLASIFICADOS = {par.enum for par in PARES_DE_ENUM} | set(ENUMS_SIN_CONTRAPARTE) | set(ENUMS_EXCLUIDOS)

# Vacío: issue #935 corrigió las dos derivas que este inventario contenía
# (`EstadoMembresia.SUSPENDIDA`, `TipoPago.REGULARIZACION`) en vez de
# eximirlas, así que la biyección de enums vuelve a ser estricta sin
# excepciones. La tabla se deja declarada (y no se borra el mecanismo) para
# que una deriva futura tenga dónde inventariarse sin reinventar el gate.
DIVERGENCIAS_INVENTARIADAS: tuple[Divergencia, ...] = ()

_CLASE_PY = re.compile(r"^class (\w+)\(([^)]*)\):", re.M)
_MIEMBRO_ENUM = re.compile(r'^    ([A-Z][A-Z0-9_]*)\s*=\s*"([^"\n]+)"', re.M)
_CAMPO_DTO = re.compile(r"^    (\w+)\s*:", re.M)
_DOCSTRING_PY = re.compile(r'"""[\s\S]*?"""')
# Los comentarios de TypeScript citan texto entre comillas (`domain.ts:396` cita
# «"your payment of $X was approved"`). Sin sacarlos, esa prosa entraría como un
# valor de la unión.
_COMENTARIO_TS = re.compile(r"//[^\n]*|/\*[\s\S]*?\*/")
_ENTRADA_MAPA = re.compile(r'^\s*([A-Za-z_]\w*)\s*:\s*"([^"\n]+)"', re.M)
_CAMEL = re.compile(r"(?<=[a-z0-9])([A-Z])")


def cuerpo_de_clase(fuente: str, nombre: str) -> str:
    """El cuerpo de una clase de Python: sin su docstring y hasta la clase siguiente.

    El docstring se saca porque su prosa imita la forma de un miembro: la línea
    `conserva: es la "necesidad ya establecida..."` de `EnrollmentFichaMedicaDTO`
    entraría como un campo llamado `conserva`.
    """
    apertura = re.search(rf"^class {re.escape(nombre)}\(", fuente, re.M)
    if apertura is None:
        return ""
    resto = fuente[apertura.end() :]
    corte = re.search(r"^class \w", resto, re.M)
    return _DOCSTRING_PY.sub("", resto[: corte.start()] if corte else resto)


def valores_de_enum(fuente: str, nombre: str) -> set[str]:
    """Los valores (no los nombres) de un enum del backend.

    El valor se lee con `[^"\\n]+` y no con `[A-Z][A-Z0-9_]*`: los diez de
    `NivelTecnicoAlumno` llevan un espacio (`"NIVEL 1"`), y la regex más
    estrecha de `tipo-notificacion-parity.test.ts` los perdería en silencio.
    """
    return {valor for _, valor in _MIEMBRO_ENUM.findall(cuerpo_de_clase(fuente, nombre))}


def enums_declarados(fuente: str) -> set[str]:
    """Todo `class X(str, enum.Enum)` del módulo de enums."""
    return {nombre for nombre, bases in _CLASE_PY.findall(fuente) if "enum.Enum" in bases}


def literales_de_union(fuente: str, nombre: str) -> set[str]:
    """Los literales de `export type X = "A" | "B";`."""
    union = re.search(rf"export type {re.escape(nombre)} =([^;]*);", _COMENTARIO_TS.sub("", fuente))
    return set(re.findall(r'"([^"\n]+)"', union.group(1))) if union else set()


def _declaracion_de_mapa(fuente: str, nombre: str) -> re.Match[str] | None:
    """El `const X: <tipo> = { … }` de un mapa, exportado o no.

    El `export` es opcional a propósito: los dos mapas de rol
    (`USER_ROLE_BY_BACKEND_ROLE`, `BACKEND_ROLE_TO_USER_ROLE`) son privados de
    su módulo, y exigir `export` los dejaría fuera del gate en silencio.
    """
    patron = rf"(?:export )?const {re.escape(nombre)}\s*:([^=]*)=\s*\{{([^}}]*)\}}"
    return re.search(patron, _COMENTARIO_TS.sub("", fuente))


def pares_de_mapa(fuente: str, nombre: str) -> list[tuple[str, str]]:
    """Las entradas `CLAVE: "valor"` de un `const X: Record<…> = {…}`."""
    mapa = _declaracion_de_mapa(fuente, nombre)
    return _ENTRADA_MAPA.findall(mapa.group(2)) if mapa else []


def tipo_de_clave(fuente: str, nombre: str) -> str:
    """El tipo con el que un `Record<…>` indexa: lo que decide si TypeScript exige todas.

    `Record<BackendTipoRol, …>` no compila incompleto; `Record<string, …>` es
    exhaustivo sobre nada y acepta que falte cualquier clave.
    """
    mapa = _declaracion_de_mapa(fuente, nombre)
    clave = re.search(r"Record<\s*([^,<>]+),", mapa.group(1)) if mapa else None
    return clave.group(1).strip() if clave else ""


def exentos_de(enum: str) -> frozenset[str]:
    """Los valores de un enum que el inventario de divergencias deja pasar."""
    return frozenset(d.valor for d in DIVERGENCIAS_INVENTARIADAS if d.enum == enum)


def verificar_biyeccion(nombre: str, backend: set[str], frontend: set[str], exentos=frozenset()) -> None:
    """El gate de enums: los dos lados nombran exactamente los mismos valores.

    Falla en las dos direcciones y nombra los valores. Cualquiera de los dos
    conjuntos vacío también falla: sin eso una regex rota dejaría el gate verde
    por no haber comparado nada.
    """
    assert backend, f"{nombre}: no se leyó ningún valor del lado del backend"
    assert frontend, f"{nombre}: no se leyó ningún valor del lado del frontend"
    faltan = sorted(backend - frontend - exentos)
    sobran = sorted(frontend - backend - exentos)
    assert not faltan, f"{nombre}: el backend emite valores que el frontend no declara: {faltan}"
    assert not sobran, f"{nombre}: el frontend declara valores que el backend no emite: {sobran}"


def leer_ts(ruta: str) -> str:
    return (FRONTEND / ruta).read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def fuente_enums() -> str:
    return ENUMS.read_text(encoding="utf-8")


IDS_DE_PAR = [f"{par.enum}-{par.declaracion}" for par in PARES_DE_ENUM]
IDS_DE_MAPA = [mapa.enum for mapa in MAPAS_TRADUCIDOS]


class TestBiyeccionDeEnums:
    """(a) Identidad: la unión de TypeScript nombra los valores del backend."""

    @pytest.mark.parametrize("par", PARES_DE_ENUM, ids=IDS_DE_PAR)
    def test_los_dos_lados_nombran_los_mismos_valores(self, par, fuente_enums):
        verificar_biyeccion(
            par.enum,
            valores_de_enum(fuente_enums, par.enum),
            literales_de_union(leer_ts(par.archivo), par.declaracion),
            exentos_de(par.enum),
        )


class TestEnumsTraducidos:
    """(b) El `Record<>` es la biyección: se verifica por clave y por valor."""

    @pytest.mark.parametrize("mapa", MAPAS_TRADUCIDOS, ids=IDS_DE_MAPA)
    def test_las_claves_del_mapa_son_los_valores_del_backend(self, mapa, fuente_enums):
        pares = pares_de_mapa(leer_ts(mapa.archivo), mapa.mapa)
        verificar_biyeccion(mapa.mapa, valores_de_enum(fuente_enums, mapa.enum), {c for c, _ in pares})

    @pytest.mark.parametrize("mapa", MAPAS_TRADUCIDOS, ids=IDS_DE_MAPA)
    def test_los_valores_del_mapa_son_los_de_la_union_de_la_aplicacion(self, mapa):
        pares = pares_de_mapa(leer_ts(mapa.archivo), mapa.mapa)
        union = literales_de_union(leer_ts(mapa.archivo_union), mapa.union)
        verificar_biyeccion(mapa.union, {v for _, v in pares}, union)

    @pytest.mark.parametrize("mapa", MAPAS_TRADUCIDOS, ids=IDS_DE_MAPA)
    def test_el_mapa_inverso_es_el_inverso(self, mapa):
        fuente = leer_ts(mapa.archivo)
        directo = pares_de_mapa(fuente, mapa.mapa)
        assert directo, f"{mapa.mapa}: no se leyó ninguna entrada"
        assert sorted((v, c) for c, v in directo) == sorted(pares_de_mapa(fuente, mapa.inverso))


class TestMapasDeRol:
    """(b) `TipoRol`: dos mapas a mano, uno de ellos indexado demasiado flojo."""

    @pytest.mark.parametrize(("archivo", "mapa", "clave"), MAPAS_DE_ROL, ids=[m[1] for m in MAPAS_DE_ROL])
    def test_el_mapa_cubre_todos_los_roles_del_backend(self, archivo, mapa, clave, fuente_enums):
        claves = {c for c, _ in pares_de_mapa(leer_ts(archivo), mapa)}
        verificar_biyeccion(mapa, valores_de_enum(fuente_enums, "TipoRol"), claves, exentos_de("TipoRol"))

    @pytest.mark.parametrize(("archivo", "mapa", "clave"), MAPAS_DE_ROL, ids=[m[1] for m in MAPAS_DE_ROL])
    def test_los_valores_del_mapa_son_roles_de_la_aplicacion(self, archivo, mapa, clave):
        valores = {v for _, v in pares_de_mapa(leer_ts(archivo), mapa)}
        union = literales_de_union(leer_ts("types/domain.ts"), "UserRole") - {CENTINELA_DE_ROL}
        verificar_biyeccion(mapa, union, valores)

    @pytest.mark.parametrize(("archivo", "mapa", "clave"), MAPAS_DE_ROL, ids=[m[1] for m in MAPAS_DE_ROL])
    def test_el_tipo_de_clave_declarado_sigue_siendo_el_que_dice_la_tabla(self, archivo, mapa, clave):
        assert tipo_de_clave(leer_ts(archivo), mapa) == clave

    def test_los_dos_mapas_de_rol_dicen_exactamente_lo_mismo(self):
        primero, segundo = (dict(pares_de_mapa(leer_ts(archivo), mapa)) for archivo, mapa, _ in MAPAS_DE_ROL)
        assert primero, "no se leyó ninguna entrada del primer mapa de rol"
        assert primero == segundo, f"las dos copias a mano divergieron: {primero} vs {segundo}"


class TestPliegueDeMembresia:
    """(c) `EstadoMembresia` pliega a propósito: se verifican las claves, no la inyectividad."""

    def test_el_mapa_cubre_toda_la_union_del_backend(self):
        archivo, mapa, union = PLIEGUE_MEMBRESIA
        claves = {c for c, _ in pares_de_mapa(leer_ts(archivo), mapa)}
        verificar_biyeccion(mapa, literales_de_union(leer_ts(archivo), union), claves)

    def test_el_pliegue_a_vencida_es_exactamente_el_documentado(self):
        archivo, mapa, _ = PLIEGUE_MEMBRESIA
        assert dict(pares_de_mapa(leer_ts(archivo), mapa)) == PLIEGUE_ESPERADO


class TestClasificacionDeEnums:
    """El guardián del guardián: ningún enum queda fuera de las cuatro relaciones."""

    def test_todo_enum_del_backend_esta_clasificado(self, fuente_enums):
        sin_clasificar = sorted(enums_declarados(fuente_enums) - CLASIFICADOS)
        assert not sin_clasificar, f"enums sin relación declarada con el frontend: {sin_clasificar}"

    def test_ninguna_clasificacion_nombra_un_enum_que_ya_no_existe(self, fuente_enums):
        fantasmas = sorted(CLASIFICADOS - enums_declarados(fuente_enums))
        assert not fantasmas, f"clasificados pero ya no declarados en enums.py: {fantasmas}"

    def test_ningun_enum_cae_en_dos_categorias_a_la_vez(self):
        cubiertos = [par.enum for par in PARES_DE_ENUM]
        aparte = set(ENUMS_SIN_CONTRAPARTE) | set(ENUMS_EXCLUIDOS)
        assert not aparte & set(cubiertos), f"clasificado dos veces: {sorted(aparte & set(cubiertos))}"

    def test_los_valores_con_espacio_no_se_pierden_al_leerlos(self, fuente_enums):
        assert "NIVEL 1" in valores_de_enum(fuente_enums, "NivelTecnicoAlumno")


# ---------------------------------------------------------------------------
# Campos obligatorios del contrato
# ---------------------------------------------------------------------------
#
# No se intenta leer el cuerpo de un type guard arbitrario: se declara la tabla
# explícita, como `USOS_BACKEND` en el gate del glosario (#903). Cada fila dice
# qué campo exige un validador del BFF y en qué DTO de Pydantic tiene que
# existir. El ejemplar es `isPublicSchedules`
# (`frontend/src/app/api/schedules/route.ts:7`), cuyo comentario de las líneas
# 13-17 -- «anything else here means the upstream shape moved, and the landing
# must not render a guess at it» -- es exactamente el razonamiento que esta
# tabla mecaniza.
#
# Se verifican dos cosas por fila:
#
#   1. Que el campo exista en el DTO, comparando por nombre Python.
#   2. Que la CONVENCIÓN del nombre sea la correcta. `ResponseBase`
#      (`schemas/base.py:45`) trae un `alias_generator` snake→camel y FastAPI
#      serializa por alias, pero sólo cuando la ruta declara `response_model=`.
#      Las dos condiciones son necesarias, y las cuatro combinaciones existen
#      de verdad acá: `/auth/me` declara response_model y hereda ResponseBase
#      (viaja `personaId`); `/enrollment/` declara response_model y NO hereda
#      (viaja `persona_id`); `/auth/login` y `/auth/refresh` no declaran
#      response_model y devuelven el dict crudo del servicio (viaja
#      `access_token`), como dice el docstring de `InvalidarSesionesResponseDTO`
#      en `auth_schemas.py:171-173`.
#
# Sin la comprobación 2, agregarle `response_model=LoginResponseDTO` a `/login`
# convertiría `access_token` en `accessToken` y rompería la sesión sin que nada
# se ponga rojo.


class Campo(NamedTuple):
    """Un campo que un validador del BFF exige, y el DTO del backend que lo emite."""

    ruta: str
    campo: str
    dto: str
    esquema: str
    router: str
    decorador: str
    validador: str


_LOGIN = ("LoginResponseDTO", "auth_schemas.py", "auth_router.py")
_ME = ("UsuarioMeResponseDTO", "auth_schemas.py", "auth_router.py")
_ALTA = ("EnrollmentResponseDTO", "enrollment_schemas.py", "enrollment_router.py")
_HORARIOS = ("asistencia_schemas.py", "asistencias_router.py", "/horarios-publicos", "isPublicSchedules")

CAMPOS_OBLIGATORIOS = (
    Campo("/auth/login", "access_token", *_LOGIN, "/login", "isBackendLoginResponse"),
    Campo("/auth/login", "refresh_token", *_LOGIN, "/login", "isBackendLoginResponse"),
    Campo("/auth/login", "token_type", *_LOGIN, "/login", "isBackendLoginResponse"),
    Campo("/auth/refresh", "access_token", *_LOGIN, "/refresh", "isBackendRefreshResponse"),
    Campo("/auth/refresh", "token_type", *_LOGIN, "/refresh", "isBackendRefreshResponse"),
    Campo("/auth/me", "correo", *_ME, "/me", "isBackendMeResponse"),
    Campo("/auth/me", "personaId", *_ME, "/me", "isBackendMeResponse"),
    Campo("/auth/me", "nombres", *_ME, "/me", "isBackendMeResponse"),
    Campo("/auth/me", "apellidos", *_ME, "/me", "isBackendMeResponse"),
    Campo("/auth/me", "roles", *_ME, "/me", "isBackendMeResponse"),
    Campo("/auth/me", "correoVerificado", *_ME, "/me", "isBackendMeResponse"),
    Campo("/auth/me", "altaPresencialCompletada", *_ME, "/me", "isBackendMeResponse"),
    Campo("/enrollment/", "access_token", *_ALTA, "/", "isBackendEnrollmentResponse"),
    Campo("/enrollment/", "refresh_token", *_ALTA, "/", "isBackendEnrollmentResponse"),
    Campo("/enrollment/", "persona_id", *_ALTA, "/", "isBackendEnrollmentResponse"),
    Campo("/chatbot/consultar", "respuesta", "ChatbotRespuestaDTO", "chatbot_schemas.py",
          "chatbot_router.py", "/consultar", "isBackendChatbotResponse"),
    Campo("/asistencias/horarios-publicos", "category", "PublicScheduleCategoryDTO", *_HORARIOS),
    Campo("/asistencias/horarios-publicos", "ages", "PublicScheduleCategoryDTO", *_HORARIOS),
    Campo("/asistencias/horarios-publicos", "blocks", "PublicScheduleCategoryDTO", *_HORARIOS),
    Campo("/asistencias/horarios-publicos", "days", "PublicScheduleBlockDTO", *_HORARIOS),
    Campo("/asistencias/horarios-publicos", "startTime", "PublicScheduleBlockDTO", *_HORARIOS),
    Campo("/asistencias/horarios-publicos", "endTime", "PublicScheduleBlockDTO", *_HORARIOS),
)

# Pisos del parser del lado de los enums y los DTO, con el mismo criterio que
# `PISOS`: holgados respecto de lo medido, para denunciar una regex rota y no
# para congelar el inventario.
PISOS_DE_ENUM = {
    "backend:enums": 12,
    "backend:valores": 55,
    "ts:literales": 35,
    "ts:entradas-de-mapa": 25,
    "backend:campos-de-dto": 15,
    "campos:discriminantes": 10,
}


def campos_de_dto(fuente: str, dto: str) -> set[str]:
    """Los nombres Python de los campos que declara un DTO de Pydantic."""
    return set(_CAMPO_DTO.findall(cuerpo_de_clase(fuente, dto)))


def hereda_response_base(fuente: str, dto: str) -> bool:
    """Si el DTO trae el `alias_generator` snake→camel de `schemas/base.py`."""
    clase = re.search(rf"^class {re.escape(dto)}\(([^)]*)\):", fuente, re.M)
    return clase is not None and "ResponseBase" in clase.group(1)


def declara_response_model(fuente: str, ruta: str) -> bool:
    """Si el decorador de esa ruta declara `response_model=`.

    Se lee la lista de argumentos completa balanceando paréntesis: varios
    decoradores la parten en varias líneas (`/horarios-publicos`, `/`).
    """
    for decorador in _DECORADOR.finditer(fuente):
        argumentos = _lista_de_parametros(fuente, decorador.end() - 1)
        literal = _LITERAL.search(argumentos)
        if literal is not None and literal.group("ruta") == ruta:
            return "response_model=" in argumentos
    return False


def a_snake(nombre: str) -> str:
    """El nombre Python de un campo, venga en camelCase o ya en snake_case."""
    return _CAMEL.sub(r"_\1", nombre).lower()


def viaja_camelizado(campo: Campo) -> bool:
    """Si el nombre de ese campo llega camelizado a la respuesta. Ver el bloque de arriba."""
    router = (ROUTERS / campo.router).read_text(encoding="utf-8")
    esquema = (ESQUEMAS / campo.esquema).read_text(encoding="utf-8")
    return declara_response_model(router, campo.decorador) and hereda_response_base(esquema, campo.dto)


def verificar_campo_declarado(campo: Campo, declarados: set[str]) -> None:
    """El gate de campos: lo que el BFF exige tiene que existir en el DTO."""
    assert declarados, f"{campo.dto}: no se leyó ningún campo"
    assert a_snake(campo.campo) in declarados, (
        f"{campo.ruta}: `{campo.validador}` exige `{campo.campo}` y `{campo.dto}` "
        f"no lo declara (declara {sorted(declarados)})"
    )


def discrimina_convencion(nombre: str) -> bool:
    """Si el nombre distingue camelCase de snake_case. `respuesta` es idéntico en las dos."""
    return "_" in nombre or _CAMEL.search(nombre) is not None


def verificar_convencion(campo: Campo, camelizado: bool) -> None:
    """El nombre que exige el BFF tiene que estar en la convención en que viaja."""
    if not discrimina_convencion(campo.campo):
        return
    esperado_camel = _CAMEL.search(campo.campo) is not None
    assert esperado_camel == camelizado, (
        f"{campo.ruta}: `{campo.validador}` exige `{campo.campo}` "
        f"pero el campo viaja {'camelizado' if camelizado else 'en snake_case'}"
    )


IDS_DE_CAMPO = [f"{c.ruta}-{c.campo}" for c in CAMPOS_OBLIGATORIOS]


@pytest.fixture(scope="module")
def esquemas() -> dict[str, str]:
    return {archivo.name: archivo.read_text(encoding="utf-8") for archivo in ESQUEMAS.glob("*.py")}


class TestCamposObligatorios:
    @pytest.mark.parametrize("campo", CAMPOS_OBLIGATORIOS, ids=IDS_DE_CAMPO)
    def test_el_campo_existe_en_el_dto_del_backend(self, campo, esquemas):
        verificar_campo_declarado(campo, campos_de_dto(esquemas[campo.esquema], campo.dto))

    @pytest.mark.parametrize("campo", CAMPOS_OBLIGATORIOS, ids=IDS_DE_CAMPO)
    def test_el_nombre_esta_en_la_convencion_en_la_que_viaja(self, campo):
        verificar_convencion(campo, viaja_camelizado(campo))

    def test_toda_ruta_de_la_tabla_es_una_ruta_que_el_bff_consume(self, consumos):
        consumidas = {ruta for ruta, _ in consumos}
        fuera = sorted({c.ruta for c in CAMPOS_OBLIGATORIOS} - consumidas)
        assert not fuera, f"campos declarados sobre rutas que el BFF no consume: {fuera}"

    def test_el_contrato_documenta_el_peligro_que_este_gate_atrapo(self):
        """El `response_model=` en `/login` es la razón de ser de la comprobación de convención."""
        contrato = CONTRATO.read_text(encoding="utf-8")
        for evidencia in ("response_model=LoginResponseDTO", "accessToken", "isBackendLoginResponse"):
            assert evidencia in contrato, f"el peligro documentado no cita {evidencia}"

    def test_las_cuatro_combinaciones_de_serializacion_estan_representadas(self):
        combinaciones = {
            (declara_response_model((ROUTERS / c.router).read_text(encoding="utf-8"), c.decorador),
             hereda_response_base((ESQUEMAS / c.esquema).read_text(encoding="utf-8"), c.dto))
            for c in CAMPOS_OBLIGATORIOS
        }
        faltantes = sorted({(True, True), (True, False), (False, True)} - combinaciones)
        assert not faltantes, (
            "la tabla dejó de cubrir alguna combinación de (response_model, ResponseBase), "
            f"que es lo que le da sentido a la comprobación de convención: faltan {faltantes}"
        )


class TestElGateDeEnumsNoEsVacio:
    """Las triangulaciones del PR 2, como regresión permanente."""

    def test_un_valor_del_backend_sin_literal_en_ts_pone_el_gate_rojo(self):
        with pytest.raises(AssertionError, match="INVENTADA"):
            verificar_biyeccion("X", {"ACTIVA", "INVENTADA"}, {"ACTIVA"})

    def test_un_literal_de_ts_que_el_backend_no_emite_pone_el_gate_rojo(self):
        with pytest.raises(AssertionError, match="no emite.*INVENTADA"):
            verificar_biyeccion("X", {"ACTIVA"}, {"ACTIVA", "INVENTADA"})

    def test_estado_membresia_pasa_sin_ninguna_exencion(self, fuente_enums):
        """Issue #935 cerró la única deriva de este enum: el inventario ya no le debe nada."""
        verificar_biyeccion(
            "EstadoMembresia",
            valores_de_enum(fuente_enums, "EstadoMembresia"),
            literales_de_union(leer_ts("lib/membership-status.ts"), "BackendEstadoMembresia"),
            exentos_de("EstadoMembresia"),
        )

    def test_una_deriva_nueva_en_estado_membresia_pone_el_gate_rojo_sin_exencion(self, fuente_enums):
        """La prueba de que la biyección sigue estricta con el inventario vacío (issue #935)."""
        backend = valores_de_enum(fuente_enums, "EstadoMembresia") | {"CONGELADA"}
        frontend = literales_de_union(leer_ts("lib/membership-status.ts"), "BackendEstadoMembresia")
        exentos = exentos_de("EstadoMembresia")
        assert not exentos, "el inventario debería estar vacío tras #935"
        with pytest.raises(AssertionError, match="CONGELADA"):
            verificar_biyeccion("EstadoMembresia", backend, frontend, exentos)

    def test_ninguna_exencion_cubre_un_enum_entero(self, fuente_enums):
        anchas = [d.enum for d in DIVERGENCIAS_INVENTARIADAS
                  if exentos_de(d.enum) >= valores_de_enum(fuente_enums, d.enum)]
        assert not anchas, f"exenciones que taparían la deriva siguiente: {anchas}"

    @pytest.mark.parametrize("par", PARES_DE_ENUM, ids=IDS_DE_PAR)
    def test_ninguna_exencion_sobrevive_a_su_deriva(self, par, fuente_enums):
        backend = valores_de_enum(fuente_enums, par.enum)
        frontend = literales_de_union(leer_ts(par.archivo), par.declaracion)
        obsoletas = sorted(exentos_de(par.enum) & backend & frontend)
        assert not obsoletas, f"{par.enum}: exención sin deriva que tapar, hay que borrarla: {obsoletas}"

    @pytest.mark.parametrize("par", PARES_DE_ENUM, ids=IDS_DE_PAR)
    def test_ninguna_exencion_nombra_un_valor_que_no_existe(self, par, fuente_enums):
        backend = valores_de_enum(fuente_enums, par.enum)
        frontend = literales_de_union(leer_ts(par.archivo), par.declaracion)
        fantasmas = sorted(exentos_de(par.enum) - backend - frontend)
        assert not fantasmas, f"{par.enum}: se exenta un valor que ningún lado declara: {fantasmas}"

    def test_un_conjunto_de_valores_del_backend_vacio_falla(self):
        with pytest.raises(AssertionError, match="lado del backend"):
            verificar_biyeccion("X", set(), {"ACTIVA"})

    def test_un_conjunto_de_literales_de_ts_vacio_falla(self):
        with pytest.raises(AssertionError, match="lado del frontend"):
            verificar_biyeccion("X", {"ACTIVA"}, set())

    def test_vaciar_la_tabla_de_pares_deja_enums_sin_clasificar(self, fuente_enums):
        """El equivalente del piso para la tabla: sin pares, la clasificación se pone roja."""
        aparte = set(ENUMS_SIN_CONTRAPARTE) | set(ENUMS_EXCLUIDOS)
        assert enums_declarados(fuente_enums) - aparte, (
            "sin `PARES_DE_ENUM` no quedarían enums sin clasificar, "
            "así que vaciar la tabla no pondría el gate en rojo"
        )

    def test_un_parser_de_enums_roto_no_lee_ningun_valor(self):
        assert valores_de_enum('class X(str, enum.Enum):\n    A: "A"\n', "X") == set()

    def test_un_parser_de_uniones_roto_no_lee_ningun_literal(self):
        assert literales_de_union('export type X = "A" | "B"\n', "X") == set()

    def test_un_campo_que_el_dto_no_declara_pone_el_gate_rojo(self):
        campo = CAMPOS_OBLIGATORIOS[0]._replace(campo="campoInventado")
        with pytest.raises(AssertionError, match="campoInventado"):
            verificar_campo_declarado(campo, {"access_token"})

    def test_un_dto_sin_ningun_campo_leido_pone_el_gate_rojo(self):
        with pytest.raises(AssertionError, match="ningún campo"):
            verificar_campo_declarado(CAMPOS_OBLIGATORIOS[0], set())

    def test_un_nombre_camelizado_donde_el_campo_viaja_en_snake_pone_el_gate_rojo(self):
        campo = CAMPOS_OBLIGATORIOS[0]._replace(campo="personaId")
        with pytest.raises(AssertionError, match="snake_case"):
            verificar_convencion(campo, camelizado=False)

    def test_un_nombre_en_snake_donde_el_campo_viaja_camelizado_pone_el_gate_rojo(self):
        campo = CAMPOS_OBLIGATORIOS[0]._replace(campo="persona_id")
        with pytest.raises(AssertionError, match="camelizado"):
            verificar_convencion(campo, camelizado=True)

    def test_el_contrato_documenta_las_cuatro_relaciones_y_los_catorce_enums(self, fuente_enums):
        contrato = CONTRATO.read_text(encoding="utf-8")
        assert "Divergencias inventariadas" in contrato, "falta la tabla de divergencias"
        for enum in sorted(enums_declarados(fuente_enums)):
            assert f"`{enum}`" in contrato, f"el contrato no nombra el enum {enum}"

    @pytest.mark.parametrize("divergencia", DIVERGENCIAS_INVENTARIADAS, ids=[d.valor for d in DIVERGENCIAS_INVENTARIADAS])
    def test_cada_divergencia_esta_documentada_con_su_origen_y_su_destino(self, divergencia):
        contrato = CONTRATO.read_text(encoding="utf-8")
        for evidencia in (divergencia.valor, divergencia.origen, divergencia.seguimiento):
            assert evidencia in contrato, f"la divergencia {divergencia.valor} no cita {evidencia}"

    def test_el_contrato_justifica_el_enum_excluido(self):
        contrato = CONTRATO.read_text(encoding="utf-8")
        for evidencia in ("categoria_horario", "test_drift_enums_postgres.py"):
            assert evidencia in contrato, f"la exclusión de Categoria no cita {evidencia}"

    def test_ninguna_superficie_de_enums_cae_por_debajo_de_su_piso(self, fuente_enums, esquemas):
        medido = conteo_de_enums(fuente_enums, esquemas)
        flojas = {n: medido[n] for n, piso in PISOS_DE_ENUM.items() if medido[n] < piso}
        assert not flojas, f"parser roto o superficie perdida: {flojas} (pisos {PISOS_DE_ENUM})"


def conteo_de_enums(fuente_enums: str, esquemas: dict[str, str]) -> dict[str, int]:
    """Lo extraído por cada parser de esta mitad del gate, por separado."""
    declarados = enums_declarados(fuente_enums)
    return {
        "backend:enums": len(declarados),
        "backend:valores": sum(len(valores_de_enum(fuente_enums, n)) for n in declarados),
        "ts:literales": sum(len(literales_de_union(leer_ts(p.archivo), p.declaracion)) for p in PARES_DE_ENUM),
        "ts:entradas-de-mapa": sum(len(pares_de_mapa(leer_ts(a), m)) for a, m in TODOS_LOS_MAPAS),
        "backend:campos-de-dto": len({(c.dto, campo) for c in CAMPOS_OBLIGATORIOS
                                      for campo in campos_de_dto(esquemas[c.esquema], c.dto)}),
        "campos:discriminantes": sum(1 for c in CAMPOS_OBLIGATORIOS if discrimina_convencion(c.campo)),
    }
