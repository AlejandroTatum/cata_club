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
    # `(?:async )?def`: antes hardcodeaba `async def` y devolvía `None` en
    # silencio para los endpoints SÍNCRONOS ya decorados (`listar_personas`,
    # `listar_pagos`, `reporte_pagos`, `obtener_estadisticas_membresias`,
    # `listar_horarios`) -- el guardia nunca los cubrió pese a existir.
    patron = re.compile(
        rf'@limiter\.limit\("(?P<valor>[^"]+)"\)\s*\n\s*(?:async )?def {re.escape(nombre_funcion)}\('
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
#
# Los valores anónimos subieron en sdd/api-abuse-protection (Slice 0): con la
# clave de rate limit anterior (`get_remote_address`), CADA uno de estos
# endpoints era un tope compartido por el club entero (un solo BFF = una sola
# IP), no un límite por persona. Siguen siendo topes GLOBALES para siempre --
# `/auth/refresh` recibe el token en el body, y estos endpoints son
# anónimos por diseño -- así que los valores bajos de antes no frenaban
# ningún ataque real: solo dejaban a todo el club afuera si un socio se
# equivocaba de contraseña. Ver diseño D3 para el detalle completo.
@pytest.mark.parametrize("modulo,nombre_funcion,limite_esperado", [
    (auth_router, "login", "60/minute"),
    (auth_router, "registro", "20/minute"),
    (auth_router, "refrescar", "120/minute"),
    (auth_router, "solicitar_recuperacion", "10/minute"),
    (auth_router, "restablecer_contrasenia", "20/minute"),
    (enrollment_router, "autoinscribir", "10/minute"),
])
def test_ruta_existente_conserva_su_limite_de_tasa(modulo, nombre_funcion, limite_esperado):
    assert _limite_declarado(modulo, nombre_funcion) == limite_esperado


# --- Cobertura directa del fix de `_limite_declarado` -----------------------
#
# Ningún endpoint SÍNCRONO está decorado todavía dentro del alcance de esta
# PR (los cinco que sí lo están -- `listar_personas`, `listar_pagos`,
# `reporte_pagos`, `obtener_estadisticas_membresias`, `listar_horarios` --
# reciben su `@limiter.limit(...)` en una PR posterior), así que el fix del
# regex no tiene ningún caso real en los routers para ejercitarlo todavía.
# Estas dos pruebas fijan el comportamiento del propio `_limite_declarado`
# contra texto fuente sintético, en vez de dejar el fix sin cobertura hasta
# que exista un endpoint sync real que lo dispare.
def test_limite_declarado_reconoce_endpoints_sincronos(monkeypatch):
    codigo_fuente_sincrono = (
        '@limiter.limit("60/minute")\n'
        'def listar_personas(request: Request):\n'
        '    ...\n'
    )
    monkeypatch.setattr(inspect, "getsource", lambda _modulo: codigo_fuente_sincrono)
    assert _limite_declarado(object(), "listar_personas") == "60/minute"


def test_limite_declarado_sigue_reconociendo_endpoints_asincronos(monkeypatch):
    codigo_fuente_asincrono = (
        '@limiter.limit("60/minute")\n'
        'async def login(request: Request):\n'
        '    ...\n'
    )
    monkeypatch.setattr(inspect, "getsource", lambda _modulo: codigo_fuente_asincrono)
    assert _limite_declarado(object(), "login") == "60/minute"
