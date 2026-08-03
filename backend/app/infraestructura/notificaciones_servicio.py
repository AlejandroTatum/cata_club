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

from app.soporte_transversal.configuracion import settings
from app.soporte_transversal.resiliencia import TIMEOUT_SMTP_SEGUNDOS

logger = logging.getLogger("cataclub.notificaciones")


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
        configurado."""
        if not self._host:
            raise RuntimeError(
                "SMTP_HOST no está configurado: no se puede enviar correo real. "
                "Configura SMTP_HOST, SMTP_PORT, SMTP_USER y SMTP_PASSWORD."
            )

        msg = MIMEMultipart("alternative")
        msg["Subject"] = asunto
        msg["From"] = self._from
        msg["To"] = destinatario
        msg.attach(MIMEText(cuerpo_texto, "plain", "utf-8"))
        if cuerpo_html:
            msg.attach(MIMEText(cuerpo_html, "html", "utf-8"))

        with smtplib.SMTP(self._host, self._port, timeout=TIMEOUT_SMTP_SEGUNDOS) as server:
            if self._starttls:
                server.starttls()
            if self._user:
                server.login(self._user, self._password)
            server.sendmail(self._from, destinatario, msg.as_string())

        logger.info("Correo enviado a %s con asunto '%s'", destinatario, asunto)

    def enviar_recuperacion_contrasenia(self, correo: str, token: str) -> None:
        """Envía el enlace de restablecimiento de contraseña al usuario."""
        enlace = f"{self._frontend_url}/reset-password?token={token}"
        asunto = "Recuperación de contraseña - Cata Club"
        texto = (
            f"Hola,\n\n"
            f"Recibimos una solicitud para restablecer tu contraseña en Cata Club.\n"
            f"Podés hacerlo clickeando el siguiente enlace (válido por 30 minutos):\n\n"
            f"{enlace}\n\n"
            f"Si no solicitaste el cambio, ignorá este correo.\n\n"
            f"Saludos,\nEquipo Cata Club"
        )
        html = (
            "<html><body>"
            "<p>Hola,</p>"
            "<p>Recibimos una solicitud para restablecer tu contraseña en Cata Club.</p>"
            f'<p><a href="{enlace}">Restablecer contraseña</a> (válido por 30 minutos)</p>'
            "<p>Si no solicitaste el cambio, ignorá este correo.</p>"
            "<p>Saludos,<br>Equipo Cata Club</p>"
            "</body></html>"
        )
        self.enviar_correo(correo, asunto, texto, html)
        logger.info("[RECUPERAR_CONTRASENIA] correo=%s", correo)
