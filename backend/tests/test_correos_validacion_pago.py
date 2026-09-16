"""
Correos transaccionales del ciclo de validación de pagos (PR 1 de mejoras de
experiencia del alumno).

T1: pago APROBADO -- plan, período cubierto, "vigente hasta" y una línea
corta de agradecimiento.
T2: pago RECHAZADO -- el motivo que dio el club y los tres pasos para
reintentar (el mismo procedimiento que la ayuda "Cómo se registra un pago"
del portal del alumno).

Mismo criterio que `test_correo_plantillas.py`: se valida contra un doble de
`smtplib.SMTP` (sin conexión real) el asunto, el destinatario, el remitente y
las frases obligatorias. Y contra la base real (`db-test`) que el correo sale
del MISMO punto donde se crea el aviso in-app: campana y correo no se
separan -- eso es lo que este archivo fija además del texto.

Ningún dato de estos tests es personal real.
"""
from datetime import date
from decimal import Decimal
from email import message_from_string
from email.header import decode_header, make_header
from email.message import Message
from email.utils import parseaddr

import pytest

from app.dominio.cedula import cedula_valida
from app.dominio.enums import EstadoMembresia, EstadoPago, TipoNotificacion, TipoPago
from app.dominio.modelos import Membresia, Notificacion, Pago, Persona, Usuario
from app.infraestructura.notificaciones_servicio import ServicioNotificaciones
from app.servicios_negocio.dtos.membresia_pago_schemas import PagoValidarDTO
from app.servicios_negocio.membresia_pago_servicio import PagoServicio
from app.soporte_transversal.configuracion import settings
from tests.fabricas_pagos import crear_membresia_orm, crear_persona_orm, crear_tipo_membresia_orm

CORREO_FICTICIO = "socio.ficticio@cataclub.test"
INICIO = date(2026, 8, 1)
FIN = date(2026, 8, 31)
INICIO_TXT = "01/08/2026"
FIN_TXT = "31/08/2026"
PLAN = "Adultos"
MOTIVO_RECHAZO = "El comprobante no coincide con el monto del plan"


@pytest.fixture()
def smtp_capturado(monkeypatch):
    """Deja `settings` con SMTP "configurado" y reemplaza `smtplib.SMTP` por
    un doble que captura cada mensaje RAW, sin abrir ninguna conexión."""
    monkeypatch.setattr(settings, "smtp_host", "smtp.test")
    monkeypatch.setattr(settings, "smtp_port", 587)
    monkeypatch.setattr(settings, "smtp_user", "")
    monkeypatch.setattr(settings, "smtp_starttls", False)
    monkeypatch.setattr(settings, "smtp_from", "no-reply@cataclub.test")
    monkeypatch.setattr(settings, "frontend_url", "https://app.cataclub.test")

    capturado: list[dict] = []

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
            capturado.append(
                {"remitente": remitente, "destinatario": destinatario, "mensaje": mensaje}
            )

    import app.infraestructura.notificaciones_servicio as mod

    monkeypatch.setattr(mod.smtplib, "SMTP", _SMTPFalso)
    return capturado


def _partes(mensaje_raw: str) -> tuple[Message, list[Message]]:
    """`(mensaje, partes)` del MIME crudo. Los correos de este ciclo viajan
    como texto plano + HTML simple, igual que recuperación y verificación
    (sin tablas ni preheader: el layout de la ronda 1 de #898 sigue
    retirado)."""
    parsed = message_from_string(mensaje_raw)
    assert parsed.is_multipart()
    return parsed, parsed.get_payload()


def _decodificar(parte: Message) -> str:
    return parte.get_payload(decode=True).decode("utf-8")


def _asunto_decodificado(parsed: Message) -> str:
    return str(make_header(decode_header(parsed["Subject"])))


def _texto(envio: dict) -> str:
    return _decodificar(_partes(envio["mensaje"])[1][0])


def _html(envio: dict) -> str:
    return _decodificar(_partes(envio["mensaje"])[1][1])


def _pago_pendiente(db_session, *, con_cuenta: bool) -> tuple[Persona, Persona, Membresia, Pago]:
    """Admin + titular (+ cuenta con correo, opcional) + membresía + pago
    PENDIENTE_VALIDACION. Mismo grafo mínimo que usa el resto de la suite de
    pagos (`tests/fabricas_pagos.py`), con el `Usuario` que estos correos
    necesitan como destinatario."""
    admin = crear_persona_orm(db_session, cedula_valida(910), telefono="0990000910")
    titular = crear_persona_orm(
        db_session, cedula_valida(911), nombres="Ana", apellidos="Torres",
    )
    if con_cuenta:
        db_session.add(Usuario(correo=CORREO_FICTICIO, contrasenia="hash", persona_id=titular.id))
        db_session.flush()
    tipo = crear_tipo_membresia_orm(db_session, categoria=PLAN, precio=Decimal("30.00"))
    membresia = crear_membresia_orm(db_session, titular, tipo, EstadoMembresia.INACTIVA)
    pago = Pago(
        monto=Decimal("30.00"), estado_pago=EstadoPago.PENDIENTE_VALIDACION,
        tipo_pago=TipoPago.EFECTIVO, fecha_inicio=INICIO, fecha_fin=FIN,
        persona_id=titular.id, membresia_id=membresia.id,
    )
    db_session.add(pago)
    db_session.commit()
    return admin, titular, membresia, pago


def test_pago_aprobado_cuenta_plan_periodo_vigencia_y_agradecimiento(smtp_capturado):
    """T1: el correo dice qué se aprobó, qué período cubre, hasta cuándo
    queda vigente y cierra con un agradecimiento corto. Sin montos: el club
    es flexible y el correo informa, no cobra."""
    ServicioNotificaciones().enviar_pago_aprobado(
        correo=CORREO_FICTICIO, nombre="Ana Ficticia", plan=PLAN,
        fecha_inicio=INICIO, fecha_fin=FIN, vigente_hasta=FIN,
    )

    assert len(smtp_capturado) == 1
    parsed, partes = _partes(smtp_capturado[0]["mensaje"])
    texto = _decodificar(partes[0])
    html = _html(smtp_capturado[0])

    assert _asunto_decodificado(parsed) == "Cata Club | Pago aprobado"
    assert parsed["To"] == CORREO_FICTICIO
    nombre_remitente, direccion_remitente = parseaddr(parsed["From"])
    assert nombre_remitente == "Cata Club"
    assert direccion_remitente == settings.smtp_from
    assert len(partes) == 2

    assert texto.startswith("Hola Ana Ficticia,")
    assert PLAN in texto
    assert INICIO_TXT in texto and FIN_TXT in texto
    assert f"vigente hasta el {FIN_TXT}" in texto
    assert "Gracias" in texto
    assert PLAN in html
    assert f"vigente hasta el {FIN_TXT}" in html


def test_pago_aprobado_saluda_generico_sin_nombre(smtp_capturado):
    """El nombre es opcional, igual que en verificación de correo."""
    ServicioNotificaciones().enviar_pago_aprobado(
        correo=CORREO_FICTICIO, nombre=None, plan=PLAN,
        fecha_inicio=INICIO, fecha_fin=FIN, vigente_hasta=FIN,
    )

    assert _texto(smtp_capturado[0]).startswith("Hola,")


def test_validar_pago_aprobado_manda_el_correo_junto_con_el_aviso_in_app(db_session, smtp_capturado):
    """El correo sale del MISMO punto donde nace el aviso in-app: si el
    alumno ve la campana, también recibe el correo (y al revés)."""
    admin, titular, membresia, pago = _pago_pendiente(db_session, con_cuenta=True)

    PagoServicio(db_session).validar_pago(
        pago.id, PagoValidarDTO(estado_pago=EstadoPago.APROBADO), actor_persona_id=admin.id,
    )

    assert [envio["destinatario"] for envio in smtp_capturado] == [CORREO_FICTICIO]
    texto = _texto(smtp_capturado[0])
    assert PLAN in texto
    assert f"vigente hasta el {FIN_TXT}" in texto
    aviso = (
        db_session.query(Notificacion)
        .filter_by(
            tipo=TipoNotificacion.PAGO_APROBADO,
            persona_id=titular.id,
            entidad_relacionada_id=pago.id,
        )
        .one()
    )
    assert "aprobado" in aviso.mensaje


def test_validar_pago_aprobado_sin_cuenta_no_manda_correo_ni_falla(db_session, smtp_capturado):
    """Un representado sin `Usuario` propio no tiene dirección a la que
    escribir: el correo se omite y la aprobación sigue igual."""
    admin, titular, membresia, pago = _pago_pendiente(db_session, con_cuenta=False)

    resultado = PagoServicio(db_session).validar_pago(
        pago.id, PagoValidarDTO(estado_pago=EstadoPago.APROBADO), actor_persona_id=admin.id,
    )

    assert resultado.estado_pago == EstadoPago.APROBADO
    assert smtp_capturado == []


def test_validar_pago_aprobado_sigue_aprobando_sin_smtp_configurado(db_session, monkeypatch):
    """Frontera de la issue #831, extendida al correo: la aprobación ya está
    commiteada cuando se intenta avisar. Un SMTP sin configurar no puede
    convertir esa operación real en un fallo."""
    monkeypatch.setattr(settings, "smtp_host", "")
    admin, titular, membresia, pago = _pago_pendiente(db_session, con_cuenta=True)

    resultado = PagoServicio(db_session).validar_pago(
        pago.id, PagoValidarDTO(estado_pago=EstadoPago.APROBADO), actor_persona_id=admin.id,
    )

    assert resultado.estado_pago == EstadoPago.APROBADO
    assert db_session.get(Membresia, membresia.id).estado == EstadoMembresia.ACTIVA
