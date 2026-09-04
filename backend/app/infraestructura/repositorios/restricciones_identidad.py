"""
Qué restricción de IDENTIDAD violó un `IntegrityError` de la base.

Vive acá, junto a `eliminacion_segura`, y no en `dominio` ni dentro de un
servicio, por dos razones. La primera: los nombres que traduce
(`persona_cedula_key`, `ix_usuario_correo_lower`) son objetos FÍSICOS de
Postgres, no reglas de negocio -- `Base` no declara `naming_convention`
(`app/dominio/modelos.py`), así que son los nombres literales que la base
pone. La segunda: los tienen que consultar TRES servicios que no dependen
entre sí (`AdminCuentaServicio`, `AuthServicio`, `PersonaServicio`), mismo
motivo por el que `dominio/rol_unico.py` no vive dentro de ninguno de sus
cuatro llamadores.

El nombre se lee de `error.orig.diag.constraint_name`, NUNCA de
`str(error.orig)`. Ese texto no es solo el nombre de la restricción: psycopg
le concatena la línea `DETAIL:`, que ECHOA el valor en conflicto. Con un
`in str(...)` bastaba con registrarse con el correo
`persona_cedula_key@example.com` -- el guion bajo es legal en un `EmailStr`
y `admin_cuenta_schemas.py` no normaliza -- para que un choque de CORREO
se despachara por la rama de CÉDULA y respondiera con el campo equivocado.
Mismo criterio que `EnrollmentServicio._es_conflicto_de_clave_idempotencia`,
que ya leía `diag`.
"""
import enum

from sqlalchemy.exc import IntegrityError


class IdentidadEnConflicto(str, enum.Enum):
    """Cuál de los identificadores de una cuenta chocó."""

    CEDULA = "CEDULA"
    CORREO = "CORREO"
    # `usuario.persona_id` es único: la Persona ya tiene credenciales. Es el
    # `persona.usuario is not None` de `AuthServicio.registrar_usuario`
    # perdiendo la carrera contra otra alta para la misma Persona.
    CUENTA_DE_LA_PERSONA = "CUENTA_DE_LA_PERSONA"
    # El driver no expuso el nombre de la restricción (`error.orig` ausente,
    # o sin `diag`). No se cae en un `in str(error.orig)` de respaldo: ese
    # respaldo es exactamente el defecto que este módulo cierra. Quien llama
    # decide su comportamiento conservador, que NO puede ser adivinar un
    # campo concreto.
    INDETERMINADA = "INDETERMINADA"


# Nombres literales del catálogo de Postgres. `usuario_correo_key` es el
# `unique=True` case-SENSIBLE de la columna (una carrera con el MISMO texto
# exacto); `ix_usuario_correo_lower` es el índice funcional único de la
# migración `d1016emailunico` (issue #1016), el que ataja la carrera
# case-VARIANTE.
_RESTRICCIONES_DE_IDENTIDAD = {
    "persona_cedula_key": IdentidadEnConflicto.CEDULA,
    "usuario_correo_key": IdentidadEnConflicto.CORREO,
    "ix_usuario_correo_lower": IdentidadEnConflicto.CORREO,
    "usuario_persona_id_key": IdentidadEnConflicto.CUENTA_DE_LA_PERSONA,
}


def identidad_en_conflicto(error: IntegrityError) -> IdentidadEnConflicto | None:
    """Qué identificador chocó, o `None` si el `IntegrityError` NO viene de
    una restricción de identidad.

    `None` significa "esto es otra cosa": quien llama debe re-lanzar el error
    original para que lo trate el handler de `main.py`, en vez de responder
    "esta identidad ya existe" por una restricción que no tiene nada que ver.
    `INDETERMINADA` es distinto -- significa "no se pudo leer el nombre" -- y
    conserva el comportamiento conservador que cada llamador ya tenía.
    """
    origen = getattr(error, "orig", None)
    diagnostico = getattr(origen, "diag", None)
    nombre = getattr(diagnostico, "constraint_name", None)
    if not nombre:
        return IdentidadEnConflicto.INDETERMINADA
    return _RESTRICCIONES_DE_IDENTIDAD.get(nombre)
