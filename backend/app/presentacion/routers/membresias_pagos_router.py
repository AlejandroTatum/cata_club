from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, Query, status
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool
from typing import List, Optional
from datetime import date

from app.infraestructura.db import obtener_sesion
from app.soporte_transversal.tiempo import hoy_club
from app.infraestructura.generador_pdf import construir_respuesta_pdf, generar_reporte_pdf
from app.dominio.enums import EstadoPago
from app.presentacion.schemas.membresia_pago_schemas import (
    MembresiaCreateDTO, MembresiaEstadisticasResponseDTO, MembresiaResponseDTO,
    PagoCreateDTO, PagoResponseDTO, PagoValidarDTO, PagoListItemDTO,
    ComprobantePagoCreateDTO, ComprobantePagoResponseDTO,
    TipoMembresiaCreateDTO, TipoMembresiaUpdateDTO, TipoMembresiaResponseDTO, TarifaPublicaDTO,
    DeudaMembresiaResponseDTO, DeudaMembresiaBulkItemDTO, RegularizacionDeudaDTO, SuspensionReactivacionDTO,
    CorreccionPagoDTO, CorreccionPagoResponseDTO, CorreccionPagoResultadoDTO,
    CambioPlanMembresiaDTO,
)
from app.presentacion.schemas.cobertura_bonificada_schemas import (
    CoberturaBonificadaCreateDTO, CoberturaBonificadaResponseDTO,
)
from app.presentacion.schemas.base import PaginatedResponse
from app.seguridad.gestor_auth import GestorAutenticacion
from app.servicios_negocio.membresia_pago_servicio import (
    MembresiaServicio, PagoServicio, TAMANO_MAXIMO_VOUCHER_BYTES,
)
from app.servicios_negocio.gestor_permisos import GestorPermisos
from app.soporte_transversal.lectura_archivos import leer_con_limite
from app.soporte_transversal.rate_limit import limiter

_COLUMNAS_PAGOS_PDF = [
    "Estudiante", "Monto", "Tipo de Pago", "Vigencia Desde", "Vigencia Hasta",
    "Estado", "Fecha de Registro",
]


def _pagos_a_filas(pagos: List[PagoListItemDTO]) -> list[list[str]]:
    """Convierte una lista de `PagoListItemDTO` en filas de texto para el PDF
    de reporte, en el mismo orden que `_COLUMNAS_PAGOS_PDF`."""
    return [
        [
            p.persona_nombre_completo,
            f"USD {p.monto:.2f}",
            p.tipo_pago.value,
            p.fecha_inicio.strftime("%d/%m/%Y"),
            p.fecha_fin.strftime("%d/%m/%Y"),
            p.estado_pago.value,
            p.fecha_registro.strftime("%d/%m/%Y"),
        ]
        for p in pagos
    ]

router = APIRouter(prefix="/membresias", tags=["Membresías y Pagos"])

# Reutilizado para endpoints admin.
ROL_ADMIN = ["ADMINISTRADOR"]


# --- TipoMembresia ---
@router.post("/tipos", response_model=TipoMembresiaResponseDTO, status_code=201,
             dependencies=[Depends(GestorPermisos(ROL_ADMIN))])
async def crear_tipo_membresia(datos: TipoMembresiaCreateDTO, db: Session = Depends(obtener_sesion)):
    return MembresiaServicio(db).crear_tipo_membresia(datos)


# Tipos de membresía son datos de catálogo: lectura para cualquier autenticado.
# Deliberadamente SIN paginar: es un catálogo chico y de baja frecuencia de
# cambio (una entrada por plan comercial del club), no una tabla que crezca con
# el padrón -- traerlo completo es barato (ver
# `frontend/src/app/api/payments/[id]/route.ts:98-101`).
@router.get(
    "/tipos", response_model=List[TipoMembresiaResponseDTO],
    dependencies=[Depends(GestorAutenticacion.decodificar_token)],
)
async def listar_tipos_membresia(db: Session = Depends(obtener_sesion)):
    return MembresiaServicio(db).listar_tipos_membresia()


# Issue #394: hasta acá el catálogo solo se podía escribir una vez. Cambiar el
# precio de un plan obligaba a crear un tipo nuevo y dejar el viejo vivo, sin
# forma de retirarlo -- una fuente de verdad que solo admite un INSERT es un
# valor de siembra, no una fuente de verdad.
#
# Mismo candado de rol que el POST de arriba: esto escribe sobre el número con
# el que el club cobra. Un cambio de tarifa alcanza SOLO a los pagos futuros;
# el servicio explica por qué y los tests lo fijan.
@router.patch(
    "/tipos/{tipo_id}", response_model=TipoMembresiaResponseDTO,
    dependencies=[Depends(GestorPermisos(ROL_ADMIN))],
)
async def actualizar_tipo_membresia(
    tipo_id: int, datos: TipoMembresiaUpdateDTO, db: Session = Depends(obtener_sesion),
):
    return MembresiaServicio(db).actualizar_tipo_membresia(tipo_id, datos)


# Issue #394 (mitad pública, contrato de issue #331): la pantalla de
# inscripción necesita mostrar el precio del plan ANTES de que la persona
# tenga sesión -- misma clase que `GET /personas/instituciones`: catálogo
# sin dato de persona, deliberadamente SIN autenticación (documentado en
# `frontend/src/app/api/membresias/tarifas/route.ts`). Rate-limited igual
# que esa ruta: es la única otra superficie anónima de todo el backend, así
# que le toca el mismo tope de 60/min por el mismo motivo (D6-a).
# Reusa `listar_tipos_membresia` (mismo método que ya sirve al admin) y
# mapea acá al DTO público, mismo patrón que `listar_instituciones` mapea
# `Institucion` -> `InstitucionResponseDTO` en `personas_router.py`.
@router.get("/tarifas", response_model=List[TarifaPublicaDTO])
@limiter.limit("60/minute")
async def listar_tarifas_publicas(request: Request, db: Session = Depends(obtener_sesion)):
    tipos = MembresiaServicio(db).listar_tipos_membresia()
    return [TarifaPublicaDTO(categoria=t.categoria, precio=t.precio) for t in tipos]


# --- Membresia ---
@router.post("/", response_model=MembresiaResponseDTO, status_code=201,
             dependencies=[Depends(GestorPermisos(ROL_ADMIN))])
async def crear_membresia(datos: MembresiaCreateDTO, db: Session = Depends(obtener_sesion)):
    return MembresiaServicio(db).crear_membresia(datos)


@router.get(
    "/",
    response_model=PaginatedResponse[MembresiaResponseDTO],
    dependencies=[Depends(GestorPermisos(ROL_ADMIN))],
)
async def listar_membresias(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(obtener_sesion),
):
    """Listado paginado de todas las membresías. Agregado para resolver el
    N+1 en el dashboard (issue #4): en lugar de resolver cada membresía con
    una llamada individual, el dashboard puede obtenerlas todas de una vez."""
    items, total = MembresiaServicio(db).listar_membresias(skip=skip, limit=limit)
    return PaginatedResponse(items=items, total=total, skip=skip, limit=limit)


@router.get(
    "/mias",
    response_model=List[MembresiaResponseDTO],
    dependencies=[Depends(GestorAutenticacion.decodificar_token)],
)
async def listar_mis_membresias(
    persona_id: Optional[int] = Query(default=None, ge=1),
    db: Session = Depends(obtener_sesion),
    token_payload: dict = Depends(GestorAutenticacion.decodificar_token),
):
    """Lists JWT-owner memberships, or an explicitly authorized dependent."""
    objetivo = persona_id if persona_id is not None else token_payload.get("persona_id")
    return MembresiaServicio(db).listar_membresias_por_persona(
        persona_id_objetivo=objetivo,
        persona_id_solicitante=token_payload.get("persona_id"),
        roles_solicitante=token_payload.get("roles", []),
    )


@router.get(
    "/persona/{persona_id}",
    response_model=List[MembresiaResponseDTO],
    dependencies=[Depends(GestorAutenticacion.decodificar_token)],
)
async def listar_membresias_por_persona(
    persona_id: int,
    db: Session = Depends(obtener_sesion),
    token_payload: dict = Depends(GestorAutenticacion.decodificar_token),
):
    return MembresiaServicio(db).listar_membresias_por_persona(
        persona_id_objetivo=persona_id,
        persona_id_solicitante=token_payload.get("persona_id"),
        roles_solicitante=token_payload.get("roles", []),
    )


# --- Pago ---
# IMPORTANTE sobre el orden: este bloque de rutas de /pagos debe declararse
# ANTES de `GET /{membresia_id}` (más abajo). FastAPI/Starlette resuelve
# rutas en el orden en que se registran, y `/{membresia_id}` es un patrón
# genérico de un solo segmento que capturaría "GET /membresias/pagos"
# interpretando "pagos" como membresia_id (-> 422 al no poder parsearlo como
# int). Se descubrió este problema al agregar el listado de pagos.

# Cola de validación (Administrador). Gap identificado al integrar con el
# frontend: no existía ningún endpoint de listado; solo se podía consultar
# un pago a la vez por id. `estado_pago` es opcional para poder ver el
# historial completo, no solo pendientes.
@router.get(
    "/pagos",
    response_model=PaginatedResponse[PagoListItemDTO],
    dependencies=[Depends(GestorPermisos(ROL_ADMIN))],
)
def listar_pagos(
    estado_pago: Optional[EstadoPago] = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(obtener_sesion),
):
    items, total = PagoServicio(db).listar_pagos(estado_pago=estado_pago, skip=skip, limit=limit)
    return PaginatedResponse(items=items, total=total, skip=skip, limit=limit)


# Tope duro del reporte de pagos "todo en una respuesta" (sin paginar, el
# frontend pagina client-side -- ver comentario del router más abajo). El
# valor no cambia (10000): lo que cambia es qué pasa al superarlo. Antes se
# pedía `limit=LIMITE_MAXIMO_REPORTE_PAGOS` y se descartaba el `total` real
# que `PagoServicio.listar_pagos` ya devuelve (independiente del `limit`),
# así que un rango con más de 10000 pagos se truncaba en silencio: 200 con
# los primeros N y ninguna señal de que faltaban filas. Ahora se rechaza con
# 422, mismo patrón que el rango de fechas invertido más abajo.
LIMITE_MAXIMO_REPORTE_PAGOS = 10000


def _reporte_pagos_items(
    db: Session,
    estado_pago: Optional[EstadoPago],
    fecha_inicio: Optional[date],
    fecha_fin: Optional[date],
) -> List[PagoListItemDTO]:
    """Valida el rango de fechas y trae TODOS los pagos que matchean el
    filtro -- compartido por el endpoint JSON y el de PDF de abajo, que
    necesitan exactamente la misma validación + fetch (única diferencia:
    qué hacen con `items` después).

    Se compara con `>` (no `>=`, como en `asistencias_router.py`) porque
    `pago_repositorio.py` filtra inclusivo en ambos extremos (`>= inicio`,
    `<= fin`): un reporte de un solo día se pide con
    `fecha_inicio == fecha_fin` y es una consulta legítima."""
    if fecha_inicio is not None and fecha_fin is not None and fecha_inicio > fecha_fin:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="La fecha de inicio debe ser anterior a la fecha de fin.",
        )
    items, total = PagoServicio(db).listar_pagos(
        estado_pago=estado_pago, fecha_inicio=fecha_inicio, fecha_fin=fecha_fin,
        skip=0, limit=LIMITE_MAXIMO_REPORTE_PAGOS,
    )
    if total > LIMITE_MAXIMO_REPORTE_PAGOS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"El reporte supera el límite máximo de {LIMITE_MAXIMO_REPORTE_PAGOS} "
                "pagos. Reduzca el rango de fechas para continuar."
            ),
        )
    return items


# --- Reporte de pagos (E04-RF014-style): a diferencia de la cola paginada de
# arriba, devuelve TODOS los pagos que matchean el filtro -- el frontend
# pagina client-side (mismo convenio ya usado por `reporte_nuevos_por_periodo`
# en personas_router.py y `reporte_asistencia` en asistencias_router.py).
@router.get(
    "/pagos/reportes",
    response_model=List[PagoListItemDTO],
    dependencies=[Depends(GestorPermisos(ROL_ADMIN))],
)
def reporte_pagos(
    estado_pago: Optional[EstadoPago] = Query(default=None),
    fecha_inicio: Optional[date] = Query(default=None),
    fecha_fin: Optional[date] = Query(default=None),
    db: Session = Depends(obtener_sesion),
):
    return _reporte_pagos_items(db, estado_pago, fecha_inicio, fecha_fin)


# --- Exportación a PDF del reporte de pagos ---------------------------------
# `generar_reporte_pdf` es CPU-bound (renderizado ReportLab síncrono); se
# ejecuta vía `run_in_threadpool` para no bloquear el event loop de asyncio
# (un solo worker uvicorn) — mismo motivo que en `personas_router.py` /
# `asistencias_router.py`.
@router.get(
    "/pagos/reportes/pdf",
    dependencies=[Depends(GestorPermisos(ROL_ADMIN))],
)
async def reporte_pagos_pdf(
    estado_pago: Optional[EstadoPago] = Query(default=None),
    fecha_inicio: Optional[date] = Query(default=None),
    fecha_fin: Optional[date] = Query(default=None),
    db: Session = Depends(obtener_sesion),
):
    items = _reporte_pagos_items(db, estado_pago, fecha_inicio, fecha_fin)
    pdf_bytes = await run_in_threadpool(
        generar_reporte_pdf,
        titulo="Reporte de Pagos",
        columnas=_COLUMNAS_PAGOS_PDF,
        filas=_pagos_a_filas(items),
    )
    # Día del CLUB: la fecha del nombre de archivo es la que un humano lee
    # para saber de cuándo es el reporte. Uno descargado a las 19:30 del lunes
    # no puede llamarse con la fecha del martes.
    fecha_iso = hoy_club().isoformat()
    return construir_respuesta_pdf(pdf_bytes, f"reporte-pagos_{fecha_iso}.pdf")


# --- Membresia ---
@router.get(
    "/estadisticas",
    response_model=MembresiaEstadisticasResponseDTO,
    dependencies=[Depends(GestorPermisos(ROL_ADMIN))],
)
def obtener_estadisticas_membresias(db: Session = Depends(obtener_sesion)):
    return {"active_memberships": MembresiaServicio(db).contar_membresias_activas()}


# Membresía expone relación persona<->plan: exige autenticación (no rol admin).
@router.get(
    "/{membresia_id}",
    response_model=MembresiaResponseDTO,
    dependencies=[Depends(GestorAutenticacion.decodificar_token)],
)
async def obtener_membresia(
    membresia_id: int,
    db: Session = Depends(obtener_sesion),
    token_payload: dict = Depends(GestorAutenticacion.decodificar_token),
):
    return MembresiaServicio(db).obtener_membresia(
        membresia_id,
        persona_id_solicitante=token_payload.get("persona_id"),
        roles_solicitante=token_payload.get("roles", []),
    )
# --- Deuda y regularización (issue #284) ---------------------------------
# Deuda = meses adeudados desde la última cobertura aprobada hasta hoy; la ve
# SOLO un administrador (nunca el alumno/representante). La regularización es
# bookkeeping del admin: entra APROBADO directo, con fechas retroactivas
# explícitas y motivo obligatorio. No toca el estado de la membresía (ver
# `PagoServicio.regularizar_deuda`).

# Issue #326: el admin `/members` necesitaba deuda de N membresías VENCIDAs
# a la vez (monto + meses) sin caer en una consulta por fila -- mismo patrón
# de "ids repetidos en la query" que `GET /fichas-medicas/existe` (issue
# #362): `?membresia_ids=1&membresia_ids=2`, nunca una lista separada por
# comas parseada a mano. Reutiliza LA MISMA fórmula día-15/16 que la ruta de
# una sola membresía de abajo -- ver `PagoServicio.obtener_deuda_bulk` y su
# núcleo puro compartido `_calcular_meses_adeudados_desde_datos`.
#
# Registrada ANTES de `/{membresia_id}/deuda` a propósito (aunque FastAPI
# igual no las confundiría -- distinto segundo segmento literal, "bulk" vs
# "deuda"): mismo criterio que `/estadisticas` antes de `/{membresia_id}`,
# un literal de dos segmentos junto a sus primos parametrizados.
_MAX_BULK_DEUDA_IDS = 200


@router.get(
    "/deuda/bulk",
    response_model=List[DeudaMembresiaBulkItemDTO],
    dependencies=[Depends(GestorPermisos(ROL_ADMIN))],
)
def obtener_deuda_membresias_bulk(
    membresia_ids: List[int] = Query(default=[]),
    db: Session = Depends(obtener_sesion),
):
    if not membresia_ids:
        raise HTTPException(status_code=422, detail="Debe indicar al menos una membresía.")
    if len(membresia_ids) > _MAX_BULK_DEUDA_IDS:
        raise HTTPException(
            status_code=422,
            detail=f"Esta consulta admite hasta {_MAX_BULK_DEUDA_IDS} membresías a la vez.",
        )
    return PagoServicio(db).obtener_deuda_bulk(membresia_ids)


@router.get(
    "/{membresia_id}/deuda",
    response_model=DeudaMembresiaResponseDTO,
    dependencies=[Depends(GestorPermisos(ROL_ADMIN))],
)
def obtener_deuda_membresia(membresia_id: int, db: Session = Depends(obtener_sesion)):
    return PagoServicio(db).obtener_deuda(membresia_id)


@router.post(
    "/{membresia_id}/regularizar-deuda",
    response_model=PagoResponseDTO,
    status_code=201,
)
def regularizar_deuda_membresia(
    membresia_id: int,
    datos: RegularizacionDeudaDTO,
    db: Session = Depends(obtener_sesion),
    token_payload: dict = Depends(GestorPermisos(ROL_ADMIN)),
):
    servicio = PagoServicio(db)
    pago = servicio.regularizar_deuda(
        membresia_id, datos, persona_id_admin=token_payload.get("persona_id"),
    )
    return servicio.pago_a_response_dto(pago)


# Corrección financiera (issue #400, slice 5b): admin-only, mismo criterio de
# autorización que `regularizar-deuda`/`suspender`/`reactivar` -- ajustar los
# campos financieros congelados de un pago YA aprobado es una operación de
# administración, nunca autoservicio.
@router.post(
    "/pagos/{pago_id}/corregir",
    response_model=CorreccionPagoResultadoDTO,
    status_code=201,
)
def corregir_pago(
    pago_id: int,
    datos: CorreccionPagoDTO,
    db: Session = Depends(obtener_sesion),
    token_payload: dict = Depends(GestorPermisos(ROL_ADMIN)),
):
    servicio = PagoServicio(db)
    pago, correccion = servicio.corregir_pago(
        pago_id, datos, actor_persona_id=token_payload.get("persona_id"),
    )
    return CorreccionPagoResultadoDTO(
        pago=servicio.pago_a_response_dto(pago),
        correccion=CorreccionPagoResponseDTO.model_validate(correccion),
    )


@router.get(
    "/pagos/{pago_id}/correcciones",
    response_model=list[CorreccionPagoResponseDTO],
    dependencies=[Depends(GestorPermisos(ROL_ADMIN))],
)
def listar_correcciones_de_pago(pago_id: int, db: Session = Depends(obtener_sesion)):
    return PagoServicio(db).listar_correcciones_de_pago(pago_id)


# Suspensión y reactivación (issue #400, slice 5a): "Solo administración
# suspende o reactiva" es texto explícito del issue -- a diferencia de
# `aplicar-beneficio` (autoservicio del pagador), estos DOS endpoints SÍ
# llevan `GestorPermisos(ROL_ADMIN)`. `token_payload.get("persona_id")` es el
# admin que ejecuta la acción (`actor_persona_id` de la fila de auditoría),
# nunca la persona dueña de la membresía.
@router.post(
    "/{membresia_id}/suspender",
    response_model=MembresiaResponseDTO,
    status_code=200,
)
def suspender_membresia(
    membresia_id: int,
    datos: SuspensionReactivacionDTO,
    db: Session = Depends(obtener_sesion),
    token_payload: dict = Depends(GestorPermisos(ROL_ADMIN)),
):
    servicio = PagoServicio(db)
    return servicio.suspender_membresia(
        membresia_id,
        datos.motivo,
        actor_persona_id=token_payload.get("persona_id"),
        fecha_efectiva=datos.fecha_efectiva,
    )


@router.post(
    "/{membresia_id}/reactivar",
    response_model=MembresiaResponseDTO,
    status_code=200,
)
def reactivar_membresia(
    membresia_id: int,
    datos: SuspensionReactivacionDTO,
    db: Session = Depends(obtener_sesion),
    token_payload: dict = Depends(GestorPermisos(ROL_ADMIN)),
):
    servicio = PagoServicio(db)
    return servicio.reactivar_membresia(
        membresia_id,
        datos.motivo,
        actor_persona_id=token_payload.get("persona_id"),
        fecha_efectiva=datos.fecha_efectiva,
    )


# Cambio de plan de una membresía existente (issue #400, criterio 1):
# admin-only, mismo criterio de autorización que `suspender`/`reactivar`/
# `corregir` -- mover a alguien de plan es una decisión administrativa,
# nunca autoservicio. Ver `MembresiaServicio.cambiar_plan` para el porqué de
# "prospectivo" y de la tabla de auditoría dedicada.
@router.post(
    "/{membresia_id}/cambiar-plan",
    response_model=MembresiaResponseDTO,
    status_code=200,
)
def cambiar_plan_membresia(
    membresia_id: int,
    datos: CambioPlanMembresiaDTO,
    db: Session = Depends(obtener_sesion),
    token_payload: dict = Depends(GestorPermisos(ROL_ADMIN)),
):
    return MembresiaServicio(db).cambiar_plan(
        membresia_id, datos, actor_persona_id=token_payload.get("persona_id"),
    )


# Otorga cobertura bonificada (issue #400, slice 4d): a diferencia de
# `regularizar-deuda` (admin-only, bookkeeping), esta es autoservicio del
# propio pagador -- mismo criterio de autorización que `registrar_pago`
# (dependencia mínima `decodificar_token`; dueño/representante se valida
# DENTRO del servicio, ver `PagoServicio.aplicar_beneficio_bonificado`). NO
# usa `GestorPermisos(ROL_ADMIN)`: el admin ya ejerció su parte del proceso
# al conceder la `AsignacionDescuento` (issue #398, admin-only) por
# separado.
@router.post(
    "/{membresia_id}/aplicar-beneficio",
    response_model=CoberturaBonificadaResponseDTO,
    status_code=201,
)
async def aplicar_beneficio_bonificado(
    membresia_id: int,
    datos: CoberturaBonificadaCreateDTO,
    db: Session = Depends(obtener_sesion),
    token_payload: dict = Depends(GestorAutenticacion.decodificar_token),
):
    servicio = PagoServicio(db)
    # `run_in_threadpool` (issues #450/#451, mismo patrón que `login` en
    # auth_router.py, issue #311): este método toma el lock `FOR UPDATE` de
    # `obtener_por_id_con_bloqueo` -- llamado directo desde esta coroutine,
    # una carrera real por la MISMA membresía puede colgar el hilo único del
    # event loop (ver docstring de `registrar_pago` más abajo, mismo
    # mecanismo).
    cobertura = await run_in_threadpool(
        servicio.aplicar_beneficio_bonificado,
        membresia_id,
        datos,
        persona_id_solicitante=token_payload.get("persona_id"),
        roles_solicitante=token_payload.get("roles", []),
    )
    return servicio.cobertura_bonificada_a_response_dto(cobertura)


# Registra un pago pendiente. A diferencia de antes, ya NO basta con estar
# autenticado con cualquier rol: se exige ser el dueño (persona_id del token
# == persona_id del payload) o ADMINISTRADOR, igual que en /voucher. Antes
# cualquier usuario logueado podía registrar un pago a nombre de otra persona.
@router.post(
    "/pagos",
    response_model=PagoResponseDTO,
    status_code=201,
)
@limiter.limit("10/minute")
async def registrar_pago(
    request: Request,
    datos: PagoCreateDTO,
    db: Session = Depends(obtener_sesion),
    token_payload: dict = Depends(GestorAutenticacion.decodificar_token),
):
    servicio = PagoServicio(db)
    # `run_in_threadpool` (issue #451, reproducción en vivo: reproducido con
    # 3 pagos concurrentes sobre la MISMA membresía, mismo patrón que
    # `login` en auth_router.py, issue #311): `registrar_pago` toma el lock
    # `FOR UPDATE` de `obtener_por_id_con_bloqueo` (`MembresiaRepositorio`)
    # DIRECTO en esta coroutine. Sin threadpool, quien pierde la carrera por
    # el lock bloquea el ÚNICO hilo del event loop -- y quien ganó nunca
    # puede volver a ejecutarse para hacer COMMIT y liberar el lock:
    # deadlock real de proceso (confirmado en vivo, 5m32s sin
    # autorrecuperación, `/health` incluido). El `lock_timeout` que traduce
    # una espera excesiva a 409 vive en
    # `app/soporte_transversal/bloqueo_fila.py` (Parte B del mismo fix).
    pago = await run_in_threadpool(
        servicio.registrar_pago,
        datos,
        persona_id_solicitante=token_payload.get("persona_id"),
        roles_solicitante=token_payload.get("roles", []),
    )
    return servicio.pago_a_response_dto(pago)


@router.patch("/pagos/{pago_id}/validar", response_model=PagoResponseDTO,
              dependencies=[Depends(GestorPermisos(ROL_ADMIN))])
@limiter.limit("20/minute")
async def validar_pago(request: Request, pago_id: int, datos: PagoValidarDTO, db: Session = Depends(obtener_sesion)):
    servicio = PagoServicio(db)
    # `run_in_threadpool` (issue #451, misma clase de bug que `registrar_
    # pago` arriba): `validar_pago` toma el lock `FOR UPDATE` de `PagoRepositorio.
    # obtener_por_id_con_bloqueo` DIRECTO en esta coroutine.
    pago = await run_in_threadpool(servicio.validar_pago, pago_id, datos)
    return servicio.pago_a_response_dto(pago)


@router.get(
    "/pagos/{pago_id}",
    response_model=PagoResponseDTO,
    dependencies=[Depends(GestorAutenticacion.decodificar_token)],
)
async def obtener_pago(
    pago_id: int,
    db: Session = Depends(obtener_sesion),
    token_payload: dict = Depends(GestorAutenticacion.decodificar_token),
):
    servicio = PagoServicio(db)
    pago = servicio.obtener_pago(
        pago_id,
        persona_id_solicitante=token_payload.get("persona_id"),
        roles_solicitante=token_payload.get("roles", []),
    )
    return servicio.pago_a_response_dto(pago)


# Historial de pagos de una persona (cualquier estado). Autenticado, NO
# restringido a admin: la autorización real (dueño, su representante, o
# ADMINISTRADOR) se valida dentro del servicio, igual que en POST /pagos.
# Tres segmentos ("pagos", "persona", "{persona_id}") -- no colisiona con
# GET /pagos/{pago_id} (dos segmentos) ni con `/{membresia_id}` (uno solo);
# ver la nota de orden de rutas más arriba en este archivo.
@router.get(
    "/pagos/persona/{persona_id}",
    response_model=List[PagoResponseDTO],
    dependencies=[Depends(GestorAutenticacion.decodificar_token)],
)
async def listar_pagos_de_persona(
    persona_id: int,
    db: Session = Depends(obtener_sesion),
    token_payload: dict = Depends(GestorAutenticacion.decodificar_token),
):
    servicio = PagoServicio(db)
    pagos = servicio.listar_pagos_de_persona(
        persona_id_objetivo=persona_id,
        persona_id_solicitante=token_payload.get("persona_id"),
        roles_solicitante=token_payload.get("roles", []),
    )
    return [servicio.pago_a_response_dto(p) for p in pagos]


# --- ComprobantePago (PDF oficial generado por Celery al aprobar) ---
# Sólo admin puede adjuntar manualmente el comprobante oficial (la vida normal
# es que la tarea Celery lo genere): igualamos a `validar_pago` que ya es admin.
@router.post(
    "/pagos/{pago_id}/comprobante",
    response_model=ComprobantePagoResponseDTO, status_code=201,
    dependencies=[Depends(GestorPermisos(ROL_ADMIN))],
)
@limiter.limit("20/minute")
async def adjuntar_comprobante(
    request: Request, pago_id: int, datos: ComprobantePagoCreateDTO, db: Session = Depends(obtener_sesion),
):
    return PagoServicio(db).adjuntar_comprobante(pago_id, datos)


# --- Voucher de transferencia (cliente) ---
# Endpoint autenticado (delegado a la regla de negocio en PagoServicio para
# validar dueño/admin): a diferencia del ComprobantePago oficial, este
# adjunta la imagen/PDF que el cliente sube como evidencia de transferencia.
@router.post("/pagos/{pago_id}/voucher", response_model=PagoResponseDTO, status_code=201)
@limiter.limit("5/minute")
async def subir_voucher(
    request: Request,
    pago_id: int,
    archivo: UploadFile = File(...),
    db: Session = Depends(obtener_sesion),
    token_payload: dict = Depends(GestorAutenticacion.decodificar_token),
):
    contenido = await leer_con_limite(archivo, TAMANO_MAXIMO_VOUCHER_BYTES)
    servicio = PagoServicio(db)
    # `run_in_threadpool` (issue #450, mismo patrón que `login` en
    # auth_router.py, issue #311): `adjuntar_voucher` termina en
    # `cloudinary.uploader.upload(...)`, SDK síncrono bloqueante (hasta
    # `TIMEOUT_CLOUDINARY_TOTAL_SEGUNDOS`), llamado directo desde esta
    # coroutine. Sin threadpool, una subida lenta retiene el único hilo del
    # event loop y bloquea a TODO otro cliente -- ni siquiera `/health`
    # respondería mientras la subida está en curso (misma clase de bug que
    # #451, confirmada en vivo para el patrón `FOR UPDATE`; acá el mecanismo
    # es E/S de red en vez de un lock de Postgres, pero el efecto sobre el
    # event loop es idéntico).
    pago = await run_in_threadpool(
        servicio.adjuntar_voucher,
        pago_id=pago_id,
        persona_id_solicitante=token_payload.get("persona_id"),
        roles_solicitante=token_payload.get("roles", []),
        contenido=contenido,
        content_type=archivo.content_type,
        nombre_archivo=archivo.filename,
    )
    return servicio.pago_a_response_dto(pago)
