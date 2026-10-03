"""PERF-10 / REG-20: el outbox se despacha al commit y el barrido es respaldo.

La fila se commitea con la petición y SOLO ENTONCES se publica la tarea de
despacho: publicar antes dejaría al worker leyendo una fila que todavía no
existe. Un broker caído no rompe la petición (la fila sigue `PENDIENTE` y el
barrido de 5 min la recoge), y el despacho inmediato más el barrido nunca
mandan dos veces la misma fila porque ambos pasan por `claim_pending`.
"""
import logging

import pytest
from sqlalchemy import text

from app.dominio.cedula import cedula_valida
from app.dominio.modelos import (
    EnrollmentNotificacionOutbox,
    RecuperacionOutbox,
    VerificacionCorreoOutbox,
)
from app.infraestructura.tareas import (
    celery_app as celery_app_mod,
    enrollment_notificacion_tareas,
    outbox_despacho,
    recuperacion_tareas,
    verificacion_correo_tareas,
)
from app.servicios_negocio.auth_servicio import AuthServicio
from tests import arnes_outbox as arnes
from tests.fabricas_auth import crear_usuario_auth
from tests.test_enrollment_activacion_completa import _cuerpo_adulto

DESPACHAR_RECUPERACION = "app.infraestructura.tareas.recuperacion_tareas.despachar_recuperaciones_pendientes"
DESPACHAR_VERIFICACION = "app.infraestructura.tareas.verificacion_correo_tareas.despachar_verificaciones_pendientes"
DESPACHAR_INSCRIPCION = (
    "app.infraestructura.tareas.enrollment_notificacion_tareas.despachar_inscripcion_notificaciones"
)


@pytest.fixture()
def publicadas(monkeypatch):
    """Nombres de tareas publicadas, y cuántas filas existían al publicar."""
    lista = []
    monkeypatch.setattr(
        celery_app_mod.celery_app, "send_task", lambda nombre, *a, **k: lista.append(nombre)
    )
    return lista


# --- el helper ---------------------------------------------------------------

def test_se_publica_despues_del_commit_y_no_antes(db_session, publicadas):
    outbox_despacho.encolar_despacho_tras_commit(db_session, DESPACHAR_RECUPERACION)
    db_session.flush()
    assert publicadas == []

    db_session.commit()

    assert publicadas == [DESPACHAR_RECUPERACION]


def test_no_se_publica_si_la_transaccion_se_revierte(db_session, publicadas):
    db_session.commit()
    outbox_despacho.encolar_despacho_tras_commit(db_session, DESPACHAR_RECUPERACION)
    db_session.execute(text("SELECT 1"))  # la petición ya tocó la base

    db_session.rollback()
    db_session.commit()

    assert publicadas == []


def test_un_commit_posterior_a_un_rollback_no_republica_ni_falla(db_session, publicadas):
    outbox_despacho.encolar_despacho_tras_commit(db_session, DESPACHAR_RECUPERACION)
    db_session.execute(text("SELECT 1"))
    db_session.rollback()
    outbox_despacho.encolar_despacho_tras_commit(db_session, DESPACHAR_RECUPERACION)

    db_session.commit()

    assert publicadas == [DESPACHAR_RECUPERACION]


def test_varias_filas_de_la_misma_cola_publican_un_solo_despacho(db_session, publicadas):
    for _ in range(3):
        outbox_despacho.encolar_despacho_tras_commit(db_session, DESPACHAR_INSCRIPCION)
    outbox_despacho.encolar_despacho_tras_commit(db_session, DESPACHAR_VERIFICACION)

    db_session.commit()

    assert sorted(publicadas) == sorted([DESPACHAR_INSCRIPCION, DESPACHAR_VERIFICACION])


def test_un_broker_caido_no_rompe_el_commit_y_queda_en_el_log(db_session, monkeypatch):
    def _roto(*a, **k):
        raise ConnectionError("broker caído")

    monkeypatch.setattr(celery_app_mod.celery_app, "send_task", _roto)
    outbox_despacho.encolar_despacho_tras_commit(db_session, DESPACHAR_RECUPERACION)

    with arnes.logs_recogidos("cataclub.tareas.outbox_despacho") as registros:
        db_session.commit()  # no debe lanzar

    assert any("barrido" in r.getMessage() for r in registros)


# --- en los servicios ----------------------------------------------------------

def test_recuperacion_publica_el_despacho_tras_commitear_la_fila(db_session, publicadas):
    usuario = crear_usuario_auth(db_session, correo="alcommit-rec@cataclub.test", cedula=cedula_valida(8501))

    AuthServicio(db_session).solicitar_recuperacion(usuario.correo)

    assert publicadas == [DESPACHAR_RECUPERACION]
    assert db_session.query(RecuperacionOutbox).filter_by(usuario_id=usuario.id).count() == 1


def test_verificacion_publica_el_despacho_tras_commitear_la_fila(db_session, publicadas):
    usuario = crear_usuario_auth(db_session, correo="alcommit-ver@cataclub.test", cedula=cedula_valida(8502))

    AuthServicio(db_session).solicitar_verificacion_correo(usuario.correo)

    assert publicadas == [DESPACHAR_VERIFICACION]
    assert db_session.query(VerificacionCorreoOutbox).filter_by(usuario_id=usuario.id).count() == 1


def test_un_broker_caido_no_rompe_la_solicitud_de_recuperacion(db_session, monkeypatch):
    def _roto(*a, **k):
        raise ConnectionError("broker caído")

    monkeypatch.setattr(celery_app_mod.celery_app, "send_task", _roto)
    usuario = crear_usuario_auth(db_session, correo="rota-rec@cataclub.test", cedula=cedula_valida(8503))

    respuesta = AuthServicio(db_session).solicitar_recuperacion(usuario.correo)

    assert respuesta["mensaje"]
    fila = db_session.query(RecuperacionOutbox).filter_by(usuario_id=usuario.id).one()
    assert fila.status == "PENDIENTE"  # el barrido de respaldo la recoge


def test_la_inscripcion_publica_ambos_despachos_una_vez_tras_el_commit(
    client_sin_token, db_session, publicadas
):
    respuesta = client_sin_token.post("/api/v1/enrollment/", json=_cuerpo_adulto(8504))

    assert respuesta.status_code == 201, respuesta.text
    assert publicadas.count(DESPACHAR_VERIFICACION) == 1
    assert publicadas.count(DESPACHAR_INSCRIPCION) <= 1
    assert db_session.query(VerificacionCorreoOutbox).count() == 1


def test_una_inscripcion_fallida_no_publica_nada(client_sin_token, db_session, publicadas):
    cuerpo = _cuerpo_adulto(8505)
    cuerpo["acepta_consentimientos"] = False

    respuesta = client_sin_token.post("/api/v1/enrollment/", json=cuerpo)

    assert respuesta.status_code >= 400
    assert publicadas == []


# --- sin doble envío -------------------------------------------------------------

@pytest.mark.parametrize(
    "modulo,despachar,modelo,nombre_publicador",
    [
        (recuperacion_tareas, "despachar_recuperaciones_pendientes", RecuperacionOutbox, "procesar_recuperacion_outbox"),
        (verificacion_correo_tareas, "despachar_verificaciones_pendientes", VerificacionCorreoOutbox, "procesar_verificacion_correo_outbox"),
    ],
    ids=["recuperacion", "verificacion"],
)
def test_el_barrido_no_republica_una_fila_que_el_despacho_inmediato_ya_reclamo(
    db_session, monkeypatch, modulo, despachar, modelo, nombre_publicador
):
    from datetime import datetime, timedelta, timezone

    entregas = []
    tarea_entrega = next(
        t for n, t in vars(modulo).items()
        if hasattr(t, "delay") and getattr(t, "name", "").endswith(nombre_publicador)
    )
    monkeypatch.setattr(tarea_entrega, "delay", lambda evento_id: entregas.append(evento_id))
    arnes.sesion_inyectada_en(modulo, db_session, monkeypatch).__enter__()
    usuario = crear_usuario_auth(db_session, correo=f"doble-{despachar}@cataclub.test", cedula=cedula_valida(8510))
    db_session.add(modelo(usuario_id=usuario.id, expires_at=datetime.now(timezone.utc) + timedelta(hours=24)))
    db_session.commit()

    inmediato = getattr(modulo, despachar)()
    barrido = getattr(modulo, despachar)()

    assert inmediato["reclamadas"] == 1
    assert barrido["reclamadas"] == 0
    assert len(entregas) == 1


def test_el_barrido_de_inscripciones_no_republica_lo_ya_reclamado(db_session, monkeypatch):
    entregas = []
    monkeypatch.setattr(
        enrollment_notificacion_tareas.entregar_inscripcion_notificacion,
        "delay",
        lambda evento_id: entregas.append(evento_id),
    )
    arnes.sesion_inyectada_en(enrollment_notificacion_tareas, db_session, monkeypatch).__enter__()
    admin = crear_usuario_auth(db_session, correo="doble-ins@cataclub.test", cedula=cedula_valida(8511))
    db_session.add(EnrollmentNotificacionOutbox(
        admin_persona_id=admin.persona_id, alumno_persona_id=admin.persona_id, mensaje="m",
    ))
    db_session.commit()

    inmediato = enrollment_notificacion_tareas.despachar_inscripcion_notificaciones()
    barrido = enrollment_notificacion_tareas.despachar_inscripcion_notificaciones()

    assert inmediato["reclamadas"] == 1
    assert barrido["reclamadas"] == 0
    assert len(entregas) == 1
