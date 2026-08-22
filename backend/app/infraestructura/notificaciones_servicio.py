"""
Servicio de notificaciones de infraestructura.

Envío real de correo electrónico vía SMTP. El proveedor y credenciales se
configuran por variables de entorno (ver Settings). Si no hay SMTP_HOST
configurado, el servicio falla de forma explícita para que el operador sepa
que falta configuración, en lugar de fingir un envío.

El módulo es puro Python stdlib; no añade dependencias externas.
"""
import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

from app.dominio.excepciones import ServicioNoDisponible
from app.soporte_transversal.circuito_breaker import CircuitoBreaker
from app.soporte_transversal.configuracion import settings
from app.soporte_transversal.resiliencia import (
    CIRCUITO_SMTP_COOLDOWN_SEGUNDOS,
    CIRCUITO_SMTP_UMBRAL_FALLOS,
    TIMEOUT_SMTP_SEGUNDOS,
)

logger = logging.getLogger("cataclub.notificaciones")


# Los errores de SMTP pueden repetir el usuario o la contraseña que el cliente
# intentó usar. Antes de ponerlos en un log o en un detalle técnico, se eliminan
# los valores configurados; el marcador conserva que hubo un error sin copiar
# credenciales a un agregador de logs.
def _redactar_detalle_sensible(detalle: str) -> str:
    for valor in (settings.smtp_user, settings.smtp_password):
        if valor:
            detalle = detalle.replace(valor, "[REDACTED]")
    return detalle


# Circuit breaker en proceso (degradacion-controlada, slice 3): instancia a
# nivel de MÓDULO, no de instancia. `ServicioNotificaciones` se crea nueva en
# cada llamada (ver `alertas_tareas.py::_disparar_notificacion_
# vencimiento`), así que el estado del circuito tiene que vivir afuera de
# `self` para sobrevivir entre invocaciones -- mismo criterio que
# `cloudinary_cliente.py::_circuito_cloudinary` (Decisión E del diseño).
_circuito_smtp = CircuitoBreaker(
    nombre="smtp",
    umbral_fallos=CIRCUITO_SMTP_UMBRAL_FALLOS,
    cooldown_segundos=CIRCUITO_SMTP_COOLDOWN_SEGUNDOS,
)


class ServicioNotificaciones:
    """Adaptador SMTP para el envío de correos transaccionales."""

    def __init__(self) -> None:
        self._host = settings.smtp_host
        self._port = settings.smtp_port
        self._user = settings.smtp_user
        self._password = settings.smtp_password
        self._from = settings.smtp_from
        self._starttls = settings.smtp_starttls
        self._frontend_url = settings.frontend_url.rstrip("/")

    def enviar_correo(
        self,
        destinatario: str,
        asunto: str,
        cuerpo_texto: str,
        cuerpo_html: Optional[str] = None,
    ) -> None:
        """Envía un correo vía SMTP. Falla explícitamente si no hay broker
        configurado.

        Antes de abrir la conexión se consulta el circuit breaker
        (`_circuito_smtp`, degradacion-controlada slice 3): si está ABIERTO,
        esta función NUNCA llama a `smtplib` -- levanta `ServicioNoDisponible`
        de inmediato (mismo contrato que `cloudinary_cliente.py::_subir`).

        Clasificación de fallos (Decisión D del diseño): un fallo de
        TRANSPORTE (conexión, HELO, autenticación, timeout de socket, u
        `OSError` genérico -- `smtplib.SMTPException` hereda de `OSError`)
        cuenta contra el circuito. Un RECHAZO de este mensaje puntual
        (destinatario, remitente o datos rechazados por el servidor) también
        se traduce a `ServicioNoDisponible`, pero NO cuenta: el circuito mide
        la salud del proveedor, no la calidad de los datos de un mensaje --
        de lo contrario tres direcciones malas en un mismo lote abrirían el
        circuito para todos los destinatarios siguientes."""
        if not self._host:
            raise RuntimeError(
                "SMTP_HOST no está configurado: no se puede enviar correo real. "
                "Configura SMTP_HOST, SMTP_PORT, SMTP_USER y SMTP_PASSWORD."
            )

        if not _circuito_smtp.permitir():
            raise ServicioNoDisponible(
                f"SMTP no disponible (circuito abierto): destinatario={destinatario}"
            )

        msg = MIMEMultipart("alternative")
        msg["Subject"] = asunto
        msg["From"] = self._from
        msg["To"] = destinatario
        msg.attach(MIMEText(cuerpo_texto, "plain", "utf-8"))
        if cuerpo_html:
            msg.attach(MIMEText(cuerpo_html, "html", "utf-8"))

        try:
            with smtplib.SMTP(self._host, self._port, timeout=TIMEOUT_SMTP_SEGUNDOS) as server:
                if self._starttls:
                    server.starttls()
                if self._user:
                    server.login(self._user, self._password)
                server.sendmail(self._from, destinatario, msg.as_string())
        except (
            smtplib.SMTPRecipientsRefused,
            smtplib.SMTPSenderRefused,
            smtplib.SMTPDataError,
        ) as exc:
            # Rechazo de ESTE mensaje puntual: no cuenta contra el circuito.
            raise ServicioNoDisponible(
                f"Destinatario rechazado por el servidor SMTP: {destinatario}"
            ) from exc
        except OSError as exc:
            # `smtplib.SMTPException` hereda de `OSError`: este único except
            # cubre `SMTPConnectError`, `SMTPServerDisconnected`,
            # `SMTPHeloError`, `SMTPAuthenticationError`, `socket.timeout` y
            # cualquier `OSError` genérico de la capa de transporte.
            _circuito_smtp.registrar_fallo()
            detalle = _redactar_detalle_sensible(str(exc))
            logger.error("Fallo de transporte SMTP enviando a %s: %s", destinatario, detalle)
            raise ServicioNoDisponible(f"SMTP no disponible: {detalle}") from exc
        else:
            _circuito_smtp.registrar_exito()

        logger.info("Correo enviado a %s con asunto '%s'", destinatario, asunto)

    def enviar_recuperacion_contrasenia(self, correo: str, token: str) -> None:
        """Envía el enlace de restablecimiento de contraseña al usuario."""
        enlace = f"{self._frontend_url}/reset-password?token={token}"
        asunto = "Recuperación de contraseña - Cata Club"
        texto = (
            f"Hola,\n\n"
            f"Recibimos una solicitud para restablecer su contraseña en Cata Club.\n"
            f"Puede hacerlo haciendo clic en el siguiente enlace (válido por 30 minutos):\n\n"
            f"{enlace}\n\n"
            f"Si no solicitó el cambio, ignore este correo.\n\n"
            f"Saludos,\nEquipo Cata Club"
        )
        html = (
            "<html><body>"
            "<p>Hola,</p>"
            "<p>Recibimos una solicitud para restablecer su contraseña en Cata Club.</p>"
            f'<p><a href="{enlace}">Restablecer contraseña</a> (válido por 30 minutos)</p>'
            "<p>Si no solicitó el cambio, ignore este correo.</p>"
            "<p>Saludos,<br>Equipo Cata Club</p>"
            "</body></html>"
        )
        self.enviar_correo(correo, asunto, texto, html)
        logger.info("[RECUPERAR_CONTRASENIA] correo=%s", correo)
