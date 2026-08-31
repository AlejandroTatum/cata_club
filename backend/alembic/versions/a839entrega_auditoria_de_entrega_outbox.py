"""auditoria del paso de entrega en los outbox de correo (issue #839)

Revision ID: a839entrega
Revises: b8e5smtp837
Create Date: 2026-08-30 00:00:00.000000

Agrega a `recuperacion_outbox` y a `verificacion_correo_outbox` el rastro
durable del PASO DE ENTREGA: cuántas veces se llegó a hablar con SMTP por esa
fila, cuándo empezó la última de esas entregas y cuándo se registró su
desenlace.

Por qué hacen falta tres columnas y no alcanza con las que ya había:

  - `attempts` cuenta RECLAMOS del outbox y solo lo incrementa
    `claim_pending`. La redelivery del broker (`task_acks_late=True` y
    `task_reject_on_worker_lost=True` en `celery_app.py`) republica el mismo
    mensaje `procesar_*(evento_id)` sin pasar por ningún reclamo, así que un
    worker que muere entregando reenviaba sin que ningún contador se moviera
    -- y `AGOTADO` quedaba inalcanzable. `entregas_intentadas` es el contador
    que sí ve ese camino, y es SEPARADO a propósito: `attempts` gobierna el
    backoff y el `AGOTADO` terminal, y reusarlo habría movido esa política.
  - `sent_at` se escribe DESPUÉS del envío, dentro del mismo commit que puede
    no llegar a existir. `entrega_iniciada_at` se commitea ANTES de
    `sendmail`: es lo único que sobrevive a la muerte del worker en la
    ventana entre el envío y su registro.
  - `entrega_resuelta_at` distingue "falló y ya lo sabemos" de "llegó al
    envío y nunca supimos qué pasó". Sin ella, un fallo normal sería
    indistinguible de la ventana peligrosa.

Nada de esto convierte la entrega en exactly-once: SMTP y Postgres no
comparten transacción y no hay commit de dos fases entre ellos. El contrato
del club es at-least-once, y estas columnas lo ACOTAN y lo hacen
diagnosticable. Ver `docs/operations/entrega-de-correo.md`.

Expand-only y compatible hacia atrás: las tres columnas son NULLABLE, sin
`server_default`, sin backfill ni ningún otro DML -- mismo criterio que
`b8e5smtp837`. El código anterior a esta revisión no las menciona y sigue
funcionando contra el esquema nuevo, así que desplegar la migración antes que
la aplicación es seguro. Para las filas que ya viven en la base, NULL
significa "nunca se llegó al paso de envío", que es lo que corresponde: son
filas de antes de que existiera la medición, y el código las lee como cero.

El `downgrade()` elimina las seis columnas; se pierde la auditoría de las
entregas registradas, no ninguna fila de outbox ni ningún correo pendiente.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a839entrega'
down_revision: Union[str, Sequence[str], None] = 'b8e5smtp837'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TABLAS = ('recuperacion_outbox', 'verificacion_correo_outbox')

COLUMNAS = (
    ('entregas_intentadas', sa.Integer()),
    ('entrega_iniciada_at', sa.DateTime(timezone=True)),
    ('entrega_resuelta_at', sa.DateTime(timezone=True)),
)


def upgrade() -> None:
    """Upgrade schema."""
    for tabla in TABLAS:
        for nombre, tipo in COLUMNAS:
            op.add_column(tabla, sa.Column(nombre, tipo, nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    for tabla in TABLAS:
        for nombre, _ in COLUMNAS:
            op.drop_column(tabla, nombre)
