"""Colector de métricas (issue #1314): texto Prometheus -> instantánea.

Se prueba con texto de exposición fijo (no con el `/metrics` vivo): lo que
importa es la aritmética de deltas entre dos scrapes consecutivos y el
percentil sobre buckets, que un scrape real no permite fijar.
"""
import json
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.dominio.modelos import MetricaInstantanea
from app.infraestructura import colector_metricas as cm
from tests.redis_falso import RedisFalso

AHORA = datetime(2026, 10, 1, 20, 30, 0, tzinfo=timezone.utc)
LES = ["0.025", "0.05", "0.1", "0.25", "0.5", "0.75", "1.0", "1.5", "2.5", "5.0", "10.0", "+Inf"]


def _buckets(handler: str, method: str, acumulados: list[int]) -> str:
    return "\n".join(
        f'http_request_duration_seconds_bucket{{handler="{handler}",le="{le}",method="{method}"}} {n}.0'
        for le, n in zip(LES, acumulados)
    )


def _texto(
    *,
    api: list[int],
    pagos: list[int] | None = None,
    health: int = 50,
    total_2xx: float = 1000,
    total_4xx: float = 10,
    total_5xx: float = 2,
    login_ok: float = 7,
    login_fallido: float = 1,
    outbox: tuple[int, int, float] = (3, 120, 1),
) -> str:
    pagos = pagos or [0] * 12
    return "\n".join([
        "# HELP http_requests_total Total number of requests by method, status and handler.",
        "# TYPE http_requests_total counter",
        f'http_requests_total{{handler="/api/v1/personas/{{persona_id}}",method="GET",status="2xx"}} {total_2xx}',
        f'http_requests_total{{handler="/api/v1/pagos",method="GET",status="4xx"}} {total_4xx}',
        f'http_requests_total{{handler="/api/v1/pagos",method="POST",status="5xx"}} {total_5xx}',
        f'http_requests_total{{handler="/health",method="GET",status="2xx"}} {health}',
        f'http_requests_total{{handler="/metrics",method="GET",status="2xx"}} {health}',
        "# TYPE http_request_duration_seconds histogram",
        _buckets("/api/v1/personas/{persona_id}", "GET", api),
        _buckets("/api/v1/pagos", "GET", pagos),
        _buckets("/health", "GET", [health] * 12),
        "# TYPE cata_login_total counter",
        f'cata_login_total{{resultado="ok"}} {login_ok}',
        f'cata_login_total{{resultado="fallido"}} {login_fallido}',
        "# TYPE cata_outbox_pendientes gauge",
        f'cata_outbox_pendientes{{tabla="recuperacion_outbox"}} {outbox[0]}',
        'cata_outbox_pendientes{tabla="verificacion_correo_outbox"} 0',
        "# TYPE cata_outbox_pendiente_mas_antiguo_segundos gauge",
        f'cata_outbox_pendiente_mas_antiguo_segundos{{tabla="recuperacion_outbox"}} {outbox[1]}',
        'cata_outbox_pendiente_mas_antiguo_segundos{tabla="verificacion_correo_outbox"} 0',
        "# TYPE cata_outbox_scrape_ok gauge",
        f"cata_outbox_scrape_ok {outbox[2]}",
        "",
    ])


# --- parseo ------------------------------------------------------------------
def test_parsear_excluye_sondas_y_suma_peticiones_y_errores():
    lectura = cm.parsear_exposicion(_texto(api=[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))

    assert lectura.peticiones == 1000 + 10 + 2  # /health y /metrics no cuentan
    assert lectura.errores_4xx == 10
    assert lectura.errores_5xx == 2
    assert set(lectura.rutas) == {"GET /api/v1/personas/{persona_id}", "GET /api/v1/pagos"}


def test_parsear_lee_logins_y_outbox():
    lectura = cm.parsear_exposicion(_texto(api=[0] * 12, outbox=(3, 120, 1)))

    assert (lectura.logins_ok, lectura.logins_fallidos) == (7, 1)
    assert lectura.outbox_pendientes == 3
    assert lectura.outbox_mas_antiguo_s == 120


def test_outbox_con_scrape_ok_cero_queda_sin_dato():
    lectura = cm.parsear_exposicion(_texto(api=[0] * 12, outbox=(3, 120, 0)))

    assert lectura.outbox_pendientes is None
    assert lectura.outbox_mas_antiguo_s is None


def test_una_ruta_con_buckets_incompletos_no_entra_al_histograma_pero_si_al_conteo():
    texto = _texto(api=[0] * 12) + (
        'http_request_duration_seconds_bucket{handler="/viejo",le="0.1",method="GET"} 5.0\n'
        'http_request_duration_seconds_bucket{handler="/viejo",le="+Inf",method="GET"} 9.0\n'
    )

    assert "GET /viejo" not in cm.parsear_exposicion(texto).rutas


# --- deltas --------------------------------------------------------------------
def test_delta_entre_dos_scrapes_resta_contadores_y_buckets():
    previa = cm.parsear_exposicion(_texto(api=[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))
    actual = cm.parsear_exposicion(
        _texto(
            api=[20, 60, 90, 95, 100, 100, 100, 100, 100, 100, 100, 100],
            total_2xx=1100, total_4xx=14, total_5xx=3, login_ok=9, login_fallido=4,
        )
    )

    delta = cm.calcular_delta(previa, actual, intervalo_s=60)

    assert delta.intervalo_s == 60
    assert delta.peticiones == 105  # (1100-1000) + (14-10) + (3-2)
    assert (delta.errores_4xx, delta.errores_5xx) == (4, 1)
    assert (delta.logins_ok, delta.logins_fallidos) == (2, 3)
    assert delta.rutas["GET /api/v1/personas/{persona_id}"] == [20, 60, 90, 95, 100, 100, 100, 100, 100, 100, 100, 100]
    assert delta.latencia == [20, 60, 90, 95, 100, 100, 100, 100, 100, 100, 100, 100]


def test_un_reinicio_del_backend_usa_el_valor_actual_como_delta():
    previa = cm.parsear_exposicion(_texto(api=[50] * 12, total_2xx=5000, login_ok=40))
    actual = cm.parsear_exposicion(_texto(api=[3] * 12, total_2xx=30, login_ok=2))  # contadores bajaron

    delta = cm.calcular_delta(previa, actual, intervalo_s=60)

    assert delta.peticiones == 30 + 10 + 2
    assert delta.logins_ok == 2
    assert delta.rutas["GET /api/v1/personas/{persona_id}"] == [3] * 12


def test_sin_lectura_previa_no_hay_deltas():
    actual = cm.parsear_exposicion(_texto(api=[3] * 12))

    delta = cm.calcular_delta(None, actual, intervalo_s=None)

    assert delta.peticiones is None and delta.latencia is None and delta.logins_ok is None


# --- percentiles -----------------------------------------------------------------
def test_percentil_interpola_dentro_del_bucket():
    acumulados = [20, 60, 90, 95, 100, 100, 100, 100, 100, 100, 100, 100]

    assert cm.percentil_ms(acumulados, 0.50) == pytest.approx(43.75)  # 25 + 25*(50-20)/(60-20)
    assert cm.percentil_ms(acumulados, 0.95) == pytest.approx(250.0)  # justo en el borde 0.25 s


def test_percentil_en_el_bucket_infinito_se_acota_al_ultimo_borde_finito():
    acumulados = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 10, 100]  # 90% por encima de 10 s

    assert cm.percentil_ms(acumulados, 0.95) == 10_000.0


def test_percentil_sin_datos_es_none():
    assert cm.percentil_ms([0] * 12, 0.95) is None


# --- host ----------------------------------------------------------------------
def _escribir_host(ruta, escrito_en: datetime, **extra) -> None:
    contenido = {
        "version": 1,
        "escrito_en": int(escrito_en.timestamp()),
        "cpu_pct": 31.5,
        "ram_usada_mb": 2350,
        "ram_total_mb": 3900,
        "swap_usada_mb": 214,
        "swap_total_mb": 1024,
        "disco_pct": 54,
        "contenedores": [
            {"nombre": "backend", "usado_mb": 262, "limite_mb": 320},
            {"nombre": "redis", "usado_mb": 22, "limite_mb": 64},
        ],
    }
    contenido.update(extra)
    ruta.write_text(json.dumps(contenido))


def test_host_fresco_se_ingiere(tmp_path):
    archivo = tmp_path / "host.json"
    _escribir_host(archivo, AHORA - timedelta(seconds=45))

    host = cm.leer_host(archivo, AHORA)

    assert host["cpu_pct"] == 31.5
    assert host["contenedores"][0] == {"nombre": "backend", "usado_mb": 262, "limite_mb": 320}
    assert host["actualizado_en"] == AHORA - timedelta(seconds=45)


def test_host_viejo_mas_de_3_minutos_no_esta_disponible(tmp_path):
    archivo = tmp_path / "host.json"
    _escribir_host(archivo, AHORA - timedelta(minutes=3, seconds=1))

    assert cm.leer_host(archivo, AHORA) is None


def test_host_exactamente_en_el_limite_de_frescura_sigue_disponible(tmp_path):
    archivo = tmp_path / "host.json"
    _escribir_host(archivo, AHORA - timedelta(minutes=3))

    assert cm.leer_host(archivo, AHORA) is not None


def test_host_faltante_o_corrupto_no_esta_disponible_y_no_lanza(tmp_path):
    assert cm.leer_host(tmp_path / "no-existe.json", AHORA) is None
    corrupto = tmp_path / "host.json"
    corrupto.write_text("{no es json")
    assert cm.leer_host(corrupto, AHORA) is None
    corrupto.write_text(json.dumps({"version": 1, "escrito_en": "ayer"}))
    assert cm.leer_host(corrupto, AHORA) is None


def test_host_descarta_contenedores_con_nombre_raro_y_campos_extra(tmp_path):
    archivo = tmp_path / "host.json"
    _escribir_host(
        archivo,
        AHORA,
        hostname="droplet-secreto",
        contenedores=[
            {"nombre": "backend", "usado_mb": 262, "limite_mb": 320, "ip": "10.0.0.5"},
            {"nombre": "host con espacios; rm -rf", "usado_mb": 1, "limite_mb": 2},
            {"nombre": "db", "usado_mb": "mucho", "limite_mb": 320},
        ],
    )

    host = cm.leer_host(archivo, AHORA)

    assert host["contenedores"] == [{"nombre": "backend", "usado_mb": 262, "limite_mb": 320}]
    assert "hostname" not in host


# --- recolectar (una iteración completa) ------------------------------------------
class _Redis(RedisFalso):
    """RedisFalso + los comandos que usa el colector."""

    def __init__(self, **kw):
        super().__init__(**kw)
        self.texto: dict[str, str] = {}

    def _vivo(self):
        if self.falla:
            raise ConnectionError("redis caído (falso)")

    def get(self, clave):
        self._vivo()
        return self.texto.get(clave)

    def setex(self, clave, _ttl, valor):
        self._vivo()
        self.texto[clave] = valor

    def llen(self, _clave):
        self._vivo()
        return 4

    def info(self, _seccion):
        self._vivo()
        return {"used_memory": 23 * 1024 * 1024, "maxmemory": 48 * 1024 * 1024}


def _recolectar(db_session, texto, ahora, redis, host=None):
    return cm.recolectar(
        db_session,
        ahora=ahora,
        scrapear=lambda: texto,
        redis_cliente=redis,
        archivo_host=host,
        conectados=lambda _ahora: {"total": 5, "por_rol": {"ALUMNO": 3, "ENTRENADOR": 1, "REPRESENTANTE": 1, "ADMINISTRADOR": 0}},
    )


def test_primera_recoleccion_guarda_estado_pero_no_deltas(db_session):
    redis = _Redis()

    fila = _recolectar(db_session, _texto(api=[3] * 12), AHORA, redis)

    assert fila is not None
    assert fila.peticiones is None and fila.latencia_buckets is None
    assert fila.outbox_pendientes == 3
    assert fila.cola_celery == 4
    assert fila.redis_usado_mb == pytest.approx(23.0)
    assert fila.redis_max_mb == pytest.approx(48.0)
    assert fila.db_conexiones >= 1 and fila.db_conexiones_max >= fila.db_conexiones
    assert fila.conectados == 5 and fila.conectados_por_rol["ALUMNO"] == 3
    assert fila.host_actualizado_en is None and fila.host_cpu_pct is None
    assert cm.CLAVE_ESTADO_PREVIO in redis.texto


def test_segunda_recoleccion_guarda_deltas_y_rutas(db_session, tmp_path):
    redis = _Redis()
    host = tmp_path / "host.json"
    _escribir_host(host, AHORA + timedelta(seconds=50))
    _recolectar(db_session, _texto(api=[0] * 12), AHORA, redis)

    fila = _recolectar(
        db_session,
        _texto(api=[20, 60, 90, 95, 100, 100, 100, 100, 100, 100, 100, 100], total_2xx=1100, total_4xx=14, total_5xx=3, login_ok=9),
        AHORA + timedelta(seconds=60),
        redis,
        host,
    )

    assert fila.intervalo_s == 60
    assert fila.peticiones == 105 and fila.errores_4xx == 4 and fila.errores_5xx == 1
    assert fila.logins_ok == 2
    assert fila.latencia_buckets == [20, 60, 90, 95, 100, 100, 100, 100, 100, 100, 100, 100]
    assert fila.rutas[0] == {"m": "GET", "r": "/api/v1/personas/{persona_id}", "b": [20, 60, 90, 95, 100, 100, 100, 100, 100, 100, 100, 100]}
    assert fila.host_cpu_pct == 31.5 and fila.host_ram_total_mb == 3900
    assert [c["nombre"] for c in fila.host_contenedores] == ["backend", "redis"]


def test_estado_previo_viejo_se_ignora(db_session):
    redis = _Redis()
    _recolectar(db_session, _texto(api=[0] * 12), AHORA, redis)

    fila = _recolectar(db_session, _texto(api=[5] * 12), AHORA + timedelta(minutes=10), redis)

    assert fila.peticiones is None  # hueco demasiado largo: no se inventa un delta


def test_un_scrape_que_falla_no_inserta_ni_lanza(db_session):
    def _falla():
        raise OSError("backend caído")

    fila = cm.recolectar(
        db_session, ahora=AHORA, scrapear=_falla, redis_cliente=_Redis(), archivo_host=None,
        conectados=lambda _a: None,
    )

    assert fila is None
    assert db_session.scalars(select(MetricaInstantanea)).all() == []


def test_redis_caido_no_impide_guardar_la_instantanea(db_session):
    fila = _recolectar(db_session, _texto(api=[3] * 12), AHORA, _Redis(falla=True))

    assert fila is not None
    assert fila.cola_celery is None and fila.redis_usado_mb is None
    assert fila.outbox_pendientes == 3


def test_la_instantanea_no_guarda_nada_que_identifique(db_session):
    fila = _recolectar(db_session, _texto(api=[3] * 12), AHORA, _Redis())

    columnas = {c.name for c in MetricaInstantanea.__table__.columns}
    assert not {c for c in columnas if any(k in c for k in ("ip", "correo", "email", "usuario", "token", "version", "hostname"))} - {"capturada_en"}
    assert fila.conectados_por_rol.keys() == {"ALUMNO", "ENTRENADOR", "REPRESENTANTE", "ADMINISTRADOR"}


# --- scrape HTTP real (servidor local) -----------------------------------------------
def _servir(cuerpo: bytes):
    import threading
    from http.server import BaseHTTPRequestHandler, HTTPServer

    class Manejador(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            self.send_response(200)
            self.send_header("Content-Length", str(len(cuerpo)))
            self.end_headers()
            self.wfile.write(cuerpo)

        def log_message(self, *_):
            pass

    servidor = HTTPServer(("127.0.0.1", 0), Manejador)
    threading.Thread(target=servidor.serve_forever, daemon=True).start()
    return servidor


def test_scrapear_metricas_lee_el_cuerpo_por_http(monkeypatch):
    servidor = _servir(_texto(api=[3] * 12).encode())
    try:
        monkeypatch.setattr(cm.settings, "metricas_url_scrape", f"http://127.0.0.1:{servidor.server_port}/metrics")
        assert cm.parsear_exposicion(cm.scrapear_metricas()).logins_ok == 7
    finally:
        servidor.shutdown()


def test_scrapear_metricas_rechaza_una_respuesta_desmedida(monkeypatch):
    monkeypatch.setattr(cm, "TOPE_BYTES_SCRAPE", 1024)
    servidor = _servir(b"x" * 4096)
    try:
        monkeypatch.setattr(cm.settings, "metricas_url_scrape", f"http://127.0.0.1:{servidor.server_port}/metrics")
        with pytest.raises(ValueError):
            cm.scrapear_metricas()
    finally:
        servidor.shutdown()
