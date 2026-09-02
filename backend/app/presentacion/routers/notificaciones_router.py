"""
Router de notificaciones in-app.

Extraído de `ranking_router.py`: las notificaciones nunca fueron parte del
ranking competitivo (derogado por decisión de producto y eliminado por
completo), solo compartían router por historia de implementación.

El prefijo de ruta se mantiene en `/ranking/notificaciones` a propósito: el
frontend ya consume `GET /api/v1/ranking/notificaciones/mias` y
`PATCH /api/v1/ranking/notificaciones/{id}/leer`, y esa URL no tiene ninguna
razón de negocio para cambiar en esta limpieza -- renombrarla sería un
segundo cambio (de contrato) montado sobre uno de organización interna.
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.infraestructura.db import obtener_sesion
from app.seguridad.gestor_auth import GestorAutenticacion
from app.servicios_negocio.notificacion_servicio import NotificacionServicio
from app.presentacion.schemas.notificacion_schemas import (
    MarcarTodasLeidasResponseDTO,
    NotificacionResponseDTO,
)
from app.servicios_negocio.dtos.base import PaginatedResponse

router = APIRouter(prefix="/ranking/notificaciones", tags=["notificaciones"])


@router.get(
    "/mias", response_model=PaginatedResponse[NotificacionResponseDTO],
    dependencies=[Depends(GestorAutenticacion.decodificar_token)],
)
async def listar_mis_notificaciones(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=200),
    db: Session = Depends(obtener_sesion),
    token_payload: dict = Depends(GestorAutenticacion.decodificar_token),
):
    persona_id = token_payload.get("persona_id")
    roles = token_payload.get("roles", [])
    servicio = NotificacionServicio(db)
    if "REPRESENTANTE" in roles:
        items, total = servicio.listar_para_persona_y_hijos(
            persona_id, skip=skip, limit=limit
        )
    else:
        items, total = servicio.listar_propias(persona_id, skip=skip, limit=limit)
    return PaginatedResponse(items=items, total=total, skip=skip, limit=limit)


@router.patch(
    "/leer-todas", response_model=MarcarTodasLeidasResponseDTO,
    dependencies=[Depends(GestorAutenticacion.decodificar_token)],
)
async def marcar_todas_notificaciones_leidas(
    db: Session = Depends(obtener_sesion),
    token_payload: dict = Depends(GestorAutenticacion.decodificar_token),
):
    """Declarada ANTES que `/{notificacion_id}/leer`: es un segmento literal
    de un solo nivel (`/leer-todas`), esa otra ruta necesita dos (`{id}` +
    `/leer`), así que no compiten por el mismo path -- el orden se conserva
    igual, como guardarraíl explícito contra una futura ruta de un solo
    segmento que sí pudiera chocar."""
    actualizadas = NotificacionServicio(db).marcar_todas_leidas(token_payload.get("persona_id"))
    return {"actualizadas": actualizadas}


@router.patch(
    "/{notificacion_id}/leer", response_model=NotificacionResponseDTO,
    dependencies=[Depends(GestorAutenticacion.decodificar_token)],
)
async def marcar_notificacion_leida(
    notificacion_id: int,
    db: Session = Depends(obtener_sesion),
    token_payload: dict = Depends(GestorAutenticacion.decodificar_token),
):
    return NotificacionServicio(db).marcar_leida(notificacion_id, token_payload.get("persona_id"))
