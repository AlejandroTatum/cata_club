"""
Rechazo permanente de un destinatario en las colas de correo (issue #1710, S12).

Un 5xx por destinatario ("no such user") no mejora reintentando: cada intento
gasta cupo diario del proveedor para volver a fallar. La fila termina
`AGOTADO` en el acto, con la auditoría redactada -- código y frase del
proveedor, nunca la dirección completa --, la entrega resuelta y un log que
tampoco lleva la dirección. Vale para las TRES colas de correo.

Se usa el doble de `smtplib.SMTP` (`tests/smtp_falso.py`) para que corra el
clasificador real que decide qué es "permanente".
"""
from datetime import datetime, timedelta, timezone

import pytest

from app.dominio.cedula import cedula_valida
from app.dominio.modelos import (
    CorreoOutbox,
    RecuperacionOutbox,
    VerificacionCorreoOutbox,
)
from app.infraestructura.tareas import (
    correo_outbox_tareas,
    recuperacion_tareas,
    verificacion_correo_tareas,
)
from tests import arnes_outbox as arnes
from tests.fabricas_auth import crear_usuario_auth
from tests.smtp_falso import configurar_smtp_falso

CORREO = "buzon-inexistente@cataclub.test"

COLAS = [
    pytest.param(
        (recuperacion_tareas, RecuperacionOutbox, "despachar_recuperaciones_pendientes", 8420),
        id="recuperacion",
    ),
    pytest.param(
        (verificacion_correo_tareas, VerificacionCorreoOutbox,
         "despachar_verificaciones_pendientes", 8421),
        id="verificacion_correo",
    ),
    pytest.param(
        (correo_outbox_tareas, CorreoOutbox, "despachar_correos_pendientes", 8422),
        id="correo_outbox",
    ),
]


@pytest.fixture(params=COLAS)
def cola(request, db_session, monkeypatch):
    modulo, modelo, despachador, semilla = request.param
    with arnes.sesion_inyectada_en(modulo, db_session, monkeypatch):
        arnes.celery_en_proceso(modulo, monkeypatch)
        yield modulo, modelo, getattr(modulo, despachador), semilla


def _sembrar(db_session, modelo, semilla):
    usuario = crear_usuario_auth(db_session, correo=CORREO, cedula=cedula_valida(semilla))
    vence = datetime.now(timezone.utc) + timedelta(hours=48)
    if modelo is CorreoOutbox:
        fila = CorreoOutbox(
            usuario_id=usuario.id, destinatario=CORREO, asunto="Asunto",
            cuerpo_texto="Cuerpo", expires_at=vence,
        )
    else:
        fila = modelo(usuario_id=usuario.id, expires_at=vence)
    db_session.add(fila)
    db_session.commit()
    return fila.id


def test_un_rechazo_permanente_agota_la_fila_sin_reintentar(
    cola, db_session, monkeypatch
):
    modulo, modelo, despachar, semilla = cola
    fila_id = _sembrar(db_session, modelo, semilla)
    registro = configurar_smtp_falso(
        monkeypatch, rechazos={CORREO: (550, "5.1.1 no such user")}
    )

    with arnes.logs_recogidos("cataclub") as registros:
        despachar()

    db_session.expire_all()
    guardada = db_session.get(modelo, fila_id)
    assert registro.enviados == []
    assert guardada.status == "AGOTADO"
    assert guardada.attempts == 1, "un solo intento: no se reintenta una dirección muerta"
    assert guardada.sent_at is None
    assert guardada.claimed_at is None
    assert guardada.entrega_resuelta_at is not None
    assert "550" in guardada.last_error_redacted
    assert "no such user" in guardada.last_error_redacted
    assert CORREO not in guardada.last_error_redacted
    assert "buzon-inexistente" not in guardada.last_error_redacted
    for registro_log in registros:
        assert CORREO not in registro_log.getMessage()
        assert not registro_log.exc_info, "el traceback arrastraría la dirección"
    assert any(
        r.levelname == "ERROR" and "AGOTADO" in r.getMessage() for r in registros
    )


def test_un_rechazo_permanente_no_se_vuelve_a_reclamar(cola, db_session, monkeypatch):
    modulo, modelo, despachar, semilla = cola
    _sembrar(db_session, modelo, semilla)
    registro = configurar_smtp_falso(
        monkeypatch, rechazos={CORREO: (550, "5.1.1 no such user")}
    )

    despachar()
    segunda = despachar()

    assert segunda["reclamadas"] == 0
    assert registro.enviados == []
