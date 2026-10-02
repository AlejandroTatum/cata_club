"""Pantalla "Actividad del club" (issue #1314): solo administradores.

`GET /api/v1/actividad/resumen?rango=24h|7d|30d` y
`GET /api/v1/actividad/avanzadas?rango=1h|24h|7d`.

Admin-only se exige AQUÍ, en el backend, con la misma dependencia de roles que
el resto de la API (`GestorPermisos`): que el frontend oculte el menú no es un
control. Cualquier administrador ve también la vista avanzada.

Los handlers son síncronos (`def`): las consultas son bloqueantes y FastAPI las
corre en su threadpool (el candado de `test_bloqueo_del_event_loop.py` pide que
un handler `async` no toque la base).
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.infraestructura.db import obtener_sesion
from app.servicios_negocio.actividad_servicio import ActividadServicio
from app.servicios_negocio.dtos.actividad_schemas import (
    AvanzadasResponse, RangoAvanzadas, RangoResumen, ResumenResponse,
)
from app.servicios_negocio.gestor_permisos import GestorPermisos

router = APIRouter(
    prefix="/actividad",
    tags=["Actividad"],
    dependencies=[Depends(GestorPermisos(["ADMINISTRADOR"]))],
)


def _ahora() -> datetime:
    """Reloj del endpoint. Función aparte para que los tests lo fijen sin
    parchear módulos del servicio."""
    return datetime.now(timezone.utc)


@router.get("/resumen", response_model=ResumenResponse)
def resumen(rango: RangoResumen = Query("7d"), db: Session = Depends(obtener_sesion)) -> ResumenResponse:
    return ActividadServicio(db).resumen(rango, _ahora())


@router.get("/avanzadas", response_model=AvanzadasResponse)
def avanzadas(rango: RangoAvanzadas = Query("1h"), db: Session = Depends(obtener_sesion)) -> AvanzadasResponse:
    return ActividadServicio(db).avanzadas(rango, _ahora())
