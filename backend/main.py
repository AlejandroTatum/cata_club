from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from starlette.middleware.base import BaseHTTPMiddleware

from app.soporte_transversal.configuracion import settings, urls_documentacion
from app.soporte_transversal.rate_limit import limiter
from app.presentacion.routers import (
    auth_router,
    personas_router,
    membresias_pagos_router,
    asistencias_router,
    ficha_medica_router,
    geografia_router,
    ranking_router,
    enrollment_router,
    dashboard_router,
    chatbot_router,
)
from app.dominio.excepciones import (
    EntidadNoEncontrada, EntidadDuplicada, OperacionInvalida,
    CredencialesInvalidas, PermisosInsuficientes,
)

# `urls_documentacion` apaga /docs, /redoc y /openapi.json solo cuando
# AMBIENTE=production; en development y test siguen encendidas (PR-10b).
app = FastAPI(
    title=settings.app_nombre,
    version=settings.app_version,
    **urls_documentacion(settings.ambiente),
)

# --- Rate limiting -----------------------------------------------------------
# Se deshabilita en ambiente de test (limiter es NoOpLimiter, ver rate_limit.py).
if settings.ambiente != "test":
    from slowapi import _rate_limit_exceeded_handler
    from slowapi.errors import RateLimitExceeded
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


# --- Respuesta de error consistente para frontend + backend -----------------
# El frontend (Next.js) espera `message`; el backend original usa `detail`.
# Devolvemos ambos para compatibilidad sin romper contratos existentes.
def _respuesta_error(codigo: int, mensaje: str) -> JSONResponse:
    return JSONResponse(status_code=codigo, content={"detail": mensaje, "message": mensaje})


# --- Manejadores globales: traducen excepciones de dominio a códigos HTTP ---
_MAPA_EXCEPCIONES = {
    EntidadNoEncontrada: status.HTTP_404_NOT_FOUND,
    EntidadDuplicada: status.HTTP_400_BAD_REQUEST,
    OperacionInvalida: status.HTTP_400_BAD_REQUEST,
    CredencialesInvalidas: status.HTTP_401_UNAUTHORIZED,
    PermisosInsuficientes: status.HTTP_403_FORBIDDEN,
}

for _excepcion, _codigo in _MAPA_EXCEPCIONES.items():
    def _crear_handler(codigo):
        async def _handler(request: Request, exc):
            return _respuesta_error(codigo, exc.mensaje)
        return _handler
    app.add_exception_handler(_excepcion, _crear_handler(_codigo))


# --- HTTPException de FastAPI también devuelve {detail, message} ------------
@app.exception_handler(HTTPException)
async def _http_exception_handler(request: Request, exc: HTTPException):
    return _respuesta_error(exc.status_code, str(exc.detail))

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origenes,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept"],
)


# --- Cabeceras de seguridad ---------------------------------------------
# Esta API solo devuelve JSON, así que un CSP de `default-src 'none'` es
# seguro (no hay HTML/JS propio que necesite cargar nada).
class _CabecerasDeSeguridadMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        respuesta: Response = await call_next(request)
        respuesta.headers["X-Content-Type-Options"] = "nosniff"
        respuesta.headers["X-Frame-Options"] = "DENY"
        respuesta.headers["Referrer-Policy"] = "no-referrer"
        respuesta.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
        respuesta.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
        return respuesta


# Registrado DESPUÉS (más abajo) del CORSMiddleware de arriba, a propósito:
# `add_middleware` de Starlette antepone cada middleware nuevo a la pila, así
# que el ÚLTIMO registrado queda MÁS AFUERA. Esta es la única posición que
# post-procesa TODAS las respuestas -- incluidas las de CORS, las de los 5
# manejadores de excepciones de dominio (arriba) y los 429 de rate limiting
# (ver decisión de diseño 2.4, sdd/production-readiness).
app.add_middleware(_CabecerasDeSeguridadMiddleware)

app.include_router(auth_router.router, prefix="/api/v1")
app.include_router(personas_router.router, prefix="/api/v1")
app.include_router(membresias_pagos_router.router, prefix="/api/v1")
app.include_router(asistencias_router.router, prefix="/api/v1")
app.include_router(ficha_medica_router.router, prefix="/api/v1")
app.include_router(geografia_router.router, prefix="/api/v1")
app.include_router(ranking_router.router, prefix="/api/v1")
app.include_router(enrollment_router.router, prefix="/api/v1")
app.include_router(dashboard_router.router, prefix="/api/v1")
app.include_router(chatbot_router.router, prefix="/api/v1")


@app.get("/", tags=["Salud"])
async def raiz():
    return {"mensaje": "API Cata Club operativa", "version": settings.app_version}


# --- Liveness probe -----------------------------------------------------
# Sin dependencias (ni BD ni auth) a propósito: es la sonda que usa el
# healthcheck de docker-compose.yml para decidir si reiniciar el contenedor.
# Antes ese healthcheck apuntaba a /docs (ver decisión de diseño 2.4/4.1,
# sdd/production-readiness); en producción /docs se deshabilita, así que
# necesitaba un reemplazo que no dependa de nada que pueda estar caído.
@app.get("/health", tags=["Salud"])
async def salud():
    return {"estado": "ok"}
