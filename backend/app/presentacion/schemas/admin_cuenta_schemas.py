"""
DTOs para el endpoint admin de creación de cuentas.

Permite al Administrador crear cuentas completas (Persona + Usuario + Rol)
en un solo request, para adultos (Jugador/Representante/Entrenador) y
menores (Dependiente con representante asignado).
"""
from pydantic import BaseModel, EmailStr, Field
from datetime import date
from typing import Optional, Literal

from app.presentacion.schemas.enrollment_schemas import EnrollmentFichaMedicaDTO


class AdminCrearCuentaDTO(BaseModel):
    """Payload del endpoint POST /admin/cuentas.

    Creación unificada de Persona + Usuario + Rol desde el panel admin.
    """
    tipo_cuenta: Literal["JUGADOR", "REPRESENTANTE", "MENOR", "ENTRENADOR"]

    # --- Datos de la Persona (comunes a todos los tipos) ---
    nombres: str = Field(..., min_length=1, max_length=100)
    apellidos: str = Field(..., min_length=1, max_length=100)
    cedula: str = Field(..., min_length=10, max_length=10, pattern=r"^\d{10}$")
    fecha_nacimiento: date
    telefono: str = Field(..., max_length=15, pattern=r"^\d{7,10}$")
    telefono_contacto: Optional[str] = Field(default=None, max_length=15)
    direccion_id: Optional[int] = None
    institucion_id: Optional[int] = None

    # --- Credenciales de la cuenta ---
    correo: EmailStr
    contrasenia: str = Field(..., min_length=8)

    # --- Solo para MENOR: representante responsable ---
    representante_id: Optional[int] = None

    # --- Ficha médica opcional (para menores) ---
    ficha_medica: Optional[EnrollmentFichaMedicaDTO] = None
