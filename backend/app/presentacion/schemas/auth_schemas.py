"""
DTOs de autenticación.

Patrón de nomenclatura consistente con el resto de schemas del proyecto:
  - Sufijo `CreateDTO` para payloads de entrada,
  - Sufijo `ResponseDTO` para respuestas, con `model_config = ConfigDict(from_attributes=True)`
    cuando la respuesta se mapea directamente desde un modelo ORM.
"""
from datetime import date, datetime
from pydantic import BaseModel, EmailStr, Field, field_serializer
from typing import List, Optional

from app.infraestructura.cloudinary_cliente import resolver_url_foto_perfil
from app.presentacion.schemas.base import ResponseBase
from app.presentacion.schemas.validadores import CedulaValidada, TelefonoValidado


class RegistroUsuarioDTO(BaseModel):
    """Payload del endpoint público POST /auth/registro.

    Regla de diseño confirmada: solo se crea el `Usuario` (credenciales) para
    una `Persona` que YA existe (dada de alta antes por un ADMINISTRADOR vía
    POST /personas). No se crea Persona aquí.
    """
    cedula: CedulaValidada = Field(..., max_length=32)
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
    # El propio cumpleaños, no un dato ajeno: expone la fecha de nacimiento
    # de la persona AUTENTICADA. Se agrega para que el frontend pueda decidir
    # si un "estudiante" es mayor de edad (nav de Ficha médica,
    # getNavLinksForRole) sin una llamada aparte -- ver
    # ficha_medica_router.py::_es_titular_mayor_de_edad para la mitad
    # backend de la misma decisión.
    fecha_nacimiento: date
    # Issue #790: el estado real de la cuenta, para que la interfaz pueda
    # decirlo antes de que el usuario choque contra el rechazo. Un frontend
    # que no puede leer este dato solo tiene dos opciones, y las dos mienten:
    # callarse (y dejar que el representante descubra el requisito recién al
    # intentar agregar a un hijo) o suponer.
    correo_verificado: bool = True
    # Derivado de la primera membresía ACTIVA (o su historial), no del
    # estado operativo actual: una membresía vencida no revoca este hito.
    alta_presencial_completada: bool = False

    @field_serializer("foto_url")
    def _firmar_foto_url(self, valor: Optional[str]) -> Optional[str]:
        # Issue #553 (Problema 2): `Persona.foto_url` persiste el
        # `public_id`; la respuesta HTTP expone SIEMPRE una URL de entrega
        # firmada. Una fila heredada (URL pública completa) se devuelve sin
        # tocar hasta que corra `scripts/migrar_fotos_perfil_autenticadas.py`.
        return resolver_url_foto_perfil(valor)


class LogoutResponseDTO(ResponseBase, BaseModel):
    mensaje: str


class SesionResponseDTO(ResponseBase, BaseModel):
    """Una sesión propia, tal como la ve su dueño.

    Los cinco campos son todo lo que sale. En particular NO sale la IP ni el
    user-agent crudo: `dispositivo` es una etiqueta ya derivada
    (`soporte_transversal/dispositivo.py`), y la IP directamente no se guarda
    -- es dato personal, el club maneja cuentas de menores y de sus
    representantes, y ningún caso de uso la lee.

    `vigente` y `actual` son DERIVADOS, no columnas: el primero compara el
    epoch de la fila contra el del usuario, el segundo contra el claim `sid`
    del token que hizo la llamada. Ver `AuthServicio.SesionVista`.
    """

    id: int
    dispositivo: str
    iniciada_en: datetime
    vigente: bool
    actual: bool


# --- Issue #36: perfil propio (self-service) --------------------------------
class ActualizarPerfilPropioDTO(BaseModel):
    """Payload de PATCH /auth/me. `correo` deliberadamente NO es editable
    aquí -- es el `sub` del JWT, y la edición propia de correo fue removida
    por diseño (ver auth_servicio.py). `telefono` es opcional (edición
    parcial); solo se actualiza si viene presente en el request
    (`exclude_unset=True` en el servicio)."""
    telefono: Optional[TelefonoValidado] = Field(default=None, max_length=32)


class ActualizarPerfilPropioResponseDTO(ResponseBase, BaseModel):
    correo: str
    persona_id: int
    nombres: str
    apellidos: str
    roles: List[str]
    telefono: str
    fecha_creacion: datetime
    foto_url: Optional[str] = None

    @field_serializer("foto_url")
    def _firmar_foto_url(self, valor: Optional[str]) -> Optional[str]:
        # Mismo criterio que `UsuarioMeResponseDTO`: nunca se expone el
        # `public_id` crudo ni una URL pública sin firmar (issue #553).
        return resolver_url_foto_perfil(valor)


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


# --- Issue #790: verificación de la dirección de correo ---------------------
class SolicitarVerificacionCorreoDTO(BaseModel):
    correo: EmailStr


class SolicitarVerificacionCorreoResponseDTO(ResponseBase, BaseModel):
    mensaje: str


class ConfirmarVerificacionCorreoDTO(BaseModel):
    token: str


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
