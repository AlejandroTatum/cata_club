"""
Doble de `smtplib.SMTP` para probar un LOTE de alertas contra el clasificador
REAL de `notificaciones_servicio`.

Por qué no alcanza con `_mock_envio` (el helper que ya tienen
`test_alertas_vencimiento.py` y `test_alertas_mora.py`): ese doble reemplaza
`ServicioNotificaciones.enviar_correo` entero, así que el test elige a mano
qué excepción de DOMINIO sale. Justamente lo que el issue #837 pone en duda es
esa traducción -- si un `SMTPRecipientsRefused` con código 5xx se distingue de
un fallo global -- y un doble que la saltea no puede probarla.

Este doble se pone una capa más abajo, en `smtplib.SMTP`, y deja correr el
clasificador de verdad: el test declara el CÓDIGO SMTP crudo del rechazo y
observa qué hace el lote. El mismo test sirve de RED (hoy el lote aborta) y de
GREEN (el lote sigue con el destinatario siguiente) sin cambiar una línea.
"""
import smtplib

from app.infraestructura import notificaciones_servicio as notificaciones_mod
from app.soporte_transversal.configuracion import settings


class RegistroSMTP:
    """Qué direcciones llegaron a `sendmail` sin ser rechazadas."""

    def __init__(self) -> None:
        self.enviados: list[str] = []


def configurar_smtp_falso(
    monkeypatch,
    *,
    rechazos: dict[str, tuple[int, str]] | None = None,
    fallo_de_transporte: Exception | None = None,
) -> RegistroSMTP:
    """Deja `settings` con SMTP "configurado" (host presente, sin auth ni
    STARTTLS, para no tener que doblar `login`) y reemplaza `smtplib.SMTP` por
    un doble.

    `rechazos` mapea destinatario -> `(codigo, mensaje)`: esa dirección
    levanta `SMTPRecipientsRefused` con ese código por-destinatario, que es
    exactamente la estructura que `smtplib` arma en producción. El resto de
    las direcciones se registran como entregadas.

    `fallo_de_transporte` levanta esa excepción al ABRIR la conexión (antes
    de cualquier `sendmail`), para el caso global/reintentable.
    """
    monkeypatch.setattr(settings, "smtp_host", "smtp.test")
    monkeypatch.setattr(settings, "smtp_port", 587)
    monkeypatch.setattr(settings, "smtp_user", "")
    monkeypatch.setattr(settings, "smtp_starttls", False)

    registro = RegistroSMTP()
    tabla_de_rechazos = rechazos or {}

    class _SMTPFalso:
        def __init__(self, host, port, timeout=None):
            if fallo_de_transporte is not None:
                raise fallo_de_transporte

        def __enter__(self):
            return self

        def __exit__(self, *_excepcion):
            return False

        def starttls(self):
            return None

        def login(self, usuario, clave):
            return None

        def sendmail(self, remitente, destinatario, mensaje):
            respuesta = tabla_de_rechazos.get(destinatario)
            if respuesta is not None:
                raise smtplib.SMTPRecipientsRefused({destinatario: respuesta})
            registro.enviados.append(destinatario)

    monkeypatch.setattr(notificaciones_mod.smtplib, "SMTP", _SMTPFalso)
    return registro
