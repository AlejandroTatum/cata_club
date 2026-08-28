"""
La regla del issue #762: una cuenta tiene EXACTAMENTE un rol activo.

Vive en `dominio` y no en `servicios_negocio` por una razón concreta: la
tienen que aplicar CUATRO servicios distintos (`RolServicio`,
`AdminCuentaServicio`, `EnrollmentServicio`, `PersonaServicio`) y ninguno
depende de los otros. Antes cada uno llevaba su propio `_asignar_rol` con
el mismo `if any(r.tipo_rol == tipo_rol for r in usuario.roles)` copiado:
cuatro copias que solo miraban el duplicado del MISMO rol, así que dos
flujos independientes podían acumular roles distintos sin que ninguno de
los cuatro viera al otro. Esa es, literalmente, la cuenta
ADMINISTRADOR+ALUMNO que el issue reporta.

Es una función pura sobre el agregado `Usuario`: no toca la sesión, no
comitea y no decide cuándo persistir. Cada servicio conserva su propia
política de `commit()`/`flush()`, que no es la misma (la inscripción es una
transacción atómica única, el alta administrativa comitea por paso).

Esta función es el camino PRIMARIO de error, el que produce un mensaje
legible. NO es la garantía: un chequeo en Python pierde contra dos
peticiones simultáneas, porque las dos leen "esta cuenta no tiene otro rol"
antes de que ninguna escriba. La garantía la da Postgres, con el trigger
`trg_usuario_rol_unico_por_usuario` que instala la migración
`e762rolunico`; acá se explica por qué existen los dos y no uno solo.
"""
from app.dominio.enums import TipoRol
from app.dominio.etiquetas import rol_en_castellano
from app.dominio.excepciones import OperacionInvalida


# El nombre del trigger vive acá, junto a la regla que impone, para que un
# `rg` sobre cualquiera de los dos encuentre al otro.
TRIGGER_ROL_UNICO = "trg_usuario_rol_unico_por_usuario"


def rol_actual(usuario) -> TipoRol | None:
    """El único rol activo de la cuenta, o `None` si todavía no tiene.

    Devuelve UNO aunque la colección traiga más: una cuenta legada anterior
    a `e762rolunico` puede tener dos, y esta función no es el lugar donde se
    resuelve esa ambigüedad -- la resuelve el dueño, explícitamente, con
    `scripts/remediar_rol_multiple.py`."""
    return next((rol.tipo_rol for rol in usuario.roles), None)


def exigir_rol_unico(usuario, tipo_rol: TipoRol) -> bool:
    """Decide si corresponde asignar `tipo_rol` a `usuario`.

    Devuelve `True` cuando hay que asignarlo y `False` cuando la cuenta ya
    lo tiene -- el caso idempotente, que no es un error: reinscribir a
    alguien que ya es ALUMNO no debe romper el flujo.

    Lanza `OperacionInvalida` cuando la cuenta ya tiene OTRO rol. Rechazar
    y no reemplazar es el punto entero del issue: un reemplazo implícito
    borraría el rol anterior sin que nadie lo haya decidido y sin dejar
    rastro de quién ni cuándo. El cambio de rol existe, pero como dos
    decisiones explícitas y auditables (quitar, después asignar)."""
    tipos_actuales = [rol.tipo_rol for rol in usuario.roles]
    if tipo_rol in tipos_actuales:
        return False

    otro = next((tipo for tipo in tipos_actuales if tipo != tipo_rol), None)
    if otro is None:
        return True

    raise OperacionInvalida(
        f"Esta persona ya figura como {rol_en_castellano(otro)} y una cuenta "
        f"puede tener un solo rol activo. Quítele ese rol antes de asignarle "
        f"el de {rol_en_castellano(tipo_rol)}.",
        detalle_tecnico=(
            f"usuario_id={getattr(usuario, 'id', None)} tiene "
            f"{sorted(tipo.value for tipo in tipos_actuales)}; "
            f"se pidió agregar {tipo_rol.value}"
        ),
    )
