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
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.infraestructura.db import obtener_sesion
from app.presentacion.schemas.enrollment_schemas import EnrollmentCreateDTO, EnrollmentResponseDTO
from app.servicios_negocio.enrollment_servicio import (
    ConflictoIdempotencia,
    EnrollmentServicio,
)
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
    # Idempotency-Key (enrollment-idempotency): la acuña el frontend por
    # intento (y la reutiliza al reintentar); si no llega, el servicio acuña
    # una propia. Un intento en vuelo (PENDIENTE) responde 425 + Retry-After;
    # una clave ya consumida por otro payload responde 409.
    try:
        return EnrollmentServicio(db).enroll(
            datos,
            idempotency_key=request.headers.get("idempotency-key"),
        )
    except ConflictoIdempotencia as exc:
        # JSONResponse propia (no HTTPException) a propósito: el manejador
        # global de HTTPException en main.py reconstruye el body pero descarta
        # `headers`, y este conflicto en vuelo DEBE llevar `Retry-After`
        # (contrato del diseño: 425 + Retry-After). El body replica el
        # {detail, message} que el frontend ya sabe leer.
        codigo = (
            status.HTTP_425_TOO_EARLY
            if exc.retry_after is not None
            else status.HTTP_409_CONFLICT
        )
        headers = (
            {"Retry-After": str(exc.retry_after)}
            if exc.retry_after is not None
            else None
        )
        return JSONResponse(
            status_code=codigo,
            content={"detail": exc.mensaje, "message": exc.mensaje},
            headers=headers,
        )
