"""Migración `y1tarifaperiodicidad`: `tipo_membresia.periodicidad` (tarifas
semanales y diarias), probada con el arnés sobre una base que ya tiene filas."""
import pytest
from sqlalchemy.exc import IntegrityError

REVISION_ANTERIOR = "x1665diasinclase"
REVISION_NUEVA = "y1tarifaperiodicidad"

INSERT_TARIFA_ANTIGUA = (
    "INSERT INTO tipo_membresia (id, categoria, precio, modalidad) "
    "VALUES (1, 'Adulto', 25.00, 'MENSUAL')"
)


def _insertar_con_periodicidad(arnes, id_: int, valor: str) -> None:
    arnes.ejecutar(
        "INSERT INTO tipo_membresia (id, categoria, precio, modalidad, periodicidad) "
        f"VALUES ({id_}, 'T{id_}', 5.00, 'MENSUAL', '{valor}')"
    )


def test_las_tarifas_existentes_quedan_mensuales(arnes_migracion):
    arnes_migracion.preparar(REVISION_ANTERIOR)
    arnes_migracion.ejecutar(INSERT_TARIFA_ANTIGUA)

    arnes_migracion.migrar(REVISION_NUEVA)

    assert arnes_migracion.revision_actual() == REVISION_NUEVA
    assert arnes_migracion.consultar(
        "SELECT id, periodicidad FROM tipo_membresia"
    ) == [(1, "MENSUAL")]


def test_un_insert_sin_periodicidad_sigue_siendo_mensual(arnes_migracion):
    arnes_migracion.preparar(REVISION_NUEVA)
    arnes_migracion.ejecutar(INSERT_TARIFA_ANTIGUA)

    assert arnes_migracion.consultar(
        "SELECT periodicidad FROM tipo_membresia"
    ) == [("MENSUAL",)]


@pytest.mark.parametrize("valor", ["SEMANAL", "DIARIA"])
def test_la_base_acepta_semanal_y_diaria(arnes_migracion, valor):
    arnes_migracion.preparar(REVISION_NUEVA)
    _insertar_con_periodicidad(arnes_migracion, 2, valor)

    assert arnes_migracion.consultar(
        "SELECT periodicidad FROM tipo_membresia WHERE id = 2"
    ) == [(valor,)]


def test_la_base_rechaza_una_periodicidad_invalida(arnes_migracion):
    arnes_migracion.preparar(REVISION_NUEVA)

    with pytest.raises(IntegrityError, match="ck_tipo_membresia_periodicidad"):
        _insertar_con_periodicidad(arnes_migracion, 2, "ANUAL")


def test_downgrade_quita_la_columna_y_conserva_las_tarifas(arnes_migracion):
    arnes_migracion.preparar(REVISION_NUEVA)
    arnes_migracion.ejecutar(INSERT_TARIFA_ANTIGUA)

    arnes_migracion.revertir(REVISION_ANTERIOR)

    assert arnes_migracion.revision_actual() == REVISION_ANTERIOR
    assert arnes_migracion.consultar("SELECT count(*) FROM tipo_membresia") == [(1,)]
    assert arnes_migracion.consultar(
        "SELECT count(*) FROM information_schema.columns "
        "WHERE table_name = 'tipo_membresia' AND column_name = 'periodicidad'"
    ) == [(0,)]
