"""La junta que nadie probaba: de una fila `PENDIENTE` a un correo enviado.

`test_recuperacion_honesta.py` prueba que el request deja la fila en el
outbox, `test_recuperacion_outbox.py` prueba el repositorio aislado y
`test_notificaciones.py` prueba el adaptador SMTP contra un `smtplib`
parcheado. Los tres eslabones estaban cubiertos por separado y la junta
nunca: ningún test corría
`despachar_recuperaciones_pendientes` -> `procesar_recuperacion_outbox` ->
`enviar_recuperacion_contrasenia` en secuencia (issue #764).

Acá se corre esa cadena de verdad. Lo único que se sustituye es el socket:
`smtplib.SMTP` se parchea igual que en `test_notificaciones.py`, que es el
último punto antes de la red. Todo lo demás -- el reclamo con lease, el
commit, la publicación por Celery, la acuñación del token y el armado del
mensaje -- es el código de producción.
"""
import logging
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from email import message_from_string
from email.header import decode_header, make_header
from unittest.mock import MagicMock, patch

import pytest

from app.dominio.cedula import cedula_valida
from app.dominio.modelos import RecuperacionOutbox
from app.infraestructura.asuntos_correo import ASUNTO_RECUPERACION
from app.infraestructura.repositorios.recuperacion_outbox_repositorio import (
    RecuperacionOutboxRepositorio,
)
from app.infraestructura.tareas import recuperacion_tareas
from app.infraestructura.tareas.recuperacion_tareas import (
    despachar_recuperaciones_pendientes,
    procesar_recuperacion_outbox,
)
from app.soporte_transversal.configuracion import settings

MENSAJE_EXITO = "Si el correo está registrado, se envió un enlace de recuperación"


# ─── Arnés ──────────────────────────────────────────────────────────────────
@pytest.fixture()
def sesion_inyectada(db_session, monkeypatch):
    """Inyecta `db_session` en el `SessionLocal` del módulo de las tareas.

    Mismo criterio que `test_alertas_vencimiento.py::sesion_inyectada`: las
    tareas abren su propia sesión, que no vería nada de lo que este test
    escribió dentro de su transacción externa.
    """

    @contextmanager
    def _factory():
        yield db_session

    monkeypatch.setattr(recuperacion_tareas, "SessionLocal", _factory)
    return db_session


@pytest.fixture()
def celery_sincrono(monkeypatch):
    """`.delay()` corre en el proceso, sin broker.

    No se parchea `delay`: se activa el modo eager REAL de Celery, así que
    la publicación y el despacho siguen pasando por su maquinaria.
    """
    monkeypatch.setattr(recuperacion_tareas.celery_app.conf, "task_always_eager", True)
    monkeypatch.setattr(
        recuperacion_tareas.celery_app.conf, "task_eager_propagates", True
    )


@pytest.fixture()
def logs_de_recuperacion():
    """Registros emitidos por `cataclub.tareas.recuperacion` durante el test.

    Se engancha un handler propio al logger del módulo en vez de usar
    `caplog`: estas tareas se invocan como `Task.__call__` de Celery, que
    reconfigura el logging del proceso, y el handler que pytest instala en el
    raíz deja de ver los registros (comprobado: el mismo `logger.warning`
    aparece en `caplog` si se emite desde el test y no si sale desde adentro
    de la tarea).
    """
    registros: list[logging.LogRecord] = []

    class _Coleccionista(logging.Handler):
        def emit(self, record):
            registros.append(record)

    handler = _Coleccionista(level=logging.WARNING)
    logger = logging.getLogger("cataclub.tareas.recuperacion")
    nivel_previo = logger.level
    logger.addHandler(handler)
    logger.setLevel(logging.WARNING)
    try:
        yield registros
    finally:
        logger.removeHandler(handler)
        logger.setLevel(nivel_previo)


def _mensajes(registros):
    return [registro.getMessage() for registro in registros]


@pytest.fixture()
def smtp_configurado(monkeypatch):
    monkeypatch.setattr(settings, "smtp_host", "smtp.test")
    monkeypatch.setattr(settings, "smtp_port", 587)
    monkeypatch.setattr(settings, "smtp_user", "")
    monkeypatch.setattr(settings, "smtp_starttls", False)


def _crear_persona(client, cedula):
    payload = {
        "nombres": "Test", "apellidos": cedula, "cedula": cedula,
        "fecha_nacimiento": "2000-05-14", "telefono": "0991234567",
    }
    return client.post("/api/v1/personas/", json=payload).json()


def _registrar_credenciales(client, cedula, correo, contrasenia="password123"):
    return client.post(
        "/api/v1/auth/registro",
        json={"cedula": cedula, "correo": correo, "contrasenia": contrasenia},
    )


def _crear_cuenta(client, semilla, correo):
    persona = _crear_persona(client, cedula_valida(semilla))
    respuesta = _registrar_credenciales(client, persona["cedula"], correo)
    assert respuesta.status_code in (200, 201), respuesta.text
    return persona


def _solicitar(client, correo):
    return client.post("/api/v1/auth/recuperar-contrasenia", json={"correo": correo})


def _mensaje_enviado(smtp_cls):
    """Devuelve (remitente, destinatario, mensaje) del único `sendmail`.

    El tercer argumento es el mensaje MIME serializado; se devuelve ya
    parseado porque las partes viajan en base64 y buscar el enlace sobre el
    texto crudo no encuentra nada.
    """
    servidor = smtp_cls.return_value.__enter__.return_value
    assert servidor.sendmail.call_count == 1, (
        f"se esperaba exactamente un sendmail, hubo {servidor.sendmail.call_count}"
    )
    remitente, destinatario, crudo = servidor.sendmail.call_args.args
    return remitente, destinatario, message_from_string(crudo)


def _texto_plano(mensaje):
    for parte in mensaje.walk():
        if parte.get_content_type() == "text/plain":
            return parte.get_payload(decode=True).decode("utf-8")
    raise AssertionError("el mensaje no tiene una parte text/plain")


# ─── La junta completa ──────────────────────────────────────────────────────
def test_una_fila_pendiente_termina_en_un_correo_enviado(
    client, db_session, sesion_inyectada, celery_sincrono, smtp_configurado
):
    """`PENDIENTE` -> despachador -> worker -> SMTP -> `ENVIADO`."""
    _crear_cuenta(client, 560, "puntaapunta@x.com")
    assert _solicitar(client, "puntaapunta@x.com").json()["mensaje"] == MENSAJE_EXITO

    evento = db_session.query(RecuperacionOutbox).one()
    assert evento.status == "PENDIENTE" and evento.sent_at is None

    with patch(
        "app.infraestructura.notificaciones_servicio.smtplib.SMTP", MagicMock()
    ) as smtp_cls:
        resultado = despachar_recuperaciones_pendientes()
        remitente, destinatario, mensaje = _mensaje_enviado(smtp_cls)

    # Issue #841: la corrida reporta además el techo del lote y si lo tocó.
    # El techo se lee de `settings` y no como literal para que este test siga
    # midiendo la única fila que sembró, no el default vigente.
    assert resultado == {
        "reclamadas": 1,
        "tope": settings.celery_outbox_lote_maximo,
        "tope_alcanzado": False,
    }
    assert destinatario == "puntaapunta@x.com"
    assert remitente == settings.smtp_from
    assert mensaje["To"] == "puntaapunta@x.com"
    assert ASUNTO_RECUPERACION in str(make_header(decode_header(mensaje["Subject"])))
    assert "/reset-password?token=" in _texto_plano(mensaje)

    db_session.refresh(evento)
    assert evento.status == "ENVIADO"
    assert evento.sent_at is not None
    assert evento.claimed_at is None
    assert evento.attempts == 1


def test_el_enlace_enviado_restablece_la_contrasenia_de_verdad(
    client, db_session, sesion_inyectada, celery_sincrono, smtp_configurado
):
    """El token lo acuña la tarea, no el request: probamos que sirve."""
    _crear_cuenta(client, 561, "enlaceutil@x.com")
    _solicitar(client, "enlaceutil@x.com")

    with patch(
        "app.infraestructura.notificaciones_servicio.smtplib.SMTP", MagicMock()
    ) as smtp_cls:
        despachar_recuperaciones_pendientes()
        _, _, mensaje = _mensaje_enviado(smtp_cls)

    cuerpo = _texto_plano(mensaje)
    marca = "/reset-password?token="
    assert marca in cuerpo, "el correo no contiene el enlace de restablecimiento"
    token = cuerpo.split(marca, 1)[1].split()[0].strip()

    respuesta = client.post(
        "/api/v1/auth/restablecer-contrasenia",
        json={"token": token, "nueva_contrasenia": "contraseniaNueva1"},
    )
    assert respuesta.status_code == 204, respuesta.text

    login = client.post(
        "/api/v1/auth/login",
        data={"username": "enlaceutil@x.com", "password": "contraseniaNueva1"},
    )
    assert login.status_code == 200, login.text


def test_un_fallo_de_smtp_deja_la_fila_para_reintento_y_no_la_marca_enviada(
    client, db_session, sesion_inyectada, celery_sincrono, smtp_configurado
):
    _crear_cuenta(client, 562, "smtpcaido@x.com")
    _solicitar(client, "smtpcaido@x.com")

    with patch(
        "app.infraestructura.notificaciones_servicio.smtplib.SMTP",
        side_effect=OSError("conexión rechazada"),
    ):
        despachar_recuperaciones_pendientes()

    evento = db_session.query(RecuperacionOutbox).one()
    assert evento.status == "PENDIENTE"
    assert evento.attempts == 1
    assert evento.sent_at is None
    assert evento.last_error_redacted is not None


# ─── Causa D: la búsqueda del correo es sensible a mayúsculas ───────────────
def test_la_solicitud_encuentra_al_usuario_sin_importar_las_mayusculas(
    client, db_session
):
    """Misma dirección, distinta capitalización: tiene que encolar igual.

    Reproducido contra el stack de QA (issue #764): con el correo guardado
    como `admin@cataclub.com`, pedir `Admin@CataClub.com` responde 200 con el
    mensaje de éxito y no crea ninguna fila. El usuario espera un correo que
    nunca se encoló.
    """
    _crear_cuenta(client, 563, "mayusculas@x.com")

    respuesta = _solicitar(client, "MaYuScUlAs@X.CoM")

    assert respuesta.status_code == 200
    assert respuesta.json()["mensaje"] == MENSAJE_EXITO
    assert db_session.query(RecuperacionOutbox).count() == 1, (
        "la solicitud con otra capitalización no encoló nada: el usuario "
        "recibe el mensaje de éxito y jamás le llega el correo"
    )


def test_la_solicitud_ignora_los_espacios_alrededor_del_correo(client, db_session):
    _crear_cuenta(client, 564, "conespacios@x.com")

    respuesta = _solicitar(client, "  conespacios@x.com  ")

    assert respuesta.status_code == 200
    assert db_session.query(RecuperacionOutbox).count() == 1


# ─── Causa E: el dedupe clava la fila estancada ─────────────────────────────
def test_el_reintento_del_usuario_adelanta_la_fila_estancada(client, db_session):
    """"Enviar otro enlace" tiene que volver a intentar, no responder 200 en vano.

    El dedupe reusa la fila activa -- correcto, el índice parcial único lo
    exige -- pero sin adelantar `next_attempt_at` el backoff deja al usuario
    hasta 16 minutos apretando un botón que no hace nada.
    """
    _crear_cuenta(client, 565, "estancado@x.com")
    _solicitar(client, "estancado@x.com")

    evento = db_session.query(RecuperacionOutbox).one()
    repo = RecuperacionOutboxRepositorio(db_session)
    repo.claim_pending()
    repo.requeue(evento, OSError("conexión rechazada"))
    db_session.commit()
    assert evento.status == "PENDIENTE"
    assert evento.next_attempt_at > datetime.now(timezone.utc)

    respuesta = _solicitar(client, "estancado@x.com")

    assert respuesta.status_code == 200
    db_session.refresh(evento)
    assert db_session.query(RecuperacionOutbox).count() == 1, (
        "el dedupe tiene que seguir reusando la fila activa"
    )
    assert evento.next_attempt_at <= datetime.now(timezone.utc), (
        "el usuario pidió otro enlace y la fila sigue esperando el backoff: "
        "el botón responde 200 y no cambia nada"
    )
    assert evento.attempts == 1, "adelantar el intento no perdona los intentos gastados"


def test_el_reintento_del_usuario_no_toca_una_fila_en_vuelo(client, db_session):
    """Una fila `ENVIANDO` está reclamada por un worker: su lease manda."""
    _crear_cuenta(client, 566, "envuelo@x.com")
    _solicitar(client, "envuelo@x.com")

    evento = db_session.query(RecuperacionOutbox).one()
    RecuperacionOutboxRepositorio(db_session).claim_pending()
    db_session.commit()
    assert evento.status == "ENVIANDO"
    reclamado_en = evento.claimed_at

    _solicitar(client, "envuelo@x.com")

    db_session.refresh(evento)
    assert evento.status == "ENVIANDO"
    assert evento.claimed_at == reclamado_en


# ─── Criterio 4: una fila AGOTADO deja de ser invisible ─────────────────────
def test_una_fila_agotada_se_registra_como_agotada_y_no_como_reintento(
    client, db_session, sesion_inyectada, celery_sincrono, smtp_configurado,
    logs_de_recuperacion,
):
    """El sexto fallo no deja "quedó para retry": no queda ningún reintento.

    Hoy los seis intentos loguean el mismo mensaje, así que la transición a
    `AGOTADO` -- el único estado terminal de fracaso -- no se distingue de un
    fallo transitorio en ningún log.
    """
    _crear_cuenta(client, 567, "agotado@x.com")
    _solicitar(client, "agotado@x.com")

    evento = db_session.query(RecuperacionOutbox).one()
    evento.attempts = 5  # el sexto intento es el que agota
    db_session.commit()
    RecuperacionOutboxRepositorio(db_session).claim_pending()
    db_session.commit()
    assert evento.status == "ENVIANDO" and evento.attempts == 6

    with patch(
        "app.infraestructura.notificaciones_servicio.smtplib.SMTP",
        side_effect=OSError("conexión rechazada"),
    ):
        resultado = procesar_recuperacion_outbox(evento.id)

    db_session.refresh(evento)
    assert evento.status == "AGOTADO"
    assert evento.attempts == 6
    assert resultado["agotado"] is True

    agotados = [
        registro
        for registro in logs_de_recuperacion
        if "AGOTADO" in registro.getMessage()
    ]
    assert agotados, (
        "la fila se agotó sin dejar un log que lo diga: los seis intentos "
        f"registran lo mismo. Mensajes vistos: {_mensajes(logs_de_recuperacion)}"
    )
    assert agotados[0].levelno >= logging.ERROR, (
        "el agotamiento es un fracaso terminal, no una advertencia"
    )
    assert str(evento.id) in agotados[0].getMessage(), (
        "el log de agotamiento no identifica la fila"
    )


def test_una_fila_que_vence_reclamada_tambien_se_registra(
    client, db_session, sesion_inyectada, celery_sincrono, smtp_configurado,
    logs_de_recuperacion,
):
    """El otro camino a `AGOTADO`: la fila venció antes de que la procesaran.

    No pasa por `requeue`, así que necesita su propio log; si no, sigue siendo
    una recuperación que muere sin dejar rastro.
    """
    _crear_cuenta(client, 569, "vencida@x.com")
    _solicitar(client, "vencida@x.com")

    evento = db_session.query(RecuperacionOutbox).one()
    RecuperacionOutboxRepositorio(db_session).claim_pending()
    evento.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    db_session.commit()

    resultado = procesar_recuperacion_outbox(evento.id)

    assert resultado["agotado"] is True
    db_session.refresh(evento)
    assert evento.status == "AGOTADO"
    assert any(
        "AGOTADO" in registro.getMessage() and str(evento.id) in registro.getMessage()
        for registro in logs_de_recuperacion
    ), _mensajes(logs_de_recuperacion)


def test_la_limpieza_reporta_las_solicitudes_que_expiraron_sin_enviarse(
    db_session, sesion_inyectada, logs_de_recuperacion
):
    """Borrar filas `PENDIENTE` al vencer borra la evidencia del fallo.

    `limpiar_recuperaciones_expiradas` corre cada hora y elimina también las
    `PENDIENTE`, así que una recuperación que falló en silencio se borra sola
    a las 24 horas. Eso es lo que hizo que el issue #764 llegara como queja
    de un usuario y no como alarma. El borrado se conserva; lo que no puede
    seguir siendo silencioso es cuántas expiraron sin enviarse.
    """
    from app.dominio.modelos import Persona, Usuario
    from datetime import date

    persona = Persona(
        nombres="Limpieza", apellidos="Test", cedula=cedula_valida(568),
        fecha_nacimiento=date(1990, 1, 1), telefono="0991112222",
    )
    usuario = Usuario(correo="limpieza@x.com", contrasenia="hash", persona=persona)
    db_session.add(usuario)
    db_session.flush()
    db_session.add(
        RecuperacionOutbox(
            usuario_id=usuario.id,
            status="PENDIENTE",
            expires_at=datetime.now(timezone.utc) - timedelta(minutes=1),
        )
    )
    db_session.commit()

    resultado = recuperacion_tareas.limpiar_recuperaciones_expiradas()

    assert resultado["eliminadas"] == 1
    assert resultado["nunca_enviadas"] == 1
    assert db_session.query(RecuperacionOutbox).count() == 0
    mensajes = _mensajes(logs_de_recuperacion)
    assert any("PENDIENTE" in mensaje for mensaje in mensajes), (
        "la limpieza borró una solicitud que nunca se envió y no dejó rastro: "
        f"{mensajes}"
    )
