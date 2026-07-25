from pydantic import BaseModel, Field
from datetime import date, datetime
from typing import Optional, List

from app.dominio.enums import TipoEscuela, NivelTecnicoAlumno, TipoSangre, TipoManoDominante
from pydantic import EmailStr
from app.presentacion.schemas.base import ResponseBase
from app.presentacion.schemas.enrollment_schemas import EnrollmentFichaMedicaDTO


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
    cedula: str = Field(..., min_length=10, max_length=10, pattern=r"^\d{10}$")
    fecha_nacimiento: date
    foto_url: Optional[str] = None
    telefono: str = Field(..., max_length=15)
    telefono_contacto: Optional[str] = Field(default=None, max_length=20)
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
    cedula: str = Field(..., min_length=10, max_length=10, pattern=r"^\d{10}$")
    fecha_nacimiento: date
    telefono: str = Field(..., max_length=15, pattern=r"^\d{7,10}$")
    ficha_medica: Optional[EnrollmentFichaMedicaDTO] = None
    correo: Optional[EmailStr] = None
    contrasenia: Optional[str] = Field(default=None, min_length=8)
    institucion_id: Optional[int] = None


class PersonaUpdateDTO(BaseModel):
    nombres: Optional[str] = Field(default=None, min_length=1, max_length=100)
    apellidos: Optional[str] = Field(default=None, min_length=1, max_length=100)
    telefono: Optional[str] = Field(default=None, max_length=20, pattern=r"^\d{7,10}$")
    telefono_contacto: Optional[str] = Field(default=None, max_length=20)
    foto_url: Optional[str] = None
    direccion_id: Optional[int] = None
    institucion_id: Optional[int] = None


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


class EntrenadorResponseDTO(ResponseBase, BaseModel):
    """Shape mínima para el selector de entrenador (dropdown) al crear/editar
    un `HorarioEntrenamiento` — GET /personas/entrenadores. No expone datos
    sensibles (cédula, teléfono, fecha de nacimiento) como `PersonaResponseDTO`,
    solo lo necesario para elegir un entrenador por nombre."""
    id: int = Field(..., examples=[1])
    nombre_completo: str = Field(..., examples=["Carlos Ruiz"])


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
    telefono_emergencia: Optional[str] = Field(default=None, max_length=15, pattern=r"^\d{7,10}$")


class FichaMedicaUpdateDTO(BaseModel):
    """Todos los campos opcionales: PATCH parcial. Si `enfermedades` viene
    presente, REEMPLAZA la lista completa (no hace merge/append) — es más
    predecible para el frontend que un merge implícito."""
    tipo_sangre: Optional[TipoSangre] = None
    enfermedades: Optional[List[str]] = None
    alergias: Optional[str] = Field(default=None, max_length=255)
    contacto_emergencia: Optional[str] = Field(default=None, max_length=150)
    telefono_emergencia: Optional[str] = Field(default=None, max_length=15, pattern=r"^\d{7,10}$")


class FichaMedicaResponseDTO(ResponseBase, BaseModel):
    id: int
    tipo_sangre: TipoSangre
    persona_id: int
    enfermedades: List[EnfermedadResponseDTO] = []
    alergias: Optional[str] = None
    contacto_emergencia: Optional[str] = None
    telefono_emergencia: Optional[str] = None
