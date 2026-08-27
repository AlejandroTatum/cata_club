"""
DTOs para el endpoint admin de creación de cuentas.

Permite al Administrador crear cuentas completas (Persona + Usuario + Rol)
en un solo request, para adultos (Jugador/Representante/Entrenador) y
menores (Dependiente con representante asignado).
"""
from pydantic import BaseModel, EmailStr, Field, model_validator
from datetime import date
from typing import Optional, Literal

from app.presentacion.schemas.enrollment_schemas import (
    MENSAJE_FICHA_MEDICA_OBLIGATORIA,
    EnrollmentFichaMedicaDTO,
)
from app.presentacion.schemas.validadores import CedulaValidada, TelefonoValidado

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
    nombres: str = Field(..., min_length=1, max_length=100)
    apellidos: str = Field(..., min_length=1, max_length=100)
    cedula: CedulaValidada = Field(..., max_length=32)
    fecha_nacimiento: date
    telefono: TelefonoValidado = Field(..., max_length=32)
    telefono_contacto: Optional[TelefonoValidado] = Field(default=None, max_length=32)
    direccion_id: Optional[int] = None
    institucion_id: Optional[int] = None

    # --- Credenciales de la cuenta ---
    correo: EmailStr
    contrasenia: str = Field(..., min_length=8)

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
