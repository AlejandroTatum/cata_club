from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool
from typing import List, Optional
from datetime import date, datetime, time, timezone

from app.infraestructura.db import obtener_sesion
from app.infraestructura.generador_pdf import construir_respuesta_pdf, generar_reporte_pdf
from app.presentacion.schemas.persona_schemas import (
    PersonaCreateDTO, PersonaResponseDTO, PersonaUpdateDTO,
    PersonaBusquedaDTO, RepresentadoCreateDTO, IndependizarDTO,
    AntecedentesClubCreateDTO, AntecedentesClubUpdateDTO, AntecedentesClubResponseDTO,
    EntrenadorResponseDTO,
)
from app.presentacion.schemas.base import PaginatedResponse
from app.seguridad.gestor_auth import GestorAutenticacion
from app.servicios_negocio.persona_servicio import PersonaServicio
from app.servicios_negocio.admin_cuenta_servicio import AdminCuentaServicio
from app.presentacion.schemas.admin_cuenta_schemas import AdminCrearCuentaDTO
from app.servicios_negocio.antecedentes_club_servicio import AntecedentesClubServicio
from app.servicios_negocio.rol_servicio import RolServicio
from app.servicios_negocio.gestor_permisos import GestorPermisos
from app.servicios_negocio.politica_acceso import (
    ADMINISTRADOR_O_ENTRENADOR, SOLO_ADMINISTRADOR, PoliticaAccesoPersona,
)
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
@router.post(
    "/admin/cuentas",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(GestorPermisos(["ADMINISTRADOR"]))],
)
async def crear_cuenta_admin(datos: AdminCrearCuentaDTO, db: Session = Depends(obtener_sesion)):
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
def listar_personas(skip: int = 0, limit: int = 50, db: Session = Depends(obtener_sesion)):
    items, total = PersonaServicio(db).listar_personas(skip, limit)
    return PaginatedResponse(items=items, total=total, skip=skip, limit=limit)


# --- Reportes (E04-RF014) ----------------------------------------------------
# IMPORTANTE: debe declararse ANTES de `GET /{persona_id}` (más abajo), por
# la misma razón documentada en membresias_pagos_router.py: `/{persona_id}`
# es un patrón de un solo segmento que capturaría "GET /personas/reportes/..."
# interpretando "reportes" como persona_id.
@router.get(
    "/reportes/nuevos-por-periodo",
    response_model=List[PersonaResponseDTO],
    dependencies=[Depends(GestorPermisos(["ADMINISTRADOR"]))],
)
async def reporte_nuevos_por_periodo(
    fecha_inicio: date = Query(...),
    fecha_fin: date = Query(...),
    db: Session = Depends(obtener_sesion),
):
    if fecha_inicio >= fecha_fin:
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
@router.get(
    "/reportes/nuevos-por-periodo/pdf",
    dependencies=[Depends(GestorPermisos(["ADMINISTRADOR"]))],
)
async def reporte_nuevos_por_periodo_pdf(
    fecha_inicio: date = Query(...),
    fecha_fin: date = Query(...),
    db: Session = Depends(obtener_sesion),
):
    if fecha_inicio >= fecha_fin:
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
    fecha_iso = date.today().isoformat()
    return construir_respuesta_pdf(pdf_bytes, f"reporte-periodo_{fecha_iso}.pdf")


# --- Selector de entrenador (dropdown al crear/editar un Horario) -----------
# IMPORTANTE: debe declararse ANTES de `GET /{persona_id}` por la misma razón
# que `/reportes` arriba — de lo contrario "entrenadores" se interpretaría
# como un persona_id. Lectura para cualquier autenticado (mismo criterio que
# `listar_horarios` en asistencias_router.py): no es un dato sensible ni
# mutación, solo permite elegir un entrenador real por nombre.
@router.get(
    "/entrenadores",
    response_model=List[EntrenadorResponseDTO],
    dependencies=[Depends(GestorAutenticacion.decodificar_token)],
)
async def listar_entrenadores(db: Session = Depends(obtener_sesion)):
    entrenadores = PersonaServicio(db).listar_entrenadores()
    return [
        EntrenadorResponseDTO(id=p.id, nombre_completo=f"{p.nombres} {p.apellidos}")
        for p in entrenadores
    ]


# --- Instituciones educativas (selector para inscripción de menores) --------
# IMPORTANTE: va ANTES de `GET /{persona_id}` por la misma razón ya
# documentada en `/reportes` y `/entrenadores`. Estaba declarada al final del
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


@router.get("/instituciones", response_model=List[InstitucionResponseDTO])
async def listar_instituciones(db: Session = Depends(obtener_sesion)):
    """Lista todas las instituciones educativas (para selector en wizard de inscripción)."""
    from app.infraestructura.repositorios.institucion_repositorio import InstitucionRepositorio
    instituciones = InstitucionRepositorio(db).listar()
    return [
        InstitucionResponseDTO(id=i.id, nombre=i.nombre, tipo_escuela=i.tipo_escuela.value)
        for i in instituciones
    ]


# --- Búsqueda (autocomplete) ------------------------------------------------
@router.get(
    "/buscar",
    response_model=List[PersonaBusquedaDTO],
    dependencies=[Depends(GestorAutenticacion.decodificar_token)],
)
async def buscar_personas(
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
        roles_privilegiados=ADMINISTRADOR_O_ENTRENADOR,
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
# y ENTRENADOR quedan exceptuados porque legítimamente necesitan consultar
# representados de cualquier persona (panel admin).
@router.get(
    "/{persona_id}/representados",
    response_model=List[PersonaResponseDTO],
    dependencies=[Depends(GestorAutenticacion.decodificar_token)],
)
async def listar_representados(
    persona_id: int,
    token_payload: dict = Depends(GestorAutenticacion.decodificar_token),
    db: Session = Depends(obtener_sesion),
):
    PoliticaAccesoPersona(db).exigir_acceso_directo(
        persona_id_objetivo=persona_id,
        persona_id_solicitante=token_payload.get("persona_id"),
        roles_solicitante=token_payload.get("roles", []),
        roles_privilegiados=ADMINISTRADOR_O_ENTRENADOR,
    )
    return PersonaServicio(db).listar_representados(persona_id)


# --- Autoservicio del portal: representante agrega un dependiente ----------
# El rol se exige vía `GestorPermisos(["REPRESENTANTE"])`; la identidad del
# representante se toma EXCLUSIVAMENTE de `token_payload["persona_id"]` (nunca
# del cuerpo), y se compara contra el `persona_id` de la URL. Mismo patrón que
# el chequeo inline de `crear_antecedentes_club` (línea ~165): reusa la
# excepción de dominio ya mapeada a 403, sin revelar si el `persona_id` de la
# URL existe o pertenece a otro representante.
@router.post(
    "/{persona_id}/representados", response_model=PersonaResponseDTO,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(GestorPermisos(["REPRESENTANTE", "ADMINISTRADOR"]))],
)
async def crear_representado(
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


@router.patch(
    "/{persona_id}", response_model=PersonaResponseDTO,
    dependencies=[Depends(GestorPermisos(["ADMINISTRADOR"]))],
)
async def actualizar_persona(persona_id: int, cambios: PersonaUpdateDTO, db: Session = Depends(obtener_sesion)):
    return PersonaServicio(db).actualizar_persona(persona_id, cambios)


@router.delete(
    "/{persona_id}", status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(GestorPermisos(["ADMINISTRADOR"]))],
)
async def eliminar_persona(persona_id: int, db: Session = Depends(obtener_sesion)):
    PersonaServicio(db).eliminar_persona(persona_id)


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
        raise OperacionInvalida("El persona_id del cuerpo no coincide con el de la URL")
    return AntecedentesClubServicio(db).crear(datos)


# El historial deportivo de un alumno (nivel técnico, antigüedad, mano
# dominante) es su dato, no del club entero: mismo criterio que el resto de
# las lecturas por `persona_id` de este router.
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
        roles_privilegiados=ADMINISTRADOR_O_ENTRENADOR,
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
async def quitar_rol(persona_id: int, tipo_rol: TipoRol, db: Session = Depends(obtener_sesion)):
    usuario = RolServicio(db).quitar_rol(persona_id, tipo_rol)
    return RolesResponseDTO(persona_id=persona_id, roles=[r.tipo_rol.value for r in usuario.roles], activo=usuario.activo)


# --- E01-RF013: activar/desactivar cuenta sin borrar datos -------------------
@router.patch(
    "/{persona_id}/cuenta/estado", response_model=RolesResponseDTO,
    dependencies=[Depends(GestorPermisos(["ADMINISTRADOR"]))],
)
async def cambiar_estado_cuenta(persona_id: int, datos: EstadoCuentaDTO, db: Session = Depends(obtener_sesion)):
    usuario = RolServicio(db).cambiar_estado_cuenta(persona_id, datos.activo)
    return RolesResponseDTO(persona_id=persona_id, roles=[r.tipo_rol.value for r in usuario.roles], activo=usuario.activo)


