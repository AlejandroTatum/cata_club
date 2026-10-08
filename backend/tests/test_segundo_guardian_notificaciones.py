"""Issue #1666: ambos guardianes reciben las notificaciones y los correos del
menor ("Ambos", decisión del dueño). Un fallo o la ausencia de cuenta de uno no
afecta al otro, y al retirar al segundo guardián deja de recibirlos."""
# ruff: noqa: F811
from datetime import date

from app.dominio.cedula import cedula_valida
from app.dominio.enums import EstadoPago, TipoNotificacion, TipoRol
from app.dominio.modelos import CoRepresentante, Notificacion, Persona, Rol, Usuario
from app.infraestructura.notificaciones_servicio import ServicioNotificaciones  # noqa: F401
from app.servicios_negocio.dtos.membresia_pago_schemas import PagoValidarDTO
from app.servicios_negocio.membresia_pago_servicio import PagoServicio
from app.servicios_negocio.notificacion_servicio import NotificacionServicio
from tests import arnes_outbox as arnes
import tests.test_alertas_vencimiento as venc
from tests.test_alertas_vencimiento import (  # noqa: F401  (fixture de módulo)
    _crear_membresia_con_pago, _crear_persona, _crear_usuario, _mock_envio, sesion_inyectada,
)
from tests.test_correos_validacion_pago import (  # noqa: F401  (fixture de módulo)
    CORREO_REPRESENTANTE, MOTIVO_RECHAZO, _pago_de_representado, _texto, smtp_capturado,
)

CORREO_SEGUNDO = "segundo.guardian@cataclub.test"


def _segundo_guardian(db_session, representado, creador, *, con_cuenta=True, seed=940) -> Persona:
    segundo = Persona(
        nombres="Pablo", apellidos="Torres", cedula=cedula_valida(seed),
        fecha_nacimiento=date(1983, 2, 2), telefono="0990000940",
    )
    db_session.add(segundo)
    db_session.flush()
    if con_cuenta:
        db_session.add(Usuario(
            correo=CORREO_SEGUNDO, contrasenia="hash", persona_id=segundo.id,
            correo_verificado=True,
            roles=[Rol(tipo_rol=TipoRol.REPRESENTANTE, descripcion="Representante")],
        ))
    db_session.add(CoRepresentante(
        persona_id=representado.id, co_representante_id=segundo.id,
        creado_por_persona_id=creador.id,
    ))
    db_session.commit()
    return segundo


# --- Correos de validación de pago -----------------------------------------
def test_pago_aprobado_avisa_a_los_dos_guardianes(db_session, smtp_capturado):
    admin, representante, representado, _membresia, pago = _pago_de_representado(db_session)
    _segundo_guardian(db_session, representado, representante)

    PagoServicio(db_session).validar_pago(
        pago.id, PagoValidarDTO(estado_pago=EstadoPago.APROBADO), actor_persona_id=admin.id,
    )
    arnes.despachar_correos_encolados(db_session)

    assert sorted(envio["destinatario"] for envio in smtp_capturado) == sorted(
        [CORREO_REPRESENTANTE, CORREO_SEGUNDO]
    )
    por_destino = {envio["destinatario"]: _texto(envio) for envio in smtp_capturado}
    assert por_destino[CORREO_REPRESENTANTE].startswith("Pago aprobado\n\nHola Marta,")
    assert por_destino[CORREO_SEGUNDO].startswith("Pago aprobado\n\nHola Pablo,")
    assert "Nico" in por_destino[CORREO_SEGUNDO]


def test_pago_rechazado_avisa_a_los_dos_guardianes(db_session, smtp_capturado):
    admin, representante, representado, _membresia, pago = _pago_de_representado(db_session)
    _segundo_guardian(db_session, representado, representante)

    PagoServicio(db_session).validar_pago(
        pago.id,
        PagoValidarDTO(estado_pago=EstadoPago.RECHAZADO, motivo_rechazo=MOTIVO_RECHAZO),
        actor_persona_id=admin.id,
    )
    arnes.despachar_correos_encolados(db_session)

    assert sorted(envio["destinatario"] for envio in smtp_capturado) == sorted(
        [CORREO_REPRESENTANTE, CORREO_SEGUNDO]
    )
    assert all(MOTIVO_RECHAZO in _texto(envio) for envio in smtp_capturado)


def test_un_segundo_guardian_sin_cuenta_no_afecta_al_principal(db_session, smtp_capturado):
    admin, representante, representado, _membresia, pago = _pago_de_representado(db_session)
    _segundo_guardian(db_session, representado, representante, con_cuenta=False)

    PagoServicio(db_session).validar_pago(
        pago.id, PagoValidarDTO(estado_pago=EstadoPago.APROBADO), actor_persona_id=admin.id,
    )
    arnes.despachar_correos_encolados(db_session)

    assert [envio["destinatario"] for envio in smtp_capturado] == [CORREO_REPRESENTANTE]


def test_el_segundo_guardian_retirado_deja_de_recibir_correos(db_session, smtp_capturado):
    admin, representante, representado, _membresia, pago = _pago_de_representado(db_session)
    _segundo_guardian(db_session, representado, representante)
    db_session.query(CoRepresentante).delete()
    db_session.commit()
    db_session.expire_all()

    PagoServicio(db_session).validar_pago(
        pago.id, PagoValidarDTO(estado_pago=EstadoPago.APROBADO), actor_persona_id=admin.id,
    )
    arnes.despachar_correos_encolados(db_session)

    assert [envio["destinatario"] for envio in smtp_capturado] == [CORREO_REPRESENTANTE]


# --- Aviso in-app del menor: ambos lo ven en su campana ---------------------
def test_el_aviso_in_app_del_menor_aparece_en_el_feed_de_los_dos(db_session, smtp_capturado):
    admin, representante, representado, _membresia, pago = _pago_de_representado(db_session)
    segundo = _segundo_guardian(db_session, representado, representante)

    PagoServicio(db_session).validar_pago(
        pago.id, PagoValidarDTO(estado_pago=EstadoPago.APROBADO), actor_persona_id=admin.id,
    )

    servicio = NotificacionServicio(db_session)
    for guardian in (representante, segundo):
        items, total = servicio.listar_para_persona_y_hijos(guardian.id)
        assert total == 1
        assert items[0].tipo == TipoNotificacion.PAGO_APROBADO
        assert items[0].mensaje.startswith("Para Nico Torres:")


def test_marcar_todas_leidas_alcanza_los_avisos_del_menor_del_segundo_guardian(db_session, smtp_capturado):
    admin, representante, representado, _membresia, pago = _pago_de_representado(db_session)
    segundo = _segundo_guardian(db_session, representado, representante)
    PagoServicio(db_session).validar_pago(
        pago.id, PagoValidarDTO(estado_pago=EstadoPago.APROBADO), actor_persona_id=admin.id,
    )

    assert NotificacionServicio(db_session).marcar_todas_leidas(segundo.id) == 1


# --- Alertas por lote (vencimiento) -----------------------------------------
def test_la_alerta_de_vencimiento_llega_a_los_dos_guardianes_una_sola_vez(
    db_session, sesion_inyectada, monkeypatch,
):
    monkeypatch.setattr(venc.alertas_mod, "hoy_club", lambda: venc.HOY)
    principal = _crear_persona(db_session, cedula_valida(950))
    _crear_usuario(db_session, principal, "principal950@cataclub.test")
    alumno = _crear_persona(db_session, cedula_valida(951), representante_id=principal.id)
    segundo = _crear_persona(db_session, cedula_valida(952))
    _crear_usuario(db_session, segundo, "segundo952@cataclub.test")
    db_session.add(CoRepresentante(
        persona_id=alumno.id, co_representante_id=segundo.id, creado_por_persona_id=principal.id,
    ))
    _crear_membresia_con_pago(db_session, alumno, venc.VENCE)
    llamadas = _mock_envio(monkeypatch)

    venc.alertas_mod.alertar_vencimientos_hoy_mas_5()
    venc.alertas_mod.alertar_vencimientos_hoy_mas_5()  # reintento: sin duplicados

    assert sorted(e["destinatario"] for e in llamadas) == [
        "principal950@cataclub.test", "segundo952@cataclub.test",
    ]
    for guardian in (principal, segundo):
        filas = db_session.query(Notificacion).filter_by(persona_id=guardian.id).all()
        assert len(filas) == 1 and "vence" in filas[0].mensaje
    assert db_session.query(Notificacion).filter_by(persona_id=alumno.id).count() == 0


def test_un_menor_con_un_solo_guardian_sigue_recibiendo_un_solo_aviso(
    db_session, sesion_inyectada, monkeypatch,
):
    monkeypatch.setattr(venc.alertas_mod, "hoy_club", lambda: venc.HOY)
    principal = _crear_persona(db_session, cedula_valida(953))
    _crear_usuario(db_session, principal, "principal953@cataclub.test")
    alumno = _crear_persona(db_session, cedula_valida(954), representante_id=principal.id)
    _crear_membresia_con_pago(db_session, alumno, venc.VENCE)
    llamadas = _mock_envio(monkeypatch)

    venc.alertas_mod.alertar_vencimientos_hoy_mas_5()

    assert [e["destinatario"] for e in llamadas] == ["principal953@cataclub.test"]
