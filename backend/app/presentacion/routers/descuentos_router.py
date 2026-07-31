"""
Catálogo de descuentos (issue #11). CRUD exclusivo del ADMINISTRADOR: el
catálogo es del club y la decisión de aplicar es del admin (modelo firmado
§4, sin motor de reglas). No hay DELETE: la baja es SUAVE vía `activo`
(PATCH), coherente con la filosofía de conservar historia del sistema --
las aplicaciones históricas referencian al descuento por FK.

La APLICACIÓN de descuentos a un pago no vive aquí: es parte del registro
del pago (`POST /membresias/pagos`, campo `descuento_ids`).
"""
from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.infraestructura.db import obtener_sesion
from app.presentacion.schemas.descuento_schemas import (
    DescuentoCreateDTO, DescuentoResponseDTO, DescuentoUpdateDTO,
)
from app.servicios_negocio.descuento_servicio import DescuentoServicio
from app.servicios_negocio.gestor_permisos import GestorPermisos

router = APIRouter(prefix="/descuentos", tags=["Descuentos"])

ROL_ADMIN = ["ADMINISTRADOR"]


@router.post("/", response_model=DescuentoResponseDTO, status_code=201,
             dependencies=[Depends(GestorPermisos(ROL_ADMIN))])
async def crear_descuento(datos: DescuentoCreateDTO, db: Session = Depends(obtener_sesion)):
    return DescuentoServicio(db).crear(datos)


# Incluye inactivos a propósito: el listado es la vista de administración
# del catálogo completo (y el camino para reactivar un descuento dado de baja).
@router.get("/", response_model=List[DescuentoResponseDTO],
            dependencies=[Depends(GestorPermisos(ROL_ADMIN))])
async def listar_descuentos(db: Session = Depends(obtener_sesion)):
    return DescuentoServicio(db).listar()


@router.get("/{descuento_id}", response_model=DescuentoResponseDTO,
            dependencies=[Depends(GestorPermisos(ROL_ADMIN))])
async def obtener_descuento(descuento_id: int, db: Session = Depends(obtener_sesion)):
    return DescuentoServicio(db).obtener(descuento_id)


@router.patch("/{descuento_id}", response_model=DescuentoResponseDTO,
              dependencies=[Depends(GestorPermisos(ROL_ADMIN))])
async def actualizar_descuento(
    descuento_id: int, datos: DescuentoUpdateDTO, db: Session = Depends(obtener_sesion),
):
    return DescuentoServicio(db).actualizar(descuento_id, datos)
