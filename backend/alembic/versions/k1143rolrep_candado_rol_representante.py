"""Candado de base para el rol del representante (issue #1133, decisión del
dueño de 2026-09-11, opción B en #1134).

Decisión de producto: "solo una cuenta con rol REPRESENTANTE puede
representar". Esta migración instala esa mitad de base -- la mitad de
servicio (mensaje legible) vive en
`app.dominio.representados_alcanzables.exigir_representante_con_rol_valido`,
consumida por `PersonaServicio` (`crear_representado`, `vincular_representado`,
`registrar_persona`) y respaldada por el trigger diferido de acá para
`EnrollmentServicio`, que otorga cuenta y rol DESPUÉS de fijar
`representante_id` del alumno (mismo orden que ya exige `j1142ctarep`).

Alcance DELIBERADAMENTE PARCIAL -- ver el PR para el punto exacto que queda
pendiente de confirmación del dueño: el candado exige el rol SOLO cuando el
destino YA tiene una cuenta propia. Una persona SIN cuenta (el "tutor cargado
a mano, sin login") no se toca: ese patrón es anterior a este issue, está
probado en múltiples archivos
(`test_representante_no_deja_menores_huerfanos.py`,
`test_verificacion_correo_representante.py`) y ningún comentario del issue
reconoce retirarlo. Cerrar ese caso también -- "toda persona representante
necesita cuenta" -- es una ampliación del alcance decidido, no una
consecuencia obvia de "una cuenta con rol REPRESENTANTE", y requiere
confirmación explícita antes de romper ese comportamiento sostenido.

Dos triggers, uno por dirección de la escritura:

  - `trg_persona_exige_rol_representante`
    (AFTER INSERT OR UPDATE OF representante_id ON persona,
    DEFERRABLE INITIALLY DEFERRED): rechaza vincular a una persona cuya
    cuenta EXISTE pero no tiene el rol REPRESENTANTE. Diferido por el mismo
    motivo que `j1142ctarep`: `EnrollmentServicio.enroll` inserta la Persona
    del alumno con `representante_id` seteado ANTES de crear la cuenta y el
    rol del representante, todo en una sola transacción -- un trigger
    inmediato rechazaría ese camino legítimo. Evaluado al COMMIT, contra el
    estado FINAL, ve la cuenta y el rol ya otorgados.

  - `trg_usuario_rol_exige_representados_reasignados`
    (BEFORE DELETE OR UPDATE OF usuario_id, rol_id ON usuario_rol): rechaza
    quitarle (o reapuntar) el rol REPRESENTANTE a una cuenta mientras
    todavía representa a alguna persona ACTIVA. Es el lado inverso del mismo
    invariante -- sin este candado, `RolServicio.quitar_rol` podía dejar a un
    representado activo apuntando a una cuenta sin ningún rol, el mismo
    agujero que el trigger de arriba cierra por la otra puerta. Inmediato
    (no diferido): ningún camino de la aplicación necesita quitar y
    re-otorgar el rol REPRESENTANTE dentro de la misma transacción
    (`RolServicio.establecer_capacidad_representante` nunca remueve el rol
    REPRESENTANTE, solo lo reusa o lo agrega).

Ambos toman el mismo mutex del grafo (`pg_advisory_xact_lock`,
`MUTEX_GRAFO_REPRESENTACION` de `i1141relinteg`): una vinculación nueva y una
remoción de rol concurrentes sobre el mismo par no deben poder colarse la una
a la otra.

Guardia previa a instalar: igual criterio que `j1142ctarep` -- production no
tiene datos hoy (confirmado por el dueño), así que `upgrade()` cuenta y
aborta ruidosamente si encuentra una persona representada por una cuenta sin
el rol.

Revision ID: k1143rolrep
Revises: j1142ctarep
Create Date: 2026-09-11

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "k1143rolrep"
down_revision: Union[str, Sequence[str], None] = "j1142ctarep"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


FUNCION_PERSONA = "exigir_representante_con_rol_si_tiene_cuenta"
TRIGGER_PERSONA = "trg_persona_exige_rol_representante"
FUNCION_USUARIO_ROL = "exigir_representados_reasignados_antes_de_quitar_rol"
TRIGGER_USUARIO_ROL = "trg_usuario_rol_exige_representados_reasignados"
TABLA_ORIGEN = "vinculacion_representante"
CHECK_ORIGEN = "ck_vinculacion_representante_origen"

# Misma llave que `MUTEX_GRAFO_REPRESENTACION` en
# `app/dominio/representados_alcanzables.py` (instalada por `i1141relinteg`):
# toda escritura del grafo de representación se serializa con el mismo mutex.
MUTEX = 7113911370001


SQL_FUNCION_PERSONA = f"""
CREATE OR REPLACE FUNCTION {FUNCION_PERSONA}() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_tiene_cuenta boolean;
    v_tiene_rol boolean;
BEGIN
    -- Corto-circuito: una escritura que no cambia el vínculo no reevalúa
    -- nada (el INSERT no tiene OLD y siempre sigue).
    IF TG_OP = 'UPDATE'
       AND NEW.representante_id IS NOT DISTINCT FROM OLD.representante_id THEN
        RETURN NEW;
    END IF;

    IF NEW.representante_id IS NULL THEN
        RETURN NEW;
    END IF;

    PERFORM pg_advisory_xact_lock({MUTEX});

    SELECT EXISTS (
        SELECT 1 FROM usuario u WHERE u.persona_id = NEW.representante_id
    ) INTO v_tiene_cuenta;

    -- Sin cuenta propia (tutor cargado a mano, sin login): fuera del
    -- alcance decidido para esta migración -- ver el docstring.
    IF NOT v_tiene_cuenta THEN
        RETURN NEW;
    END IF;

    SELECT EXISTS (
        SELECT 1
          FROM usuario u
          JOIN usuario_rol ur ON ur.usuario_id = u.id
          JOIN rol r ON r.id = ur.rol_id
         WHERE u.persona_id = NEW.representante_id
           AND r.tipo_rol::text = 'REPRESENTANTE'
    ) INTO v_tiene_rol;

    IF NOT v_tiene_rol THEN
        RAISE EXCEPTION
            'persona_id=% no puede vincularse a representante_id=%: su cuenta '
            'no tiene el rol REPRESENTANTE',
            NEW.id, NEW.representante_id
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;
"""

SQL_TRIGGER_PERSONA = f"""
CREATE CONSTRAINT TRIGGER {TRIGGER_PERSONA}
AFTER INSERT OR UPDATE OF representante_id ON persona
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION {FUNCION_PERSONA}();
"""

SQL_FUNCION_USUARIO_ROL = f"""
CREATE OR REPLACE FUNCTION {FUNCION_USUARIO_ROL}() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_tipo_rol_anterior text;
    v_persona_id integer;
    v_representados integer;
BEGIN
    SELECT r.tipo_rol::text INTO v_tipo_rol_anterior
      FROM rol r WHERE r.id = OLD.rol_id;

    -- Solo interesa la asociación REPRESENTANTE; cualquier otro rol (o un
    -- UPDATE que no cambia la fila REPRESENTANTE en cuestión) sigue de largo.
    IF v_tipo_rol_anterior IS DISTINCT FROM 'REPRESENTANTE' THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;

    PERFORM pg_advisory_xact_lock({MUTEX});

    SELECT u.persona_id INTO v_persona_id FROM usuario u WHERE u.id = OLD.usuario_id;

    SELECT count(*) INTO v_representados
      FROM persona p
     WHERE p.representante_id = v_persona_id
       AND p.activo = true;

    IF v_representados > 0 THEN
        RAISE EXCEPTION
            'usuario_id=% no puede perder el rol REPRESENTANTE: todavía '
            'representa a % persona(s) activa(s)',
            OLD.usuario_id, v_representados
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
"""

# `OR UPDATE OF usuario_id, rol_id`, mismo criterio que `e762rolunico`:
# reapuntar la fila a otra cuenta o a otro rol es la misma remoción por otra
# vía.
SQL_TRIGGER_USUARIO_ROL = f"""
CREATE TRIGGER {TRIGGER_USUARIO_ROL}
BEFORE DELETE OR UPDATE OF usuario_id, rol_id ON usuario_rol
FOR EACH ROW EXECUTE FUNCTION {FUNCION_USUARIO_ROL}();
"""


def _abortar_si_hay_representantes_sin_rol() -> None:
    """Pre-chequeo accionable: aborta ANTES de instalar nada si ya existe,
    hoy, una persona representada por una cuenta que no tiene el rol
    REPRESENTANTE."""
    filas = op.get_bind().execute(sa.text(
        "SELECT p.id, p.representante_id FROM persona p "
        "JOIN usuario u ON u.persona_id = p.representante_id "
        "WHERE p.representante_id IS NOT NULL "
        "AND NOT EXISTS ("
        "  SELECT 1 FROM usuario_rol ur JOIN rol r ON r.id = ur.rol_id "
        "  WHERE ur.usuario_id = u.id AND r.tipo_rol::text = 'REPRESENTANTE'"
        ") ORDER BY p.id"
    )).fetchall()
    if filas:
        ids = [f"{fila[0]}->{fila[1]}" for fila in filas]
        primeros = ", ".join(ids[:10])
        if len(ids) > 10:
            primeros += f" (y {len(ids) - 10} más)"
        raise RuntimeError(
            "No se puede instalar el candado de rol del representante (issue "
            f"#1133): hay {len(filas)} persona(s) representada(s) por una "
            f"cuenta sin el rol REPRESENTANTE. Resuélvalas a mano antes de "
            f"migrar (persona_id->representante_id: {primeros})."
        )


def upgrade() -> None:
    _abortar_si_hay_representantes_sin_rol()
    op.execute(SQL_FUNCION_PERSONA)
    op.execute(SQL_TRIGGER_PERSONA)
    op.execute(SQL_FUNCION_USUARIO_ROL)
    op.execute(SQL_TRIGGER_USUARIO_ROL)

    # Ledger completo (issue #1133, PR de este cambio): la autoinscripción
    # pública también deja fila en `vinculacion_representante`, con un
    # `origen` propio que la nombra -- ninguno de los cuatro valores
    # existentes describe un alta SIN sesión autenticada previa.
    op.drop_constraint(CHECK_ORIGEN, TABLA_ORIGEN, type_="check")
    op.create_check_constraint(
        CHECK_ORIGEN, TABLA_ORIGEN,
        "origen IN ('SESION_AUTENTICADA', 'ADMIN_PRESENCIAL', "
        "'AUTOSERVICIO_LEGADO', 'REMEDIACION_LEGACY', 'ALTA_PUBLICA')",
    )


def downgrade() -> None:
    op.drop_constraint(CHECK_ORIGEN, TABLA_ORIGEN, type_="check")
    op.create_check_constraint(
        CHECK_ORIGEN, TABLA_ORIGEN,
        "origen IN ('SESION_AUTENTICADA', 'ADMIN_PRESENCIAL', "
        "'AUTOSERVICIO_LEGADO', 'REMEDIACION_LEGACY')",
    )
    op.execute(f"DROP TRIGGER IF EXISTS {TRIGGER_USUARIO_ROL} ON usuario_rol")
    op.execute(f"DROP FUNCTION IF EXISTS {FUNCION_USUARIO_ROL}()")
    op.execute(f"DROP TRIGGER IF EXISTS {TRIGGER_PERSONA} ON persona")
    op.execute(f"DROP FUNCTION IF EXISTS {FUNCION_PERSONA}()")
