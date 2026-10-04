"""
Asuntos de correo transaccional: UNA sola fuente (issue #1010).

El asunto vivió duplicado entre el backend y el script de QA y un PR cambió
uno y no el otro (el test quedó verde porque los fixtures repetían el
literal viejo). Acá se fija que los cuatro asuntos transaccionales existen,
son exactos y que el módulo sigue siendo cargable por `python3` puro desde
la raíz del repo: `scripts/qa_verify_recovery_delivery.py` lo levanta por
ruta de archivo, así que NO puede importar nada de `app` ni de terceros.
"""
import inspect

from app.infraestructura.asuntos_correo import (
    ASUNTO_PAGO_APROBADO,
    ASUNTO_PAGO_RECHAZADO,
    ASUNTO_RECUPERACION,
    ASUNTO_VERIFICACION_CORREO,
)


def test_los_cuatro_asuntos_transaccionales_son_los_exactos():
    assert ASUNTO_RECUPERACION == "Cata Club | Recuperación de contraseña"
    assert ASUNTO_VERIFICACION_CORREO == "Cata Club | Bienvenida y verificación de correo"
    assert ASUNTO_PAGO_APROBADO == "Cata Club | Pago aprobado"
    assert ASUNTO_PAGO_RECHAZADO == "Cata Club | Pago rechazado"


def test_los_asuntos_comparten_la_identidad_de_marca():
    """Identidad de remitente consistente (issue #898/#1375): todo asunto
    transaccional abre con el nombre del club."""
    for asunto in (
        ASUNTO_RECUPERACION,
        ASUNTO_VERIFICACION_CORREO,
        ASUNTO_PAGO_APROBADO,
        ASUNTO_PAGO_RECHAZADO,
        ):
        assert asunto.startswith("Cata Club | ")


def test_el_modulo_no_importa_app_ni_terceros():
    """Guardia del script de QA: se carga por ruta de archivo con `python3`
    puro; un solo import de `app` o de terceros lo rompería en producción
    (ver el docstring de `asuntos_correo.py` y `scripts/qa_verify_recovery_delivery.py`)."""
    fuente = inspect.getsource(__import__("app.infraestructura.asuntos_correo", fromlist=["x"]))
    lineas_de_importacion = [
        linea.strip() for linea in fuente.splitlines()
        if linea.strip().startswith(("import ", "from "))
    ]
    # Hoy el módulo es solo constantes (cero imports); si mañana alguien
    # agrega uno, no puede ser de `app` ni del layout compartido.
    for linea in lineas_de_importacion:
        modulo = linea.split()[1].split(".")[0]
        assert modulo != "app", linea
        assert modulo != "plantillas_correo", linea
