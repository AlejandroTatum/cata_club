from typing import List, Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.infraestructura.db import obtener_sesion
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


@router.get("/paises", response_model=List[PaisResponseDTO], dependencies=_AUTENTICADO)
async def listar_paises(db: Session = Depends(obtener_sesion)):
    return PaisServicio(db).listar_paises()


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


@router.get("/provincias", response_model=List[ProvinciaResponseDTO], dependencies=_AUTENTICADO)
async def listar_provincias(
    pais_id: Optional[int] = None,
    db: Session = Depends(obtener_sesion),
):
    return ProvinciaServicio(db).listar_provincias(pais_id=pais_id)


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


@router.get("/cantones", response_model=List[CantonResponseDTO], dependencies=_AUTENTICADO)
async def listar_cantones(
    provincia_id: Optional[int] = None,
    db: Session = Depends(obtener_sesion),
):
    return CantonServicio(db).listar_cantones(provincia_id=provincia_id)


@router.get("/cantones/{canton_id}", response_model=CantonResponseDTO, dependencies=_AUTENTICADO)
async def obtener_canton(canton_id: int, db: Session = Depends(obtener_sesion)):
    return CantonServicio(db).obtener_canton(canton_id)
