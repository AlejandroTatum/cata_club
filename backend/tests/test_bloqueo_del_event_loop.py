"""
Candado: ningún `async def` de un router llama directo a algo bloqueante.

## Por qué esta prueba y no diez correcciones

El backend corre UN SOLO proceso de uvicorn sin `--workers` (`Dockerfile:53`).
Un `async def` que llama código síncrono lento no "tarda un poco más": retiene
el único hilo del event loop y deja de atender a TODO otro cliente mientras
tanto -- ni siquiera `GET /health`, que no toca la BD ni la red.

Ese defecto ya se corrigió tres veces, de a una, siempre después de que
alguien lo notara: `POST /auth/login` (issue #311, el `time.sleep` del freno
progresivo), `POST /pagos/{id}/voucher` (issue #450, la subida a Cloudinary) y
`POST /chatbot/consultar` (issue #834, la llamada al gateway). Las tres veces
se arregló el sitio y no la clase, así que el endpoint siguiente volvió a
omitirlo: cuando se escribió este candado quedaban NUEVE handlers con la misma
falla (issues #826 y #835). Corregir esos nueve es trabajo de una tarde; que el
siguiente no nazca igual es el trabajo real, y ninguna prueba de comportamiento
lo ve -- el endpoint funciona, devuelve lo que debe, y simplemente congela al
resto del proceso mientras lo hace.

El DÉCIMO apareció enseguida y prueba el punto de la peor manera: no lo
encontró nadie leyendo código, lo encontró esta misma prueba en cuanto se
completó `PRIMITIVAS_BLOQUEANTES` con `pwd_context.verify`
(`personas_router::independizar_persona`, que además no tiene rate limit). El
candado vale exactamente lo que valga esa lista.

## La regla

Dentro de un `async def` de `app/presentacion/routers/`, ninguna llamada puede
resolver a una función que alcanza una primitiva bloqueante. Envolverla en
`run_in_threadpool` la saca del event loop y, en el AST, deja de ser una
llamada: pasa a ser una REFERENCIA al callable (`run_in_threadpool(servicio.f,
...)`). O sea que la regla y su corrección son la misma cosa mirada desde el
árbol, sin necesidad de reconocer la forma correcta para poder exigirla.

Se recorre el AST y no el texto (mismo criterio que
`test_vocabulario_en_mensajes_de_usuario.py` y `test_lectura_archivos.py`): un
nombre citado dentro de un comentario o un docstring -- por ejemplo los de ESTE
módulo -- no es código y no debe contar como infracción.

## Cómo se resuelve "handler -> primitiva bloqueante"

Es un problema de varios saltos: el handler llama a un método de servicio, que
llama a otro, que termina en `cloudinary.uploader.upload`. Se hace en dos
etapas:

1. Se indexan todas las funciones de `app/` como `(módulo, Clase.metodo)` y se
   arma un grafo de llamadas resolviendo el RECEPTOR de cada una (no su nombre
   suelto). Resolver por nombre no sirve: `crear` está definido 24 veces en
   este backend, y uno de esos -- `SponsorServicio.crear` -- sube a Cloudinary.
2. Se propaga hacia atrás desde las primitivas bloqueantes hasta el punto fijo.

Que el cierre vaya HACIA ATRÁS decide en qué dirección duele confundir
nombres, y es fácil escribirlo al revés: la contaminación NO alcanza a los
otros 23 `crear` (ninguno llama a nada bloqueante, y a un nodo se entra por
lo que llama, no por cómo se llama) -- alcanza a quienes los LLAMAN. Medido
sobre este commit: con un resolvedor por nombre suelto el cierre pasa de 24 a
76 funciones y aparecen 16 handlers denunciados sin motivo, empezando por
`POST /descuentos/`, que llama a `DescuentoServicio(db).crear(...)`. Ese es el
contraejemplo que vigila `test_no_denuncia_a_un_handler_por_un_homonimo`.

## Qué NO cubre

**Un receptor que el árbol no delata.** Solo se siguen `Clase(...).metodo()`,
`Clase.metodo()`, `self.metodo()`, `x = Clase(...)` seguido de `x.metodo()`,
una función del módulo y una importada. Un `self.repo.algo()`, un método
llamado sobre un parámetro, o un callable sacado de un dict quedan sin
resolver y NO se siguen: una primitiva bloqueante escondida detrás de una de
esas formas pasa el candado. Es un piso, no un techo.

**Herencia, `getattr` y despacho dinámico.** Nada de eso se modela.

**Cualquier bloqueo que no esté en `PRIMITIVAS_BLOQUEANTES`.** La lista se
declara abajo. Una dependencia nueva (otro SDK síncrono, un `subprocess.run`,
un `time.sleep`) no está cubierta hasta que alguien la agregue acá -- pero el
agujero real resultó ser otro, y menos vistoso: la primera versión de esta
lista omitió `pwd_context.verify`, una primitiva que el backend YA usaba, del
mismo módulo y del mismo costo que `pwd_context.hash`. No hacía falta una
dependencia nueva para tener un handler sin cubrir; alcanzó con nombrar media
biblioteca. Al agregar una familia, se agregan sus DOS puntas.

**Un `async def` que no vive en `app/presentacion/routers/`.** El barrido de
handlers filtra por ese paquete, así que una corrutina de afuera -- una
dependencia de `Depends`, o un helper que el handler `await`ea -- corre en el
mismo event loop y no se mira. Hoy hay exactamente una en todo `app/`
(`soporte_transversal/lectura_archivos.py::leer_con_limite`) y está limpia: no
alcanza ninguna primitiva. O sea que no hay exposición viva, pero la segunda
que aparezca no la ve nadie.

**La E/S contra Postgres.** Es el bloqueo más grande y más frecuente del
backend -- SQLAlchemy es síncrono y CADA handler lo usa --, pero sacarlo del
event loop no es envolver diez llamadas: es una decisión de arquitectura
(driver async o threadpool en toda la capa). Queda deliberadamente afuera; ver
issue #451 para la variante que sí se midió (`FOR UPDATE`).

**Un handler `def` sin `async`.** FastAPI ya lo corre en su threadpool, así que
no puede cometer esta falla.

**Un `lambda` pasado a `run_in_threadpool`.** La llamada adentro del lambda se
contaría como infracción aunque sea correcta. Ningún call site usa esa forma;
si alguno la necesita, se agrega la excepción acá y no se afloja la regla.
"""
import ast
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
DIRECTORIO_APP = RAIZ / "app"
PAQUETE_ROUTERS = "app.presentacion.routers"

# Las familias que este backend usó de verdad. Cada una es una llamada
# síncrona que puede tardar segundos enteros:
#
#   · `cloudinary.uploader.upload` / `.destroy`: SDK síncrono contra la red,
#     acotado por `TIMEOUT_CLOUDINARY_TOTAL_SEGUNDOS = 8.0` (issues #450, #826,
#     #835).
#   · `pwd_context.hash` y `pwd_context.verify`: bcrypt con el costo 12 que
#     trae passlib por defecto. Medido en la máquina donde se escribió esto:
#     198 ms el hash y 179 ms el verify -- el número exacto depende del CPU,
#     el orden de magnitud no. Y no es E/S, así que ni siquiera un driver
#     async lo salvaría (issue #826). `verify` cuesta lo mismo que `hash`
#     porque bcrypt VUELVE A DERIVAR la clave con el costo y la sal embebidos
#     en el hash guardado: es el mismo trabajo, no una comparación de cadenas.
#     Faltaba en la primera versión de esta lista, y esa omisión dejó afuera
#     un décimo handler (`personas_router.py::independizar_persona`) que
#     ninguna otra prueba veía.
#   · `.chat.completions.create`: el gateway del chatbot, con un presupuesto de
#     pared de 24 s (issue #834).
#
# Se comparan por SUFIJO de la cadena de atributos porque el receptor de base
# varía (`client.chat.completions.create` donde `client` sale de una función).
PRIMITIVAS_BLOQUEANTES = frozenset({
    ("cloudinary", "uploader", "upload"),
    ("cloudinary", "uploader", "destroy"),
    ("pwd_context", "hash"),
    ("pwd_context", "verify"),
    ("chat", "completions", "create"),
})

_LARGOS_DE_PRIMITIVA = frozenset(len(p) for p in PRIMITIVAS_BLOQUEANTES)


def _archivos_python() -> list[Path]:
    return [ruta for ruta in sorted(DIRECTORIO_APP.rglob("*.py")) if ruta.name != "__init__.py"]


def _nombre_de_modulo(ruta: Path) -> str:
    return str(ruta.relative_to(RAIZ).with_suffix("")).replace("/", ".")


def _cadena_de_atributos(expresion: ast.expr) -> tuple[str, ...] | None:
    """`cloudinary.uploader.upload` -> `("cloudinary", "uploader", "upload")`.

    Devuelve None si la base de la cadena no es un nombre simple (por ejemplo
    `f().g`), porque en ese caso el sufijo igual alcanza para comparar.
    """
    partes: list[str] = []
    while isinstance(expresion, ast.Attribute):
        partes.append(expresion.attr)
        expresion = expresion.value
    if not partes:
        return None
    if isinstance(expresion, ast.Name):
        partes.append(expresion.id)
    return tuple(reversed(partes))


def _es_primitiva(expresion: ast.expr) -> bool:
    cadena = _cadena_de_atributos(expresion)
    if cadena is None:
        return False
    return any(cadena[-largo:] in PRIMITIVAS_BLOQUEANTES for largo in _LARGOS_DE_PRIMITIVA)


class MapaDeLlamadas:
    """Índice de `app/` y grafo de llamadas con el receptor resuelto.

    Un nodo del grafo es `(módulo, cualificado)`, donde `cualificado` es
    `Clase.metodo` para un método y el nombre pelado para una función de
    módulo. Esa identidad -- y no el nombre suelto -- es lo que hace utilizable
    al candado.
    """

    def __init__(self, rutas: list[Path]):
        self.arboles: dict[str, ast.Module] = {}
        self.funciones: dict[tuple[str, str], ast.AST] = {}
        self.clases: dict[str, dict[str, dict[str, str]]] = {}
        self.importados: dict[str, dict[str, tuple[str, str]]] = {}
        self.modulos_importados: dict[str, dict[str, str]] = {}

        for ruta in rutas:
            modulo = _nombre_de_modulo(ruta)
            self.arboles[modulo] = ast.parse(ruta.read_text(encoding="utf-8"))

        for modulo, arbol in self.arboles.items():
            self._indexar_definiciones(modulo, arbol)
            self._indexar_importaciones(modulo, arbol)

        self.aristas, self.bloqueantes_directos = self._construir_grafo()
        self.bloqueantes = self._cerrar_transitivamente()

    # --- indexado ---------------------------------------------------------
    def _indexar_definiciones(self, modulo: str, arbol: ast.Module) -> None:
        self.clases[modulo] = {}
        for nodo in arbol.body:
            if isinstance(nodo, (ast.FunctionDef, ast.AsyncFunctionDef)):
                self.funciones[(modulo, nodo.name)] = nodo
            elif isinstance(nodo, ast.ClassDef):
                metodos: dict[str, str] = {}
                for miembro in nodo.body:
                    if isinstance(miembro, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        cualificado = f"{nodo.name}.{miembro.name}"
                        self.funciones[(modulo, cualificado)] = miembro
                        metodos[miembro.name] = cualificado
                self.clases[modulo][nodo.name] = metodos

    def _indexar_importaciones(self, modulo: str, arbol: ast.Module) -> None:
        """Se recorre TODO el árbol, no solo `arbol.body`.

        Varios servicios importan el cliente de Cloudinary DENTRO del método
        que lo usa (`auth_servicio.py:384`, `persona_servicio.py:411`), para
        romper un ciclo de importación. Mirar solo el nivel superior perdería
        justo esos dos saltos, que son dos de los sitios que este candado
        existe para cuidar.
        """
        self.importados[modulo] = {}
        self.modulos_importados[modulo] = {}
        for nodo in ast.walk(arbol):
            if isinstance(nodo, ast.ImportFrom) and nodo.module:
                for alias in nodo.names:
                    self.importados[modulo][alias.asname or alias.name] = (nodo.module, alias.name)
            elif isinstance(nodo, ast.Import):
                for alias in nodo.names:
                    self.modulos_importados[modulo][alias.asname or alias.name] = alias.name

    # --- resolución -------------------------------------------------------
    def _clase_visible(self, modulo: str, nombre: str) -> tuple[str, dict[str, str]] | None:
        if nombre in self.clases.get(modulo, {}):
            return modulo, self.clases[modulo][nombre]
        origen = self.importados.get(modulo, {}).get(nombre)
        if origen and origen[1] in self.clases.get(origen[0], {}):
            return origen[0], self.clases[origen[0]][origen[1]]
        return None

    def _funcion_visible(self, modulo: str, nombre: str) -> tuple[str, str] | None:
        if (modulo, nombre) in self.funciones:
            return (modulo, nombre)
        origen = self.importados.get(modulo, {}).get(nombre)
        if origen and origen in self.funciones:
            return origen
        return None

    def _tipos_locales(self, cuerpo: ast.AST, modulo: str) -> dict[str, str]:
        """`servicio = PagoServicio(db)` -> `{"servicio": "PagoServicio"}`.

        Es la forma que usa `membresias_pagos_router.py::subir_voucher`, el
        primer sitio que se corrigió bien: sin esto, su llamada quedaría sin
        resolver y el candado no vería el único ejemplo correcto que ya
        existía.
        """
        tipos: dict[str, str] = {}
        for nodo in ast.walk(cuerpo):
            if not (isinstance(nodo, ast.Assign) and isinstance(nodo.value, ast.Call)):
                continue
            constructor = nodo.value.func
            if isinstance(constructor, ast.Name) and self._clase_visible(modulo, constructor.id):
                for destino in nodo.targets:
                    if isinstance(destino, ast.Name):
                        tipos[destino.id] = constructor.id
        return tipos

    def destino(
        self, invocable: ast.expr, modulo: str, cualificado: str, tipos: dict[str, str],
    ) -> tuple[str, str] | None:
        """El nodo del grafo al que apunta `invocable`, o None si no se resuelve.

        `invocable` es lo que se llama (`nodo.func` de una `ast.Call`) o lo que
        se pasa por referencia a `run_in_threadpool`. Las dos formas se
        resuelven igual: la diferencia entre bloquear y no bloquear está en si
        hay una `ast.Call` alrededor, no en la expresión misma.
        """
        if isinstance(invocable, ast.Name):
            clase = self._clase_visible(modulo, invocable.id)
            if clase:
                # Un constructor: el nodo es `Clase.__init__` si existe.
                return (clase[0], clase[1]["__init__"]) if "__init__" in clase[1] else None
            return self._funcion_visible(modulo, invocable.id)

        if not isinstance(invocable, ast.Attribute):
            return None

        receptor, atributo = invocable.value, invocable.attr

        # `self.metodo(...)`: la clase que encierra a la función actual.
        if isinstance(receptor, ast.Name) and receptor.id == "self":
            if "." not in cualificado:
                return None
            propia = cualificado.split(".")[0]
            metodos = self.clases.get(modulo, {}).get(propia, {})
            return (modulo, metodos[atributo]) if atributo in metodos else None

        # `Clase(...).metodo(...)`: la forma canónica de los routers.
        if isinstance(receptor, ast.Call) and isinstance(receptor.func, ast.Name):
            clase = self._clase_visible(modulo, receptor.func.id)
            if clase and atributo in clase[1]:
                return (clase[0], clase[1][atributo])
            return None

        if isinstance(receptor, ast.Name):
            # `GestorAutenticacion.obtener_hash_contrasenia(...)`: método estático.
            clase = self._clase_visible(modulo, receptor.id)
            if clase and atributo in clase[1]:
                return (clase[0], clase[1][atributo])
            # Una variable con la clase inferida en esta misma función.
            inferida = tipos.get(receptor.id)
            if inferida:
                clase = self._clase_visible(modulo, inferida)
                if clase and atributo in clase[1]:
                    return (clase[0], clase[1][atributo])
            # `modulo.funcion(...)` sobre un `import modulo`.
            importado = self.modulos_importados.get(modulo, {}).get(receptor.id)
            if importado and (importado, atributo) in self.funciones:
                return (importado, atributo)
            origen = self.importados.get(modulo, {}).get(receptor.id)
            if origen:
                candidato = f"{origen[0]}.{origen[1]}"
                if (candidato, atributo) in self.funciones:
                    return (candidato, atributo)

        return None

    # --- grafo ------------------------------------------------------------
    def _construir_grafo(self):
        aristas: dict[tuple[str, str], set[tuple[str, str]]] = {}
        directos: set[tuple[str, str]] = set()
        for (modulo, cualificado), nodo in self.funciones.items():
            tipos = self._tipos_locales(nodo, modulo)
            salientes: set[tuple[str, str]] = set()
            for sub in ast.walk(nodo):
                if not isinstance(sub, ast.Call):
                    continue
                if _es_primitiva(sub.func):
                    directos.add((modulo, cualificado))
                    continue
                alcanzado = self.destino(sub.func, modulo, cualificado, tipos)
                if alcanzado is not None:
                    salientes.add(alcanzado)
            aristas[(modulo, cualificado)] = salientes
        return aristas, directos

    def _cerrar_transitivamente(self) -> frozenset[tuple[str, str]]:
        alcanzan = set(self.bloqueantes_directos)
        cambio = True
        while cambio:
            cambio = False
            for nodo, salientes in self.aristas.items():
                if nodo not in alcanzan and (salientes & alcanzan):
                    alcanzan.add(nodo)
                    cambio = True
        return frozenset(alcanzan)


MAPA = MapaDeLlamadas(_archivos_python())


def _handlers_async() -> list[tuple[str, ast.AsyncFunctionDef]]:
    encontrados = []
    for modulo, arbol in sorted(MAPA.arboles.items()):
        if not modulo.startswith(PAQUETE_ROUTERS):
            continue
        for nodo in arbol.body:
            if isinstance(nodo, ast.AsyncFunctionDef):
                encontrados.append((modulo, nodo))
    return encontrados


HANDLERS = _handlers_async()


def _infracciones() -> list[str]:
    """Cada `ast.Call` dentro de un handler que resuelve a algo bloqueante.

    Una llamada envuelta no aparece acá por construcción: `run_in_threadpool(f,
    ...)` pasa `f` SIN invocarlo, así que deja de ser una `ast.Call` cuyo
    destino sea `f`.
    """
    encontradas: list[str] = []
    for modulo, handler in HANDLERS:
        tipos = MAPA._tipos_locales(handler, modulo)
        for sub in ast.walk(handler):
            if not isinstance(sub, ast.Call):
                continue
            if _es_primitiva(sub.func):
                encontradas.append(
                    f"{modulo}:{sub.lineno} {handler.name} -> primitiva bloqueante directa"
                )
                continue
            alcanzado = MAPA.destino(sub.func, modulo, handler.name, tipos)
            if alcanzado in MAPA.bloqueantes:
                encontradas.append(
                    f"{modulo}:{sub.lineno} {handler.name} -> {alcanzado[0]}::{alcanzado[1]}"
                )
    return sorted(encontradas)


def _referencias_envueltas() -> list[tuple[str, str, tuple[str, str]]]:
    """Los callables bloqueantes que SÍ se pasan a `run_in_threadpool`.

    No participa de la regla; alimenta la meta-prueba que verifica que el
    resolvedor reconoce la forma correcta y no está mirando al vacío.
    """
    encontradas = []
    for modulo, handler in HANDLERS:
        tipos = MAPA._tipos_locales(handler, modulo)
        for sub in ast.walk(handler):
            if not (isinstance(sub, ast.Call) and isinstance(sub.func, ast.Name)):
                continue
            if sub.func.id != "run_in_threadpool" or not sub.args:
                continue
            alcanzado = MAPA.destino(sub.args[0], modulo, handler.name, tipos)
            if alcanzado in MAPA.bloqueantes:
                encontradas.append((modulo, handler.name, alcanzado))
    return encontradas


INFRACCIONES = _infracciones()
ENVUELTAS = _referencias_envueltas()


def test_ningun_handler_async_llama_directo_a_algo_bloqueante():
    assert INFRACCIONES == [], (
        "Estos `async def` de router llaman código bloqueante directamente sobre "
        "el event loop del único proceso de uvicorn, congelando a todo otro "
        "cliente mientras corren. Envolvé la llamada en `run_in_threadpool(...)` "
        "y dejá un comentario con el motivo, como en `auth_router.py::login` "
        "(#311) y `membresias_pagos_router.py::subir_voucher` (#450):\n  "
        + "\n  ".join(INFRACCIONES)
    )


class TestElCandadoMira:
    """Meta-pruebas: un candado que no encuentra nada pasa para siempre.

    Cada una de estas falla si el barrido, la resolución de receptores o el
    cierre transitivo se rompen -- que es exactamente cómo esta clase de
    prueba se vuelve decorativa sin que nadie lo note.
    """

    def test_barre_los_modulos_de_la_app(self):
        # Medido sobre este commit: 99 módulos y 682 funciones indexadas. La
        # cota es holgada a propósito -- lo que tiene que atrapar es un barrido
        # ROTO (que devuelve cero o un puñado), no un refactor que consolide
        # archivos.
        assert len(MAPA.arboles) >= 50

    def test_encuentra_handlers_async_en_los_routers(self):
        # Medido sobre este commit: 98 handlers `async def`. Misma clase de
        # cota holgada que la de arriba, y por el mismo motivo.
        assert len(HANDLERS) >= 60

    def test_encuentra_las_primitivas_bloqueantes_en_el_codigo(self):
        # Los CINCO puntos donde el bloqueo REALMENTE ocurre. Si un refactor
        # mueve o renombra alguno, esta prueba lo dice en vez de dejar al
        # candado vigilando un conjunto vacío. `verificar_contrasenia` entró
        # con `pwd_context.verify`: faltaba, y su ausencia escondía a
        # `personas_router::independizar_persona`.
        assert MAPA.bloqueantes_directos == {
            ("app.infraestructura.cloudinary_cliente", "_subir"),
            ("app.infraestructura.cloudinary_cliente", "eliminar_logo_sponsor"),
            ("app.seguridad.gestor_auth", "GestorAutenticacion.obtener_hash_contrasenia"),
            ("app.seguridad.gestor_auth", "GestorAutenticacion.verificar_contrasenia"),
            ("app.servicios_negocio.chatbot_servicio", "ChatbotServicio.consultar"),
        }

    def test_el_cierre_cruza_las_capas(self):
        # Cada uno de estos exige un salto que la resolución por nombre suelto
        # no puede dar: un import adentro del método (`actualizar_foto`), un
        # método estático de otra clase (`enroll` -> `obtener_hash_contrasenia`)
        # y un `self.metodo()` intermedio.
        assert {
            ("app.servicios_negocio.sponsor_servicio", "SponsorServicio.crear"),
            ("app.servicios_negocio.sponsor_servicio", "SponsorServicio.eliminar"),
            ("app.servicios_negocio.persona_servicio", "PersonaServicio.actualizar_foto"),
            ("app.servicios_negocio.auth_servicio", "AuthServicio.actualizar_foto_perfil"),
            ("app.servicios_negocio.enrollment_servicio", "EnrollmentServicio.enroll"),
            ("app.servicios_negocio.enrollment_servicio", "EnrollmentServicio._crear_usuario_alumno"),
            ("app.servicios_negocio.membresia_pago_servicio", "PagoServicio.adjuntar_voucher"),
            # Llega por `pwd_context.verify`, no por `hash`: es el salto que la
            # primera versión de `PRIMITIVAS_BLOQUEANTES` no podía dar.
            ("app.servicios_negocio.persona_servicio", "PersonaServicio.independizar"),
            ("app.servicios_negocio.auth_servicio", "AuthServicio.login"),
        } <= MAPA.bloqueantes

    def test_no_denuncia_a_un_handler_por_un_homonimo(self):
        """El contraejemplo que prueba que la resolución mira el RECEPTOR.

        La versión anterior de esta prueba afirmaba que
        `SponsorRepositorio.crear` -- homónimo de `SponsorServicio.crear` --
        quedara AFUERA del cierre. Eso no prueba nada: el cierre se propaga
        hacia atrás, así que un resolvedor roto no puede meterlo ni queriendo
        (no llama a nadie bloqueante). Recalculado con un resolvedor por
        nombre suelto, seguía afuera mientras el cierre se inflaba de 24 a 76
        nodos: la prueba pasaba igual de rota.

        Lo que un resolvedor así sí ensucia son los LLAMADORES. `POST
        /descuentos/` llama a `DescuentoServicio(db).crear(...)` -- la misma
        forma `Clase(db).metodo(...)` que usa el sponsor, con el mismo nombre
        `crear`, y sin subir nada a ninguna parte. Por nombre suelto queda
        denunciado (junto a otros 15 handlers), y esta prueba se pone roja.
        """
        # La colisión tiene que EXISTIR para que esto discrimine: si el sponsor
        # dejara de llamarse `crear`, la prueba pasaría por no tener enfrente
        # el caso que dice vigilar.
        assert ("app.servicios_negocio.sponsor_servicio",
                "SponsorServicio.crear") in MAPA.bloqueantes
        assert ("app.servicios_negocio.descuento_servicio",
                "DescuentoServicio.crear") in MAPA.funciones

        assert ("app.servicios_negocio.descuento_servicio",
                "DescuentoServicio.crear") not in MAPA.bloqueantes

        denunciados = {infraccion.split(" ")[1] for infraccion in INFRACCIONES}
        assert "crear_descuento" not in denunciados, (
            "`POST /descuentos/` quedó denunciado: no llama a nada bloqueante, "
            "solo a un método que se llama igual que uno que sí lo hace. Es el "
            "síntoma de que la resolución dejó de mirar el receptor."
        )

    def test_el_cierre_no_se_desborda(self):
        # El desborde por nombres no se ve en un nodo suelto sino en el tamaño:
        # medido sobre este commit, el cierre son 24 de 682 funciones (3,5%);
        # con un resolvedor por nombre suelto salta a 76 (11,1%). Un décimo del
        # backend es el techo que separa a los dos, y la cota es una FRACCIÓN
        # para que siga significando lo mismo cuando el backend crezca.
        assert len(MAPA.bloqueantes) < len(MAPA.funciones) // 10

    def test_reconoce_la_forma_correcta(self):
        # Los sitios ya corregidos antes de este candado (#311, #450, #834) más
        # los de #826/#835. Si el resolvedor dejara de entender la referencia
        # que se le pasa a `run_in_threadpool`, esta lista quedaría vacía y la
        # regla de arriba pasaría por la razón equivocada.
        #
        # Medido sobre este commit: 13 referencias envueltas. La cota estaba en
        # 9 cuando eran 11, y ya no mordía; se sube a lo medido. Envolver un
        # sitio nuevo la deja verde (solo puede crecer); DESENVOLVER uno, o
        # perder una primitiva de la lista, la pone roja.
        assert len(ENVUELTAS) >= 13
        nombres = {(modulo.split(".")[-1], handler) for modulo, handler, _ in ENVUELTAS}
        assert ("membresias_pagos_router", "subir_voucher") in nombres
        assert ("chatbot_router", "consultar") in nombres
