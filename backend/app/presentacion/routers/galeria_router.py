"""API de la galería de la landing: lectura pública y administración del club."""
from fastapi import APIRouter, Depends, File, Form, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.infraestructura.db import obtener_sesion
from app.servicios_negocio.dtos.galeria_schemas import (
    EntradaGaleriaCreateDTO, EntradaGaleriaResponseDTO,
)
from app.servicios_negocio.galeria_servicio import GaleriaServicio
from app.servicios_negocio.gestor_permisos import GestorPermisos
from app.soporte_transversal.lectura_archivos import leer_con_limite

router = APIRouter(prefix="/galeria", tags=["Galería"])
ROL_ADMIN = ["ADMINISTRADOR"]


@router.get("/", response_model=list[EntradaGaleriaResponseDTO])
async def listar_entradas(db: Session = Depends(obtener_sesion)):
    """Las imágenes publicadas son parte de la landing pública."""
    return GaleriaServicio(db).listar()


@router.post(
    "/", response_model=EntradaGaleriaResponseDTO, status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(GestorPermisos(ROL_ADMIN))],
)
async def crear_entrada(
    titulo: str = Form(...),
    descripcion: str = Form(...),
    archivo: UploadFile = File(...),
    db: Session = Depends(obtener_sesion),
):
    # `EntradaGaleriaCreateDTO` no puede declararse como "form model" de
    # FastAPI: al convivir con `archivo: UploadFile = File(...)` como
    # parámetro hermano, FastAPI deja de aplanar los campos del modelo sobre
    # el multipart. Mismo criterio (y mismo comentario) que
    # `sponsors_router.crear_sponsor`: el DTO se construye a mano capturando
    # el `ValidationError` de pydantic y re-lanzándolo como
    # `RequestValidationError`, la excepción que `main.py` ya traduce a un
    # 422 con el mensaje en castellano del `field_validator`.
    try:
        datos = EntradaGaleriaCreateDTO(titulo=titulo, descripcion=descripcion)
    except ValidationError as exc:
        raise RequestValidationError(exc.errors()) from exc
    # Lectura acotada antes de tocar la base o Cloudinary (issues #824/#826,
    # mismo criterio que `sponsors_router`): sin tope en la lectura, el
    # proceso materializaba en RAM un archivo arbitrariamente grande ANTES
    # de saber si era aceptable.
    contenido = await leer_con_limite(archivo, GaleriaServicio.TAMANO_MAXIMO_IMAGEN_BYTES)
    # `run_in_threadpool` (mismo criterio que `sponsors_router`, issues #826
    # y #835): el servicio termina en llamadas síncronas al SDK de
    # Cloudinary, acotadas por `TIMEOUT_CLOUDINARY_TOTAL_SEGUNDOS` (8 s). El
    # backend corre UN proceso de uvicorn sin `--workers`, así que una subida
    # llamada directo desde la coroutine retiene el único hilo del event
    # loop. El candado de `tests/test_bloqueo_del_event_loop.py` la vuelve
    # obligatoria.
    return await run_in_threadpool(
        GaleriaServicio(db).crear, datos, contenido, archivo.content_type,
    )


@router.delete(
    "/{entrada_id}", status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(GestorPermisos(ROL_ADMIN))],
)
async def eliminar_entrada(entrada_id: int, db: Session = Depends(obtener_sesion)):
    # El borrado también habla con Cloudinary (`eliminar_imagen_galeria`
    # llama a `cloudinary.uploader.destroy`, con el mismo presupuesto de red
    # que la subida): mismo motivo de `run_in_threadpool` que el POST.
    await run_in_threadpool(GaleriaServicio(db).eliminar, entrada_id)
