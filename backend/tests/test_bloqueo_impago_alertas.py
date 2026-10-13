"""Avisos del bloqueo por impago (#1768, S7): el aviso de mora del día 1 anuncia
el bloqueo del día 4, y un aviso único de lanzamiento llega a quien ya estaba
vencido cuando el bloqueo entra en vigor.
"""
from datetime import timedelta

import pytest

import app.infraestructura.tareas.alertas_tareas as alertas_mod
from app.dominio.enums import EstadoMembresia, EstadoPago, TipoNotificacion, TipoPago
from app.dominio.modelos import Notificacion
from app.dominio.periodicidad import PeriodicidadTarifa
from tests.arnes_bloqueo_impago import agregar_pago, crear_miembro, fijar_lanzamiento
from tests.test_alertas_mora import HOY, _crear_usuario, _mock_envio, sesion_inyectada  # noqa: F401

DIA_1 = TipoNotificacion.MIEMBRESIA_MORA_DIA_1
DIA_8 = TipoNotificacion.MIEMBRESIA_MORA_DIA_8


@pytest.fixture(autouse=True)
def _reloj_y_lanzamiento(monkeypatch):
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    fijar_lanzamiento(monkeypatch)


def _con_usuario(db, dias_vencido, **kwargs):
    persona, membresia = crear_miembro(db, cubierto_hasta=HOY - timedelta(days=dias_vencido), **kwargs)
    _crear_usuario(db, persona, f"socio{persona.id}@cataclub.test")
    db.commit()
    return persona, membresia


def _mensajes(db, persona, tipo=DIA_1) -> list[str]:
    return [
        n.mensaje for n in db.query(Notificacion).filter(
            Notificacion.tipo == tipo, Notificacion.persona_id == persona.id,
        )
    ]


# --- Aviso de mora del día 1 ------------------------------------------------------------------
def test_el_aviso_del_dia_1_anuncia_el_bloqueo_del_dia_4_con_su_fecha(
    db_session, sesion_inyectada, monkeypatch,  # noqa: F811
):
    persona, _ = _con_usuario(db_session, 1)
    llamadas = _mock_envio(monkeypatch)

    alertas_mod.alertar_mora_diaria()

    [mensaje] = _mensajes(db_session, persona)
    # Venció ayer (14/06): la gracia llega al 17/06 y el bloqueo empieza el 18/06.
    assert "Tu membresía venció el 14/06/2029" in mensaje
    assert "18/06/2029" in mensaje and "día 4" in mensaje
    assert "18/06/2029" in llamadas[0]["cuerpo_texto"]


def test_si_el_bloqueo_ya_empezo_el_aviso_del_dia_1_lo_dice(db_session, sesion_inyectada, monkeypatch):  # noqa: F811
    persona, _ = _con_usuario(db_session, 5)  # recuperación de una corrida perdida: ya es el día 5
    _mock_envio(monkeypatch)

    alertas_mod.alertar_mora_diaria()

    [mensaje] = _mensajes(db_session, persona)
    assert "no puedes registrar asistencia" in mensaje
    assert "día 4" not in mensaje


def test_el_aviso_del_dia_1_cuenta_la_gracia_desde_el_lanzamiento(db_session, sesion_inyectada, monkeypatch):  # noqa: F811
    fijar_lanzamiento(monkeypatch, HOY)  # lanzamiento hoy: quien venció antes cuenta desde hoy
    persona, _ = _con_usuario(db_session, 2)
    _mock_envio(monkeypatch)

    alertas_mod.alertar_mora_diaria()

    [mensaje] = _mensajes(db_session, persona)
    assert "19/06/2029" in mensaje  # 15/06 + 4 días


def test_con_el_bloqueo_apagado_el_aviso_del_dia_1_conserva_su_texto(db_session, sesion_inyectada, monkeypatch):  # noqa: F811
    fijar_lanzamiento(monkeypatch, None)
    persona, _ = _con_usuario(db_session, 1)
    _mock_envio(monkeypatch)

    alertas_mod.alertar_mora_diaria()

    assert _mensajes(db_session, persona) == [
        "Tu membresía venció el 14/06/2029. Regulariza tu pago para no perder los beneficios."
    ]


def test_el_miembro_gratuito_recibe_el_aviso_del_dia_1_sin_bloqueo(db_session, sesion_inyectada, monkeypatch):  # noqa: F811
    persona, _ = _con_usuario(db_session, 1, gratuidad_familiar=True)
    _mock_envio(monkeypatch)

    alertas_mod.alertar_mora_diaria()

    [mensaje] = _mensajes(db_session, persona)
    assert "día 4" not in mensaje and "bloque" not in mensaje


def test_el_aviso_del_dia_8_no_cambia(db_session, sesion_inyectada, monkeypatch):  # noqa: F811
    persona, _ = _con_usuario(db_session, 8, estado=EstadoMembresia.VENCIDA)
    _mock_envio(monkeypatch)

    alertas_mod.alertar_mora_diaria()

    assert _mensajes(db_session, persona, DIA_8) == [
        "Tu membresía sigue vencida y este es el último aviso automático que recibirás."
    ]


# --- Aviso único de lanzamiento --------------------------------------------------------------------
def _lanzamiento(**kwargs):
    return alertas_mod.avisar_lanzamiento_bloqueo_impago(**kwargs)


def test_el_aviso_de_lanzamiento_llega_a_quien_ya_estaba_vencido(db_session, sesion_inyectada, monkeypatch):  # noqa: F811
    fijar_lanzamiento(monkeypatch, HOY + timedelta(days=7))
    persona, _ = _con_usuario(db_session, 30, estado=EstadoMembresia.VENCIDA)
    llamadas = _mock_envio(monkeypatch)

    resultado = _lanzamiento()

    assert resultado["total_avisos"] == 1
    [mensaje] = _mensajes(db_session, persona)
    assert "Tu membresía venció el 16/05/2029" in mensaje
    assert "26/06/2029" in mensaje  # lanzamiento 22/06 + 4 días
    assert [c["destinatario"] for c in llamadas] == [f"socio{persona.id}@cataclub.test"]


def test_el_aviso_de_lanzamiento_de_un_menor_va_a_su_representante_con_el_nombre(
    db_session, sesion_inyectada, monkeypatch,  # noqa: F811
):
    representante, _ = crear_miembro(
        db_session, cubierto_hasta=None, estado=EstadoMembresia.INACTIVA, nombres="Rita",
    )
    _crear_usuario(db_session, representante, "rita@cataclub.test")
    hijo, _ = crear_miembro(
        db_session, cubierto_hasta=HOY - timedelta(days=20), representante=representante, nombres="Nino",
    )
    db_session.commit()
    llamadas = _mock_envio(monkeypatch)

    _lanzamiento()

    [mensaje] = _mensajes(db_session, representante)
    assert mensaje.startswith("Para Nino")
    assert _mensajes(db_session, hijo) == []
    assert [c["destinatario"] for c in llamadas] == ["rita@cataclub.test"]


def test_el_aviso_de_lanzamiento_es_idempotente(db_session, sesion_inyectada, monkeypatch):  # noqa: F811
    persona, _ = _con_usuario(db_session, 20)
    _mock_envio(monkeypatch)

    primero = _lanzamiento()
    segundo = _lanzamiento()

    assert primero["total_avisos"] == 1
    assert segundo["total_avisos"] == 0
    assert len(_mensajes(db_session, persona)) == 1


def test_el_aviso_de_lanzamiento_no_pisa_el_aviso_regular_del_dia_1(db_session, sesion_inyectada, monkeypatch):  # noqa: F811
    persona, _ = _con_usuario(db_session, 1)
    _mock_envio(monkeypatch)

    _lanzamiento()
    alertas_mod.alertar_mora_diaria()

    assert len(_mensajes(db_session, persona)) == 2


def test_el_aviso_de_lanzamiento_con_dry_run_no_escribe_nada(db_session, sesion_inyectada, monkeypatch):  # noqa: F811
    persona, _ = _con_usuario(db_session, 20)
    llamadas = _mock_envio(monkeypatch)

    resultado = _lanzamiento(dry_run=True)

    assert resultado["total_avisos"] == 1
    assert resultado["dry_run"] is True
    assert _mensajes(db_session, persona) == []
    assert llamadas == []


def test_el_aviso_de_lanzamiento_no_sale_con_el_bloqueo_apagado(db_session, sesion_inyectada, monkeypatch):  # noqa: F811
    fijar_lanzamiento(monkeypatch, None)
    persona, _ = _con_usuario(db_session, 20)
    _mock_envio(monkeypatch)

    resultado = _lanzamiento()

    assert resultado["total_avisos"] == 0
    assert _mensajes(db_session, persona) == []


def test_el_aviso_de_lanzamiento_respeta_las_mismas_exenciones_que_el_bloqueo(
    db_session, sesion_inyectada, monkeypatch,  # noqa: F811
):
    _mock_envio(monkeypatch)
    al_dia, _ = _con_usuario(db_session, -5, estado=EstadoMembresia.ACTIVA)
    suspendido, _ = _con_usuario(db_session, 20, estado=EstadoMembresia.SUSPENDIDA)
    gratuito, _ = _con_usuario(db_session, 20, gratuidad_familiar=True)
    semanal, _ = _con_usuario(db_session, 20, periodicidad=PeriodicidadTarifa.SEMANAL)
    inactivo, _ = crear_miembro(db_session, cubierto_hasta=None, estado=EstadoMembresia.INACTIVA)
    pagando, membresia = _con_usuario(db_session, 20)
    agregar_pago(
        db_session, pagando, membresia, EstadoPago.PENDIENTE_VALIDACION,
        tipo_pago=TipoPago.TRANSFERENCIA, con_voucher=True,
        fecha_inicio=HOY, fecha_fin=HOY + timedelta(days=30),
    )
    db_session.commit()

    resultado = _lanzamiento()

    assert resultado["total_avisos"] == 0
    for persona in (al_dia, suspendido, gratuito, semanal, inactivo, pagando):
        assert _mensajes(db_session, persona) == []


def test_el_aviso_de_lanzamiento_dice_que_el_bloqueo_ya_rige_si_ya_paso_la_gracia(
    db_session, sesion_inyectada, monkeypatch,  # noqa: F811
):
    persona, _ = _con_usuario(db_session, 40)
    _mock_envio(monkeypatch)

    _lanzamiento()

    [mensaje] = _mensajes(db_session, persona)
    assert "no puedes registrar asistencia" in mensaje
