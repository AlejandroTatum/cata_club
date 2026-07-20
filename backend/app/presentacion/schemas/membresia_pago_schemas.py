from pydantic import BaseModel, Field, model_validator
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from app.dominio.enums import EstadoMembresia, TipoModalidad, EstadoPago, TipoPago
from app.presentacion.schemas.base import ResponseBase


# --- TipoMembresia ---
class TipoMembresiaCreateDTO(BaseModel):
    categoria: str
    franja_horaria: str
    precio: Decimal = Field(..., gt=0)
    modalidad: TipoModalidad


class TipoMembresiaResponseDTO(ResponseBase, TipoMembresiaCreateDTO):
    id: int


# --- Membresia ---
class MembresiaCreateDTO(BaseModel):
    monto_aplicado: Decimal = Field(..., gt=0)
    persona_id: int
    tipo_membresia_id: int


class MembresiaResponseDTO(ResponseBase, BaseModel):
    id: int
    estado: EstadoMembresia
    monto_aplicado: Decimal
    fecha_activacion: datetime
    persona_id: int
    tipo_membresia_id: int


class MembresiaEstadisticasResponseDTO(ResponseBase, BaseModel):
    active_memberships: int


# --- Pago ---
class PagoCreateDTO(BaseModel):
    monto: Decimal = Field(..., gt=0)
    tipo_pago: TipoPago
    fecha_inicio: date
    fecha_fin: date
    persona_id: int
    membresia_id: int

    @model_validator(mode="after")
    def _orden_fechas(self) -> "PagoCreateDTO":
        if self.fecha_inicio >= self.fecha_fin:
            raise ValueError("fecha_inicio debe ser menor que fecha_fin")
        return self


class PagoValidarDTO(BaseModel):
    estado_pago: EstadoPago
    motivo_rechazo: Optional[str] = Field(None, max_length=255)


class PagoResponseDTO(ResponseBase, BaseModel):
    id: int
    monto: Decimal
    motivo_rechazo: Optional[str] = None
    estado_pago: EstadoPago
    tipo_pago: TipoPago
    fecha_registro: datetime
    fecha_validacion: Optional[datetime] = None
    fecha_inicio: date
    fecha_fin: date
    persona_id: int
    membresia_id: int
    voucher_url: Optional[str] = None
    voucher_formato: Optional[str] = None
    voucher_fecha_carga: Optional[datetime] = None


# --- Listado / cola de validación (GET /membresias/pagos) -------------------
class PagoListItemDTO(ResponseBase, BaseModel):
    id: int = Field(..., examples=[1])
    monto: Decimal = Field(..., examples=["50.00"])
    estado_pago: EstadoPago = Field(..., examples=["APROBADO"])
    tipo_pago: TipoPago = Field(..., examples=["TRANSFERENCIA"])
    fecha_registro: datetime = Field(..., examples=["2024-06-01T09:00:00Z"])
    fecha_validacion: Optional[datetime] = Field(default=None, examples=["2024-06-02T14:30:00Z"])
    fecha_inicio: date = Field(..., examples=["2024-06-01"])
    fecha_fin: date = Field(..., examples=["2024-12-31"])
    persona_id: int = Field(..., examples=[1])
    persona_nombre_completo: str = Field(..., examples=["Juan Carlos Pérez López"])
    membresia_id: int = Field(..., examples=[1])
    voucher_url: Optional[str] = Field(default=None, examples=["https://res.cloudinary.com/..."])
    voucher_formato: Optional[str] = Field(default=None, examples=["image/jpeg"])


# --- ComprobantePago ---
class ComprobantePagoCreateDTO(BaseModel):
    archivo_url: str
    formato_archivo: str


class ComprobantePagoResponseDTO(ResponseBase, BaseModel):
    id: int
    archivo_url: str
    formato_archivo: str
    fecha_carga: datetime
    pago_id: int
