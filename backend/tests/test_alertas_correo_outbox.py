# ruff: noqa: F811
"""
Los correos de las alertas de vencimiento y de mora van por el outbox
(issue #1710, S11).

Antes salían inline, uno por destinatario, mientras el lote armaba sus
`Notificacion`: con el cupo diario agotado el correo se perdía, y un 5xx de una
dirección obligaba a anotarlo en la fila in-app. Ahora cada correo se encola en
`correo_outbox` en la MISMA sesión y commit que las `Notificacion` del lote, y
el despachador lo entrega con cupo, reintentos y el cierre inmediato del
rechazo permanente. La tarea ya no abre SMTP ni depende de su circuito.
"""
from datetime import timedelta
from unittest.mock import MagicMock, patch

import pytest

import app.infraestructura.tareas.alertas_tareas as alertas_mod
from app.dominio.cedula import cedula_valida
from app.dominio.modelos import CoRepresentante, CorreoOutbox, Notificacion
from tests import arnes_outbox as arnes
from tests.smtp_falso import configurar_smtp_falso
from tests.test_alertas_mora import (  # noqa: F401  (fixture de módulo)
    HOY as HOY_MORA,
    _crear_membresia_con_pago as _membresia_en_mora,
    _crear_persona as _persona_mora,
    _crear_usuario as _usuario_mora,
    sesion_inyectada,
)
from tests.test_alertas_vencimiento import (
    HOY,
    VENCE,
    _crear_membresia_con_pago,
    _crear_persona,
    _crear_usuario,
    _sembrar_lote_de_tres,
)


@pytest.fixture()
def smtp():
    with patch(
        "app.infraestructura.notificaciones_servicio.smtplib.SMTP", MagicMock()
    ) as smtp_cls:
        yield smtp_cls


def _encolados(db_session) -> list[CorreoOutbox]:
    return db_session.query(CorreoOutbox).order_by(CorreoOutbox.id).all()


def test_vencimiento_encola_el_correo_con_asunto_cuerpo_y_destinatario_de_siempre(
    db_session, sesion_inyectada, monkeypatch, smtp
):
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    persona = _crear_persona(db_session, cedula_valida(960))
    _crear_usuario(db_session, persona, "alumno960@cataclub.test")
    _crear_membresia_con_pago(db_session, persona, VENCE)

    alertas_mod.alertar_vencimientos_hoy_mas_5()

    (fila,) = _encolados(db_session)
    notificacion = db_session.query(Notificacion).filter_by(persona_id=persona.id).one()
    assert fila.destinatario == "alumno960@cataclub.test"
    assert fila.asunto == "Cata Club | Tu membresía vence pronto"
    assert fila.cuerpo_texto == (
        "Hola Ana,\n\n"
        f"{notificacion.mensaje} Por favor, regulariza tu pago para evitar la "
        'suspensión de beneficios. Puedes hacerlo desde "Ir a mis pagos", en '
        "tu cuenta.\n\n"
        "Ante cualquier duda, escríbenos por WhatsApp al 0994219619."
    )
    assert fila.status == "PENDIENTE"
    assert fila.usuario_id is not None
    assert arnes.envios(smtp) == [], "la tarea ya no abre SMTP"


def test_la_mora_encola_el_asunto_de_cada_aviso(
    db_session, sesion_inyectada, monkeypatch, smtp
):
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY_MORA)
    dia_1 = _persona_mora(db_session, cedula_valida(961))
    _usuario_mora(db_session, dia_1, "dia1@cataclub.test")
    _membresia_en_mora(db_session, dia_1, HOY_MORA - timedelta(days=1))
    dia_8 = _persona_mora(db_session, cedula_valida(962))
    _usuario_mora(db_session, dia_8, "dia8@cataclub.test")
    _membresia_en_mora(db_session, dia_8, HOY_MORA - timedelta(days=8))

    alertas_mod.alertar_mora_diaria()

    asuntos = {fila.destinatario: fila.asunto for fila in _encolados(db_session)}
    assert asuntos == {
        "dia1@cataclub.test": "Cata Club | Aviso de mora",
        "dia8@cataclub.test": "Cata Club | Último aviso de mora",
    }
    cuerpos = {fila.destinatario: fila.cuerpo_texto for fila in _encolados(db_session)}
    assert "último aviso" in cuerpos["dia8@cataclub.test"]
    assert arnes.envios(smtp) == []


def test_ambos_guardianes_reciben_su_correo_y_una_segunda_corrida_no_duplica(
    db_session, sesion_inyectada, monkeypatch
):
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    principal = _crear_persona(db_session, cedula_valida(963))
    _crear_usuario(db_session, principal, "principal963@cataclub.test")
    alumno = _crear_persona(db_session, cedula_valida(964), representante_id=principal.id)
    segundo = _crear_persona(db_session, cedula_valida(965))
    _crear_usuario(db_session, segundo, "segundo965@cataclub.test")
    db_session.add(CoRepresentante(
        persona_id=alumno.id, co_representante_id=segundo.id,
        creado_por_persona_id=principal.id,
    ))
    _crear_membresia_con_pago(db_session, alumno, VENCE)

    alertas_mod.alertar_vencimientos_hoy_mas_5()
    alertas_mod.alertar_vencimientos_hoy_mas_5()

    assert sorted(fila.destinatario for fila in _encolados(db_session)) == [
        "principal963@cataclub.test", "segundo965@cataclub.test",
    ]
    assert db_session.query(Notificacion).filter(
        Notificacion.persona_id.in_([principal.id, segundo.id])
    ).count() == 2


def test_sin_cuenta_hay_notificacion_pero_ningun_correo_encolado(
    db_session, sesion_inyectada, monkeypatch
):
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    persona = _crear_persona(db_session, cedula_valida(966))
    _crear_membresia_con_pago(db_session, persona, VENCE)

    alertas_mod.alertar_vencimientos_hoy_mas_5()

    assert db_session.query(Notificacion).filter_by(persona_id=persona.id).count() == 1
    assert _encolados(db_session) == []


def test_sin_smtp_configurado_igual_se_encola_y_se_notifica(
    db_session, sesion_inyectada, monkeypatch
):
    """Sin SMTP la tarea ya no omite el correo: lo deja en la cola y sale
    cuando el relay exista. La alerta in-app tampoco depende de él."""
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY_MORA)
    alumno = _persona_mora(db_session, cedula_valida(967))
    _usuario_mora(db_session, alumno, "alumno967@cataclub.test")
    _membresia_en_mora(db_session, alumno, HOY_MORA - timedelta(days=1))

    resultado = alertas_mod.alertar_mora_diaria()

    assert resultado["total_avisos_familia"] == 1
    assert db_session.query(Notificacion).filter_by(persona_id=alumno.id).count() == 1
    assert [fila.destinatario for fila in _encolados(db_session)] == [
        "alumno967@cataclub.test"
    ]


def test_si_encolar_falla_no_queda_ni_notificacion_ni_correo(
    db_session, sesion_inyectada, monkeypatch
):
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    personas, _correos, _pagos = _sembrar_lote_de_tres(db_session)
    llamadas = []

    def _falla_al_segundo(self, **kwargs):
        llamadas.append(kwargs)
        if len(llamadas) == 2:
            raise ConnectionError("no se pudo encolar")

    monkeypatch.setattr(
        alertas_mod.ServicioNotificaciones, "enviar_correo", _falla_al_segundo
    )

    with pytest.raises(ConnectionError):
        alertas_mod.alertar_vencimientos_hoy_mas_5()
    db_session.rollback()

    assert db_session.query(Notificacion).filter(
        Notificacion.persona_id.in_([p.id for p in personas])
    ).count() == 0
    assert _encolados(db_session) == []


def test_un_rechazo_permanente_no_afecta_a_los_otros_ni_a_las_notificaciones(
    db_session, sesion_inyectada, monkeypatch
):
    """De punta a punta (issue #837 sobre el outbox): tres alertas, la del
    medio rebota con un 550. La tarea ya terminó sin saberlo; el despachador
    entrega las otras dos y cierra la rebotada `AGOTADO` en un solo intento,
    con la auditoría sin la dirección. Las tres `Notificacion` existen y
    ninguna lleva rastro del rebote."""
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    personas, correos, _pagos = _sembrar_lote_de_tres(db_session)

    resultado = alertas_mod.alertar_vencimientos_hoy_mas_5()
    registro = configurar_smtp_falso(
        monkeypatch, rechazos={correos[1]: (550, "buzón inexistente")},
    )
    arnes.despachar_correos_encolados(db_session)

    assert resultado["total_alertas"] == 3
    assert "rechazos_permanentes" not in resultado
    assert sorted(registro.enviados) == sorted([correos[0], correos[2]])
    db_session.expire_all()
    estados = {fila.destinatario: fila for fila in _encolados(db_session)}
    assert [estados[c].status for c in correos] == ["ENVIADO", "AGOTADO", "ENVIADO"]
    assert estados[correos[1]].attempts == 1
    assert "550" in estados[correos[1]].last_error_redacted
    assert correos[1] not in estados[correos[1]].last_error_redacted
    notificaciones = db_session.query(Notificacion).filter(
        Notificacion.persona_id.in_([p.id for p in personas])
    ).all()
    assert len(notificaciones) == 3
    assert all(n.last_error_redacted is None for n in notificaciones)
