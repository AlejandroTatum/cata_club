import asyncio
import logging
import re
import time
import uuid

import redis
from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.pool import NullPool
from starlette.middleware.base import BaseHTTPMiddleware

from app.servicios_negocio.gestor_permisos import GestorPermisos
from app.soporte_transversal.circuito_breaker import resumen_circuitos
from app.soporte_transversal.configuracion import settings, urls_documentacion
from app.soporte_transversal.configuracion_logging import configurar_logging
from app.soporte_transversal.rate_limit import limiter
from app.presentacion.routers import (
    auth_router,
    personas_router,
    membresias_pagos_router,
    descuentos_router,
    asistencias_router,
    ficha_medica_router,
    geografia_router,
    notificaciones_router,
    enrollment_router,
    dashboard_router,
    chatbot_router,
    sponsors_router,
)
from app.dominio.excepciones import (
    EntidadNoEncontrada, EntidadDuplicada, OperacionInvalida,
    CredencialesInvalidas, PermisosInsuficientes, ServicioNoDisponible,
    ConflictoConcurrencia,
)

# Logging del proceso, ANTES de crear la app: uvicorn arranca sin
# `--log-config`, así que sin esto el raíz no tiene handlers y todo
# INFO/DEBUG de `cataclub.*` se pierde (issue #554). Idempotente: un
# re-import de main (suites de test) no vuelve a tocar los handlers.
configurar_logging()

# `urls_documentacion` apaga /docs, /redoc y /openapi.json solo cuando
# AMBIENTE=production; en development y test siguen encendidas (PR-10b).
_log = logging.getLogger(__name__)

app = FastAPI(
    title=settings.app_nombre,
    version=settings.app_version,
    **urls_documentacion(settings.ambiente),
)

# --- Respuesta de error consistente para frontend + backend -----------------
# El frontend (Next.js) espera `message`; el backend original usa `detail`.
# Devolvemos ambos para compatibilidad sin romper contratos existentes.
#
# `mensaje_seguro` (issue #355): por defecto `False` -- un 5xx nunca filtra
# `mensaje` al usuario salvo que la excepción que lo originó lo haya marcado
# explícitamente como seguro (`ErrorDominio.seguro_mostrar`, ver
# `excepciones.py`). El parámetro por defecto en `False` cubre además a
# cualquier caller que arme la respuesta sin pasar por una `ErrorDominio`
# (`HTTPException`, `RequestValidationError`, `IntegrityError` no manejado).
def _respuesta_error(codigo: int, mensaje: str, *, mensaje_seguro: bool = False) -> JSONResponse:
    return JSONResponse(
        status_code=codigo,
        content={"detail": mensaje, "message": mensaje, "mensaje_seguro": mensaje_seguro},
    )


# --- Rate limiting -----------------------------------------------------------
# Se deshabilita en ambiente de test (limiter es NoOpLimiter, ver rate_limit.py).
MENSAJE_LIMITE_EXCEDIDO = "Demasiadas solicitudes. Espere un momento e intente nuevamente."


def _manejador_limite_excedido(request: Request, exc: Exception) -> JSONResponse:
    """Reemplaza el handler default de slowapi (issue #235): ese devuelve
    `{"error": "Rate limit exceeded: ..."}`, que rompe la convención
    `{detail, message}` del resto de la API (ver `_respuesta_error` arriba,
    documentada en el contrato de este archivo), y nunca manda
    `Retry-After` -- el visitante no tenía forma de saber cuánto esperar.

    Calcula `Retry-After` a mano en vez de delegar en
    `Limiter._inject_headers` (lo que hace el handler default de slowapi):
    ese método exige `headers_enabled=True` en el `Limiter`, y prender eso
    globalmente (rate_limit.py) rompe con un 500 CUALQUIER respuesta
    EXITOSA de un endpoint decorado que no declare `response: Response` de
    más -- que es ninguno de los actuales (verificado con un `Limiter` real
    en tests/test_rate_limit_por_visitante.py). `Limiter.limiter` (la
    propiedad pública de slowapi que expone el `RateLimiter` de la librería
    `limits`) y `get_window_stats` son la misma llamada pública que usa
    `_inject_headers` internamente -- no hay nada privado acá.

    `request.state.view_rate_limit` ya está poblado en este punto: slowapi
    lo setea ANTES de lanzar `RateLimitExceeded`
    (ver `Limiter.__evaluate_limits` en slowapi/extension.py).

    Nunca deja que el cálculo del header tumbe el 429 en sí: si la vista del
    límite falta o el backend de storage falla, se responde igual, sin
    `Retry-After`, en vez de convertir un 429 legítimo en un 500.
    """
    respuesta = _respuesta_error(status.HTTP_429_TOO_MANY_REQUESTS, MENSAJE_LIMITE_EXCEDIDO)
    vista_limite = getattr(request.state, "view_rate_limit", None)
    if vista_limite:
        limite_item, identificadores = vista_limite
        try:
            momento_reinicio, _restantes = request.app.state.limiter.limiter.get_window_stats(
                limite_item, *identificadores
            )
            respuesta.headers["Retry-After"] = str(max(1, int(momento_reinicio - time.time()) + 1))
        except Exception:
            _log.warning("No se pudo calcular Retry-After para el 429", exc_info=True)
    return respuesta


if settings.ambiente != "test":
    from slowapi.errors import RateLimitExceeded
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _manejador_limite_excedido)


# --- Manejadores globales: traducen excepciones de dominio a códigos HTTP ---
_MAPA_EXCEPCIONES = {
    EntidadNoEncontrada: status.HTTP_404_NOT_FOUND,
    EntidadDuplicada: status.HTTP_400_BAD_REQUEST,
    OperacionInvalida: status.HTTP_400_BAD_REQUEST,
    CredencialesInvalidas: status.HTTP_401_UNAUTHORIZED,
    PermisosInsuficientes: status.HTTP_403_FORBIDDEN,
    ServicioNoDisponible: status.HTTP_503_SERVICE_UNAVAILABLE,
    ConflictoConcurrencia: status.HTTP_409_CONFLICT,
}

for _excepcion, _codigo in _MAPA_EXCEPCIONES.items():
    def _crear_handler(codigo):
        async def _handler(request: Request, exc):
            # `detalle_tecnico` es lo que el mensaje NO puede decir sin dejar
            # de estar escrito para un socio: los ids con los que se reproduce
            # el caso, el enum crudo, la ruta que falta llamar. Se registra
            # acá, en un solo lugar, así ningún servicio tiene que acordarse.
            # Nivel `info` y no `warning`: un 400 es el cliente mandando algo
            # que la regla no admite, no una falla del servidor.
            detalle = getattr(exc, "detalle_tecnico", None)
            if detalle:
                _log.info(
                    "%s en %s %s [request_id=%s]: %s",
                    type(exc).__name__,
                    request.method,
                    request.url.path,
                    getattr(request.state, "request_id", "-"),
                    detalle,
                )
            return _respuesta_error(
                codigo, exc.mensaje, mensaje_seguro=getattr(exc, "seguro_mostrar", False)
            )
        return _handler
    app.add_exception_handler(_excepcion, _crear_handler(_codigo))


# --- Último recurso: un IntegrityError nunca debería salir como 500 --------
# Defensa en profundidad, NO el arreglo de ningún caso concreto: los caminos
# conocidos ya lo tratan donde corresponde (`eliminacion_segura` lo traduce a
# `OperacionInvalida` en los borrados restringidos, y el upsert de nivel
# reintenta contra la fila que ganó la carrera, ver
# `RankingRepositorio.crear_o_recuperar_por_persona`). Lo que cubre esto es
# cualquier violación de constraint que se escape de esos caminos: 409 dice
# "chocaste con el estado actual de los datos", que es cierto, mientras que un
# 500 le dice al cliente que el servidor se rompió y no le da nada accionable.
#
# No lo silencia: se registra con traceback, así que un constraint violado por
# un bug sigue siendo diagnosticable en el log en lugar de desaparecer.
#
# No afecta a `test_restricciones_unicidad.py` ni a `test_restricciones_fk.py`:
# esas pruebas ejercitan la sesión de SQLAlchemy directamente (`db_session`),
# sin pasar por la app, así que siguen viendo el `IntegrityError` crudo.
@app.exception_handler(IntegrityError)
async def _integrity_error_handler(request: Request, exc: IntegrityError):
    _log.exception(
        "IntegrityError no manejado en %s %s [request_id=%s]",
        request.method,
        request.url.path,
        getattr(request.state, "request_id", "-"),
    )
    return _respuesta_error(
        status.HTTP_409_CONFLICT,
        "La operación entra en conflicto con el estado actual de los datos.",
    )


# --- HTTPException de FastAPI también devuelve {detail, message} ------------
@app.exception_handler(HTTPException)
async def _http_exception_handler(request: Request, exc: HTTPException):
    return _respuesta_error(exc.status_code, str(exc.detail))


# --- 422 de Pydantic también devuelve {detail, message} ---------------------
# Sin este handler, FastAPI responde un 422 con `detail` como una LISTA de
# errores -- y `frontend/src/services/api.ts::isApiErrorBody` exige que
# `detail` sea un string, así que ese 422 nunca llegaba a leerse: caía al
# `GENERIC_FAILURE` genérico aunque el `ValueError` de un `field_validator`
# (cédula, teléfono -- PR 4b, issue #228) llevara un mensaje en castellano
# perfectamente legible. Se toma el primer error nada más: como el resto de
# esta app, un 422 informa UN dato rechazado por vez.
@app.exception_handler(RequestValidationError)
async def _validation_exception_handler(request: Request, exc: RequestValidationError):
    errores = exc.errors()
    mensaje = errores[0]["msg"] if errores else "Los datos enviados no son válidos."
    prefijo_pydantic = "Value error, "
    if mensaje.startswith(prefijo_pydantic):
        mensaje = mensaje[len(prefijo_pydantic):]
    return _respuesta_error(status.HTTP_422_UNPROCESSABLE_ENTITY, mensaje)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origenes,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept"],
    # Sin esto, un browser cross-origin (el frontend Next.js corre en otro
    # origen) descarta `X-Request-ID` antes de que el JavaScript de la
    # página pueda leerlo: `allow_headers` sólo habilita cabeceras del
    # REQUEST, `expose_headers` es lo que habilita la LECTURA de una
    # cabecera de la RESPUESTA desde el cliente (sdd/borde-http-observable,
    # PR3).
    expose_headers=["X-Request-ID"],
)


# --- Correlación de requests ---------------------------------------------
# Cada respuesta lleva un `X-Request-ID` rastreable: se respeta el que manda
# el cliente si es válido, o se genera uno nuevo con `uuid4()`. Un id que
# viaja a los logs es superficie de inyección, así que se valida contra una
# lista BLANCA de caracteres (no una lista negra): cualquier valor entrante
# que no matchee -- vacío, con caracteres fuera del set aceptado, o
# excesivamente largo -- se descarta sin más aviso y se reemplaza por uno
# generado, en vez de rechazar el request con un 400: una cabecera de
# correlación malformada jamás debe tumbar un request legítimo.
CABECERA_REQUEST_ID = "X-Request-ID"
_FORMATO_REQUEST_ID = re.compile(r"^[A-Za-z0-9._-]{1,128}$")


class _CorrelacionDeRequestMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        entrante = request.headers.get(CABECERA_REQUEST_ID, "")
        identificador = (
            entrante if _FORMATO_REQUEST_ID.fullmatch(entrante) else str(uuid.uuid4())
        )
        request.state.request_id = identificador
        respuesta: Response = await call_next(request)
        respuesta.headers[CABECERA_REQUEST_ID] = identificador
        return respuesta


# Registrado DESPUÉS (más abajo) de CORSMiddleware, a propósito: queda POR
# FUERA de CORS, así que un preflight OPTIONS que CORS resuelve en
# corto-circuito (sin llamar a `call_next` hacia el router) igual sale con
# `X-Request-ID`. Y queda POR DENTRO de Cabeceras (registrada después, ver
# comentario de abajo), así que `request.state.request_id` ya está poblado
# cuando corren el router y los manejadores de excepciones -- incluido
# `_integrity_error_handler`, arriba -- antes de que la respuesta suba de
# vuelta por esta capa.
app.add_middleware(_CorrelacionDeRequestMiddleware)


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


# Registrado DESPUÉS (más abajo) de CORSMiddleware y de Correlación de
# arriba, a propósito: `add_middleware` de Starlette antepone cada
# middleware nuevo a la pila, así que el ÚLTIMO registrado queda MÁS AFUERA.
# Esta es la única posición que post-procesa TODAS las respuestas --
# incluidas las de CORS, las de Correlación, las de los 5 manejadores de
# excepciones de dominio (arriba) y los 429 de rate limiting (ver decisión
# de diseño 2.4, sdd/production-readiness). Pila resultante, de afuera hacia
# adentro: Cabeceras -> Correlación -> CORS -> router
# (sdd/borde-http-observable, D6).
app.add_middleware(_CabecerasDeSeguridadMiddleware)

app.include_router(auth_router.router, prefix="/api/v1")
app.include_router(personas_router.router, prefix="/api/v1")
app.include_router(membresias_pagos_router.router, prefix="/api/v1")
app.include_router(descuentos_router.router, prefix="/api/v1")
app.include_router(asistencias_router.router, prefix="/api/v1")
app.include_router(ficha_medica_router.router, prefix="/api/v1")
app.include_router(geografia_router.router, prefix="/api/v1")
app.include_router(notificaciones_router.router, prefix="/api/v1")
app.include_router(enrollment_router.router, prefix="/api/v1")
app.include_router(dashboard_router.router, prefix="/api/v1")
app.include_router(chatbot_router.router, prefix="/api/v1")
app.include_router(sponsors_router.router, prefix="/api/v1")


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


# --- Readiness probe -----------------------------------------------------
# Distingue "vivo" (arriba, /health) de "listo" (puede servir tráfico porque
# sus dependencias críticas responden). Motor y cliente propios, separados
# del `engine` pooled de `app/infraestructura/db.py`: en un apagón total de
# Postgres, esperar hasta el `pool_timeout` de ese pool (30s por defecto)
# haría que la sonda de readiness colgara mucho más de lo razonable, además
# de competir por un slot del pool de la aplicación. `NullPool` cierra la
# conexión de verdad al salir del context manager, sin devolverla a ningún
# pool.
TIMEOUT_CONEXION_POSTGRES_SEGUNDOS = 2
TIMEOUT_SENTENCIA_POSTGRES_MS = 2000
TIMEOUT_REDIS_SEGUNDOS = 2

_motor_sonda = create_engine(
    settings.database_url,
    poolclass=NullPool,
    connect_args={
        "connect_timeout": TIMEOUT_CONEXION_POSTGRES_SEGUNDOS,
        "options": f"-c statement_timeout={TIMEOUT_SENTENCIA_POSTGRES_MS}",
    },
)

# `from_url` no abre ninguna conexión al construirse (perezoso, igual que
# `create_engine` en `db.py`), así que este singleton a nivel de módulo es
# seguro de crear incluso con Redis caído. `retry_on_timeout=False`
# explícito: un reintento silencioso duplicaría el peor caso de latencia.
_cliente_redis_sonda = redis.Redis.from_url(
    settings.redis_url,
    socket_connect_timeout=TIMEOUT_REDIS_SEGUNDOS,
    socket_timeout=TIMEOUT_REDIS_SEGUNDOS,
    retry_on_timeout=False,
)


def _verificar_postgres() -> bool:
    """`connect_timeout` acota el handshake TCP; `statement_timeout` (fijado
    como GUC de sesión vía `options`) acota la consulta en sí, que
    `connect_timeout` no cubre -- un servidor que acepta el socket y después
    se queda mudo colgaría el `SELECT 1` indefinidamente sin ese segundo
    límite. Se captura `Exception` y no `SQLAlchemyError` a propósito: una
    falla de DNS, por ejemplo, levanta fuera de esa jerarquía, y el objetivo
    de esta función es que la sonda jamás termine en un 500 sin manejar."""
    try:
        with _motor_sonda.connect() as conexion:
            conexion.execute(text("SELECT 1"))
        return True
    except Exception:
        _log.warning("Sonda de readiness: Postgres no responde", exc_info=True)
        return False


def _verificar_redis() -> bool:
    """Mismo principio que `_verificar_postgres`: cualquier excepción del
    driver (timeout de conexión, timeout de socket, Redis caído) se traduce
    a `False` en vez de escapar hacia el endpoint."""
    try:
        return bool(_cliente_redis_sonda.ping())
    except Exception:
        _log.warning("Sonda de readiness: Redis no responde", exc_info=True)
        return False


@app.get("/health/ready", tags=["Salud"])
async def salud_lista():
    """Sonda de readiness: sin `Depends` (ni autenticación ni sesión de
    negocio) a propósito -- es un guardia estructural espejo del que tiene
    `/health`. Los dos chequeos son bloqueantes por naturaleza (ambos
    drivers son síncronos), así que corren en el threadpool vía
    `asyncio.to_thread` y se combinan con `gather` para no serializar el
    peor caso de cada uno sobre el event loop.

    Ninguna excepción puede escapar como 500 por triple capa: cada
    verificador ya captura `Exception` y devuelve `bool`; `gather(...,
    return_exceptions=True)` convierte cualquier excepción que igual se
    filtrara en un valor, no en un raise; y la normalización `resultado is
    True` trata cualquier cosa que no sea exactamente `True` -- una
    excepción devuelta, un `None`, un valor inesperado -- como caída.
    """
    resultados = await asyncio.gather(
        asyncio.to_thread(_verificar_postgres),
        asyncio.to_thread(_verificar_redis),
        return_exceptions=True,
    )
    postgres_ok, redis_ok = (resultado is True for resultado in resultados)

    if postgres_ok and redis_ok:
        return {"estado": "listo", "postgres": "ok", "redis": "ok"}

    caidas = [
        nombre
        for nombre, ok in (("postgres", postgres_ok), ("redis", redis_ok))
        if not ok
    ]
    return _respuesta_error(
        status.HTTP_503_SERVICE_UNAVAILABLE,
        f"Dependencias no disponibles: {', '.join(caidas)}.",
    )


# --- Diagnóstico de circuit breakers -------------------------------------
# Deliberadamente NO vive bajo /health: /health y /health/ready son sondas
# ANÓNIMAS pensadas para que un orquestador (docker-compose, Kubernetes) las
# golpee sin credenciales y decida si reiniciar o enrutar tráfico al
# contenedor. Esta ruta, en cambio, exige rol -- ver el docstring de abajo
# para el porqué -- y devuelve 403 a cualquiera sin ese rol. Colgarla de
# /health invitaría a que alguien configure el healthcheck del orquestador
# apuntando ahí (por analogía con /health/ready) y se coma un 403 constante
# que un orquestador anónimo no sabe distinguir de una caída real del
# servicio: un fallo de configuración se disfrazaría de incidente de
# disponibilidad. Ruta administrativa aparte, prefijo `/diagnostico`, para
# que esa clase de error de configuración ni siquiera sea posible por
# analogía de nombre.
@app.get(
    "/diagnostico/circuitos",
    tags=["Diagnóstico"],
    dependencies=[Depends(GestorPermisos(["ADMINISTRADOR"]))],
)
async def diagnostico_circuitos():
    """Expone `resumen_circuitos()` (app/soporte_transversal/circuito_breaker.py)
    tal cual, sin transformarlo ni envolverlo: ya es un dict JSON-serializable
    con la forma `{nombre: {"estado": ..., "fallos_consecutivos": ...}}`, y
    envolverlo no agregaría nada que este endpoint necesite.

    Exige rol ADMINISTRADOR (`GestorPermisos`, que traduce a 403 vía
    `PermisosInsuficientes` en `_MAPA_EXCEPCIONES`) a diferencia de las
    sondas de arriba: a diferencia de un simple up/down, este resumen le
    dice a quien lo lea QUÉ dependencia externa (Cloudinary, SMTP) está
    caída y CUÁNDO conviene golpearla -- es inteligencia operativa sobre la
    postura de resiliencia del sistema, no estado de salud genérico, y
    exponerla sin autenticación sería regalarle a un atacante el mapa de
    puntos débiles del backend en el peor momento posible.
    """
    return resumen_circuitos()
