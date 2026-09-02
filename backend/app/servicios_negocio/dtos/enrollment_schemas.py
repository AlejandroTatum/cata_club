"""
DTOs del endpoint público de autoinscripción (Escenario 2, Opción B).

Permite al representante (o al alumno adulto) inscribirse directamente desde
el wizard del frontend sin intervención del administrador. El endpoint orquesta
la creación de Persona, Usuario, FichaMedica y AntecedentesClub en un solo
request transaccional, y retorna tokens JWT para auto-login inmediato.
"""
from pydantic import BaseModel, Field, EmailStr, model_validator
from datetime import date
from typing import Optional, List

from app.dominio.enums import NivelTecnicoAlumno, TipoManoDominante
from app.servicios_negocio.dtos.validadores import (
    ApellidoValidado,
    CedulaValidada,
    ContactoEmergenciaValidado,
    NombreValidado,
    TelefonoValidado,
    TipoSangreValidado,
    validar_telefono_emergencia_distinto,
)


class EnrollmentRepresentanteDTO(BaseModel):
    """Datos del representante legal (solo para inscripción de hijo/dependiente)."""
    nombres: NombreValidado = Field(..., max_length=100)
    apellidos: ApellidoValidado = Field(..., max_length=100)
    cedula: CedulaValidada = Field(..., max_length=32)
    fecha_nacimiento: date
    telefono: TelefonoValidado = Field(..., max_length=32)
    correo: EmailStr
    contrasenia: str = Field(..., min_length=8)


class EnrollmentAlumnoDTO(BaseModel):
    """Datos del alumno a inscribir.

    Para inscripción "child" (representante inscribe hijo menor):
      Opcionalmente incluir `correo` + `contrasenia` para crear también
      un Usuario con rol ALUMNO (Opción B: menores con cuenta propia).
    Para inscripción "self" (adulto): las credenciales van en
      `credenciales_alumno`."""
    nombres: NombreValidado = Field(..., max_length=100)
    apellidos: ApellidoValidado = Field(..., max_length=100)
    cedula: CedulaValidada = Field(..., max_length=32)
    fecha_nacimiento: date
    telefono: TelefonoValidado = Field(..., max_length=32)
    correo: Optional[EmailStr] = None
    contrasenia: Optional[str] = Field(default=None, min_length=8)
    institucion_id: Optional[int] = None


class EnrollmentCredencialesDTO(BaseModel):
    """Credenciales del alumno para autoinscripción sin representante (adulto)."""
    correo: EmailStr
    contrasenia: str = Field(..., min_length=8)


class EnrollmentFichaMedicaDTO(BaseModel):
    """Ficha médica del alumno.

    Issue #730 cerró la última puerta: el bloque entero era opcional dentro
    del alta, así que un cuerpo que omitía `ficha_medica` creaba un alumno
    plenamente funcional sin tipo de sangre y sin contacto de emergencia.
    Hoy `EnrollmentCreateDTO` lo exige (ver `_ficha_medica_obligatoria` más
    abajo) y `AdminCrearCuentaDTO` lo exige para los tipos de cuenta que son
    alumnos. Este DTO no cambió por eso: sigue describiendo qué es una ficha
    completa; lo que cambió es quién puede venir sin ninguna.

    Issue #643: `tipo_sangre` tenía default `DESCONOCIDO`, así que un alta que
    nunca eligió tipo de sangre quedaba grabada como si hubiera elegido «no lo
    sé». Eso era una suposición del sistema presentada como un dato del
    usuario. Ahora la ausencia se rechaza, y `DESCONOCIDO` también.

    Este DTO lo consumen TRES caminos — `enrollment_servicio` (alta pública),
    `persona_servicio` (representados) y `admin_cuenta_servicio` (alta por
    admin) — así que la regla entra una vez y vale en los tres.

    `contacto_emergencia` era obligatorio ACÁ desde antes de #643 y se
    conserva: es la "necesidad ya establecida por el dominio" que el issue
    manda respetar. En `FichaMedicaCreateDTO` sigue siendo opcional, y esa
    diferencia es deliberada.
    """
    tipo_sangre: TipoSangreValidado
    enfermedades: List[str] = Field(default_factory=list)
    alergias: Optional[str] = Field(default=None, max_length=255)
    contacto_emergencia: ContactoEmergenciaValidado = Field(..., min_length=1, max_length=150)
    telefono_emergencia: TelefonoValidado = Field(..., max_length=32)


# Issue #730. Un solo texto para los dos caminos que crean alumnos
# (`EnrollmentCreateDTO` acá y `AdminCrearCuentaDTO` en
# admin_cuenta_schemas.py, que ya importa de este módulo). Nombra los dos
# datos que el club necesita de verdad -- tipo de sangre y contacto de
# emergencia -- porque "falta la ficha médica" a secas no le dice a nadie qué
# tiene que ir a buscar.
MENSAJE_FICHA_MEDICA_OBLIGATORIA = (
    "Debe completar la ficha médica del alumno: el tipo de sangre y el "
    "contacto de emergencia son obligatorios."
)


class EnrollmentAntecedentesDTO(BaseModel):
    """Antecedentes del club (opcional). Si no se provee nivel_tecnico_alumno,
    no se crean antecedentes (el entrenador los asignará después)."""
    fecha_inicio_club: Optional[date] = None
    nivel_tecnico_alumno: Optional[NivelTecnicoAlumno] = None
    mano_dominante: Optional[TipoManoDominante] = None


class EnrollmentCreateDTO(BaseModel):
    """
    Payload completo de autoinscripción pública (sin auth).

    - Inscripción "self" (jugador adulto): omitir `representante`,
      incluir `credenciales_alumno`.
    - Inscripción "child" (representante inscribe hijo):
      incluir `representante` con credenciales.

    El validador `_representante_o_credenciales` exige exactamente eso:
    este endpoint es la puerta de entrada pública (sin auth) y su única
    salida son tokens JWT de auto-login. Un cuerpo sin ninguno de los dos
    no tiene a quién emitirle tokens, y antes de este validador pasaba
    toda la validación y moría recién al serializar la respuesta, DESPUÉS
    de persistir la Persona (issue #275).

    `ficha_medica` queda tipada `Optional` a propósito, aunque
    `_ficha_medica_obligatoria` la exija (issue #730): tiparla obligatoria
    haría que Pydantic responda `"Field required"`, y
    `main.py::_validation_exception_handler` publica `errores[0]["msg"]` tal
    cual al cliente. Ese texto en inglés lo leería un representante en el
    navegador. El validador de modelo es el mismo recurso que ya usa
    `_representante_o_credenciales` acá al lado, y por el mismo motivo.
    """
    representante: Optional[EnrollmentRepresentanteDTO] = None
    alumno: EnrollmentAlumnoDTO
    credenciales_alumno: Optional[EnrollmentCredencialesDTO] = None
    ficha_medica: Optional[EnrollmentFichaMedicaDTO] = None
    antecedentes: Optional[EnrollmentAntecedentesDTO] = None
    # Solo se acepta una acción afirmativa; el servidor determina documentos,
    # versiones, texto y timestamp, nunca el cliente.
    acepta_consentimientos: bool = False

    @model_validator(mode="after")
    def _representante_o_credenciales(self) -> "EnrollmentCreateDTO":
        if self.representante is None and self.credenciales_alumno is None:
            raise ValueError(
                "Falta indicar las credenciales de acceso del alumno o los "
                "datos del representante legal: debe completarse al menos "
                "uno de los dos."
            )
        return self

    @model_validator(mode="after")
    def _ficha_medica_obligatoria(self) -> "EnrollmentCreateDTO":
        """Issue #730. Este endpoint sólo tiene una salida: un alumno. No
        acuña representantes ni entrenadores, así que acá la exigencia no
        tiene excepciones (a diferencia de `AdminCrearCuentaDTO`, que sí
        acuña los tres y por eso mira el `tipo_cuenta`)."""
        if self.ficha_medica is None:
            raise ValueError(MENSAJE_FICHA_MEDICA_OBLIGATORIA)
        return self

    @model_validator(mode="after")
    def _telefono_emergencia_distinto_del_alumno(self) -> "EnrollmentCreateDTO":
        """Issue #860. `Optional` en el tipo por el mismo motivo que
        `_ficha_medica_obligatoria` de arriba -- ese validador ya la exige
        en los hechos, esto solo evita un `AttributeError` sobre `None`."""
        if self.ficha_medica is not None:
            validar_telefono_emergencia_distinto(self.alumno.telefono, self.ficha_medica.telefono_emergencia)
        return self


class EnrollmentResponseDTO(BaseModel):
    """Respuesta exitosa de autoinscripción: tokens JWT + persona_id."""
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    persona_id: int
