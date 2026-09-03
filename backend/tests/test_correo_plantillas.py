"""
Cambio de texto de las cinco variantes de correo transaccional (issue #898,
ronda 2 de revisión humana): recuperación de contraseña, verificación de
correo, vencimiento próximo de membresía y mora (día 1 y día 8, que
comparten superficie pero difieren en asunto).

Ronda 1 introdujo un layout HTML compartido (tablas, preheader oculto, CTA
con apariencia de botón); el dueño lo rechazó explícitamente ("esas pantallas
no tienen nada que ver, simplemente cambia el texto, nada de la UI"). Estos
tests verifican SOLO texto -- asunto exacto, remitente con nombre, frases
obligatorias, fecha -- sobre la MISMA estructura MIME/HTML que ya existía:
recuperación y verificación mandan texto plano + un HTML simple (`<html>
<body>...`, sin tablas ni preheader); vencimiento y mora mandan solo texto
plano, como siempre lo hicieron.

Se valida contra un doble de `smtplib.SMTP` (sin conexión SMTP real) el
asunto, el remitente y las frases que pide el issue. Los datos usados
(correo, token, nombre) son ficticios; ninguno es un dato personal real.
"""
from datetime import date
from email import message_from_string
from email.header import decode_header, make_header
from email.message import Message
from email.utils import parseaddr

import pytest

from app.dominio.enums import TipoNotificacion
from app.infraestructura.notificaciones_servicio import ServicioNotificaciones
from app.infraestructura.tareas.alertas_tareas import _render_mora, _render_vencimiento
from app.soporte_transversal.configuracion import settings

CORREO_FICTICIO = "socio.ficticio@cataclub.test"
TOKEN_FICTICIO = "token-de-prueba-ficticio"
FECHA_FICTICIA = date(2029, 6, 20)
FECHA_FICTICIA_TXT = "20/06/2029"
WHATSAPP_ESPERADO = "0994219619"


@pytest.fixture()
def smtp_capturado(monkeypatch):
    """Doble de `smtplib.SMTP` que captura el mensaje RAW pasado a
    `sendmail`, sin abrir ninguna conexión real."""
    monkeypatch.setattr(settings, "smtp_host", "smtp.test")
    monkeypatch.setattr(settings, "smtp_port", 587)
    monkeypatch.setattr(settings, "smtp_user", "")
    monkeypatch.setattr(settings, "smtp_starttls", False)
    monkeypatch.setattr(settings, "smtp_from", "no-reply@cataclub.test")
    monkeypatch.setattr(settings, "frontend_url", "https://app.cataclub.test")

    capturado: dict = {}

    class _SMTPFalso:
        def __init__(self, host, port, timeout=None):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_excepcion):
            return False

        def starttls(self):
            return None

        def login(self, usuario, clave):
            return None

        def sendmail(self, remitente, destinatario, mensaje):
            capturado["remitente"] = remitente
            capturado["destinatario"] = destinatario
            capturado["mensaje"] = mensaje

    import app.infraestructura.notificaciones_servicio as mod

    monkeypatch.setattr(mod.smtplib, "SMTP", _SMTPFalso)
    return capturado


def _partes(mensaje_raw: str) -> tuple[Message, list[Message]]:
    """Parsea el mensaje MIME crudo. Devuelve `(mensaje, partes)`: 1 parte
    (solo texto) para vencimiento/mora, 2 partes (texto + HTML, en ese
    orden) para recuperación/verificación -- mismo formato que ya existía
    antes de #898."""
    parsed = message_from_string(mensaje_raw)
    assert parsed.is_multipart()
    return parsed, parsed.get_payload()


def _decodificar(parte: Message) -> str:
    return parte.get_payload(decode=True).decode("utf-8")


def _asunto_decodificado(parsed: Message) -> str:
    """`Subject` puede llegar como encoded-word (RFC 2047) por los acentos."""
    return str(make_header(decode_header(parsed["Subject"])))


def _enviar_recuperacion() -> None:
    ServicioNotificaciones().enviar_recuperacion_contrasenia(CORREO_FICTICIO, TOKEN_FICTICIO)


def _enviar_verificacion() -> None:
    ServicioNotificaciones().enviar_verificacion_correo(CORREO_FICTICIO, TOKEN_FICTICIO)


def _enviar_vencimiento() -> None:
    asunto, texto = _render_vencimiento(
        "Ana Ficticia", f"Su membresía vence el {FECHA_FICTICIA_TXT}.",
    )
    ServicioNotificaciones().enviar_correo(CORREO_FICTICIO, asunto, texto)


def _enviar_mora_dia_1() -> None:
    asunto, texto = _render_mora(
        TipoNotificacion.MIEMBRESIA_MORA_DIA_1,
        "Ana Ficticia",
        f"Su membresía venció el {FECHA_FICTICIA_TXT}. Regularice su pago para no "
        f"perder los beneficios.",
    )
    ServicioNotificaciones().enviar_correo(CORREO_FICTICIO, asunto, texto)


def _enviar_mora_dia_8() -> None:
    asunto, texto = _render_mora(
        TipoNotificacion.MIEMBRESIA_MORA_DIA_8,
        "Ana Ficticia",
        "Su membresía sigue vencida y este es el último aviso automático que recibirá.",
    )
    ServicioNotificaciones().enviar_correo(CORREO_FICTICIO, asunto, texto)


# (accion, asunto_esperado, partes_esperadas)
CASOS = [
    pytest.param(_enviar_recuperacion, "Cata Club | Recuperación de contraseña", 2, id="recuperacion"),
    pytest.param(_enviar_verificacion, "Cata Club | Verificación de correo", 2, id="verificacion"),
    pytest.param(_enviar_vencimiento, "Cata Club | Su membresía vence pronto", 1, id="vencimiento"),
    pytest.param(_enviar_mora_dia_1, "Cata Club | Aviso de mora", 1, id="mora_dia_1"),
    pytest.param(_enviar_mora_dia_8, "Cata Club | Último aviso de mora", 1, id="mora_dia_8"),
]


@pytest.mark.parametrize(("accion", "asunto_esperado", "partes_esperadas"), CASOS)
def test_asunto_remitente_y_forma_del_mensaje(
    smtp_capturado, accion, asunto_esperado, partes_esperadas,
):
    """Asunto exacto del issue, remitente con nombre, y la MISMA cantidad de
    partes MIME que el formato ya tenía (no se agrega HTML donde no había,
    no se agregan partes nuevas donde ya había texto+HTML)."""
    accion()

    parsed, partes = _partes(smtp_capturado["mensaje"])

    assert _asunto_decodificado(parsed) == asunto_esperado
    assert parsed["To"] == CORREO_FICTICIO
    nombre_remitente, direccion_remitente = parseaddr(parsed["From"])
    assert nombre_remitente == "Cata Club"
    assert direccion_remitente == settings.smtp_from
    # El sobre SMTP (MAIL FROM) sigue siendo la dirección cruda, sin cambios.
    assert smtp_capturado["remitente"] == settings.smtp_from

    assert len(partes) == partes_esperadas
    assert partes[0].get_content_type() == "text/plain"
    if partes_esperadas == 2:
        assert partes[1].get_content_type() == "text/html"


def test_recuperacion_advierte_token_de_un_solo_uso_y_30_minutos(smtp_capturado):
    _enviar_recuperacion()
    _, partes = _partes(smtp_capturado["mensaje"])
    texto = _decodificar(partes[0])
    html = _decodificar(partes[1])
    assert "30 minutos" in texto
    assert "un solo uso" in texto.lower()
    assert "Restablecer contraseña" in html
    assert "30 minutos" in html


def test_verificacion_advierte_24_horas_y_representado_ya_registrado(smtp_capturado):
    _enviar_verificacion()
    _, partes = _partes(smtp_capturado["mensaje"])
    texto = _decodificar(partes[0])
    html = _decodificar(partes[1])
    assert "24 horas" in texto
    assert "representad" in texto.lower()
    assert "Verificar mi correo" in html


def test_vencimiento_menciona_ir_a_mis_pagos_whatsapp_y_fecha(smtp_capturado):
    _enviar_vencimiento()
    _, partes = _partes(smtp_capturado["mensaje"])
    texto = _decodificar(partes[0])
    assert "Ir a mis pagos" in texto
    assert WHATSAPP_ESPERADO in texto
    assert FECHA_FICTICIA_TXT in texto


def test_aviso_de_mora_dia_1_indica_como_recuperar_beneficios(smtp_capturado):
    _enviar_mora_dia_1()
    _, partes = _partes(smtp_capturado["mensaje"])
    texto = _decodificar(partes[0])
    assert "Ir a mis pagos" in texto
    assert WHATSAPP_ESPERADO in texto
    assert "recuperar sus beneficios" in texto


def test_ultimo_aviso_de_mora_indica_que_es_automatico_y_como_recuperar(smtp_capturado):
    _enviar_mora_dia_8()
    _, partes = _partes(smtp_capturado["mensaje"])
    texto = _decodificar(partes[0])
    assert "último aviso automático" in texto.lower()
    assert "Ir a mis pagos" in texto
    assert WHATSAPP_ESPERADO in texto


def test_ultimo_aviso_de_mora_no_repite_la_idea_del_ultimo_aviso(smtp_capturado):
    """Ronda 3 de revisión humana: el 4b decía "último aviso" dos veces en
    frases seguidas ("Este es el último aviso: regularice..." y luego "Este
    es el último aviso automático. Para recuperar..."). Debe fundirse en una
    sola idea."""
    _enviar_mora_dia_8()
    _, partes = _partes(smtp_capturado["mensaje"])
    texto = _decodificar(partes[0])
    assert texto.lower().count("último aviso") == 1


@pytest.mark.parametrize(
    ("accion", "prohibido"),
    [
        (_enviar_recuperacion, "<table"),
        (_enviar_verificacion, "<table"),
        (_enviar_vencimiento, "<table"),
        (_enviar_mora_dia_1, "<table"),
        (_enviar_mora_dia_8, "<table"),
        (_enviar_recuperacion, "role=\"presentation\""),
        (_enviar_verificacion, "role=\"presentation\""),
    ],
)
def test_no_reintroduce_layout_de_tabla_de_la_ronda_1(smtp_capturado, accion, prohibido):
    """Guardia de no-regresión (ronda 2): el layout con tablas de #898/ronda 1
    fue retirado por pedido del dueño; nada debe volver a introducirlo."""
    accion()
    assert prohibido not in smtp_capturado["mensaje"]
