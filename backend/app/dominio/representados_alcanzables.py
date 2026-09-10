"""
Issue #1139: ningún menor puede quedar con `representante_id` apuntando a
una cuenta inactiva, ni con `representante_id` nulo mientras siga siendo
menor.

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

PR 4 (#1133) añade la tercera pata del invariante, el TELÉFONO: un destino
sin teléfono válido actual no recibe representados (ni crea el grafo que
después no podría avisar). El helper `exigir_telefono_actual_del_destino`
es la mitad de servicio; la mitad de base vive en el trigger de relación
que instala `i1141relinteg`, que REEMPLAZA al trigger persona de
`g1139repmenor` (`trg_persona_representante_alcanzable`) ampliándolo a
INSERT + ciclo + teléfono, con el mismo mutex documentado del grafo.

Son funciones puras: no tocan la sesión, no comitean. El chequeo de servicio
es el camino PRIMARIO de error (mensaje legible, accionable); la garantía
real -- inclusive contra una carrera de dos peticiones concurrentes -- vive
en Postgres, en los triggers `TRIGGER_USUARIO_BLOQUEA_BAJA`,
`TRIGGER_RELACION_REPRESENTACION` y `TRIGGER_TELEFONO_REPRESENTANTE`.
"""
from datetime import date

from app.dominio.excepciones import OperacionInvalida
from app.dominio.modelos import Persona
from app.dominio.nombre_propio import nombre_completo
from app.dominio.reglas_negocio import EDAD_MAYORIA_EDAD, calcular_edad
from app.dominio.telefono import es_telefono_valido

# Los nombres de los triggers viven acá, junto a la regla que imponen, para
# que un `rg` sobre cualquiera de los dos encuentre al otro (mismo criterio
# que `TRIGGER_ROL_UNICO` en `rol_unico.py`).
TRIGGER_USUARIO_BLOQUEA_BAJA = "trg_usuario_bloquea_baja_con_representados_menores"

# Instalados por `i1141relinteg` (PR 4, #1133): el trigger persona de
# `g1139repmenor` (`trg_persona_representante_alcanzable`) fue REEMPLAZADO
# por el de relación, que cubre lo mismo y añade INSERT, ciclo, adulto y
# teléfono con corto-circuito `IS NOT DISTINCT FROM`.
TRIGGER_RELACION_REPRESENTACION = "trg_relacion_representacion_valida"
TRIGGER_TELEFONO_REPRESENTANTE = "trg_telefono_representante_con_menores"

# La llave del mutex transaccional del grafo de representación
# (`pg_advisory_xact_lock`): TODA escritura de `representante_id` y todo
# cambio de teléfono de un representante la toma. Misma constante en la
# migración y acá, para que un `rg` la encuentre entera.
MUTEX_GRAFO_REPRESENTACION = 7113911370001


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


def exigir_telefono_actual_del_destino(representante_id: int, telefono: str | None) -> None:
    """El destino de un vínculo tiene que tener un teléfono válido HOY: es el
    canal por el que el club avisa cuando algo cambia en la representación de
    un menor. Mismo predicado canónico que la base
    (`^(09[0-9]{8}|0[0-9]{8})$`, ver `_RE_TELEFONO_FORMA` en `modelos.py`) y
    que el trigger `TRIGGER_TELEFONO_REPRESENTANTE`: si el servicio falla por
    acá, la base lo habría rechazado igual."""
    if telefono and es_telefono_valido(telefono):
        return None
    raise OperacionInvalida(
        "La persona que va a recibir al representado no tiene un teléfono "
        "válido actual (celular 09XXXXXXXX o fijo 0XXXXXXXX). Carguen el "
        "teléfono antes de la vinculación o reasignación.",
        detalle_tecnico=(
            f"representante_id={representante_id} sin teléfono con forma "
            f"válida: {telefono!r}"
        ),
    )
