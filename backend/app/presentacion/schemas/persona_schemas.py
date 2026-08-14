from pydantic import BaseModel, Field
from datetime import date, datetime
from typing import Optional, List

from app.dominio.enums import TipoEscuela, NivelTecnicoAlumno, TipoSangre, TipoManoDominante
from pydantic import EmailStr
from app.presentacion.schemas.base import ResponseBase
from app.presentacion.schemas.enrollment_schemas import EnrollmentFichaMedicaDTO
from app.presentacion.schemas.validadores import CedulaValidada, TelefonoValidado


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
    nombres: Optional[str] = Field(default=None, min_length=1, max_length=100)
    apellidos: Optional[str] = Field(default=None, min_length=1, max_length=100)
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


class PersonaBusquedaDTO(ResponseBase, BaseModel):
    """Resultado ligero para el autocomplete de búsqueda de personas."""
    id: int
    nombres: str
    apellidos: str
    foto_url: Optional[str] = None


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
    tipo_sangre: TipoSangre
    persona_id: int
    enfermedades: List[str] = Field(default_factory=list)  # nombres de enfermedades, opcional
    alergias: Optional[str] = Field(default=None, max_length=255)
    contacto_emergencia: Optional[str] = Field(default=None, max_length=150)
    telefono_emergencia: Optional[TelefonoValidado] = Field(default=None, max_length=32)


class FichaMedicaUpdateDTO(BaseModel):
    """Todos los campos opcionales: PATCH parcial. Si `enfermedades` viene
    presente, REEMPLAZA la lista completa (no hace merge/append) — es más
    predecible para el frontend que un merge implícito."""
    tipo_sangre: Optional[TipoSangre] = None
    enfermedades: Optional[List[str]] = None
    alergias: Optional[str] = Field(default=None, max_length=255)
    contacto_emergencia: Optional[str] = Field(default=None, max_length=150)
    telefono_emergencia: Optional[TelefonoValidado] = Field(default=None, max_length=32)


class FichaMedicaResponseDTO(ResponseBase, BaseModel):
    id: int
    tipo_sangre: TipoSangre
    persona_id: int
    enfermedades: List[EnfermedadResponseDTO] = []
    alergias: Optional[str] = None
    contacto_emergencia: Optional[str] = None
    telefono_emergencia: Optional[str] = None
