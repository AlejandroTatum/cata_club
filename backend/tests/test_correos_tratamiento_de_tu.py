"""
Todo correo (y su asunto) trata al lector de "tú", jamás de "usted" ni de voseo
(QA4 S6, ola 3; antes de QA4 este candado exigía "usted" -- QA3, GAP-03). El
club está en Ecuador y el dueño pidió «tutemos sin problema» en toda la app: los
correos mezclaban "usted" con "copiá", "podés" y "tu cuenta".

Es una guarda de USO, no una lista de mensajes: recorre los literales de texto
de los módulos que arman correos y avisos para la persona, de modo que una
plantilla nueva con "usted" o con voseo falla sin que nadie recuerde agregarla
acá. Los docstrings y comentarios quedan fuera: hablan de código, no al lector.

Además de los módulos de correo, `test_ningun_literal_de_la_app_usa_usted_ni_voseo`
recorre todo `app/` con `USTED_EN_LA_APP`: los mensajes de dominio y de
validación también le llegan al lector, y la lista de módulos de correo dejó
pasar «apruébelas» y «la que va a dejar» por quedar fuera de ella.
"""
import ast
import re
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[1] / "app"

# Módulos cuyos literales llegan a una persona por correo o aviso de cuenta.
MODULOS = [
    "infraestructura/plantillas_correo.py",
    "infraestructura/asuntos_correo.py",
    "infraestructura/notificaciones_servicio.py",
    "infraestructura/generador_pdf.py",
    "infraestructura/tareas/alertas_tareas.py",
    "infraestructura/tareas/recordatorio_sesion_tareas.py",
    "servicios_negocio/relacion_representacion_servicio.py",
]

# Voseo: imperativos y presentes rioplatenses.
VOSEO = re.compile(
    r"\b(?:"
    r"vos|sos|tenés|podés|querés|sabés|debés|necesitás|"
    r"hacé|ingresá|revisá|copiá|usá|elegí|mirá|esperá|intentá|volvé|"
    r"confirmá|verificá|presioná|escribinos|acercate|fijate|avisanos|"
    r"contactanos|cargá|subí|seleccioná|completá"
    r")\b",
    re.IGNORECASE,
)

# Trato de "usted" en los módulos de correo (`MODULOS`): el pronombre y los
# imperativos/presentes que lo delatan. Es una lista de formas, no una regla
# morfológica: una orden que no esté escrita aquí no se detecta (fue el hueco
# de «apruébelas» y «alárguela»); por eso `USTED_EN_LA_APP`, más abajo, la
# completa y se aplica a todo `app/`.
# «su» y «sus» NO se vetan: también es el posesivo de tercera persona («su
# representante»), y ahí es correcto.
USTED = re.compile(
    r"\b(?:"
    r"usted(?:es)?|"
    r"intente|ingrese|revise|verifique|comuníquese|acérquese|escríbanos|elija|"
    r"espere|reinicie|contacte|indique|regularice|registre|genere|consulte|"
    r"confirme|copie|ignore|adjunte|haga|escriba|seleccione|recuerde|"
    r"solicite|vuelva|puede ignorarlo|le damos|le informamos|le avisamos|"
    r"le enviamos|recibirá|verá|podrá"
    r")\b",
    re.IGNORECASE,
)

TRATO_INCORRECTO = re.compile(f"{VOSEO.pattern}|{USTED.pattern}", re.IGNORECASE)

# Usted en CUALQUIER literal del backend (mensajes de dominio, validación,
# avisos de servicio, no solo correos). Es más angosto que `USTED` a propósito:
# fuera de los correos hay subjuntivos de tercera persona legítimos ("que lo
# haga", "que su dueño elija", "no se puede enviar"), así que «haga», «elija»,
# «ignore» y «puede enviar» NO van aquí. Lo que sí va: los imperativos de
# usted, incluso con clítico («apruébelas», «alárguela»), y «va a dejar». El
# lookaround excluye guiones y letras para no leer "do-not-use-in-production"
# como la orden «use».
USTED_EN_LA_APP = re.compile(
    r"(?<![-\w])(?:"
    r"usted(?:es)?|intente|ingrese|revise|verifique|comuníquese|acérquese|"
    r"escríbanos|espere|reinicie|contacte|indique|regularice|registre|genere|"
    r"consulte|confirme|copie|adjunte|escriba|seleccione|recuerde|solicite|"
    r"vuelva|use|suba|cargue|envíe|corrija|elimine|guarde|actualice|pruebe|"
    r"complete|pida|busque|agregue|presione|continúe|acepte|reduzca|"
    r"evite|mezcle|gestione|reasigne|"
    r"apruébel[aeo]s?|alárguel[aeo]s?|"
    r"va a dejar|puede continuar|"
    r"le damos|le informamos|le avisamos|le enviamos|recibirá|verá|podrá"
    r")(?![-\w])",
    re.IGNORECASE,
)
TRATO_INCORRECTO_EN_LA_APP = re.compile(
    f"(?:{VOSEO.pattern})|(?:{USTED_EN_LA_APP.pattern})", re.IGNORECASE
)


def _literales(ruta: Path):
    arbol = ast.parse(ruta.read_text(encoding="utf-8"))
    docstrings = set()
    for nodo in ast.walk(arbol):
        if isinstance(nodo, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            cuerpo = nodo.body
            if (
                cuerpo
                and isinstance(cuerpo[0], ast.Expr)
                and isinstance(cuerpo[0].value, ast.Constant)
            ):
                docstrings.add(id(cuerpo[0].value))
    for nodo in ast.walk(arbol):
        if (
            isinstance(nodo, ast.Constant)
            and isinstance(nodo.value, str)
            and id(nodo) not in docstrings
        ):
            yield nodo.lineno, nodo.value


@pytest.mark.parametrize("modulo", MODULOS)
def test_ningun_literal_de_correo_usa_usted_ni_voseo(modulo):
    ruta = RAIZ / modulo
    infracciones = [
        f"{modulo}:{linea}: «{m.group(0)}» en {texto[:60]!r}"
        for linea, texto in _literales(ruta)
        for m in TRATO_INCORRECTO.finditer(texto)
    ]
    assert not infracciones, "Trate de tú, sin usted ni voseo:\n" + "\n".join(infracciones)


def _modulos_de_la_app():
    return sorted(
        ruta.relative_to(RAIZ).as_posix()
        for ruta in RAIZ.rglob("*.py")
        if "__pycache__" not in ruta.parts
    )


@pytest.mark.parametrize("modulo", _modulos_de_la_app())
def test_ningun_literal_de_la_app_usa_usted_ni_voseo(modulo):
    """El candado de los correos solo miraba su lista de módulos, y por eso
    «apruébelas» (membresia_pago_servicio) y «la que va a dejar»
    (asistencia_servicio) pasaron: no estaban en esa lista. Esta versión
    recorre todo `app/`. Los literales sin espacios (valores de configuración,
    claves) no son texto para una persona y se saltan."""
    infracciones = [
        f"{modulo}:{linea}: «{m.group(0)}» en {texto[:60]!r}"
        for linea, texto in _literales(RAIZ / modulo)
        if " " in texto
        for m in TRATO_INCORRECTO_EN_LA_APP.finditer(texto)
    ]
    assert not infracciones, "Trate de tú, sin usted ni voseo:\n" + "\n".join(infracciones)


def test_el_detector_de_la_app_reconoce_los_restos_de_usted():
    for frase in (
        "Registra renovaciones por el flujo regular y apruébelas desde la cola",
        "Elige una categoría distinta de la que va a dejar.",
        "Use al menos 8 caracteres",
        "para que sea segura, alárguela o mezcle números",
        "Evite las contraseñas comunes",
        "Puede continuar si es intencional.",
    ):
        assert TRATO_INCORRECTO_EN_LA_APP.search(frase), frase
    for frase in (
        "apruébalas desde la cola de validación",
        "la que vas a dejar",
        "Usa al menos 8 caracteres",
        "do-not-use-in-production",
        "Pídele a otro administrador que lo haga.",
        "requiere que su dueño elija qué rol conservar",
        "no se puede enviar correo real",
        "Puedes continuar si es intencional.",
    ):
        assert not TRATO_INCORRECTO_EN_LA_APP.search(frase), frase


def test_el_detector_reconoce_el_usted_y_el_voseo_que_ya_se_filtraron():
    for frase in (
        "copiá este enlace",
        "podés ignorarlo",
        "vos sos",
        "avisanos",
        "copie este enlace",
        "Si usted no se registró",
        "Le damos la bienvenida",
        "verá el motivo",
    ):
        assert TRATO_INCORRECTO.search(frase), frase
    for frase in (
        "copia este enlace", "puedes ignorarlo", "tu cuenta", "te avisaremos",
        "su representante", "Te damos la bienvenida", "verás el motivo",
    ):
        assert not TRATO_INCORRECTO.search(frase), frase
