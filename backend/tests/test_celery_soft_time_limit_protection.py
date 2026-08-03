"""
Prueba de runtime del escenario "Un incumplimiento del límite blando se
reintenta, no se pierde" (Requirement: Celery Worker Time-Limit Protection,
`sdd/external-service-resilience`).

Hallazgo de la verificación anterior: `SoftTimeLimitExceeded` solo aparecía
en comentarios/docstrings del repo, nunca ejercitada. Este archivo la
ejercita de verdad contra una tarea DECORADA real
(`generar_comprobante_pdf_tarea`, `comprobante_tareas.py`), no un doble
sintético.

Mecánica: se empuja al contexto de la tarea (`push_request`) la misma forma
que arma el tracer real de Celery al ejecutar una tarea entregada por el
broker -- `called_directly=False` (`celery/app/trace.py::trace_task`,
verificado leyendo el fuente instalado) -- y se hace fallar el primer paso
real de la tarea (`SessionLocal()`) con `SoftTimeLimitExceeded`. Así la
excepción atraviesa el `run` que `add_autoretry_behaviour` ya envolvió al
decorar la tarea con `autoretry_for=(Exception,)`
(`celery/app/autoretry.py`), no una copia de ese mecanismo.
"""
from billiard.exceptions import SoftTimeLimitExceeded
from celery.exceptions import Retry

from app.infraestructura.tareas import comprobante_tareas as ct


def test_soft_time_limit_exceeded_es_subclase_de_exception():
    """El diseño se apoya en que `SoftTimeLimitExceeded` (billiard) hereda de
    `Exception` -- por eso `autoretry_for=(Exception,)` la atrapa. Es un
    hecho del SDK instalado, no del docstring: se afirma en runtime en vez
    de confiar en la documentación del diseño."""
    assert issubclass(SoftTimeLimitExceeded, Exception)


def test_soft_time_limit_exceeded_se_reintenta_no_se_pierde(monkeypatch):
    """Si `generar_comprobante_pdf_tarea` excede el límite blando de Celery
    (`task_soft_time_limit`, `celery_app.py`), el worker inyecta
    `SoftTimeLimitExceeded` dentro de la ejecución. El wrapper de
    `autoretry_for=(Exception,)` con el que la tarea ya está decorada debe
    atraparla y devolver una señal de reintento (`celery.exceptions.Retry`)
    -- NO dejar que la excepción cruda se pierda ni mate la tarea."""
    def _excede_limite_blando(*args, **kwargs):
        raise SoftTimeLimitExceeded()

    monkeypatch.setattr(ct, "SessionLocal", _excede_limite_blando)

    tarea = ct.generar_comprobante_pdf_tarea
    tarea.push_request(
        id="test-soft-time-limit", retries=0, is_eager=True,
        called_directly=False, task=tarea.name,
    )
    try:
        capturada = None
        try:
            tarea.run(1)
        except Retry as retry:
            capturada = retry

        assert capturada is not None, (
            "se esperaba que autoretry_for programara un reintento "
            "(celery.exceptions.Retry); la excepcion se perdio o "
            "propago sin que nada la reintentara"
        )
        assert isinstance(capturada.exc, SoftTimeLimitExceeded), (
            "el reintento debe originarse en el SoftTimeLimitExceeded "
            "real, no en otra excepcion"
        )
    finally:
        tarea.pop_request()
