"""API de días sin clase: lectura para usuarios autenticados, escritura solo del administrador."""
from datetime import date

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.infraestructura.db import obtener_sesion
from app.seguridad.gestor_auth import GestorAutenticacion
from app.servicios_negocio.dia_sin_clase_servicio import DiaSinClaseServicio
from app.servicios_negocio.dtos.dia_sin_clase_schemas import (
    DiaSinClaseCreadoResponseDTO,
    DiaSinClaseCreateDTO,
    DiaSinClaseResponseDTO,
    DiaSinClaseUpdateDTO,
)
from app.servicios_negocio.gestor_permisos import GestorPermisos

router = APIRouter(prefix="/dias-sin-clase", tags=["Días sin clase"])
ROL_ADMIN = ["ADMINISTRADOR"]


@router.get(
    "/", response_model=list[DiaSinClaseResponseDTO],
    dependencies=[Depends(GestorAutenticacion.decodificar_token)],
)
async def listar_dias_sin_clase(
    desde: date | None = Query(default=None),
    hasta: date | None = Query(default=None),
    db: Session = Depends(obtener_sesion),
):
    """Días cuyo rango toca `[desde, hasta]`. Solo socios autenticados: no hay
    lectura pública (decisión del dueño, issue #1665)."""
    return DiaSinClaseServicio(db).listar(desde, hasta)


@router.post(
    "/", response_model=DiaSinClaseCreadoResponseDTO, status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(GestorPermisos(ROL_ADMIN))],
)
async def crear_dia_sin_clase(datos: DiaSinClaseCreateDTO, db: Session = Depends(obtener_sesion)):
    dia, encolado = DiaSinClaseServicio(db).crear(datos)
    return DiaSinClaseCreadoResponseDTO(
        id=dia.id, fecha_inicio=dia.fecha_inicio, fecha_fin=dia.fecha_fin,
        motivo=dia.motivo, aviso_encolado=encolado,
    )


@router.post(
    "/{dia_id}/avisar", status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(GestorPermisos(ROL_ADMIN))],
)
async def reenviar_aviso_dia_sin_clase(dia_id: int, db: Session = Depends(obtener_sesion)):
    """Reencola el aviso; solo alcanza a las cuentas que aún no lo recibieron."""
    DiaSinClaseServicio(db).reenviar_aviso(dia_id)
    return {"encolado": True}


@router.put(
    "/{dia_id}", response_model=DiaSinClaseResponseDTO,
    dependencies=[Depends(GestorPermisos(ROL_ADMIN))],
)
async def actualizar_dia_sin_clase(
    dia_id: int, datos: DiaSinClaseUpdateDTO, db: Session = Depends(obtener_sesion),
):
    return DiaSinClaseServicio(db).actualizar(dia_id, datos)


@router.delete(
    "/{dia_id}", status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(GestorPermisos(ROL_ADMIN))],
)
async def eliminar_dia_sin_clase(dia_id: int, db: Session = Depends(obtener_sesion)):
    DiaSinClaseServicio(db).eliminar(dia_id)
