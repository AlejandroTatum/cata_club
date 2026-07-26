"""
DTOs de autenticación.

Patrón de nomenclatura consistente con el resto de schemas del proyecto:
  - Sufijo `CreateDTO` para payloads de entrada,
  - Sufijo `ResponseDTO` para respuestas, con `model_config = ConfigDict(from_attributes=True)`
    cuando la respuesta se mapea directamente desde un modelo ORM.
"""
from datetime import datetime
from pydantic import BaseModel, EmailStr, Field
from typing import List, Optional

from app.presentacion.schemas.base import ResponseBase


class RegistroUsuarioDTO(BaseModel):
    """Payload del endpoint público POST /auth/registro.

    Regla de diseño confirmada: solo se crea el `Usuario` (credenciales) para
    una `Persona` que YA existe (dada de alta antes por un ADMINISTRADOR vía
    POST /personas). No se crea Persona aquí.
    """
    cedula: str = Field(..., min_length=10, max_length=10)
    correo: EmailStr
    contrasenia: str = Field(..., min_length=8)


class LoginResponseDTO(ResponseBase, BaseModel):
    access_token: str = Field(..., examples=["eyJhbGciOiJIUzI1NiIs..."])
    refresh_token: str = Field(..., examples=["dGhpcyBpcyBhIHJlZnJlc2g..."])
    token_type: str = "bearer"


class RefreshTokenDTO(BaseModel):
    refresh_token: str


class UsuarioMeResponseDTO(ResponseBase, BaseModel):
    correo: str
    persona_id: int
    nombres: str
    apellidos: str
    roles: List[str]
    telefono: str
    fecha_creacion: datetime
    foto_url: Optional[str] = None


class LogoutResponseDTO(ResponseBase, BaseModel):
    mensaje: str


# --- Issue #36: perfil propio (self-service) --------------------------------
class ActualizarPerfilPropioDTO(BaseModel):
    """Payload de PATCH /auth/me. `correo` deliberadamente NO es editable
    aquí -- es el `sub` del JWT, y la edición propia de correo fue removida
    por diseño (ver auth_servicio.py). `telefono` es opcional (edición
    parcial); solo se actualiza si viene presente en el request
    (`exclude_unset=True` en el servicio)."""
    telefono: Optional[str] = Field(default=None, max_length=15)


class ActualizarPerfilPropioResponseDTO(ResponseBase, BaseModel):
    correo: str
    persona_id: int
    nombres: str
    apellidos: str
    roles: List[str]
    telefono: str
    fecha_creacion: datetime
    foto_url: Optional[str] = None


# --- Foto de perfil (self-service, POST /auth/me/foto) -----------------------
# Reutiliza el mismo shape que ActualizarPerfilPropioResponseDTO (correo,
# persona_id, nombres, apellidos, roles, telefono, fecha_creacion, foto_url):
# la subida de foto nunca cambia el correo, así que access_token/refresh_token
# quedan siempre en None aquí, pero se mantienen para uniformidad de
# respuesta con el resto del perfil propio.
ActualizarFotoPerfilResponseDTO = ActualizarPerfilPropioResponseDTO


# --- E01-RF003: recuperación de contraseña ----------------------------------
class SolicitarRecuperacionDTO(BaseModel):
    correo: EmailStr


class SolicitarRecuperacionResponseDTO(ResponseBase, BaseModel):
    mensaje: str


class RestablecerContraseniaDTO(BaseModel):
    token: str
    nueva_contrasenia: str = Field(..., min_length=8)


# --- E01: invalidación de sesión (epoch compartido, ver gestor_auth.py) -----
class InvalidarSesionesResponseDTO(ResponseBase, BaseModel):
    """Mismo shape que `LoginResponseDTO` (no se reutiliza directamente por
    el mismo criterio de nomenclatura por endpoint que separa
    `ActualizarPerfilPropioResponseDTO` de `UsuarioMeResponseDTO`): el caller
    recibe un par de tokens reemitido con el epoch de sesión YA incrementado,
    de modo que permanece autenticado mientras cualquier token previo
    (incluido el que usó para llamar a este mismo endpoint) queda invalidado.
    No se declara como `response_model` en el router, igual que `/login` y
    `/refresh` -- ambos devuelven el dict OAuth2 crudo sin pasar por un
    `response_model` explícito."""
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
