"""una fila por categoria y dia_semana (INS-3)

Revision ID: b7e4a9f2c6d1
Revises: c6b3e8f2a5d9
Create Date: 2026-08-11 00:00:00.000000

Invariante de negocio EN LA BASE (INS-3, decisión de negocio #5,
2026-08-11): una sola fila de `horario_entrenamiento` por (categoria,
dia_semana). Las horas de un horario se DERIVAN de la categoria
(`AsistenciaServicio._validar_dia_y_derivar_horas`), así que dos filas
Formativo-Lunes son idénticas -- no existe el caso legítimo de "dos grupos
distintos el mismo día". Sin este candado, un alumno asignado después de un
duplicado queda enrolado en AMBAS filas (rompe la inscripción atómica del
issue #181).

Decisión de limpieza de datos (a diferencia de `c3d9f2b7a1e5`, que ante un
invariante ya violado prefirió fallar ruidosamente porque decidir qué pago/
membresía gana es un juicio de negocio: acá el dueño ya fijó la regla de
limpieza explícitamente, así que la migración SÍ deduplica en vez de fallar):

Por cada grupo (categoria, dia_semana) con más de una fila:
  1. Se CONSERVA la de `id` más bajo (la más vieja -- primer horario real
     que existió para ese día; los duplicados posteriores son el bug).
  2. `alumno_horario` de las filas descartadas se re-apunta a la fila
     conservada, EXCEPTO si la misma persona ya está inscripta también en
     la conservada -- exactamente el escenario del bug INS-3 (un alumno
     asignado después del duplicado queda en ambas). Re-apuntar ese caso
     chocaría con `uq_alumno_horario (persona_id, horario_id)`, así que esa
     fila SOBRANTE se borra en vez de re-apuntarse: el alumno sigue
     inscripto (vía la fila que sí sobrevive), no se pierde la inscripción.
  3. `asistencia` (historial de asistencia) de las filas descartadas se
     re-apunta a la fila conservada: mismo categoria+día = misma clase, así
     que el historial sigue siendo verídico. No hay UNIQUE en `asistencia`
     que bloquee esto (la deduplicación de una sesión re-tomada es a nivel
     de servicio -- ver `AsistenciaRepositorio.buscar_por_persona_horario_
     fecha` -- no de base), así que no hay colisión posible acá.
  4. La(s) fila(s) descartada(s) se borran de `horario_entrenamiento`.

El `downgrade()` retira el UNIQUE pero NO reconstruye las filas duplicadas
que el upgrade colapsó -- perder un duplicado (que por definición no
distinguía nada real: mismo categoria+día+horas) no es una pérdida de
información recuperable, a diferencia de un downgrade de columna con datos.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b7e4a9f2c6d1'
down_revision: Union[str, Sequence[str], None] = 'c6b3e8f2a5d9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()

    duplicados = bind.execute(sa.text(
        "SELECT categoria, dia_semana, array_agg(id ORDER BY id) AS ids "
        "FROM horario_entrenamiento "
        "GROUP BY categoria, dia_semana "
        "HAVING count(*) > 1"
    )).fetchall()

    for _categoria, _dia_semana, ids in duplicados:
        conservado_id, *descartados_ids = ids

        personas_en_conservado = {
            fila[0] for fila in bind.execute(
                sa.text("SELECT persona_id FROM alumno_horario WHERE horario_id = :hid"),
                {"hid": conservado_id},
            ).fetchall()
        }

        for descartado_id in descartados_ids:
            filas_alumno_horario = bind.execute(
                sa.text("SELECT id, persona_id FROM alumno_horario WHERE horario_id = :hid"),
                {"hid": descartado_id},
            ).fetchall()
            for fila_id, persona_id in filas_alumno_horario:
                if persona_id in personas_en_conservado:
                    # El alumno ya está inscripto en la fila conservada
                    # (escenario del bug INS-3): re-apuntar chocaría con
                    # uq_alumno_horario. La inscripción sigue existiendo vía
                    # la fila conservada, así que la sobrante se borra.
                    bind.execute(
                        sa.text("DELETE FROM alumno_horario WHERE id = :id"),
                        {"id": fila_id},
                    )
                else:
                    bind.execute(
                        sa.text(
                            "UPDATE alumno_horario SET horario_id = :conservado "
                            "WHERE id = :id"
                        ),
                        {"conservado": conservado_id, "id": fila_id},
                    )
                    personas_en_conservado.add(persona_id)

            # Historial de asistencia: mismo categoria+día = misma clase,
            # se re-apunta entero -- no se descarta información real.
            bind.execute(
                sa.text(
                    "UPDATE asistencia SET horario_id = :conservado "
                    "WHERE horario_id = :descartado"
                ),
                {"conservado": conservado_id, "descartado": descartado_id},
            )

            bind.execute(
                sa.text("DELETE FROM horario_entrenamiento WHERE id = :id"),
                {"id": descartado_id},
            )

    op.create_unique_constraint(
        "uq_horario_categoria_dia", "horario_entrenamiento", ["categoria", "dia_semana"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_horario_categoria_dia", "horario_entrenamiento", type_="unique")
