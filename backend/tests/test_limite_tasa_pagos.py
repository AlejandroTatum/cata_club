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


def _inventario_declarado(modulo) -> dict[str, str]:
    """Recolecta TODOS los pares (función, límite declarado) de un router, en
    vez de consultar función por función. Es lo que hace al guardia exigente:
    una aserción de PRESENCIA ("estas N rutas declaran esto") no detecta un
    límite que desaparece -- basta con que las que quedan sigan matcheando.
    Una aserción de IGUALDAD DE CONJUNTO exacta sí lo detecta, porque el lado
    "actual" también se achica. `_limite_declarado` arriba se mantiene tal
    cual (y sus pruebas directas, sin tocar) porque sigue siendo la única vía
    de cobertura directa del propio regex."""
    codigo_fuente = inspect.getsource(modulo)
    patron = re.compile(
        r'@limiter\.limit\("(?P<valor>[^"]+)"\)\s*\n\s*(?:async )?def (?P<nombre>\w+)\('
    )
    return {m.group("nombre"): m.group("valor") for m in patron.finditer(codigo_fuente)}


# --- Inventario EXACTO de límites declarados, por router ---------------------
#
# Reemplaza los dos guardias por subconjunto que existían antes (uno para las
# rutas nuevas de pagos, otro de regresión para auth/enrollment): ambos solo
# confirmaban que las rutas listadas seguían ahí con el valor correcto, así
# que si alguien borraba un `@limiter.limit(...)` sin querer -- o lo movía a
# la función equivocada -- el guardia seguía en verde mientras el resto de la
# lista matcheara. La igualdad de conjunto exacta contra `_inventario_declarado`
# cierra ese hueco: agregar o quitar CUALQUIER decorador en estos routers
# rompe esta prueba hasta que el diccionario esperado se actualice a
# propósito. PR3-PR5 extienden este mismo diccionario router por router --
# ver `sdd/api-abuse-protection/tasks`.
_INVENTARIO_ESPERADO: dict[object, dict[str, str]] = {
    auth_router: {
        "login": "60/minute",
        "registro": "20/minute",
        "actualizar_perfil_propio": "10/minute",
        "actualizar_foto_perfil": "10/minute",
        "refrescar": "120/minute",
        "invalidar_sesiones": "5/minute",
        "solicitar_recuperacion": "10/minute",
        "restablecer_contrasenia": "20/minute",
    },
    enrollment_router: {
        "autoinscribir": "10/minute",
    },
    membresias_pagos_router: {
        "registrar_pago": "10/minute",
        "validar_pago": "20/minute",
        "adjuntar_comprobante": "20/minute",
        "subir_voucher": "5/minute",
    },
}


@pytest.mark.parametrize("modulo", [auth_router, enrollment_router, membresias_pagos_router])
def test_inventario_exhaustivo_de_limites_de_tasa(modulo):
    assert _inventario_declarado(modulo) == _INVENTARIO_ESPERADO[modulo]


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
