"""Persistencia y comportamiento idempotente de autoinscripción."""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.exc import IntegrityError

from app.dominio.cedula import cedula_valida
from app.dominio.excepciones import EntidadDuplicada
from app.dominio.modelos import InscripcionIdempotencia, Persona, Usuario
from app.infraestructura.repositorios.inscripcion_idempotencia_repositorio import (
    ESTADO_COMPLETADA,
    ESTADO_PENDIENTE,
    InscripcionIdempotenciaRepositorio,
)
from app.presentacion.schemas.enrollment_schemas import EnrollmentCreateDTO
from app.servicios_negocio.enrollment_servicio import (
    MENSAJE_IDEMPOTENCIA_EN_VUELO,
    MENSAJE_IDEMPOTENCIA_REUTILIZADA,
    ConflictoIdempotencia,
    EnrollmentServicio,
)


def _ahora_utc() -> datetime:
    return datetime.now(timezone.utc)


# Issue #730: el alta pública exige ficha médica. Estos tests miden la
# idempotencia (misma clave -> mismos tokens, sin filas nuevas), no la ficha,
# así que la traen completa igual que la trae el wizard real. Un alta que
# muriera en la validación del DTO nunca llegaría al registro de
# idempotencia, que es lo único que este archivo observa. Además entra en la
# HUELLA del payload, así que las dos formas -- DTO y cuerpo JSON -- tienen
# que decir exactamente lo mismo o `_cuerpo` dejaría de ser el equivalente
# por HTTP de `_payload`.
_FICHA = {
    "tipo_sangre": "O_POSITIVO",
    "enfermedades": [],
    "contacto_emergencia": "María Torres",
    "telefono_emergencia": "0991112233",
}


def _payload(cedula: str, correo: str) -> EnrollmentCreateDTO:
    return EnrollmentCreateDTO(**_cuerpo(cedula, correo))


def _cuerpo(cedula: str, correo: str) -> dict:
    return {
        "alumno": {
            "nombres": "Ana",
            "apellidos": "Torres",
            "cedula": cedula,
            "fecha_nacimiento": "1990-05-20",
            "telefono": "0991234567",
        },
        "credenciales_alumno": {"correo": correo, "contrasenia": "password8"},
        "ficha_medica": dict(_FICHA),
    }


def test_crear_pendiente_persiste_clave_huella_y_ttl(db_session):
    repo = InscripcionIdempotenciaRepositorio(db_session)
    vence = _ahora_utc() + timedelta(hours=24)

    registro = repo.crear_pendiente("clave-1", "huella-1", vence_en=vence)

    assert registro.estado == ESTADO_PENDIENTE
    assert registro.request_fingerprint == "huella-1"
    assert registro.vence_en == vence
    assert repo.obtener_por_clave("clave-1") is registro


def test_clave_es_unica_en_la_base(db_session):
    repo = InscripcionIdempotenciaRepositorio(db_session)
    repo.crear_pendiente("clave-unica", "huella-1")

    with pytest.raises(IntegrityError):
        repo.crear_pendiente("clave-unica", "huella-2")
    db_session.rollback()


def test_replay_devuelve_mismos_tokens_sin_crear_filas(db_session):
    servicio = EnrollmentServicio(db_session)
    datos = _payload(cedula_valida(301), "replay@example.com")

    primero = servicio.enroll(datos, idempotency_key="clave-replay")
    personas = db_session.query(Persona).count()
    usuarios = db_session.query(Usuario).count()
    segundo = servicio.enroll(datos, idempotency_key="clave-replay")

    assert segundo["persona_id"] == primero["persona_id"]
    assert segundo["access_token"] and segundo["refresh_token"]
    assert db_session.query(Persona).count() == personas
    assert db_session.query(Usuario).count() == usuarios
    registro = db_session.get(InscripcionIdempotencia, "clave-replay")
    assert registro.estado == ESTADO_COMPLETADA
    assert registro.completed_at is not None


def test_clave_reutilizada_con_otro_payload_es_conflicto_409_de_servicio(db_session):
    servicio = EnrollmentServicio(db_session)
    servicio.enroll(_payload(cedula_valida(302), "uno@example.com"), idempotency_key="clave")

    with pytest.raises(ConflictoIdempotencia, match=MENSAJE_IDEMPOTENCIA_REUTILIZADA) as error:
        servicio.enroll(_payload(cedula_valida(303), "dos@example.com"), idempotency_key="clave")

    assert error.value.retry_after is None
    assert db_session.query(Persona).filter_by(cedula=cedula_valida(303)).count() == 0


def test_clave_pendiente_es_conflicto_en_vuelo_con_retry_after(db_session):
    InscripcionIdempotenciaRepositorio(db_session).crear_pendiente(
        "clave-pendiente", "otra-huella", vence_en=_ahora_utc() + timedelta(hours=24)
    )

    with pytest.raises(ConflictoIdempotencia, match=MENSAJE_IDEMPOTENCIA_EN_VUELO) as error:
        EnrollmentServicio(db_session).enroll(
            _payload(cedula_valida(304), "pendiente@example.com"),
            idempotency_key="clave-pendiente",
        )

    assert error.value.retry_after == 2
    assert db_session.query(Persona).filter_by(cedula=cedula_valida(304)).count() == 0


def test_fallo_de_creacion_hace_rollback_del_pendiente(db_session, monkeypatch):
    from sqlalchemy.exc import IntegrityError as SAIntegrityError
    from app.infraestructura.repositorios import persona_repositorio

    def falla(*args, **kwargs):
        raise SAIntegrityError("boom", None, None)

    monkeypatch.setattr(persona_repositorio.PersonaRepositorio, "crear", falla)
    with pytest.raises(EntidadDuplicada):
        EnrollmentServicio(db_session).enroll(
            _payload(cedula_valida(305), "rollback@example.com"), idempotency_key="clave-rollback"
        )

    assert db_session.get(InscripcionIdempotencia, "clave-rollback") is None
    assert db_session.query(Persona).filter_by(cedula=cedula_valida(305)).count() == 0


def test_api_replay_y_conflictos_exponen_status_correcto(client, db_session):
    cuerpo = _cuerpo(cedula_valida(306), "api@example.com")
    primera = client.post("/api/v1/enrollment/", json=cuerpo, headers={"Idempotency-Key": "clave-api"})
    segunda = client.post("/api/v1/enrollment/", json=cuerpo, headers={"Idempotency-Key": "clave-api"})
    conflicto = client.post(
        "/api/v1/enrollment/",
        json=_cuerpo(cedula_valida(307), "otro-api@example.com"),
        headers={"Idempotency-Key": "clave-api"},
    )

    assert primera.status_code == 201
    assert segunda.status_code == 201
    assert segunda.json()["persona_id"] == primera.json()["persona_id"]
    assert conflicto.status_code == 409
    assert "retry-after" not in conflicto.headers


def test_api_pendiente_expone_425_y_retry_after(client, db_session):
    InscripcionIdempotenciaRepositorio(db_session).crear_pendiente(
        "clave-api-pendiente", "huella", vence_en=_ahora_utc() + timedelta(hours=24)
    )

    respuesta = client.post(
        "/api/v1/enrollment/",
        json=_cuerpo(cedula_valida(308), "api-pendiente@example.com"),
        headers={"Idempotency-Key": "clave-api-pendiente"},
    )

    assert respuesta.status_code == 425
    assert respuesta.headers["retry-after"] == "2"
    assert MENSAJE_IDEMPOTENCIA_EN_VUELO in respuesta.text


def test_clave_vencida_se_reutiliza_para_otro_alumno(db_session):
    servicio = EnrollmentServicio(db_session)
    repo = InscripcionIdempotenciaRepositorio(db_session)
    servicio.enroll(_payload(cedula_valida(309), "vencida-uno@example.com"), idempotency_key="clave-vencida")
    repo.obtener_por_clave("clave-vencida").vence_en = _ahora_utc() - timedelta(hours=1)
    db_session.commit()

    resultado = servicio.enroll(
        _payload(cedula_valida(310), "vencida-dos@example.com"), idempotency_key="clave-vencida"
    )

    assert db_session.query(Persona).filter_by(cedula=cedula_valida(310)).count() == 1
    assert repo.obtener_por_clave("clave-vencida").persona_id == resultado["persona_id"]


def test_eliminar_expiradas_conserva_vigentes(db_session):
    repo = InscripcionIdempotenciaRepositorio(db_session)
    repo.crear_pendiente("vencida", "huella-1", vence_en=_ahora_utc() - timedelta(hours=1))
    repo.crear_pendiente("vigente", "huella-2", vence_en=_ahora_utc() + timedelta(hours=1))
    db_session.commit()

    assert repo.eliminar_expiradas() == 1
    assert repo.obtener_por_clave("vencida") is None
    assert repo.obtener_por_clave("vigente") is not None
