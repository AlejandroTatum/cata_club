"""
Catálogo de descuentos (issue #11). CRUD exclusivo del ADMINISTRADOR: el
catálogo es del club y la decisión de aplicar es del admin (modelo firmado
§4, sin motor de reglas). No hay DELETE: la baja es SUAVE vía `activo`
(PATCH), coherente con la filosofía de conservar historia del sistema --
las aplicaciones históricas referencian al descuento por FK.

La APLICACIÓN de un descuento a un pago no vive aquí: desde el issue #398/3c
el pago YA NO recibe ningún campo de descuento -- `PagoServicio.
registrar_pago` resuelve server-side la `AsignacionDescuento` vigente de
quien paga (asignada/retirada vía `POST|DELETE /personas/{id}/beneficio`,
ver `beneficio_servicio.py`) y congela su valor.
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.infraestructura.db import obtener_sesion
from app.servicios_negocio.dtos.base import PaginatedResponse
from app.servicios_negocio.dtos.descuento_schemas import (
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
#
# Issue #814: este listado quedó mergeado sin paginar pese a que el
# repositorio ya soportaba `skip`/`limit`/`contar()`. Mismo contrato que
# `GET /personas/`: `limit` tope 200.
@router.get("/", response_model=PaginatedResponse[DescuentoResponseDTO],
            dependencies=[Depends(GestorPermisos(ROL_ADMIN))])
async def listar_descuentos(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(obtener_sesion),
):
    """Lista el catálogo completo de descuentos, paginado (incluye inactivos)."""
    servicio = DescuentoServicio(db)
    items = servicio.listar(skip=skip, limit=limit)
    total = servicio.contar()
    return PaginatedResponse(items=items, total=total, skip=skip, limit=limit)


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
