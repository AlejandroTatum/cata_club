"""ningún menor sin representante alcanzable (issue #1139)

Instala en Postgres, con dos triggers, el invariante que
`RolServicio.cambiar_estado_cuenta` no imponía: desactivar la cuenta de un
representante -- o vincularle un representado -- no puede dejar a un menor
con `representante_id` apuntando a una cuenta inactiva, ni nulearle ese
vínculo mientras siga siendo menor.

Por qué un trigger y no un CHECK
---------------------------------
Un `CHECK` se reevalúa contra la fila COMPLETA en cada `UPDATE`, aunque la
columna que cambió no tenga nada que ver con la condición -- exactamente el
motivo por el que `persona.telefono` no lleva ninguno (ver el comentario en
`app/dominio/modelos.py`). Acá la condición depende del ESTADO DE OTRA FILA
(si el representado sigue siendo menor, si la cuenta destino está activa) y
de la FECHA (`age(CURRENT_DATE, ...)`): Postgres exige que un CHECK sea
inmutable, y ninguna de las dos cosas lo es. `NOT VALID` tampoco lo salva:
solo evita el recorrido inicial contra las filas existentes, no las
reevaluaciones futuras contra filas que ya cumplían y dejan de hacerlo por
el simple paso del tiempo. Mismo criterio que `e762rolunico` (issue #762):
un trigger `BEFORE ... OF <columnas>`, acotado a las columnas relevantes,
así que actualizar el teléfono de una persona (o cualquier otra columna sin
relación) nunca pasa por acá.

Dos triggers, uno por tabla y por dirección del vínculo
--------------------------------------------------------
1. `trg_usuario_bloquea_baja_con_representados_menores`
   (`BEFORE INSERT OR UPDATE OF activo ON usuario`): rechaza desactivar una
   cuenta que representa a un menor activo.
2. `trg_persona_representante_alcanzable`
   (`BEFORE UPDATE OF representante_id ON persona`): rechaza nulear el
   vínculo de un menor, y rechaza vincularlo a una cuenta ya desactivada.
   Acotado a `UPDATE` (no `INSERT`) A NIVEL DE TRIGGER: el alta de un
   representado nuevo (`PersonaServicio.crear_representado`) es un
   `INSERT`, y varias suites siembran Personas menores por ORM directo sin
   pasar por ningún servicio a propósito (para probar otra cosa); un
   trigger de `INSERT` rompería esas fixtures sin relación con este issue.
   Esto NO deja el alta sin cubrir: `crear_representado` SÍ valida el
   destino con `_exigir_representante_destino_alcanzable` (el mismo chequeo
   de servicio que usa `vincular_representado`) antes de crear nada -- el
   respaldo que falta es solo el de la BASE para ese camino puntual, no el
   invariante en sí.

Por qué NO hace falta una tabla de legado (a diferencia de #762)
-------------------------------------------------------------------
`e762rolunico` necesitó `rol_multiple_detectado` porque una cuenta real en
staging YA violaba ese invariante antes de la migración. Acá no hay
equivalente: los dos triggers son `BEFORE`, así que solo miran las filas que
alguien intente ESCRIBIR desde este `alembic upgrade` en adelante -- ninguna
fila existente se reevalúa, y por lo tanto ninguna puede hacer fallar el
propio `upgrade`.

Concurrencia: el mismo mutex que ya usa `trg_usuario_rol_unico_por_usuario`
-----------------------------------------------------------------------------
El trigger 2 toma un `SELECT ... FOR UPDATE` sobre la fila de `usuario` del
representante DESTINO antes de leer su `activo`. Sin ese lock, una
desactivación (trigger 1, que además YA tiene la fila de `usuario` bloqueada
por ser el objetivo de su propio `UPDATE`) y una vinculación concurrentes
(trigger 2) podrían las dos leer "está bien" antes de que ninguna escriba:
el `FOR UPDATE` hace que la segunda transacción espere el commit de la
primera y recién entonces lea el valor final, exactamente el mecanismo que
`e762rolunico` explica con la fila de `usuario` como mutex.

Revision ID: g1139repmenor
Revises: f1023correobtrim
Create Date: 2026-09-08

"""
from typing import Sequence, Union

from alembic import op


revision: str = "g1139repmenor"
down_revision: Union[str, Sequence[str], None] = "f1023correobtrim"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


FUNCION_USUARIO = "exigir_representados_alcanzables_al_desactivar"
TRIGGER_USUARIO = "trg_usuario_bloquea_baja_con_representados_menores"

FUNCION_PERSONA = "exigir_representante_alcanzable_al_vincular"
TRIGGER_PERSONA = "trg_persona_representante_alcanzable"

SQL_FUNCION_USUARIO = f"""
CREATE OR REPLACE FUNCTION {FUNCION_USUARIO}() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    hay_menor_activo boolean;
    -- Día del CLUB, no del contenedor (mismo contrato que `hoy_club()` en
    -- `app/soporte_transversal/tiempo.py`): los contenedores corren en UTC
    -- y el club está en America/Guayaquil (UTC-5); `CURRENT_DATE` a secas
    -- "cumpliría años" a un alumno cinco horas antes de medianoche local.
    hoy_club date := (now() AT TIME ZONE 'America/Guayaquil')::date;
BEGIN
    -- Solo interesa la transición HACIA inactivo: reactivar, o cualquier
    -- UPDATE que no toque `activo` de verdad (`OLD IS DISTINCT FROM NEW`
    -- cubre además el `INSERT`, donde `OLD` no existe).
    IF NEW.activo = false AND (TG_OP = 'INSERT' OR OLD.activo IS DISTINCT FROM NEW.activo) THEN
        SELECT EXISTS (
            SELECT 1 FROM persona p
             WHERE p.representante_id = NEW.persona_id
               AND p.activo = true
               AND extract(year FROM age(hoy_club, p.fecha_nacimiento)) < 18
        ) INTO hay_menor_activo;

        IF hay_menor_activo THEN
            RAISE EXCEPTION
                'la cuenta de persona_id=% representa a un menor de edad activo; '
                'vincúlelo a otra cuenta de representante antes de desactivarla',
                NEW.persona_id
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;
"""

SQL_TRIGGER_USUARIO = f"""
CREATE TRIGGER {TRIGGER_USUARIO}
BEFORE INSERT OR UPDATE OF activo ON usuario
FOR EACH ROW EXECUTE FUNCTION {FUNCION_USUARIO}();
"""

SQL_FUNCION_PERSONA = f"""
CREATE OR REPLACE FUNCTION {FUNCION_PERSONA}() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    edad_persona int;
    representante_activo boolean;
    -- Mismo criterio que `exigir_representados_alcanzables_al_desactivar`:
    -- el día del CLUB, no el del contenedor.
    hoy_club date := (now() AT TIME ZONE 'America/Guayaquil')::date;
BEGIN
    -- Guardarraíl 1: a un menor no se le puede quitar el vínculo (camino de
    -- `PersonaServicio.independizar`, que ya exige mayoría de edad de la
    -- persona que se independiza -- esto es el respaldo de la base contra
    -- cualquier otro camino, presente o futuro, que intente lo mismo).
    IF NEW.representante_id IS NULL THEN
        edad_persona := extract(year FROM age(hoy_club, NEW.fecha_nacimiento));
        IF edad_persona < 18 THEN
            RAISE EXCEPTION
                'persona_id=% es menor de edad (% años) y no puede quedar sin representante',
                NEW.id, edad_persona
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;

    -- Guardarraíl 2: el destino tiene que poder ser alcanzado. Mismo mutex
    -- que `trg_usuario_bloquea_baja_con_representados_menores` -- ver el
    -- docstring de la migración.
    PERFORM 1 FROM usuario WHERE persona_id = NEW.representante_id FOR UPDATE;

    SELECT u.activo INTO representante_activo
      FROM usuario u
     WHERE u.persona_id = NEW.representante_id;

    -- `representante_activo IS FALSE` y no `= false`: un representante SIN
    -- `Usuario` propio (un tutor cargado a mano, sin login) no tiene
    -- ninguna cuenta que pueda estar desactivada, y `representante_activo`
    -- queda NULL -- `NULL IS FALSE` es `false`, así que ese caso pasa.
    IF representante_activo IS FALSE THEN
        RAISE EXCEPTION
            'persona_id=% no puede vincularse a representante_id=% porque su cuenta está desactivada',
            NEW.id, NEW.representante_id
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;
"""

SQL_TRIGGER_PERSONA = f"""
CREATE TRIGGER {TRIGGER_PERSONA}
BEFORE UPDATE OF representante_id ON persona
FOR EACH ROW EXECUTE FUNCTION {FUNCION_PERSONA}();
"""


def upgrade() -> None:
    op.execute(SQL_FUNCION_USUARIO)
    op.execute(SQL_TRIGGER_USUARIO)
    op.execute(SQL_FUNCION_PERSONA)
    op.execute(SQL_TRIGGER_PERSONA)


def downgrade() -> None:
    op.execute(f"DROP TRIGGER IF EXISTS {TRIGGER_PERSONA} ON persona")
    op.execute(f"DROP FUNCTION IF EXISTS {FUNCION_PERSONA}()")
    op.execute(f"DROP TRIGGER IF EXISTS {TRIGGER_USUARIO} ON usuario")
    op.execute(f"DROP FUNCTION IF EXISTS {FUNCION_USUARIO}()")
