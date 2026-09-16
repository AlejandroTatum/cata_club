"""Endpoints admin del procedimiento de supresión de datos (issue #1062).

D1: NO existe ruta de autogestión -- toda petición la registra, aprueba y
ejecuta un ADMINISTRADOR. El flujo es RECIBIDA -> APROBADA -> EJECUTADA
(o RECHAZADA); `SupresionDatosServicio` guarda las reglas (D2, D3, D8).
"""
from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.infraestructura.db import obtener_sesion
from app.servicios_negocio.gestor_permisos import GestorPermisos
from app.servicios_negocio.supresion_datos_servicio import SupresionDatosServicio

router = APIRouter(prefix="/supresion-datos", tags=["Supresión de datos"])
ROL_ADMIN = ["ADMINISTRADOR"]


class SolicitudSupresionCreateDTO(BaseModel):
    persona_id: int
    motivo: str = Field(min_length=1, max_length=500)


class SolicitudSupresionRechazoDTO(BaseModel):
    razon: str = Field(min_length=1, max_length=500)


class SolicitudSupresionResponseDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    persona_id: int
    solicitada_por_persona_id: int
    aprobada_por_persona_id: int | None
    estado: str
    fecha_solicitud: object
    fecha_aprobacion: object | None
    fecha_ejecucion: object | None
    motivo: str
    notas: str | None
    razon_rechazo: str | None
    detalle_ejecucion: str | None


@router.post(
    "/",
    response_model=SolicitudSupresionResponseDTO,
    status_code=status.HTTP_201_CREATED,
)
def crear_solicitud(
    datos: SolicitudSupresionCreateDTO,
    db: Session = Depends(obtener_sesion),
    token_payload: dict = Depends(GestorPermisos(ROL_ADMIN)),
):
    """Registra la petición de supresión para una persona (estado RECIBIDA)."""
    return SupresionDatosServicio(db).crear(
        datos.persona_id, datos.motivo, token_payload["persona_id"]
    )


@router.get("/", response_model=list[SolicitudSupresionResponseDTO],
             dependencies=[Depends(GestorPermisos(ROL_ADMIN))])
def listar_solicitudes(db: Session = Depends(obtener_sesion)):
    return SupresionDatosServicio(db).listar()


@router.get("/{solicitud_id}", response_model=SolicitudSupresionResponseDTO,
             dependencies=[Depends(GestorPermisos(ROL_ADMIN))])
def obtener_solicitud(solicitud_id: int, db: Session = Depends(obtener_sesion)):
    return SupresionDatosServicio(db).obtener_detalle(solicitud_id)


@router.post("/{solicitud_id}/aprobar", response_model=SolicitudSupresionResponseDTO)
def aprobar_solicitud(
    solicitud_id: int,
    db: Session = Depends(obtener_sesion),
    token_payload: dict = Depends(GestorPermisos(ROL_ADMIN)),
):
    return SupresionDatosServicio(db).aprobar(solicitud_id, token_payload["persona_id"])


@router.post("/{solicitud_id}/rechazar", response_model=SolicitudSupresionResponseDTO)
def rechazar_solicitud(
    solicitud_id: int,
    datos: SolicitudSupresionRechazoDTO,
    db: Session = Depends(obtener_sesion),
    token_payload: dict = Depends(GestorPermisos(ROL_ADMIN)),
):
    return SupresionDatosServicio(db).rechazar(
        solicitud_id, datos.razon, token_payload["persona_id"]
    )


@router.post("/{solicitud_id}/ejecutar", response_model=SolicitudSupresionResponseDTO)
def ejecutar_solicitud(
    solicitud_id: int,
    db: Session = Depends(obtener_sesion),
    token_payload: dict = Depends(GestorPermisos(ROL_ADMIN)),
):
    """Ejecuta la anonimización. Falla (400/503) si las guardias D2/D3/D8 no
    se satisfacen o si Cloudinary no responde; en ese caso NO queda nada a
    medio camino."""
    return SupresionDatosServicio(db).ejecutar(solicitud_id, token_payload["persona_id"])
