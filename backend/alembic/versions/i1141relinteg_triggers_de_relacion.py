"""Defensa de base para la relación de representación (PR 4, #1133).

Reemplaza el trigger persona de `g1139repmenor` por UN trigger de relación
con el alcance completo del diseño (`design.md` § PostgreSQL safeguards):

  - `BEFORE INSERT OR UPDATE OF representante_id ON persona`, con
    corto-circuito `IS NOT DISTINCT FROM` (una escritura que no cambia el
    valor no reevalúa nada: el adulto envejecido en el sitio puede editar
    cualquier campo ajeno y desvincularse, pero no volver a vincularse como
    adulto);
  - rechaza la auto-referencia (además del CHECK `NOT VALID` de abajo) y el
    ALTA (`INSERT`) o RE-enlace (`UPDATE`) de un adulto: el invariante de edad
    no depende del camino de escritura, que es justo lo que exige `design.md`.
    Las filas legadas de adultos ya vinculados NO se revalidan (el trigger es
    `BEFORE`, nunca recorre lo existente): las pruebas las siembran como se
    crean de verdad — un vínculo de menor que envejeció en el sitio —, no con un
    alta cruda de adulto;
  - protege la desvinculación SOLO del menor activo (el adulto y la baja
    lógica quedan libres);
  - serializa el grafo con `pg_advisory_xact_lock(MUTEX_GRAFO_REPRESENTACION)`
    (la llave vive documentada en `app/dominio/representados_alcanzables.py`):
    los row locks de las dos puntas no alcanzan para evitar que tres
    escrituras concurrentes armen un ciclo más largo;
  - exige destino alcanzable (cuenta activa o inexistente) y con teléfono
    válido actual, y rechaza el ciclo con un CTE recursivo que sigue
    `representante_id` desde el destino.

Y añade el safeguard de TELÉFONO: un representante con dependientes menores
activos no puede cambiar su teléfono a un valor sin forma válida
(`^(09[0-9]{8}|0[0-9]{8})$`, el canónico de `_RE_TELEFONO_FORMA`). No corre
para otras columnas ni para el mismo valor reescrito.

El CHECK de auto-referencia nace `NOT VALID` a propósito: su validación solo
puede correr cuando el inventario de remediación (PR 7) demuestre que no
queda ninguna auto-referencia histórica.

Por qué un trigger y no un CHECK: igual que `g1139repmenor` — la condición
depende del estado de OTRAS filas y de la fecha; Postgres exige CHECKs
inmutables.

Revision ID: i1141relinteg
Revises: h1140rep_auditoria
Create Date: 2026-09-10

"""
from typing import Sequence, Union

from alembic import op


revision: str = "i1141relinteg"
down_revision: Union[str, Sequence[str], None] = "h1140rep_auditoria"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


FUNCION_RELACION = "exigir_relacion_representacion_valida"
TRIGGER_RELACION = "trg_relacion_representacion_valida"
FUNCION_TELEFONO = "exigir_telefono_representante_con_menores"
TRIGGER_TELEFONO = "trg_telefono_representante_con_menores"
CHECK_AUTOREF = "ck_persona_representante_no_autoreferencia"

# Trigger persona de g1139repmenor que esta migración reemplaza.
FUNCION_LEGADA = "exigir_representante_alcanzable_al_vincular"
TRIGGER_LEGADO = "trg_persona_representante_alcanzable"

MUTEX = 7113911370001  # MUTEX_GRAFO_REPRESENTACION en app/dominio/representados_alcanzables.py

SQL_CHECK = f"""
ALTER TABLE persona ADD CONSTRAINT {CHECK_AUTOREF}
    CHECK (representante_id IS NULL OR representante_id <> id) NOT VALID;
"""

SQL_FUNCION_RELACION = f"""
CREATE OR REPLACE FUNCTION {FUNCION_RELACION}() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    -- Día del CLUB (America/Guayaquil), mismo contrato que `hoy_club()`.
    hoy_club date := (now() AT TIME ZONE 'America/Guayaquil')::date;
    destino record;
    cuenta_activa boolean;
    hay_ciclo boolean;
BEGIN
    -- Corto-circuito: una escritura que no cambia el vínculo no reevalúa
    -- nada (el `INSERT` no tiene `OLD` y siempre sigue).
    IF TG_OP = 'UPDATE'
       AND NEW.representante_id IS NOT DISTINCT FROM OLD.representante_id THEN
        RETURN NEW;
    END IF;

    -- Desvincular: solo se protege al menor ACTIVO (el adulto se
    -- independiza; la baja lógica del menor no lo deja "sin nadie" porque
    -- ya está fuera del club).
    IF NEW.representante_id IS NULL THEN
        IF TG_OP = 'UPDATE' AND NEW.activo IS TRUE
           AND extract(year FROM age(hoy_club, NEW.fecha_nacimiento)) < 18 THEN
            RAISE EXCEPTION
                'persona_id=% es menor de edad activo y no puede quedar sin representante',
                NEW.id
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;

    -- Auto-referencia (el CHECK la cubre también; acá es defensa explícita
    -- con mensaje propio).
    IF NEW.representante_id = NEW.id THEN
        RAISE EXCEPTION
            'persona_id=% no puede ser su propio representante',
            NEW.id
            USING ERRCODE = '23514';
    END IF;

    -- Alta o re-enlace de adulto: vale para `INSERT` y `UPDATE` (el invariante
    -- de edad no depende del camino de escritura).
    IF extract(year FROM age(hoy_club, NEW.fecha_nacimiento)) >= 18 THEN
        RAISE EXCEPTION
            'persona_id=% es mayor de edad y no puede vincularse o re-enlazarse a un representante',
            NEW.id
            USING ERRCODE = '23514';
    END IF;

    -- Mutex del grafo: serializa toda escritura de vínculo antes de leer
    -- el estado del destino y del ascendente (carreras de ciclo).
    PERFORM pg_advisory_xact_lock({MUTEX});

    -- Destino alcanzable: su PERSONA debe existir y estar activa, y su
    -- cuenta (si tiene) debe estar activa -- "cuenta activa o inexistente",
    -- el mismo predicado que `exigir_representante_destino_alcanzable` en el
    -- dominio y que el trigger legado de g1139 imponía. La fila bloqueada es
    -- el mismo mutex-fila que g1139 usaba contra la baja.
    PERFORM 1 FROM usuario WHERE persona_id = NEW.representante_id FOR UPDATE;
    SELECT u.activo INTO cuenta_activa
      FROM usuario u
     WHERE u.persona_id = NEW.representante_id;
    IF cuenta_activa IS FALSE THEN
        RAISE EXCEPTION
            'persona_id=% no puede vincularse a representante_id=%: su cuenta está desactivada',
            NEW.id, NEW.representante_id
            USING ERRCODE = '23514';
    END IF;
    SELECT p.activo, p.telefono INTO destino
      FROM persona p
     WHERE p.id = NEW.representante_id;
    IF NOT FOUND OR destino.activo IS NOT TRUE THEN
        RAISE EXCEPTION
            'persona_id=% no puede vincularse a representante_id=%: destino inexistente o dado de baja',
            NEW.id, NEW.representante_id
            USING ERRCODE = '23514';
    END IF;
    IF destino.telefono IS NULL
       OR destino.telefono !~ '^(09[0-9]{{8}}|0[0-9]{{8}})$' THEN
        RAISE EXCEPTION
            'persona_id=% no puede vincularse a representante_id=%: el destino no tiene un teléfono válido actual',
            NEW.id, NEW.representante_id
            USING ERRCODE = '23514';
    END IF;

    -- Ciclo: los ancestros del destino no pueden llegar de vuelta a NEW.
    WITH RECURSIVE ascendentes AS (
        SELECT p.representante_id AS actual
          FROM persona p
         WHERE p.id = NEW.representante_id
        UNION
        SELECT p2.representante_id
          FROM persona p2
          JOIN ascendentes a ON p2.id = a.actual
         WHERE p2.representante_id IS NOT NULL
    )
    SELECT EXISTS (SELECT 1 FROM ascendentes WHERE actual = NEW.id)
      INTO hay_ciclo;
    IF hay_ciclo THEN
        RAISE EXCEPTION
            'vincular persona_id=% bajo representante_id=% formaría un ciclo de representación',
            NEW.id, NEW.representante_id
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;
"""

SQL_TRIGGER_RELACION = f"""
CREATE TRIGGER {TRIGGER_RELACION}
BEFORE INSERT OR UPDATE OF representante_id ON persona
FOR EACH ROW EXECUTE FUNCTION {FUNCION_RELACION}();
"""

SQL_FUNCION_TELEFONO = f"""
CREATE OR REPLACE FUNCTION {FUNCION_TELEFONO}() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    hay_menor_activo boolean;
    hoy_club date := (now() AT TIME ZONE 'America/Guayaquil')::date;
BEGIN
    -- Alcance estricto: solo un CAMBIO real de teléfono (reescribir el
    -- mismo valor -- aunque sea feo, fila legada -- no reevalúa nada).
    IF NEW.telefono IS NOT DISTINCT FROM OLD.telefono THEN
        RETURN NEW;
    END IF;
    -- Un teléfono con forma válida (o vacío→NULL) nunca frena nada.
    IF NEW.telefono IS NOT NULL
       AND NEW.telefono ~ '^(09[0-9]{{8}}|0[0-9]{{8}})$' THEN
        RETURN NEW;
    END IF;

    -- El teléfono se está volviendo inválido: con dependientes menores
    -- activos eso los deja inavisables. El mutex cierra la carrera contra
    -- un vínculo en vuelo (que leería un teléfono que está por morir).
    PERFORM pg_advisory_xact_lock({MUTEX});
    SELECT EXISTS (
        SELECT 1
          FROM persona p
         WHERE p.representante_id = NEW.id
           AND p.activo = true
           AND extract(year FROM age(hoy_club, p.fecha_nacimiento)) < 18
    ) INTO hay_menor_activo;
    IF hay_menor_activo THEN
        RAISE EXCEPTION
            'persona_id=% representa a un menor activo y no puede dejar un teléfono sin forma válida',
            NEW.id
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;
"""

SQL_TRIGGER_TELEFONO = f"""
CREATE TRIGGER {TRIGGER_TELEFONO}
BEFORE UPDATE OF telefono ON persona
FOR EACH ROW EXECUTE FUNCTION {FUNCION_TELEFONO}();
"""

# Restitución EXACTA del trigger persona de g1139repmenor para el downgrade
# (mismo SQL que esa migración instaló, verificado contra su historial).
SQL_FUNCION_LEGADA = f"""
CREATE OR REPLACE FUNCTION {FUNCION_LEGADA}() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    edad_persona int;
    representante_activo boolean;
    hoy_club date := (now() AT TIME ZONE 'America/Guayaquil')::date;
BEGIN
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

    PERFORM 1 FROM usuario WHERE persona_id = NEW.representante_id FOR UPDATE;

    SELECT u.activo INTO representante_activo
      FROM usuario u
     WHERE u.persona_id = NEW.representante_id;

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

SQL_TRIGGER_LEGADO = f"""
CREATE TRIGGER {TRIGGER_LEGADO}
BEFORE UPDATE OF representante_id ON persona
FOR EACH ROW EXECUTE FUNCTION {FUNCION_LEGADA}();
"""


def upgrade() -> None:
    op.execute(f"DROP TRIGGER IF EXISTS {TRIGGER_LEGADO} ON persona")
    op.execute(f"DROP FUNCTION IF EXISTS {FUNCION_LEGADA}()")
    op.execute(SQL_CHECK)
    op.execute(SQL_FUNCION_RELACION)
    op.execute(SQL_TRIGGER_RELACION)
    op.execute(SQL_FUNCION_TELEFONO)
    op.execute(SQL_TRIGGER_TELEFONO)


def downgrade() -> None:
    """Borde seguro: SOLO antes de que un slice posterior dependa de estos
    candados. El CHECK se suelta sin validar (nunca llegó a VALIDATE); los
    triggers legados se restituyen con su SQL original de `g1139repmenor`."""
    op.execute(f"DROP TRIGGER IF EXISTS {TRIGGER_TELEFONO} ON persona")
    op.execute(f"DROP FUNCTION IF EXISTS {FUNCION_TELEFONO}()")
    op.execute(f"DROP TRIGGER IF EXISTS {TRIGGER_RELACION} ON persona")
    op.execute(f"DROP FUNCTION IF EXISTS {FUNCION_RELACION}()")
    op.execute(f"ALTER TABLE persona DROP CONSTRAINT IF EXISTS {CHECK_AUTOREF}")
    op.execute(SQL_FUNCION_LEGADA)
    op.execute(SQL_TRIGGER_LEGADO)
