from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.infraestructura.db import obtener_sesion
from app.presentacion.routers.membresias_pagos_router import _con_cubierto_hasta
from app.seguridad.gestor_auth import GestorAutenticacion
from app.servicios_negocio.dtos.portal_schemas import (
    PortalAlumnoResponseDTO, PortalBloqueoRepresentadoDTO, PortalBloqueosResponseDTO, PortalPerfilDTO,
)
from app.servicios_negocio.politica_acceso import SOLO_ADMINISTRADOR, PoliticaAccesoPersona
from app.servicios_negocio.portal_servicio import HISTORIAL_LIMITE_MAXIMO, PerfilPortal, PortalServicio
from app.soporte_transversal.rate_limit import limiter

router = APIRouter(prefix="/portal", tags=["Portal"])


# Issue #1592: UNA llamada para `GET /api/student` del BFF (antes ~4 por
# perfil). Mismo gate que `GET /personas/{id}/representados`, que el BFF
# llamaba primero: solo el titular de la cuenta o un ADMINISTRADOR -- el
# ENTRENADOR no ve datos personales ni de membresía (issue #356). Cubre cada
# perfil devuelto: son la propia persona y sus representados activos.
# Mismo tier 30/min que ese endpoint.
@router.get(
    "/alumno/{persona_id}",
    response_model=PortalAlumnoResponseDTO,
    dependencies=[Depends(GestorAutenticacion.decodificar_token)],
)
@limiter.limit("30/minute")
def obtener_portal_alumno(
    request: Request,
    persona_id: int,
    historial_limite: int = Query(default=HISTORIAL_LIMITE_MAXIMO, ge=1, le=HISTORIAL_LIMITE_MAXIMO),
    token_payload: dict = Depends(GestorAutenticacion.decodificar_token),
    db: Session = Depends(obtener_sesion),
):
    PoliticaAccesoPersona(db).exigir_acceso_directo(
        persona_id_objetivo=persona_id,
        persona_id_solicitante=token_payload.get("persona_id"),
        roles_solicitante=token_payload.get("roles", []),
        roles_privilegiados=SOLO_ADMINISTRADOR,
        mensaje="No puedes consultar el portal de otra cuenta",
    )
    portal = PortalServicio(db).obtener(persona_id, historial_limite)
    perfiles = [portal.titular, *portal.representados]
    # Una sola resolución de cobertura para TODAS las membresías (agrupada).
    membresias_dto = {
        dto.id: dto
        for dto in _con_cubierto_hasta(db, [m for p in perfiles for m in p.membresias])
    }
    return PortalAlumnoResponseDTO(
        titular=_a_dto(portal.titular, membresias_dto),
        representados=[_a_dto(p, membresias_dto) for p in portal.representados],
        horarios=portal.horarios,
        tipos=portal.tipos,
    )


# #1787: la compuerta del BFF consulta esto en CADA pedido gated sobre un
# dependiente. Es una lectura liviana (sin historial ni catálogos) con el mismo
# gate de acceso que el portal, y un tope propio más alto: el 30/min del
# agregado se agotaría con un tutor que pagina rápido.
@router.get(
    "/alumno/{persona_id}/bloqueos",
    response_model=PortalBloqueosResponseDTO,
    dependencies=[Depends(GestorAutenticacion.decodificar_token)],
)
@limiter.limit("120/minute")
def obtener_bloqueos_representados(
    request: Request,
    persona_id: int,
    token_payload: dict = Depends(GestorAutenticacion.decodificar_token),
    db: Session = Depends(obtener_sesion),
):
    PoliticaAccesoPersona(db).exigir_acceso_directo(
        persona_id_objetivo=persona_id,
        persona_id_solicitante=token_payload.get("persona_id"),
        roles_solicitante=token_payload.get("roles", []),
        roles_privilegiados=SOLO_ADMINISTRADOR,
        mensaje="No puedes consultar el portal de otra cuenta",
    )
    bloqueos = PortalServicio(db).bloqueos_de_representados(persona_id)
    return PortalBloqueosResponseDTO(
        representados=[
            PortalBloqueoRepresentadoDTO(persona_id=pid, bloqueado_por_impago=bloqueado)
            for pid, bloqueado in bloqueos.items()
        ]
    )


def _a_dto(perfil: PerfilPortal, membresias_dto: dict) -> PortalPerfilDTO:
    return PortalPerfilDTO.model_validate(
        {
            "persona": perfil.persona,
            "representante": perfil.representante,
            "historial": perfil.historial,
            "historial_total": perfil.historial_total,
            "membresias": [membresias_dto[m.id] for m in perfil.membresias],
            "bloqueado_por_impago": perfil.bloqueo.bloqueado,
            "cubierto_hasta": perfil.bloqueo.cubierto_hasta,
        }
    )
