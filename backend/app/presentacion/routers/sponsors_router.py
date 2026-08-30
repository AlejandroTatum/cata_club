"""API de patrocinadores: lectura pública y administración exclusiva del club."""
from fastapi import APIRouter, Depends, File, Form, UploadFile, status
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.infraestructura.db import obtener_sesion
from app.presentacion.schemas.sponsor_schemas import SponsorCreateDTO, SponsorResponseDTO
from app.servicios_negocio.gestor_permisos import GestorPermisos
from app.servicios_negocio.sponsor_servicio import SponsorServicio
from app.soporte_transversal.lectura_archivos import leer_con_limite

router = APIRouter(prefix="/sponsors", tags=["Patrocinadores"])
ROL_ADMIN = ["ADMINISTRADOR"]


@router.get("/", response_model=list[SponsorResponseDTO])
async def listar_sponsors(db: Session = Depends(obtener_sesion)):
    """Los logos publicados son parte de la landing pública."""
    return SponsorServicio(db).listar()


@router.post(
    "/", response_model=SponsorResponseDTO, status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(GestorPermisos(ROL_ADMIN))],
)
async def crear_sponsor(
    nombre: str = Form(...),
    archivo: UploadFile = File(...),
    db: Session = Depends(obtener_sesion),
):
    # `SponsorCreateDTO` no puede declararse como "form model" de FastAPI
    # (`Annotated[SponsorCreateDTO, Form()]`): al convivir con `archivo:
    # UploadFile = File(...)` como parámetro hermano, FastAPI deja de
    # aplanar los campos del modelo sobre el multipart y exige un campo
    # anidado `datos` en su lugar, rompiendo el contrato actual (`nombre` +
    # `archivo` sueltos). Por eso se sigue construyendo el DTO a mano, pero
    # capturando el `ValidationError` de pydantic y re-lanzándolo como
    # `RequestValidationError` -- la excepción que `main.py` ya sabe
    # traducir a un 422 con el mensaje en castellano del `field_validator`,
    # en vez de dejarlo escalar sin manejar a un 500 (nombre en blanco o
    # solo espacios).
    try:
        datos = SponsorCreateDTO(nombre=nombre)
    except ValidationError as exc:
        raise RequestValidationError(exc.errors()) from exc
    # Issues #824 y #838: antes se leía el cuerpo completo sin tope y recién
    # el servicio comparaba el tamaño -- este era el único upload del backend
    # fuera de `leer_con_limite` (auth_router.py:144, personas_router.py:563
    # y membresias_pagos_router.py:657 ya lo usaban). Además del pico de
    # memoria, el rechazo salía con un mensaje propio en vez del compartido,
    # obligando al frontend a distinguir el caso.
    contenido = await leer_con_limite(archivo, SponsorServicio.TAMANO_MAXIMO_LOGO_BYTES)
    return SponsorServicio(db).crear(datos, contenido, archivo.content_type)


@router.delete(
    "/{sponsor_id}", status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(GestorPermisos(ROL_ADMIN))],
)
async def eliminar_sponsor(sponsor_id: int, db: Session = Depends(obtener_sesion)):
    SponsorServicio(db).eliminar(sponsor_id)
