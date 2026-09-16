"""Retención del contador diario de envíos SMTP (guardarraíl de Resend).

`contador_correo_diario` crece una fila por día UTC y no identifica a nadie:
pasada su ventana solo queda basura operativa. Lo que estos tests fijan:
  - las fechas anteriores a la ventana se borran;
  - la ventana reciente se conserva, incluida la fecha límite exacta (el
    borde importa: un `<` que se vuelva `<=` borraría un día de historia que
    el contador todavía declara suyo);
  - una segunda corrida no borra nada (idempotencia real, no accidental).

Misma inyección de sesión que `test_limite_correos_diario.py`: la sesión del
test entra por el `SessionLocal` del módulo, así que los `commit()` de la
tarea liberan un SAVEPOINT y el teardown del `db_session` descarta todo.

Aislamiento: la tabla es COMPARTIDA por toda la suite y otros archivos que
corren antes (p. ej. `test_alertas_*`, que commitea filas reales vía el
`SessionLocal` de producción del servicio de tope) dejan la fila de hoy
asentada. Cada test arranca limpiando la tabla por la sesión inyectada, de
modo que las igualdades exactas se miden sobre una tabla que el test posee
(el teardown del SAVEPOINT restituye lo borrado al resto de la suite).
Datos ficticios.
"""
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

import pytest

from app.dominio.modelos import ContadorCorreoDiario
from app.infraestructura.tareas import contador_correo_tareas as tareas


def _dia_utc(offset_dias: int):
    return datetime.now(timezone.utc).date() + timedelta(days=offset_dias)


@pytest.fixture()
def contador_inyectado(db_session, monkeypatch):
    """La tarea real, sobre la transacción del test. La fábrica cede la sesión
    SIN cerrarla -- el cierre de producción expulsaría a los objetos que el
    test ya tiene cargados (mismo recurso que `contador_aislado` en
    `test_limite_correos_diario`)."""

    @contextmanager
    def _factory():
        yield db_session

    monkeypatch.setattr(tareas, "SessionLocal", _factory)
    # La tabla es compartida: suites previas dejan filas commiteadas (p. ej. la
    # fila de hoy del reserve del tope). El test toma posesión desde vacío y
    # el rollback del savepoint del `db_session` restituye el estado al resto.
    db_session.query(ContadorCorreoDiario).delete(synchronize_session=False)
    db_session.commit()
    return db_session


def _sembrar(sesion, *offsets: int) -> None:
    for offset in offsets:
        sesion.add(ContadorCorreoDiario(fecha=_dia_utc(offset), enviados=7))
    sesion.commit()


def _fechas(sesion) -> set:
    return {fila.fecha for fila in sesion.query(ContadorCorreoDiario).all()}


def test_borra_las_filas_anteriores_a_la_ventana_de_retencion(contador_inyectado):
    _sembrar(contador_inyectado, -200, -91)

    resultado = tareas.limpiar_contador_correo_diario()

    assert resultado["eliminadas"] == 2
    assert resultado["fecha_limite"] == _dia_utc(
        -tareas.DIAS_RETENCION_CONTADOR_CORREO
    ).isoformat()
    assert _fechas(contador_inyectado) == set()


def test_conserva_la_ventana_reciente_incluida_la_fecha_limite(contador_inyectado):
    """Hoy, ayer y el borde exacto de la ventana sobreviven: el corte es
    estricto (`<`), no `<=`."""
    _sembrar(
        contador_inyectado,
        0,
        -1,
        -tareas.DIAS_RETENCION_CONTADOR_CORREO,
        -tareas.DIAS_RETENCION_CONTADOR_CORREO - 1,
    )

    resultado = tareas.limpiar_contador_correo_diario()

    assert resultado["eliminadas"] == 1
    assert _fechas(contador_inyectado) == {
        _dia_utc(0),
        _dia_utc(-1),
        _dia_utc(-tareas.DIAS_RETENCION_CONTADOR_CORREO),
    }


def test_una_segunda_corrida_no_borra_nada(contador_inyectado):
    _sembrar(contador_inyectado, -300, -120, -2)

    primera = tareas.limpiar_contador_correo_diario()
    segunda = tareas.limpiar_contador_correo_diario()

    assert primera["eliminadas"] == 2
    assert segunda["eliminadas"] == 0
    assert _fechas(contador_inyectado) == {_dia_utc(-2)}
