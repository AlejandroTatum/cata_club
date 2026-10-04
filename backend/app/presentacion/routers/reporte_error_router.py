"""Canal privado de reportes iniciados explícitamente por usuarios (#1401)."""
from datetime import datetime

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.dominio.enums import TipoNotificacion, TipoRol
from app.dominio.excepciones import OperacionInvalida
from app.dominio.modelos import Notificacion, ReporteError, Rol, Usuario
from app.infraestructura.db import obtener_sesion
from app.infraestructura.repositorios.reporte_error_repositorio import ReporteErrorRepositorio
from app.seguridad.gestor_auth import GestorAutenticacion
from app.servicios_negocio.gestor_permisos import GestorPermisos
from app.servicios_negocio.reporte_error_servicio import MAX_CAPTURA, validar_captura, validar_request_id
from app.soporte_transversal.lectura_archivos import leer_con_limite
from app.soporte_transversal.rate_limit import limiter

router = APIRouter(prefix="/reportes-error", tags=["Errores reportados"])


class ReporteDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    persona_id: int
    descripcion: str
    request_id: str | None
    ruta: str | None
    user_agent: str | None
    fecha_creacion: datetime
    captura_mime: str | None


@router.post("/", status_code=201, response_model=ReporteDTO)
@limiter.limit("5/minute")
async def crear_reporte(
    request: Request,
    descripcion: str = Form(min_length=1, max_length=2000),
    ruta: str | None = Form(default=None, max_length=500),
    captura: UploadFile | None = File(default=None),
    consentimiento_captura: bool = Form(default=False),
    x_request_id: str | None = Header(default=None),
    db: Session = Depends(obtener_sesion),
    token_payload: dict = Depends(GestorAutenticacion.decodificar_token),
):
    if not descripcion.strip():
        raise HTTPException(422, "La descripción es obligatoria")
    try:
        validar_request_id(x_request_id)
    except ValueError as exc:
        raise HTTPException(422, "Identificador de solicitud inválido") from exc
    contenido = None
    mime = None
    if captura is not None:
        if not consentimiento_captura:
            raise HTTPException(422, "Debes aceptar el envío de la captura")
        try:
            contenido = await leer_con_limite(captura, MAX_CAPTURA)
            mime = captura.content_type or ""
            validar_captura(mime, contenido)
        except (ValueError, OperacionInvalida) as exc:
            raise HTTPException(422, "Captura inválida: usa PNG, JPEG o WebP de hasta 2 MB") from exc
    repo = ReporteErrorRepositorio(db)
    reporte = repo.crear(ReporteError(
        persona_id=token_payload["persona_id"], descripcion=descripcion.strip(),
        request_id=x_request_id, ruta=ruta, user_agent=request.headers.get("user-agent", "")[:500],
        captura=contenido, captura_mime=mime,
    ))
    for admin in db.query(Usuario).join(Usuario.roles).filter(
        Rol.tipo_rol == TipoRol.ADMINISTRADOR, Usuario.activo.is_(True)
    ).all():
        db.add(Notificacion(
            persona_id=admin.persona_id, tipo=TipoNotificacion.NUEVO_REPORTE_ERROR,
            mensaje=f"Nuevo error reportado #{reporte.id}", entidad_relacionada_id=reporte.id,
        ))
    db.commit()
    db.refresh(reporte)
    return reporte


@router.get("/", response_model=list[ReporteDTO], dependencies=[Depends(GestorPermisos(["ADMINISTRADOR"]))])
def listar_reportes(skip: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=100), db: Session = Depends(obtener_sesion)):
    return ReporteErrorRepositorio(db).listar(skip, limit)


@router.get("/{reporte_id}", response_model=ReporteDTO, dependencies=[Depends(GestorPermisos(["ADMINISTRADOR"]))])
def obtener_reporte(reporte_id: int, db: Session = Depends(obtener_sesion)):
    reporte = ReporteErrorRepositorio(db).obtener(reporte_id)
    if reporte is None:
        raise HTTPException(404, "Error reportado no encontrado")
    return reporte


@router.get("/{reporte_id}/captura", dependencies=[Depends(GestorPermisos(["ADMINISTRADOR"]))])
def obtener_captura(reporte_id: int, db: Session = Depends(obtener_sesion)):
    reporte = ReporteErrorRepositorio(db).obtener(reporte_id)
    if reporte is None or reporte.captura is None:
        raise HTTPException(404, "Captura no encontrada")
    return Response(reporte.captura, media_type=reporte.captura_mime, headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})
