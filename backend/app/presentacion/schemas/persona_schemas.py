from pydantic import BaseModel, Field, field_serializer, model_validator
from datetime import date, datetime
from typing import Optional, List

from app.dominio.enums import TipoEscuela, NivelTecnicoAlumno, TipoSangre, TipoManoDominante
from app.infraestructura.cloudinary_cliente import resolver_url_foto_perfil
from pydantic import EmailStr
from app.presentacion.schemas.base import ResponseBase
from app.presentacion.schemas.enrollment_schemas import EnrollmentFichaMedicaDTO
from app.presentacion.schemas.validadores import (
    ApellidoValidado,
    CedulaValidada,
    NombreValidado,
    TelefonoValidado,
    TipoSangreValidado,
    validar_telefono_emergencia_distinto,
)


# --- Institucion ---
class InstitucionCreateDTO(BaseModel):
    nombre: str = Field(..., max_length=150)
    tipo_escuela: TipoEscuela


class InstitucionResponseDTO(ResponseBase, InstitucionCreateDTO):
    id: int


# --- Persona ---
class PersonaCreateDTO(BaseModel):
    nombres: str = Field(..., min_length=1, max_length=100)
    apellidos: str = Field(..., min_length=1, max_length=100)
    cedula: CedulaValidada = Field(..., max_length=32)
    fecha_nacimiento: date
    foto_url: Optional[str] = None
    telefono: TelefonoValidado = Field(..., max_length=32)
    telefono_contacto: Optional[TelefonoValidado] = Field(default=None, max_length=32)
    representante_id: Optional[int] = None
    direccion_id: Optional[int] = None
    institucion_id: Optional[int] = None


# --- Representado (portal autoservicio) -------------------------------------
class RepresentadoCreateDTO(BaseModel):
    """Payload para que un representante o administrador agregue un
    dependiente (POST /personas/{persona_id}/representados).

    Si se proporcionan `correo` y `contrasenia`, se crea también un
    Usuario con rol ALUMNO para el menor (Opción B: menores con cuenta).
    Si se omiten, solo se crea la Persona (comportamiento anterior)."""
    nombres: str = Field(..., min_length=1, max_length=100)
    apellidos: str = Field(..., min_length=1, max_length=100)
    cedula: CedulaValidada = Field(..., max_length=32)
    fecha_nacimiento: date
    telefono: TelefonoValidado = Field(..., max_length=32)
    ficha_medica: Optional[EnrollmentFichaMedicaDTO] = None
    correo: Optional[EmailStr] = None
    contrasenia: Optional[str] = Field(default=None, min_length=8)
    institucion_id: Optional[int] = None

    @model_validator(mode="after")
    def _telefono_emergencia_distinto_del_personal(self) -> "RepresentadoCreateDTO":
        """Issue #860: el teléfono personal es el del propio dependiente
        (`telefono` arriba), no el del representante que hace el alta."""
        if self.ficha_medica is not None:
            validar_telefono_emergencia_distinto(self.telefono, self.ficha_medica.telefono_emergencia)
        return self


# --- Vinculación de representado ya existente (INS-2) -----------------------
class VincularRepresentadoDTO(BaseModel):
    """Payload de `POST /personas/{representante_id}/vincular-representado`
    (INS-2, docs/product/decisiones-de-negocio-2026-08-11.md §1): vincula una Persona
    YA EXISTENTE en el club a la cuenta del representante que hace la
    solicitud, identificándola únicamente por cédula. A diferencia de
    `RepresentadoCreateDTO`, no crea nada -- solo reasigna
    `Persona.representante_id` de una fila que ya existe."""
    cedula: CedulaValidada = Field(..., max_length=32)


class PersonaUpdateDTO(BaseModel):
    nombres: Optional[NombreValidado] = Field(default=None, max_length=100)
    apellidos: Optional[ApellidoValidado] = Field(default=None, max_length=100)
    telefono: Optional[TelefonoValidado] = Field(default=None, max_length=32)
    telefono_contacto: Optional[TelefonoValidado] = Field(default=None, max_length=32)
    foto_url: Optional[str] = None
    direccion_id: Optional[int] = None
    institucion_id: Optional[int] = None


class EstadoPersonaDTO(BaseModel):
    """Cuerpo de `PATCH /personas/{persona_id}/estado`: baja lógica o
    reincorporación de una persona al club. Misma forma que el
    `EstadoCuentaDTO` de `PATCH /personas/{persona_id}/cuenta/estado`, que
    gobierna el flag del `Usuario` (acceso al sistema) en vez del de la
    `Persona` (pertenencia al club)."""
    activo: bool


class IndependizarDTO(BaseModel):
    """Payload para que un ex-menor (ya mayor de edad) o un administrador
    independice a una persona de su representante legal."""
    contrasenia: str = Field(..., min_length=8)


class PersonaResponseDTO(ResponseBase, BaseModel):
    id: int = Field(..., examples=[1])
    nombres: str = Field(..., examples=["Juan Carlos"])
    apellidos: str = Field(..., examples=["Pérez López"])
    cedula: str = Field(..., examples=["1710034065"])
    fecha_nacimiento: date = Field(..., examples=["1990-05-14"])
    foto_url: Optional[str] = Field(default=None, examples=["https://res.cloudinary.com/..."])
    telefono: str = Field(..., examples=["0991234567"])
    telefono_contacto: Optional[str] = Field(default=None, examples=["0998765432"])
    representante_id: Optional[int] = Field(default=None, examples=[None])
    fecha_registro: Optional[datetime] = Field(default=None, examples=["2024-01-15T10:30:00Z"])
    # Baja lógica: la UI necesita distinguir a un miembro activo de uno dado
    # de baja para poder marcarlo en el roster admin (que sí los sigue
    # listando) y ofrecer reincorporarlo.
    activo: bool = Field(default=True, examples=[True])

    @field_serializer("foto_url")
    def _firmar_foto_url(self, valor: Optional[str]) -> Optional[str]:
        # Issue #553 (Problema 2): `Persona.foto_url` persiste el `public_id`;
        # la respuesta HTTP expone SIEMPRE una URL de entrega firmada (mismo
        # patrón que el voucher). Una fila heredada (URL pública completa) se
        # devuelve sin tocar hasta que corra la migración.
        return resolver_url_foto_perfil(valor)


class PersonaBusquedaDTO(ResponseBase, BaseModel):
    """Resultado ligero para el autocomplete de búsqueda de personas."""
    id: int
    nombres: str
    apellidos: str
    foto_url: Optional[str] = None

    @field_serializer("foto_url")
    def _firmar_foto_url(self, valor: Optional[str]) -> Optional[str]:
        # Mismo criterio que `PersonaResponseDTO`: nunca se expone el
        # `public_id` crudo ni una URL pública sin firmar.
        return resolver_url_foto_perfil(valor)


# --- AntecedentesClub ---
class AntecedentesClubCreateDTO(BaseModel):
    nivel_tecnico_alumno: NivelTecnicoAlumno
    fecha_inicio_club: date
    persona_id: int
    mano_dominante: Optional[TipoManoDominante] = None


class AntecedentesClubUpdateDTO(BaseModel):
    nivel_tecnico_alumno: Optional[NivelTecnicoAlumno] = None
    mano_dominante: Optional[TipoManoDominante] = None


class AntecedentesClubResponseDTO(ResponseBase, AntecedentesClubCreateDTO):
    id: int


# --- FichaMedica / Enfermedades ---
class EnfermedadCreateDTO(BaseModel):
    nombre_enfermedad: str = Field(..., max_length=150)


class EnfermedadResponseDTO(ResponseBase, EnfermedadCreateDTO):
    id: int


class FichaMedicaCreateDTO(BaseModel):
    """Creación COMPLETA de una ficha médica (issue #643).

    `tipo_sangre` y `telefono_emergencia` son obligatorios y validados: son los
    dos datos que existen para una emergencia, y una ficha sin ellos parece
    cargada sin serlo.

    `contacto_emergencia` (el NOMBRE) sigue siendo opcional acá, a propósito.
    El issue prohíbe volverlo obligatorio salvo que un flujo existente ya lo
    exija; este no lo exigía. `EnrollmentFichaMedicaDTO` sí lo exigía desde
    antes, y allá se conserva — la diferencia entre los dos DTOs es la
    decisión, no un descuido.
    """
    tipo_sangre: TipoSangreValidado
    persona_id: int
    enfermedades: List[str] = Field(default_factory=list)  # nombres de enfermedades, opcional
    alergias: Optional[str] = Field(default=None, max_length=255)
    contacto_emergencia: Optional[str] = Field(default=None, max_length=150)
    telefono_emergencia: TelefonoValidado = Field(..., max_length=32)


class FichaMedicaUpdateDTO(BaseModel):
    """PATCH parcial: todo campo es omitible. Si `enfermedades` viene presente,
    REEMPLAZA la lista completa (no hace merge/append) — es más predecible para
    el frontend que un merge implícito.

    Issue #643 no convierte esto en un PUT. Sigue siendo legítimo mandar un
    solo campo. Lo que se acota es qué VALORES puede tomar un campo cuando sí
    viene:

    - `tipo_sangre` presente no puede ser `DESCONOCIDO`.
    - `telefono_emergencia` presente no puede ser `null`. FIC-5 introdujo el
      `null` explícito como "borrá esto", y para alergias y contacto sigue
      valiendo; para el teléfono no, porque borrarlo deja la ficha en el estado
      exacto que esta regla prohíbe.

    Que el RESULTADO de aplicar el parche sea una ficha válida no se decide
    acá: este DTO solo ve el payload, no la fila. Eso lo hace
    `FichaMedicaServicio.actualizar_por_persona`.
    """
    tipo_sangre: Optional[TipoSangreValidado] = None
    enfermedades: Optional[List[str]] = None
    alergias: Optional[str] = Field(default=None, max_length=255)
    contacto_emergencia: Optional[str] = Field(default=None, max_length=150)
    telefono_emergencia: Optional[TelefonoValidado] = Field(default=None, max_length=32)

    @model_validator(mode="after")
    def _el_telefono_de_emergencia_no_se_borra(self) -> "FichaMedicaUpdateDTO":
        # `model_fields_set` distingue "no vino" de "vino en null" — la misma
        # distinción que `exclude_unset=True` hace en el servicio. Sin ella,
        # omitir el campo (legítimo) y borrarlo (prohibido) se leerían igual.
        if "telefono_emergencia" in self.model_fields_set and self.telefono_emergencia is None:
            raise ValueError(
                "El teléfono de emergencia no puede quedar vacío: es el "
                "número al que el club llamaría en una emergencia."
            )
        return self


class FichaMedicaResponseDTO(ResponseBase, BaseModel):
    id: int
    tipo_sangre: TipoSangre
    persona_id: int
    enfermedades: List[EnfermedadResponseDTO] = []
    alergias: Optional[str] = None
    contacto_emergencia: Optional[str] = None
    telefono_emergencia: Optional[str] = None


class FichaMedicaExistenciaResponseDTO(ResponseBase, BaseModel):
    """Respuesta de `GET /fichas-medicas/existe` (issue #362): de los
    `persona_ids` pedidos, cuáles YA tienen una ficha médica cargada.
    Bulk-existence, no bulk-fetch -- el admin `/members` solo necesita saber
    SI existe, no su contenido, para marcar el hueco "sin datos de
    emergencia" sin traer N fichas completas."""

    persona_ids_con_ficha: List[int] = []


class FichaEmergenciaResponseDTO(ResponseBase, BaseModel):
    """DTO propio del issue #360, deliberadamente chico.

    NO hereda de `FichaMedicaResponseDTO` ni sale de un `model_dump()`
    completo: cada campo está enumerado a mano para que si `FichaMedica` gana
    columnas nuevas mañana, este DTO no las herede solo. Es exactamente lo que
    un entrenador necesita para actuar ante una emergencia y nada del resto de
    la ficha (sin cédula, fecha de nacimiento, dirección, ni enfermedades no
    relacionadas).

    Los cuatro campos médicos son `Optional`: un alumno puede no tener ficha
    médica cargada todavía, y ese caso no es un error -- ver
    `FichaMedicaServicio.obtener_ficha_emergencia`. El respaldo del
    representante siempre debería estar presente para un menor.
    """

    alumno_nombre_completo: str
    tipo_sangre: Optional[TipoSangre] = None
    alergias: Optional[str] = None
    contacto_emergencia: Optional[str] = None
    telefono_emergencia: Optional[str] = None
    representante_nombre_completo: Optional[str] = None
    representante_telefono: Optional[str] = None
