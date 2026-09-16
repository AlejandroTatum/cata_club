"""Tabla `contador_correo_diario` (guardarraíl del plan gratuito de Resend).

El envío SMTP de todo el sistema pasa por un solo chokepoint
(`ServicioNotificaciones.enviar_correo`), pero ese chokepoint corre en la API
y en el worker Celery a la vez. Un contador en memoria no se comparte entre
procesos, y ninguna tabla existente registra CADA correo: las tres colas de
outbox anotan la entrega de su propia fila, no los avisos de pago,
vencimiento y mora. Una fila por día UTC con `enviados` es el mínimo estado
compartido y atómico que puede frenar el envío cuando se agota el cupo
(100/día en el plan free).

`fecha` es la clave primaria natural: es también la fila que necesita el
`INSERT ... ON CONFLICT DO UPDATE ... RETURNING` con el que
`notificaciones_servicio` reserva el cupo sin carrera. `enviados` nace con
`server_default 0` para que el modelo ORM y el esquema real no difieran
(`test_drift_migraciones`); no es un valor que ningún camino de escritura
deje sin fijar.

Revision ID: n1144correolim
Revises: m1062supresion
Create Date: 2026-09-16

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "n1144correolim"
down_revision: Union[str, Sequence[str], None] = "m1062supresion"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "contador_correo_diario",
        sa.Column("fecha", sa.Date(), primary_key=True),
        sa.Column("enviados", sa.Integer(), nullable=False, server_default=sa.text("0")),
    )


def downgrade() -> None:
    op.drop_table("contador_correo_diario")
