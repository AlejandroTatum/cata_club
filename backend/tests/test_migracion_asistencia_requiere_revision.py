"""Migración `u2s2reviasist` (ENT-07): `asistencia.requiere_revision`.

Las filas que ya existían arrancan en FALSE (nadie las marcó), y el downgrade
retira la columna sin tocar las asistencias.
"""
from tests.arnes_migraciones import ArnesMigracion

REVISION_ANTERIOR = "t1314metricas"
REVISION_NUEVA = "u2s2reviasist"


def _sembrar_asistencia(arnes: ArnesMigracion) -> None:
    arnes.ejecutar(
        """
        INSERT INTO persona (id, nombres, apellidos, cedula, fecha_nacimiento,
                             telefono, fecha_registro, activo)
        VALUES (1, 'Ana', 'Torres', '1710034065', DATE '2010-01-01',
                '0991234567', TIMESTAMPTZ '2024-03-01 12:00:00+00', TRUE)
        """
    )
    arnes.ejecutar(
        "INSERT INTO categoria_horario (codigo, label, hora_inicio, hora_fin, visible_en_landing) "
        "VALUES ('JUVENIL', 'Juvenil', TIME '15:00', TIME '16:00', TRUE)"
    )
    arnes.ejecutar(
        "INSERT INTO horario_entrenamiento (id, categoria, dia_semana, hora_inicio, hora_fin) "
        "VALUES (1, 'JUVENIL', 'LUNES', TIME '15:00', TIME '16:00')"
    )
    arnes.ejecutar(
        "INSERT INTO asistencia (id, fecha_entrenamiento, fecha_registro, estado, persona_id, horario_id) "
        "VALUES (1, DATE '2026-09-28', TIMESTAMPTZ '2026-09-28 20:00:00+00', 'PRESENTE', 1, 1)"
    )


def test_la_columna_no_existe_antes_de_la_migracion(arnes_migracion):
    arnes_migracion.preparar(REVISION_ANTERIOR)

    assert arnes_migracion.tipo_de_columna("asistencia", "requiere_revision") is None


def test_upgrade_agrega_la_columna_en_false_sin_perder_asistencias(arnes_migracion):
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_asistencia(arnes_migracion)

    arnes_migracion.migrar(REVISION_NUEVA)

    assert arnes_migracion.revision_actual() == REVISION_NUEVA
    assert arnes_migracion.tipo_de_columna("asistencia", "requiere_revision") == "boolean"
    assert arnes_migracion.consultar("SELECT id, requiere_revision FROM asistencia") == [(1, False)]


def test_downgrade_retira_la_columna_y_conserva_las_asistencias(arnes_migracion):
    arnes_migracion.preparar(REVISION_NUEVA)
    _sembrar_asistencia(arnes_migracion)

    arnes_migracion.revertir(REVISION_ANTERIOR)

    assert arnes_migracion.tipo_de_columna("asistencia", "requiere_revision") is None
    assert arnes_migracion.consultar("SELECT id FROM asistencia") == [(1,)]
