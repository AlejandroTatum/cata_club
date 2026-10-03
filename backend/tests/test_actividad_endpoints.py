"""Endpoints de "Actividad del club" (issue #1314): `GET /api/v1/actividad/resumen`
y `GET /api/v1/actividad/avanzadas`.

Las formas de respuesta son EXACTAMENTE las del demo aprobado
(`frontend/src/app/admin/actividad/demo-data.ts`, ramas `ResumenData` y
`AvanzadasData`), por rango. Solo agregados: ninguna respuesta puede llevar
correos, ids de usuario, IPs, hosts ni versiones.
"""
from datetime import date, datetime, time, timedelta, timezone

import pytest
from sqlalchemy.dialects.postgresql import JSONB

from app.dominio.enums import Categoria, DiaSemana, EstadoAsistencia, EstadoMembresia, EstadoPago, TipoRol
from app.dominio.modelos import Asistencia, HorarioEntrenamiento, MetricaInstantanea
from app.presentacion.routers import actividad_router
from tests import actividad_fabricas as fab
from tests.fabricas_pagos import (
    crear_membresia_orm, crear_pago_orm, crear_persona_orm, crear_tipo_membresia_orm,
)

AHORA = fab.AHORA
RUTA_RESUMEN = "/api/v1/actividad/resumen"
RUTA_AVANZADAS = "/api/v1/actividad/avanzadas"
PROHIBIDAS = {
    "email", "correo", "ip", "ips", "hostname", "version", "token", "userId", "usuario",
    "usuarioId", "persona", "personaId", "cedula", "id",
}


@pytest.fixture(autouse=True)
def _reloj_fijo(monkeypatch):
    monkeypatch.setattr(actividad_router, "_ahora", lambda: AHORA)


def _claves(valor) -> set[str]:
    if isinstance(valor, dict):
        return set(valor) | {k for v in valor.values() for k in _claves(v)}
    if isinstance(valor, list):
        return {k for v in valor for k in _claves(v)}
    return set()


def _textos(valor):
    if isinstance(valor, dict):
        for v in valor.values():
            yield from _textos(v)
    elif isinstance(valor, list):
        for v in valor:
            yield from _textos(v)
    elif isinstance(valor, str):
        yield valor


# --- permisos --------------------------------------------------------------
@pytest.mark.parametrize("ruta", [RUTA_RESUMEN + "?rango=7d", RUTA_AVANZADAS + "?rango=1h"])
def test_anonimo_recibe_401(client_sin_token, ruta):
    assert client_sin_token.get(ruta).status_code == 401


@pytest.mark.parametrize("ruta", [RUTA_RESUMEN + "?rango=7d", RUTA_AVANZADAS + "?rango=1h"])
def test_alumno_recibe_403(client_sin_permisos, ruta):
    assert client_sin_permisos.get(ruta).status_code == 403


@pytest.mark.parametrize("ruta", [RUTA_RESUMEN + "?rango=7d", RUTA_AVANZADAS + "?rango=1h"])
def test_entrenador_recibe_403(client_entrenador, ruta):
    assert client_entrenador.get(ruta).status_code == 403


@pytest.mark.parametrize("ruta", [RUTA_RESUMEN, RUTA_AVANZADAS])
def test_rango_invalido_o_de_la_otra_vista_recibe_422(client, ruta):
    assert client.get(ruta + "?rango=1y").status_code == 422
    # Resumen: 24h/7d/30d. Avanzadas: 1h/24h/7d.
    cruzado = "?rango=30d" if ruta == RUTA_AVANZADAS else "?rango=1h"
    assert client.get(ruta + cruzado).status_code == 422


# --- Resumen ------------------------------------------------------------------
def _sembrar_resumen(db):
    alumno1 = fab.usuario(db, TipoRol.ALUMNO)
    alumno2 = fab.usuario(db, TipoRol.ALUMNO)
    rep = fab.usuario(db, TipoRol.REPRESENTANTE)
    entrenador = fab.usuario(db, TipoRol.ENTRENADOR)
    admin = fab.usuario(db, TipoRol.ADMINISTRADOR)
    alumno3 = fab.usuario(db, TipoRol.ALUMNO)
    d1, d0 = date(2026, 10, 1), date(2026, 9, 30)
    for u, fecha, franja in (
        (alumno1, d1, 7), (rep, d1, 7), (alumno3, d1, 7),   # 14:00-16:00 de hoy
        (alumno1, d1, 4), (entrenador, d1, 4),             # 08:00-10:00 de hoy
        (alumno2, d0, 9), (admin, d0, 9),                  # 18:00-20:00 de ayer
        (alumno2, d0, 7),                                  # 14:00 de ayer: fuera de 24h
        (rep, date(2026, 9, 24), 3),                       # fuera de 7d, dentro de 30d
    ):
        fab.actividad(db, u, fecha, franja)

    horario = HorarioEntrenamiento(
        categoria=Categoria.JUVENIL, dia_semana=DiaSemana.JUEVES, hora_inicio=time(15, 0), hora_fin=time(16, 0),
    )
    db.add(horario)
    db.flush()
    alumno = crear_persona_orm(db, "1710034065")
    alumno.fecha_registro = datetime(2020, 1, 1, tzinfo=timezone.utc)  # no es una "inscripción nueva"
    hoy_15 = datetime(2026, 10, 1, 20, 0, tzinfo=timezone.utc)  # 15:00 del club -> última columna
    for estado in (EstadoAsistencia.PRESENTE, EstadoAsistencia.PRESENTE, EstadoAsistencia.ATRASADO, EstadoAsistencia.AUSENTE):
        db.add(Asistencia(
            persona_id=fab.persona(db).id, horario_id=horario.id, fecha_entrenamiento=date(2026, 10, 1),
            estado=estado, fecha_registro=hoy_15,
        ))
        db.flush()
    return alumno


def _pagos(db, persona):
    tipo = crear_tipo_membresia_orm(db)
    membresia = crear_membresia_orm(db, persona, tipo, EstadoMembresia.ACTIVA)
    for estado in (EstadoPago.PENDIENTE_VALIDACION, EstadoPago.RECHAZADO):
        pago = crear_pago_orm(db, persona, membresia, estado)
        pago.fecha_registro = datetime(2026, 10, 1, 14, 30, tzinfo=timezone.utc)  # 09:30 del club
        db.flush()


def test_resumen_24h_tiene_la_forma_del_demo(client, db_session):
    alumno = _sembrar_resumen(db_session)
    _pagos(db_session, alumno)
    nueva = fab.persona(db_session, fecha_registro=datetime(2026, 10, 1, 20, 10, tzinfo=timezone.utc))
    assert nueva.id

    cuerpo = client.get(RUTA_RESUMEN + "?rango=24h").json()

    assert set(cuerpo) == {"range", "generatedAt", "span", "periods", "uniqueVisitors", "status", "queuedByQuota"}
    assert cuerpo["range"] == "24h" and cuerpo["span"] == "2h"
    assert cuerpo["generatedAt"] == "2026-10-01T15:30:00-05:00"
    periodos = cuerpo["periods"]
    assert len(periodos) == 12
    assert periodos[0]["start"] == "2026-09-30T16:00:00-05:00"
    assert periodos[11]["start"] == "2026-10-01T14:00:00-05:00"
    assert set(periodos[0]) == {"start", "visitors", "attendances", "payments", "enrollments"}
    assert set(periodos[0]["visitors"]) == {"alumnos", "entrenadores", "representantes"}


def test_resumen_24h_cuenta_personas_distintas_por_franja_y_rol(client, db_session):
    _sembrar_resumen(db_session)

    periodos = client.get(RUTA_RESUMEN + "?rango=24h").json()["periods"]

    assert periodos[11]["visitors"] == {"alumnos": 2, "entrenadores": 0, "representantes": 1}
    assert periodos[8]["visitors"] == {"alumnos": 1, "entrenadores": 1, "representantes": 0}
    # El administrador no es ninguno de los tres roles de la gráfica.
    assert periodos[1]["visitors"] == {"alumnos": 1, "entrenadores": 0, "representantes": 0}


def test_resumen_24h_unicos_cuentan_personas_distintas(client, db_session):
    _sembrar_resumen(db_session)

    unicos = client.get(RUTA_RESUMEN + "?rango=24h").json()["uniqueVisitors"]

    # alumno1 entró en dos franjas y cuenta una vez; el administrador no cuenta.
    assert unicos == {"alumnos": 3, "entrenadores": 1, "representantes": 1, "total": 5}


def test_resumen_24h_asistencias_pagos_e_inscripciones_van_a_su_franja(client, db_session):
    alumno = _sembrar_resumen(db_session)
    _pagos(db_session, alumno)
    fab.persona(db_session, fecha_registro=datetime(2026, 10, 1, 20, 10, tzinfo=timezone.utc))

    periodos = client.get(RUTA_RESUMEN + "?rango=24h").json()["periods"]

    assert [p["attendances"] for p in periodos][11] == 3          # PRESENTE x2 + ATRASADO; AUSENTE no
    assert sum(p["attendances"] for p in periodos) == 3
    assert periodos[8]["payments"] == 2                           # pendiente + rechazado: ambos recibidos
    assert sum(p["payments"] for p in periodos) == 2
    assert periodos[11]["enrollments"] == 1
    assert sum(p["enrollments"] for p in periodos) == 1


def test_resumen_7d_agrupa_por_dia_del_club(client, db_session):
    _sembrar_resumen(db_session)

    cuerpo = client.get(RUTA_RESUMEN + "?rango=7d").json()

    assert cuerpo["span"] == "1d" and len(cuerpo["periods"]) == 7
    assert cuerpo["periods"][0]["start"] == "2026-09-25T00:00:00-05:00"
    assert cuerpo["periods"][6]["start"] == "2026-10-01T00:00:00-05:00"
    # Ayer: alumno2 entró en dos franjas pero cuenta una vez por columna.
    assert cuerpo["periods"][5]["visitors"] == {"alumnos": 1, "entrenadores": 0, "representantes": 0}
    # Hoy: alumno1 (2 franjas, cuenta una vez), alumno3, rep, entrenador.
    assert cuerpo["periods"][6]["visitors"] == {"alumnos": 2, "entrenadores": 1, "representantes": 1}
    # El ingreso del día 24 queda fuera de los 7 días.
    assert cuerpo["uniqueVisitors"]["total"] == 5


def test_resumen_30d_son_cinco_columnas_de_seis_dias(client, db_session):
    _sembrar_resumen(db_session)

    cuerpo = client.get(RUTA_RESUMEN + "?rango=30d").json()

    assert cuerpo["span"] == "6d" and len(cuerpo["periods"]) == 5
    assert [p["start"][:10] for p in cuerpo["periods"]] == [
        "2026-09-02", "2026-09-08", "2026-09-14", "2026-09-20", "2026-09-26",
    ]
    assert cuerpo["periods"][3]["visitors"]["representantes"] == 1   # el ingreso del 24/09
    assert cuerpo["periods"][4]["visitors"]["alumnos"] == 3          # alumno1, alumno2, alumno3
    assert cuerpo["uniqueVisitors"]["total"] == 5


def test_resumen_informa_los_correos_en_espera_por_el_tope_diario(client, db_session):
    """MAIL-CAP: el administrador ve cuántos enlaces esperan el reinicio del cupo."""
    from app.dominio.cedula import cedula_valida
    from app.dominio.modelos import RecuperacionOutbox
    from app.infraestructura.repositorios import outbox_cupo
    from tests.fabricas_auth import crear_usuario_auth

    assert client.get(RUTA_RESUMEN + "?rango=7d").json()["queuedByQuota"] == 0
    usuario = crear_usuario_auth(db_session, correo="cupo@cataclub.test", cedula=cedula_valida(8420))
    db_session.add(RecuperacionOutbox(
        usuario_id=usuario.id,
        expires_at=AHORA + timedelta(hours=48),
        last_error_redacted=f"{outbox_cupo.MARCA_CUPO_AGOTADO}: diferido hasta el día siguiente",
    ))
    db_session.commit()

    assert client.get(RUTA_RESUMEN + "?rango=7d").json()["queuedByQuota"] == 1


def test_resumen_sin_actividad_devuelve_ceros_no_errores(client):
    cuerpo = client.get(RUTA_RESUMEN + "?rango=7d").json()

    assert cuerpo["uniqueVisitors"] == {"alumnos": 0, "entrenadores": 0, "representantes": 0, "total": 0}
    assert all(p["visitors"] == {"alumnos": 0, "entrenadores": 0, "representantes": 0} for p in cuerpo["periods"])


def test_resumen_es_solo_agregados(client, db_session):
    _sembrar_resumen(db_session)

    for rango in ("24h", "7d", "30d"):
        cuerpo = client.get(RUTA_RESUMEN + f"?rango={rango}").json()
        assert not (_claves(cuerpo) & PROHIBIDAS)
        assert not any("@" in t for t in _textos(cuerpo))


# --- Estado del sistema ----------------------------------------------------------
def _instantanea(db, hace_min=1, **campos):
    db.add(MetricaInstantanea(capturada_en=AHORA - timedelta(minutes=hace_min), **campos))
    db.flush()


def _estado(client):
    return {s["key"]: s["level"] for s in client.get(RUTA_RESUMEN + "?rango=7d").json()["status"]}


def test_estado_es_desconocido_si_todavia_no_hay_instantaneas(client):
    cuerpo = client.get(RUTA_RESUMEN + "?rango=24h").json()

    assert cuerpo["status"] == [
        {"key": "app", "level": "unknown"},
        {"key": "errors", "level": "unknown"},
        {"key": "notifications", "level": "unknown"},
    ]


def test_estado_ok_con_instantaneas_sanas(client, db_session):
    _instantanea(
        db_session, intervalo_s=60, peticiones=100, errores_5xx=0, errores_4xx=2,
        latencia_buckets=[0, 50, 90, 100] + [100] * 8, outbox_mas_antiguo_s=0,
        db_conexiones=10, db_conexiones_max=100,
    )

    assert _estado(client) == {"app": "ok", "errors": "ok", "notifications": "ok"}


@pytest.mark.parametrize("errores,esperado", [(0, "ok"), (1, "warn"), (4, "warn"), (5, "bad"), (10, "bad")])
def test_estado_de_errores_usa_los_umbrales_1_y_5_por_ciento(client, db_session, errores, esperado):
    _instantanea(db_session, intervalo_s=60, peticiones=100, errores_5xx=errores, latencia_buckets=[100] * 12)

    assert _estado(client)["errors"] == esperado


@pytest.mark.parametrize("segundos,esperado", [(60, "ok"), (30 * 60, "warn"), (119 * 60, "warn"), (120 * 60, "bad")])
def test_estado_de_notificaciones_usa_edad_30_y_120_minutos(client, db_session, segundos, esperado):
    _instantanea(db_session, outbox_mas_antiguo_s=segundos, outbox_pendientes=4)

    assert _estado(client)["notifications"] == esperado


def test_estado_de_app_sube_con_latencia_p95_alta(client, db_session):
    # 100 peticiones todas entre 0.75 y 1 s: p95 ~ 988 ms -> atención (>= 800).
    _instantanea(
        db_session, intervalo_s=60, peticiones=100, errores_5xx=0,
        latencia_buckets=[0, 0, 0, 0, 0, 0, 100, 100, 100, 100, 100, 100],
    )

    assert _estado(client)["app"] == "warn"


def test_estado_de_app_sube_con_conexiones_de_base_casi_agotadas(client, db_session):
    _instantanea(db_session, db_conexiones=92, db_conexiones_max=100, latencia_buckets=[0] * 12)

    assert _estado(client)["app"] == "bad"


def test_instantanea_vieja_deja_la_app_en_urgente_y_lo_demas_desconocido(client, db_session):
    _instantanea(db_session, hace_min=10, intervalo_s=60, peticiones=10, errores_5xx=0, latencia_buckets=[10] * 12)

    assert _estado(client) == {"app": "bad", "errors": "unknown", "notifications": "unknown"}


# --- Avanzadas -----------------------------------------------------------------
PUNTOS = {"1h": (60, 1), "24h": (24, 60), "7d": (28, 360)}


def _serie_ok(serie, rango):
    puntos, paso = PUNTOS[rango]
    assert set(serie) == {"stepMinutes", "values"}
    assert serie["stepMinutes"] == paso and len(serie["values"]) == puntos


@pytest.mark.parametrize("rango", ["1h", "24h", "7d"])
def test_avanzadas_sin_datos_conserva_la_forma_con_secciones_nulas(client, rango):
    cuerpo = client.get(RUTA_AVANZADAS + f"?rango={rango}").json()

    assert set(cuerpo) == {"range", "service", "host", "runtime", "users"}
    assert cuerpo["range"] == rango
    assert cuerpo["service"] is None and cuerpo["host"] is None
    assert cuerpo["runtime"] is None and cuerpo["users"] is None


def _sembrar_avanzadas(db):
    rutas = [
        {"m": "GET", "r": "/api/v1/pagos", "b": [0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50]},
        {"m": "GET", "r": "/api/v1/personas/{persona_id}", "b": [20, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40]},
        {"m": "POST", "r": "/api/v1/rara", "b": [0, 0, 0, 0, 0, 0, 0, 2, 2, 2, 2, 2]},  # < 5 peticiones: no entra
    ]
    db.add(MetricaInstantanea(
        capturada_en=AHORA - timedelta(minutes=2), intervalo_s=60, peticiones=30, errores_5xx=0, errores_4xx=3,
        latencia_buckets=[10, 20, 25, 30, 30, 30, 30, 30, 30, 30, 30, 30], rutas=rutas,
        logins_ok=2, logins_fallidos=1,
        host_actualizado_en=AHORA - timedelta(minutes=2, seconds=10), host_cpu_pct=20.0,
        host_ram_usada_mb=2000, host_ram_total_mb=3900, host_swap_usada_mb=100, host_swap_total_mb=1024,
        host_disco_pct=50.0,
    ))
    db.add(MetricaInstantanea(
        capturada_en=AHORA - timedelta(minutes=1), intervalo_s=60, peticiones=60, errores_5xx=3, errores_4xx=6,
        latencia_buckets=[20, 40, 50, 60, 60, 60, 60, 60, 60, 60, 60, 60], rutas=rutas[:2],
        outbox_pendientes=12, outbox_mas_antiguo_s=47 * 60, cola_celery=3, db_conexiones=14, db_conexiones_max=100,
        redis_usado_mb=22.4, redis_max_mb=48.0, logins_ok=1, logins_fallidos=0,
        conectados=9, conectados_por_rol={"ALUMNO": 5, "ENTRENADOR": 1, "REPRESENTANTE": 2, "ADMINISTRADOR": 1},
        host_actualizado_en=AHORA - timedelta(minutes=1, seconds=5), host_cpu_pct=40.0,
        host_ram_usada_mb=2350, host_ram_total_mb=3900, host_swap_usada_mb=214, host_swap_total_mb=1024,
        host_disco_pct=54.0,
        host_contenedores=[{"nombre": "backend", "usado_mb": 262, "limite_mb": 320}],
    ))
    db.flush()


@pytest.mark.parametrize("malo", [JSONB.NULL, {"x": 1}, 7, [1, "a"]])
def test_avanzadas_ignora_buckets_json_nulos_o_que_no_son_arreglo(client, db_session, malo):
    """ADM-04: un JSON `null` pasa `isnot(None)` y rompía la suma con un 500."""
    _instantanea(db_session, hace_min=2, intervalo_s=60, peticiones=10, latencia_buckets=malo)
    _instantanea(db_session, hace_min=1, intervalo_s=60, peticiones=10, latencia_buckets=[10] * 12)

    for ruta in (RUTA_AVANZADAS + "?rango=1h", RUTA_RESUMEN + "?rango=7d"):
        assert client.get(ruta).status_code == 200


def test_avanzadas_tolera_buckets_de_distinta_longitud(client, db_session):
    _instantanea(db_session, hace_min=2, intervalo_s=60, peticiones=10, latencia_buckets=[10] * 12)
    _instantanea(db_session, hace_min=1, intervalo_s=60, peticiones=10, latencia_buckets=[10] * 8)

    assert client.get(RUTA_AVANZADAS + "?rango=1h").status_code == 200


@pytest.mark.parametrize("rango", ["1h", "24h", "7d"])
def test_avanzadas_tiene_la_forma_exacta_del_demo(client, db_session, rango):
    _sembrar_avanzadas(db_session)

    cuerpo = client.get(RUTA_AVANZADAS + f"?rango={rango}").json()

    assert set(cuerpo) == {"range", "service", "host", "runtime", "users"}
    servicio = cuerpo["service"]
    assert set(servicio) == {
        "updatedAt", "requestsPerMinute", "errorRate5xx", "errorRate4xx", "latencyMs", "slowEndpoints",
    }
    for clave in ("requestsPerMinute", "errorRate5xx", "errorRate4xx"):
        _serie_ok(servicio[clave], rango)
    assert set(servicio["latencyMs"]) == {"p50", "p95", "p99"}
    assert all(set(e) == {"method", "route", "p95Ms", "requests"} for e in servicio["slowEndpoints"])

    host = cuerpo["host"]
    assert set(host) == {"updatedAt", "cpuPercent", "memory", "swap", "diskPercent"}
    _serie_ok(host["cpuPercent"], rango)
    _serie_ok(host["diskPercent"], rango)
    assert set(host["memory"]) == {"usedMb", "totalMb", "series"} and set(host["swap"]) == {"usedMb", "totalMb", "series"}
    _serie_ok(host["memory"]["series"], rango)
    _serie_ok(host["swap"]["series"], rango)

    runtime = cuerpo["runtime"]
    assert set(runtime) == {"updatedAt", "containers", "database", "redis", "queues"}
    assert set(runtime["database"]) == {"connectionsUsed", "connectionsMax"}
    assert set(runtime["redis"]) == {"usedMb", "maxMb"}
    assert set(runtime["queues"]) == {"celeryPending", "notificationsPending", "oldestNotificationMinutes"}

    usuarios = cuerpo["users"]
    assert set(usuarios) == {"updatedAt", "connectedNow", "loginsOk", "loginsFailed", "sessionsByRole"}
    assert set(usuarios["sessionsByRole"]) == {"admin", "trainer", "estudiante", "representante"}


def test_avanzadas_1h_serie_por_minuto_con_la_ultima_posicion_siendo_ahora(client, db_session):
    _sembrar_avanzadas(db_session)

    servicio = client.get(RUTA_AVANZADAS + "?rango=1h").json()["service"]

    rpm = servicio["requestsPerMinute"]["values"]
    assert rpm[59] == 60 and rpm[58] == 30
    assert rpm[:58] == [None] * 58            # sin instantánea no hay dato (no 0)
    assert servicio["errorRate5xx"]["values"][59] == pytest.approx(5.0)   # 3/60
    assert servicio["errorRate5xx"]["values"][58] == 0.0
    assert servicio["errorRate4xx"]["values"][59] == pytest.approx(10.0)  # 6/60
    assert servicio["updatedAt"] == "2026-10-01T15:29:00-05:00"


def test_avanzadas_24h_promedia_los_minutos_de_cada_hora(client, db_session):
    _sembrar_avanzadas(db_session)

    servicio = client.get(RUTA_AVANZADAS + "?rango=24h").json()["service"]

    rpm = servicio["requestsPerMinute"]["values"]
    assert rpm[23] == pytest.approx(45.0)     # (30+60) peticiones en 120 s -> 45/min
    assert rpm[:23] == [None] * 23
    assert servicio["errorRate5xx"]["values"][23] == pytest.approx(100 * 3 / 90, abs=0.01)


def test_avanzadas_latencia_del_rango_sale_de_los_buckets_sumados(client, db_session):
    _sembrar_avanzadas(db_session)

    latencia = client.get(RUTA_AVANZADAS + "?rango=1h").json()["service"]["latencyMs"]

    # Acumulados sumados: [30, 60, 75, 90, 90 ...]. p50: rango 45 -> entre 25 y 50 ms.
    assert latencia["p50"] == pytest.approx(25 + 25 * (45 - 30) / (60 - 30), abs=1)
    assert latencia["p95"] == pytest.approx(205, abs=1)  # rango 85.5 en (0.1, 0.25] s: 100+150*(85.5-75)/(90-75)
    assert latencia["p50"] < latencia["p95"] <= latencia["p99"]


def test_avanzadas_endpoints_lentos_ordenados_por_p95_y_con_minimo_de_peticiones(client, db_session):
    _sembrar_avanzadas(db_session)

    lentos = client.get(RUTA_AVANZADAS + "?rango=1h").json()["service"]["slowEndpoints"]

    assert [e["route"] for e in lentos] == ["/api/v1/pagos", "/api/v1/personas/{persona_id}"]
    assert lentos[0]["method"] == "GET" and lentos[0]["requests"] == 100  # 50 + 50 en dos instantáneas
    assert lentos[0]["p95Ms"] > lentos[1]["p95Ms"]
    # Siempre plantillas, nunca una URL concreta.
    assert all("{" in e["route"] or e["route"].count("/") <= 3 for e in lentos)


def test_avanzadas_host_usa_la_ultima_lectura_y_series_de_promedios(client, db_session):
    _sembrar_avanzadas(db_session)

    host = client.get(RUTA_AVANZADAS + "?rango=1h").json()["host"]

    assert host["memory"]["usedMb"] == 2350 and host["memory"]["totalMb"] == 3900
    assert host["swap"]["usedMb"] == 214 and host["swap"]["totalMb"] == 1024
    assert host["cpuPercent"]["values"][59] == 40.0 and host["cpuPercent"]["values"][58] == 20.0
    assert host["updatedAt"] == "2026-10-01T15:28:55-05:00"


def test_avanzadas_runtime_y_usuarios_salen_de_la_ultima_instantanea(client, db_session):
    _sembrar_avanzadas(db_session)

    cuerpo = client.get(RUTA_AVANZADAS + "?rango=1h").json()

    assert cuerpo["runtime"]["containers"] == [{"name": "backend", "usedMb": 262, "limitMb": 320}]
    assert cuerpo["runtime"]["database"] == {"connectionsUsed": 14, "connectionsMax": 100}
    assert cuerpo["runtime"]["redis"] == {"usedMb": 22.4, "maxMb": 48.0}
    assert cuerpo["runtime"]["queues"] == {
        "celeryPending": 3, "notificationsPending": 12, "oldestNotificationMinutes": 47,
    }
    usuarios = cuerpo["users"]
    assert usuarios["connectedNow"] == 9
    assert usuarios["sessionsByRole"] == {"admin": 1, "trainer": 1, "estudiante": 5, "representante": 2}
    assert usuarios["loginsOk"] == 3 and usuarios["loginsFailed"] == 1   # suma de los deltas del rango


def test_avanzadas_host_viejo_se_informa_como_no_disponible(client, db_session):
    # Solo una instantánea SIN columnas de host: el cron del host no estaba escribiendo.
    _instantanea(db_session, intervalo_s=60, peticiones=10, errores_5xx=0, errores_4xx=0, latencia_buckets=[1] * 12)

    cuerpo = client.get(RUTA_AVANZADAS + "?rango=1h").json()

    assert cuerpo["host"] is None
    assert cuerpo["service"] is not None and cuerpo["runtime"]["containers"] == []


def test_avanzadas_es_solo_agregados(client, db_session):
    _sembrar_avanzadas(db_session)
    fab.usuario(db_session, TipoRol.ALUMNO)

    for rango in ("1h", "24h", "7d"):
        cuerpo = client.get(RUTA_AVANZADAS + f"?rango={rango}").json()
        assert not (_claves(cuerpo) & PROHIBIDAS), _claves(cuerpo) & PROHIBIDAS
        assert not any("@" in t for t in _textos(cuerpo))
