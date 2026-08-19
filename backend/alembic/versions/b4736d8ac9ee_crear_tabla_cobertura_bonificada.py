"""crear tabla cobertura_bonificada

Revision ID: b4736d8ac9ee
Revises: f3a9c8e2b615
Create Date: 2026-08-18 09:00:00.000000

Issue #400 (slice 4d): cuando el beneficio 100% personal de una persona
(`AsignacionDescuento`, issue #398) cubre el monto base completo de un
período, esa cobertura debe quedar auditada SIN un `Pago` fabricado (sin
método de pago inventado, sin voucher, sin comprobante PDF). Esta migración
crea la tabla dedicada que reemplaza esa invención -- ver el docstring de
`CoberturaBonificada` en `app/dominio/modelos.py` para el razonamiento
completo de por qué NO es una fila de `Pago` con un `TipoPago` nuevo.

Qué crea
--------
1. La extensión `btree_gist` (si no existe ya en esta base): necesaria para
   que el índice GiST de más abajo pueda comparar `membresia_id` con `=`
   además del solapamiento de rango. Ninguna migración previa la habilita
   (`rg btree_gist alembic/versions/` no encuentra nada), así que esta es la
   primera en necesitarla.
2. `cobertura_bonificada`: persona/membresía/asignación + snapshot de tarifa
   congelado (mismo criterio que `Pago.tarifa_mensual_aplicada` /
   `meses_comprados`) + auditoría de quién la otorgó y cuándo.
   `descuento_valor_aplicado`/`descuento_porcentaje_aplicado` (hallazgo del
   revisor) congelan el valor del descuento CALCULADO al otorgar -- mismo
   criterio que `Pago.descuento_valor_aplicado`/`_porcentaje_aplicado` (ver
   su docstring en `modelos.py`): sin esto, un admin que edite después el
   `Descuento` del catálogo (`DescuentoServicio.actualizar`) reescribiría en
   los hechos cuánto valió una cobertura ya otorgada, aunque la persona no
   pagó nada por ella entonces ni paga nada ahora. `descuento_valor_
   aplicado` es NOT NULL (esta fila SOLO existe cuando el beneficio cubrió
   el 100%, así que el valor siempre se conoce); `_porcentaje_aplicado` es
   NULL cuando el descuento congelado era de monto fijo, igual que en `Pago`.
3. `ex_cobertura_bonificada_periodo_no_solapa`: restricción de EXCLUSIÓN
   (no un índice único) -- dos otorgamientos para la MISMA membresía cuyos
   períodos `[fecha_inicio, fecha_fin)` se solapan no pueden coexistir.
   Mismo criterio que `uq_membresia_activa_por_persona`/`uq_pago_pendiente_
   por_membresia` (auditoría hallazgo 7, issue #8): el pre-check de
   `PagoServicio.aplicar_beneficio_bonificado` es el camino primario de
   error (mensaje legible); esto es la red de seguridad ante dos
   otorgamientos concurrentes que el pre-check no puede ver porque corren en
   transacciones separadas. A diferencia de esos dos índices (booleanos de
   "hay como mucho UNA fila vigente"), acá el hecho a proteger es "los
   RANGOS no se pisan", que un índice único parcial no puede expresar --
   por eso EXCLUDE en vez de UNIQUE. El gap preexistente que motiva esto:
   `PagoRepositorio.cobertura_aprobada_en_rango` (usada por
   `regularizar_deuda`, issue #284) nunca tuvo un respaldo equivalente en la
   base; se cierra acá porque esta tabla es código nuevo, no una migración
   separada sobre `regularizar_deuda`.

Por qué `op.execute` para la restricción de exclusión (y no un helper de
Alembic)
------------------------------------------------------------------------
Alembic no tiene una operación `op.create_exclude_constraint`; el DDL de
Postgres (`ALTER TABLE ... ADD CONSTRAINT ... EXCLUDE USING gist (...)`) se
emite crudo, igual que ya hacen `a4e7c2f9b1d8`/`d2a7e5c91b34` para DDL que
`op.create_table` no puede expresar. El modelo ORM (`CoberturaBonificada.
__table_args__`) SÍ declara la misma restricción con `sqlalchemy.dialects.
postgresql.ExcludeConstraint`, para que `Base.metadata` describa el esquema
completo y `test_no_hay_drift_entre_modelos_y_migraciones` pueda comparar
ambos lados sin exclusiones especiales.

El downgrade borra la tabla entera; NO deshabilita `btree_gist` (una
extensión de instancia que otra migración futura podría reutilizar --
deshabilitarla en cada rollback sería una responsabilidad que esta
migración no tiene por qué asumir).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b4736d8ac9ee'
down_revision: Union[str, Sequence[str], None] = 'f3a9c8e2b615'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute("CREATE EXTENSION IF NOT EXISTS btree_gist")

    op.create_table(
        'cobertura_bonificada',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('membresia_id', sa.Integer(), nullable=False),
        sa.Column('persona_id', sa.Integer(), nullable=False),
        sa.Column('asignacion_descuento_id', sa.Integer(), nullable=False),
        sa.Column('tarifa_mensual_aplicada', sa.Numeric(10, 2), nullable=False),
        sa.Column('meses_comprados', sa.Integer(), nullable=False),
        sa.Column('descuento_valor_aplicado', sa.Numeric(10, 2), nullable=False),
        sa.Column('descuento_porcentaje_aplicado', sa.Numeric(5, 2), nullable=True),
        sa.Column('fecha_inicio', sa.Date(), nullable=False),
        sa.Column('fecha_fin', sa.Date(), nullable=False),
        sa.Column('otorgada_por_persona_id', sa.Integer(), nullable=False),
        sa.Column('otorgada_en', sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            'meses_comprados > 0',
            name='ck_cobertura_bonificada_meses_positivo',
        ),
        sa.ForeignKeyConstraint(['membresia_id'], ['membresia.id']),
        sa.ForeignKeyConstraint(['persona_id'], ['persona.id']),
        sa.ForeignKeyConstraint(['asignacion_descuento_id'], ['asignacion_descuento.id']),
        sa.ForeignKeyConstraint(['otorgada_por_persona_id'], ['persona.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_cobertura_bonificada_membresia_id',
        'cobertura_bonificada', ['membresia_id'],
    )
    op.create_index(
        'ix_cobertura_bonificada_persona_id',
        'cobertura_bonificada', ['persona_id'],
    )
    op.create_index(
        'ix_cobertura_bonificada_asignacion_descuento_id',
        'cobertura_bonificada', ['asignacion_descuento_id'],
    )
    op.create_index(
        'ix_cobertura_bonificada_otorgada_por_persona_id',
        'cobertura_bonificada', ['otorgada_por_persona_id'],
    )
    op.execute(
        "ALTER TABLE cobertura_bonificada "
        "ADD CONSTRAINT ex_cobertura_bonificada_periodo_no_solapa "
        "EXCLUDE USING gist ("
        "  membresia_id WITH =, "
        "  daterange(fecha_inicio, fecha_fin, '[)') WITH &&"
        ")"
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('cobertura_bonificada')
