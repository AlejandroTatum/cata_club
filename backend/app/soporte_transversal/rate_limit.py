"""Configuración global de rate limiting.

Se comparte entre main.py (handler global) y los routers (decoradores).
En ambiente de test se usa un NoOpLimiter para no afectar los tests.
"""

import jwt
from slowapi import Limiter
from slowapi.util import get_remote_address
from starlette.requests import Request

from app.soporte_transversal.configuracion import settings

# Namespaces disjuntos para que las claves del limiter sean grepeables y no
# puedan colisionar entre sí (un `sub` nunca empieza con "ip:" ni viceversa).
PREFIJO_USUARIO = "usuario:"
PREFIJO_IP = "ip:"


class _NoOpLimiter:
    """Limiter que no hace nada — usado en ambiente de test."""

    def limit(self, *_args, **_kwargs):
        def decorator(func):
            return func
        return decorator


def clave_cliente(request: Request) -> str:
    """Clave del rate limiter: por usuario autenticado, o por IP remota
    (compartida por todo el tráfico anónimo -- ver diseño D3) en cualquier
    otro caso.

    Espeja SOLO la regla de decodificación de
    `GestorAutenticacion.decodificar_token` (firma HS256 pinneada vía
    `settings.jwt_algoritmo` + `type == "access"`), sin repetir la consulta
    a BD que esa dependencia hace (`UsuarioRepositorio.obtener_por_correo` +
    `sesion_vigente`). No puede reusarse esa dependencia: es un
    `Depends(...)` de FastAPI que exige una `Session`, y slowapi llama a
    `key_func(request)` de forma sincrónica, sin inyección de dependencias.

    Confiar en un claim `sub` SIN verificar la firma sería estrictamente
    peor que la clave global de hoy: un atacante podría acuñar `sub`
    aleatorios y obtener un cubo nuevo por request. La verificación de firma
    es, por eso, el argumento de seguridad completo de esta función -- ver
    diseño D1.

    NUNCA lanza: slowapi no tiene ruta de error para `key_func`, así que
    cualquier excepción acá se convertiría en un 500 en cada request.
    """
    autorizacion = request.headers.get("authorization", "")
    esquema, _, token = autorizacion.partition(" ")
    if esquema.lower() == "bearer" and token:
        try:
            payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algoritmo])
        except jwt.PyJWTError:
            payload = None
        if payload is not None and payload.get("type") == "access":
            sub = payload.get("sub")
            if isinstance(sub, str) and sub:
                return f"{PREFIJO_USUARIO}{sub}"
    return f"{PREFIJO_IP}{get_remote_address(request)}"


def _crear_limiter() -> Limiter | _NoOpLimiter:
    if settings.ambiente == "test":
        return _NoOpLimiter()
    return Limiter(key_func=clave_cliente)


limiter = _crear_limiter()
