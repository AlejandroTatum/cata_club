"""
DTOs del endpoint público de autoinscripción (Escenario 2, Opción B).

Permite al representante (o al alumno adulto) inscribirse directamente desde
el wizard del frontend sin intervención del administrador. El endpoint orquesta
la creación de Persona, Usuario, FichaMedica y AntecedentesClub en un solo
request transaccional, y retorna tokens JWT para auto-login inmediato.
"""
from pydantic import BaseModel, ConfigDict, Field, model_validator
from datetime import date
from typing import Any, Optional, List, Union

from app.dominio.enums import NivelTecnicoAlumno, TipoManoDominante
from app.servicios_negocio.dtos.validadores import (
    ApellidoValidado,
    CedulaValidada,
    ContactoEmergenciaValidado,
    ContraseniaValidada,
    CorreoValidado,
    NombreValidado,
    TelefonoValidado,
    TipoSangreValidado,
    validar_representante_solo_para_menor,
    validar_telefono_emergencia_distinto,
)


class EnrollmentRepresentanteDTO(BaseModel):
    """Datos del representante legal (solo para inscripción de hijo/dependiente)."""
    nombres: NombreValidado = Field(..., max_length=100)
    apellidos: ApellidoValidado = Field(..., max_length=100)
    cedula: CedulaValidada = Field(..., max_length=32)
    fecha_nacimiento: date
    telefono: TelefonoValidado = Field(..., max_length=32)
    correo: CorreoValidado
    contrasenia: ContraseniaValidada


class EnrollmentAlumnoDTO(BaseModel):
    """Datos del alumno a inscribir.

    Para inscripción "child" (representante inscribe hijo menor): el menor
    nunca tiene credenciales propias (issue #1137, invariante B: una persona
    con `representante_id` nunca tiene `Usuario`).
    Para inscripción "self" (adulto): las credenciales van en
      `credenciales_alumno`."""
    nombres: NombreValidado = Field(..., max_length=100)
    apellidos: ApellidoValidado = Field(..., max_length=100)
    cedula: CedulaValidada = Field(..., max_length=32)
    fecha_nacimiento: date
    telefono: TelefonoValidado = Field(..., max_length=32)
    institucion_id: Optional[int] = None


class EnrollmentCredencialesDTO(BaseModel):
    """Credenciales del alumno para autoinscripción sin representante (adulto)."""
    correo: CorreoValidado
    contrasenia: ContraseniaValidada


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


class EnrollmentFichaMedicaMenorDTO(BaseModel):
    """Ficha médica de un menor representado (issue #1138).

    Mismos campos "médicos" que `EnrollmentFichaMedicaDTO` -- tipo de sangre,
    enfermedades, alergias -- pero SIN `contacto_emergencia` ni
    `telefono_emergencia`: el contacto operativo de un representado es
    SIEMPRE su representante, derivado al leer (ver
    `FichaMedicaServicio.obtener_ficha_emergencia`), nunca un texto libre
    independiente que alguien tenga que mantener sincronizado a mano.

    `extra="forbid"` es la decisión de producto hecha cumplir: si un cliente
    manda igual `contacto_emergencia`/`telefono_emergencia` en el camino
    representado, Pydantic los rechaza como campos desconocidos en vez de
    tragárselos en silencio."""
    model_config = ConfigDict(extra="forbid")

    tipo_sangre: TipoSangreValidado
    enfermedades: List[str] = Field(default_factory=list)
    alergias: Optional[str] = Field(default=None, max_length=255)


# Issue #1138: mensaje único para el rechazo explícito de los dos campos
# retirados del camino representado, reusado por `EnrollmentCreateDTO`
# (alta pública con `representante`) y `RepresentadoCreateDTO` (alta de
# dependiente vía `POST /personas/{id}/representados`).
MENSAJE_CONTACTO_EMERGENCIA_NO_ADMITIDO_PARA_REPRESENTADO = (
    "El contacto de emergencia de un menor representado se deriva del "
    "representante: no debe enviarse contacto_emergencia ni "
    "telefono_emergencia."
)


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

    Issue #1138: `ficha_medica` acepta DOS formas -- `EnrollmentFichaMedicaDTO`
    (con contacto de emergencia propio, camino adulto) o
    `EnrollmentFichaMedicaMenorDTO` (sin esos dos campos, camino
    representado). Pydantic (unión "smart") elige la que valide: un cuerpo
    representado que igual manda los campos retirados resuelve como la forma
    de adulto, y por eso `_ficha_medica_no_admite_contacto_para_representado`
    lo rechaza explícitamente por tipo resuelto, no por Union solo.
    """
    representante: Optional[EnrollmentRepresentanteDTO] = None
    alumno: EnrollmentAlumnoDTO
    credenciales_alumno: Optional[EnrollmentCredencialesDTO] = None
    ficha_medica: Optional[Union[EnrollmentFichaMedicaDTO, EnrollmentFichaMedicaMenorDTO]] = None
    antecedentes: Optional[EnrollmentAntecedentesDTO] = None
    # Solo se acepta una acción afirmativa; el servidor determina documentos,
    # versiones, texto y timestamp, nunca el cliente.
    acepta_consentimientos: bool = False

    @model_validator(mode="before")
    @classmethod
    def _ficha_medica_no_admite_contacto_para_representado(cls, data: Any) -> Any:
        """Issue #1138: rechazo TEMPRANO y explícito, antes de que
        `EnrollmentFichaMedicaMenorDTO` (`extra="forbid"`) lo intente y
        devuelva el inglés genérico de Pydantic ("Extra inputs are not
        permitted") -- un mensaje que `isUserFacingText` del frontend nunca
        deja pasar."""
        if not isinstance(data, dict):
            return data
        if data.get("representante") is None:
            return data
        ficha = data.get("ficha_medica")
        if not isinstance(ficha, dict):
            return data
        if {"contacto_emergencia", "telefono_emergencia"} & ficha.keys():
            raise ValueError(MENSAJE_CONTACTO_EMERGENCIA_NO_ADMITIDO_PARA_REPRESENTADO)
        return data

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
    def _representante_no_apunta_a_un_mayor(self) -> "EnrollmentCreateDTO":
        """Issue #1137, invariante (A): un representante no puede inscribir a
        un alumno mayor de edad. Antes de este validador, ese cuerpo pasaba
        toda la validación y moría recién contra el trigger de base
        `i1141relinteg` -- un `IntegrityError` genérico en vez de un 422 que
        diga qué está mal."""
        validar_representante_solo_para_menor(
            self.alumno.fecha_nacimiento, self.representante is not None,
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
    def _ficha_medica_completa_para_autoinscripcion_adulta(self) -> "EnrollmentCreateDTO":
        """Issue #1138. Sin `representante` (camino adulto), la ficha sigue
        exigiendo tipo de sangre y contacto de emergencia COMPLETOS -- si
        `ficha_medica` resolvió como `EnrollmentFichaMedicaMenorDTO` es
        porque a un adulto le faltaron esos dos campos (el Union prueba
        primero la forma completa; solo cae acá cuando esa falla), mismo
        mensaje que `_ficha_medica_obligatoria`."""
        if self.representante is None and isinstance(self.ficha_medica, EnrollmentFichaMedicaMenorDTO):
            raise ValueError(MENSAJE_FICHA_MEDICA_OBLIGATORIA)
        return self

    @model_validator(mode="after")
    def _telefono_emergencia_distinto_del_alumno(self) -> "EnrollmentCreateDTO":
        """Issue #860. Solo aplica a la forma con contacto propio
        (`EnrollmentFichaMedicaDTO`, camino adulto): un menor representado ya
        no manda `telefono_emergencia` propio (issue #1138) -- su contacto
        de emergencia ES el representante."""
        if isinstance(self.ficha_medica, EnrollmentFichaMedicaDTO):
            validar_telefono_emergencia_distinto(self.alumno.telefono, self.ficha_medica.telefono_emergencia)
        return self


class EnrollmentResponseDTO(BaseModel):
    """Respuesta exitosa de autoinscripción: tokens JWT + persona_id."""
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    persona_id: int
