"""
Configuración compartida para todos los DTOs de respuesta (ResponseDTO).
El alias_generator convierte snake_case → camelCase en la serialización JSON.
populate_by_name=True permite seguir usando los nombres Python snake_case
internamente (servicios, tests, etc.) sin romper nada.

Todos los campos datetime se serializan como ISO 8601 UTC con sufijo Z,
garantizando que el frontend siempre reciba fechas timezone-aware.
"""
from datetime import datetime, timezone
from typing import Any, Generic, List, TypeVar

from pydantic import BaseModel, ConfigDict, Field, model_serializer


T = TypeVar("T")


def _to_camel(name: str) -> str:
    """Convierte snake_case a camelCase (ej: fecha_nacimiento → fechaNacimiento)."""
    parts = name.split("_")
    return parts[0] + "".join(word.capitalize() for word in parts[1:])


def _ensure_utc_aware(dt: Any) -> str:
    """Si un datetime es naive (sin timezone), lo asume UTC y lo serializa
    con sufijo 'Z'. Si ya tiene timezone, lo convierte a UTC."""
    if isinstance(dt, datetime):
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        else:
            dt = dt.astimezone(timezone.utc)
        return dt.isoformat().replace("+00:00", "Z")
    return dt


class ResponseBase:
    """Mixin de configuración para todos los DTOs de respuesta ORM-mapped.
    Los ResponseDTOs deben heredar de BaseModel Y de esta clase:
        class FooResponseDTO(ResponseBase, BaseModel):
            ...
    """
    model_config = ConfigDict(
        from_attributes=True,
        alias_generator=_to_camel,
        populate_by_name=True,
    )

    @model_serializer(mode="wrap")
    def _serialize_datetime_utc(self, handler: Any) -> dict:
        """Serializa todos los campos datetime como ISO 8601 UTC con Z."""
        data = handler(self)
        for key, value in data.items():
            if isinstance(value, datetime):
                data[key] = _ensure_utc_aware(value)
            elif isinstance(value, list):
                data[key] = [
                    _ensure_utc_aware(item) if isinstance(item, datetime) else item
                    for item in value
                ]
        return data


class PaginatedResponse(ResponseBase, BaseModel, Generic[T]):
    """Shape estándar para respuestas paginadas: {items, total, skip, limit}."""
    items: List[T]
    total: int = Field(..., examples=[42])
    skip: int = Field(default=0, examples=[0])
    limit: int = Field(default=20, examples=[20])


class ErrorResponse(BaseModel):
    """Shape estándar para errores de la API (usado en main.py)."""
    detail: str = Field(..., examples=["Persona no encontrada"])
    message: str = Field(..., examples=["Persona no encontrada"])
