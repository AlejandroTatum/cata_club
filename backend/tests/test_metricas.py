"""
Contrato de `GET /metrics` (issue #1309): formato de exposición Prometheus,
las TRES series HTTP que documenta `docs/operations/metricas.md`, gauges
propios sobre las tres colas outbox (camino feliz y falla de BD) y el techo
de tiempo del scrape.

Las series HTTP (`http_request_duration_seconds`, `http_requests_total`,
`http_requests_inprogress`) las prueba
`test_metrics_incluye_las_series_http_del_instrumentator` contra un scrape
real -- los tres nombres se verificaron imprimiendo el body de `/metrics`
antes de escribir la aserción, no se copiaron de la documentación de la
librería (que para `http_requests_inprogress` ni siquiera coincide: ese
gauge es opt-in, ver `main.py`). Si algún día un nombre documentado deja de
aparecer en un scrape real, lo que cambia es la doc, nunca esta aserción.

Registrar el colector NO debe tocar la BD
(`test_registrar_el_colector_no_abre_ninguna_sesion_de_bd`): el `REGISTRY`
default de `prometheus_client` se crea con `auto_describe=True`, así que sin
un `describe()` propio el simple `REGISTRY.register(colector_outbox)` de
`main.py` corría el scrape completo al IMPORTAR el módulo -- ver el
docstring de `ColectorOutbox.describe()` en `metricas.py` para el porqué es
grave (un Postgres todavía no listo cuelga el import, no solo lo demora).

Los gauges propios de outbox (`ColectorOutbox`,
`app/infraestructura/metricas.py`) se prueban en tres niveles a propósito,
y las dos pruebas que siembran filas encierran el MISMO invariante -- que la
base de test es compartida entre sesiones de pytest y no se puede asumir
vacía -- por dos caminos distintos:

- `calcular_pendientes_por_tabla` se llama DIRECTO con `db_session` (la
  sesión de savepoint del test): el colector real abre su PROPIA conexión
  vía `SessionLocal()`, así que una fila sembrada por `db_session` y nunca
  comiteada de verdad (solo liberada como SAVEPOINT, ver el docstring de la
  fixture en `conftest.py`) es invisible para esa segunda conexión. Probar
  la función pura contra la misma sesión que sembró es la única forma de ver
  el cálculo sin comitear datos reales a la base compartida. Esta prueba
  ADEMÁS vacía las tres tablas outbox al arrancar (`_vaciar_tablas_outbox`,
  dentro de la misma transacción que hace rollback en el teardown) para
  poder afirmar cuentas ABSOLUTAS sin asumir un punto de partida vacío.
- El camino feliz TAMBIÉN se prueba por HTTP, de punta a punta
  (`test_metrics_via_http_refleja_las_filas_sembradas_y_scrape_ok`):
  `_SesionSinCierre` envuelve a `db_session` y se inyecta como
  `sesion_factory` del colector real, así que `/metrics` consulta la MISMA
  transacción que sembró, sin comitear nada a la base compartida. Acá, en
  vez de vaciar las tablas, las aserciones son relativas a una línea de
  base leída ANTES de sembrar -- las dos formas resuelven el mismo problema.
- La resiliencia a una falla de BD (`cata_outbox_scrape_ok 0`) se prueba por
  HTTP, sobre `main.colector_outbox`: no depende de datos sembrados, solo de
  que la excepción no escape. Se prueba dos veces: una con una factory que
  lanza directo (falla de conexión) y otra con una consulta real contra
  Postgres que excede el `statement_timeout` del scrape
  (`test_scrape_con_una_consulta_que_excede_el_timeout_da_scrape_ok_0`) --
  esta última no mockea nada, deja que Postgres cancele la consulta de
  verdad con `pg_sleep`.
"""
import re
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from prometheus_client import CollectorRegistry
from sqlalchemy import text

import main
import app.infraestructura.metricas as metricas_mod
from app.dominio.cedula import cedula_valida
from app.dominio.modelos import (
    EnrollmentNotificacionOutbox,
    Persona,
    RecuperacionOutbox,
    Usuario,
    VerificacionCorreoOutbox,
)
from app.infraestructura.metricas import calcular_pendientes_por_tabla
from main import app


# --- GET /metrics: formato de exposición y las tres series HTTP -------------
def test_metrics_responde_200_con_formato_de_exposicion_prometheus():
    with TestClient(app) as cliente:
        cliente.get("/health")  # genera al menos una muestra HTTP antes del scrape
        respuesta = cliente.get("/metrics")
    assert respuesta.status_code == 200
    assert respuesta.headers["content-type"].startswith("text/plain")


def test_metrics_incluye_las_series_http_del_instrumentator():
    """Las tres series que promete `docs/operations/metricas.md`. Los
    nombres son los REALES de un scrape (`prometheus-fastapi-
    instrumentator==8.1.0` sobre `prometheus-client==0.26.0`), no los
    defaults de la librería -- `http_requests_inprogress` en particular es
    opt-in (`should_instrument_requests_inprogress=True` en `main.py`) y sin
    eso la serie no aparece."""
    with TestClient(app) as cliente:
        cliente.get("/health")
        respuesta = cliente.get("/metrics")
    cuerpo = respuesta.text
    assert "http_request_duration_seconds" in cuerpo
    assert "http_requests_total" in cuerpo
    assert "http_requests_inprogress" in cuerpo


# --- /metrics no vive bajo /api/v1 y no aparece en el esquema ---------------
def test_metrics_no_esta_bajo_api_v1():
    with TestClient(app) as cliente:
        respuesta = cliente.get("/api/v1/metrics")
    assert respuesta.status_code == 404


def test_metrics_no_aparece_en_el_esquema_openapi():
    assert "/metrics" not in app.openapi()["paths"]


# --- Registrar el colector no debe tocar la BD (defecto de import) ---------
def test_registrar_el_colector_no_abre_ninguna_sesion_de_bd():
    """Defecto de import descubierto en revisión nativa (issue #1309): el
    `REGISTRY` default de `prometheus_client` se crea con
    `auto_describe=True` (`prometheus_client/registry.py::REGISTRY`). Sin un
    método `describe()` propio, `CollectorRegistry.register()` usa
    `collect()` como su propia función de descripción -- lo LLAMA ahí mismo,
    durante el registro, para saber qué nombres de serie declara.

    `REGISTRY.register(colector_outbox)` corre a nivel de módulo en
    `main.py`, así que sin `describe()` el simple IMPORT de `main` abría una
    sesión de BD y corría las tres consultas del scrape antes de que uvicorn
    sirviera un solo request -- con Postgres todavía sin aceptar conexiones
    (orden de arranque de Compose, un restart de la base), el import se
    colgaba esperando el connect TCP, algo que `TIMEOUT_SCRAPE_SENTENCIA_MS`
    no cubre (ese timeout es un `SET LOCAL statement_timeout`, y nunca llega
    a correr ninguna sentencia si la conexión ni siquiera se estableció).

    Se prueba contra un `CollectorRegistry` PROPIO -- no el `REGISTRY`
    global de `prometheus_client`, que ya tiene registrado el colector real
    desde que se importó `main` -- para poder observar el registro de un
    colector NUEVO sin interferir con el resto de la suite. La factory
    inyectada lanza si se la llama; `collect()` ya captura cualquier
    excepción de `sesion_factory()` (ver `ColectorOutbox.collect`), así que
    esto no revienta el test -- solo deja evidencia de si se llamó."""
    llamadas = []

    def _factory_que_registra_la_llamada():
        llamadas.append(True)
        raise RuntimeError("no debería llegar a llamarse durante el registro")

    colector = metricas_mod.ColectorOutbox(sesion_factory=_factory_que_registra_la_llamada)
    registro_propio = CollectorRegistry(auto_describe=True)

    registro_propio.register(colector)  # no debe tocar la sesión

    assert llamadas == []


# --- Gauges propios de las colas outbox -------------------------------------
def _persona(db_session, semilla: int, nombres="Outbox", apellidos="Metricas"):
    p = Persona(
        nombres=nombres, apellidos=apellidos, cedula=cedula_valida(700 + semilla),
        fecha_nacimiento=datetime(1990, 1, 1).date(), telefono="0991234567",
    )
    db_session.add(p)
    db_session.flush()
    return p


def _usuario(db_session, semilla: int):
    persona = _persona(db_session, semilla, nombres="Usuario", apellidos="Outbox")
    usuario = Usuario(correo=f"outbox-metricas-{semilla}@x.com", contrasenia="hash", persona=persona)
    db_session.add(usuario)
    db_session.flush()
    return usuario


def _sembrar_un_pendiente_y_un_no_pendiente(db_session, semilla: int):
    """Una fila PENDIENTE (con `created_at` una hora atrás, para que la edad
    sea > 0) y una NO pendiente (`ENVIADO`) en `enrollment_notificacion_outbox`
    y en `recuperacion_outbox`. Devuelve nada: el llamador lee los gauges."""
    admin = _persona(db_session, semilla, nombres="Admin")
    alumno_pendiente = _persona(db_session, semilla + 1, nombres="AlumnoPendiente")
    alumno_enviado = _persona(db_session, semilla + 2, nombres="AlumnoEnviado")

    hace_una_hora = datetime.now(timezone.utc) - timedelta(hours=1)
    pendiente = EnrollmentNotificacionOutbox(
        admin_persona_id=admin.id, alumno_persona_id=alumno_pendiente.id,
        mensaje="mensaje pendiente", created_at=hace_una_hora,
    )
    enviado = EnrollmentNotificacionOutbox(
        admin_persona_id=admin.id, alumno_persona_id=alumno_enviado.id,
        mensaje="mensaje ya enviado", status="ENVIADO", sent_at=datetime.now(timezone.utc),
    )
    db_session.add_all([pendiente, enviado])

    usuario = _usuario(db_session, semilla + 3)
    recuperacion_pendiente = RecuperacionOutbox(
        usuario_id=usuario.id, expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
    )
    db_session.add(recuperacion_pendiente)
    db_session.commit()


def _vaciar_tablas_outbox(db_session):
    """Borra las tres tablas outbox DENTRO de la transacción del test.

    La fixture `db_session` hace rollback en su teardown (ver
    `conftest.py`), así que este borrado no toca la base compartida para el
    resto de la suite -- se descarta solo, igual que todo lo demás que el
    test escribe. Deja a `test_gauge_de_pendientes_cuenta_solo_las_filas_
    pendientes_por_tabla` libre de asumir cuántas filas pendientes YA había
    (R3): en vez de una línea de base relativa (como en la variante HTTP de
    abajo), acá se garantiza un punto de partida vacío y se mantienen las
    aserciones absolutas, sin perder la afirmación de que la edad es
    EXACTAMENTE `0.0` -- no solo `>= 0` -- cuando una tabla no tiene ninguna
    fila pendiente."""
    for modelo in (EnrollmentNotificacionOutbox, RecuperacionOutbox, VerificacionCorreoOutbox):
        db_session.query(modelo).delete()
    db_session.flush()


def test_gauge_de_pendientes_cuenta_solo_las_filas_pendientes_por_tabla(db_session):
    _vaciar_tablas_outbox(db_session)
    _sembrar_un_pendiente_y_un_no_pendiente(db_session, semilla=1)

    metricas = calcular_pendientes_por_tabla(db_session)

    cantidad_enrollment, edad_enrollment = metricas["enrollment_notificacion_outbox"]
    assert cantidad_enrollment == 1  # solo la fila PENDIENTE, no la ENVIADO
    # `created_at` quedó EXACTAMENTE una hora atrás, así que la edad ronda los
    # 3600 s; la banda de ±100 s deja lugar al tiempo de ejecución del test y, a
    # la vez, atrapa un error de zona horaria de varias horas o un valor en
    # milisegundos (que daría ~3.6e6), cosas que un `> 0` dejaba pasar.
    assert 3500 <= edad_enrollment <= 3700

    cantidad_recuperacion, edad_recuperacion = metricas["recuperacion_outbox"]
    assert cantidad_recuperacion == 1
    # Esta fila se sembró sin `created_at` explícito: usa el default del modelo
    # (`_ahora_utc`, aware y del lado del cliente), así que su edad es ~0.
    assert 0 <= edad_recuperacion <= 120

    cantidad_verificacion, edad_verificacion = metricas["verificacion_correo_outbox"]
    assert cantidad_verificacion == 0
    assert edad_verificacion == 0.0  # sin filas pendientes: edad 0, no None ni negativa


class _SesionFalsa:
    """Sesión mínima SIN base de datos: `.execute(...)` devuelve siempre una
    fila `(1, created_at)` fija. `calcular_pendientes_por_tabla` corre UNA
    consulta por tabla, así que una sola respuesta sirve para las tres."""

    def __init__(self, mas_antigua):
        self._mas_antigua = mas_antigua

    def execute(self, _sentencia):
        class _Resultado:
            def __init__(self, valor):
                self._valor = valor

            def one(_self):
                return (1, self._mas_antigua)

        return _Resultado(self._mas_antigua)


def test_la_edad_interpreta_un_created_at_naive_como_utc():
    """Rama de fallback de `calcular_pendientes_por_tabla` (metricas.py): si
    `created_at` llega SIN tzinfo -- una columna `timestamp` sin `timezone`, o
    un driver que devuelve naive -- la función lo reinterpreta como UTC antes
    de restar. Sin ese `replace` la resta aware-vs-naive explota con
    `TypeError`. No toca la base: la sesión es un doble que responde una fila
    `(1, created_at)` por tabla."""
    naive_hace_una_hora = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=1)

    metricas = calcular_pendientes_por_tabla(_SesionFalsa(naive_hace_una_hora))

    for _tabla, (_cantidad, edad) in metricas.items():
        assert 3500 <= edad <= 3700


def test_la_edad_clampea_a_cero_un_created_at_naive_en_el_futuro():
    """El otro borde del mismo fallback: un `created_at` en el futuro (un
    reloj de cliente adelantado) no debe producir una edad negativa --
    `max(0.0, ...)` la clampea a `0.0`."""
    naive_en_el_futuro = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=1)

    metricas = calcular_pendientes_por_tabla(_SesionFalsa(naive_en_el_futuro))

    for _tabla, (_cantidad, edad) in metricas.items():
        assert edad == 0.0


class _SesionSinCierre:
    """Envoltorio que delega TODO en la sesión real pero ignora `close()`.

    `ColectorOutbox.collect()` cierra la sesión que abre (issue #1309, ver
    `metricas.py`); acá esa sesión es la MISMA `db_session` que el resto del
    test usa para sembrar y para el teardown de la fixture -- cerrarla de
    verdad adentro de `collect()` dejaría el teardown de `conftest.py`
    (`sesion.close(); transaccion.rollback(); conexion.close()`) operando
    sobre una sesión ya cerrada."""

    def __init__(self, sesion):
        self._sesion = sesion

    def __getattr__(self, nombre):
        return getattr(self._sesion, nombre)

    def close(self):
        pass


def _valor_gauge_por_tabla(cuerpo: str, metrica: str, tabla: str) -> float:
    patron = rf'^{re.escape(metrica)}\{{tabla="{re.escape(tabla)}"\}} ([0-9.eE+-]+)$'
    coincidencia = re.search(patron, cuerpo, re.MULTILINE)
    assert coincidencia, f'no se encontró la serie {metrica}{{tabla="{tabla}"}} en el scrape'
    return float(coincidencia.group(1))


def test_metrics_via_http_refleja_las_filas_sembradas_y_scrape_ok(db_session, monkeypatch):
    """Camino feliz de punta a punta: sembrar, pegarle a `/metrics` por HTTP
    (no llamar a la función pura) y leer las series de outbox del body.

    Relativo a una línea de base leída ANTES de sembrar -- no cuentas
    absolutas: la base de test es compartida entre sesiones de pytest, y
    asumir que arranca vacía es justo el hallazgo que motivó esta prueba
    (R3)."""
    base = calcular_pendientes_por_tabla(db_session)
    base_enrollment = base["enrollment_notificacion_outbox"][0]
    base_recuperacion = base["recuperacion_outbox"][0]
    base_verificacion = base["verificacion_correo_outbox"][0]
    base_edad_enrollment = base["enrollment_notificacion_outbox"][1]
    base_edad_recuperacion = base["recuperacion_outbox"][1]
    base_edad_verificacion = base["verificacion_correo_outbox"][1]

    _sembrar_un_pendiente_y_un_no_pendiente(db_session, semilla=10)

    monkeypatch.setattr(main.colector_outbox, "sesion_factory", lambda: _SesionSinCierre(db_session))

    with TestClient(app) as cliente:
        respuesta = cliente.get("/metrics")

    assert respuesta.status_code == 200
    cuerpo = respuesta.text

    assert re.search(r"^cata_outbox_scrape_ok\s+1\.0$", cuerpo, re.MULTILINE)

    assert _valor_gauge_por_tabla(
        cuerpo, "cata_outbox_pendientes", "enrollment_notificacion_outbox"
    ) == base_enrollment + 1  # solo la fila PENDIENTE sembrada, no la ENVIADO
    assert _valor_gauge_por_tabla(
        cuerpo, "cata_outbox_pendientes", "recuperacion_outbox"
    ) == base_recuperacion + 1
    assert _valor_gauge_por_tabla(
        cuerpo, "cata_outbox_pendientes", "verificacion_correo_outbox"
    ) == base_verificacion  # no se sembró nada acá: sin cambio

    # La serie de EDAD también sale por HTTP. La fila sembrada en enrollment
    # tiene una hora exacta, así que si llega a ser la más antigua la edad salta
    # a ~3600 s; si ya había una más vieja, `base_edad_enrollment` manda. El
    # `max` cubre las dos; la ventana de segundos acota que el valor no sea
    # milisegundos ni horas corridas (el hallazgo que dejaba pasar `> 0`).
    edad_enrollment = _valor_gauge_por_tabla(
        cuerpo, "cata_outbox_pendiente_mas_antiguo_segundos", "enrollment_notificacion_outbox"
    )
    esperado_enrollment = max(base_edad_enrollment, 3600)
    assert esperado_enrollment - 10 <= edad_enrollment <= esperado_enrollment + 120

    # Recuperación y verificación solo pueden sembrarse filas MÁS NUEVAS que la
    # más antigua preexistente (o ninguna), y una edad nunca retrocede EN ESTE
    # intervalo: el valor después del scrape queda pegado a la línea de base.
    edad_recuperacion = _valor_gauge_por_tabla(
        cuerpo, "cata_outbox_pendiente_mas_antiguo_segundos", "recuperacion_outbox"
    )
    assert base_edad_recuperacion - 10 <= edad_recuperacion <= base_edad_recuperacion + 120

    edad_verificacion = _valor_gauge_por_tabla(
        cuerpo, "cata_outbox_pendiente_mas_antiguo_segundos", "verificacion_correo_outbox"
    )
    assert base_edad_verificacion - 10 <= edad_verificacion <= base_edad_verificacion + 120


# --- Resiliencia: una falla de BD no tumba /metrics -------------------------
def test_scrape_ok_es_0_si_falla_la_consulta_pero_las_series_http_siguen(monkeypatch):
    def _factory_que_falla():
        raise RuntimeError("Postgres no responde")

    monkeypatch.setattr(main.colector_outbox, "sesion_factory", _factory_que_falla)

    with TestClient(app) as cliente:
        cliente.get("/health")
        respuesta = cliente.get("/metrics")

    assert respuesta.status_code == 200
    cuerpo = respuesta.text
    assert re.search(r"^cata_outbox_scrape_ok\s+0\.0$", cuerpo, re.MULTILINE)
    assert "http_request_duration_seconds" in cuerpo
    # El HELP/TYPE del gauge sigue apareciendo (la familia está registrada),
    # pero sin muestras: ninguna línea de dato `cata_outbox_pendientes{...}`.
    assert not re.search(r"^cata_outbox_pendientes\{", cuerpo, re.MULTILINE)


def test_scrape_con_una_consulta_que_excede_el_timeout_da_scrape_ok_0(monkeypatch):
    """Contra Postgres REAL, sin mockear nada: un `pg_sleep` más largo que
    `TIMEOUT_SCRAPE_SENTENCIA_MS` deja que Postgres cancele la consulta con
    `QueryCanceled` -- el mismo camino de `except Exception` que una falla de
    conexión, pero disparado por el techo de tiempo, no por una factory que
    lanza. `/metrics` sigue respondiendo 200."""
    def _consulta_que_excede_el_timeout(db):
        db.execute(text("SELECT pg_sleep(3)"))
        return {}

    monkeypatch.setattr(metricas_mod, "calcular_pendientes_por_tabla", _consulta_que_excede_el_timeout)

    with TestClient(app) as cliente:
        cliente.get("/health")
        respuesta = cliente.get("/metrics")

    assert respuesta.status_code == 200
    assert re.search(r"^cata_outbox_scrape_ok\s+0\.0$", respuesta.text, re.MULTILINE)


def test_scrape_aplica_un_statement_timeout_acotado_a_su_sesion(db_session, monkeypatch):
    """Unitaria y barata: confirma que el `SET LOCAL` corrió, sin depender
    de esperar un timeout real. Reusa `_SesionSinCierre` para inspeccionar,
    con la MISMA sesión/transacción, el `statement_timeout` que
    `ColectorOutbox.collect()` dejó activo.

    Se lee `pg_settings.setting` y no `SHOW statement_timeout`: `SHOW`
    normaliza a la unidad humana más grande (`2000` ms sale como `'2s'`),
    mientras que `pg_settings` devuelve el valor crudo en milisegundos tal
    como se fijó -- comparar contra eso es lo que no se rompe si cambia
    cómo Postgres decide formatear la salida de `SHOW`."""
    monkeypatch.setattr(main.colector_outbox, "sesion_factory", lambda: _SesionSinCierre(db_session))

    list(main.colector_outbox.collect())  # agota el generador: corre el scrape completo

    valor = db_session.execute(
        text("SELECT setting FROM pg_settings WHERE name = 'statement_timeout'")
    ).scalar()
    assert valor == str(metricas_mod.TIMEOUT_SCRAPE_SENTENCIA_MS)
