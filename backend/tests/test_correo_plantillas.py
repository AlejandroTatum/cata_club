"""
Cambio de texto y layout de marca de los correos transaccionales (issue
#1375 sobre la base de #898): recuperación de contraseña, verificación de
correo, vencimiento próximo de membresía y mora (día 1 y día 8, que
comparten superficie pero difieren en asunto).

Issue #1375 introduce UN layout de marca compartido para los cinco correos
transaccionales (tablas con role=presentation, escudo adjunto inline por
cid:, alt significativo y el nombre del club siempre en texto): la decisión
explícita del dueño reemplaza la ronda 2 de #898, que había pedido solo
texto. Los CORREOS DE ALERTA (vencimiento y mora, en `alertas_tareas.py`)
quedan fuera de #1375 y siguen saliendo solo texto plano.

Se valida contra un doble de `smtplib.SMTP` (sin conexión SMTP real) el
asunto, el remitente, las frases que pide el issue y el layout de marca.
Los datos usados (correo, token, nombre) son ficticios; ninguno es un dato
personal real.
"""
from datetime import date
from email import message_from_string
from email.header import decode_header, make_header
from email.message import Message
from email.utils import parseaddr

import pytest

from app.dominio.enums import TipoNotificacion
from app.infraestructura.plantillas_correo import ID_CONTENIDO_ESCUDO, bytes_del_escudo
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
    """Parsea el mensaje MIME crudo. Devuelve `(mensaje, partes)` de primer
    nivel: 1 parte (solo texto) para vencimiento/mora -- fuera del alcance
de #1375 -- y 2 partes (texto + related de marca) para los
    transaccionales."""
    parsed = message_from_string(mensaje_raw)
    assert parsed.is_multipart()
    return parsed, parsed.get_payload()


def _decodificar(parte: Message) -> str:
    return parte.get_payload(decode=True).decode("utf-8")


def _asunto_decodificado(parsed: Message) -> str:
    """`Subject` puede llegar como encoded-word (RFC 2047) por los acentos."""
    return str(make_header(decode_header(parsed["Subject"])))


def _html(cap: dict) -> str:
    """Parte HTML de un envío capturado (los transaccionales de #1375 viajan
    con texto + related de marca; el HTML vive dentro del related)."""
    parsed, _ = _partes(cap["mensaje"])
    return _decodificar(next(p for p in parsed.walk() if p.get_content_type() == "text/html"))


def _enviar_recuperacion() -> None:
    ServicioNotificaciones().enviar_recuperacion_contrasenia(CORREO_FICTICIO, TOKEN_FICTICIO)


def _enviar_verificacion() -> None:
    ServicioNotificaciones().enviar_verificacion_correo(CORREO_FICTICIO, TOKEN_FICTICIO)


def _enviar_verificacion_con_nombre() -> None:
    ServicioNotificaciones().enviar_verificacion_correo(
        CORREO_FICTICIO, TOKEN_FICTICIO, "Ana Ficticia",
    )


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
    pytest.param(_enviar_verificacion, "Cata Club | Bienvenida y verificación de correo", 2, id="verificacion"),
    pytest.param(_enviar_vencimiento, "Cata Club | Tu membresía vence pronto", 1, id="vencimiento"),
    pytest.param(_enviar_mora_dia_1, "Cata Club | Aviso de mora", 1, id="mora_dia_1"),
    pytest.param(_enviar_mora_dia_8, "Cata Club | Último aviso de mora", 1, id="mora_dia_8"),
]


@pytest.mark.parametrize(("accion", "asunto_esperado", "partes_esperadas"), CASOS)
def test_asunto_remitente_y_forma_del_mensaje(
    smtp_capturado, accion, asunto_esperado, partes_esperadas,
):
    """Asunto exacto del issue, remitente con nombre, y la MISMA forma MIME
de primer nivel que el formato ya tenía: los transaccionales siguen siendo
alternative(texto + related), solo que el related ahora lleva el escudo
adjunto; los avisos de texto siguen siendo una única parte plain, sin
related ni adjuntos."""
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
        assert partes[1].get_content_type() == "multipart/related"


def test_los_avisos_de_texto_no_llevan_related_ni_adjuntos(smtp_capturado):
    """Vencimiento/mora (fuera del alcance de #1375): solo texto, sin parte
    related ni image/png -- el cambio de marca no toca esos envíos."""
    _enviar_vencimiento()

    parsed, partes = _partes(smtp_capturado["mensaje"])

    assert parsed.get_content_type() == "multipart/alternative"
    assert [p.get_content_type() for p in partes] == ["text/plain"]
    assert not any(p.get_content_type() == "image/png" for p in parsed.walk())


def test_el_escudo_viaja_adjunto_en_linea_y_el_html_lo_referencia(smtp_capturado):
    """Feedback de #1375: el escudo NO sale por URL remota -- muchos clientes
    la bloquean y el host puede no ser público. Viaja como parte image/png
    con Content-ID dentro del multipart/related (después del HTML), con
    Content-Disposition inline, y el HTML lo referencia como `cid:`."""
    _enviar_recuperacion()

    parsed, _ = _partes(smtp_capturado["mensaje"])
    related = next(
        p for p in parsed.walk() if p.get_content_type() == "multipart/related"
    )
    subpartes = related.get_payload()

    assert subpartes[0].get_content_type() == "text/html"
    imagen = subpartes[1]
    assert imagen.get_content_type() == "image/png"
    assert imagen["Content-ID"] == f"<{ID_CONTENIDO_ESCUDO}>"
    assert "inline" in (imagen["Content-Disposition"] or "")
    assert imagen.get_payload(decode=True) == bytes_del_escudo()
    html = _decodificar(subpartes[0])
    assert f'src="cid:{ID_CONTENIDO_ESCUDO}"' in html


def test_recuperacion_advierte_token_de_un_solo_uso_y_30_minutos(smtp_capturado):
    _enviar_recuperacion()
    _, partes = _partes(smtp_capturado["mensaje"])
    texto = _decodificar(partes[0])
    html = _html(smtp_capturado)
    assert "30 minutos" in texto
    assert "un solo uso" in texto.lower()
    assert "Restablecer contraseña" in html
    assert "30 minutos" in html


def test_verificacion_advierte_24_horas_y_cuenta_la_historia_de_la_inscripcion(smtp_capturado):
    """Issue #1196: la misma historia que el resto de las superficies de
    inscripción -- verificar el correo, acercarse al club o escribir por
    WhatsApp para registrar la inscripción y el primer pago, y recién ahí se
    activa la membresía."""
    _enviar_verificacion()
    _, partes = _partes(smtp_capturado["mensaje"])
    texto = _decodificar(partes[0])
    html = _html(smtp_capturado)
    assert "24 horas" in texto
    assert "Verificar mi correo" in html
    assert "WhatsApp" in texto
    assert "el primer pago" in texto
    assert "el club lo valida" in texto
    assert "se activa la membresía" in texto


def test_verificacion_es_tambien_la_bienvenida_en_un_solo_correo(smtp_capturado):
    """QA4 REG-20: la bienvenida y la verificación eran dos correos casi
    iguales; ahora es uno, que da la bienvenida, confirma la inscripción y
    lleva el enlace."""
    _enviar_verificacion_con_nombre()
    _, partes = _partes(smtp_capturado["mensaje"])
    texto = _decodificar(partes[0])
    assert "Te damos la bienvenida a Cata Club" in texto
    assert "Tu inscripción quedó registrada" in texto
    assert TOKEN_FICTICIO in texto
    assert "Verificar mi correo" in _html(smtp_capturado)


def test_verificacion_no_afirma_uso_normal_ni_vincular_representado(smtp_capturado):
    """Guardia de no-regresión: ambas frases retiradas por el issue #1196 eran
    falsas -- la activación bloquea la cuenta por completo mientras el correo
    no esté verificado, y la vinculación de un representado por autoservicio
    se retiró en #1186."""
    _enviar_verificacion()
    _, partes = _partes(smtp_capturado["mensaje"])
    texto = _decodificar(partes[0]).lower()
    html = _html(smtp_capturado).lower()
    assert "con normalidad" not in texto
    assert "representad" not in texto
    assert "con normalidad" not in html
    assert "representad" not in html


def test_verificacion_saluda_con_el_nombre_cuando_esta_disponible(smtp_capturado):
    _enviar_verificacion_con_nombre()
    _, partes = _partes(smtp_capturado["mensaje"])
    texto = _decodificar(partes[0])
    html = _html(smtp_capturado)
    assert texto.startswith("Bienvenida y verificación de correo\n\nHola Ana Ficticia,")
    assert "Hola Ana Ficticia," in html


def test_verificacion_saluda_generico_sin_nombre(smtp_capturado):
    _enviar_verificacion()
    _, partes = _partes(smtp_capturado["mensaje"])
    texto = _decodificar(partes[0])
    assert texto.startswith("Bienvenida y verificación de correo\n\nHola,")


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
    assert "recuperar tus beneficios" in texto


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


@pytest.mark.parametrize(("accion", "con_html_de_marca"), [
    pytest.param(_enviar_recuperacion, True, id="recuperacion"),
    pytest.param(_enviar_verificacion, True, id="verificacion"),
    pytest.param(_enviar_vencimiento, False, id="vencimiento"),
    pytest.param(_enviar_mora_dia_1, False, id="mora_dia_1"),
    pytest.param(_enviar_mora_dia_8, False, id="mora_dia_8"),
])
def test_layout_de_marca_en_transaccionales_y_texto_plano_en_alertas(
    smtp_capturado, accion, con_html_de_marca,
):
    """Contrato de #1375: los transaccionales viajan con el layout de marca
    (lang=es, tablas presentacionales, escudo adjunto inline referenciado
    por cid:, alt significativo y "Cata Club" visible en texto para el
    cliente que bloquea imágenes). Los avisos de alerta siguen siendo de
    solo texto, como siempre: quedan fuera de #1375."""
    accion()

    mensaje = smtp_capturado["mensaje"]
    if not con_html_de_marca:
        assert "<html" not in mensaje
        return

    html = _html(smtp_capturado)
    assert '<html lang="es">' in html
    assert 'role="presentation"' in html
    assert f'src="cid:{ID_CONTENIDO_ESCUDO}"' in html
    assert 'alt="Cata Club"' in html
    assert "Cata Club" in html
    # Sin celdas de relleno vacías: la marca se lee incluso sin imágenes.
