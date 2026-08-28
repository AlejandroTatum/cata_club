"""
Tests del servicio de notificaciones y de la tarea de recuperación de
contraseña.
"""
import inspect
import logging
import re
import smtplib
import socket
from unittest.mock import Mock, patch

import pytest
from sqlalchemy import select

from app.dominio.cedula import cedula_valida
from app.dominio.excepciones import ServicioNoDisponible
from app.infraestructura import notificaciones_servicio as notificaciones_servicio_mod
from app.infraestructura.notificaciones_servicio import ServicioNotificaciones
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


def test_fallo_smtp_redacta_credenciales_de_log_y_detalle(monkeypatch, caplog):
    _configurar_smtp(monkeypatch)
    secreto = "smtp-password-no-registrar"
    monkeypatch.setattr(settings, "smtp_user", "smtp-user-no-registrar")
    monkeypatch.setattr(settings, "smtp_password", secreto)
    monkeypatch.setattr(notificaciones_servicio_mod.logger, "disabled", False)

    with patch(
        "app.infraestructura.notificaciones_servicio.smtplib.SMTP",
        side_effect=OSError(f"fallo autenticando smtp-user-no-registrar/{secreto}"),
    ):
        with caplog.at_level(logging.ERROR, logger="cataclub.notificaciones"):
            with pytest.raises(ServicioNoDisponible) as error:
                ServicioNotificaciones().enviar_correo("user@example.com", "Asunto", "cuerpo")

    assert secreto not in caplog.text
    assert "smtp-user-no-registrar" not in caplog.text
    assert secreto not in str(error.value)
    assert "[REDACTED]" in caplog.text


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


# ---------------------------------------------------------------------------
# Candado sistémico: `Notificacion.mensaje` nunca revienta un INSERT
# (hallazgo en vivo, 2026-08-11). Estos dos son unitarios y no tocan la BD:
# `@validates` corre al ASIGNAR el atributo, no al hacer flush/commit.
# ---------------------------------------------------------------------------
def test_notificacion_mensaje_recorta_lo_que_supera_el_maximo():
    from app.dominio.modelos import Notificacion
    from app.dominio.enums import TipoNotificacion

    demasiado_largo = "x" * (Notificacion.MENSAJE_MAX + 50)
    notif = Notificacion(
        tipo=TipoNotificacion.PAGO_RECHAZADO,
        mensaje=demasiado_largo,
        persona_id=1,
    )
    assert len(notif.mensaje) == Notificacion.MENSAJE_MAX
    assert notif.mensaje.endswith("…")


def test_notificacion_mensaje_corto_no_se_toca():
    from app.dominio.modelos import Notificacion
    from app.dominio.enums import TipoNotificacion

    notif = Notificacion(
        tipo=TipoNotificacion.PAGO_APROBADO, mensaje="Tu pago fue aprobado.", persona_id=1,
    )
    assert notif.mensaje == "Tu pago fue aprobado."


def test_acortar_nombre_para_notificacion_recorta_pero_conserva_los_cortos():
    from app.servicios_negocio.notificacion_servicio import (
        LIMITE_NOMBRE_EN_NOTIFICACION,
        acortar_nombre_para_notificacion,
    )

    corto = "Ana Torres"
    assert acortar_nombre_para_notificacion(corto) == corto

    nombre_muy_largo = "Maria Fernanda Concepcion " * 5  # > 60 caracteres
    resultado = acortar_nombre_para_notificacion(nombre_muy_largo)
    assert len(resultado) == LIMITE_NOMBRE_EN_NOTIFICACION
    assert resultado.endswith("…")


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
            "categoria": "Adultos",
            "precio": "35.00", "modalidad": "MENSUAL",
        },
    ).json()


def _crear_pago_pendiente(client, persona_id, membresia_id):
    return client.post(
        "/api/v1/membresias/pagos",
        json={
            "meses": 1, "tipo_pago": "EFECTIVO",
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

        representante = _crear_persona(client, cedula=cedula_valida(460))
        assert representante["id"] == 1
        alumno = client.post(
            "/api/v1/personas/",
            json={
                "nombres": "Hijo", "apellidos": "Representado", "cedula": cedula_valida(461),
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

    def test_pago_rechazado_con_nota_larga_no_revienta_y_preserva_el_motivo(self, client, db_session):
        """Hallazgo en vivo, 2026-08-11: un motivo de rechazo de 250
        caracteres (bajo el tope de 255 de `PagoValidarDTO.motivo_rechazo`)
        cabe sin problema en `Pago.motivo_rechazo`, pero el mensaje derivado
        ("Tu pago fue rechazado: " + motivo + ".", y peor todavía envuelto
        con el nombre del alumno para el representante) superaba el
        VARCHAR(255) que tenía `Notificacion.mensaje` -- un `DataError` sin
        capturar al insertar, con el rechazo del pago YA commiteado en
        Postgres. Reproducido en vivo contra el backend real antes de este
        fix: PATCH /validar con una nota de 253 caracteres devolvía 500, el
        pago quedaba RECHAZADO en la base, y no se creaba ninguna fila en
        `notificacion` para ese pago."""
        from app.dominio.modelos import Notificacion

        representante = _crear_persona(client, cedula=cedula_valida(460))
        alumno = client.post(
            "/api/v1/personas/",
            json={
                "nombres": "Hijo", "apellidos": "Representado", "cedula": cedula_valida(461),
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

        motivo_largo = (
            "Comprobante de transferencia ilegible: el monto y la fecha no "
            "coinciden con lo que dice el voucher que subio. "
        ) * 4
        motivo_largo = motivo_largo[:250].rstrip()
        assert len(motivo_largo) <= 255

        resp = client.patch(
            f"/api/v1/membresias/pagos/{pago['id']}/validar",
            json={"estado_pago": "RECHAZADO", "motivo_rechazo": motivo_largo},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["estadoPago"] == "RECHAZADO"
        assert body["motivoRechazo"] == motivo_largo
        assert body.get("avisoNoEnviado") is False

        notif_alumno = db_session.execute(
            select(Notificacion).where(
                Notificacion.persona_id == alumno["id"],
                Notificacion.tipo == "PAGO_RECHAZADO",
            )
        ).scalar_one_or_none()
        assert notif_alumno is not None
        assert motivo_largo in notif_alumno.mensaje

        notif_rep = db_session.execute(
            select(Notificacion).where(
                Notificacion.persona_id == representante["id"],
                Notificacion.tipo == "PAGO_RECHAZADO",
            )
        ).scalar_one_or_none()
        assert notif_rep is not None
        assert motivo_largo in notif_rep.mensaje, (
            "el motivo de rechazo es lo que el representante necesita leer -- "
            "lo que se acorta es el nombre decorativo, nunca esto"
        )

    def test_pago_rechazado_si_notificacion_falla_avisa_sin_ocultar_el_rechazo(
        self, client, db_session, monkeypatch
    ):
        """Si crear la notificación falla por cualquier motivo (uno que este
        fix no previno), el pago YA está commiteado como RECHAZADO -- el
        `guardar_cambios` corre antes en las dos ramas de `validar_pago`. El
        200 que vuelve tiene que decir la verdad completa (`avisoNoEnviado`)
        en vez de que main.py devuelva un 500 que, por diseño del frontend
        (`error-message.ts`: un detalle 5xx nunca llega al usuario), el admin
        vería como "no se pudo rechazar el pago" sobre un pago que sí se
        rechazó."""
        from app.dominio.modelos import Pago
        from app.infraestructura.repositorios.notificacion_repositorio import (
            NotificacionRepositorio,
        )

        persona = _crear_persona(client)
        tipo = _crear_tipo_membresia(client)
        membresia = client.post(
            "/api/v1/membresias/",
            json={
                "monto_aplicado": "35.00", "fecha_activacion": "2026-07-01T00:00:00",
                "persona_id": persona["id"], "tipo_membresia_id": tipo["id"],
            },
        ).json()
        pago = _crear_pago_pendiente(client, persona["id"], membresia["id"])

        def _falla(self, notificacion):
            raise RuntimeError("fallo simulado de infraestructura")

        monkeypatch.setattr(NotificacionRepositorio, "crear", _falla)

        resp = client.patch(
            f"/api/v1/membresias/pagos/{pago['id']}/validar",
            json={"estado_pago": "RECHAZADO", "motivo_rechazo": "Comprobante ilegible"},
        )

        assert resp.status_code == 200, resp.text
        assert resp.json()["avisoNoEnviado"] is True

        pago_db = db_session.get(Pago, pago["id"])
        db_session.refresh(pago_db)
        assert pago_db.estado_pago.value == "RECHAZADO"


def test_marcar_notificacion_ajena_como_leida_falla(client, db_session):
    """Moved from the removed ranking module — this rule is generic to any
    in-app notification, not ranking-specific."""
    from app.dominio.modelos import Notificacion
    from app.dominio.enums import TipoNotificacion
    # `client` autentica con persona_id=1 (ver conftest.py), pero esa
    # identidad no tiene fila propia en `persona` salvo que se cree a
    # propósito. Con el reseteo de secuencias por test (decisión 1.4,
    # sdd/production-readiness), la PRIMERA Persona creada en este test se
    # llevaría justo el id=1 -- por eso creamos primero "la propia" (deja
    # documentada la correspondencia con el token) y luego una segunda,
    # genuinamente distinta, para la notificación ajena. Un id inventado
    # (ej. 999) violaría la FK de `notificacion.persona_id` contra Postgres
    # real, que sí la hace cumplir (a diferencia de la rama SQLite
    # transitoria).
    _crear_persona(client, cedula_valida(462))
    otra_persona = _crear_persona(client, cedula_valida(463))
    assert otra_persona["id"] != 1

    notif = Notificacion(
        persona_id=otra_persona["id"],
        tipo=TipoNotificacion.MIEMBRESIA_VENCIMIENTO_PROXIMO,
        mensaje="x",
    )
    db_session.add(notif)
    db_session.commit()
    db_session.refresh(notif)

    resp = client.patch(f"/api/v1/ranking/notificaciones/{notif.id}/leer")
    assert resp.status_code == 403
