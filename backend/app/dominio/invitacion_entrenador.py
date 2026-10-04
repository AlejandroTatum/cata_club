"""Invitación de un entrenador creado por el administrador (issue #1575).

La cuenta nace sin contraseña conocida por nadie y con el correo SIN verificar;
el administrador no ve ni define ninguna clave. La invitación es un enlace del
mismo mecanismo que la recuperación de contraseña (`RecuperacionOutbox`, token
`reset_password`) que además lleva el claim `prp`. Ese claim es lo único que
hace que fijar la contraseña pruebe el control del correo: una recuperación
común no lo lleva y no verifica nada.

"Invitación pendiente" no es una columna: se deriva de que la cuenta es de un
entrenador y su correo sigue sin verificar. Fijar la contraseña con el enlace
de la invitación es lo que lo verifica."""
from app.dominio.enums import TipoRol

PROPOSITO_INVITACION_ENTRENADOR = "invitacion_entrenador"


def invitacion_pendiente(usuario) -> bool:
    """¿Esta cuenta es un entrenador que todavía no fijó su contraseña?"""
    return not usuario.correo_verificado and any(
        rol.tipo_rol == TipoRol.ENTRENADOR for rol in usuario.roles
    )
