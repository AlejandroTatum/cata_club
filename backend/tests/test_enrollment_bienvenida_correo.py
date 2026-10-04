"""
QA4 REG-20: la bienvenida y la verificación de correo eran dos correos casi
iguales. Ahora es UNO (el de verificación, que también da la bienvenida), así
que la entrega del aviso de inscripción al administrador ya NO le escribe al
alumno: este módulo fija ese contrato.

El outbox de inscripción tiene UNA fila por administrador
(`EnrollmentServicio._notificar_nueva_inscripcion`): la entrega durable es el
aviso in-app del admin. Base real (`db-test`) y el doble de `smtplib.SMTP`
de `tests/smtp_falso.py`, sin conexión real.
"""
from datetime import date

import pytest

from app.dominio.cedula import cedula_valida
from app.dominio.modelos import EnrollmentNotificacionOutbox, Notificacion, Persona, Usuario
from tests.smtp_falso import configurar_smtp_falso

CORREO_ALUMNO = "alumno.ficticio@cataclub.test"


@pytest.fixture()
def smtp_capturado(monkeypatch):
    """SMTP "configurado" con un doble que registra cada envío."""
    return configurar_smtp_falso(monkeypatch)


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


def test_la_entrega_del_aviso_no_le_escribe_al_alumno(monkeypatch, db_session, smtp_capturado):
    """El aviso in-app del admin nace igual; el correo de bienvenida ya no
    existe aparte (va dentro del de verificación)."""
    tasks = _tarea()
    monkeypatch.setattr(tasks, "SessionLocal", lambda: db_session)
    (admin,), alumno = _personas(db_session, semilla=1)
    event_id = _evento(db_session, admin, alumno).id

    assert tasks.entregar_inscripcion_notificacion(event_id)["enviado"] is True

    assert smtp_capturado.enviados == []
    assert db_session.query(Notificacion).filter_by(enrollment_outbox_id=event_id).count() == 1
    assert db_session.get(EnrollmentNotificacionOutbox, event_id).status == "ENVIADO"


def test_dos_admins_reciben_su_aviso_y_ningun_correo_sale(monkeypatch, db_session, smtp_capturado):
    tasks = _tarea()
    monkeypatch.setattr(tasks, "SessionLocal", lambda: db_session)
    admins, alumno = _personas(db_session, semilla=2, admins=2)
    primero_id = _evento(db_session, admins[0], alumno).id
    segundo_id = _evento(db_session, admins[1], alumno).id

    assert tasks.entregar_inscripcion_notificacion(segundo_id)["enviado"] is True
    assert tasks.entregar_inscripcion_notificacion(primero_id)["enviado"] is True

    assert smtp_capturado.enviados == []
    assert db_session.query(Notificacion).count() == 2
