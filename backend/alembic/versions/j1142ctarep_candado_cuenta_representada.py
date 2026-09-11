"""Candado de base para la cuenta de un representado (issue #1137, Fase 4).

Invariante B: una persona con `Persona.representante_id` no nulo nunca tiene
una fila en `usuario`. Esta migración es el candado de BASE que respalda esa
regla, mismo criterio que `i1141relinteg` para el invariante A
(`test_representacion_triggers.py`): SQL crudo que bypasea la aplicación
choca contra dos triggers.

Dos triggers, uno por tabla y por dirección de la escritura:
  - `trg_usuario_bloquea_cuenta_de_representado`
    (AFTER INSERT OR UPDATE OF persona_id ON usuario): rechaza dar de alta
    o re-apuntar una cuenta a una persona representada.
  - `trg_persona_bloquea_vinculo_con_cuenta`
    (AFTER UPDATE OF representante_id ON persona): rechaza vincular a un
    representante a una persona que YA tiene cuenta propia.

Por qué un trigger y no un CHECK: igual que `g1139repmenor`/`i1141relinteg`
-- la condición depende del estado de OTRA tabla (si la persona tiene fila en
`usuario`, si la cuenta apunta a un representado), y Postgres exige que un
CHECK sea inmutable.

Por qué CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED, y no BEFORE
------------------------------------------------------------------------
`RelacionRepresentacionServicio.independizar_presencial` -- el propio comando
que PR 3 de este issue entregó -- escribe, dentro de UNA sola transacción:
primero las credenciales del adulto SOBRE el `persona_id` que todavía tiene
`representante_id` seteado (paso 4), y recién después corta el vínculo (paso
6); el único `commit()` es el paso 9. Un trigger `BEFORE` inmediato vería el
paso 4 como una violación y abortaría el comando entero -- rechazando
exactamente el camino legítimo que el propio issue diseñó. Un `CONSTRAINT
TRIGGER ... DEFERRABLE INITIALLY DEFERRED` posterga la evaluación hasta el
`COMMIT` (o hasta un `SET CONSTRAINTS ALL IMMEDIATE` explícito): lo que
importa es el estado FINAL de la transacción, no los estados intermedios que
esa misma transacción corrige antes de comitear. Un alta permanente que deja
el estado final violado -- una persona representada con cuenta propia que
nunca se desvincula -- sigue rechazándose, ahora en el `COMMIT`.

Concurrencia: la ventana entre insertar la cuenta y armar el vínculo
--------------------------------------------------------------------
Diferido no es lo mismo que ausente: dos transacciones CONCURRENTES siguen
serializándose. El trigger de `usuario` toma un `SELECT ... FOR UPDATE`
sobre la fila de `persona` ANTES de leer su `representante_id`; el `UPDATE
persona SET representante_id` del otro trigger ya tiene esa misma fila
bloqueada por ser el objetivo de su propio `UPDATE` desde que esa sentencia
corrió (el lock de fila de un `UPDATE` no espera a que el trigger se
dispare). Es el mismo mecanismo de mutex de fila (un `SELECT ... FOR UPDATE`
puntual) que `g1139repmenor` usa sobre la fila de `usuario` del
representante -- acá espejado sobre la fila de `persona` del representado,
porque es esa la fila que ambos triggers necesitan leer con el estado final.
`i1141relinteg` no es la misma comparación: ese candado además recorre un
CTE recursivo para detectar ciclos en TODO el grafo de representación, y por
eso necesita el mutex más fuerte de `pg_advisory_xact_lock` (serializa
cualquier escritura de vínculo, no solo la fila en juego). Acá alcanza con
el lock de UNA fila: el invariante B es puntual entre una persona y su
cuenta, no una propiedad del grafo completo.

Guardia previa a instalar
--------------------------
Un trigger `AFTER ... DEFERRABLE` nunca reevalúa filas existentes: si la
premisa del dueño (producción no tiene hoy ningún representado con cuenta)
fuera falsa, el candado se instalaría igual y dejaría cualquier par legado
invisible para siempre. Por eso `upgrade()` cuenta ANTES de instalar nada y
aborta ruidosamente -- nombrando el conteo y los primeros ids en conflicto --
si encuentra una sola persona representada con cuenta propia. No deduplica
ni desactiva nada: decidir qué hacer con ese par es una decisión de negocio
que una migración no debe adivinar.

Revision ID: j1142ctarep
Revises: i1141relinteg
Create Date: 2026-09-10

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "j1142ctarep"
down_revision: Union[str, Sequence[str], None] = "i1141relinteg"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


FUNCION_USUARIO = "exigir_persona_sin_representante_para_cuenta"
TRIGGER_USUARIO = "trg_usuario_bloquea_cuenta_de_representado"
FUNCION_PERSONA = "exigir_representado_sin_cuenta_al_vincular"
TRIGGER_PERSONA = "trg_persona_bloquea_vinculo_con_cuenta"


SQL_FUNCION_USUARIO = f"""
CREATE OR REPLACE FUNCTION {FUNCION_USUARIO}() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_representante_id integer;
BEGIN
    -- Corto-circuito: un UPDATE que no cambia `persona_id` no reevalúa nada
    -- (el INSERT no tiene OLD y siempre sigue).
    IF TG_OP = 'UPDATE' AND NEW.persona_id IS NOT DISTINCT FROM OLD.persona_id THEN
        RETURN NEW;
    END IF;

    -- Mutex de fila: bloquea la persona ANTES de leer su vínculo. Un
    -- `UPDATE persona SET representante_id = ...` concurrente sobre la
    -- misma fila ya la tiene bloqueada por ser el objetivo de su propio
    -- `UPDATE`; esta transacción espera su commit y recién entonces lee el
    -- vínculo final (ver el docstring de la migración). El diferido evalúa
    -- el estado FINAL de `persona_id`, no el de esta sentencia en
    -- particular: correcto, porque lo único que importa es con qué persona
    -- termina esta cuenta al comitear.
    SELECT p.representante_id INTO v_representante_id
      FROM persona p
     WHERE p.id = NEW.persona_id
       FOR UPDATE;

    IF v_representante_id IS NOT NULL THEN
        RAISE EXCEPTION
            'persona_id=% está representada (representante_id=%) y no puede '
            'tener una cuenta propia (issue #1137, invariante B)',
            NEW.persona_id, v_representante_id
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;
"""

# `CONSTRAINT TRIGGER` exige `AFTER`: la fila ya existe cuando la función
# corre, y `DEFERRABLE INITIALLY DEFERRED` la deja pendiente hasta el
# `COMMIT` (o un `SET CONSTRAINTS ALL IMMEDIATE` explícito) -- ver el
# docstring de la migración para el motivo (`independizar_presencial`).
SQL_TRIGGER_USUARIO = f"""
CREATE CONSTRAINT TRIGGER {TRIGGER_USUARIO}
AFTER INSERT OR UPDATE OF persona_id ON usuario
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION {FUNCION_USUARIO}();
"""

SQL_FUNCION_PERSONA = f"""
CREATE OR REPLACE FUNCTION {FUNCION_PERSONA}() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_tiene_cuenta boolean;
BEGIN
    -- Corto-circuito: una escritura que no cambia el vínculo no reevalúa
    -- nada.
    IF NEW.representante_id IS NOT DISTINCT FROM OLD.representante_id THEN
        RETURN NEW;
    END IF;

    -- Desvincular nunca choca contra este candado: la ausencia de
    -- representante es justo el estado que habilita tener cuenta propia.
    IF NEW.representante_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- La fila de `persona` ya está bloqueada por este propio `UPDATE` (el
    -- mismo mutex de fila que toma
    -- `exigir_persona_sin_representante_para_cuenta` del lado de `usuario`):
    -- una cuenta insertándose en paralelo para esta persona espera este
    -- commit y recién entonces lee el vínculo final. La lectura de
    -- `usuario` es del estado ACTUAL al momento del diferido, no de una foto
    -- vieja: si la propia transacción borrara la cuenta antes de comitear,
    -- este chequeo la vería libre.
    SELECT EXISTS (
        SELECT 1 FROM usuario u WHERE u.persona_id = NEW.id
    ) INTO v_tiene_cuenta;

    IF v_tiene_cuenta THEN
        RAISE EXCEPTION
            'persona_id=% ya tiene una cuenta propia y no puede vincularse '
            'a un representante (issue #1137, invariante B)',
            NEW.id
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;
"""

SQL_TRIGGER_PERSONA = f"""
CREATE CONSTRAINT TRIGGER {TRIGGER_PERSONA}
AFTER UPDATE OF representante_id ON persona
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION {FUNCION_PERSONA}();
"""


def _abortar_si_hay_cuentas_de_representados() -> None:
    """Pre-chequeo accionable: si `persona` ya tiene, hoy, alguna fila
    representada con cuenta propia, se aborta ANTES de instalar nada,
    nombrando el conteo y los primeros ids para que el operador sepa
    exactamente qué resolver."""
    filas = op.get_bind().execute(sa.text(
        "SELECT p.id FROM persona p JOIN usuario u ON u.persona_id = p.id "
        "WHERE p.representante_id IS NOT NULL ORDER BY p.id"
    )).fetchall()
    if filas:
        ids = [str(fila[0]) for fila in filas]
        primeros = ", ".join(ids[:10])
        if len(ids) > 10:
            primeros += f" (y {len(ids) - 10} más)"
        raise RuntimeError(
            "No se puede instalar el candado de cuenta representada (issue "
            f"#1137, invariante B): hay {len(ids)} personas representadas "
            f"con cuenta propia. Resuélvalas a mano antes de migrar "
            f"(ids: {primeros})."
        )


def upgrade() -> None:
    _abortar_si_hay_cuentas_de_representados()
    op.execute(SQL_FUNCION_USUARIO)
    op.execute(SQL_TRIGGER_USUARIO)
    op.execute(SQL_FUNCION_PERSONA)
    op.execute(SQL_TRIGGER_PERSONA)


def downgrade() -> None:
    op.execute(f"DROP TRIGGER IF EXISTS {TRIGGER_PERSONA} ON persona")
    op.execute(f"DROP FUNCTION IF EXISTS {FUNCION_PERSONA}()")
    op.execute(f"DROP TRIGGER IF EXISTS {TRIGGER_USUARIO} ON usuario")
    op.execute(f"DROP FUNCTION IF EXISTS {FUNCION_USUARIO}()")
