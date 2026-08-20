from pydantic import BaseModel, Field, field_validator, model_validator
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Optional

from app.dominio.enums import (
    EstadoMembresia, TipoModalidad, EstadoPago, TipoPago, EfectoCoberturaCorreccion,
)
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
    EDITAR el precio; retirar un plan queda fuera de este alcance.

    Un `null` explícito en `categoria`/`precio`/`modalidad` se RECHAZA acá
    (hallazgo de review adversarial, issue #400). Esta clase copió la forma
    de `DescuentoUpdateDTO` (`Optional[...] = Field(None, ...)`), donde un
    null explícito SÍ es válido porque `porcentaje`/`monto` son
    genuinamente nulleables en la base y el null es la señal para cambiar de
    modalidad. Acá las tres columnas son NOT NULL: no existe una "modalidad
    nula" del campo, así que la misma forma es un agujero de validación. Sin
    este validador, `exclude_unset` en el servicio (que solo descarta claves
    OMITIDAS, no claves presentes con valor `null`) dejaba pasar el `None`
    hasta `setattr`, y el `IntegrityError` de la columna NOT NULL se
    traducía en un 409 de conflicto que no nombraba el campo ni describía el
    problema real. El rechazo debe pasar en esta capa -- antes de tocar la
    base -- con un 422 que sí lo nombra."""
    categoria: Optional[str] = Field(None, min_length=1, max_length=80)
    precio: Optional[Decimal] = Field(None, gt=0)
    modalidad: Optional[TipoModalidad] = None

    @field_validator("categoria", "precio", "modalidad", mode="before")
    @classmethod
    def _rechazar_valor_vacio_explicito(cls, valor, info):
        if valor is None:
            raise ValueError(
                f"No se puede dejar '{info.field_name}' sin valor. Si no "
                "desea modificarlo, no lo incluya en la solicitud."
            )
        return valor


class TipoMembresiaResponseDTO(ResponseBase, TipoMembresiaCreateDTO):
    id: int


class TarifaPublicaDTO(ResponseBase, BaseModel):
    """Mitad pública del catálogo de tarifas (issue #394, contrato de issue
    #331): SOLO `categoria` y `precio`. A propósito sin `id` ni `modalidad`
    -- son detalles administrativos del plan (edición, agrupación interna),
    no parte de lo que un visitante anónimo necesita ver antes de
    inscribirse. `TipoMembresiaResponseDTO` de arriba sigue siendo el DTO
    completo para el admin autenticado; este es un catálogo aparte, no un
    subconjunto derivado en runtime."""
    categoria: str
    precio: Decimal


# --- Membresia ---
class MembresiaCreateDTO(BaseModel):
    """Asignar un plan dice a QUIÉN y CUÁL, nunca CUÁNTO (issue #400).

    `monto_aplicado` se quitó a propósito: lo enviaba el cliente y el servicio
    lo copiaba sin mirar `TipoMembresia.precio`, así que el número con el que
    el club cobra viajaba por la red editable. Ahora lo resuelve el backend.

    Un `monto_aplicado` que llegue igual se IGNORA en silencio, que es el
    comportamiento por defecto de Pydantic para campos de más. Se elige
    ignorar y no rechazar para no romper a un cliente viejo durante la cadena;
    el candado de `tests/test_tarifa_resuelta_server_side.py` demuestra que
    ignorar significa ignorar y no "aceptar sin querer"."""
    persona_id: int
    tipo_membresia_id: int


class MembresiaResponseDTO(ResponseBase, BaseModel):
    id: int
    estado: EstadoMembresia
    monto_aplicado: Decimal
    fecha_activacion: datetime
    persona_id: int
    tipo_membresia_id: int
    # Issue #400 (slice 4c-a): expone el flag ya persistido (`Membresia.
    # es_gratuidad_familiar`, ver `_aplicar_regla_familiar_si_corresponde`) sin
    # cambiar nada de lo que se persiste. El frontend hoy INFIERE gratuidad de
    # `monto_aplicado == 0`, y una próxima rebanada deja de poner ese monto en
    # cero -- si el flag no llega ANTES, esas pantallas se rompen en silencio.
    # Es la señal autorizada de gratuidad; un precio en cero NO lo es por sí
    # solo (`scripts/inventario_anomalias_membresias.py` distingue "cero
    # coherente" de "cero sin explicar" -- nada en la base obliga que ambos
    # coincidan).
    es_gratuidad_familiar: bool


class MembresiaEstadisticasResponseDTO(ResponseBase, BaseModel):
    active_memberships: int


# --- Pago ---
class PagoCreateDTO(BaseModel):
    """Registrar un pago dice CUÁNTO y CÓMO, nunca CON QUÉ DESCUENTO
    (issue #398/#400).

    `descuento_ids` se quitó a propósito: lo enviaba el cliente (antes
    admin-only) y el servicio resolvía ESE descuento contra el catálogo. Ahora
    el backend resuelve la asignación VIGENTE (`AsignacionDescuento`) de
    `persona_id` y congela su valor solo -- ver
    `PagoServicio._congelar_beneficio_activo`. Un usuario nunca puede enviar
    un `descuento_id` para concedérselo (issue #398, "seguridad e
    invariantes"): la única fuente de un beneficio es la asignación que un
    ADMINISTRADOR haya creado por separado.

    Igual que `monto_aplicado` en `MembresiaCreateDTO`, un `descuento_ids` que
    llegue igual se IGNORA en silencio (comportamiento por defecto de
    Pydantic para campos de más), no se rechaza -- para no romper a un
    cliente viejo durante la cadena. El candado de
    `tests/test_beneficio_en_pago.py` demuestra que ignorar significa
    ignorar: enviarlo (con un id válido, inválido, repetido o de otra
    persona) nunca cambia el descuento que termina aplicado.

    El `monto` de arriba sigue siendo el monto BASE (sin descontar): el
    servicio congela el valor del beneficio y calcula el monto final.

    `monto` se quitó a propósito (issue #400): el usuario elige una cantidad
    ENTERA de meses, nunca un monto libre. `PagoServicio.registrar_pago`
    calcula `monto_base = tarifa_vigente * meses` -- el número con el que el
    club cobra deja de viajar por la red editable, igual que
    `monto_aplicado` en `MembresiaCreateDTO`: el cliente dice QUÉ quiere
    (cuántos meses), nunca CUÁNTO cuesta eso. `gt=0` descarta 0 y negativos;
    `le=12` es un techo defensivo, no una regla de producto -- doce es la
    cobertura más larga que el club vende hoy (la membresía anual con
    descuento del catálogo, ver `test_cobertura_se_calcula_sobre_el_
    monto_base_no_el_descontado`). Subir el techo es un cambio de una línea
    el día que el club venda algo más largo; no ponerlo dejaba que un valor
    de miles de meses pasara la validación y solo reventara mucho más abajo,
    en `_sumar_meses` (year/month overflow) o en el precio total."""
    meses: int = Field(..., gt=0, le=12)
    tipo_pago: TipoPago
    persona_id: int
    membresia_id: int

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
    # Issue #459: motivo de la excepción auditada para aprobar una
    # TRANSFERENCIA sin comprobante adjunto. Opcional a nivel de este DTO
    # -- el propio payload no sabe si el pago es una TRANSFERENCIA ni si
    # trae voucher, así que NO puede decidir acá si es obligatorio; esa
    # decisión (que sí necesita leer el `Pago` real) la hace `PagoServicio.
    # validar_pago`. Este validador solo cubre lo que el payload puede ver
    # por sí solo: si el campo viaja, no puede ser un string vacío o solo
    # espacios (mismo criterio que `motivo_rechazo` arriba).
    motivo_excepcion_sin_comprobante: Optional[str] = Field(None, max_length=255)

    # `fecha_inicio`/`fecha_fin` NO se aceptan al validar (issue #400):
    # Administración no puede editar la cobertura durante la aprobación, ni
    # siquiera para "corregirla". El período ya lo derivó
    # `PagoServicio.registrar_pago` a partir del monto base y la cuota
    # vigente -- dejar que el admin lo pise acá reabría exactamente el bug
    # que el fix de cobertura (PAG-5) cerró del lado de `registrar_pago`,
    # solo que un paso más tarde. Un cliente viejo que todavía mande estos
    # campos los pierde en silencio (Pydantic ignora extras); no es un 400
    # porque el contrato nunca los necesitó.
    @model_validator(mode="after")
    def _validar_campos(self) -> "PagoValidarDTO":
        if self.estado_pago == EstadoPago.RECHAZADO:
            if self.motivo_rechazo is None or not self.motivo_rechazo.strip():
                raise ValueError("Debe indicar el motivo del rechazo.")
        if (
            self.motivo_excepcion_sin_comprobante is not None
            and not self.motivo_excepcion_sin_comprobante.strip()
        ):
            raise ValueError("El motivo de la excepción no puede estar vacío.")
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
    # Issue #400 (criterio 8): el comprobante OFICIAL que el club genera al
    # aprobar (`ComprobantePago`, PDF de Celery -- ver `comprobante_tareas.
    # py`), distinto de `voucher_url` (evidencia que SUBE el alumno). `None`
    # cuando el pago no fue aprobado (`comprobante_tareas.py` aborta si no
    # está `APROBADO`, ver su docstring) o el PDF todavía no terminó de
    # generarse -- no hace falta repetir ese chequeo de estado acá: la fila
    # `ComprobantePago` sencillamente no existe hasta que eso pasó.
    comprobante_oficial_url: Optional[str] = None
    # Issue #11: descuento congelado aplicado a este pago (columnas de Pago,
    # no una tabla aparte -- ver `app.dominio.modelos.Pago`). Los cuatro son
    # `None` cuando el pago no lleva descuento.
    descuento_id: Optional[int] = None
    descuento_valor_aplicado: Optional[Decimal] = None
    descuento_porcentaje_aplicado: Optional[Decimal] = None
    descuento_autorizado_por_persona_id: Optional[int] = None
    # Issue #458: quién aprobó o rechazó ESTE pago. `None` en pagos todavía
    # PENDIENTE_VALIDACION, y en pagos validados antes de este fix (no se
    # reescriben retroactivamente -- ver `app.dominio.modelos.Pago`).
    validado_por_persona_id: Optional[int] = None
    # Issue #459: por qué se aprobó ESTA transferencia sin comprobante
    # adjunto -- `None` salvo en ese caso exacto (ver
    # `app.dominio.modelos.Pago.motivo_excepcion_sin_comprobante`).
    # Expuesto acá (y no solo en la base) para que la excepción quede
    # visible en el historial del pago, no solo auditable por quien mire
    # la tabla directamente.
    motivo_excepcion_sin_comprobante: Optional[str] = None
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
    # Issue #400 (slice 4c-a): mismo motivo que en `MembresiaResponseDTO` --
    # el frontend infiere gratuidad de un precio en cero, y esta vista NO es
    # ORM pass-through (`PagoServicio.obtener_deuda` arma un dict a mano), así
    # que hay que agregar la clave ahí también o el campo llega None/ausente
    # aunque el modelo lo tenga.
    es_gratuidad_familiar: bool = Field(..., examples=[False])


# Issue #326: deuda en bloque para el admin `/members` (mismos meses/monto
# que `DeudaMembresiaResponseDTO`, N membresías por request en vez de una).
# Contrato de 4 campos DECIDIDO por el owner -- `membresia_id` (implícito en
# la ruta individual, acá explícito porque la respuesta es una lista) +
# los mismos 3 campos de siempre. Sin `es_gratuidad_familiar` A PROPÓSITO:
# fuera de alcance de este issue (ver PagoServicio.obtener_deuda_bulk).
class DeudaMembresiaBulkItemDTO(ResponseBase, BaseModel):
    membresia_id: int = Field(..., examples=[42])
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


# --- Suspensión y reactivación (issue #400, slice 5a) ------------------------
# Un único DTO para las dos operaciones: comparten forma exacta (motivo
# obligatorio + fecha_efectiva opcional) y comparten quién puede usarlo
# (solo ADMINISTRADOR, ver `membresias_pagos_router.py`). Partirlo en dos
# clases idénticas solo agregaría dos nombres a importar sin ganar nada --
# la diferencia de negocio (de qué estado a qué estado) la decide el
# endpoint, no el payload.
class SuspensionReactivacionDTO(BaseModel):
    motivo: str = Field(..., min_length=1, max_length=255)
    # `None` significa "ahora": el servicio completa `datetime.now(UTC)` --
    # ver `PagoServicio.suspender_membresia`/`reactivar_membresia`. Se acepta
    # explícito para que administración pueda registrar una suspensión con
    # fecha efectiva pasada (ej. "se ausentó desde el lunes") sin que la
    # auditoría mienta sobre cuándo empezó a regir.
    fecha_efectiva: Optional[datetime] = None

    @field_validator("fecha_efectiva")
    @classmethod
    def _normalizar_timezone(cls, valor: Optional[datetime]) -> Optional[datetime]:
        """Un `fecha_efectiva` naive (sin timezone) se ASUME UTC, nunca la
        hora local del proceso que lo recibió -- mismo criterio que
        `_ensure_utc_aware` (`schemas/base.py`) aplica del lado de SALIDA a
        todo `datetime` que sale de este backend. Sin esto, un valor naive
        interpretado con el tz local del servidor podría desplazar el día
        de calendario cerca de medianoche y correr un día el ancla de deuda
        que `PagoServicio.calcular_meses_adeudados` deriva de esta fecha
        (hallazgo del revisor, issue #400)."""
        if valor is not None and valor.tzinfo is None:
            return valor.replace(tzinfo=timezone.utc)
        return valor

    @model_validator(mode="after")
    def _validar_motivo(self) -> "SuspensionReactivacionDTO":
        if not self.motivo.strip():
            raise ValueError("Debe indicar el motivo.")
        return self


# --- Cambio de plan (issue #400, criterio 1) ---------------------------------
# Prospectivo: la cobertura ya pagada no se toca (ver
# `MembresiaServicio.cambiar_plan`). Sin `motivo`: a diferencia de
# `SuspensionReactivacionDTO`/`RegularizacionDeudaDTO`/`CorreccionPagoDTO`,
# el issue no exige uno para esta operación -- la auditoría
# (`HistorialCambioPlanMembresia`) ya registra quién y cuándo sin necesitar
# texto libre.
class CambioPlanMembresiaDTO(BaseModel):
    nuevo_tipo_membresia_id: int


# --- Corrección financiera (issue #400, slice 5b) ----------------------------
# Los seis campos financieros congelados de `Pago` -- todos OPCIONALES acá:
# solo se envían los que efectivamente cambian. Un campo omitido significa
# "sin cambio para ese campo" (el servicio conserva el valor anterior),
# nunca "poner en null" -- ninguno de los seis admite `null` como corrección
# válida (mismo criterio que `TipoMembresiaUpdateDTO`, que sí distingue
# omitido de `null` explícito, pero acá `null` no tiene ningún significado
# de negocio para estos campos).
class CorreccionPagoDTO(BaseModel):
    tarifa_mensual_aplicada: Optional[Decimal] = Field(None, gt=0)
    meses_comprados: Optional[int] = Field(None, gt=0)
    monto_base: Optional[Decimal] = Field(None, gt=0)
    monto: Optional[Decimal] = Field(None, gt=0)
    fecha_inicio: Optional[date] = None
    fecha_fin: Optional[date] = None
    motivo: str = Field(..., min_length=1, max_length=255)

    @model_validator(mode="after")
    def _validar(self) -> "CorreccionPagoDTO":
        if not self.motivo.strip():
            raise ValueError("Debe indicar el motivo de la corrección.")
        if (
            self.fecha_inicio is not None
            and self.fecha_fin is not None
            and self.fecha_inicio >= self.fecha_fin
        ):
            raise ValueError("La fecha de inicio debe ser anterior a la de fin.")
        return self


class CorreccionPagoResponseDTO(ResponseBase, BaseModel):
    id: int
    pago_id: int
    tarifa_mensual_aplicada_anterior: Optional[Decimal] = None
    tarifa_mensual_aplicada_nuevo: Optional[Decimal] = None
    meses_comprados_anterior: Optional[int] = None
    meses_comprados_nuevo: Optional[int] = None
    monto_base_anterior: Optional[Decimal] = None
    monto_base_nuevo: Optional[Decimal] = None
    monto_anterior: Decimal
    monto_nuevo: Decimal
    fecha_inicio_anterior: date
    fecha_inicio_nuevo: date
    fecha_fin_anterior: date
    fecha_fin_nuevo: date
    efecto_cobertura: EfectoCoberturaCorreccion
    motivo: str
    actor_persona_id: int
    fecha_registro: datetime


class CorreccionPagoResultadoDTO(ResponseBase, BaseModel):
    """Shape de respuesta de `POST /membresias/pagos/{pago_id}/corregir`:
    el pago YA corregido más la fila de auditoría que la corrección creó --
    "efecto explícito y auditado" (issue #400) exige que la respuesta
    muestre las dos caras de la misma operación, no solo el pago final."""
    pago: PagoResponseDTO
    correccion: CorreccionPagoResponseDTO


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
