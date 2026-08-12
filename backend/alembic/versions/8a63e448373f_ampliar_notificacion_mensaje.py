"""ampliar notificacion.mensaje de varchar(255) a varchar(500)

Revision ID: 8a63e448373f
Revises: d5e6f7a8b9c1
Create Date: 2026-08-11 00:00:00.000000

Hallazgo en vivo, 2026-08-11: `notificacion.mensaje` era VARCHAR(255).
Rechazar un pago con una nota cercana al tope de 255 caracteres de
`PagoValidarDTO.motivo_rechazo` (o vincular un representado con un nombre
real largo) producía un mensaje derivado -- "Tu pago fue rechazado: <motivo>."
envuelto de nuevo para el representante, o el aviso de vinculación con el
nombre completo del chico -- que superaba esos 255 caracteres. El INSERT
tiraba un `DataError` sin capturar DESPUÉS de que la operación de negocio
(rechazo de pago, vinculación) ya estaba commiteada: el admin veía un 500
genérico y nadie recibía el aviso.

500 es el ancho real, no un número arbitrario: cubre el peor caso conocido
con los anchos de columna actuales (~488 caracteres, ver
`Notificacion.MENSAJE_MAX` en `app/dominio/modelos.py`) con margen. Los
mensajes que igual lo superen quedan cubiertos por el `@validates` de ese
modelo, que recorta con un aviso en el log en vez de tirar el `DataError`.
"""

from alembic import op
import sqlalchemy as sa

revision = "8a63e448373f"
down_revision = "d5e6f7a8b9c1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "notificacion", "mensaje",
        existing_type=sa.String(length=255),
        type_=sa.String(length=500),
        existing_nullable=False,
    )


def downgrade() -> None:
    # Un mensaje ya guardado entre 256 y 500 caracteres se trunca al volver
    # a 255 -- no hay forma de bajar el ancho sin perder datos si algo llegó
    # a usar el rango nuevo. Aceptado: downgrade es para revertir un deploy,
    # no una operación de rutina.
    op.execute("UPDATE notificacion SET mensaje = left(mensaje, 255) WHERE length(mensaje) > 255")
    op.alter_column(
        "notificacion", "mensaje",
        existing_type=sa.String(length=500),
        type_=sa.String(length=255),
        existing_nullable=False,
    )
