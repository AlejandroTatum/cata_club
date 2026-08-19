"""
DTOs de `AsignacionDescuento` (issue #398): el beneficio personal que un
administrador asigna o retira a una persona. Archivo separado de
`descuento_schemas.py` a propósito -- ese archivo es el catálogo (qué
descuentos existen), este es la asignación (quién tiene uno vigente), y son
decisiones distintas con ciclos de vida distintos (mismo criterio de
separación que ya usa el proyecto entre `persona_schemas.py` y
`admin_cuenta_schemas.py`, DTOs de recursos vecinos pero no idénticos).

`AsignacionDescuentoCreateDTO` lleva ÚNICAMENTE `descuento_id`: quién asigna
(`asignado_por_persona_id`) sale del token en el router, nunca del cuerpo --
un usuario nunca puede concederse un beneficio a sí mismo escribiendo ese
campo en el JSON (invariante de seguridad del issue #398).
"""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from app.presentacion.schemas.base import ResponseBase
from app.presentacion.schemas.descuento_schemas import DescuentoResponseDTO


class AsignacionDescuentoCreateDTO(BaseModel):
    descuento_id: int = Field(..., gt=0)


class AsignacionDescuentoResponseDTO(ResponseBase, BaseModel):
    """Expone el descuento del catálogo ANIDADO (no solo su id): la pantalla
    de admin que muestra "beneficio vigente" necesita su nombre y valor sin
    una segunda consulta. `AsignacionDescuento` no declara una relación ORM
    hacia `Descuento` (el modelo, deliberadamente, no se toca en esta
    rebanada -- ver issue #398), así que `BeneficioServicio.a_response_dto`
    arma este anidado a mano con una lectura separada del catálogo."""
    id: int
    persona_id: int
    descuento: DescuentoResponseDTO
    asignado_por_persona_id: int
    asignado_en: datetime
    retirado_por_persona_id: Optional[int] = None
    retirado_en: Optional[datetime] = None
