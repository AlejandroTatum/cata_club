"""Segundo guardián de un menor (issue #1666).

Quién puede qué (ver `docs/guardian-permission-matrix.md`):
- `GET /co-representantes/mios`: cualquier guardián, sobre SUS menores.
- `POST /co-representantes/invitaciones` y `DELETE /co-representantes/persona/{id}`:
  el representante principal del menor o un administrador. El segundo
  guardián recibe 403: no administra guardianes.
La autorización la resuelve `PoliticaAccesoPersona` (alcance `FIRMA_LEGAL`)
dentro del servicio; el rol del token solo filtra la puerta de entrada.
"""
from typing import List

from fastapi import APIRouter, Depends, Request, Response, status
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.orm import Session

from app.infraestructura.db import obtener_sesion
from app.servicios_negocio.co_representante_servicio import (
    CoRepresentanteServicio, ResultadoInvitacion,
)
from app.servicios_negocio.dtos.co_representante_schemas import (
    InvitacionCoRepresentanteResponseDTO, InvitarCoRepresentanteDTO, MenorConGuardianesDTO,
)
from app.servicios_negocio.gestor_permisos import GestorPermisos
from app.soporte_transversal.rate_limit import limiter

router = APIRouter(prefix="/co-representantes", tags=["Segundo representante"])

ROLES_GUARDIAN = ["REPRESENTANTE", "ADMINISTRADOR"]


@router.get("/mios", response_model=List[MenorConGuardianesDTO])
async def listar_mis_menores(
    db: Session = Depends(obtener_sesion),
    token_payload: dict = Depends(GestorPermisos(["REPRESENTANTE"])),
):
    """Los menores de los que el solicitante es guardián (principal o
    segundo), con el segundo guardián visible solo para el principal."""
    return CoRepresentanteServicio(db).listar_mios(token_payload.get("persona_id"))


@router.post(
    "/invitaciones",
    response_model=InvitacionCoRepresentanteResponseDTO,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("10/minute")
async def invitar_co_representante(
    request: Request,
    datos: InvitarCoRepresentanteDTO,
    response: Response,
    db: Session = Depends(obtener_sesion),
    token_payload: dict = Depends(GestorPermisos(ROLES_GUARDIAN)),
):
    estado, persona_ids = await run_in_threadpool(
        CoRepresentanteServicio(db).invitar,
        persona_ids=datos.persona_ids,
        correo=datos.correo,
        datos=datos.datos,
        actor_persona_id=token_payload.get("persona_id"),
        roles=token_payload.get("roles", []),
    )
    if estado == ResultadoInvitacion.REQUIERE_DATOS:
        response.status_code = status.HTTP_200_OK
    return InvitacionCoRepresentanteResponseDTO(estado=estado, persona_ids=persona_ids)


@router.delete("/persona/{persona_id}", status_code=status.HTTP_204_NO_CONTENT)
async def quitar_co_representante(
    persona_id: int,
    db: Session = Depends(obtener_sesion),
    token_payload: dict = Depends(GestorPermisos(ROLES_GUARDIAN)),
):
    CoRepresentanteServicio(db).quitar(
        persona_id, token_payload.get("persona_id"), token_payload.get("roles", []),
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
