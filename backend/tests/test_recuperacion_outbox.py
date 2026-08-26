"""Contratos de persistencia del outbox de recuperación."""

from datetime import date, datetime, timedelta, timezone

from app.dominio.modelos import Persona, Usuario
from app.infraestructura.repositorios.recuperacion_outbox_repositorio import (
    RecuperacionOutbox,
    RecuperacionOutboxRepositorio,
)


def _usuario(db_session, cedula):
    persona = Persona(
        nombres="Outbox",
        apellidos="Test",
        cedula=cedula,
        fecha_nacimiento=date(1990, 1, 1),
        telefono="0991112222",
    )
    usuario = Usuario(correo=f"{cedula}@x.com", contrasenia="hash", persona=persona)
    db_session.add(usuario)
    db_session.flush()
    return usuario


def test_claim_usa_lease_y_no_reclama_fila_vigente(db_session):
    usuario = _usuario(db_session, "1710000001")
    evento = RecuperacionOutbox(
        usuario_id=usuario.id,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
    )
    db_session.add(evento)
    db_session.commit()

    repo = RecuperacionOutboxRepositorio(db_session)
    primero = repo.claim_pending()
    db_session.commit()

    assert primero.id == evento.id
    assert primero.status == "ENVIANDO"
    assert primero.attempts == 1
    assert repo.claim_pending() is None


def test_stale_lease_es_reclamable(db_session):
    usuario = _usuario(db_session, "1710000002")
    evento = RecuperacionOutbox(
        usuario_id=usuario.id,
        status="ENVIANDO",
        claimed_at=datetime.now(timezone.utc) - timedelta(minutes=20),
        expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
    )
    db_session.add(evento)
    db_session.commit()

    reclamado = RecuperacionOutboxRepositorio(db_session).claim_pending(lease_minutes=10)

    assert reclamado.id == evento.id
    assert reclamado.status == "ENVIANDO"
    assert reclamado.attempts == 1


def test_requeue_aplica_backoff_y_agota_en_sexto_intento(db_session):
    usuario = _usuario(db_session, "1710000003")
    evento = RecuperacionOutbox(
        usuario_id=usuario.id,
        attempts=5,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
    )
    db_session.add(evento)
    db_session.flush()
    repo = RecuperacionOutboxRepositorio(db_session)

    antes = datetime.now(timezone.utc)
    repo.requeue(evento, Exception("smtp password=secreto"))

    assert evento.status == "PENDIENTE"
    assert evento.next_attempt_at >= antes + timedelta(minutes=16)
    assert evento.last_error_redacted == "Exception: delivery failed"
    assert "secreto" not in evento.last_error_redacted

    evento.attempts = 6
    repo.requeue(evento, "fallo")
    assert evento.status == "AGOTADO"
