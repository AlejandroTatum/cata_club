"""
T3 (PR 1 de mejoras de experiencia del alumno): correo de bienvenida al
alumno después de la inscripción.

El outbox de inscripción tiene UNA fila por administrador
(`EnrollmentServicio._notificar_nueva_inscripcion`): la entrega durable es el
aviso in-app del admin. El correo de bienvenida es para el ALUMNO, así que
tiene que salir UNA sola vez por inscripción, sin importar cuántos
administradores tenga el club ni en qué orden se entreguen las filas.

Mismo doble de `smtplib.SMTP` que `test_correo_plantillas.py` (sin conexión
real) para el texto, y la base real (`db-test`) para la entrega.
"""
from datetime import date
from email import message_from_string
from email.header import decode_header, make_header

import pytest

from app.dominio.cedula import cedula_valida
from app.dominio.modelos import EnrollmentNotificacionOutbox, Notificacion, Persona, Usuario
from app.infraestructura.notificaciones_servicio import ServicioNotificaciones
from app.soporte_transversal.configuracion import settings
from tests.smtp_falso import configurar_smtp_falso

CORREO_ALUMNO = "alumno.ficticio@cataclub.test"
LIMITE_TEXTO_CORTO = 900


@pytest.fixture()
def smtp_capturado(monkeypatch):
    """Deja `settings` con SMTP "configurado" y reemplaza `smtplib.SMTP` por
    un doble que captura cada mensaje RAW, sin abrir ninguna conexión."""
    monkeypatch.setattr(settings, "smtp_host", "smtp.test")
    monkeypatch.setattr(settings, "smtp_port", 587)
    monkeypatch.setattr(settings, "smtp_user", "")
    monkeypatch.setattr(settings, "smtp_starttls", False)
    monkeypatch.setattr(settings, "smtp_from", "no-reply@cataclub.test")
    monkeypatch.setattr(settings, "frontend_url", "https://app.cataclub.test")

    capturado: list[dict] = []

    class _SMTPFalso:
        def __init__(self, host, port, timeout=None):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_excepcion):
            return False

        def starttls(self):
            return None

        def login(self, usuario, clave):
            return None

        def sendmail(self, remitente, destinatario, mensaje):
            capturado.append(
                {"remitente": remitente, "destinatario": destinatario, "mensaje": mensaje}
            )

    import app.infraestructura.notificaciones_servicio as mod

    monkeypatch.setattr(mod.smtplib, "SMTP", _SMTPFalso)
    return capturado


def _texto(envio: dict) -> str:
    parsed = message_from_string(envio["mensaje"])
    assert parsed.is_multipart()
    return parsed.get_payload()[0].get_payload(decode=True).decode("utf-8")


def _asunto(envio: dict) -> str:
    parsed = message_from_string(envio["mensaje"])
    return str(make_header(decode_header(parsed["Subject"])))


def _personas(db, semilla: int, *, admins: int = 1, con_cuenta: bool = True):
    """Admin(s) + alumno inscripto, con su cuenta y correo cuando
    `con_cuenta`. Cédulas derivadas del generador canónico (issue #828)."""
    base = 500 + semilla * 10
    creados = [
        Persona(
            nombres=f"Admin{n}", apellidos="Ficticio", cedula=cedula_valida(base + n),
            fecha_nacimiento=date(1990, 1, 1), telefono=f"09911111{n:02d}",
        )
        for n in range(1, admins + 1)
    ]
    alumno = Persona(
        nombres="Ana", apellidos="Ficticia", cedula=cedula_valida(base + admins + 1),
        fecha_nacimiento=date(2010, 1, 1), telefono="0991111199",
    )
    db.add_all([*creados, alumno])
    db.flush()
    if con_cuenta:
        db.add(Usuario(correo=CORREO_ALUMNO, contrasenia="hash", persona_id=alumno.id))
        db.flush()
    return creados, alumno


def _evento(db, admin: Persona, alumno: Persona) -> EnrollmentNotificacionOutbox:
    event = EnrollmentNotificacionOutbox(
        admin_persona_id=admin.id,
        alumno_persona_id=alumno.id,
        mensaje="Nuevo alumno inscrito",
        status="ENVIANDO",
        attempts=1,
    )
    db.add(event)
    db.commit()
    return event


def _tarea():
    from app.infraestructura.tareas import enrollment_notificacion_tareas as tasks

    return tasks


# --- El texto ---------------------------------------------------------------

def test_bienvenida_cuenta_el_primer_pago_en_el_club_y_la_activacion(smtp_capturado):
    """Bienvenida + próximos pasos, corto: el primer pago se hace en persona
    en el club y recién entonces el club activa la membresía."""
    ServicioNotificaciones().enviar_bienvenida_inscripcion(CORREO_ALUMNO, "Ana Ficticia")

    assert len(smtp_capturado) == 1
    envio = smtp_capturado[0]
    assert _asunto(envio) == "Cata Club | Bienvenida"
    texto = _texto(envio)
    assert texto.startswith("Hola Ana Ficticia,")
    assert "bienvenida" in texto.lower()
    assert "en persona" in texto
    assert "activa" in texto
    assert len(texto) < LIMITE_TEXTO_CORTO, "el correo de bienvenida se mantiene corto"
    assert "Bienvenida" in envio["mensaje"]


def test_bienvenida_saluda_generico_sin_nombre(smtp_capturado):
    ServicioNotificaciones().enviar_bienvenida_inscripcion(CORREO_ALUMNO)

    assert _texto(smtp_capturado[0]).startswith("Hola,")


# --- La entrega -------------------------------------------------------------

def test_entrega_manda_el_correo_de_bienvenida_al_alumno(monkeypatch, db_session, smtp_capturado):
    tasks = _tarea()
    monkeypatch.setattr(tasks, "SessionLocal", lambda: db_session)
    (admin,), alumno = _personas(db_session, semilla=1)
    event_id = _evento(db_session, admin, alumno).id

    assert tasks.entregar_inscripcion_notificacion(event_id)["enviado"] is True

    assert [envio["destinatario"] for envio in smtp_capturado] == [CORREO_ALUMNO]
    assert "bienvenida" in _texto(smtp_capturado[0]).lower()
    # El aviso del admin sigue naciendo en la misma entrega: campana y correo
    # no se separan.
    assert db_session.query(Notificacion).filter_by(enrollment_outbox_id=event_id).count() == 1


def test_dos_admins_reciben_su_aviso_y_el_alumno_un_solo_correo(
    monkeypatch, db_session, smtp_capturado,
):
    """El correo lo manda solo la fila LÍDER (menor id) del alumno, sin
    importar el orden de entrega: dos administradores nunca producen dos
    correos idénticos al mismo alumno."""
    tasks = _tarea()
    monkeypatch.setattr(tasks, "SessionLocal", lambda: db_session)
    admins, alumno = _personas(db_session, semilla=2, admins=2)
    primero_id = _evento(db_session, admins[0], alumno).id
    segundo_id = _evento(db_session, admins[1], alumno).id

    # El seguidor entrega primero: aviso in-app sí, correo no.
    assert tasks.entregar_inscripcion_notificacion(segundo_id)["enviado"] is True
    assert smtp_capturado == []

    assert tasks.entregar_inscripcion_notificacion(primero_id)["enviado"] is True
    assert len(smtp_capturado) == 1
    assert db_session.query(Notificacion).count() == 2


def test_una_entrega_repetida_no_repite_el_correo(monkeypatch, db_session, smtp_capturado):
    tasks = _tarea()
    monkeypatch.setattr(tasks, "SessionLocal", lambda: db_session)
    (admin,), alumno = _personas(db_session, semilla=3)
    event_id = _evento(db_session, admin, alumno).id

    assert tasks.entregar_inscripcion_notificacion(event_id)["enviado"] is True
    assert tasks.entregar_inscripcion_notificacion(event_id)["enviado"] is False
    assert len(smtp_capturado) == 1


def test_alumno_sin_cuenta_no_recibe_correo_ni_falla_la_entrega(
    monkeypatch, db_session, smtp_capturado,
):
    """Un alumno sin `Usuario` no tiene dirección: el aviso del admin se
    entrega igual y el correo se omite (logueado, nunca inventado)."""
    tasks = _tarea()
    monkeypatch.setattr(tasks, "SessionLocal", lambda: db_session)
    (admin,), alumno = _personas(db_session, semilla=4, con_cuenta=False)
    event_id = _evento(db_session, admin, alumno).id

    assert tasks.entregar_inscripcion_notificacion(event_id)["enviado"] is True
    assert smtp_capturado == []
    assert db_session.get(EnrollmentNotificacionOutbox, event_id).status == "ENVIADO"


def test_entrega_sigue_enviada_sin_smtp_configurado(monkeypatch, db_session):
    """El correo es best-effort y sale DESPUÉS de la entrega durable: un SMTP
    sin configurar no devuelve la fila a la cola."""
    monkeypatch.setattr(settings, "smtp_host", "")
    tasks = _tarea()
    monkeypatch.setattr(tasks, "SessionLocal", lambda: db_session)
    (admin,), alumno = _personas(db_session, semilla=5)
    event_id = _evento(db_session, admin, alumno).id

    assert tasks.entregar_inscripcion_notificacion(event_id)["enviado"] is True
    event_fresco = db_session.get(EnrollmentNotificacionOutbox, event_id)
    assert event_fresco.status == "ENVIADO"
    assert event_fresco.last_error_redacted is None


def test_un_rechazo_permanente_del_alumno_no_reencola_la_entrega(
    monkeypatch, db_session,
):
    """Mismo criterio que `alertas_tareas` (issue #837) para el rechazo 5xx,
    con una diferencia deliberada: acá el aviso in-app del admin YA está
    entregado y no depende del correo, así que la fila queda `ENVIADO` en vez
    de volver a la cola."""
    configurar_smtp_falso(monkeypatch, rechazos={CORREO_ALUMNO: (550, "no existe")})
    tasks = _tarea()
    monkeypatch.setattr(tasks, "SessionLocal", lambda: db_session)
    (admin,), alumno = _personas(db_session, semilla=6)
    event_id = _evento(db_session, admin, alumno).id

    assert tasks.entregar_inscripcion_notificacion(event_id)["enviado"] is True
    assert db_session.get(EnrollmentNotificacionOutbox, event_id).status == "ENVIADO"
