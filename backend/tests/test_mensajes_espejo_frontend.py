"""
Los mensajes que el backend y el frontend escriben igual, fijados en ambos lados.

Cada uno de estos textos vive en Python y se repite en TypeScript porque el
frontend decide o muestra por texto (la tarjeta de login, los enlaces de la
identidad duplicada, la validación del asistente de inscripción). Si cambia
uno solo, el otro lado deja de coincidir sin que ninguna prueba lo note: esta
suite lee los archivos del frontend y compara. Qué constante espeja a cuál
está escrito junto a cada una (`# Espejo verbatim de ...`).

`dominio/mensajes.py::MENSAJE_IDENTIDAD_DUPLICADA` ya lo fija
`test_mensajes_identidad_duplicada.py`.
"""
from pathlib import Path

import pytest

from app.dominio.telefono import MENSAJE_TELEFONO_EMERGENCIA_IGUAL
from app.servicios_negocio.auth_servicio import (
    MENSAJE_CUENTA_INACTIVA,
    MENSAJE_LOGIN_ENFRIAMIENTO,
)
from app.servicios_negocio.enrollment_servicio import (
    MENSAJE_CEDULA_REPRESENTANTE_IGUAL_ALUMNO,
)

FRONTEND = Path(__file__).resolve().parents[2] / "frontend" / "src"

# La imagen Docker del backend y el job de CI solo del backend no traen el
# árbol del frontend: sin él no hay nada que comparar. Con el árbol presente,
# la suite sigue siendo obligatoria.
pytestmark = pytest.mark.skipif(
    not FRONTEND.is_dir(),
    reason="el árbol del frontend no está presente (imagen o job solo de backend)",
)


def _fuente(ruta: str) -> str:
    return (FRONTEND / ruta).read_text(encoding="utf-8")


def test_la_cuenta_inactiva_se_lee_igual_en_la_tarjeta_de_login():
    # La tarjeta parte el mensaje en título y descripción; juntos son el texto.
    titulo, descripcion = MENSAJE_CUENTA_INACTIVA.split(". ", 1)
    login = _fuente("app/login/page.tsx")
    assert f'message: "{titulo}."' in login
    assert f'description: "{descripcion}"' in login


def test_el_enfriamiento_de_login_se_lee_igual_en_el_frontend():
    titulo, descripcion = MENSAJE_LOGIN_ENFRIAMIENTO.split(". ", 1)
    login = _fuente("app/login/page.tsx")
    assert f'message: "{titulo}."' in login
    assert f'description: "{descripcion}"' in login
    assert f'"{MENSAJE_LOGIN_ENFRIAMIENTO}"' in _fuente("lib/server/auth.ts")


def test_las_reglas_de_identidad_se_leen_igual_en_el_asistente():
    identidad = _fuente("lib/identity-validation.ts")
    assert f'"{MENSAJE_CEDULA_REPRESENTANTE_IGUAL_ALUMNO}"' in identidad
    assert f'"{MENSAJE_TELEFONO_EMERGENCIA_IGUAL}"' in identidad
