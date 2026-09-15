"""Persona.telefono nullable (issue #1207).

Un menor representado sin celular propio no tiene NINGÚN teléfono que
guardar -- su contacto de emergencia se deriva del representante al leer
(`FichaMedicaServicio.obtener_ficha_emergencia`), nunca de esta columna. Antes
de esta migración, `persona.telefono` era NOT NULL, así que el alta del
camino representado (issue #1197, `EnrollmentServicio.enroll`) tenía que
persistir `""` en su lugar -- un valor que `_exigir_telefono_valido`
(`app/dominio/modelos.py`) ya toleraba como "sin teléfono", pero que además
dejaba a `PersonaUpdateDTO.telefono` y `RepresentadoCreateDTO.telefono`
(`_validar_telefono`, que SIEMPRE rechaza una cadena vacía) sin forma de
aceptarlo de vuelta: cualquier reenvío del formulario -- el desk-edit del
admin, o el "agregar dependiente" del portal -- volvía a chocar con "El
teléfono es obligatorio.".

Esta migración cierra esa brecha en el esquema: `NULL` pasa a ser el valor
legítimo de "sin teléfono" (lo que la capa de servicio ya persiste desde este
mismo cambio), y `""` deja de ser necesario. Las filas existentes con `""`
se backfillean a `NULL` -- son exactamente los menores representados sin
celular que el camino de #1197 creó; no hay ninguna otra fuente de `""` en
`persona.telefono` hoy (`_exigir_telefono_valido` es la única puerta de
escritura del ORM, y solo la usan las Personas creadas por la app). La fila
de bootstrap de staging (`telefono = '0000000000'`, ver el docstring de
`f1a7ident828` y el `__table_args__` de `Persona`) NO es una cadena vacía y
no se toca.

`persona.telefono` sigue sin CheckConstraint de forma (mismo motivo que
`f1a7ident828`: esa fila de bootstrap no cumple `_RE_TELEFONO_FORMA`, y un
CHECK la congelaría contra toda escritura futura) -- esta migración solo
cambia la nulabilidad, no agrega ningún constraint nuevo.

Revision ID: l1207telnull
Revises: k1143rolrep
Create Date: 2026-09-14

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "l1207telnull"
down_revision: Union[str, Sequence[str], None] = "k1143rolrep"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # `nullable=True` primero: mientras la columna siga NOT NULL, el UPDATE
    # de abajo (que pone `telefono = NULL`) viola esa misma restricción que
    # esta migración está retirando.
    op.alter_column(
        "persona", "telefono", existing_type=sa.String(length=15), nullable=True,
    )
    op.execute("UPDATE persona SET telefono = NULL WHERE telefono = ''")


def downgrade() -> None:
    # Vuelve al estado anterior a la migración: `NULL` se backfillea a `""`
    # ANTES de reponer el NOT NULL, para que el `ALTER COLUMN` no aborte
    # contra las filas que esta misma migración dejó en `NULL`.
    op.execute("UPDATE persona SET telefono = '' WHERE telefono IS NULL")
    op.alter_column(
        "persona", "telefono", existing_type=sa.String(length=15), nullable=False,
    )
