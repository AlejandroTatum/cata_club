from fastapi import APIRouter, Depends, HTTPException, Response, status, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import date, datetime, time, timezone

from app.infraestructura.db import obtener_sesion
from app.infraestructura.generador_pdf import generar_reporte_pdf
from app.presentacion.schemas.persona_schemas import (
    PersonaCreateDTO, PersonaResponseDTO, PersonaUpdateDTO,
    PersonaBusquedaDTO, RepresentadoCreateDTO,
    AntecedentesClubCreateDTO, AntecedentesClubUpdateDTO, AntecedentesClubResponseDTO,
    EntrenadorResponseDTO,
)
from app.presentacion.schemas.base import PaginatedResponse
from app.seguridad.gestor_auth import GestorAutenticacion
from app.servicios_negocio.persona_servicio import PersonaServicio
from app.servicios_negocio.antecedentes_club_servicio import AntecedentesClubServicio
from app.servicios_negocio.rol_servicio import RolServicio
from app.servicios_negocio.gestor_permisos import GestorPermisos
from app.dominio.enums import TipoRol
from app.dominio.excepciones import PermisosInsuficientes
from pydantic import BaseModel
from app.presentacion.schemas.base import ResponseBase

_COLUMNAS_REPORTE_PERSONA = [
    "Nombre", "Cédula", "Fecha Nac.", "Teléfono", "Prioridad Municipal", "Beca",
]


def _filas_reporte_persona(personas) -> list[list[str]]:
    return [
        [
            f"{p.nombres} {p.apellidos}",
            p.cedula,
            p.fecha_nacimiento.strftime("%d/%m/%Y") if p.fecha_nacimiento else "",
            p.telefono or "",
            "Sí" if p.prioridad_municipal else "No",
            f"{p.porcentaje_beca}%" if p.porcentaje_beca else "—",
        ]
        for p in personas
    ]

router = APIRouter(prefix="/personas", tags=["Personas"])


@router.post(
    "/", response_model=PersonaResponseDTO, status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(GestorPermisos(["ADMINISTRADOR"]))],
)
async def registrar_persona(persona_in: PersonaCreateDTO, db: Session = Depends(obtener_sesion)):
    return PersonaServicio(db).registrar_persona(persona_in)


# --- GET /: sólo ADMINISTRADOR, porque expone PII completa (cédula,
# teléfono, fecha de nacimiento, teléfono de contacto, beca) del roster
# entero. No basta con exigir un token válido: cualquier cuenta autenticada
# (entrenador, estudiante, representante) podría listar a todas las personas.
@router.get(
    "/",
    response_model=PaginatedResponse[PersonaResponseDTO],
    dependencies=[Depends(GestorPermisos(["ADMINISTRADOR"]))],
)
def listar_personas(skip: int = 0, limit: int = 50, db: Session = Depends(obtener_sesion)):
    items, total = PersonaServicio(db).listar_personas(skip, limit)
    return PaginatedResponse(items=items, total=total, skip=skip, limit=limit)


# --- Reportes (E01-RF010 / E04-RF014) ---------------------------------------
# IMPORTANTE: deben declararse ANTES de `GET /{persona_id}` (más abajo), por
# la misma razón documentada en membresias_pagos_router.py: `/{persona_id}`
# es un patrón de un solo segmento que capturaría "GET /personas/reportes"
# interpretando "reportes" como persona_id.
@router.get(
    "/reportes",
    response_model=List[PersonaResponseDTO],
    dependencies=[Depends(GestorPermisos(["ADMINISTRADOR"]))],
)
async def reporte_por_etiquetas(
    prioridad_municipal: Optional[bool] = Query(default=None),
    becado: Optional[bool] = Query(default=None),
    db: Session = Depends(obtener_sesion),
):
    return PersonaServicio(db).reporte_por_etiquetas(
        prioridad_municipal=prioridad_municipal, becado=becado
    )


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


# --- Exportación PDF de los reportes de arriba (report-pdf-export) ----------
# Re-ejecutan exactamente la misma consulta de servicio que su hermano JSON
# (mismos filtros/validación) -- NUNCA confían en filas enviadas por el
# cliente. Declarados junto a sus hermanos JSON, también ANTES de
# `/{persona_id}` por la misma razón de ruteo documentada arriba.
@router.get(
    "/reportes/pdf",
    dependencies=[Depends(GestorPermisos(["ADMINISTRADOR"]))],
)
async def reporte_por_etiquetas_pdf(
    prioridad_municipal: Optional[bool] = Query(default=None),
    becado: Optional[bool] = Query(default=None),
    db: Session = Depends(obtener_sesion),
):
    personas = PersonaServicio(db).reporte_por_etiquetas(
        prioridad_municipal=prioridad_municipal, becado=becado
    )
    pdf_bytes = generar_reporte_pdf(
        titulo="Reporte de Personas por Etiquetas",
        columnas=_COLUMNAS_REPORTE_PERSONA,
        filas=_filas_reporte_persona(personas),
    )
    fecha_actual = date.today().isoformat()
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="reporte-etiquetas_{fecha_actual}.pdf"',
        },
    )


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
    pdf_bytes = generar_reporte_pdf(
        titulo="Reporte de Nuevos Miembros por Período",
        columnas=_COLUMNAS_REPORTE_PERSONA,
        filas=_filas_reporte_persona(personas),
    )
    fecha_actual = date.today().isoformat()
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="reporte-periodo_{fecha_actual}.pdf"',
        },
    )


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


@router.get(
    "/{persona_id}",
    response_model=PersonaResponseDTO,
    dependencies=[Depends(GestorAutenticacion.decodificar_token)],
)
async def obtener_persona(persona_id: int, db: Session = Depends(obtener_sesion)):
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
    roles_usuario = token_payload.get("roles", [])
    es_propietario = persona_id == token_payload.get("persona_id")
    tiene_rol_administrativo = any(rol in ("ADMINISTRADOR", "ENTRENADOR") for rol in roles_usuario)
    if not es_propietario and not tiene_rol_administrativo:
        raise PermisosInsuficientes("Permisos insuficientes para esta operación")
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
    dependencies=[Depends(GestorPermisos(["REPRESENTANTE"]))],
)
async def crear_representado(
    persona_id: int,
    datos: RepresentadoCreateDTO,
    token_payload: dict = Depends(GestorAutenticacion.decodificar_token),
    db: Session = Depends(obtener_sesion),
):
    if persona_id != token_payload.get("persona_id"):
        raise PermisosInsuficientes("Permisos insuficientes para esta operación")
    return PersonaServicio(db).crear_representado(persona_id, datos)


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


@router.get(
    "/{persona_id}/antecedentes-club", response_model=AntecedentesClubResponseDTO,
    dependencies=[Depends(GestorAutenticacion.decodificar_token)],
)
async def obtener_antecedentes_club(persona_id: int, db: Session = Depends(obtener_sesion)):
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
