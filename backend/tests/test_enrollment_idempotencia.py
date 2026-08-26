"""Pruebas de la fundación persistente de idempotencia de enrollment."""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.exc import IntegrityError

from app.dominio.modelos import InscripcionIdempotencia, Persona
from app.infraestructura.repositorios.inscripcion_idempotencia_repositorio import (
    ESTADO_COMPLETADA,
    ESTADO_PENDIENTE,
    InscripcionIdempotenciaRepositorio,
)


def _ahora_utc() -> datetime:
    return datetime.now(timezone.utc)


def _persona() -> Persona:
    return Persona(
        nombres="Ana",
        apellidos="Torres",
        cedula="1710034065",
        fecha_nacimiento=datetime(1990, 5, 20).date(),
        telefono="0991234567",
    )


def test_crear_pendiente_persiste_clave_huella_y_ttl(db_session):
    repo = InscripcionIdempotenciaRepositorio(db_session)
    vence = _ahora_utc() + timedelta(hours=24)

    registro = repo.crear_pendiente("clave-1", "huella-1", vence_en=vence)

    assert registro.estado == ESTADO_PENDIENTE
    assert registro.request_fingerprint == "huella-1"
    assert registro.created_at is not None
    assert registro.vence_en == vence
    assert repo.obtener_por_clave("clave-1") is registro


def test_clave_es_unica_en_la_base(db_session):
    repo = InscripcionIdempotenciaRepositorio(db_session)
    repo.crear_pendiente("clave-unica", "huella-1")

    with pytest.raises(IntegrityError):
        repo.crear_pendiente("clave-unica", "huella-2")
    db_session.rollback()


def test_marcar_completada_guarda_persona_y_fecha(db_session):
    persona = _persona()
    db_session.add(persona)
    db_session.flush()
    registro = InscripcionIdempotenciaRepositorio(db_session).crear_pendiente(
        "clave-completa", "huella-1"
    )

    InscripcionIdempotenciaRepositorio(db_session).marcar_completada(registro, persona.id)

    db_session.expire_all()
    guardado = db_session.get(InscripcionIdempotencia, "clave-completa")
    assert guardado.estado == ESTADO_COMPLETADA
    assert guardado.persona_id == persona.id
    assert guardado.completed_at is not None


def test_eliminar_expiradas_conserva_las_vigentes(db_session):
    repo = InscripcionIdempotenciaRepositorio(db_session)
    repo.crear_pendiente("vencida", "huella-1", vence_en=_ahora_utc() - timedelta(hours=1))
    repo.crear_pendiente("vigente", "huella-2", vence_en=_ahora_utc() + timedelta(hours=1))
    db_session.commit()

    assert repo.eliminar_expiradas() == 1
    assert repo.obtener_por_clave("vencida") is None
    assert repo.obtener_por_clave("vigente") is not None
