"""
Router de autoinscripción pública (Escenario 2, Opción B).

Endpoint SIN autenticación que permite al representante (o al alumno adulto)
inscribirse directamente desde el wizard del frontend. Rate-limited para
prevenir abuso.

Flujo:
  Frontend wizard → POST /api/v1/enrollment/ → Persona + Usuario + (opcional)
  FichaMedica + AntecedentesClub → tokens JWT → auto-login inmediato.
"""
from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.orm import Session

from app.infraestructura.db import obtener_sesion
from app.presentacion.schemas.enrollment_schemas import EnrollmentCreateDTO, EnrollmentResponseDTO
from app.servicios_negocio.enrollment_servicio import EnrollmentServicio
from app.soporte_transversal.rate_limit import limiter

router = APIRouter(prefix="/enrollment", tags=["Autoinscripción"])


@router.post(
    "/",
    response_model=EnrollmentResponseDTO,
    status_code=status.HTTP_201_CREATED,
    summary="Autoinscripción pública de alumno",
    description=(
        "Endpoint público (sin auth) que crea Persona, Usuario, "
        "opcionalmente FichaMedica y AntecedentesClub en un solo request. "
        "Retorna tokens JWT para auto-login inmediato."
    ),
)
@limiter.limit("10/minute")
async def autoinscribir(
    request: Request,
    datos: EnrollmentCreateDTO,
    db: Session = Depends(obtener_sesion),
):
    return EnrollmentServicio(db).enroll(datos)
