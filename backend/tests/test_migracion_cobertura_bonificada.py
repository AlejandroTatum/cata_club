"""Pruebas de la migración `b4736d8ac9ee` (crear `cobertura_bonificada`,
issue #400 slice 4d) mediante el arnés de migraciones.

El riesgo propio de ESTA migración no es un `ALTER TYPE` ni una columna
nueva sobre una tabla existente (como `d2a7e5c91b34`): es la restricción de
EXCLUSIÓN (`ex_cobertura_bonificada_periodo_no_solapa`). Que
`test_no_hay_drift_entre_modelos_y_migraciones` compare bien contra
`Base.metadata` no prueba que Postgres la haga cumplir de verdad sobre un
INSERT real -- para eso hace falta ejercitarla con SQL crudo, igual que
`test_migracion_asignacion_descuento.py` hace con su índice único parcial.

Se verifica, sobre datos preexistentes, que:
  1. La tabla no existía antes (ancla).
  2. `persona`, `membresia` y `asignacion_descuento` que ya vivían en la
     base sobreviven intactos.
  3. La restricción de exclusión rechaza en Postgres una segunda fila cuyo
     período se solapa con uno ya otorgado para la MISMA membresía, pero
     permite un período que NO se solapa.
  4. `revertir()` borra la tabla sin tocar las demás.
"""
import pytest
from sqlalchemy.exc import IntegrityError

from tests.arnes_migraciones import ArnesMigracion


REVISION_ANTERIOR = "f3a9c8e2b615"
REVISION_COBERTURA = "b4736d8ac9ee"

SQL_TABLA = (
    "SELECT table_name FROM information_schema.tables "
    "WHERE table_name = 'cobertura_bonificada'"
)


def _sembrar_grafo(arnes: ArnesMigracion) -> None:
    """SQL crudo, nunca el ORM: el ORM describe el esquema de HOY, no el de
    la revisión bajo prueba. Persona (1) + TipoMembresia (1) + Membresia (1,
    de la persona 1) + Descuento (1) + AsignacionDescuento (1, vigente para
    la persona 1) -- el grafo mínimo que `cobertura_bonificada` referencia
    por FK."""
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
        "INSERT INTO tipo_membresia (id, categoria, precio, modalidad) "
        "VALUES (1, 'Adultos', 35.00, 'MENSUAL')"
    )
    arnes.ejecutar(
        """
        INSERT INTO membresia (id, estado, monto_aplicado, fecha_activacion,
                               es_gratuidad_familiar, persona_id, tipo_membresia_id)
        VALUES (1, 'INACTIVA', 35.00, TIMESTAMPTZ '2026-07-01 00:00:00+00',
                FALSE, 1, 1)
        """
    )
    arnes.ejecutar(
        "INSERT INTO descuento (id, nombre, porcentaje, activo) "
        "VALUES (1, 'Becado', 100.00, TRUE)"
    )
    arnes.ejecutar(
        """
        INSERT INTO asignacion_descuento
            (id, persona_id, descuento_id, asignado_por_persona_id, asignado_en)
        VALUES (1, 1, 1, 2, now())
        """
    )


def _insertar_cobertura(arnes: ArnesMigracion, fecha_inicio: str, fecha_fin: str) -> None:
    arnes.ejecutar(
        """
        INSERT INTO cobertura_bonificada
            (membresia_id, persona_id, asignacion_descuento_id,
             tarifa_mensual_aplicada, meses_comprados,
             descuento_valor_aplicado, descuento_porcentaje_aplicado,
             fecha_inicio, fecha_fin, otorgada_por_persona_id, otorgada_en)
        VALUES (1, 1, 1, 35.00, 1, 35.00, 100.00,
                CAST(:fecha_inicio AS DATE), CAST(:fecha_fin AS DATE), 1, now())
        """,
        fecha_inicio=fecha_inicio,
        fecha_fin=fecha_fin,
    )


def test_la_tabla_no_existia_antes(arnes_migracion):
    """Ancla: si esto dejara de fallar sin la migración, habrían llegado al
    esquema por otra vía (drift)."""
    arnes_migracion.preparar(REVISION_ANTERIOR)

    assert arnes_migracion.consultar(SQL_TABLA) == []


def test_grafo_preexistente_sobrevive_la_migracion(arnes_migracion):
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_grafo(arnes_migracion)

    arnes_migracion.migrar(REVISION_COBERTURA)

    assert arnes_migracion.consultar(
        "SELECT id, cedula FROM persona ORDER BY id"
    ) == [(1, "1710034065"), (2, "1710034073")]
    assert arnes_migracion.consultar(
        "SELECT id, persona_id, estado FROM membresia"
    ) == [(1, 1, "INACTIVA")]
    assert arnes_migracion.consultar(
        "SELECT id, persona_id, descuento_id FROM asignacion_descuento"
    ) == [(1, 1, 1)]
    assert arnes_migracion.consultar(SQL_TABLA) == [("cobertura_bonificada",)]
    assert arnes_migracion.revision_actual() == REVISION_COBERTURA


def test_la_exclusion_rechaza_un_periodo_solapado_para_la_misma_membresia(
    arnes_migracion,
):
    """El chequeo real: Postgres, no el ORM, debe rechazar una segunda fila
    cuyo rango se solapa con uno ya otorgado para la membresía 1."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_grafo(arnes_migracion)
    arnes_migracion.migrar(REVISION_COBERTURA)

    _insertar_cobertura(arnes_migracion, "2026-07-01", "2026-08-01")

    with pytest.raises(
        IntegrityError, match="ex_cobertura_bonificada_periodo_no_solapa"
    ):
        _insertar_cobertura(arnes_migracion, "2026-07-15", "2026-09-01")

    assert arnes_migracion.consultar(
        "SELECT count(*) FROM cobertura_bonificada WHERE membresia_id = 1"
    ) == [(1,)]


def test_la_exclusion_permite_un_periodo_que_no_se_solapa(arnes_migracion):
    """Contraparte positiva: dos períodos consecutivos (fin exclusivo de uno
    == inicio del siguiente, semántica `'[)'`) deben convivir sin problema."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_grafo(arnes_migracion)
    arnes_migracion.migrar(REVISION_COBERTURA)

    _insertar_cobertura(arnes_migracion, "2026-07-01", "2026-08-01")
    _insertar_cobertura(arnes_migracion, "2026-08-01", "2026-09-01")

    assert arnes_migracion.consultar(
        "SELECT count(*) FROM cobertura_bonificada WHERE membresia_id = 1"
    ) == [(2,)]


def test_el_downgrade_borra_la_tabla_sin_tocar_el_resto_del_grafo(arnes_migracion):
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_grafo(arnes_migracion)
    arnes_migracion.migrar(REVISION_COBERTURA)
    _insertar_cobertura(arnes_migracion, "2026-07-01", "2026-08-01")

    arnes_migracion.revertir(REVISION_ANTERIOR)

    assert arnes_migracion.consultar(SQL_TABLA) == []
    assert arnes_migracion.consultar(
        "SELECT id, cedula FROM persona ORDER BY id"
    ) == [(1, "1710034065"), (2, "1710034073")]
    assert arnes_migracion.consultar(
        "SELECT id, persona_id, descuento_id FROM asignacion_descuento"
    ) == [(1, 1, 1)]
