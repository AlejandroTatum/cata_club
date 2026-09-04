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
from collections.abc import Mapping
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

from app.dominio.excepciones import (
    DestinatarioRechazadoPermanentemente,
    ServicioNoDisponible,
)
from app.infraestructura.asuntos_correo import ASUNTO_RECUPERACION
from app.soporte_transversal.circuito_breaker import CircuitoBreaker
from app.soporte_transversal.configuracion import settings
from app.soporte_transversal.resiliencia import (
    CIRCUITO_SMTP_COOLDOWN_SEGUNDOS,
    CIRCUITO_SMTP_UMBRAL_FALLOS,
    TIMEOUT_SMTP_SEGUNDOS,
)

logger = logging.getLogger("cataclub.notificaciones")

# Identidad de remitente de las cuatro superficies de correo transaccional
# (issue #898). Ronda 2: solo texto -- no cambia estructura MIME ni maquetado.
NOMBRE_REMITENTE = "Cata Club"


# Los errores de SMTP pueden repetir el usuario o la contraseña que el cliente
# intentó usar. Antes de ponerlos en un log o en un detalle técnico, se eliminan
# los valores configurados; el marcador conserva que hubo un error sin copiar
# credenciales a un agregador de logs.
def _redactar_detalle_sensible(detalle: str) -> str:
    for valor in (settings.smtp_user, settings.smtp_password):
        if valor:
            detalle = detalle.replace(valor, "[REDACTED]")
    return detalle


# Primer dígito de la respuesta SMTP con el que el servidor declara un fallo
# PERMANENTE (RFC 5321 §4.2.1: "5yz -- Permanent Negative Completion reply").
# Un 4yz es transitorio (buzón lleno, greylisting, rate limit) y por eso NO
# entra acá: reintentarlo puede funcionar, y esa es exactamente la diferencia
# que el issue #837 necesita poder leer.
_RANGO_5XX = range(500, 600)


def _codigo_de_respuesta(respuesta) -> Optional[int]:
    """Extrae el código numérico de un valor de `SMTPRecipientsRefused.
    recipients`, que `smtplib` arma como `(codigo, mensaje)`.

    Devuelve `None` ante cualquier forma inesperada -- una tupla vacía, un
    código que no es entero, un valor que ni siquiera es tupla. Sin código no
    hay evidencia, y sin evidencia no se declara nada terminal (ver
    `_es_rechazo_permanente_de_destinatario`)."""
    if isinstance(respuesta, (tuple, list)) and respuesta:
        codigo = respuesta[0]
        if isinstance(codigo, int) and not isinstance(codigo, bool):
            return codigo
    return None


def _es_rechazo_permanente_de_destinatario(
    exc: smtplib.SMTPRecipientsRefused,
) -> bool:
    """¿Este rechazo es atribuible a las DIRECCIONES y es definitivo?

    Fail closed en las tres formas de duda, porque el error caro es el
    contrario -- descartar para siempre un aviso que sí se podía entregar:

      - `recipients` vacío, ausente, o con una forma que no es un mapa: no
        hay ningún código que leer.
      - un código ilegible (no entero, tupla mal formada): no se adivina.
      - un 4xx, o una mezcla de 4xx y 5xx: mientras UNA dirección todavía
        pueda aceptar el mensaje, el rechazo no es terminal.

    En cualquiera de esos casos el llamador recibe el `ServicioNoDisponible`
    de siempre y el fallo sigue siendo visible y reintentable."""
    # La guarda de tipo importa por DÓNDE corre esto: dentro del `except` de
    # `enviar_correo`. Un `AttributeError` acá no lo atrapa nadie y aborta el
    # lote entero, que es el fallo que el #837 vino a eliminar.
    destinatarios = getattr(exc, "recipients", None) or {}
    if not isinstance(destinatarios, Mapping) or not destinatarios:
        return False
    for respuesta in destinatarios.values():
        codigo = _codigo_de_respuesta(respuesta)
        if codigo is None or codigo not in _RANGO_5XX:
            return False
    return True


def _resumir_rechazo(exc: smtplib.SMTPRecipientsRefused) -> str:
    """Texto de auditoría del rechazo: dirección, código y frase del
    proveedor. Es lo único que queda del episodio una vez que el lote
    siguió de largo, así que conserva el código -- "550" es lo que
    distingue "esa dirección no existe" de "el buzón estaba lleno"."""
    partes = []
    for direccion, respuesta in (getattr(exc, "recipients", None) or {}).items():
        codigo = _codigo_de_respuesta(respuesta)
        detalle = respuesta[1] if isinstance(respuesta, (tuple, list)) and len(respuesta) > 1 else ""
        if isinstance(detalle, bytes):
            detalle = detalle.decode("utf-8", "replace")
        partes.append(f"{direccion}: {codigo} {detalle}".strip())
    return "; ".join(partes) or str(exc)


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
        circuito para todos los destinatarios siguientes.

        Dentro de esos rechazos hay UNA subclase que además es TERMINAL
        (issue #837): un `SMTPRecipientsRefused` en el que todas las
        direcciones traen un código 5xx. Esa sale como
        `DestinatarioRechazadoPermanentemente` (subclase de
        `ServicioNoDisponible`) para que un lote pueda seguir con el
        destinatario siguiente en vez de reintentar contra una dirección que
        no va a existir. Un 4xx, una mezcla, un código ilegible, un remitente
        rechazado o un error de datos siguen saliendo como
        `ServicioNoDisponible` -- reintentables y globales, igual que antes.
        Nada de esto cambia el circuito."""
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
        # Cabecera VISIBLE con identidad de marca (issue #898): "Cata Club
        # <SMTP_FROM>". El sobre SMTP (`sendmail`, abajo) sigue usando
        # `self._from` -- la dirección cruda -- sin cambios: eso es MAIL
        # FROM, no lo que el cliente de correo muestra.
        msg["From"] = f"{NOMBRE_REMITENTE} <{self._from}>"
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
        except smtplib.SMTPRecipientsRefused as exc:
            # Rechazo de ESTE mensaje puntual: no cuenta contra el circuito
            # (Decisión D, sin cambios). Lo que sí se distingue ahora es si el
            # rechazo es DEFINITIVO para esa dirección (5xx por destinatario):
            # en ese caso reintentarlo es garantía de volver a fallar, y el
            # llamador necesita poder seguir con el destinatario siguiente en
            # vez de abortar el lote (issue #837).
            if _es_rechazo_permanente_de_destinatario(exc):
                detalle = _redactar_detalle_sensible(_resumir_rechazo(exc))
                logger.warning(
                    "Destinatario rechazado de forma permanente por SMTP: %s (%s)",
                    destinatario, detalle,
                )
                raise DestinatarioRechazadoPermanentemente(
                    f"Destinatario rechazado por el servidor SMTP: {destinatario}",
                    detalle,
                ) from exc
            raise ServicioNoDisponible(
                f"Destinatario rechazado por el servidor SMTP: {destinatario}"
            ) from exc
        except (
            smtplib.SMTPSenderRefused,
            smtplib.SMTPDataError,
        ) as exc:
            # Sin cambios: un remitente rechazado es casi siempre configuración
            # (SPF/DKIM, cuenta suspendida) y un error de datos puede ser
            # transitorio o global. Ninguno de los dos es "esta dirección no
            # existe", así que ninguno se declara terminal ni cuenta contra el
            # circuito.
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
        """Envía el enlace de restablecimiento de contraseña al usuario.

        Ronda 2 del issue #898: solo texto (asunto, aclaración de "un solo
        uso") sobre la misma estructura MIME/HTML que ya existía -- sin
        layout nuevo."""
        enlace = f"{self._frontend_url}/reset-password?token={token}"
        asunto = ASUNTO_RECUPERACION
        texto = (
            f"Hola,\n\n"
            f"Recibimos una solicitud para restablecer su contraseña en Cata Club.\n"
            f"Puede hacerlo haciendo clic en el siguiente enlace, válido por 30 "
            f"minutos y de un solo uso:\n\n"
            f"{enlace}\n\n"
            f"Si no solicitó el cambio, ignore este correo.\n\n"
            f"Saludos,\nEquipo Cata Club"
        )
        html = (
            "<html><body>"
            "<p>Hola,</p>"
            "<p>Recibimos una solicitud para restablecer su contraseña en Cata Club.</p>"
            f'<p><a href="{enlace}">Restablecer contraseña</a> (válido por 30 '
            "minutos, de un solo uso)</p>"
            "<p>Si no solicitó el cambio, ignore este correo.</p>"
            "<p>Saludos,<br>Equipo Cata Club</p>"
            "</body></html>"
        )
        self.enviar_correo(correo, asunto, texto, html)
        logger.info("[RECUPERAR_CONTRASENIA] correo=%s", correo)

    def enviar_verificacion_correo(self, correo: str, token: str) -> None:
        """Envía el enlace que prueba el control de la dirección (issue #790).

        El cuerpo dice para qué sirve verificar y qué pasa si no se hace: sin
        eso, quien se inscribe en el club no tiene forma de relacionar este
        correo con el rechazo que va a encontrar cuando intente agregar a otro
        representado. Ronda 2 del issue #898: solo cambia el asunto, sobre la
        misma estructura MIME/HTML que ya existía."""
        enlace = f"{self._frontend_url}/verificar-correo?token={token}"
        asunto = "Cata Club | Verificación de correo"
        texto = (
            f"Hola,\n\n"
            f"Gracias por registrarse en Cata Club. Para confirmar que esta "
            f"dirección es suya, abra el siguiente enlace (válido por 24 horas):\n\n"
            f"{enlace}\n\n"
            f"Mientras no verifique su correo podrá usar su cuenta con "
            f"normalidad, pero no podrá agregar a su cuenta a un representado "
            f"que ya esté registrado en el club.\n\n"
            f"Si usted no se registró, ignore este correo.\n\n"
            f"Saludos,\nEquipo Cata Club"
        )
        html = (
            "<html><body>"
            "<p>Hola,</p>"
            "<p>Gracias por registrarse en Cata Club. Para confirmar que esta "
            "dirección es suya, abra el siguiente enlace:</p>"
            f'<p><a href="{enlace}">Verificar mi correo</a> (válido por 24 horas)</p>'
            "<p>Mientras no verifique su correo podrá usar su cuenta con "
            "normalidad, pero no podrá agregar a su cuenta a un representado "
            "que ya esté registrado en el club.</p>"
            "<p>Si usted no se registró, ignore este correo.</p>"
            "<p>Saludos,<br>Equipo Cata Club</p>"
            "</body></html>"
        )
        self.enviar_correo(correo, asunto, texto, html)
        logger.info("[VERIFICAR_CORREO] correo=%s", correo)
