"""Tests del guard de dos capas de los seeds de desarrollo (issue #551):
allow-list de host primero e incondicional, AMBIENTE después, y el cableado
(`ejecutar_como_script`) de ambos seeds — sin ninguna base de datos viva."""
import importlib.util
from pathlib import Path

import pytest

from scripts.seed_guard import SeedNoPermitidoError, validar_seed_permitido

URL_HOST_PERMITIDO = "postgresql+psycopg://usuario:password@localhost:5432/cataclub_db"
URL_HOST_DESCONOCIDO = "postgresql+psycopg://usuario:password@prod-db.ejemplo.com:5432/cataclub_db"

_SCRIPTS = Path(__file__).parents[1] / "scripts"


def test_host_desconocido_rechaza_incluso_en_development():
    with pytest.raises(SeedNoPermitidoError):
        validar_seed_permitido("development", URL_HOST_DESCONOCIDO)


@pytest.mark.parametrize(
    "override", ["host=prod-db.ejemplo.com", "hostaddr=10.0.0.1", "dbname=produccion"]
)
def test_query_string_override_rechaza_aunque_netloc_este_permitido(override):
    with pytest.raises(SeedNoPermitidoError):
        validar_seed_permitido("development", f"{URL_HOST_PERMITIDO}?{override}")


def test_host_permitido_en_development_pasa():
    validar_seed_permitido("development", URL_HOST_PERMITIDO)


@pytest.mark.parametrize("ambiente", ["production", "staging"])
def test_host_permitido_fuera_de_development_rechaza(ambiente):
    with pytest.raises(SeedNoPermitidoError):
        validar_seed_permitido(ambiente, URL_HOST_PERMITIDO)


def _cargar_seed(nombre: str):
    spec = importlib.util.spec_from_file_location(nombre, _SCRIPTS / f"{nombre}.py")
    modulo = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(modulo)
    return modulo


@pytest.mark.parametrize("nombre", ["seed_dev_base", "seed_dev_bulk"])
def test_ejecutar_como_script_valida_antes_de_sembrar(nombre, monkeypatch, capsys):
    """Guard rechaza → exit 1 sin invocar `main()`; permite → `main()` corre."""
    modulo = _cargar_seed(nombre)

    def _rechazar(*args, **kwargs):
        raise SeedNoPermitidoError("host no permitido")

    monkeypatch.setattr(modulo, "validar_seed_permitido", _rechazar)
    monkeypatch.setattr(
        modulo, "main",
        lambda: pytest.fail("main() no debe ejecutarse con el seed denegado"),
    )
    with pytest.raises(SystemExit) as excinfo:
        modulo.ejecutar_como_script()
    assert excinfo.value.code == 1
    assert "Seed denegado" in capsys.readouterr().err

    llamadas = []
    monkeypatch.setattr(modulo, "validar_seed_permitido", lambda *a, **k: None)
    monkeypatch.setattr(modulo, "main", lambda: llamadas.append(True))
    modulo.ejecutar_como_script()
    assert llamadas == [True]
