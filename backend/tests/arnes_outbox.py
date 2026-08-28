"""
Arnés compartido para las pruebas de las colas de salida (outbox) por correo.

Probar una cola de punta a punta -- de la fila `PENDIENTE` al `sendmail` --
exige siempre el mismo andamiaje: inyectar la sesión del test en el módulo de
tareas, poner Celery en modo eager, dar credenciales SMTP falsas, recoger los
registros que `caplog` no ve, y leer el MIME que salió. Nada de eso dice qué
tiene que hacer la cola; es la mesa sobre la que se apoya la prueba.

Solo vive acá el ANDAMIAJE. Lo que cada cola debe hacer se escribe entero en
su propio archivo de pruebas, al lado del comportamiento que describe:
compartir las expectativas -- y no solo la mesa -- es lo que vuelve ilegible
un test y acopla dos suites hasta que arreglar una rompe la otra. Mismo
criterio que `fabricas_auth.py`, `fabricas_pagos.py` y `arnes_migraciones.py`.

`test_recuperacion_extremo_a_extremo.py` conserva a propósito sus propias
copias: es una suite viva que protege un camino en producción, y reescribirla
para estrenar este módulo pondría en riesgo justo lo que ella custodia. Cuando
haya que tocarla por otro motivo, este arnés ya está acá.
"""
from __future__ import annotations

import logging
from contextlib import contextmanager
from email import message_from_string

from app.soporte_transversal.configuracion import settings


@contextmanager
def sesion_inyectada_en(modulo, db_session, monkeypatch):
    """Hace que las tareas de `modulo` usen la sesión del test.

    Las tareas abren su propia sesión vía el `SessionLocal` de SU módulo, que
    no vería nada de lo que el test escribió dentro de su transacción externa.
    Se parchea ese nombre y no el de `outbox_despacho`, porque es el que las
    tareas resuelven en el momento de la llamada.
    """

    @contextmanager
    def _factory():
        yield db_session

    monkeypatch.setattr(modulo, "SessionLocal", _factory)
    yield db_session


def celery_en_proceso(modulo, monkeypatch) -> None:
    """Activa el modo eager REAL de Celery: la publicación y el despacho
    siguen pasando por su maquinaria en vez de parchear `.delay`."""
    monkeypatch.setattr(modulo.celery_app.conf, "task_always_eager", True)
    monkeypatch.setattr(modulo.celery_app.conf, "task_eager_propagates", True)


def configurar_smtp(monkeypatch) -> None:
    """Credenciales SMTP falsas pero no vacías: `enviar_correo` exige un host
    configurado antes de intentar nada, y el socket se mockea aparte."""
    monkeypatch.setattr(settings, "smtp_host", "smtp.test")
    monkeypatch.setattr(settings, "smtp_port", 587)
    monkeypatch.setattr(settings, "smtp_user", "")
    monkeypatch.setattr(settings, "smtp_starttls", False)


@contextmanager
def logs_recogidos(nombre_logger: str, nivel: int = logging.WARNING):
    """Registros emitidos por `nombre_logger` mientras dura el bloque.

    Se engancha un handler propio en vez de usar `caplog`: estas tareas se
    invocan como `Task.__call__` de Celery, que reconfigura el logging del
    proceso, y el handler que pytest instala en el raíz deja de verlas.
    """
    registros: list[logging.LogRecord] = []

    class _Coleccionista(logging.Handler):
        def emit(self, record):
            registros.append(record)

    handler = _Coleccionista(level=nivel)
    logger = logging.getLogger(nombre_logger)
    nivel_previo = logger.level
    logger.addHandler(handler)
    logger.setLevel(nivel)
    try:
        yield registros
    finally:
        logger.removeHandler(handler)
        logger.setLevel(nivel_previo)


def mensaje_enviado(smtp_cls):
    """(remitente, destinatario, mensaje) del ÚNICO `sendmail` que hubo.

    El mensaje se devuelve ya parseado: las partes viajan en base64, así que
    buscar un enlace sobre el texto crudo no encuentra nada.
    """
    servidor = smtp_cls.return_value.__enter__.return_value
    assert servidor.sendmail.call_count == 1, (
        f"se esperaba exactamente un sendmail, hubo {servidor.sendmail.call_count}"
    )
    remitente, destinatario, crudo = servidor.sendmail.call_args.args
    return remitente, destinatario, message_from_string(crudo)


def texto_plano(mensaje) -> str:
    for parte in mensaje.walk():
        if parte.get_content_type() == "text/plain":
            return parte.get_payload(decode=True).decode("utf-8")
    raise AssertionError("el mensaje no tiene una parte text/plain")


def sendmail_de(smtp_cls):
    """El mock de `sendmail`, para afirmar que NO se llamó."""
    return smtp_cls.return_value.__enter__.return_value.sendmail
