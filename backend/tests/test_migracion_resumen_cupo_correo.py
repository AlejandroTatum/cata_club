"""Pruebas de la migración `o1145cupomail` (agrega
`RESUMEN_CUPO_CORREO_ADMIN` al enum PostgreSQL `tiponotificacion`) mediante el
arnés de migraciones.

Mismo riesgo y mismo arnés que
`test_migracion_tiponotificacion_nueva_inscripcion.py`: el job
`migraciones-desde-cero` de CI y la fixture `esquema_migrado` solo demuestran
que `alembic upgrade head` corre contra una base VACÍA. Un
`ALTER TYPE ... ADD VALUE` es justamente la operación cuyo riesgo real está en
la base que YA tiene filas: si se resolviera recreando el tipo (`RENAME TO
..._old` + `CREATE TYPE` + `ALTER COLUMN ... USING`) en lugar de con
`ADD VALUE`, un error de reescritura perdería o corrompería notificaciones
existentes sin que ninguna prueba de base vacía lo notara.

Se verifica, sobre datos preexistentes, que:
  1. El label NO existía antes de la migración (ancla: sin ella la prueba
     pasaría en verde aunque alguien borrara la migración y dejara el enum de
     Python intacto).
  2. Las notificaciones que ya vivían en la base sobreviven a la migración.
  3. El label nuevo es realmente usable después de migrar (INSERT real).
  4. Sobre la revisión anterior el mismo INSERT falla con el error exacto que
     vería producción (contraprueba).
"""
import pytest
from sqlalchemy.exc import DataError

from tests.arnes_migraciones import ArnesMigracion


REVISION_ANTERIOR = "n1144correolim"
REVISION_CUPO_CORREO = "o1145cupomail"

SQL_LABELS = (
    "SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid "
    "WHERE t.typname = 'tiponotificacion' ORDER BY e.enumsortorder"
)

INSERT_NOTIFICACION_CUPO = """
    INSERT INTO notificacion (id, tipo, mensaje, leida, fecha_creacion,
                              entidad_relacionada_id, persona_id)
    VALUES (3, 'RESUMEN_CUPO_CORREO_ADMIN', 'Tope diario de correos alcanzado',
            false, TIMESTAMPTZ '2026-09-16 12:00:00+00', NULL, 1)
"""


def _sembrar_notificaciones(arnes: ArnesMigracion) -> None:
    """Siembra una persona y dos notificaciones con SQL crudo (nunca vía el
    ORM: el ORM describe el esquema de HOY, no el de la revisión bajo
    prueba). Representan las filas que ya viven en producción."""
    arnes.ejecutar(
        """
        INSERT INTO persona (id, nombres, apellidos, cedula, fecha_nacimiento,
                             telefono, fecha_registro, activo)
        VALUES (1, 'Ana', 'Torres', '1710034065', DATE '1990-01-01',
                '0991234567', TIMESTAMPTZ '2024-03-01 12:00:00+00', TRUE)
        """
    )
    arnes.ejecutar(
        """
        INSERT INTO notificacion (id, tipo, mensaje, leida, fecha_creacion,
                                  entidad_relacionada_id, persona_id)
        VALUES
          (1, 'PAGO_APROBADO', 'Tu pago fue aprobado', false,
           TIMESTAMPTZ '2024-03-02 12:00:00+00', 7, 1),
          (2, 'RESUMEN_MORA_ADMIN', 'Mora del 03/03/2024: 1 miembro', true,
           TIMESTAMPTZ '2024-03-03 12:00:00+00', NULL, 1)
        """
    )


def test_label_cupo_correo_no_existia_antes_de_la_migracion(arnes_migracion):
    """Ancla del defecto: en la revisión anterior el enum de PostgreSQL no
    tiene `RESUMEN_CUPO_CORREO_ADMIN`, aunque `TipoNotificacion` sí lo
    declara. Ese desfase es el `DataError` que el aviso a los administradores
    comía en silencio (best-effort) al insertar la notificación."""
    arnes_migracion.preparar(REVISION_ANTERIOR)

    labels = [fila[0] for fila in arnes_migracion.consultar(SQL_LABELS)]
    assert "RESUMEN_CUPO_CORREO_ADMIN" not in labels
    # El label hermano ya existía: la migración es ADITIVA, no reemplaza el
    # resumen de mora.
    assert "RESUMEN_MORA_ADMIN" in labels


def test_migracion_conserva_las_notificaciones_preexistentes(arnes_migracion):
    """El caso que `migraciones-desde-cero` no puede detectar: el `ALTER TYPE`
    corre sobre filas que ya existían y esas filas deben sobrevivir intactas
    (mismo tipo, mismo mensaje, mismo estado de lectura)."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_notificaciones(arnes_migracion)

    arnes_migracion.migrar(REVISION_CUPO_CORREO)

    assert arnes_migracion.consultar(
        "SELECT id, tipo::text, mensaje, leida FROM notificacion ORDER BY id"
    ) == [
        (1, "PAGO_APROBADO", "Tu pago fue aprobado", False),
        (2, "RESUMEN_MORA_ADMIN", "Mora del 03/03/2024: 1 miembro", True),
    ]
    assert arnes_migracion.revision_actual() == REVISION_CUPO_CORREO


def test_migracion_habilita_el_label_para_insertar(arnes_migracion):
    """Después de migrar, el label debe ser usable de verdad: un INSERT con
    `RESUMEN_CUPO_CORREO_ADMIN` convive con las notificaciones preexistentes."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_notificaciones(arnes_migracion)
    arnes_migracion.migrar(REVISION_CUPO_CORREO)

    arnes_migracion.ejecutar(INSERT_NOTIFICACION_CUPO)

    assert arnes_migracion.consultar(
        "SELECT tipo::text FROM notificacion ORDER BY id"
    ) == [
        ("PAGO_APROBADO",),
        ("RESUMEN_MORA_ADMIN",),
        ("RESUMEN_CUPO_CORREO_ADMIN",),
    ]


def test_sin_la_migracion_el_insert_del_label_falla(arnes_migracion):
    """Contraprueba: sobre la revisión anterior el mismo INSERT explota con
    el error exacto que veía producción. Si esta prueba dejara de fallar,
    querría decir que el ancla de la migración ya no mide nada."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_notificaciones(arnes_migracion)

    with pytest.raises(DataError, match="invalid input value for enum tiponotificacion"):
        arnes_migracion.ejecutar(INSERT_NOTIFICACION_CUPO)
