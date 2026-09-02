from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.infraestructura.db import obtener_sesion
from app.presentacion.schemas.base import PaginatedResponse
from app.presentacion.schemas.geografia_schemas import (
    PaisCreateDTO, PaisResponseDTO,
    ProvinciaCreateDTO, ProvinciaResponseDTO,
    CantonCreateDTO, CantonResponseDTO,
)
from app.seguridad.gestor_auth import GestorAutenticacion
from app.servicios_negocio.geografia_servicio import (
    PaisServicio, ProvinciaServicio, CantonServicio,
)
from app.servicios_negocio.gestor_permisos import GestorPermisos

router = APIRouter(prefix="/geografia", tags=["Geografía"])

# GET de listado/obtención son de lectura general (cualquiera autenticado);
# solo los mutadores (POST) exigen rol ADMINISTRADOR (mismo patrón que personas).
ROL_ADMIN = ["ADMINISTRADOR"]

# REQ-SEC-2: estos GET no declaraban NINGUNA dependencia -- ni siquiera
# `decodificar_token` -- pese al comentario de arriba. Cualquiera, sin
# autenticar, podía leerlos. Exigir el token es el mínimo que el comentario
# ya prometía; siguen sin exigir rol porque son catálogo puro (país/
# provincia/cantón), sin PII.
_AUTENTICADO = [Depends(GestorAutenticacion.decodificar_token)]


# --- Pais ---
@router.post(
    "/paises", response_model=PaisResponseDTO, status_code=201,
    dependencies=[Depends(GestorPermisos(ROL_ADMIN))],
)
async def crear_pais(datos: PaisCreateDTO, db: Session = Depends(obtener_sesion)):
    return PaisServicio(db).crear_pais(datos)


# Issue #814: este listado quedó mergeado sin paginar pese a que el
# repositorio ya soportaba `skip`/`limit`/`contar()`. Mismo contrato que
# `GET /personas/`: `limit` tope 200.
@router.get(
    "/paises", response_model=PaginatedResponse[PaisResponseDTO], dependencies=_AUTENTICADO,
)
async def listar_paises(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(obtener_sesion),
):
    """Lista países paginados (catálogo de ubicación)."""
    servicio = PaisServicio(db)
    items = servicio.listar_paises(skip=skip, limit=limit)
    total = servicio.contar_paises()
    return PaginatedResponse(items=items, total=total, skip=skip, limit=limit)


@router.get("/paises/{pais_id}", response_model=PaisResponseDTO, dependencies=_AUTENTICADO)
async def obtener_pais(pais_id: int, db: Session = Depends(obtener_sesion)):
    return PaisServicio(db).obtener_pais(pais_id)


# --- Provincia ---
@router.post(
    "/provincias", response_model=ProvinciaResponseDTO, status_code=201,
    dependencies=[Depends(GestorPermisos(ROL_ADMIN))],
)
async def crear_provincia(datos: ProvinciaCreateDTO, db: Session = Depends(obtener_sesion)):
    return ProvinciaServicio(db).crear_provincia(datos)


@router.get(
    "/provincias", response_model=PaginatedResponse[ProvinciaResponseDTO], dependencies=_AUTENTICADO,
)
async def listar_provincias(
    pais_id: Optional[int] = None,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(obtener_sesion),
):
    """Lista provincias paginadas, opcionalmente filtradas por `pais_id`."""
    servicio = ProvinciaServicio(db)
    items = servicio.listar_provincias(pais_id=pais_id, skip=skip, limit=limit)
    total = servicio.contar_provincias(pais_id=pais_id)
    return PaginatedResponse(items=items, total=total, skip=skip, limit=limit)


@router.get("/provincias/{provincia_id}", response_model=ProvinciaResponseDTO, dependencies=_AUTENTICADO)
async def obtener_provincia(provincia_id: int, db: Session = Depends(obtener_sesion)):
    return ProvinciaServicio(db).obtener_provincia(provincia_id)


# --- Canton ---
@router.post(
    "/cantones", response_model=CantonResponseDTO, status_code=201,
    dependencies=[Depends(GestorPermisos(ROL_ADMIN))],
)
async def crear_canton(datos: CantonCreateDTO, db: Session = Depends(obtener_sesion)):
    return CantonServicio(db).crear_canton(datos)


@router.get(
    "/cantones", response_model=PaginatedResponse[CantonResponseDTO], dependencies=_AUTENTICADO,
)
async def listar_cantones(
    provincia_id: Optional[int] = None,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(obtener_sesion),
):
    """Lista cantones paginados, opcionalmente filtrados por `provincia_id`."""
    servicio = CantonServicio(db)
    items = servicio.listar_cantones(provincia_id=provincia_id, skip=skip, limit=limit)
    total = servicio.contar_cantones(provincia_id=provincia_id)
    return PaginatedResponse(items=items, total=total, skip=skip, limit=limit)


@router.get("/cantones/{canton_id}", response_model=CantonResponseDTO, dependencies=_AUTENTICADO)
async def obtener_canton(canton_id: int, db: Session = Depends(obtener_sesion)):
    return CantonServicio(db).obtener_canton(canton_id)
