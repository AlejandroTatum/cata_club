"""
Issue #1139: ningún menor puede quedar con `representante_id` apuntando a
una cuenta inactiva, ni con `representante_id` nulo mientras siga siendo
menor.

Issue #1133 (decisión del dueño de 2026-09-11, opción B en #1134) añade
`exigir_representante_con_rol_valido`: solo una cuenta con el rol
REPRESENTANTE puede recibir representados. Vive acá, junto a
`exigir_representante_destino_alcanzable`, porque ambas funciones evalúan la
misma cosa -- la cuenta (`Usuario`) del destino -- y las consumen los mismos
tres caminos de escritura (`PersonaServicio.crear_representado`,
`vincular_representado`, `registrar_persona`, todos vía
`_crear_persona_validada`/`_exigir_representante_destino_alcanzable`). La
garantía de base equivalente es el trigger diferido de la migración
`k1143rolrep`.

Vive en `dominio`, mismo criterio que `rol_unico.py` para #762: la tienen
que aplicar DOS servicios que no dependen entre sí en esta dirección --
`RolServicio.cambiar_estado_cuenta` y `PersonaServicio.cambiar_estado` (la
baja lógica de una Persona, que TAMBIÉN apaga su `Usuario` si tiene uno) --
y de hecho `persona_servicio` SÍ importa `RolServicio` (issue #762), así que
un helper que viviera en cualquiera de los dos serviría al otro para armar
un ciclo.

Un tercer punto, `PersonaServicio.vincular_representado`, usa la mitad
"cuenta destino alcanzable" de este mismo invariante: nada impedía vincular
a un representado a una cuenta YA desactivada, que es el mismo estado
prohibido llegado por la otra puerta (nunca se "corta" nada, se "vincula" a
un destino que ya estaba muerto).

Son funciones puras: no tocan la sesión, no comitean. El chequeo de servicio
es el camino PRIMARIO de error (mensaje legible, accionable); la garantía
real -- inclusive contra una carrera de dos peticiones concurrentes -- vive
en Postgres, en los triggers `TRIGGER_USUARIO_BLOQUEA_BAJA` y
`TRIGGER_PERSONA_REPRESENTANTE_ALCANZABLE` que instala la migración
`g1139repmenor`.
"""
from datetime import date

from app.dominio.enums import TipoRol
from app.dominio.excepciones import OperacionInvalida
from app.dominio.mensajes import MENSAJE_REPRESENTANTE_SIN_ROL
from app.dominio.modelos import Persona
from app.dominio.nombre_propio import nombre_completo
from app.dominio.reglas_negocio import EDAD_MAYORIA_EDAD, calcular_edad

# Los nombres de los triggers viven acá, junto a la regla que imponen, para
# que un `rg` sobre cualquiera de los dos encuentre al otro (mismo criterio
# que `TRIGGER_ROL_UNICO` en `rol_unico.py`).
TRIGGER_USUARIO_BLOQUEA_BAJA = "trg_usuario_bloquea_baja_con_representados_menores"
TRIGGER_PERSONA_REPRESENTANTE_ALCANZABLE = "trg_persona_representante_alcanzable"


def exigir_sin_representados_menores_activos(
    representante_id: int,
    representados_activos: list[Persona],
    hoy: date,
    accion: str,
) -> None:
    """Rechaza `accion` (desactivar la cuenta, dar de baja a la persona) si
    alguno de los `representados_activos` -- ya filtrados por `activo=True`,
    típicamente el resultado de `PersonaRepositorio.listar_representados`--
    es menor de edad.

    El rechazo nombra la salida ejecutable: `vincular_representado` (issue
    INS-2) ya existe y es el camino de reasignación -- no hay que construir
    nada nuevo, solo usarlo antes de continuar."""
    menores = [
        persona for persona in representados_activos
        if calcular_edad(persona.fecha_nacimiento, hoy) < EDAD_MAYORIA_EDAD
    ]
    if not menores:
        return

    nombres = ", ".join(nombre_completo(p.nombres, p.apellidos) for p in menores)
    raise OperacionInvalida(
        f"No se puede {accion}: representa a {len(menores)} representado(s) menor(es) "
        f"de edad ({nombres}) que quedarían sin nadie que pueda acceder a su ficha. "
        f"Vincule a cada uno a otra cuenta de representante "
        f"(POST /personas/{{id}}/vincular-representado) antes de continuar.",
        detalle_tecnico=(
            f"representante_id={representante_id} tiene {len(menores)} representados "
            f"menores activos: {[persona.id for persona in menores]}"
        ),
    )


def exigir_representante_destino_alcanzable(representante_id: int, cuenta_representante) -> None:
    """`cuenta_representante` es lo que ya devuelve
    `UsuarioRepositorio.obtener_por_persona_id(representante_id)`: `None`
    cuando el representante no tiene cuenta propia (un tutor cargado a mano,
    sin login). Ese caso no se rechaza -- no hay ninguna cuenta que pueda
    estar desactivada, mismo criterio que
    `PersonaServicio._exigir_correo_verificado_del_representante`."""
    if cuenta_representante is None or cuenta_representante.activo:
        return
    raise OperacionInvalida(
        "Esta cuenta está desactivada y no puede recibir representados nuevos: "
        "un menor quedaría sin nadie que pueda acceder a su ficha. Reactive la "
        "cuenta (PATCH /personas/{id}/cuenta/estado) antes de vincular a este "
        "representado.",
        detalle_tecnico=f"representante_id={representante_id} tiene usuario.activo=False",
    )


def exigir_representante_con_rol_valido(representante_id: int, cuenta_representante) -> None:
    """Issue #1133, decisión del dueño (2026-09-11, opción B en #1134): la
    ÚNICA cuenta habilitada para recibir representados es una con el rol
    REPRESENTANTE.

    `cuenta_representante` es lo mismo que devuelve
    `UsuarioRepositorio.obtener_por_persona_id`: `None` cuando el
    representante NO tiene cuenta propia (un tutor cargado a mano, sin
    login) -- ese caso NO se rechaza acá. La decisión dice "una CUENTA con
    rol REPRESENTANTE", no "toda persona necesita cuenta", y ese patrón es
    anterior a este issue: está probado en
    `test_representante_no_deja_menores_huerfanos.py` y
    `test_verificacion_correo_representante.py`, y ningún comentario del
    issue reconoce retirarlo. Cerrar también ESE caso es una ampliación del
    alcance decidido, no una consecuencia obvia de "una cuenta con rol
    REPRESENTANTE" -- ver el PR de este cambio para el punto exacto que
    queda pendiente de confirmación del dueño."""
    if cuenta_representante is None:
        return
    if any(rol.tipo_rol == TipoRol.REPRESENTANTE for rol in cuenta_representante.roles):
        return
    raise OperacionInvalida(
        MENSAJE_REPRESENTANTE_SIN_ROL,
        detalle_tecnico=(
            f"representante_id={representante_id} usuario_id="
            f"{cuenta_representante.id} no tiene el rol REPRESENTANTE"
        ),
    )
