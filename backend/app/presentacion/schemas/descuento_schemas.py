"""
DTOs del catálogo de descuentos y de su aplicación a pagos (issue #11).

El invariante "porcentaje O monto fijo, nunca ambos ni ninguno" se valida
aquí como camino primario de error (422 con mensaje claro); el CHECK
`ck_descuento_porcentaje_o_monto` de la base es la red de seguridad.
"""
from datetime import datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, Field, model_validator

from app.presentacion.schemas.base import ResponseBase

_MENSAJE_EXCLUSIVIDAD = (
    "El descuento debe definir exactamente uno: porcentaje o monto fijo"
)


class DescuentoCreateDTO(BaseModel):
    nombre: str = Field(..., min_length=1, max_length=100)
    porcentaje: Optional[Decimal] = Field(None, gt=0, le=100)
    monto: Optional[Decimal] = Field(None, gt=0)
    activo: bool = True

    @model_validator(mode="after")
    def _porcentaje_o_monto(self) -> "DescuentoCreateDTO":
        if (self.porcentaje is None) == (self.monto is None):
            raise ValueError(_MENSAJE_EXCLUSIVIDAD)
        return self


class DescuentoUpdateDTO(BaseModel):
    """PATCH parcial: solo los campos enviados se aplican (exclude_unset en
    el servicio). Un null explícito en porcentaje/monto es válido y necesario
    para CAMBIAR la modalidad del descuento (ej. de porcentual a monto fijo);
    la exclusividad del estado FINAL la valida el servicio, que es quien
    conoce los valores vigentes."""
    nombre: Optional[str] = Field(None, min_length=1, max_length=100)
    porcentaje: Optional[Decimal] = Field(None, gt=0, le=100)
    monto: Optional[Decimal] = Field(None, gt=0)
    activo: Optional[bool] = None


class DescuentoResponseDTO(ResponseBase, BaseModel):
    id: int
    nombre: str
    porcentaje: Optional[Decimal] = None
    monto: Optional[Decimal] = None
    activo: bool


class DescuentoAplicadoResponseDTO(ResponseBase, BaseModel):
    """Registro histórico congelado: lo que se descontó, con qué porcentaje
    vigente (si era porcentual), a quién y con qué autorización."""
    id: int
    valor_aplicado: Decimal
    porcentaje_aplicado: Optional[Decimal] = None
    fecha: datetime
    pago_id: int
    descuento_id: int
    persona_id: int
    autorizado_por_persona_id: int
