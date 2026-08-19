"""crear tabla asistencia_correccion

Revision ID: 300423734f25
Revises: f3a8c1d9e264
Create Date: 2026-08-18 00:00:00.000000

Issue #389, slice 2 de la cadena "asistencias: cierre auditable": agrega la
traza de auditoría de CORRECCIÓN que `SesionAsistencia` (migración
`f3a8c1d9e264`) ya dejaba anunciada como pendiente. `registrar_asistencia`
rechaza cualquier re-registro sin excepción de rol (slice 1) -- el
mecanismo previo de "corrección" (issue #262: rol ADMINISTRADOR + tope de
30 días, sin traza) fue eliminado por completo, no relocalizado. Esta
tabla es su reemplazo: un operativo DISTINTO
(`AsistenciaServicio.corregir_asistencia`, `PATCH
/asistencias/{id}/corregir`), append-only, una fila por evento de
corrección.

Guarda el valor ANTERIOR (`estado_anterior`, `justificativo_anterior`,
`estado_justificativo_anterior`); el NUEVO ya vive en la fila mutada de
`asistencia`. `motivo` es `NOT NULL` sin default: la corrección sin motivo
es lo que el issue pide impedir. Usa `String(500)`, no 255 -- mismo ancho
que `Notificacion.MENSAJE_MAX`: este proyecto ya tiene un incidente
documentado de un techo de 255 truncando texto libre.

Sin `ondelete="CASCADE"` en ninguna FK: `Asistencia` no se borra en ningún
camino del código, y `Persona` se da de baja LÓGICA (`Persona.activo`),
nunca se borra -- la cascada nunca dispararía (mismo criterio que
`SesionAsistencia`/`ConsultaFichaEmergencia`).

`estado_anterior` reutiliza el tipo Postgres `estadoasistencia` que ya
existe (`c8722261ea5b`, el mismo de `asistencia.estado`). La tabla se crea
con SQL crudo, no `op.create_table` con un `sa.Enum` inline, por el mismo
motivo documentado en `a4e7c2f9b1d8`: aun con `create_type=False`,
`op.create_table` reintenta `CREATE TYPE estadoasistencia` y falla con
`DuplicateObject` -- referenciar el tipo por nombre en SQL crudo lo evita.

Dos índices, igual que `ConsultaFichaEmergencia`: el compuesto
`(asistencia_id, corregido_en)` responde "historial de esta fila, más
reciente primero" y cubre la FK `asistencia_id`; el índice simple en
`corregido_por_id` cubre esa segunda FK (`test_indices_fk.py`).

Puramente ADITIVA: tabla nueva, ninguna fila existente se toca; nace
vacía. Downgrade: elimina los dos índices y la tabla, esquema idéntico al
previo, sin pérdida de datos.
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '300423734f25'
down_revision: Union[str, Sequence[str], None] = 'f3a8c1d9e264'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "CREATE TABLE asistencia_correccion ("
        "id SERIAL PRIMARY KEY, "
        "asistencia_id INTEGER NOT NULL REFERENCES asistencia (id), "
        "corregido_por_id INTEGER NOT NULL REFERENCES persona (id), "
        "corregido_en TIMESTAMPTZ NOT NULL, "
        "motivo VARCHAR(500) NOT NULL, "
        "estado_anterior estadoasistencia NOT NULL, "
        "justificativo_anterior VARCHAR(255), "
        "estado_justificativo_anterior BOOLEAN"
        ")"
    )
    op.create_index(
        "ix_asistencia_correccion_asistencia_corregido_en",
        "asistencia_correccion", ["asistencia_id", "corregido_en"], unique=False,
    )
    op.create_index(
        "ix_asistencia_correccion_corregido_por_id",
        "asistencia_correccion", ["corregido_por_id"], unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_asistencia_correccion_corregido_por_id", table_name="asistencia_correccion",
    )
    op.drop_index(
        "ix_asistencia_correccion_asistencia_corregido_en", table_name="asistencia_correccion",
    )
    op.drop_table("asistencia_correccion")
