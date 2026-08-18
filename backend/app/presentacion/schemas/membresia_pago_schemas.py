from pydantic import BaseModel, Field, model_validator
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from app.dominio.enums import EstadoMembresia, TipoModalidad, EstadoPago, TipoPago
from app.presentacion.schemas.base import ResponseBase


# --- TipoMembresia ---
class TipoMembresiaCreateDTO(BaseModel):
    categoria: str
    precio: Decimal = Field(..., gt=0)
    modalidad: TipoModalidad


class TipoMembresiaUpdateDTO(BaseModel):
    """PATCH parcial del catálogo de tarifas (issue #394): solo los campos
    enviados se aplican (`exclude_unset` en el servicio). Mismo `gt=0` que el
    POST -- una tarifa en cero o negativa no describe ningún plan comercial, y
    además rompería la cuenta de meses, que divide por este número.

    No hay campo para retirar un tipo del catálogo: `TipoMembresia` no tiene
    columna `activo` y agregarla es una migración aparte. #394 pide poder
    EDITAR el precio; retirar un plan queda fuera de este alcance."""
    categoria: Optional[str] = Field(None, min_length=1, max_length=80)
    precio: Optional[Decimal] = Field(None, gt=0)
    modalidad: Optional[TipoModalidad] = None


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
    persona_id: int
    membresia_id: int
    # Issue #11: descuento del catálogo a aplicar en ESTE registro (solo un
    # ADMINISTRADOR puede enviarlo; ver `PagoServicio.registrar_pago`). El
    # `monto` de arriba es el monto BASE (sin descontar): el servicio resuelve
    # el valor vigente, lo congela y calcula el monto final. Un pago lleva UN
    # solo descuento -- la lista existe por compatibilidad del contrato HTTP,
    # pero el servicio rechaza con 400 cualquier envío de más de un id.
    descuento_ids: list[int] = Field(default_factory=list)

    # `fecha_inicio`/`fecha_fin` NO se aceptan del cliente (fix período de
    # cobertura, PAG-5): el endpoint permitía mandar CUALQUIER rango -- un
    # pago de un mes con un año de cobertura, reproducido en vivo contra QA
    # (ver docs/archive/fixes/06-periodo-de-cobertura.md). El período ahora lo
    # deriva `PagoServicio.registrar_pago` del monto base y la cuota; un
    # campo que el cliente mande y el backend descarte en silencio es la
    # próxima confusión, así que se quita del contrato en vez de ignorarse.


class PagoValidarDTO(BaseModel):
    estado_pago: EstadoPago
    motivo_rechazo: Optional[str] = Field(None, max_length=255)
    fecha_inicio: Optional[date] = None
    fecha_fin: Optional[date] = None

    @model_validator(mode="after")
    def _validar_campos(self) -> "PagoValidarDTO":
        if self.estado_pago == EstadoPago.RECHAZADO:
            if self.motivo_rechazo is None or not self.motivo_rechazo.strip():
                raise ValueError("Debe indicar el motivo del rechazo.")
        if (self.fecha_inicio is None) != (self.fecha_fin is None):
            raise ValueError("Indique la fecha de inicio y la de fin, o ninguna de las dos.")
        if self.fecha_inicio is not None and self.fecha_fin is not None:
            if self.fecha_inicio >= self.fecha_fin:
                raise ValueError("La fecha de inicio debe ser anterior a la de fin.")
        return self


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
    # Issue #11: descuento congelado aplicado a este pago (columnas de Pago,
    # no una tabla aparte -- ver `app.dominio.modelos.Pago`). Los cuatro son
    # `None` cuando el pago no lleva descuento.
    descuento_id: Optional[int] = None
    descuento_valor_aplicado: Optional[Decimal] = None
    descuento_porcentaje_aplicado: Optional[Decimal] = None
    descuento_autorizado_por_persona_id: Optional[int] = None
    # `PagoServicio.validar_pago` lo setea como atributo transitorio (no es
    # columna de `Pago`) cuando aprobar/rechazar el pago sale bien pero el
    # aviso in-app al alumno/representante falla. El pago YA quedó en el
    # estado que dice `estado_pago` -- este campo es lo que le dice al
    # administrador que el aviso no salió, en vez de dejarlo bajo un 200
    # mudo (hallazgo en vivo, 2026-08-11).
    aviso_no_enviado: bool = False


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


# --- Deuda y regularización (issue #284) -------------------------------------
# Deuda = meses adeudados desde la última cobertura aprobada hasta hoy; es un
# valor DERIVADO (sin columna nueva). Solo la ve un ADMINISTRADOR (nunca el
# alumno/representante). La regularización es bookkeeping del admin: fechas
# retroactivas explícitas y motivo obligatorio.
class DeudaMembresiaResponseDTO(ResponseBase, BaseModel):
    meses_adeudados: int = Field(..., examples=[4])
    ultima_cobertura_fin: Optional[date] = Field(default=None, examples=["2026-03-31"])
    monto_mensual: Decimal = Field(..., examples=["30.00"])


class RegularizacionDeudaDTO(BaseModel):
    monto: Decimal = Field(..., gt=0)
    fecha_inicio: date
    fecha_fin: date
    motivo: str = Field(..., min_length=1, max_length=255)

    @model_validator(mode="after")
    def _validar(self) -> "RegularizacionDeudaDTO":
        if not self.motivo.strip():
            raise ValueError("Debe indicar el motivo de la regularización.")
        if self.fecha_inicio >= self.fecha_fin:
            raise ValueError("La fecha de inicio debe ser anterior a la de fin.")
        return self


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
