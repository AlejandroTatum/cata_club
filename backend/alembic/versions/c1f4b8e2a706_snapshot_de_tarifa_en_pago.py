"""snapshot de tarifa congelado en pago (tarifa, meses y monto base)

Revision ID: c1f4b8e2a706
Revises: de1413036789
Create Date: 2026-08-18 00:00:00.000000

Issue #400: reconstrucción del ciclo de membresía, tarifas y cobertura.

El problema que cierra
----------------------
Hoy el precio mensual de un pago no está en el pago: vive en
`membresia.monto_aplicado`, que es mutable. Los meses que un pago compró se
derivan dividiendo su monto por ese valor VIGENTE (ver
`PagoServicio.registrar_pago`), así que editar la tarifa reescribe de hecho
la historia -- un pago de hace un año pasa a "comprar" otra cantidad de meses
sin que nadie lo haya tocado. #400 lo prohíbe explícitamente: cada pago
congela su tarifa, sus meses, su monto base, su beneficio y su monto final.

Esta migración agrega las tres piezas que faltaban:

  * `tarifa_mensual_aplicada` (Numeric 10,2): el precio mensual que regía
    cuando se registró el pago.
  * `meses_comprados` (Integer): la cantidad de meses completos comprados.
  * `monto_base` (Numeric 10,2): el monto ANTES del descuento. `pago.monto`
    guarda el monto FINAL, ya descontado, así que el base no era legible sin
    reconstruirlo sumando `descuento_valor_aplicado`.

Por qué NULLABLE y sin backfill
-------------------------------
Las tres nacen nullable y las filas históricas NO se rellenan. Dos razones,
las dos de #400:

  1. La tarifa que regía cuando se cobró un pago viejo es exactamente el
     dato que nunca se registró. Rellenarlo con `membresia.monto_aplicado`
     de HOY sería inventar historia -- la "corrección automática de plata
     ambigua" que #400 prohíbe. `scripts/inventario_anomalias_pagos.py`
     (clase A5) mide cuántas filas quedan sin poder reconstruirse, y ese
     inventario corre ANTES que esta migración a propósito.
  2. Compatibilidad durante la cadena: mientras los PRs siguientes no
     escriban el snapshot, el código viejo sigue insertando pagos sin él.
     NOT NULL partiría la aplicación en el momento de aplicarse.

Los dos CHECK
-------------
  * `ck_pago_snapshot_completo_o_ausente`: todo o nada. Un pago con tarifa
    pero sin meses es un hecho histórico incompleto, y eso es peor que no
    tener snapshot: tiene forma de dato bueno y no lo es. Mismo criterio que
    `ck_pago_descuento_valor_congelado` (migración `ade8e3c117ca`).
  * `ck_pago_meses_comprados_positivo`: cero meses no compra nada y meses
    negativos devolverían cobertura, que no existe en este dominio.

Ambos toleran el estado ausente, así que aplican sobre una tabla con filas
sin necesidad de tocar ninguna.

El downgrade es real y completo: las tres columnas son nuevas, nadie las
lee todavía, y nada fuera de ellas se modifica.
"""

from alembic import op
import sqlalchemy as sa


revision = "c1f4b8e2a706"
down_revision = "300423734f25"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "pago",
        sa.Column("tarifa_mensual_aplicada", sa.Numeric(10, 2), nullable=True),
    )
    op.add_column("pago", sa.Column("meses_comprados", sa.Integer(), nullable=True))
    op.add_column("pago", sa.Column("monto_base", sa.Numeric(10, 2), nullable=True))

    op.create_check_constraint(
        "ck_pago_snapshot_completo_o_ausente",
        "pago",
        "(tarifa_mensual_aplicada IS NULL"
        " AND meses_comprados IS NULL"
        " AND monto_base IS NULL)"
        " OR (tarifa_mensual_aplicada IS NOT NULL"
        " AND meses_comprados IS NOT NULL"
        " AND monto_base IS NOT NULL)",
    )
    op.create_check_constraint(
        "ck_pago_meses_comprados_positivo",
        "pago",
        "meses_comprados IS NULL OR meses_comprados > 0",
    )


def downgrade() -> None:
    op.drop_constraint("ck_pago_meses_comprados_positivo", "pago", type_="check")
    op.drop_constraint("ck_pago_snapshot_completo_o_ausente", "pago", type_="check")
    op.drop_column("pago", "monto_base")
    op.drop_column("pago", "meses_comprados")
    op.drop_column("pago", "tarifa_mensual_aplicada")
