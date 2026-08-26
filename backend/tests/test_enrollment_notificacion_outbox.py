"""Contratos del outbox durable de notificaciones de inscripción."""

from datetime import date, datetime, timedelta, timezone
from unittest.mock import Mock

from app.dominio.modelos import EnrollmentNotificacionOutbox, Notificacion, Persona
from app.infraestructura.repositorios.enrollment_notificacion_outbox_repositorio import (
    EnrollmentNotificacionOutboxRepositorio,
)


def _personas(db_session):
    admin = Persona(nombres="Admin", apellidos="Outbox", cedula="1710000001", fecha_nacimiento=date(1990, 1, 1), telefono="0991111111")
    alumno = Persona(nombres="Alumno", apellidos="Outbox", cedula="1710000002", fecha_nacimiento=date(2010, 1, 1), telefono="0991111112")
    db_session.add_all([admin, alumno])
    db_session.flush()
    return admin, alumno


def _evento(db_session, **kwargs):
    admin, alumno = _personas(db_session)
    event = EnrollmentNotificacionOutbox(
        admin_persona_id=admin.id,
        alumno_persona_id=alumno.id,
        mensaje="Nuevo alumno inscrito",
        **kwargs,
    )
    db_session.add(event)
    db_session.commit()
    return event


def test_outbox_de_notificacion_de_inscripcion_es_un_modelo_durable(db_session):
    event = _evento(db_session)
    assert event.status == "PENDIENTE"
    assert event.attempts == 0
    assert event.mensaje == "Nuevo alumno inscrito"


def test_claim_usa_lease_y_requeue_aplica_backoff(db_session):
    event = _evento(db_session)
    repo = EnrollmentNotificacionOutboxRepositorio(db_session)
    claimed = repo.claim_pending()
    db_session.commit()
    assert claimed.id == event.id
    assert claimed.status == "ENVIANDO"
    assert claimed.attempts == 1
    assert repo.claim_pending() is None
    repo.requeue(claimed, RuntimeError("smtp no aplica"))
    assert claimed.status == "PENDIENTE"
    assert claimed.last_error_redacted == "RuntimeError: delivery failed"
    assert claimed.next_attempt_at > datetime.now(timezone.utc)


def test_worker_materializa_notificacion_y_repetir_es_idempotente(monkeypatch, db_session):
    from app.infraestructura.tareas import enrollment_notificacion_tareas as tasks

    event = _evento(db_session, status="ENVIANDO", attempts=1)
    event_id = event.id
    monkeypatch.setattr(tasks, "SessionLocal", lambda: db_session)
    assert tasks.entregar_inscripcion_notificacion(event_id)["enviado"] is True
    assert db_session.query(Notificacion).filter_by(enrollment_outbox_id=event_id).count() == 1
    assert tasks.entregar_inscripcion_notificacion(event_id)["enviado"] is False
    assert db_session.query(Notificacion).filter_by(enrollment_outbox_id=event_id).count() == 1


def test_worker_fallo_de_tarea_reencola(monkeypatch, db_session):
    from app.infraestructura.tareas import enrollment_notificacion_tareas as tasks

    event = _evento(db_session, status="ENVIANDO", attempts=1)
    event_id = event.id
    monkeypatch.setattr(tasks, "SessionLocal", lambda: db_session)
    original_add = db_session.add

    def failing_add(value):
        if isinstance(value, Notificacion):
            raise RuntimeError("fallo de tarea")
        original_add(value)

    monkeypatch.setattr(db_session, "add", failing_add)
    assert tasks.entregar_inscripcion_notificacion(event_id)["enviado"] is False
    assert db_session.get(EnrollmentNotificacionOutbox, event_id).status == "PENDIENTE"
    assert db_session.get(EnrollmentNotificacionOutbox, event_id).last_error_redacted == "RuntimeError: delivery failed"


def test_dispatcher_fallo_de_broker_reencola(monkeypatch, db_session):
    from app.infraestructura.tareas import enrollment_notificacion_tareas as tasks

    event = _evento(db_session)
    event_id = event.id
    monkeypatch.setattr(tasks, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(tasks.entregar_inscripcion_notificacion, "delay", Mock(side_effect=ConnectionError("broker")))
    tasks.despachar_inscripcion_notificaciones()
    event = db_session.get(EnrollmentNotificacionOutbox, event_id)
    assert event.status == "ENVIANDO"
    assert db_session.query(Notificacion).filter_by(enrollment_outbox_id=event_id).count() == 0


def test_claim_recupera_lease_vencido(db_session):
    event = _evento(
        db_session,
        status="ENVIANDO",
        attempts=1,
        claimed_at=datetime.now(timezone.utc) - timedelta(minutes=20),
    )
    claimed = EnrollmentNotificacionOutboxRepositorio(db_session).claim_pending(lease_minutes=10)
    assert claimed.id == event.id
    assert claimed.status == "ENVIANDO"
