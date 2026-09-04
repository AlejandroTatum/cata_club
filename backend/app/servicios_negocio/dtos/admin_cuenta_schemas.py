"""
DTOs para el endpoint admin de creación de cuentas.

Permite al Administrador crear cuentas completas (Persona + Usuario + Rol)
en un solo request, para adultos (Jugador/Representante/Entrenador) y
menores (Dependiente con representante asignado).
"""
from pydantic import BaseModel, Field, model_validator
from datetime import date
from typing import Optional, Literal

from app.servicios_negocio.dtos.enrollment_schemas import (
    MENSAJE_FICHA_MEDICA_OBLIGATORIA,
    EnrollmentFichaMedicaDTO,
)
from app.servicios_negocio.dtos.validadores import (
    ApellidoValidado,
    CedulaValidada,
    ContraseniaValidada,
    CorreoValidado,
    NombreValidado,
    TelefonoValidado,
    validar_telefono_emergencia_distinto,
)

# Issue #730. De los cuatro `tipo_cuenta` que este endpoint acuña, sólo estos
# dos entrenan. Un ENTRENADOR o un REPRESENTANTE no pisa la cancha como
# alumno: exigirle una ficha médica sería aplicar la regla donde no
# corresponde, que es su propio defecto. La lista vive acá, nombrada, en vez
# de como un `in ("JUGADOR", "MENOR")` suelto adentro del validador, para que
# el día que aparezca un quinto tipo de cuenta la decisión esté a la vista.
TIPOS_CUENTA_ALUMNO = ("JUGADOR", "MENOR")


class AdminCrearCuentaDTO(BaseModel):
    """Payload del endpoint POST /admin/cuentas.

    Creación unificada de Persona + Usuario + Rol desde el panel admin.
    """
    tipo_cuenta: Literal["JUGADOR", "REPRESENTANTE", "MENOR", "ENTRENADOR"]

    # --- Datos de la Persona (comunes a todos los tipos) ---
    nombres: NombreValidado = Field(..., max_length=100)
    apellidos: ApellidoValidado = Field(..., max_length=100)
    cedula: CedulaValidada = Field(..., max_length=32)
    fecha_nacimiento: date
    telefono: TelefonoValidado = Field(..., max_length=32)
    telefono_contacto: Optional[TelefonoValidado] = Field(default=None, max_length=32)
    direccion_id: Optional[int] = None
    institucion_id: Optional[int] = None

    # --- Credenciales de la cuenta ---
    correo: CorreoValidado
    contrasenia: ContraseniaValidada

    # --- Solo para MENOR: representante responsable ---
    representante_id: Optional[int] = None

    # --- Ficha médica: obligatoria para los tipos de cuenta que son alumnos
    # (issue #730), opcional para ENTRENADOR y REPRESENTANTE. Sigue tipada
    # `Optional` por el motivo documentado en `EnrollmentCreateDTO`: un campo
    # requerido de Pydantic contesta `"Field required"`, y ese texto llega
    # crudo al navegador vía `main.py::_validation_exception_handler`.
    ficha_medica: Optional[EnrollmentFichaMedicaDTO] = None

    @model_validator(mode="after")
    def _ficha_medica_obligatoria_para_alumnos(self) -> "AdminCrearCuentaDTO":
        if self.tipo_cuenta in TIPOS_CUENTA_ALUMNO and self.ficha_medica is None:
            raise ValueError(MENSAJE_FICHA_MEDICA_OBLIGATORIA)
        return self

    @model_validator(mode="after")
    def _telefono_emergencia_distinto_del_personal(self) -> "AdminCrearCuentaDTO":
        """Issue #860. La persona acuñada puede no ser un alumno (ver la
        lista `TIPOS_CUENTA_ALUMNO` de arriba) y aun así traer una ficha
        médica opcional -- la comparación corre igual cuando la ficha vino,
        sin condicionarla al `tipo_cuenta`."""
        if self.ficha_medica is not None:
            validar_telefono_emergencia_distinto(self.telefono, self.ficha_medica.telefono_emergencia)
        return self
