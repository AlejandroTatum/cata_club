"""Tests de la migración que retira el catálogo sembrado de
`categoria_horario` (#1362): una instalación nueva termina con la tabla
vacía; producción -- donde `horario_entrenamiento` ya referencia alguna de
las 5 categorías -- pasa intacta.

Mismo patrón que `test_migracion_drop_franja_horaria.py`: el arnés corre la
migración real sobre datos preexistentes, no una función en aislamiento."""
import importlib.util
from pathlib import Path

MIGRACION_PATH = (
    Path(__file__).parents[1] / "alembic" / "versions"
    / "5b09fde49560_retirar_catalogo_sembrado_de_categoria_.py"
)
REVISION = "5b09fde49560"
REVISION_ANTERIOR = "p1146recses"


def _cargar_modulo_migracion():
    spec = importlib.util.spec_from_file_location("migracion_catalogo_vacio", MIGRACION_PATH)
    modulo = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(modulo)
    return modulo


def test_migracion_encadena_con_el_head_anterior():
    modulo = _cargar_modulo_migracion()

    assert modulo.revision == REVISION
    assert modulo.down_revision == REVISION_ANTERIOR


def test_upgrade_llama_a_retirar_catalogo_sembrado(monkeypatch):
    """Estructural, sin Postgres: `upgrade()` delega en la función pura
    `_retirar_catalogo_sembrado` sobre la conexión de `op.get_bind()` -- no
    duplica la lógica de borrado inline."""
    modulo = _cargar_modulo_migracion()
    llamadas = []
    monkeypatch.setattr(modulo, "_retirar_catalogo_sembrado", llamadas.append)
    monkeypatch.setattr(modulo.op, "get_bind", lambda: "conexion-fake")

    modulo.upgrade()

    assert llamadas == ["conexion-fake"]


def _codigos_de_categoria_horario(arnes) -> set[str]:
    return {
        fila[0]
        for fila in arnes.consultar("SELECT codigo FROM categoria_horario")
    }


def _dias_de_categoria_horario(arnes) -> set[str]:
    return {
        fila[0]
        for fila in arnes.consultar("SELECT categoria_codigo FROM categoria_horario_dia")
    }


def _sembrar_horario(arnes, categoria: str, dia_semana: str = "LUNES") -> None:
    arnes.ejecutar(
        "INSERT INTO horario_entrenamiento (categoria, dia_semana, hora_inicio, hora_fin) "
        "VALUES (:categoria, :dia_semana ::diasemana, '15:00', '16:00')",
        categoria=categoria,
        dia_semana=dia_semana,
    )


def test_upgrade_sobre_base_nueva_deja_categoria_horario_vacia(arnes_migracion):
    """Instalación nueva: ningún `horario_entrenamiento` referencia ninguna
    de las 5 categorías sembradas -> las 5 salen, con sus días."""
    arnes_migracion.preparar(REVISION_ANTERIOR)

    arnes_migracion.migrar(REVISION)

    assert _codigos_de_categoria_horario(arnes_migracion) == set()
    assert _dias_de_categoria_horario(arnes_migracion) == set()
    assert arnes_migracion.revision_actual() == REVISION


def test_upgrade_conserva_una_categoria_sembrada_en_uso(arnes_migracion):
    """Producción: FORMATIVO tiene un horario real -> se queda (con sus
    días); las otras 4, sin ningún horario, salen igual que en base nueva."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_horario(arnes_migracion, "FORMATIVO")

    arnes_migracion.migrar(REVISION)

    assert _codigos_de_categoria_horario(arnes_migracion) == {"FORMATIVO"}
    assert _dias_de_categoria_horario(arnes_migracion) == {"FORMATIVO"}
    assert arnes_migracion.revision_actual() == REVISION


def test_upgrade_no_toca_una_categoria_no_sembrada(arnes_migracion):
    """Una categoría creada por el admin (no una de las 5 conocidas) nunca
    entra al loop de la migración, esté o no en uso."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    arnes_migracion.ejecutar(
        "INSERT INTO categoria_horario (codigo, label, hora_inicio, hora_fin) "
        "VALUES ('RECREATIVO', 'Recreativo', '10:00', '11:00')"
    )
    arnes_migracion.ejecutar(
        "INSERT INTO categoria_horario_dia (categoria_codigo, dia_semana) "
        "VALUES ('RECREATIVO', 'SABADO' ::diasemana)"
    )

    arnes_migracion.migrar(REVISION)

    assert "RECREATIVO" in _codigos_de_categoria_horario(arnes_migracion)
    assert "RECREATIVO" in _dias_de_categoria_horario(arnes_migracion)


def test_downgrade_es_un_no_op_no_resiembra_el_catalogo(arnes_migracion):
    """El catálogo por defecto deja de ser dato de producto: bajar la
    revisión no debe resembrar las categorías retiradas."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    arnes_migracion.migrar(REVISION)
    assert _codigos_de_categoria_horario(arnes_migracion) == set()

    arnes_migracion.revertir(REVISION_ANTERIOR)

    assert _codigos_de_categoria_horario(arnes_migracion) == set()
    assert arnes_migracion.revision_actual() == REVISION_ANTERIOR
