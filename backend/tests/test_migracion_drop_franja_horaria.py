"""Tests de la migración que elimina `tipo_membresia.franja_horaria`.

El drift ORM/esquema ya lo cubre `test_drift_migraciones.py` de forma
genérica. Lo que se prueba acá es lo que ese test no puede ver: que la
columna desaparece sobre una base CON datos (no sólo sobre una vacía), y que
el `downgrade()` es real -- una migración cuya vuelta no corre deja al equipo
sin salida cuando algo sale mal en producción.
"""
import importlib.util
from pathlib import Path

import pytest

MIGRACION_PATH = (
    Path(__file__).parents[1] / "alembic" / "versions"
    / "d1a5f8c30b72_remover_franja_horaria_de_tipo_membresia.py"
)
REVISION = "d1a5f8c30b72"
REVISION_ANTERIOR = "faaadef2afa8"


def _cargar_modulo_migracion():
    spec = importlib.util.spec_from_file_location("migracion_drop_franja", MIGRACION_PATH)
    modulo = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(modulo)
    return modulo


def test_migracion_encadena_con_el_head_anterior():
    modulo = _cargar_modulo_migracion()

    assert modulo.revision == REVISION
    assert modulo.down_revision == REVISION_ANTERIOR


def _columnas_de_tipo_membresia(arnes) -> set[str]:
    return {
        fila[0]
        for fila in arnes.consultar(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'tipo_membresia'"
        )
    }


def _sembrar_plan(arnes) -> None:
    arnes.ejecutar(
        """
        INSERT INTO tipo_membresia (id, categoria, franja_horaria, precio, modalidad)
        VALUES (1, 'Mensual Adultos', '20:00-21:00', 40.00, 'MENSUAL')
        """
    )


def test_upgrade_elimina_la_columna_y_conserva_el_resto_del_plan(arnes_migracion):
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_plan(arnes_migracion)

    arnes_migracion.migrar(REVISION)

    assert "franja_horaria" not in _columnas_de_tipo_membresia(arnes_migracion)
    # El plan sigue siendo un plan: lo que se fue es el horario, no el precio.
    assert arnes_migracion.consultar(
        "SELECT id, categoria, precio, modalidad FROM tipo_membresia"
    ) == [(1, "Mensual Adultos", pytest.approx(40.00), "MENSUAL")]
    assert arnes_migracion.revision_actual() == REVISION


def test_downgrade_repone_la_columna_sin_inventar_un_horario(arnes_migracion):
    """La vuelta tiene que correr sobre filas existentes, y la columna es NOT
    NULL. Repone `''` a propósito: no quedó ninguna fuente de la cual derivar
    el texto original, y escribir un rango plausible sería reintroducir
    exactamente el dato inventado que la migración elimina."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_plan(arnes_migracion)
    arnes_migracion.migrar(REVISION)

    arnes_migracion.revertir(REVISION_ANTERIOR)

    assert "franja_horaria" in _columnas_de_tipo_membresia(arnes_migracion)
    assert arnes_migracion.consultar(
        "SELECT franja_horaria FROM tipo_membresia"
    ) == [("",)]
    assert arnes_migracion.revision_actual() == REVISION_ANTERIOR
