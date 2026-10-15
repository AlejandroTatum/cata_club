"""Pruebas de la migración `z1795cumpleanosadmin` (agrega
`CUMPLEANOS_HOY_ADMIN` al enum PostgreSQL `tiponotificacion`) mediante el
arnés de migraciones. Mismo riesgo y patrón que
`test_migracion_resumen_cupo_correo.py`: un `ALTER TYPE ... ADD VALUE` debe
dejar intactas las notificaciones que ya viven en la base y habilitar el label
nuevo; sin la migración el INSERT falla con el error exacto de producción.
"""
import pytest
from sqlalchemy.exc import DataError

REVISION_ANTERIOR = "z1768pagoautodeclarado"
REVISION_CUMPLEANOS = "z1795cumpleanosadmin"

SQL_LABELS = (
    "SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid "
    "WHERE t.typname = 'tiponotificacion' ORDER BY e.enumsortorder"
)

INSERT_AVISO = """
    INSERT INTO notificacion (id, tipo, mensaje, leida, fecha_creacion,
                              entidad_relacionada_id, persona_id)
    VALUES (2, 'CUMPLEANOS_HOY_ADMIN', 'Cumpleaños de hoy', false,
            TIMESTAMPTZ '2026-10-15 12:00:00+00', NULL, 1)
"""


def _sembrar(arnes) -> None:
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
        VALUES (1, 'RESUMEN_MORA_ADMIN', 'Mora del 03/03/2024', true,
                TIMESTAMPTZ '2024-03-03 12:00:00+00', NULL, 1)
        """
    )


def test_label_no_existia_antes_de_la_migracion(arnes_migracion):
    arnes_migracion.preparar(REVISION_ANTERIOR)

    labels = [fila[0] for fila in arnes_migracion.consultar(SQL_LABELS)]
    assert "CUMPLEANOS_HOY_ADMIN" not in labels
    assert "RESUMEN_MORA_ADMIN" in labels


def test_migracion_conserva_filas_y_habilita_el_label(arnes_migracion):
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar(arnes_migracion)

    arnes_migracion.migrar(REVISION_CUMPLEANOS)
    arnes_migracion.ejecutar(INSERT_AVISO)

    assert arnes_migracion.consultar(
        "SELECT id, tipo::text, leida FROM notificacion ORDER BY id"
    ) == [(1, "RESUMEN_MORA_ADMIN", True), (2, "CUMPLEANOS_HOY_ADMIN", False)]
    assert arnes_migracion.revision_actual() == REVISION_CUMPLEANOS


def test_sin_la_migracion_el_insert_falla(arnes_migracion):
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar(arnes_migracion)

    with pytest.raises(DataError, match="invalid input value for enum tiponotificacion"):
        arnes_migracion.ejecutar(INSERT_AVISO)
