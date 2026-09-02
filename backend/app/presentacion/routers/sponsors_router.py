"""API de patrocinadores: lectura pública y administración exclusiva del club."""
from fastapi import APIRouter, Depends, File, Form, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.infraestructura.db import obtener_sesion
from app.servicios_negocio.dtos.sponsor_schemas import SponsorCreateDTO, SponsorResponseDTO
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
    # `run_in_threadpool` (issue #826): `SponsorServicio.crear` termina en
    # `cloudinary.uploader.upload`, SDK síncrono contra la red acotado por
    # `TIMEOUT_CLOUDINARY_TOTAL_SEGUNDOS` (8 s). El backend corre UN proceso de
    # uvicorn sin `--workers` (`Dockerfile:53`), así que esa subida llamada
    # directo desde la coroutine retiene el único hilo del event loop y ningún
    # otro cliente es atendido -- ni `GET /health`. Misma corrección que
    # `subir_voucher` (issue #450) y `login` (issue #311); el candado de
    # `tests/test_bloqueo_del_event_loop.py` la vuelve obligatoria.
    return await run_in_threadpool(
        SponsorServicio(db).crear, datos, contenido, archivo.content_type,
    )


@router.delete(
    "/{sponsor_id}", status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(GestorPermisos(ROL_ADMIN))],
)
async def eliminar_sponsor(sponsor_id: int, db: Session = Depends(obtener_sesion)):
    # `run_in_threadpool` (issue #835): el borrado también habla con Cloudinary
    # -- `eliminar_logo_sponsor` llama a `cloudinary.uploader.destroy`, con el
    # mismo presupuesto de red que la subida. La corrección de #826 no lo
    # incluía: es la cuarta vez que este defecto se arregla de a un sitio, y el
    # motivo de que el candado mire la clase entera y no una lista.
    await run_in_threadpool(SponsorServicio(db).eliminar, sponsor_id)
