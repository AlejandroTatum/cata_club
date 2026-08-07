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
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import List

from app.infraestructura.db import obtener_sesion
from app.seguridad.gestor_auth import GestorAutenticacion
from app.servicios_negocio.notificacion_servicio import NotificacionServicio
from app.presentacion.schemas.notificacion_schemas import NotificacionResponseDTO

router = APIRouter(prefix="/ranking/notificaciones", tags=["notificaciones"])


@router.get(
    "/mias", response_model=List[NotificacionResponseDTO],
    dependencies=[Depends(GestorAutenticacion.decodificar_token)],
)
async def listar_mis_notificaciones(
    db: Session = Depends(obtener_sesion),
    token_payload: dict = Depends(GestorAutenticacion.decodificar_token),
):
    persona_id = token_payload.get("persona_id")
    roles = token_payload.get("roles", [])
    servicio = NotificacionServicio(db)
    if "REPRESENTANTE" in roles:
        return servicio.listar_para_persona_y_hijos(persona_id)
    return servicio.listar_propias(persona_id)


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
