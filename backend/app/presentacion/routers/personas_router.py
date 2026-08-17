from fastapi import APIRouter, Depends, File, HTTPException, Request, status, Query, UploadFile
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool
from typing import List, Optional
from datetime import date, datetime, time, timezone

from app.infraestructura.db import obtener_sesion
from app.soporte_transversal.rate_limit import limiter
from app.soporte_transversal.tiempo import hoy_club
from app.soporte_transversal.lectura_archivos import leer_con_limite
from app.infraestructura.generador_pdf import construir_respuesta_pdf, generar_reporte_pdf
from app.presentacion.schemas.persona_schemas import (
    PersonaCreateDTO, PersonaResponseDTO, PersonaUpdateDTO,
    PersonaBusquedaDTO, RepresentadoCreateDTO, VincularRepresentadoDTO, IndependizarDTO, EstadoPersonaDTO,
    AntecedentesClubCreateDTO, AntecedentesClubUpdateDTO, AntecedentesClubResponseDTO,
)
from app.presentacion.schemas.base import PaginatedResponse
from app.seguridad.gestor_auth import GestorAutenticacion
from app.servicios_negocio.persona_servicio import PersonaServicio
from app.servicios_negocio.admin_cuenta_servicio import AdminCuentaServicio
from app.servicios_negocio.auth_servicio import AuthServicio
from app.presentacion.schemas.admin_cuenta_schemas import AdminCrearCuentaDTO
from app.servicios_negocio.antecedentes_club_servicio import AntecedentesClubServicio
from app.servicios_negocio.rol_servicio import RolServicio
from app.servicios_negocio.gestor_permisos import GestorPermisos
from app.servicios_negocio.politica_acceso import SOLO_ADMINISTRADOR, PoliticaAccesoPersona
from app.dominio.enums import TipoRol
from pydantic import BaseModel
from app.presentacion.schemas.base import ResponseBase

_COLUMNAS_PERSONAS_PDF = [
    "Nombres", "Apellidos", "Cédula", "Teléfono", "Fecha de Registro",
]


def _personas_a_filas(personas) -> list[list[str]]:
    """Convierte una lista de `Persona` (ORM) en filas de texto para el PDF
    de reporte, en el mismo orden que `_COLUMNAS_PERSONAS_PDF`."""
    filas: list[list[str]] = []
    for p in personas:
        filas.append([
            p.nombres,
            p.apellidos,
            p.cedula,
            p.telefono,
            p.fecha_registro.strftime("%d/%m/%Y") if p.fecha_registro else "-",
        ])
    return filas

router = APIRouter(prefix="/personas", tags=["Personas"])


# --- Flujo 1: creación de cuenta completa desde el admin --------------------
# Rate-limited (D6-c): acuña una identidad nueva (Persona + Usuario + Rol) y
# devuelve tokens de auto-login, la misma categoría que `POST /auth/registro`
# (D1: "acuñar identidades nuevas exige POST /auth/registro, que está
# limitado -- eso cierra el lazo"). Mismo tier que `registro` (20/min): es su
# equivalente admin-driven, no una operación masiva. `registrar_persona`
# (abajo) NO se decora porque solo crea una Persona -- ninguna credencial,
# ninguna identidad nueva que acuñar.
@router.post(
    "/admin/cuentas",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(GestorPermisos(["ADMINISTRADOR"]))],
)
@limiter.limit("20/minute")
async def crear_cuenta_admin(
    request: Request, datos: AdminCrearCuentaDTO, db: Session = Depends(obtener_sesion)
):
    """Crea Persona + Usuario + Rol en un solo request (JUGADOR / REPRESENTANTE / MENOR).
    Retorna tokens JWT para auto-login inmediato del admin y de la cuenta creada."""
    return AdminCuentaServicio(db).crear_cuenta(datos)


@router.post(
    "/", response_model=PersonaResponseDTO, status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(GestorPermisos(["ADMINISTRADOR"]))],
)
async def registrar_persona(persona_in: PersonaCreateDTO, db: Session = Depends(obtener_sesion)):
    return PersonaServicio(db).registrar_persona(persona_in)


# --- ADMINISTRADOR-only: PersonaResponseDTO expone cédula, teléfono y
# fecha de nacimiento — PII real. Antes solo exigía un token válido (no un
# rol específico), lo que dejaba pedir el roster completo del club a
# cualquier sesión autenticada (alumno, entrenador, representante), no solo
# a admins. Único consumidor real es la página admin de Miembros.
@router.get(
    "/",
    response_model=PaginatedResponse[PersonaResponseDTO],
    dependencies=[Depends(GestorPermisos(["ADMINISTRADOR"]))],
)
# `skip`/`limit` eran defaults planos de Python (sin `Query(...)`, sin `ge=`
# ni `le=`): `limit=100000` pedía el roster entero de una y `skip=-5` llegaba
# hasta Postgres como "OFFSET must not be negative" (un 500). Mismo contrato
# que `GET /membresias/pagos`. El tope es 200 porque es exactamente lo que
# piden los tres consumidores del BFF (`PERSONAS_PAGE_LIMIT` en
# `api/members`, `attendance-adapter` y `payments-adapter`).
#
# Rate-limited (D6-d): devuelve una lista de personas con PII real. Tier
# admin-de-confianza (30/min): alcanza para paginar la pantalla de Miembros a
# ritmo normal sin acotar a cero el abuso de una sesión admin comprometida --
# también es la primera cobertura real del fix de regex sync/async (Slice 0):
# hasta ahora ningún endpoint SÍNCRONO estaba decorado de verdad.
@limiter.limit("30/minute")
def listar_personas(
    request: Request,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(obtener_sesion),
):
    items, total = PersonaServicio(db).listar_personas(skip, limit)
    return PaginatedResponse(items=items, total=total, skip=skip, limit=limit)


# --- Reportes (E04-RF014) ----------------------------------------------------
# IMPORTANTE: debe declararse ANTES de `GET /{persona_id}` (más abajo), por
# la misma razón documentada en membresias_pagos_router.py: `/{persona_id}`
# es un patrón de un solo segmento que capturaría "GET /personas/reportes/..."
# interpretando "reportes" como persona_id.
# Rate-limited (D6-b/d): escaneo completo del rango de fechas + lista de
# PersonaResponseDTO (PII). 20/min, mismo tier que `validar_pago`/
# `adjuntar_comprobante` -- amplificación admin, no autoservicio.
@router.get(
    "/reportes/nuevos-por-periodo",
    response_model=List[PersonaResponseDTO],
    dependencies=[Depends(GestorPermisos(["ADMINISTRADOR"]))],
)
@limiter.limit("20/minute")
async def reporte_nuevos_por_periodo(
    request: Request,
    fecha_inicio: date = Query(...),
    fecha_fin: date = Query(...),
    db: Session = Depends(obtener_sesion),
):
    # Se compara con `>` (no `>=`, como en `asistencias_router.py`) porque
    # `persona_repositorio.py` filtra inclusivo en ambos extremos
    # (`>= fecha_inicio`, `<= fecha_fin`): un reporte de un solo día se pide
    # con `fecha_inicio == fecha_fin` y es una consulta legítima.
    if fecha_inicio > fecha_fin:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="La fecha de inicio debe ser anterior a la fecha de fin.",
        )
    inicio = datetime.combine(fecha_inicio, time.min, tzinfo=timezone.utc)
    fin = datetime.combine(fecha_fin, time.max, tzinfo=timezone.utc)
    return PersonaServicio(db).reporte_nuevos_por_periodo(inicio, fin)


# --- Exportación a PDF del reporte de arriba --------------------------------
# Reejecuta exactamente la misma llamada de servicio que su hermano JSON
# (nunca confía en filas enviadas por el cliente) y devuelve bytes de PDF
# generados en memoria vía `generar_reporte_pdf`.
# IMPORTANTE: `generar_reporte_pdf` es CPU-bound (renderizado ReportLab
# síncrono). Se ejecuta vía `run_in_threadpool` para no bloquear el event loop
# de asyncio (un solo worker uvicorn) — mismo motivo por el que
# `generar_comprobante_pago_pdf` corre en una tarea de Celery, no inline.
# Rate-limited (D6-b): mismo escaneo que el JSON hermano de arriba, más el
# render de PDF bloqueante en threadpool -- el costo por llamada es mayor,
# así que el tope es más chico (10/min, no 20/min): mismo principio que ya
# separa `chatbot` por costo real medido.
@router.get(
    "/reportes/nuevos-por-periodo/pdf",
    dependencies=[Depends(GestorPermisos(["ADMINISTRADOR"]))],
)
@limiter.limit("10/minute")
async def reporte_nuevos_por_periodo_pdf(
    request: Request,
    fecha_inicio: date = Query(...),
    fecha_fin: date = Query(...),
    db: Session = Depends(obtener_sesion),
):
    # Mismo criterio que el endpoint JSON hermano de arriba: rango inclusivo,
    # `fecha_inicio == fecha_fin` es un reporte de un solo día válido.
    if fecha_inicio > fecha_fin:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="La fecha de inicio debe ser anterior a la fecha de fin.",
        )
    inicio = datetime.combine(fecha_inicio, time.min, tzinfo=timezone.utc)
    fin = datetime.combine(fecha_fin, time.max, tzinfo=timezone.utc)
    personas = PersonaServicio(db).reporte_nuevos_por_periodo(inicio, fin)
    pdf_bytes = await run_in_threadpool(
        generar_reporte_pdf,
        titulo="Reporte de Nuevos Miembros por Período",
        columnas=_COLUMNAS_PERSONAS_PDF,
        filas=_personas_a_filas(personas),
    )
    # Día del CLUB: la fecha del nombre de archivo es la que un humano lee
    # para saber de cuándo es el reporte. Uno descargado a las 19:30 del lunes
    # no puede llamarse con la fecha del martes.
    fecha_iso = hoy_club().isoformat()
    return construir_respuesta_pdf(pdf_bytes, f"reporte-periodo_{fecha_iso}.pdf")


# `GET /entrenadores` (selector de entrenador para el formulario de horarios)
# se eliminó con la relación entrenador–horario (issue #13,
# docs/product/concepto-alcance-modelo.md §4): sin titular que elegir, la ruta no
# tenía consumidor. `test_personas.py` deja una guardia estructural.


# --- Instituciones educativas (selector para inscripción de menores) --------
# IMPORTANTE: va ANTES de `GET /{persona_id}` por la misma razón ya
# documentada en `/reportes`. Estaba declarada al final del
# archivo y quedaba tapada por el comodín, así que respondía 422 siempre. El
# síntoma no era un error visible: las tres pantallas que consumen el selector
# (wizard de inscripción, alta de dependiente, crear cuenta del admin) lo
# ocultan con `instituciones.length > 0`, de modo que el campo simplemente
# desaparecía del formulario sin avisar. `test_orden_rutas.py` deja una
# guardia estructural para que no vuelva a pasar con otra ruta.
class InstitucionResponseDTO(ResponseBase, BaseModel):
    id: int
    nombre: str
    tipo_escuela: str


# Rate-limited (D6-a): ÚNICA superficie anónima de los 7 routers sin
# cobertura del cambio completo -- prioridad más alta de todo
# `api-abuse-protection`. Deliberadamente SIN autenticación (documentado en
# `frontend/src/app/api/personas/instituciones/route.ts:5-8`: debe seguir
# pública para visitantes anónimos de `student/enroll`); la mitigación acá es
# el límite, no un login. Como todo el tráfico anónimo comparte la única IP
# del BFF (D3), la clave es GLOBAL para siempre -- 60/min es el mismo tope
# que ya rige `login`, un techo de club entero, no un presupuesto por
# usuario: una carga de formulario por visita no se acerca a esa cifra.
@router.get("/instituciones", response_model=PaginatedResponse[InstitucionResponseDTO])
@limiter.limit("60/minute")
async def listar_instituciones(
    request: Request,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=200, ge=1, le=200),
    db: Session = Depends(obtener_sesion),
):
    """Lista instituciones educativas (para selector en wizard de inscripción)."""
    from app.infraestructura.repositorios.institucion_repositorio import InstitucionRepositorio
    repo = InstitucionRepositorio(db)
    instituciones = repo.listar(skip=skip, limit=limit)
    items = [
        InstitucionResponseDTO(id=i.id, nombre=i.nombre, tipo_escuela=i.tipo_escuela.value)
        for i in instituciones
    ]
    return PaginatedResponse(items=items, total=repo.contar(), skip=skip, limit=limit)


# --- Búsqueda (autocomplete) ------------------------------------------------
# Rate-limited (D6-d): devuelve una lista de personas (DTO liviano, sin
# cédula/teléfono, pero igual nombres+foto). Cualquier rol autenticado la
# alcanza, no solo admin -- tier de autoservicio de confianza, 30/min: cubre
# ráfagas normales de tipeo en el autocomplete sin dejar de acotar un
# scraping del roster completo por búsquedas incrementales.
@router.get(
    "/buscar",
    response_model=List[PersonaBusquedaDTO],
    dependencies=[Depends(GestorAutenticacion.decodificar_token)],
)
@limiter.limit("30/minute")
async def buscar_personas(
    request: Request,
    q: str = Query(..., min_length=2, max_length=100),
    rol: Optional[str] = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=50),
    db: Session = Depends(obtener_sesion),
):
    return PersonaServicio(db).buscar_por_nombre(q=q, rol=rol, skip=skip, limit=limit)


# --- `PersonaResponseDTO` expone cédula, teléfono y fecha de nacimiento: PII
# real. `GET /personas/` ya se había restringido a ADMINISTRADOR por
# exactamente ese motivo, pero este hermano por id quedó exigiendo solo un
# token válido -- y como los ids son enteros consecutivos, el roster completo
# del club seguía siendo recolectable de a una persona por vez desde
# cualquier sesión (alumno incluido). Mismo criterio que `listar_representados`
# acá abajo: dueño, su representante, o staff.
#
# Issue #356 (decisión del dueño, "el entrenador solo toma lista y revisa
# listas") acotó a SOLO_ADMINISTRADOR sus otros dos hermanos con PII
# (`listar_representados`, `obtener_antecedentes_club`) pero DELIBERADAMENTE
# NO tocó este todavía: `frontend/src/lib/server/attendance-adapter.ts
# #fetchPersonaNameMap` dependía de este endpoint como fallback per-id para
# resolver el nombre de cada alumno en "revisar listas" del entrenador,
# porque `AsistenciaResponseDTO` solo llevaba `persona_id`, nunca el nombre.
#
# Issue #358 cierra ese hermano: `AsistenciaResponseDTO` ahora lleva
# `persona_nombre_completo` resuelto en origen (join a Persona, ver
# `Asistencia.persona_nombre_completo` en modelos.py), así que no hace falta
# ninguna consulta por id para "revisar listas" -- `fetchPersonaNameMap` se
# eliminó del BFF. Sin ese consumidor, este endpoint vuelve a
# SOLO_ADMINISTRADOR, igual que sus dos hermanos.
@router.get(
    "/{persona_id}",
    response_model=PersonaResponseDTO,
    dependencies=[Depends(GestorAutenticacion.decodificar_token)],
)
async def obtener_persona(
    persona_id: int,
    token_payload: dict = Depends(GestorAutenticacion.decodificar_token),
    db: Session = Depends(obtener_sesion),
):
    PoliticaAccesoPersona(db).exigir_acceso(
        persona_id_objetivo=persona_id,
        persona_id_solicitante=token_payload.get("persona_id"),
        roles_solicitante=token_payload.get("roles", []),
        roles_privilegiados=SOLO_ADMINISTRADOR,
        # El portal del alumno muestra quién es su representante, y para eso
        # pide la ficha del tutor con el token del propio alumno (ver
        # `frontend/src/app/api/student/route.ts`). Sin esta rama el nombre
        # del tutor desaparecía en silencio de la tarjeta de perfil.
        incluir_representante_propio=True,
        mensaje="No puede consultar los datos personales de otra persona",
    )
    return PersonaServicio(db).obtener_persona(persona_id)



# --- GET /{persona_id}/representados: mismo chequeo de ownership que el POST
# hermano `crear_representado` (línea ~153) — la identidad de quien consulta
# se toma de `token_payload["persona_id"]`, nunca de la URL sola. ADMINISTRADOR
# queda exceptuado porque legítimamente necesita consultar representados de
# cualquier persona (panel admin). ENTRENADOR NO: decisión del dueño (issue
# #356), solo toma lista y revisa listas -- no ve datos personales.
# Rate-limited (D6-d): devuelve una lista de PersonaResponseDTO (PII real de
# los representados), aunque el tamaño típico sea chico. Mismo tier 30/min
# que las demás lecturas de lista de este lote.
# Deliberadamente SIN paginar: la cardinalidad está acotada por familia (no
# crece con el padrón), y hay dos llamadores que necesitan el conjunto
# COMPLETO, no una página: `frontend/src/app/api/student/route.ts:85,96,108`
# (arma el perfil de cada hijo) y
# `backend/app/servicios_negocio/notificacion_servicio.py` (fan-out de
# notificaciones a representante + hijos).
@router.get(
    "/{persona_id}/representados",
    response_model=List[PersonaResponseDTO],
    dependencies=[Depends(GestorAutenticacion.decodificar_token)],
)
@limiter.limit("30/minute")
async def listar_representados(
    request: Request,
    persona_id: int,
    token_payload: dict = Depends(GestorAutenticacion.decodificar_token),
    db: Session = Depends(obtener_sesion),
):
    PoliticaAccesoPersona(db).exigir_acceso_directo(
        persona_id_objetivo=persona_id,
        persona_id_solicitante=token_payload.get("persona_id"),
        roles_solicitante=token_payload.get("roles", []),
        roles_privilegiados=SOLO_ADMINISTRADOR,
    )
    return PersonaServicio(db).listar_representados(persona_id)


# --- Autoservicio del portal: representante agrega un dependiente ----------
# El rol se exige vía `GestorPermisos(["REPRESENTANTE"])`; la identidad del
# representante se toma EXCLUSIVAMENTE de `token_payload["persona_id"]` (nunca
# del cuerpo), y se compara contra el `persona_id` de la URL. Mismo patrón que
# el chequeo inline de `crear_antecedentes_club` (línea ~165): reusa la
# excepción de dominio ya mapeada a 403, sin revelar si el `persona_id` de la
# URL existe o pertenece a otro representante.
# Rate-limited (D6-c): `RepresentadoCreateDTO` puede acuñar una identidad
# nueva (Persona + Usuario, si vienen `correo`/`contrasenia`) igual que
# `autoinscribir` -- la misma categoría que D1 cierra con el límite de
# `POST /auth/registro`. Tier de autoservicio autenticado (10/min), igual que
# `actualizar_perfil_propio`/`actualizar_foto_perfil`.
@router.post(
    "/{persona_id}/representados", response_model=PersonaResponseDTO,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(GestorPermisos(["REPRESENTANTE", "ADMINISTRADOR"]))],
)
@limiter.limit("10/minute")
async def crear_representado(
    request: Request,
    persona_id: int,
    datos: RepresentadoCreateDTO,
    token_payload: dict = Depends(GestorAutenticacion.decodificar_token),
    db: Session = Depends(obtener_sesion),
):
    PoliticaAccesoPersona(db).exigir_acceso_directo(
        persona_id_objetivo=persona_id,
        persona_id_solicitante=token_payload.get("persona_id"),
        roles_solicitante=token_payload.get("roles", []),
        roles_privilegiados=SOLO_ADMINISTRADOR,
    )
    return PersonaServicio(db).crear_representado(persona_id, datos)


# --- Vincular un representado ya existente (INS-2) --------------------------
# docs/product/decisiones-de-negocio-2026-08-11.md §1: "un representante puede
# vincular a su cuenta un chico ya registrado, escribiendo su cédula, sin que
# nadie apruebe". Mismo patrón de ownership que `crear_representado` (línea
# ~342): la identidad del representante sale EXCLUSIVAMENTE del token, nunca
# del cuerpo, y se compara contra el `persona_id` de la URL.
# Rate-limited (mismo tier de autoservicio autenticado que `crear_representado`
# -- 10/minute): el freno REAL de intentos en serie es el retraso progresivo
# por representante que vive en `PersonaServicio` (guardarraíl 4 de la
# decisión), que sí se ejerce en `AMBIENTE=test`; este decorador es la capa
# adicional que ya cubre a todo el router (D6-c/D1), consistente con el resto
# del inventario de `test_limite_tasa_pagos.py`.
@router.post(
    "/{persona_id}/vincular-representado", response_model=PersonaResponseDTO,
)
@limiter.limit("10/minute")
async def vincular_representado(
    request: Request,
    persona_id: int,
    datos: VincularRepresentadoDTO,
    token_payload: dict = Depends(GestorPermisos(["REPRESENTANTE", "ADMINISTRADOR"])),
    db: Session = Depends(obtener_sesion),
):
    PoliticaAccesoPersona(db).exigir_acceso_directo(
        persona_id_objetivo=persona_id,
        persona_id_solicitante=token_payload.get("persona_id"),
        roles_solicitante=token_payload.get("roles", []),
        roles_privilegiados=SOLO_ADMINISTRADOR,
    )
    return PersonaServicio(db).vincular_representado(persona_id, datos)


# --- Independizar (Flujo 4): ex-menor se independiza del representante --
@router.post(
    "/{persona_id}/independizar", response_model=PersonaResponseDTO,
    dependencies=[Depends(GestorAutenticacion.decodificar_token)],
)
async def independizar_persona(
    persona_id: int,
    datos: IndependizarDTO,
    token_payload: dict = Depends(GestorAutenticacion.decodificar_token),
    db: Session = Depends(obtener_sesion),
):
    """Permite a una persona independizarse de su representante legal.
    Solo puede ejecutarlo la propia persona o un ADMINISTRADOR."""
    PoliticaAccesoPersona(db).exigir_acceso_directo(
        persona_id_objetivo=persona_id,
        persona_id_solicitante=token_payload.get("persona_id"),
        roles_solicitante=token_payload.get("roles", []),
        roles_privilegiados=SOLO_ADMINISTRADOR,
    )
    return PersonaServicio(db).independizar(persona_id, datos)


# --- Foto de una persona (carnet de socio, issue #286) ---------------------
# El dueño (self-service por id, el mismo caso que `POST /auth/me/foto` pero
# sobre una persona objetivo), el representante de esa persona, o
# ADMINISTRADOR. La identidad sale del token, nunca de la URL:
# `PoliticaAccesoPersona.exigir_acceso` con `SOLO_ADMINISTRADOR` deja pasar
# dueño + representante + admin (NO usa `exigir_acceso_directo`, que excluye
# la rama del representante). Rate-limited (D6-c): tier self-service, igual
# que `actualizar_foto_perfil`.
@router.post(
    "/{persona_id}/foto",
    response_model=PersonaResponseDTO,
    dependencies=[Depends(GestorAutenticacion.decodificar_token)],
)
@limiter.limit("10/minute")
async def actualizar_foto_persona(
    request: Request,
    persona_id: int,
    archivo: UploadFile = File(...),
    token_payload: dict = Depends(GestorAutenticacion.decodificar_token),
    db: Session = Depends(obtener_sesion),
):
    PoliticaAccesoPersona(db).exigir_acceso(
        persona_id_objetivo=persona_id,
        persona_id_solicitante=token_payload.get("persona_id"),
        roles_solicitante=token_payload.get("roles", []),
        roles_privilegiados=SOLO_ADMINISTRADOR,
        mensaje="Solo la propia persona, su representante, o un administrador pueden actualizar su foto",
    )
    contenido = await leer_con_limite(archivo, AuthServicio.TAMANO_MAXIMO_FOTO_PERFIL_BYTES)
    return PersonaServicio(db).actualizar_foto(
        persona_id=persona_id,
        contenido=contenido,
        content_type=archivo.content_type,
    )


@router.patch(
    "/{persona_id}", response_model=PersonaResponseDTO,
    dependencies=[Depends(GestorPermisos(["ADMINISTRADOR"]))],
)
async def actualizar_persona(persona_id: int, cambios: PersonaUpdateDTO, db: Session = Depends(obtener_sesion)):
    return PersonaServicio(db).actualizar_persona(persona_id, cambios)


# --- Baja lógica de una persona --------------------------------------------
# Reemplaza al `DELETE /personas/{persona_id}` que existía acá: aquel hacía un
# borrado duro y destruía, junto con la fila, el historial de asistencias, los
# pagos y la ficha médica -- registros que un club que cobra dinero tiene que
# conservar. Un menor inscrito por su representante ni siquiera tiene
# `Usuario`, así que hasta ahora borrarlo era la ÚNICA forma de sacarlo de la
# nómina.
#
# La forma es la del hermano `PATCH /{persona_id}/cuenta/estado` (E01-RF013),
# que gobierna el flag del `Usuario`: mismo verbo, mismo cuerpo `{activo}`,
# mismo rol. Lo que NO se reutiliza a propósito es el verbo DELETE: este
# proyecto ya pagó el costo de un botón "crear horario" que no creaba ningún
# horario, y un DELETE que no borra es exactamente la misma mentira.
@router.patch(
    "/{persona_id}/estado", response_model=PersonaResponseDTO,
    dependencies=[Depends(GestorPermisos(["ADMINISTRADOR"]))],
)
async def cambiar_estado_persona(
    persona_id: int, datos: EstadoPersonaDTO, db: Session = Depends(obtener_sesion)
):
    return PersonaServicio(db).cambiar_estado(persona_id, datos.activo)


# --- AntecedentesClub (E01-RF008): existían los DTOs pero ningún endpoint ---
@router.post(
    "/{persona_id}/antecedentes-club", response_model=AntecedentesClubResponseDTO,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(GestorPermisos(["ADMINISTRADOR"]))],
)
async def crear_antecedentes_club(
    persona_id: int, datos: AntecedentesClubCreateDTO, db: Session = Depends(obtener_sesion)
):
    if datos.persona_id != persona_id:
        from app.dominio.excepciones import OperacionInvalida
        raise OperacionInvalida(
            "Los datos enviados no corresponden a la persona indicada.",
            detalle_tecnico=(
                f"persona_id del cuerpo ({datos.persona_id}) "
                f"distinto del de la URL ({persona_id})"
            ),
        )
    return AntecedentesClubServicio(db).crear(datos)


# El historial deportivo de un alumno (nivel técnico, antigüedad, mano
# dominante) es su dato, no del club entero: mismo criterio que el resto de
# las lecturas por `persona_id` de este router. Exigía ADMINISTRADOR_O_
# ENTRENADOR; issue #356 (decisión del dueño) lo acota a SOLO_ADMINISTRADOR
# -- el entrenador solo toma lista y revisa listas, no ve datos personales.
@router.get(
    "/{persona_id}/antecedentes-club", response_model=AntecedentesClubResponseDTO,
    dependencies=[Depends(GestorAutenticacion.decodificar_token)],
)
async def obtener_antecedentes_club(
    persona_id: int,
    token_payload: dict = Depends(GestorAutenticacion.decodificar_token),
    db: Session = Depends(obtener_sesion),
):
    PoliticaAccesoPersona(db).exigir_acceso(
        persona_id_objetivo=persona_id,
        persona_id_solicitante=token_payload.get("persona_id"),
        roles_solicitante=token_payload.get("roles", []),
        roles_privilegiados=SOLO_ADMINISTRADOR,
        mensaje="No puede consultar los antecedentes de club de otra persona",
    )
    return AntecedentesClubServicio(db).obtener_por_persona(persona_id)


@router.patch(
    "/{persona_id}/antecedentes-club", response_model=AntecedentesClubResponseDTO,
    dependencies=[Depends(GestorPermisos(["ADMINISTRADOR"]))],
)
async def actualizar_antecedentes_club(
    persona_id: int, datos: AntecedentesClubUpdateDTO, db: Session = Depends(obtener_sesion)
):
    return AntecedentesClubServicio(db).actualizar(persona_id, datos)


# --- Roles (E01-RF004/005/006/007): gap real que no existía en ningún lado --
class RolAsignarDTO(BaseModel):
    tipo_rol: TipoRol


class RolesResponseDTO(ResponseBase, BaseModel):
    persona_id: int
    roles: List[str]
    activo: bool


class EstadoCuentaDTO(BaseModel):
    activo: bool


@router.get(
    "/{persona_id}/roles", response_model=RolesResponseDTO,
    dependencies=[Depends(GestorPermisos(["ADMINISTRADOR"]))],
)
async def obtener_roles(persona_id: int, db: Session = Depends(obtener_sesion)):
    """Lectura pura (no muta nada) del estado actual de roles/activo de una
    persona. Existe para que el frontend pueda pre-cargar el estado real
    antes de abrir el modal de edición de roles, en vez de asumir "sin
    roles" / "activo" por defecto (bug: los checkboxes de rol arrancaban
    todos destildados sin importar el estado real)."""
    usuario = RolServicio(db).obtener_roles(persona_id)
    return RolesResponseDTO(persona_id=persona_id, roles=[r.tipo_rol.value for r in usuario.roles], activo=usuario.activo)


@router.post(
    "/{persona_id}/roles", response_model=RolesResponseDTO, status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(GestorPermisos(["ADMINISTRADOR"]))],
)
async def asignar_rol(persona_id: int, datos: RolAsignarDTO, db: Session = Depends(obtener_sesion)):
    usuario = RolServicio(db).asignar_rol(persona_id, datos.tipo_rol)
    return RolesResponseDTO(persona_id=persona_id, roles=[r.tipo_rol.value for r in usuario.roles], activo=usuario.activo)


@router.delete(
    "/{persona_id}/roles/{tipo_rol}", response_model=RolesResponseDTO,
    dependencies=[Depends(GestorPermisos(["ADMINISTRADOR"]))],
)
async def quitar_rol(
    persona_id: int,
    tipo_rol: TipoRol,
    db: Session = Depends(obtener_sesion),
    token_payload: dict = Depends(GestorAutenticacion.decodificar_token),
):
    """El `persona_id` del solicitante se toma del token, nunca del cliente:
    es lo que permite bloquear que un administrador se quite a sí mismo el
    rol ADMINISTRADOR y se deje fuera del sistema."""
    usuario = RolServicio(db).quitar_rol(
        persona_id, tipo_rol, persona_id_solicitante=token_payload.get("persona_id")
    )
    return RolesResponseDTO(persona_id=persona_id, roles=[r.tipo_rol.value for r in usuario.roles], activo=usuario.activo)


# --- E01-RF013: activar/desactivar cuenta sin borrar datos -------------------
@router.patch(
    "/{persona_id}/cuenta/estado", response_model=RolesResponseDTO,
    dependencies=[Depends(GestorPermisos(["ADMINISTRADOR"]))],
)
async def cambiar_estado_cuenta(persona_id: int, datos: EstadoCuentaDTO, db: Session = Depends(obtener_sesion)):
    usuario = RolServicio(db).cambiar_estado_cuenta(persona_id, datos.activo)
    return RolesResponseDTO(persona_id=persona_id, roles=[r.tipo_rol.value for r in usuario.roles], activo=usuario.activo)


