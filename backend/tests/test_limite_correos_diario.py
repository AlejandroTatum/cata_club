"""
Límite diario de envíos SMTP: el guardarraíl del plan gratuito de Resend.

Todo el envío sale por un único chokepoint
(`ServicioNotificaciones.enviar_correo`), que corre tanto en la API como en
el worker Celery. Para que el cupo sea real tiene que ser compartido y
atómico entre procesos: por eso vive en la tabla `contador_correo_diario` y
la reserva es un `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` (ver
`notificaciones_servicio._reservar_cupo_de_envio_diario`).

Lo que estos tests fijan:
  - debajo del cupo: se envía y el contador sube;
  - en el cupo: no se llama a SMTP, no hay excepción y la operación envuelta
    (la validación de un pago) termina bien;
  - el contador es compartido entre instancias de servicio separadas;
  - la base caída no bloquea el envío (fail-open) y `limite <= 0` lo
    desactiva.

Mismo doble de `smtplib.SMTP` que el resto de la suite (`tests/smtp_falso`),
sin conexión real. Datos ficticios.
"""
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from app.dominio.cedula import cedula_valida
from app.dominio.enums import EstadoMembresia, EstadoPago, TipoPago
from app.dominio.modelos import ContadorCorreoDiario, Membresia, Pago, Usuario
from app.infraestructura import notificaciones_servicio as notificaciones_mod
from app.infraestructura.notificaciones_servicio import ServicioNotificaciones
from app.servicios_negocio.dtos.membresia_pago_schemas import PagoValidarDTO
from app.servicios_negocio.membresia_pago_servicio import PagoServicio
from app.soporte_transversal.configuracion import Settings, settings
from tests.fabricas_pagos import crear_membresia_orm, crear_persona_orm, crear_tipo_membresia_orm
from tests.smtp_falso import configurar_smtp_falso

CORREO = "limite.ficticio@cataclub.test"
ASUNTO = "Cata Club | Prueba de límite"
CUERPO = "cuerpo de prueba"
PLAN = "Adultos"


def _hoy_utc():
    return datetime.now(timezone.utc).date()


def _enviar(destinatario: str = CORREO) -> None:
    ServicioNotificaciones().enviar_correo(destinatario, ASUNTO, CUERPO)


@pytest.fixture()
def smtp_capturado(monkeypatch):
    """SMTP configurado + doble de `smtplib.SMTP`; devuelve el registro de
    direcciones que llegaron a `sendmail`."""
    return configurar_smtp_falso(monkeypatch)


@pytest.fixture()
def contador_aislado(db_session, monkeypatch):
    """El contador real (DB) pero sobre la transacción del test: `SessionLocal`
    del módulo de notificaciones apunta a `db_session`, así que las filas que
    escribe la reserva se revierten con el resto del test.

    La fábrica es un `contextmanager` que cede la sesión SIN cerrarla -- el
    cierre real de producción expulsaría a los objetos que el test ya tenía
    cargados (mismo recurso que `test_alertas_vencimiento.sesion_inyectada`)."""

    @contextmanager
    def _factory():
        yield db_session

    monkeypatch.setattr(notificaciones_mod, "SessionLocal", _factory)
    # El contador real puede traer filas COMITEADAS por otros tests que ya
    # enviaron correo ese mismo día; se borran dentro de la transacción del
    # test para que el cupo arranque de cero. El teardown las repone.
    db_session.query(ContadorCorreoDiario).delete()
    db_session.commit()
    return db_session


def _escenario_pago_pendiente(db_session, *, con_cuenta: bool = True):
    """Admin + titular (+ cuenta) + membresía + pago PENDIENTE_VALIDACION."""
    admin = crear_persona_orm(db_session, cedula_valida(940), telefono="0990000940")
    titular = crear_persona_orm(
        db_session, cedula_valida(941), nombres="Ana", apellidos="Torres",
        telefono="0990000941",
    )
    if con_cuenta:
        db_session.add(Usuario(correo=CORREO, contrasenia="hash", persona_id=titular.id))
        db_session.flush()
    tipo = crear_tipo_membresia_orm(db_session, categoria=PLAN, precio=Decimal("30.00"))
    membresia = crear_membresia_orm(db_session, titular, tipo, EstadoMembresia.INACTIVA)
    pago = Pago(
        monto=Decimal("30.00"), estado_pago=EstadoPago.PENDIENTE_VALIDACION,
        tipo_pago=TipoPago.EFECTIVO,
        fecha_inicio=_hoy_utc(), fecha_fin=_hoy_utc() + timedelta(days=30),
        persona_id=titular.id, membresia_id=membresia.id,
    )
    db_session.add(pago)
    db_session.commit()
    return admin, titular, membresia, pago


def test_el_limite_por_defecto_es_el_del_plan_gratuito():
    """100/día es el techo del plan gratuito de Resend; el default del campo
    lo refleja (la suite lo sube por su propio `monkeypatch` autouse, así que
    se lee el default declarado, no el valor vivo)."""
    assert Settings.model_fields["limite_correos_diario"].default == 100


def test_bajo_el_limite_envia_y_cuenta(
    monkeypatch, contador_aislado, smtp_capturado,
):
    monkeypatch.setattr(settings, "limite_correos_diario", 3)

    _enviar()

    assert smtp_capturado.enviados == [CORREO]
    contador = contador_aislado.query(ContadorCorreoDiario).one()
    assert contador.fecha == _hoy_utc()
    assert contador.enviados == 1


def test_en_el_cupo_omite_el_envio_sin_excepcion(
    monkeypatch, contador_aislado, smtp_capturado,
):
    monkeypatch.setattr(settings, "limite_correos_diario", 1)

    _enviar()
    # El segundo envío no levanta: solo se omite.
    _enviar()

    assert smtp_capturado.enviados == [CORREO]
    # El cupo se reserva ANTES de hablar con SMTP, así que el intento omitido
    # igual lo consumió: es la garantía de que el techo nunca se supera.
    assert contador_aislado.query(ContadorCorreoDiario).one().enviados == 2


def test_el_contador_se_comparte_entre_instancias(
    monkeypatch, contador_aislado, smtp_capturado,
):
    """Dos `ServicioNotificaciones` distintas -- la API y un worker Celery --
    comparten el mismo cupo porque el estado vive en la base, no en `self`."""
    monkeypatch.setattr(settings, "limite_correos_diario", 1)

    ServicioNotificaciones().enviar_correo(CORREO, ASUNTO, CUERPO)
    ServicioNotificaciones().enviar_correo(CORREO, ASUNTO, CUERPO)

    assert smtp_capturado.enviados == [CORREO]
    assert contador_aislado.query(ContadorCorreoDiario).one().enviados == 2


def test_el_cupo_es_por_dia(monkeypatch, contador_aislado, smtp_capturado):
    """Una fila de ayer agotada no toca el cupo de hoy."""
    monkeypatch.setattr(settings, "limite_correos_diario", 1)
    contador_aislado.add(ContadorCorreoDiario(fecha=_hoy_utc() - timedelta(days=1), enviados=100))
    contador_aislado.commit()

    _enviar()

    assert smtp_capturado.enviados == [CORREO]


def test_validar_pago_sigue_ok_con_el_cupo_agotado(
    monkeypatch, contador_aislado, smtp_capturado,
):
    """Frontera que importa: cuando el cupo se agota, la operación envuelta --
    una aprobación ya commiteada -- no puede fallar ni quedarse a medias."""
    monkeypatch.setattr(settings, "limite_correos_diario", 1)
    admin, titular, membresia, pago = _escenario_pago_pendiente(contador_aislado)
    contador_aislado.add(ContadorCorreoDiario(fecha=_hoy_utc(), enviados=1))
    contador_aislado.commit()

    resultado = PagoServicio(contador_aislado).validar_pago(
        pago.id, PagoValidarDTO(estado_pago=EstadoPago.APROBADO), actor_persona_id=admin.id,
    )

    assert resultado.estado_pago == EstadoPago.APROBADO
    assert contador_aislado.get(Membresia, membresia.id).estado == EstadoMembresia.ACTIVA
    assert smtp_capturado.enviados == []


def test_sin_base_no_bloquea_el_envio(monkeypatch, smtp_capturado):
    """Fail-open: un problema de base no puede frenar TODOS los correos. Se
    envía igual (el límite es control de costo, no corrección)."""

    def _base_caida():
        raise RuntimeError("base caída")

    monkeypatch.setattr(notificaciones_mod, "SessionLocal", _base_caida)

    _enviar()

    assert smtp_capturado.enviados == [CORREO]


def test_limite_cero_desactiva_el_control(monkeypatch, smtp_capturado):
    """`0` es el escape operativo; sin tocar la base, todos los envíos pasan."""
    monkeypatch.setattr(settings, "limite_correos_diario", 0)

    _enviar()

    assert smtp_capturado.enviados == [CORREO]
