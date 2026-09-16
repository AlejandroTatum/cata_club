"""Aviso a los administradores cuando el tope diario de correos omite envíos.

El guardarraíl del plan gratuito de Resend vive en
`notificaciones_servicio._reservar_cupo_de_envio_diario` y, cuando el cupo se
agota, omite el envío con un warning. Un warning en un log no lo ve nadie:
el club se queda sin correos -- avisos de pago, de vencimiento, de mora -- y
la única señal es una línea que hay que ir a buscar. Lo que estos tests fijan:

  - agotado el cupo, cada administrador ACTIVO recibe UNA notificación in-app
    por día del club, con el total de envíos omitidos de ese día;
  - los envíos posteriores del mismo día REFRESCAN esa fila (una sola
    notificación, con el acumulado), no crean otra;
  - por debajo del cupo no se avisa nada;
  - un fallo al avisar JAMÁS se propaga al envío ya omitido: la operación que
    envuelve al correo (una validación de pago, una entrega de outbox) ya está
    commiteada y no puede fallar por esto.

Mismo doble de SMTP y misma inyección de sesión que
`test_limite_correos_diario.py`. Datos ficticios.
"""
from contextlib import contextmanager
from datetime import datetime, timezone

import pytest

from app.dominio.cedula import cedula_valida
from app.dominio.enums import TipoNotificacion, TipoRol
from app.dominio.modelos import ContadorCorreoDiario, Notificacion, Rol, Usuario
from app.infraestructura import notificaciones_servicio as notificaciones_mod
from app.infraestructura.notificaciones_servicio import ServicioNotificaciones
from tests.fabricas_pagos import crear_persona_orm
from tests.smtp_falso import configurar_smtp_falso

CORREO = "cupo.ficticio@cataclub.test"
ASUNTO = "Cata Club | Prueba de cupo"
CUERPO = "cuerpo de prueba"


def _hoy_utc():
    return datetime.now(timezone.utc).date()


def _enviar() -> None:
    ServicioNotificaciones().enviar_correo(CORREO, ASUNTO, CUERPO)


@pytest.fixture()
def smtp_capturado(monkeypatch):
    return configurar_smtp_falso(monkeypatch)


@pytest.fixture()
def sesion_inyectada(db_session, monkeypatch):
    """`SessionLocal` del módulo apuntando a la transacción del test: la
    reserva del cupo Y el aviso a los administradores escriben ahí, y el
    teardown del `db_session` descarta todo. La fábrica cede la sesión sin
    cerrarla (mismo recurso que `contador_aislado`)."""

    @contextmanager
    def _factory():
        yield db_session

    monkeypatch.setattr(notificaciones_mod, "SessionLocal", _factory)
    # El contador real puede traer filas COMITEADAS por otros tests que ya
    # enviaron correo hoy; se limpian para que el cupo arranque de cero.
    db_session.query(ContadorCorreoDiario).delete()
    db_session.commit()
    return db_session


def _admin(sesion, semilla: int, *, activo: bool = True):
    """Persona + cuenta con rol ADMINISTRADOR (mismo criterio que
    `alertas_tareas._listar_administradores`: rol + `activo`)."""
    persona = crear_persona_orm(sesion, cedula_valida(960 + semilla))
    usuario = Usuario(
        correo=f"admin{semilla}.ficticio@cataclub.test",
        contrasenia="hash",
        persona_id=persona.id,
        activo=activo,
        roles=[Rol(tipo_rol=TipoRol.ADMINISTRADOR, descripcion="Administrador")],
    )
    sesion.add(usuario)
    sesion.commit()
    return persona, usuario


def _avisos(sesion) -> list[Notificacion]:
    return (
        sesion.query(Notificacion)
        .filter(Notificacion.tipo == TipoNotificacion.RESUMEN_CUPO_CORREO_ADMIN)
        .order_by(Notificacion.persona_id)
        .all()
    )


def test_el_valor_del_tipo_es_el_label_que_espera_postgres():
    """El valor viaja a la base y a la API tal cual: el label de Postgres
    (migración) y el `TipoNotificacion` de Python tienen que decir lo mismo."""
    assert TipoNotificacion.RESUMEN_CUPO_CORREO_ADMIN.value == "RESUMEN_CUPO_CORREO_ADMIN"


def test_al_agotar_el_cupo_avisa_a_cada_administrador(
    monkeypatch, sesion_inyectada, smtp_capturado,
):
    admin_a, _ = _admin(sesion_inyectada, 1)
    admin_b, _ = _admin(sesion_inyectada, 2)
    monkeypatch.setattr(notificaciones_mod.settings, "limite_correos_diario", 1)

    _enviar()  # consume el único cupo
    _enviar()  # se omite: acá tiene que salir el aviso

    assert smtp_capturado.enviados == [CORREO]
    avisos = _avisos(sesion_inyectada)
    assert {aviso.persona_id for aviso in avisos} == {admin_a.id, admin_b.id}
    # El contador reserva ANTES de decidir, así que el envío omitido deja
    # `enviados=2` con `limite=1`: un correo quedó sin salir.
    assert all("1" in aviso.mensaje for aviso in avisos)
    assert all(aviso.leida is False for aviso in avisos)


def test_por_debajo_del_cupo_no_hay_aviso(
    monkeypatch, sesion_inyectada, smtp_capturado,
):
    _admin(sesion_inyectada, 3)
    monkeypatch.setattr(notificaciones_mod.settings, "limite_correos_diario", 5)

    _enviar()
    _enviar()

    assert smtp_capturado.enviados == [CORREO, CORREO]
    assert _avisos(sesion_inyectada) == []


def test_el_aviso_es_uno_por_administrador_y_refresca_el_acumulado(
    monkeypatch, sesion_inyectada, smtp_capturado,
):
    """Tres envíos omitidos el mismo día: UNA fila por administrador, y el
    mensaje con el acumulado del día -- no el del primer omitido."""
    admin, _ = _admin(sesion_inyectada, 4)
    monkeypatch.setattr(notificaciones_mod.settings, "limite_correos_diario", 1)

    for _ in range(4):  # 1 envío real + 3 omitidos
        _enviar()

    avisos = _avisos(sesion_inyectada)
    assert len(avisos) == 1
    assert avisos[0].persona_id == admin.id
    assert "3" in avisos[0].mensaje


def test_una_cuenta_de_administrador_inactiva_no_recibe_el_aviso(
    monkeypatch, sesion_inyectada, smtp_capturado,
):
    activo, _ = _admin(sesion_inyectada, 5)
    _admin(sesion_inyectada, 6, activo=False)
    monkeypatch.setattr(notificaciones_mod.settings, "limite_correos_diario", 1)

    _enviar()
    _enviar()

    assert [aviso.persona_id for aviso in _avisos(sesion_inyectada)] == [activo.id]


def test_un_fallo_al_avisar_no_rompe_el_envio_omitido(
    monkeypatch, sesion_inyectada, smtp_capturado,
):
    """Frontera que importa: el aviso es best-effort. Si la notificación
    explota, el envío omitido sigue siendo un no-evento -- `enviar_correo`
    retorna normal y nada se propaga a la operación que lo envuelve."""
    _admin(sesion_inyectada, 7)
    monkeypatch.setattr(notificaciones_mod.settings, "limite_correos_diario", 1)

    def _avisar_explota(_omitidos: int) -> None:
        raise RuntimeError("base caída al avisar")

    monkeypatch.setattr(notificaciones_mod, "_sincronizar_aviso_cupo_admin", _avisar_explota)

    _enviar()
    _enviar()  # no debe levantar

    assert smtp_capturado.enviados == [CORREO]
    assert sesion_inyectada.query(ContadorCorreoDiario).one().enviados == 2
