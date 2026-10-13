"""
La fecha de fundación del club vive en DOS lugares porque son dos lenguajes:
`FECHA_FUNDACION_CLUB` (backend, valida «Miembro desde», issue #1749) y
`FOUNDING_DATE` (frontend, `landing-config.ts`, la publica la landing). Este
candado hace que no se puedan separar sin que algo falle.
"""
import re
from datetime import date
from pathlib import Path

import pytest

from app.dominio.reglas_negocio import FECHA_FUNDACION_CLUB

LANDING_CONFIG = Path(__file__).resolve().parents[2] / "frontend/src/app/landing/landing-config.ts"


@pytest.mark.skipif(not LANDING_CONFIG.exists(), reason="el checkout no incluye el frontend")
def test_la_fecha_de_fundacion_del_backend_es_la_de_la_landing():
    fuente = LANDING_CONFIG.read_text(encoding="utf-8")
    coincidencia = re.search(
        r"FOUNDING_DATE\s*=\s*\{\s*year:\s*(\d+),\s*month:\s*(\d+),\s*day:\s*(\d+)\s*\}", fuente
    )

    assert coincidencia, "no se encontró FOUNDING_DATE en landing-config.ts"
    assert date(*(int(parte) for parte in coincidencia.groups())) == FECHA_FUNDACION_CLUB
