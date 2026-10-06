"""Migración `x1665diasinclase` (issue #1665): tabla `dia_sin_clase` y el label
`DIA_SIN_CLASE` del enum `tiponotificacion`, probadas con el arnés de
migraciones sobre una base que ya tiene filas."""
import pytest
from sqlalchemy.exc import DataError, IntegrityError

REVISION_ANTERIOR = "w1galeriaorden"
REVISION_NUEVA = "x1665diasinclase"

SQL_LABELS = (
    "SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid "
    "WHERE t.typname = 'tiponotificacion'"
)
SQL_TABLA = "SELECT to_regclass('public.dia_sin_clase') IS NOT NULL"
INSERT_DIA = """
    INSERT INTO dia_sin_clase (id, fecha_inicio, fecha_fin, motivo, fecha_creacion)
    VALUES (1, DATE '2029-07-04', DATE '2029-07-06', 'Feriado',
            TIMESTAMPTZ '2029-06-01 12:00:00+00')
"""


def _sembrar_notificacion(arnes) -> None:
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
        VALUES (1, 'PAGO_APROBADO', 'Tu pago fue aprobado', false,
                TIMESTAMPTZ '2024-03-02 12:00:00+00', 7, 1)
        """
    )


def test_upgrade_crea_la_tabla_y_el_label_sin_perder_filas(arnes_migracion):
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_notificacion(arnes_migracion)
    assert arnes_migracion.consultar(SQL_TABLA) == [(False,)]
    assert ("DIA_SIN_CLASE",) not in arnes_migracion.consultar(SQL_LABELS)

    arnes_migracion.migrar(REVISION_NUEVA)

    assert arnes_migracion.revision_actual() == REVISION_NUEVA
    assert arnes_migracion.consultar(SQL_TABLA) == [(True,)]
    assert ("DIA_SIN_CLASE",) in arnes_migracion.consultar(SQL_LABELS)
    assert arnes_migracion.consultar("SELECT id, tipo::text FROM notificacion") == [
        (1, "PAGO_APROBADO"),
    ]


def test_la_base_rechaza_un_rango_invertido(arnes_migracion):
    arnes_migracion.preparar(REVISION_NUEVA)
    arnes_migracion.ejecutar(INSERT_DIA)

    with pytest.raises(IntegrityError, match="ck_dia_sin_clase_rango"):
        arnes_migracion.ejecutar(
            "INSERT INTO dia_sin_clase (id, fecha_inicio, fecha_fin, motivo, fecha_creacion) "
            "VALUES (2, DATE '2029-07-06', DATE '2029-07-04', 'Invertido', now())"
        )


def test_sin_la_migracion_el_label_no_es_usable(arnes_migracion):
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_notificacion(arnes_migracion)

    with pytest.raises(DataError, match="invalid input value for enum tiponotificacion"):
        arnes_migracion.ejecutar(
            "INSERT INTO notificacion (id, tipo, mensaje, leida, fecha_creacion, persona_id) "
            "VALUES (2, 'DIA_SIN_CLASE', 'x', false, now(), 1)"
        )


def test_downgrade_quita_la_tabla_y_conserva_las_notificaciones(arnes_migracion):
    arnes_migracion.preparar(REVISION_NUEVA)
    _sembrar_notificacion(arnes_migracion)
    arnes_migracion.ejecutar(INSERT_DIA)

    arnes_migracion.revertir(REVISION_ANTERIOR)

    assert arnes_migracion.revision_actual() == REVISION_ANTERIOR
    assert arnes_migracion.consultar(SQL_TABLA) == [(False,)]
    assert arnes_migracion.consultar("SELECT count(*) FROM notificacion") == [(1,)]
