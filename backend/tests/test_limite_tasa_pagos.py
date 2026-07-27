"""
Guardia estructural de rate limiting en rutas de pagos (PR-08,
sdd/production-readiness, REQ-SEC-4).

Por qué esto es estructural (inspecciona texto fuente) y NO un test de
comportamiento en runtime (N+1 request -> 429): en `AMBIENTE=test` el
limiter activo es `_NoOpLimiter` (ver `rate_limit.py`), cuyo decorador
descarta el argumento de tasa por completo y devuelve la función SIN
envolver -- no queda ningún atributo inspeccionable en runtime para
verificarlo, y las CINCO rutas ya existentes (login, registro, refrescar,
recuperar/restablecer-contraseña, autoinscripción) tampoco tienen cobertura
de comportamiento 429 por el mismo motivo. Este archivo sigue ese mismo
patrón ya establecido: confirma que el decorador `@limiter.limit(...)` está
presente con el valor esperado, análogo al guardia de
`test_guardia_autorizacion_rutas.py`.
"""
import inspect
import re

import pytest

from app.presentacion.routers import auth_router, enrollment_router, membresias_pagos_router


def _limite_declarado(modulo, nombre_funcion: str) -> str | None:
    codigo_fuente = inspect.getsource(modulo)
    patron = re.compile(
        rf'@limiter\.limit\("(?P<valor>[^"]+)"\)\s*\n\s*async def {nombre_funcion}\('
    )
    coincidencia = patron.search(codigo_fuente)
    return coincidencia.group("valor") if coincidencia else None


# --- Rutas nuevas cubiertas por esta PR (antes sin ningún rate limit) -------
@pytest.mark.parametrize("nombre_funcion,limite_esperado", [
    ("registrar_pago", "10/minute"),
    ("subir_voucher", "5/minute"),
    ("validar_pago", "20/minute"),
    ("adjuntar_comprobante", "20/minute"),
])
def test_ruta_de_pagos_declara_el_limite_de_tasa_esperado(nombre_funcion, limite_esperado):
    assert _limite_declarado(membresias_pagos_router, nombre_funcion) == limite_esperado


# --- Regresión: límites ya existentes, sin tocar por esta PR ----------------
@pytest.mark.parametrize("modulo,nombre_funcion,limite_esperado", [
    (auth_router, "login", "5/minute"),
    (auth_router, "registro", "3/minute"),
    (auth_router, "refrescar", "10/minute"),
    (auth_router, "solicitar_recuperacion", "3/minute"),
    (auth_router, "restablecer_contrasenia", "5/minute"),
    (enrollment_router, "autoinscribir", "3/minute"),
])
def test_ruta_existente_conserva_su_limite_de_tasa(modulo, nombre_funcion, limite_esperado):
    assert _limite_declarado(modulo, nombre_funcion) == limite_esperado
