"""Issue #1666: cuando cambia el representante PRINCIPAL (o la persona se
suprime), el vínculo del segundo guardián no puede quedar incoherente, y toda
baja deja evidencia en `CoRepresentanteEvento`."""
from datetime import datetime, timedelta, timezone

from app.dominio.modelos import CoRepresentante, CoRepresentanteEvento, CoRepresentanteInvitacion
from app.servicios_negocio.co_representante_vinculo import retirar_del_menor
from app.servicios_negocio.supresion_datos_servicio import DIAS_GRACIA, SupresionDatosServicio
from tests.test_independencia_representada import (
    _admin as _admin_indep, _comando as _comando_indep, _independizar, _representado_adulto,
    _representante as _representante_indep,
)
from tests.test_reasignacion_representacion import (
    _admin, _escenario, _reasignar, _representante,
)


def _vincular_segundo(db_session, menor, co, creador):
    db_session.add(CoRepresentante(
        persona_id=menor.id, co_representante_id=co.id, creado_por_persona_id=creador.id,
    ))
    db_session.commit()


def _eventos(db_session, persona_id):
    db_session.expire_all()
    return [
        (e.operacion, e.origen, e.actor_persona_id, e.co_representante_id)
        for e in db_session.query(CoRepresentanteEvento).filter_by(persona_id=persona_id).order_by(CoRepresentanteEvento.id)
    ]


def test_reasignar_al_propio_segundo_guardian_lo_retira_y_lo_audita(db_session):
    admin, viejo, _, nuevo, _, menor = _escenario(db_session)
    _vincular_segundo(db_session, menor, nuevo, viejo)

    _reasignar(db_session, admin, menor, nuevo=nuevo, actual=viejo.id)

    db_session.refresh(menor)
    assert menor.representante_id == nuevo.id
    assert db_session.query(CoRepresentante).count() == 0
    assert _eventos(db_session, menor.id) == [("BAJA", "ADMIN", admin.id, nuevo.id)]


def test_reasignar_a_un_tercero_retira_al_segundo_guardian_y_le_corta_el_acceso(db_session, client):
    """Decisión del padre: ANY reasignación del principal limpia el vínculo; el
    nuevo principal re-invita si hace falta."""
    admin, viejo, _, nuevo, _, menor = _escenario(db_session)
    segundo, _ = _representante(db_session, 410)
    _vincular_segundo(db_session, menor, segundo, viejo)
    from app.seguridad.gestor_auth import GestorAutenticacion
    from main import app

    _reasignar(db_session, admin, menor, nuevo=nuevo, actual=viejo.id)

    assert db_session.query(CoRepresentante).count() == 0
    assert _eventos(db_session, menor.id) == [("BAJA", "ADMIN", admin.id, segundo.id)]
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": "s@x.com", "persona_id": segundo.id, "roles": ["REPRESENTANTE"],
    }
    assert client.get(f"/api/v1/personas/{menor.id}").status_code == 403


def test_independizar_retira_al_segundo_guardian(db_session):
    admin = _admin_indep(db_session)
    rep, _ = _representante_indep(db_session)
    adulto = _representado_adulto(db_session, rep.id)
    segundo, _ = _representante(db_session, 411)
    _vincular_segundo(db_session, adulto, segundo, rep)

    _independizar(db_session, admin, adulto, comando=_comando_indep())

    assert db_session.query(CoRepresentante).count() == 0
    assert _eventos(db_session, adulto.id) == [("BAJA", "ADMIN", admin.id, segundo.id)]


def test_suprimir_a_un_segundo_guardian_retira_sus_vinculos(db_session, monkeypatch):
    monkeypatch.setattr(
        "app.servicios_negocio.supresion_datos_servicio.eliminar_recurso_privado",
        lambda *a, **k: None,
    )
    admin = _admin(db_session, 420)
    principal, _ = _representante(db_session, 421)
    segundo, _ = _representante(db_session, 422)
    from tests.test_reasignacion_representacion import _menor_vinculado
    menor = _menor_vinculado(db_session, 423, principal.id)
    _vincular_segundo(db_session, menor, segundo, principal)

    servicio = SupresionDatosServicio(db_session)
    solicitud = servicio.crear(segundo.id, "cierre de cuenta", admin_persona_id=admin.id)
    servicio.aprobar(solicitud.id, admin_persona_id=admin.id)
    solicitud.fecha_solicitud = datetime.now(timezone.utc) - timedelta(days=DIAS_GRACIA + 1)
    db_session.commit()
    servicio.ejecutar(solicitud.id, admin_persona_id=admin.id)

    assert db_session.query(CoRepresentante).count() == 0
    assert _eventos(db_session, menor.id) == [("BAJA", "ADMIN", admin.id, segundo.id)]


def _invitar_pendiente(db_session, menor, co, creador):
    invitacion = CoRepresentanteInvitacion(
        persona_id=menor.id, co_representante_id=co.id, correo=f"inv{co.id}@x.com",
        invitada_por_persona_id=creador.id,
    )
    db_session.add(invitacion)
    db_session.commit()
    return invitacion


def test_el_nuevo_principal_con_invitacion_pendiente_la_cancela_y_libera_el_cupo(db_session):
    """Si el invitado pasa a ser el principal antes de aceptar, su invitación
    pendiente cae: si no, bloquea toda invitación futura (índice único de
    pendientes) y su enlace choca con el trigger de principal distinto."""
    admin, viejo, _, nuevo, _, menor = _escenario(db_session)
    invitacion = _invitar_pendiente(db_session, menor, nuevo, viejo)

    assert retirar_del_menor(
        db_session, menor.id, actor_persona_id=admin.id, origen="SISTEMA", solo_si_es=nuevo.id,
    ) is True
    db_session.commit()

    db_session.refresh(invitacion)
    assert invitacion.cancelada_en is not None
    assert _eventos(db_session, menor.id) == [("INVITACION_CANCELADA", "SISTEMA", admin.id, nuevo.id)]


def test_la_invitacion_pendiente_de_un_tercero_sobrevive_al_nuevo_principal(db_session):
    admin, viejo, _, nuevo, _, menor = _escenario(db_session)
    tercero, _ = _representante(db_session, 430)
    invitacion = _invitar_pendiente(db_session, menor, tercero, viejo)

    assert retirar_del_menor(
        db_session, menor.id, actor_persona_id=admin.id, origen="SISTEMA", solo_si_es=nuevo.id,
    ) is False
    db_session.commit()

    db_session.refresh(invitacion)
    assert invitacion.cancelada_en is None
    assert _eventos(db_session, menor.id) == []
