"""verificar el correo antes de representar (issue #790)

Agrega `usuario.correo_verificado` y el outbox durable que entrega el enlace
de verificación.

Trato de las cuentas que YA existen: quedan VERIFICADAS.

No es una concesión, es la única lectura defendible del estado. Cuando estas
cuentas se crearon no existía ninguna verificación de correo en el sistema, así
que "sin verificar" no describe nada que haya pasado con ellas: describe un
control que todavía no existía. Marcarlas sin verificar dejaría a los
representantes reales del club sin poder vincular a sus propios hijos, y un
despliegue que desactiva en silencio a los tutores de verdad hace más daño que
el hueco que se está cerrando.

Tampoco reabre nada. Lo que el issue #790 cierra es la composición entre la
autoinscripción PÚBLICA -- que entrega credenciales a quien nadie verificó -- y
la vinculación por cédula. Desde esta revisión ninguna cuenta nueva nace
verificada: el `server_default` queda en `false` (ver abajo) y el alta pública
encola su verificación como cualquier otra.

El `server_default` de la columna se mueve de `true` a `false` DENTRO de esta
misma migración, y esa asimetría es deliberada:
  * `true` durante el `ADD COLUMN` es lo que backfillea a las cuentas
    existentes en una sola pasada, sin un `UPDATE` aparte que pudiera quedar a
    medias sobre una tabla grande.
  * `false` después es PERMANENTE, al revés que `persona.activo` (revisión
    `f2a8c31d9b64`), que retira su default por completo. Acá el default del
    esquema no es andamiaje: es la compuerta que hace que una fila insertada
    por fuera del ORM caiga del lado no verificado. Nacer verificado por
    omisión sería exactamente el defecto que esta columna viene a cerrar.
"""

from alembic import op
import sqlalchemy as sa


revision = "a790verifcorreo"
down_revision = "e762rolunico"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # `server_default=true` backfillea a toda cuenta preexistente (ver la nota
    # del encabezado sobre por qué quedan verificadas).
    op.add_column(
        "usuario",
        sa.Column(
            "correo_verificado",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )
    # ...y a partir de acá, toda fila nueva nace sin verificar.
    op.alter_column("usuario", "correo_verificado", server_default=sa.text("false"))

    op.create_table(
        "verificacion_correo_outbox",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("usuario_id", sa.Integer(), sa.ForeignKey("usuario.id"), nullable=False),
        sa.Column("status", sa.String(12), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("claimed_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True)),
        sa.Column("last_error_redacted", sa.String(500)),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_verificacion_correo_outbox_pending_next",
        "verificacion_correo_outbox",
        ["status", "next_attempt_at"],
    )
    op.create_index(
        "ix_verificacion_correo_outbox_usuario_id",
        "verificacion_correo_outbox",
        ["usuario_id"],
    )
    # Una sola verificación activa por cuenta: es lo que permite que un
    # reenvío reuse la fila en vuelo en vez de acumular trabajo duplicado.
    op.create_index(
        "uq_verificacion_correo_outbox_usuario_activo",
        "verificacion_correo_outbox",
        ["usuario_id"],
        unique=True,
        postgresql_where=sa.text("status IN ('PENDIENTE', 'ENVIANDO')"),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_verificacion_correo_outbox_usuario_activo",
        table_name="verificacion_correo_outbox",
    )
    op.drop_index(
        "ix_verificacion_correo_outbox_usuario_id",
        table_name="verificacion_correo_outbox",
    )
    op.drop_index(
        "ix_verificacion_correo_outbox_pending_next",
        table_name="verificacion_correo_outbox",
    )
    op.drop_table("verificacion_correo_outbox")
    op.drop_column("usuario", "correo_verificado")
