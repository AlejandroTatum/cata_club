"""Contrato ORM/repositorio para el ledger append-only de representación."""
from datetime import date

import pytest
from sqlalchemy import inspect, text
from sqlalchemy.exc import DBAPIError

from app.dominio.modelos import Persona, VinculacionRepresentante
from app.infraestructura.repositorios.vinculacion_representante_repositorio import (
    VinculacionRepresentanteRepositorio,
)


def _persona(cedula: str) -> Persona:
    return Persona(
        nombres="Ana", apellidos="Torres", cedula=cedula,
        fecha_nacimiento=date(1990, 1, 1), telefono="0991234567",
    )


def _repo(db_session):
    actor, old_rep, target = (_persona(str(i)) for i in (1710034065, 1710034073, 1710034081))
    db_session.add_all((actor, old_rep, target))
    db_session.flush()
    return VinculacionRepresentanteRepositorio(db_session), actor, old_rep, target

def test_ledger_records_removal_and_replays_same_key(db_session):
    repo, actor, old_rep, target = _repo(db_session)
    event = repo.registrar(
        persona_id=target.id, actor_persona_id=actor.id,
        representante_anterior_id=old_rep.id, representante_nuevo_id=None,
        operacion="INDEPENDENCIA", origen="ADMIN_PRESENCIAL",
        idempotency_key="independencia-1", request_fingerprint="a" * 64,
    )
    replay = repo.registrar(
        persona_id=target.id, actor_persona_id=actor.id,
        representante_anterior_id=old_rep.id, representante_nuevo_id=None,
        operacion="INDEPENDENCIA", origen="ADMIN_PRESENCIAL",
        idempotency_key="independencia-1", request_fingerprint="a" * 64,
    )

    assert replay.id == event.id
    assert event.actor_persona_id == actor.id
    assert event.representante_nuevo_id is None
    assert event.operacion == "INDEPENDENCIA"
    assert event.origen == "ADMIN_PRESENCIAL"
    assert db_session.query(VinculacionRepresentante).count() == 1

def test_repository_rejects_key_conflict_and_unpaired_fingerprint(db_session):
    repo, actor, _, target = _repo(db_session)
    args = dict(
        persona_id=target.id, actor_persona_id=actor.id,
        representante_anterior_id=None, representante_nuevo_id=actor.id,
        operacion="CREACION", origen="SESION_AUTENTICADA",
        idempotency_key="creation-1",
    )
    repo.registrar(request_fingerprint="b" * 64, **args)
    with pytest.raises(ValueError, match="fingerprint"):
        repo.registrar(request_fingerprint="c" * 64, **args)
    with pytest.raises(ValueError, match="paired"):
        repo.registrar(request_fingerprint=None, **{**args, "idempotency_key": "unpaired"})


def test_model_declares_migrated_origin_and_fingerprint_checks():
    checks = {
        c.name: str(c.sqltext)
        for c in VinculacionRepresentante.__table__.constraints
        if c.name and c.name.startswith("ck_")
    }
    assert checks["ck_vinculacion_representante_origen"] == (
        "origen IN ('SESION_AUTENTICADA', 'ADMIN_PRESENCIAL', "
        "'AUTOSERVICIO_LEGADO', 'REMEDIACION_LEGACY')"
    )
    assert checks["ck_vinculacion_representante_fingerprint_sha256"] == (
        "request_fingerprint IS NULL OR request_fingerprint ~ '^[0-9a-f]{64}$'"
    )


def test_model_exposes_audit_indexes(db_session):
    indexes = {index.name for index in inspect(VinculacionRepresentante.__table__).indexes}
    assert {
        "ix_vinculacion_representante_persona_fecha_id",
        "ix_vinculacion_representante_actor_persona_id",
        "uq_vinculacion_representante_idempotency_key",
    } <= indexes


def test_database_rejects_mutating_an_audit_row(db_session):
    repo, actor, _, target = _repo(db_session)
    event = repo.registrar(
        persona_id=target.id, actor_persona_id=actor.id,
        representante_anterior_id=None, representante_nuevo_id=actor.id,
        operacion="CREACION", origen="SESION_AUTENTICADA",
        idempotency_key=None, request_fingerprint=None,
    )
    db_session.commit()
    with pytest.raises(DBAPIError):
        db_session.execute(
            text("UPDATE vinculacion_representante SET representante_nuevo_id = NULL WHERE id = :id"),
            {"id": event.id},
        )
    db_session.rollback()
    with pytest.raises(DBAPIError):
        db_session.execute(text("DELETE FROM vinculacion_representante WHERE id = :id"), {"id": event.id})
