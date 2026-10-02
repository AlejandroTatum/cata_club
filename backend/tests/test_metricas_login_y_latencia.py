"""Contadores de login y buckets de latencia por ruta (issue #1314).

El colector de métricas guarda los logins ok/fallidos como deltas del
contador `cata_login_total`; la etiqueta es solo el RESULTADO, nunca una
identidad. Y "Endpoints más lentos" necesita un histograma por ruta con
resolución útil: con los 3 buckets por defecto de la librería (0.1/0.5/1 s)
casi todo p95 cae entre dos bordes y no distingue una ruta de 120 ms de una de
450 ms.
"""
import re

from fastapi.testclient import TestClient
from prometheus_client import REGISTRY

from app.infraestructura.metricas import BUCKETS_LATENCIA_POR_RUTA
from app.servicios_negocio.auth_servicio import AuthServicio
from main import app
from tests.fabricas_auth import crear_usuario_auth


def _logins(resultado: str) -> float:
    return REGISTRY.get_sample_value("cata_login_total", {"resultado": resultado}) or 0.0


def test_login_exitoso_incrementa_solo_el_contador_ok(db_session):
    usuario = crear_usuario_auth(db_session)
    ok, fallido = _logins("ok"), _logins("fallido")

    AuthServicio(db_session).login(usuario.correo, "clave12345")

    assert _logins("ok") == ok + 1
    assert _logins("fallido") == fallido


def test_login_fallido_incrementa_solo_el_contador_fallido(db_session):
    usuario = crear_usuario_auth(db_session)
    ok, fallido = _logins("ok"), _logins("fallido")

    try:
        AuthServicio(db_session, dormir=lambda _s: None).login(usuario.correo, "incorrecta")
    except Exception:
        pass

    assert _logins("fallido") == fallido + 1
    assert _logins("ok") == ok


def test_los_contadores_de_login_no_llevan_etiquetas_de_identidad():
    muestras = [
        m for familia in REGISTRY.collect() for m in familia.samples if m.name == "cata_login_total"
    ]
    assert muestras, "cata_login_total debe existir desde el arranque (en 0)"
    assert all(set(m.labels) == {"resultado"} for m in muestras)
    assert {m.labels["resultado"] for m in muestras} == {"ok", "fallido"}


def test_metrics_expone_los_contadores_de_login():
    with TestClient(app) as cliente:
        cuerpo = cliente.get("/metrics").text
    assert 'cata_login_total{resultado="ok"}' in cuerpo
    assert 'cata_login_total{resultado="fallido"}' in cuerpo


def test_la_latencia_por_ruta_expone_buckets_finos():
    esperados = {f"{b:g}" for b in BUCKETS_LATENCIA_POR_RUTA} | {"+Inf"}
    assert {0.025, 0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2.5, 5, 10} == set(BUCKETS_LATENCIA_POR_RUTA)

    with TestClient(app) as cliente:
        cliente.get("/health")
        cuerpo = cliente.get("/metrics").text

    bordes = {
        re.search(r'le="([^"]+)"', linea).group(1)
        for linea in cuerpo.splitlines()
        if linea.startswith("http_request_duration_seconds_bucket") and 'handler="/health"' in linea
    }
    normalizados = {("+Inf" if b == "+Inf" else f"{float(b):g}") for b in bordes}
    assert normalizados == esperados


def test_se_conservan_los_nombres_de_las_series_http_existentes():
    with TestClient(app) as cliente:
        cliente.get("/health")
        cuerpo = cliente.get("/metrics").text
    for nombre in (
        "http_request_duration_seconds_bucket",
        "http_request_duration_highr_seconds_bucket",
        "http_requests_total",
        "http_requests_inprogress",
    ):
        assert nombre in cuerpo
