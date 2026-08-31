"""auditoria de rechazo permanente de correo en notificacion (issue #837)

Revision ID: b8e5smtp837
Revises: f1a7ident828
Create Date: 2026-08-30 00:00:00.000000

Agrega `notificacion.last_error_redacted`: el rastro durable de que el correo
de una alerta fue rechazado DEFINITIVAMENTE por el proveedor (un 5xx por
destinatario) mientras la notificación in-app sí se creó.

Por qué una columna en `notificacion` y no una tabla nueva:

  - La ruta de alertas nocturnas (`alertas_tareas.py`) no tiene outbox. Las
    tres colas durables del club (`recuperacion_outbox`,
    `verificacion_correo_outbox`, `enrollment_notificacion_outbox`) cubren
    otros flujos; sumar una cuarta para las alertas es un refactor de
    dominio, no la auditoría que este issue necesita.
  - La fila de `notificacion` ya identifica el episodio entero: a quién
    (`persona_id`), de qué (`tipo`) y sobre qué pago
    (`entidad_relacionada_id`). Desde el issue #837 esa fila existe incluso
    cuando el correo fue rechazado, así que es el lugar donde el dato ya
    tiene con qué juntarse.
  - El nombre repite el de las tres tablas de outbox a propósito: el
    contenido es el mismo tipo de dato (el error del proveedor ya redactado
    por `notificaciones_servicio._redactar_detalle_sensible`, nunca crudo:
    un mensaje SMTP puede repetir el usuario o la contraseña del relay).

Expand-only y compatible hacia atrás: columna NULLABLE, sin `server_default`,
sin backfill ni ningún otro DML. El código anterior a esta revisión no
menciona la columna y sigue funcionando contra el esquema nuevo, así que
desplegar la migración antes que la aplicación es seguro. NULL significa "no
hubo rechazo permanente", que es lo que corresponde para todas las filas
existentes.

El `downgrade()` elimina la columna; se pierde la auditoría de los rechazos
registrados, no ninguna notificación.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b8e5smtp837'
down_revision: Union[str, Sequence[str], None] = 'f1a7ident828'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'notificacion',
        sa.Column('last_error_redacted', sa.String(length=500), nullable=True),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('notificacion', 'last_error_redacted')
