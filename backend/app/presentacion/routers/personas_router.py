from fastapi import APIRouter, Depends, status, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import date, datetime, time, timezone

from app.infraestructura.db import obtener_sesion
from app.presentacion.schemas.persona_schemas import (
    PersonaCreateDTO, PersonaResponseDTO, PersonaUpdateDTO,
    AntecedentesClubCreateDTO, AntecedentesClubUpdateDTO, AntecedentesClubResponseDTO,
)
from app.presentacion.schemas.base import PaginatedResponse
from app.seguridad.gestor_auth import GestorAutenticacion
from app.servicios_negocio.persona_servicio import PersonaServicio
from app.servicios_negocio.antecedentes_club_servicio import AntecedentesClubServicio
from app.servicios_negocio.rol_servicio import RolServicio
from app.servicios_negocio.gestor_permisos import GestorPermisos
from app.dominio.enums import TipoRol
from pydantic import BaseModel
from app.presentacion.schemas.base import ResponseBase

router = APIRouter(prefix="/personas", tags=["Personas"])


@router.post(
    "/", response_model=PersonaResponseDTO, status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(GestorPermisos(["ADMINISTRADOR"]))],
)
async def registrar_persona(persona_in: PersonaCreateDTO, db: Session = Depends(obtener_sesion)):
    return PersonaServicio(db).registrar_persona(persona_in)


# --- GETs: requieren token válido (no rol específico) para no exponer
# datos sensibles (cédula, teléfono, fecha de nacimiento) a cualquier cliente
# sin autenticar. Lo protegemos en el router, no sólo en el servicio.
@router.get(
    "/",
    response_model=PaginatedResponse[PersonaResponseDTO],
    dependencies=[Depends(GestorAutenticacion.decodificar_token)],
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
    inicio = datetime.combine(fecha_inicio, time.min, tzinfo=timezone.utc)
    fin = datetime.combine(fecha_fin, time.max, tzinfo=timezone.utc)
    return PersonaServicio(db).reporte_nuevos_por_periodo(inicio, fin)


@router.get(
    "/{persona_id}",
    response_model=PersonaResponseDTO,
    dependencies=[Depends(GestorAutenticacion.decodificar_token)],
)
async def obtener_persona(persona_id: int, db: Session = Depends(obtener_sesion)):
    return PersonaServicio(db).obtener_persona(persona_id)


@router.get(
    "/{persona_id}/representados",
    response_model=List[PersonaResponseDTO],
    dependencies=[Depends(GestorAutenticacion.decodificar_token)],
)
async def listar_representados(persona_id: int, db: Session = Depends(obtener_sesion)):
    return PersonaServicio(db).listar_representados(persona_id)


@router.put(
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
