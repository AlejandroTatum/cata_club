"""
Tope diario de correos y colas de salida (QA3, MAIL-CAP).

Antes, cuando el cupo diario se agotaba, `enviar_correo` omitía el envío y
volvía normal: la cola creía haber entregado y cerraba la fila `ENVIADO`, así
que el enlace de recuperación o de verificación se perdía sin rastro.

Ahora la fila se DIFIERE: sigue `PENDIENTE`, no gasta un intento ni una entrega
iniciada, y no vuelve a ser elegible hasta el día siguiente (UTC, el mismo día
del contador), cuando el cupo se repone.

Se parametriza sobre las dos colas que mandan un enlace de acceso.
"""
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest

from app.dominio.cedula import cedula_valida
from app.dominio.modelos import (
    ContadorCorreoDiario,
    RecuperacionOutbox,
    VerificacionCorreoOutbox,
)
from app.infraestructura import notificaciones_servicio as notificaciones_mod
from app.infraestructura.repositorios import outbox_cupo
from app.infraestructura.repositorios.recuperacion_outbox_repositorio import (
    RecuperacionOutboxRepositorio,
)
from app.infraestructura.repositorios.verificacion_correo_outbox_repositorio import (
    VerificacionCorreoOutboxRepositorio,
)
from app.infraestructura.tareas import (
    celery_app as celery_app_mod,
    recuperacion_tareas,
    verificacion_correo_tareas,
)
from app.soporte_transversal.configuracion import settings
from tests import arnes_outbox as arnes
from tests.fabricas_auth import crear_usuario_auth

COLAS = [
    pytest.param(
        (recuperacion_tareas, RecuperacionOutbox, RecuperacionOutboxRepositorio,
         "recuperacion", 8410),
        id="recuperacion",
    ),
    pytest.param(
        (verificacion_correo_tareas, VerificacionCorreoOutbox,
         VerificacionCorreoOutboxRepositorio, "verificacion_correo", 8415),
        id="verificacion_correo",
    ),
]


@pytest.fixture(params=COLAS)
def cola(request, db_session, monkeypatch):
    modulo, modelo, repositorio, nombre, semilla = request.param
    arnes.configurar_smtp(monkeypatch)
    monkeypatch.setattr(settings, "limite_correos_diario", 1)
    # La reserva del cupo abre su propia sesión: también sobre la del test.
    with arnes.sesion_inyectada_en(notificaciones_mod, db_session, monkeypatch):
        with arnes.sesion_inyectada_en(modulo, db_session, monkeypatch):
            arnes.celery_en_proceso(modulo, monkeypatch)
            db_session.query(ContadorCorreoDiario).delete()
            db_session.commit()
            yield modulo, modelo, repositorio, semilla, nombre


def _despachar(modulo, nombre):
    if nombre == "recuperacion":
        return modulo.despachar_recuperaciones_pendientes()
    return modulo.despachar_verificaciones_pendientes()


@pytest.fixture()
def smtp():
    with patch(
        "app.infraestructura.notificaciones_servicio.smtplib.SMTP", MagicMock()
    ) as smtp_cls:
        yield smtp_cls


def _sembrar(db_session, modelo, semilla, nombre):
    usuario = crear_usuario_auth(
        db_session, correo=f"{nombre}@cataclub.test", cedula=cedula_valida(semilla)
    )
    fila = modelo(
        usuario_id=usuario.id,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=48),
    )
    db_session.add(fila)
    db_session.commit()
    return fila


def _agotar_cupo_de_hoy(db_session):
    db_session.add(
        ContadorCorreoDiario(fecha=datetime.now(timezone.utc).date(), enviados=1)
    )
    db_session.commit()


def _releer(db_session, modelo, fila_id):
    db_session.expire_all()
    return db_session.get(modelo, fila_id)


def test_con_el_cupo_agotado_la_fila_queda_pendiente_y_no_enviada(
    cola, db_session, smtp
):
    modulo, modelo, repositorio, semilla, nombre = cola
    fila = _sembrar(db_session, modelo, semilla, nombre)
    _agotar_cupo_de_hoy(db_session)

    _despachar(modulo, nombre)

    guardada = _releer(db_session, modelo, fila.id)
    assert arnes.envios(smtp) == []
    assert guardada.status == "PENDIENTE"
    assert guardada.sent_at is None
    assert guardada.claimed_at is None
    assert guardada.attempts == 0, "diferir por cupo no gasta un intento"
    assert guardada.entregas_intentadas == 0
    manana = datetime.combine(
        datetime.now(timezone.utc).date() + timedelta(days=1),
        datetime.min.time(),
        tzinfo=timezone.utc,
    )
    assert guardada.next_attempt_at >= manana
    assert guardada.last_error_redacted.startswith(outbox_cupo.MARCA_CUPO_AGOTADO)


def test_la_fila_diferida_no_se_reclama_hoy(cola, db_session, smtp):
    modulo, modelo, repositorio, semilla, nombre = cola
    _sembrar(db_session, modelo, semilla, nombre)
    _agotar_cupo_de_hoy(db_session)
    _despachar(modulo, nombre)

    assert _despachar(modulo, nombre)["reclamadas"] == 0


def test_al_reponerse_el_cupo_la_fila_diferida_se_envia(cola, db_session, smtp):
    modulo, modelo, repositorio, semilla, nombre = cola
    fila = _sembrar(db_session, modelo, semilla, nombre)
    _agotar_cupo_de_hoy(db_session)
    _despachar(modulo, nombre)

    # Llega el día siguiente: el contador de ese día arranca vacío y la fila
    # diferida ya es elegible.
    db_session.query(ContadorCorreoDiario).delete()
    guardada = _releer(db_session, modelo, fila.id)
    guardada.next_attempt_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    db_session.commit()

    assert _despachar(modulo, nombre)["reclamadas"] == 1

    final = _releer(db_session, modelo, fila.id)
    assert len(arnes.envios(smtp)) == 1
    assert final.status == "ENVIADO" and final.sent_at is not None


def test_cuenta_las_filas_en_espera_por_cupo(cola, db_session, smtp):
    modulo, modelo, repositorio, semilla, nombre = cola
    assert outbox_cupo.contar_en_espera_por_cupo(db_session) == 0
    _sembrar(db_session, modelo, semilla, nombre)
    assert outbox_cupo.contar_en_espera_por_cupo(db_session) == 0, (
        "una fila pendiente por backoff normal no está esperando por el cupo"
    )
    _agotar_cupo_de_hoy(db_session)
    _despachar(modulo, nombre)

    assert outbox_cupo.contar_en_espera_por_cupo(db_session) == 1


def test_el_beat_reintenta_las_colas_cada_minuto():
    tareas = {
        v["task"]: v["schedule"]
        for v in celery_app_mod.celery_app.conf.beat_schedule.values()
    }
    for nombre in (
        "app.infraestructura.tareas.recuperacion_tareas.despachar_recuperaciones_pendientes",
        "app.infraestructura.tareas.verificacion_correo_tareas.despachar_verificaciones_pendientes",
    ):
        assert nombre in tareas, f"{nombre} no está en el beat schedule"


def test_la_fila_diferida_no_vence_antes_de_poder_reintentarse(cola, db_session, smtp):
    modulo, modelo, repositorio, semilla, nombre = cola
    fila = _sembrar(db_session, modelo, semilla, nombre)
    fila.expires_at = datetime.now(timezone.utc) + timedelta(hours=1)
    db_session.commit()
    _agotar_cupo_de_hoy(db_session)

    _despachar(modulo, nombre)

    guardada = _releer(db_session, modelo, fila.id)
    assert guardada.expires_at > guardada.next_attempt_at, (
        "diferida hasta mañana: no puede vencer y borrarse como 'nunca enviada'"
    )

