"""Contrato de la BD por worker de pytest-xdist (issue #1505).

Cada worker necesita su PROPIA base: `esquema_migrado` hace `DROP SCHEMA
public CASCADE` al arrancar y los tests escriben dentro de transacciones, así
que dos workers sobre la misma base se pisarían el esquema.
"""
from tests.conftest import url_de_worker

URL = "postgresql+psycopg://usuario:password@localhost:5432/cataclub_test"


def test_sin_xdist_la_url_no_cambia():
    assert url_de_worker(URL, None) == URL


def test_worker_gw0_apunta_a_su_propia_base():
    assert url_de_worker(URL, "gw0").endswith("/cataclub_test_gw0")


def test_workers_distintos_obtienen_bases_distintas():
    assert url_de_worker(URL, "gw1") != url_de_worker(URL, "gw2")


def test_la_derivacion_conserva_credenciales_y_servidor():
    derivada = url_de_worker(URL, "gw3")
    assert derivada.startswith("postgresql+psycopg://usuario:password@localhost:5432/")
