"""
Tests del servicio de notificaciones y de la tarea de recuperación de
contraseña.
"""
import inspect
import re
from unittest.mock import Mock, patch

import pytest
from sqlalchemy import select

from app.infraestructura import notificaciones_servicio as notificaciones_servicio_mod
from app.infraestructura.notificaciones_servicio import ServicioNotificaciones
from app.infraestructura.tareas.recuperacion_tareas import enviar_enlace_recuperacion
from app.soporte_transversal.configuracion import settings
from app.soporte_transversal.resiliencia import TIMEOUT_SMTP_SEGUNDOS


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
