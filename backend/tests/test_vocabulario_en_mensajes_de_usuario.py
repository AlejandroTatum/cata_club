"""
Ningún mensaje que un socio puede llegar a leer nombra algo que solo existe
adentro del sistema.

## Por qué esta prueba y no una lista de mensajes

Corregir los 17 mensajes que hoy filtran vocabulario de implementación es
trabajo de una tarde; que no vuelvan a aparecer es el trabajo real. Un
servicio nuevo con un `f"...{estado.value}"` adentro reintroduce el problema
sin tocar ninguna línea existente, y ninguna prueba de comportamiento lo ve:
el servicio funciona, el flujo pasa, el mensaje simplemente dice
`PENDIENTE_VALIDACION` en una pantalla.

Por eso el candado es una prueba de USO -- el mismo patrón que
`frontend/src/lib/__tests__/error-message-usage.test.ts` y `ui-vocabulary.test.ts`,
que son las dos guardas de este repositorio que no envejecieron. No verifica
los 17 mensajes conocidos: verifica la REGLA sobre todos los sitios que
producen mensajes, incluidos los que todavía no se escribieron.

## Cuál es el cuello de botella

Un mensaje llega al usuario por una de cuatro puertas, y solo cuatro:

  · una excepción de dominio cuyo manejador global la traduce a un status de
    entrada (`app/dominio/excepciones.py` + `_MAPA_EXCEPCIONES` en `main.py`);
  · un `ValueError` dentro de un schema de Pydantic, que FastAPI convierte
    en 422;
  · un `HTTPException(status_code=..., detail=...)` en un router;
  · `_respuesta_error(...)` en `main.py`.

## Qué es un "status de entrada" y por qué el alcance es ese

Solo 400, 409 y 422 describen lo que el llamador ENVIÓ; son los únicos cuyo
`detail` puede decirle al usuario cuál de sus datos fue rechazado, y por eso
son los únicos que el frontend deja pasar a la pantalla
(`INPUT_STATUSES` en `frontend/src/lib/error-message.ts`). Un 404, un 401 o un
403 se explican solos y el frontend los reemplaza por su propia frase, así que
el `detail` que traen nunca se lee.

Este conjunto se declara acá y no se importa del frontend a propósito: es una
regla del backend ("el status habla de lo que mandaste"), no una consecuencia
de cómo esté escrito el cliente de hoy. Que ambos coincidan es la señal de que
los dos entendieron lo mismo, no un acoplamiento.

Los mensajes de 404/401/403 tienen el mismo problema de vocabulario y están
anotados en `docs/archive/plans/pendientes.md`. Quedan fuera de esta guarda porque hoy no
son legibles por nadie; el día que un status se remapee en `_MAPA_EXCEPCIONES`
entran solos, porque el alcance se deriva de ese mapa y no de una lista.

## Qué NO verifica

**Si el mensaje está bien escrito.** Esta guarda no juzga castellano. Verifica
que lo que se lee haya sido escrito para una persona, no que esa persona lo
entienda. Un mensaje vacío de contenido la pasa.

**Un identificador interno que llegue con un nombre nuevo.** Se detectan las
dos formas que el código realmente usó -- `.value` de un enum y un atributo o
variable terminado en `_id`/`id` -- porque son las dos que existieron. Una
tercera forma pasa hasta que alguien la agregue acá, que es el precio fijo de
una guarda basada en patrones.
"""
import ast
import enum
import re
from pathlib import Path

import pytest

from app.dominio import enums, etiquetas
from main import _MAPA_EXCEPCIONES


RAIZ = Path(__file__).resolve().parent.parent

# Las capas que producen mensajes, más el módulo que los responde.
# `infraestructura/repositorios` está en la lista y no es un descuido: no
# "debería" lanzar excepciones de dominio, pero `eliminacion_segura.py` traduce
# ahí un `IntegrityError` a `OperacionInvalida`, y eso sale como 400.
DIRECTORIOS_BARRIDOS = (
    RAIZ / "app" / "servicios_negocio",
    RAIZ / "app" / "presentacion" / "routers",
    RAIZ / "app" / "presentacion" / "schemas",
    RAIZ / "app" / "infraestructura" / "repositorios",
)
ARCHIVOS_BARRIDOS = (RAIZ / "main.py",)


# --- Alcance: qué status llega a leerse -------------------------------------
STATUS_DE_ENTRADA = frozenset({400, 409, 422})

# Derivado del mapa real: si mañana `EntidadNoEncontrada` pasa a 400, sus
# mensajes entran a esta guarda sin que haya que tocar esta prueba.
EXCEPCIONES_DE_ENTRADA = frozenset(
    excepcion.__name__
    for excepcion, codigo in _MAPA_EXCEPCIONES.items()
    if codigo in STATUS_DE_ENTRADA
)

_STATUS_EN_CONSTANTE = re.compile(r"HTTP_(\d{3})_")


def _miembros_de_enums() -> frozenset[str]:
    """Los nombres y valores de todos los enums del dominio.

    Se derivan del módulo, no se listan: un miembro nuevo queda cubierto el
    día que se escribe. Solo interesan los que están en mayúsculas, que son
    los que se leen como grito en una frase (`ADMINISTRADOR`, `RECHAZADO`).
    """
    encontrados: set[str] = set()
    for nombre in dir(enums):
        objeto = getattr(enums, nombre)
        if isinstance(objeto, type) and issubclass(objeto, enum.Enum):
            for miembro in objeto:
                encontrados.add(miembro.name)
                if isinstance(miembro.value, str):
                    encontrados.add(miembro.value)
    return frozenset(valor for valor in encontrados if valor.isupper() and len(valor) > 2)


MIEMBROS_DE_ENUMS = _miembros_de_enums()


# --- Vocabulario de implementación ------------------------------------------
# Cada patrón nombra una familia que apareció de verdad en este backend.
# Ninguno puede dispararse con castellano común escrito para un socio.
VOCABULARIO_DE_IMPLEMENTACION: tuple[tuple[str, re.Pattern[str]], ...] = (
    # `tipo_cuenta`, `representante_id`, `motivo_rechazo`: nombres de columna
    # y de campo, la familia más numerosa por lejos.
    ("nombre de campo", re.compile(r"\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b")),
    # `PENDIENTE_VALIDACION`: un literal de enum citado de vuelta al usuario.
    ("literal de enum compuesto", re.compile(r"\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b")),
    # Cualquier cosa serializada que se haya escapado a la frase.
    ("estructura serializada", re.compile(r"[{}\[\]<>]")),
    # `POST /auth/registro`. La barra pide espacio o inicio de cadena adelante
    # para no comerse `lunes/miércoles`, que es como este club escribe sus
    # horarios, ni `señor/a`.
    ("ruta de endpoint", re.compile(r"(?:^|\s)/[a-z][a-z0-9_/-]*")),
    ("método HTTP", re.compile(r"\b(?:GET|POST|PUT|PATCH|DELETE)\b")),
    # Vocabulario de runtime que entra por un `str(exc)` sin filtrar.
    (
        "vocabulario de runtime",
        re.compile(r"\b(?:Traceback|Exception|NoneType|None|null|[A-Za-z]+Error)\b"),
    ),
    # Una frase en inglés en un producto que le habla en castellano a sus
    # socios no fue escrita para ellos: se escapó de una librería. Detectar el
    # IDIOMA es más barato que listar los mensajes. Cada token de abajo se
    # verificó contra el castellano; los que se le parecen no son alcanzables
    # (`\binvalid\b` no matchea "invalidar", y "válido"/"están" llevan tilde).
    # Faltan a propósito `a`, `no`, `son` y `es`, que SÍ son castellano.
    (
        "frase en inglés",
        re.compile(
            r"\b(?:the|of|is|are|was|were|be|been|to|for|with|from|and|not|must"
            r"|should|cannot|this|that|its|an|at|by|in|on|it|does|invalid|valid"
            r"|required|field|value|type|object|string|number|expected|received"
            r"|allowed|failed|request|response|internal|unknown|missing"
            r"|serializable|unsupported|forbidden|unauthorized)\b",
            re.IGNORECASE,
        ),
    ),
)


def vocabulario_en(texto: str) -> list[str]:
    """Las familias de vocabulario de implementación presentes en un texto."""
    hallazgos = [
        f"{etiqueta}: {patron.search(texto).group().strip()}"
        for etiqueta, patron in VOCABULARIO_DE_IMPLEMENTACION
        if patron.search(texto)
    ]
    hallazgos.extend(
        f"literal de enum: {miembro}"
        for miembro in sorted(MIEMBROS_DE_ENUMS)
        if re.search(rf"\b{re.escape(miembro)}\b", texto)
    )
    return hallazgos


def fuga_de_interpolacion(expresion: ast.expr) -> str | None:
    """El dato interno que una interpolación mete en un mensaje ya formado.

    Un f-string parte el problema en dos: los pedazos literales los revisa
    `vocabulario_en`, pero `f"...{tipo_rol.value}"` no tiene nada sospechoso
    en su literal -- la fuga está en lo que se interpola, y solo se ve
    mirando la expresión.
    """
    if isinstance(expresion, ast.Attribute):
        if expresion.attr == "value":
            return "`.value` de un enum"
        if expresion.attr == "id" or expresion.attr.endswith("_id"):
            return f"identificador interno `{expresion.attr}`"
    if isinstance(expresion, ast.Name) and expresion.id.endswith("_id"):
        return f"identificador interno `{expresion.id}`"
    return None


# --- Barrido -----------------------------------------------------------------
def _archivos_python() -> list[Path]:
    encontrados = list(ARCHIVOS_BARRIDOS)
    for directorio in DIRECTORIOS_BARRIDOS:
        encontrados.extend(sorted(directorio.rglob("*.py")))
    return [ruta for ruta in encontrados if ruta.name != "__init__.py"]


def _nombre_llamado(func: ast.expr) -> str | None:
    if isinstance(func, ast.Name):
        return func.id
    if isinstance(func, ast.Attribute):
        return func.attr
    return None


def _status_de(nodo: ast.Call) -> int | None:
    """El status de un `HTTPException`, sea literal o `status.HTTP_4xx_...`."""
    valor = _argumento(nodo, "status_code", 0)
    if isinstance(valor, ast.Constant) and isinstance(valor.value, int):
        return valor.value
    if isinstance(valor, ast.Attribute):
        coincidencia = _STATUS_EN_CONSTANTE.match(valor.attr)
        if coincidencia:
            return int(coincidencia.group(1))
    return None


def _argumento(nodo: ast.Call, nombre: str, posicion: int) -> ast.expr | None:
    for palabra_clave in nodo.keywords:
        if palabra_clave.arg == nombre:
            return palabra_clave.value
    if len(nodo.args) > posicion:
        return nodo.args[posicion]
    return None


def _constantes_de_modulo(arbol: ast.Module) -> dict[str, str]:
    """`MENSAJE_IDENTIDAD_DUPLICADA = "..."` a nivel de módulo."""
    constantes: dict[str, str] = {}
    for nodo in arbol.body:
        if isinstance(nodo, ast.Assign) and isinstance(nodo.value, ast.Constant):
            if isinstance(nodo.value.value, str):
                for destino in nodo.targets:
                    if isinstance(destino, ast.Name):
                        constantes[destino.id] = nodo.value.value
    return constantes


def _constantes_compartidas() -> dict[str, str]:
    """Las constantes de texto de todo `app/`, para resolver las importadas.

    `MENSAJE_IDENTIDAD_DUPLICADA` vive en `app/dominio/mensajes.py` y lo usan
    nueve sitios de cuatro servicios. Mirando un solo módulo por vez, esos
    nueve mensajes quedaban ilegibles para la guarda -- que es exactamente
    cómo se le escapa a un `grep`, y por qué mover un texto a una constante
    compartida no puede ser una forma de salir del alcance.

    Un nombre definido dos veces con textos distintos no se resuelve: se deja
    ilegible a propósito, porque adivinar cuál gana sería peor que reportarlo.
    """
    definiciones: dict[str, set[str]] = {}
    for ruta in sorted((RAIZ / "app").rglob("*.py")):
        try:
            arbol = ast.parse(ruta.read_text(encoding="utf-8"))
        except SyntaxError:  # pragma: no cover - un módulo roto ya rompe la suite
            continue
        for nombre, texto in _constantes_de_modulo(arbol).items():
            definiciones.setdefault(nombre, set()).add(texto)
    return {
        nombre: textos.pop()
        for nombre, textos in definiciones.items()
        if len(textos) == 1
    }


CONSTANTES_COMPARTIDAS = _constantes_compartidas()


def _partes_del_mensaje(
    expresion: ast.expr, constantes: dict[str, str]
) -> tuple[list[str], list[ast.expr]] | None:
    """Separa un mensaje en sus pedazos literales y sus interpolaciones."""
    if isinstance(expresion, ast.Constant) and isinstance(expresion.value, str):
        return [expresion.value], []
    if isinstance(expresion, ast.Name):
        texto = constantes.get(expresion.id)
        return ([texto], []) if texto is not None else None
    if isinstance(expresion, ast.JoinedStr):
        literales: list[str] = []
        interpolaciones: list[ast.expr] = []
        for parte in expresion.values:
            if isinstance(parte, ast.Constant) and isinstance(parte.value, str):
                literales.append(parte.value)
            elif isinstance(parte, ast.FormattedValue):
                interpolaciones.append(parte.value)
        return literales, interpolaciones
    if isinstance(expresion, ast.BinOp) and isinstance(expresion.op, ast.Add):
        izquierda = _partes_del_mensaje(expresion.left, constantes)
        derecha = _partes_del_mensaje(expresion.right, constantes)
        if izquierda is None or derecha is None:
            return None
        return izquierda[0] + derecha[0], izquierda[1] + derecha[1]
    return None


def mensajes_de_usuario(codigo: str, ruta_relativa: str) -> list[dict]:
    """Cada mensaje que este archivo puede poner en una pantalla."""
    arbol = ast.parse(codigo)
    constantes = {**CONSTANTES_COMPARTIDAS, **_constantes_de_modulo(arbol)}
    es_schema = "schemas/" in ruta_relativa
    encontrados: list[dict] = []

    for nodo in ast.walk(arbol):
        if not isinstance(nodo, ast.Call):
            continue
        llamado = _nombre_llamado(nodo.func)
        expresion: ast.expr | None = None

        if llamado in EXCEPCIONES_DE_ENTRADA:
            expresion = _argumento(nodo, "mensaje", 0)
        elif llamado == "ValueError" and es_schema:
            expresion = _argumento(nodo, "", 0)
        elif llamado == "HTTPException" and _status_de(nodo) in STATUS_DE_ENTRADA:
            expresion = _argumento(nodo, "detail", 1)
        elif llamado == "_respuesta_error":
            codigo_http = _status_de(nodo)
            if codigo_http in STATUS_DE_ENTRADA:
                expresion = _argumento(nodo, "mensaje", 1)

        if expresion is None:
            continue
        partes = _partes_del_mensaje(expresion, constantes)
        literales, interpolaciones = partes if partes is not None else ([], [])
        encontrados.append({
            "sitio": f"{ruta_relativa}:{nodo.lineno}",
            "llamado": llamado,
            "literal": " ".join(literales),
            "interpolaciones": interpolaciones,
            # `raise OperacionInvalida(str(error))` no tiene ningún literal que
            # revisar: el texto se decide en runtime. Saltearlo en silencio
            # dejaría un agujero con forma de guarda, así que se reporta.
            "verificable": partes is not None,
        })
    return encontrados


def _es_prosa(texto: str) -> bool:
    """Una frase escrita para leerse, no un token ni una clave de diccionario.

    `"ADMINISTRADOR"` como argumento de `GestorPermisos` es código; `"quitar
    el rol ADMINISTRADOR"` es una frase que termina en una pantalla. Lo que
    los separa es que la segunda tiene varias palabras y minúsculas.
    """
    palabras = texto.split()
    return len(palabras) >= 3 and any(caracter.islower() for caracter in texto)


def prosa_con_enum(codigo: str, ruta_relativa: str) -> list[str]:
    """Frases que citan un literal de enum y viajan como argumento.

    Existe aparte del barrido de mensajes por un caso concreto: el fragmento
    `"quitar el rol ADMINISTRADOR"` no se pasa a una excepción sino a un
    helper que lo interpola después. Visto desde la excepción es un `{accion}`
    inocente; el vocabulario está en el call site.

    Mira SOLO argumentos de llamada, y eso es la regla, no una comodidad: un
    literal que se pasa a una función es un fragmento en tránsito, que es el
    mecanismo del que hay que defenderse. Una constante de módulo o una
    docstring no viajan a ningún mensaje -- por eso el conocimiento del chatbot
    (hoy `conocimiento_club.json`, que habla de "el administrador") no es
    asunto de esta guarda, y de hecho no es un mensaje de error de nadie.
    """
    arbol = ast.parse(codigo)
    hallazgos: list[str] = []
    for nodo in ast.walk(arbol):
        if not isinstance(nodo, ast.Call):
            continue
        # `detalle_tecnico` queda afuera por definición: es el campo que
        # EXISTE para llevar el enum crudo y los ids al log. Revisarlo sería
        # prohibir exactamente aquello para lo que se agregó.
        argumentos = [
            *nodo.args,
            *(clave.value for clave in nodo.keywords if clave.arg != "detalle_tecnico"),
        ]
        for argumento in argumentos:
            literales = _literales_alcanzables(argumento)
            for texto, linea in literales:
                if not _es_prosa(texto):
                    continue
                for miembro in sorted(MIEMBROS_DE_ENUMS):
                    if re.search(rf"\b{re.escape(miembro)}\b", texto):
                        hallazgos.append(f"{ruta_relativa}:{linea} — cita `{miembro}`")
                        break
    return hallazgos


def _literales_alcanzables(expresion: ast.expr) -> list[tuple[str, int]]:
    """Los textos literales dentro de un argumento, con su línea."""
    if isinstance(expresion, ast.Constant) and isinstance(expresion.value, str):
        return [(expresion.value, expresion.lineno)]
    if isinstance(expresion, ast.JoinedStr):
        return [
            (parte.value, parte.lineno)
            for parte in expresion.values
            if isinstance(parte, ast.Constant) and isinstance(parte.value, str)
        ]
    if isinstance(expresion, ast.BinOp) and isinstance(expresion.op, ast.Add):
        return _literales_alcanzables(expresion.left) + _literales_alcanzables(expresion.right)
    return []


ARCHIVOS = [
    (ruta.relative_to(RAIZ).as_posix(), ruta.read_text(encoding="utf-8"))
    for ruta in _archivos_python()
]

MENSAJES = [
    mensaje
    for ruta_relativa, codigo in ARCHIVOS
    for mensaje in mensajes_de_usuario(codigo, ruta_relativa)
]


def _fugas() -> list[str]:
    fugas: list[str] = []
    for mensaje in MENSAJES:
        motivos = vocabulario_en(mensaje["literal"])
        motivos.extend(
            motivo
            for expresion in mensaje["interpolaciones"]
            if (motivo := fuga_de_interpolacion(expresion)) is not None
        )
        if motivos:
            fugas.append(f"{mensaje['sitio']} — {', '.join(sorted(set(motivos)))}")
    return sorted(set(fugas))


FUGAS = _fugas()

# Un mensaje cuyo texto se decide en runtime no puede revisarse leyendo el
# código. La lista de abajo es un padrón, no un glob: sumar un sitio obliga a
# argumentar acá por qué su texto está garantizado en otro lado.
MENSAJES_NO_VERIFICABLES = sorted(
    mensaje["sitio"] for mensaje in MENSAJES if not mensaje["verificable"]
)

# `eliminar_o_error_de_dominio(db, entidad, mensaje)` recibe el texto del
# llamador. Su literal no está en la excepción sino en el call site, que este
# mismo archivo barre con `prosa_con_enum` y que hoy es un solo sitio
# (`asistencia_repositorio.py`) con prosa limpia.
#
# `main.py::_validation_exception_handler` (PR 4b) arma su `mensaje` en
# runtime a partir de `exc.errors()[0]["msg"]`: es exactamente el texto que
# un `field_validator` de `app/presentacion/schemas/` levantó como
# `ValueError`, y ESE literal sí lo barre esta guarda (`es_schema=True` en
# `mensajes_de_usuario`) en el archivo donde se escribió. No hay un segundo
# texto sin revisar -- solo el mismo, leído dos veces por dos sitios.
#
# Se admiten por ARCHIVO, sin número de línea: el renglón exacto del call
# site es incidental y se mueve con cualquier commit que toque el archivo
# por encima (el logging de PR #560 movió el `_respuesta_error` de `main.py`
# de la 207 a la 214 sin tocar el mensaje). Comparar el archivo conserva la
# guarda -- "ningún mensaje se escapa por ilegible" -- sin que una línea
# incidental la rompa.
NO_VERIFICABLES_ADMITIDOS = (
    "app/infraestructura/repositorios/eliminacion_segura.py",
    "main.py",
)

FUGAS_EN_PROSA = sorted(
    hallazgo
    for ruta_relativa, codigo in ARCHIVOS
    for hallazgo in prosa_con_enum(codigo, ruta_relativa)
)


class TestElBarridoEncuentraAlgo:
    """Guarda de la guarda: un barrido roto vuelve vacuo todo lo de abajo."""

    def test_encuentra_archivos(self):
        assert len(ARCHIVOS) >= 20

    def test_encuentra_mensajes(self):
        assert len(MENSAJES) >= 40

    def test_el_alcance_se_derivo_del_mapa_real(self):
        # `OperacionInvalida` y `EntidadDuplicada` son 400; `ConflictoConcurrencia`
        # es 409 (issue #451, lock_timeout de `obtener_por_id_con_bloqueo`); el
        # resto no entra.
        assert EXCEPCIONES_DE_ENTRADA == {
            "OperacionInvalida", "EntidadDuplicada", "ConflictoConcurrencia",
        }

    def test_conoce_los_enums_del_dominio(self):
        assert {"ADMINISTRADOR", "PENDIENTE_VALIDACION", "LUNES", "COMPETITIVO"} <= MIEMBROS_DE_ENUMS


class TestNingunMensajeVisibleNombraLaImplementacion:
    def test_sin_fugas_en_los_mensajes(self):
        assert FUGAS == []

    def test_sin_fugas_en_la_prosa_que_los_alimenta(self):
        assert FUGAS_EN_PROSA == []

    def test_ningun_mensaje_escapa_por_ser_ilegible_para_la_guarda(self):
        archivos = sorted(
            sitio.rsplit(":", 1)[0] for sitio in MENSAJES_NO_VERIFICABLES
        )
        assert archivos == sorted(NO_VERIFICABLES_ADMITIDOS)


class TestLasEtiquetasSonElUnicoPuenteYNoFiltran:
    """`app/dominio/etiquetas.py` es por donde un enum entra a una frase.

    El barrido de mensajes no lo alcanza: ve `{rol_en_castellano(tipo_rol)}`,
    una llamada, y no puede saber qué devuelve. Si alguien escribiera ahí
    `TipoRol.ADMINISTRADOR: "ADMINISTRADOR"`, la fuga volvería y ninguna de
    las guardas de arriba la vería. Estas dos pruebas cierran ese paso.
    """

    @pytest.mark.parametrize("enumeracion,traductor", [
        (enums.DiaSemana, etiquetas.dia_en_castellano),
        (enums.TipoRol, etiquetas.rol_en_castellano),
        (enums.EstadoPago, etiquetas.estado_de_pago_en_castellano),
        # `enums.Categoria` quedó afuera (M1): ya no tiene traductor en
        # `etiquetas.py` -- su label sale de `CategoriaHorario.label`
        # (tabla), no de un diccionario cerrado que un enum nuevo pudiera
        # dejar sin cubrir.
    ])
    def test_cada_miembro_tiene_etiqueta_y_esta_escrita_para_una_persona(
        self, enumeracion, traductor
    ):
        for miembro in enumeracion:
            # Sin `KeyError`: un miembro nuevo sin etiqueta se ve acá y no en
            # producción, que es la otra forma en que esto podía romperse.
            etiqueta = traductor(miembro)
            assert vocabulario_en(etiqueta) == [], f"{miembro!r} -> {etiqueta!r}"


class TestElDetectorNoEsVacuo:
    """Los 17 sitios originales, tal como estaban antes de este cambio."""

    @pytest.mark.parametrize("texto,familia", [
        ("La persona es mayor de edad. Use tipo_cuenta JUGADOR o REPRESENTANTE.", "nombre de campo"),
        ("El menor requiere un representante legal (representante_id).", "nombre de campo"),
        ("este pago ya está en estado PENDIENTE_VALIDACION", "literal de enum compuesto"),
        ("El persona_id del cuerpo no coincide con el de la URL", "nombre de campo"),
        ("credenciales (POST /auth/registro); no se le puede asignar un rol", "método HTTP"),
        ("Esta persona ya tiene el rol ADMINISTRADOR", "literal de enum: ADMINISTRADOR"),
        ("El día LUNES no está permitido para la categoría COMPETITIVO", "literal de enum: COMPETITIVO"),
        ("detalle: [{'loc': 'body'}]", "estructura serializada"),
        ("Object of type Decimal is not JSON serializable", "frase en inglés"),
        ("Se produjo un ValueError al procesar la fecha", "vocabulario de runtime"),
    ])
    def test_marca_el_vocabulario_conocido(self, texto, familia):
        assert any(familia in hallazgo for hallazgo in vocabulario_en(texto))

    def test_marca_el_value_de_un_enum_interpolado(self):
        expresion = ast.parse("f'ya tiene el rol {tipo_rol.value}'", mode="eval").body
        _, interpolaciones = _partes_del_mensaje(expresion, {})
        assert fuga_de_interpolacion(interpolaciones[0]) == "`.value` de un enum"

    def test_marca_un_identificador_crudo_interpolado(self):
        expresion = ast.parse("f'La persona {datos.persona_id} no está inscrita'", mode="eval").body
        _, interpolaciones = _partes_del_mensaje(expresion, {})
        assert fuga_de_interpolacion(interpolaciones[0]) == "identificador interno `persona_id`"

    def test_marca_un_mensaje_escondido_en_una_constante(self):
        codigo = (
            'MENSAJE = "El campo motivo_rechazo es obligatorio"\n'
            "def f():\n"
            "    raise OperacionInvalida(MENSAJE)\n"
        )
        mensajes = mensajes_de_usuario(codigo, "app/servicios_negocio/x.py")
        assert vocabulario_en(mensajes[0]["literal"])

    def test_marca_prosa_que_cita_un_enum_en_un_call_site(self):
        codigo = 'def f():\n    g(usuario, "quitar el rol ADMINISTRADOR")\n'
        assert prosa_con_enum(codigo, "app/servicios_negocio/x.py")


class TestElDetectorNoMarcaProsaLegitima:
    @pytest.mark.parametrize("texto", [
        "El menor requiere un representante legal.",
        "La persona es mayor de edad: registre la cuenta como jugador o como representante.",
        "Este pago ya fue aprobado; solo puede validarse un pago pendiente.",
        "Martín Vera ya está asignado a ese horario.",
        "Los entrenamientos de esa categoría son los lunes/miércoles.",
        "El día lunes no está permitido para la categoría Competitivo.",
        "La edad del alumno debe estar entre 5 y 17 años.",
        "El horario va de 16:00 a 18:00, señor/a.",
        "Esta persona todavía no creó su usuario y contraseña.",
    ])
    def test_deja_pasar_castellano_escrito_para_un_socio(self, texto):
        assert vocabulario_en(texto) == []

    def test_un_token_suelto_no_es_prosa(self):
        # `GestorPermisos(["ADMINISTRADOR"])` es código, no una frase.
        assert prosa_con_enum('f(["ADMINISTRADOR", "ENTRENADOR"])\n', "x.py") == []

    def test_una_docstring_puede_nombrar_un_enum(self):
        codigo = '"""Este servicio maneja ALUMNO y ADMINISTRADOR por separado."""\n'
        assert prosa_con_enum(codigo, "x.py") == []

    def test_una_constante_de_modulo_no_es_un_fragmento_en_transito(self):
        # El prompt del chatbot no alimenta ningún mensaje de error.
        codigo = '_FAQ = """La ficha médica la gestiona el ADMINISTRADOR del club."""\n'
        assert prosa_con_enum(codigo, "x.py") == []

    def test_resuelve_una_constante_de_texto_compartida(self):
        # Los nueve `EntidadDuplicada(MENSAJE_IDENTIDAD_DUPLICADA)` se leen.
        assert "MENSAJE_IDENTIDAD_DUPLICADA" in CONSTANTES_COMPARTIDAS
        mensajes = mensajes_de_usuario(
            "def f():\n    raise EntidadDuplicada(MENSAJE_IDENTIDAD_DUPLICADA)\n",
            "app/servicios_negocio/x.py",
        )
        assert mensajes[0]["verificable"]
        assert vocabulario_en(mensajes[0]["literal"]) == []

    def test_un_mensaje_de_404_queda_fuera_del_alcance(self):
        # Mismo defecto, otro PR: hoy el frontend nunca lo muestra.
        codigo = 'def f():\n    raise EntidadNoEncontrada(f"Persona con id {persona_id} no encontrada")\n'
        assert mensajes_de_usuario(codigo, "app/servicios_negocio/x.py") == []
