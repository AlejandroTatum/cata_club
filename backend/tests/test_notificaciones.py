"""
Tests del servicio de notificaciones y de la tarea de recuperación de
contraseña.
"""
import inspect
import re
import smtplib
import socket
from unittest.mock import Mock, patch

import pytest
from sqlalchemy import select

from app.dominio.excepciones import ServicioNoDisponible
from app.infraestructura import notificaciones_servicio as notificaciones_servicio_mod
from app.infraestructura.notificaciones_servicio import ServicioNotificaciones
from app.infraestructura.tareas.recuperacion_tareas import enviar_enlace_recuperacion
from app.soporte_transversal.configuracion import settings
from app.soporte_transversal.resiliencia import (
    CIRCUITO_SMTP_UMBRAL_FALLOS,
    TIMEOUT_SMTP_SEGUNDOS,
)


class TestServicioNotificaciones:
    @patch("app.infraestructura.notificaciones_servicio.smtplib.SMTP")
    def test_enviar_recuperacion_contrasenia_usa_smtp(self, mock_smtp_cls):
        mock_server = Mock()
        mock_smtp_cls.return_value.__enter__ = Mock(return_value=mock_server)
        mock_smtp_cls.return_value.__exit__ = Mock(return_value=False)

        with patch.object(settings, "smtp_host", "smtp.test"):
            with patch.object(settings, "smtp_port", 587):
                with patch.object(settings, "smtp_user", "user"):
                    with patch.object(settings, "smtp_password", "pass"):
                        with patch.object(settings, "frontend_url", "https://app.test"):
                            ServicioNotificaciones().enviar_recuperacion_contrasenia(
                                "user@example.com", "token123"
                            )

        mock_smtp_cls.assert_called_once_with(
            "smtp.test", 587, timeout=TIMEOUT_SMTP_SEGUNDOS
        )
        mock_server.starttls.assert_called_once()
        mock_server.login.assert_called_once_with("user", "pass")
        mock_server.sendmail.assert_called_once()
        _, destinatario, _cuerpo = mock_server.sendmail.call_args[0]
        assert destinatario == "user@example.com"

    def test_enviar_correo_falla_si_no_hay_smtp_configurado(self):
        with patch.object(settings, "smtp_host", ""):
            with pytest.raises(RuntimeError, match="SMTP_HOST"):
                ServicioNotificaciones().enviar_correo(
                    "user@example.com", "Asunto", "cuerpo"
                )


# --- Guardia estructural: el timeout SMTP debe venir de la constante --------
# `test_enviar_recuperacion_contrasenia_usa_smtp` de arriba compara
# `timeout=TIMEOUT_SMTP_SEGUNDOS` contra el valor recibido por el mock, pero
# en Python `10 == 10.0`: si `notificaciones_servicio.py` volviera al literal
# `timeout=10`, esa prueba seguiría en verde. Esta guardia inspecciona el
# TEXTO fuente del call site en vez del valor ya evaluado -- mismo patrón que
# `test_limite_tasa_pagos.py::_limite_declarado` y el guardia análogo en
# `test_celery_config.py`.
def test_timeout_smtp_referencia_la_constante_no_un_literal():
    codigo_fuente = inspect.getsource(notificaciones_servicio_mod)
    patron = re.compile(
        r"smtplib\.SMTP\([^)]*\btimeout\s*=\s*([A-Za-z_]\w*|[0-9]+(?:\.[0-9]+)?)"
    )
    coincidencia = patron.search(codigo_fuente)
    assert coincidencia, "no se encontró 'timeout=' en la llamada a smtplib.SMTP(...)"
    valor = coincidencia.group(1)
    assert valor == "TIMEOUT_SMTP_SEGUNDOS", (
        "el timeout de smtplib.SMTP debe referenciar la constante importada "
        f"de resiliencia.py, no un literal numérico; se encontró: {valor!r}"
    )


# ---------------------------------------------------------------------------
# Circuit breaker SMTP (degradacion-controlada, slice 3)
# ---------------------------------------------------------------------------
# El circuito de SMTP vive como una única instancia a nivel de módulo
# (`notificaciones_servicio_mod._circuito_smtp`), igual que el de Cloudinary
# (`cloudinary_cliente.py::_circuito_cloudinary`): `ServicioNotificaciones`
# se instancia nueva en cada llamada (ver `alertas_tareas.py`), así que el
# estado del circuito tiene que vivir afuera de `self` para sobrevivir entre
# invocaciones. El fixture autouse de `tests/conftest.py` lo reinicia entre
# tests.
def _configurar_smtp(monkeypatch):
    """Deja `settings` con SMTP "configurado" (host presente) y sin
    autenticación, para no tener que mockear `server.login`."""
    monkeypatch.setattr(settings, "smtp_host", "smtp.test")
    monkeypatch.setattr(settings, "smtp_port", 587)
    monkeypatch.setattr(settings, "smtp_user", "")
    monkeypatch.setattr(settings, "smtp_starttls", False)


def test_circuito_abierto_no_abre_smtp(monkeypatch):
    _configurar_smtp(monkeypatch)
    for _ in range(CIRCUITO_SMTP_UMBRAL_FALLOS):
        notificaciones_servicio_mod._circuito_smtp.registrar_fallo()
    assert notificaciones_servicio_mod._circuito_smtp.estado == "abierto"

    with patch(
        "app.infraestructura.notificaciones_servicio.smtplib.SMTP"
    ) as mock_smtp_cls:
        with pytest.raises(ServicioNoDisponible):
            ServicioNotificaciones().enviar_correo(
                "user@example.com", "Asunto", "cuerpo"
            )

        assert mock_smtp_cls.call_count == 0


_FALLOS_DE_TRANSPORTE = [
    smtplib.SMTPConnectError(421, "conexión rechazada"),
    smtplib.SMTPServerDisconnected("conexión perdida"),
    smtplib.SMTPHeloError(500, "error en HELO"),
    smtplib.SMTPAuthenticationError(535, "autenticación fallida"),
    socket.timeout("tiempo de espera agotado"),
    OSError("fallo de red genérico"),
]


@pytest.mark.parametrize(
    "excepcion",
    _FALLOS_DE_TRANSPORTE,
    ids=[type(e).__name__ for e in _FALLOS_DE_TRANSPORTE],
)
def test_fallo_de_transporte_es_servicio_no_disponible(monkeypatch, excepcion):
    """Un fallo de TRANSPORTE (conexión, HELO, autenticación, timeout de
    socket, u OSError genérico) se traduce a `ServicioNoDisponible` y cuenta
    contra el circuito (Decisión D del diseño)."""
    _configurar_smtp(monkeypatch)

    with patch(
        "app.infraestructura.notificaciones_servicio.smtplib.SMTP",
        side_effect=excepcion,
    ):
        with pytest.raises(ServicioNoDisponible):
            ServicioNotificaciones().enviar_correo(
                "user@example.com", "Asunto", "cuerpo"
            )

    assert notificaciones_servicio_mod._circuito_smtp.fallos_consecutivos == 1


_RECHAZOS_DE_DESTINATARIO = [
    smtplib.SMTPRecipientsRefused({"user@example.com": (550, "buzón inexistente")}),
    smtplib.SMTPSenderRefused(501, "remitente rechazado", "no-reply@cataclub.com"),
    smtplib.SMTPDataError(554, "contenido rechazado"),
]


@pytest.mark.parametrize(
    "excepcion",
    _RECHAZOS_DE_DESTINATARIO,
    ids=[type(e).__name__ for e in _RECHAZOS_DE_DESTINATARIO],
)
def test_destinatario_rechazado_no_abre_el_circuito(monkeypatch, excepcion):
    """Un rechazo de ESTE mensaje puntual (destinatario, remitente o datos)
    se sigue traduciendo a `ServicioNoDisponible`, pero NO cuenta contra el
    circuito: tres direcciones malas en un mismo lote no deben abrirlo para
    todos los destinatarios siguientes (Decisión D del diseño)."""
    _configurar_smtp(monkeypatch)

    with patch(
        "app.infraestructura.notificaciones_servicio.smtplib.SMTP",
        side_effect=excepcion,
    ):
        for _ in range(CIRCUITO_SMTP_UMBRAL_FALLOS + 1):
            with pytest.raises(ServicioNoDisponible):
                ServicioNotificaciones().enviar_correo(
                    "user@example.com", "Asunto", "cuerpo"
                )

    assert notificaciones_servicio_mod._circuito_smtp.estado == "cerrado"
    assert notificaciones_servicio_mod._circuito_smtp.fallos_consecutivos == 0


# --- Guardia estructural: mismo patrón que
# `test_umbral_cloudinary_referencia_la_constante_no_un_literal`
# (`test_cloudinary_cliente.py`).
def test_umbral_smtp_referencia_la_constante_no_un_literal():
    codigo_fuente = inspect.getsource(notificaciones_servicio_mod)

    patron_umbral = re.compile(r"umbral_fallos\s*=\s*([A-Za-z_]\w*|[0-9]+(?:\.[0-9]+)?)")
    patron_cooldown = re.compile(r"cooldown_segundos\s*=\s*([A-Za-z_]\w*|[0-9]+(?:\.[0-9]+)?)")

    coincidencia_umbral = patron_umbral.search(codigo_fuente)
    coincidencia_cooldown = patron_cooldown.search(codigo_fuente)

    assert coincidencia_umbral, "no se encontró 'umbral_fallos=' en la construcción del CircuitoBreaker"
    assert coincidencia_cooldown, "no se encontró 'cooldown_segundos=' en la construcción del CircuitoBreaker"

    valor_umbral = coincidencia_umbral.group(1)
    valor_cooldown = coincidencia_cooldown.group(1)
    assert valor_umbral == "CIRCUITO_SMTP_UMBRAL_FALLOS", (
        "umbral_fallos debe referenciar la constante importada de resiliencia.py, "
        f"no un literal numérico; se encontró: {valor_umbral!r}"
    )
    assert valor_cooldown == "CIRCUITO_SMTP_COOLDOWN_SEGUNDOS", (
        "cooldown_segundos debe referenciar la constante importada de resiliencia.py, "
        f"no un literal numérico; se encontró: {valor_cooldown!r}"
    )


class TestRecuperacionTarea:
    @patch("app.infraestructura.tareas.recuperacion_tareas.ServicioNotificaciones")
    def test_enviar_enlace_recuperacion_llama_al_servicio(self, mock_servicio_cls):
        mock_instancia = Mock()
        mock_servicio_cls.return_value = mock_instancia

        resultado = enviar_enlace_recuperacion("user@example.com", "token123")

        mock_instancia.enviar_recuperacion_contrasenia.assert_called_once_with(
            "user@example.com", "token123"
        )
        assert resultado == {"correo": "user@example.com", "enviado": True}


# ---------------------------------------------------------------------------
# Tests de notificaciones in-app para pagos aprobados/rechazados
# ---------------------------------------------------------------------------
def _crear_persona(client, cedula="1710034065"):
    return client.post(
        "/api/v1/personas/",
        json={
            "nombres": "Ana", "apellidos": "Torres", "cedula": cedula,
            "fecha_nacimiento": "2010-05-14", "telefono": "0991234567",
        },
    ).json()


def _crear_tipo_membresia(client):
    return client.post(
        "/api/v1/membresias/tipos",
        json={
            "categoria": "Adultos", "franja_horaria": "18:00-19:00",
            "precio": "35.00", "modalidad": "MENSUAL",
        },
    ).json()


def _crear_pago_pendiente(client, persona_id, membresia_id):
    return client.post(
        "/api/v1/membresias/pagos",
        json={
            "monto": "35.00", "tipo_pago": "EFECTIVO",
            "fecha_inicio": "2026-07-01", "fecha_fin": "2026-07-31",
            "persona_id": persona_id, "membresia_id": membresia_id,
        },
    ).json()


class TestNotificacionPago:
    def test_pago_aprobado_crea_notificacion_para_alumno(self, client, db_session):
        """Al aprobar un pago se crea una notificación PAGO_APROBADO para el alumno."""
        from app.dominio.modelos import Notificacion

        persona = _crear_persona(client)
        assert persona["id"] == 1
        tipo = _crear_tipo_membresia(client)
        membresia = client.post(
            "/api/v1/membresias/",
            json={
                "monto_aplicado": "35.00", "fecha_activacion": "2026-07-01T00:00:00",
                "persona_id": persona["id"], "tipo_membresia_id": tipo["id"],
            },
        ).json()
        pago = _crear_pago_pendiente(client, persona["id"], membresia["id"])

        resp = client.patch(
            f"/api/v1/membresias/pagos/{pago['id']}/validar",
            json={"estado_pago": "APROBADO"},
        )
        assert resp.status_code == 200

        notif = db_session.execute(
            select(Notificacion).where(
                Notificacion.persona_id == persona["id"],
                Notificacion.tipo == "PAGO_APROBADO",
            )
        ).scalar_one_or_none()
        assert notif is not None
        assert "$35.00" in notif.mensaje
        assert notif.leida is False

    def test_pago_rechazado_crea_notificacion_con_motivo(self, client, db_session):
        """Al rechazar un pago se crea una notificación PAGO_RECHAZADO con el motivo."""
        from app.dominio.modelos import Notificacion

        persona = _crear_persona(client)
        assert persona["id"] == 1
        tipo = _crear_tipo_membresia(client)
        membresia = client.post(
            "/api/v1/membresias/",
            json={
                "monto_aplicado": "35.00", "fecha_activacion": "2026-07-01T00:00:00",
                "persona_id": persona["id"], "tipo_membresia_id": tipo["id"],
            },
        ).json()
        pago = _crear_pago_pendiente(client, persona["id"], membresia["id"])

        resp = client.patch(
            f"/api/v1/membresias/pagos/{pago['id']}/validar",
            json={"estado_pago": "RECHAZADO", "motivo_rechazo": "Comprobante ilegible"},
        )
        assert resp.status_code == 200

        notif = db_session.execute(
            select(Notificacion).where(
                Notificacion.persona_id == persona["id"],
                Notificacion.tipo == "PAGO_RECHAZADO",
            )
        ).scalar_one_or_none()
        assert notif is not None
        assert "Comprobante ilegible" in notif.mensaje

    def test_pago_aprobado_notifica_representante(self, client, db_session):
        """Si el alumno tiene representante, el representante también recibe la notificación."""
        from app.dominio.modelos import Notificacion

        representante = _crear_persona(client, cedula="1733344455")
        assert representante["id"] == 1
        alumno = client.post(
            "/api/v1/personas/",
            json={
                "nombres": "Hijo", "apellidos": "Representado", "cedula": "1744455566",
                "fecha_nacimiento": "2015-05-14", "telefono": "0991234567",
                "representante_id": representante["id"],
            },
        ).json()
        tipo = _crear_tipo_membresia(client)
        membresia = client.post(
            "/api/v1/membresias/",
            json={
                "monto_aplicado": "35.00", "fecha_activacion": "2026-07-01T00:00:00",
                "persona_id": alumno["id"], "tipo_membresia_id": tipo["id"],
            },
        ).json()
        pago = _crear_pago_pendiente(client, alumno["id"], membresia["id"])

        resp = client.patch(
            f"/api/v1/membresias/pagos/{pago['id']}/validar",
            json={"estado_pago": "APROBADO"},
        )
        assert resp.status_code == 200

        notifs_representante = db_session.execute(
            select(Notificacion).where(
                Notificacion.persona_id == representante["id"],
                Notificacion.tipo == "PAGO_APROBADO",
            )
        ).scalars().all()
        assert len(notifs_representante) == 1
        assert "Hijo Representado" in notifs_representante[0].mensaje
