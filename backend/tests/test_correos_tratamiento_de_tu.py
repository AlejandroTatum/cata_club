"""
Todo correo (y su asunto) trata al lector de "usted", jamás de voseo ni tuteo
(QA3, GAP-03). El club está en Ecuador; los correos mezclaban "usted" con
"copiá", "podés" y "tu cuenta".

Es una guarda de USO, no una lista de mensajes: recorre los literales de texto
de los módulos que arman correos y avisos para la persona, de modo que una
plantilla nueva con voseo falla sin que nadie recuerde agregarla acá. Los
docstrings y comentarios quedan fuera: hablan de código, no al lector.
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

# TEMPORAL (QA4 W3-0): durante el barrido de registro de la ola 3 solo se veta
# el voseo; «usted» y «tú» pasan. W3-6 cambia este candado (y el del frontend)
# para exigir «tú».
# Imperativos y presentes de voseo.
VOSEO_Y_TUTEO = re.compile(
    r"\b(?:"
    r"vos|sos|tenés|podés|querés|sabés|debés|necesitás|"
    r"hacé|ingresá|revisá|copiá|usá|elegí|mirá|esperá|intentá|volvé|"
    r"confirmá|verificá|presioná|escribinos|acercate|fijate|avisanos|"
    r"contactanos|cargá|subí|seleccioná|completá"
    r")\b",
    re.IGNORECASE,
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
def test_ningun_literal_de_correo_usa_voseo(modulo):
    ruta = RAIZ / modulo
    infracciones = [
        f"{modulo}:{linea}: «{m.group(0)}» en {texto[:60]!r}"
        for linea, texto in _literales(ruta)
        for m in VOSEO_Y_TUTEO.finditer(texto)
    ]
    assert not infracciones, "No use voseo:\n" + "\n".join(infracciones)


def test_el_detector_reconoce_el_voseo_que_ya_se_filtro():
    for frase in (
        "copiá este enlace",
        "podés ignorarlo",
        "vos sos",
        "avisanos",
    ):
        assert VOSEO_Y_TUTEO.search(frase), frase
    for frase in (
        "copie este enlace", "puede ignorarlo", "su cuenta", "podrá verla",
        "copia este enlace", "puedes ignorarlo", "tu cuenta", "te avisaremos",
    ):
        assert not VOSEO_Y_TUTEO.search(frase), frase
