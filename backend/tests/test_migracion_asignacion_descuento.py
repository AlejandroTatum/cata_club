"""Pruebas de la migración `f3a9c8e2b615` (crear `asignacion_descuento`,
issue #398) mediante el arnés de migraciones.

A diferencia de `d2a7e5c91b34`, acá no hay `ALTER TYPE` ni columna nueva
sobre una tabla existente -- el riesgo propio de ESTA migración es el
índice único PARCIAL: que `test_no_hay_drift_entre_modelos_y_migraciones`
compare bien contra `Base.metadata` no prueba que Postgres lo haga cumplir
de verdad sobre un INSERT real. Se verifica, sobre datos preexistentes,
que:
  1. La tabla no existía antes (ancla).
  2. `persona` y `descuento` que ya vivían en la base sobreviven intactos.
  3. El índice parcial `uq_asignacion_descuento_activa_por_persona`
     rechaza en Postgres una segunda asignación vigente para la misma
     persona, con SQL crudo (sin pasar por el ORM ni por ningún servicio).
  4. `revertir()` borra la tabla sin tocar `persona` ni `descuento`.
"""
import pytest
from sqlalchemy.exc import IntegrityError

from tests.arnes_migraciones import ArnesMigracion


REVISION_ANTERIOR = "d2a7e5c91b34"
REVISION_ASIGNACION = "f3a9c8e2b615"

SQL_TABLA = (
    "SELECT table_name FROM information_schema.tables "
    "WHERE table_name = 'asignacion_descuento'"
)


def _sembrar_persona_y_descuento(arnes: ArnesMigracion) -> None:
    """SQL crudo, nunca el ORM: el ORM describe el esquema de HOY, no el de
    la revisión bajo prueba."""
    arnes.ejecutar(
        """
        INSERT INTO persona (id, nombres, apellidos, cedula, fecha_nacimiento,
                             telefono, fecha_registro, activo)
        VALUES (1, 'Ana', 'Torres', '1710034065', DATE '1990-01-01',
                '0991234567', TIMESTAMPTZ '2024-03-01 12:00:00+00', TRUE),
               (2, 'Beto', 'Ruiz', '1710034073', DATE '1992-02-02',
                '0991234568', TIMESTAMPTZ '2024-03-01 12:00:00+00', TRUE)
        """
    )
    arnes.ejecutar(
        "INSERT INTO descuento (id, nombre, porcentaje, activo) "
        "VALUES (1, 'Becado', 50.00, TRUE)"
    )


def test_la_tabla_no_existia_antes(arnes_migracion):
    """Ancla: si esto dejara de fallar sin la migración, habrían llegado al
    esquema por otra vía (drift)."""
    arnes_migracion.preparar(REVISION_ANTERIOR)

    assert arnes_migracion.consultar(SQL_TABLA) == []


def test_persona_y_descuento_preexistentes_sobreviven_la_migracion(arnes_migracion):
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_persona_y_descuento(arnes_migracion)

    arnes_migracion.migrar(REVISION_ASIGNACION)

    assert arnes_migracion.consultar(
        "SELECT id, cedula FROM persona ORDER BY id"
    ) == [(1, "1710034065"), (2, "1710034073")]
    assert arnes_migracion.consultar(
        "SELECT id, nombre, activo FROM descuento"
    ) == [(1, "Becado", True)]
    assert arnes_migracion.consultar(SQL_TABLA) == [("asignacion_descuento",)]
    assert arnes_migracion.revision_actual() == REVISION_ASIGNACION


def test_el_indice_parcial_rechaza_dos_asignaciones_vigentes_para_la_misma_persona(
    arnes_migracion,
):
    """El chequeo real: Postgres, no el ORM, debe rechazar la segunda fila
    vigente para la persona 1."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_persona_y_descuento(arnes_migracion)
    arnes_migracion.migrar(REVISION_ASIGNACION)

    arnes_migracion.ejecutar(
        """
        INSERT INTO asignacion_descuento
            (persona_id, descuento_id, asignado_por_persona_id, asignado_en)
        VALUES (1, 1, 2, now())
        """
    )

    with pytest.raises(
        IntegrityError, match="uq_asignacion_descuento_activa_por_persona"
    ):
        arnes_migracion.ejecutar(
            """
            INSERT INTO asignacion_descuento
                (persona_id, descuento_id, asignado_por_persona_id, asignado_en)
            VALUES (1, 1, 2, now())
            """
        )

    assert arnes_migracion.consultar(
        "SELECT count(*) FROM asignacion_descuento WHERE persona_id = 1"
    ) == [(1,)]


def test_el_downgrade_borra_la_tabla_sin_tocar_persona_ni_descuento(arnes_migracion):
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_persona_y_descuento(arnes_migracion)
    arnes_migracion.migrar(REVISION_ASIGNACION)

    arnes_migracion.revertir(REVISION_ANTERIOR)

    assert arnes_migracion.consultar(SQL_TABLA) == []
    assert arnes_migracion.consultar(
        "SELECT id, cedula FROM persona ORDER BY id"
    ) == [(1, "1710034065"), (2, "1710034073")]
    assert arnes_migracion.consultar(
        "SELECT id, nombre FROM descuento"
    ) == [(1, "Becado")]
