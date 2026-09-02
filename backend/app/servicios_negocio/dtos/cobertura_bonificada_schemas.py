"""
DTOs de `CoberturaBonificada` (issue #400, slice 4d): la cobertura que un
beneficio 100% personal (`AsignacionDescuento`, issue #398) otorga sin
generar ningún `Pago` -- ver el docstring de `CoberturaBonificada` en
`app/dominio/modelos.py` para el porqué de la tabla dedicada.

`CoberturaBonificadaCreateDTO` lleva ÚNICAMENTE `meses`: igual que
`PagoCreateDTO` (issue #400/4b), el usuario elige una cantidad ENTERA de
meses, nunca un monto ni el descuento a aplicar -- el backend resuelve la
asignación VIGENTE del pagador y calcula el período. `membresia_id` viaja en
la URL (`POST /membresias/{membresia_id}/aplicar-beneficio`), no en el
cuerpo, mismo criterio que `regularizar_deuda_membresia`.
"""
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, Field

from app.servicios_negocio.dtos.base import ResponseBase
from app.servicios_negocio.dtos.beneficio_schemas import AsignacionDescuentoResponseDTO


class CoberturaBonificadaCreateDTO(BaseModel):
    """`le=12` es el mismo techo defensivo que `PagoCreateDTO.meses` (ver su
    docstring): doce es la cobertura más larga que el club vende hoy, no una
    regla de producto."""
    meses: int = Field(..., gt=0, le=12)


class CoberturaBonificadaResponseDTO(ResponseBase, BaseModel):
    """Expone la `AsignacionDescuento` ANIDADA (con su `Descuento` del
    catálogo dentro, ver `AsignacionDescuentoResponseDTO`): la pantalla que
    muestra esta cobertura necesita explicar CON QUÉ beneficio se otorgó sin
    una segunda consulta. `otorgada_por_persona_id` es el actor que ejecutó
    "Aplicar beneficio" -- el titular o su representante (issue #400: nunca
    un administrador actuando "por" ellos), nunca el admin que concedió la
    `AsignacionDescuento` en su momento (ese es
    `asignacion_descuento.asignado_por_persona_id`, un hecho distinto).

    `descuento_valor_aplicado`/`descuento_porcentaje_aplicado` (hallazgo del
    revisor) son el valor CONGELADO al otorgar -- NO se leen del catálogo
    vigente de `asignacion_descuento.descuento` (que sigue siendo el
    catálogo VIVO, editable después). Mismo criterio que `PagoResponseDTO`:
    el catálogo anidado explica CON QUÉ beneficio se otorgó; estos dos
    campos dicen CUÁNTO valió en ese momento, y no cambian aunque el admin
    edite el descuento del catálogo después."""
    id: int
    membresia_id: int
    persona_id: int
    asignacion_descuento: AsignacionDescuentoResponseDTO
    tarifa_mensual_aplicada: Decimal
    meses_comprados: int
    descuento_valor_aplicado: Decimal
    descuento_porcentaje_aplicado: Optional[Decimal] = None
    fecha_inicio: date
    fecha_fin: date
    otorgada_por_persona_id: int
    otorgada_en: datetime
