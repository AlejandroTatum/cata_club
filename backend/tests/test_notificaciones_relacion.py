"""Notificación post-commit de la reasignación de representación (#1133, PR4c1).

La reasignación REUSA el canal existente (`Notificacion` in-app) y la rutina
best-effort de la independencia: el aviso al ex representante corre DESPUÉS
del commit, en su propia transacción, y su fallo queda observable en el log
sin revertir ni invalidar el vínculo ya comiteado. No se agrega ningún outbox,
solicitud ni estado de aprobación de relación.
"""
from datetime import date

from sqlalchemy import text

from app.dominio.cedula import cedula_valida
from app.dominio.enums import TipoNotificacion
from app.dominio.modelos import (
    Notificacion, Persona, Usuario, VinculacionRepresentante,
)
from app.servicios_negocio.dtos.persona_schemas import ReasignarRepresentacionDTO
from app.servicios_negocio.relacion_representacion_servicio import (
    RelacionRepresentacionServicio,
)


CLAVE = "notificacion-reasignacion-0001"


def _admin(db_session) -> Persona:
    admin = Persona(
        nombres="Ada", apellidos="Administradora", cedula=cedula_valida(301),
        fecha_nacimiento=date(1980, 1, 1), telefono="0990000001",
    )
    db_session.add(admin)
    db_session.commit()
    db_session.refresh(admin)
    return admin


def _representante(db_session, seed: int) -> tuple[Persona, Usuario]:
    persona = Persona(
        nombres="Rita", apellidos="Representante", cedula=cedula_valida(seed),
        fecha_nacimiento=date(1988, 3, 20), telefono="0998765432",
    )
    db_session.add(persona)
    db_session.flush()
    usuario = Usuario(
        correo=f"notif{seed}@test.com", contrasenia="hash", persona_id=persona.id,
        correo_verificado=True,
    )
    db_session.add(usuario)
    db_session.commit()
    db_session.refresh(persona)
    db_session.refresh(usuario)
    return persona, usuario


def _menor(db_session, seed: int, representante_id: int) -> Persona:
    menor = Persona(
        nombres="Mateo", apellidos="Menor", cedula=cedula_valida(seed),
        fecha_nacimiento=date(2020, 5, 14), telefono="0991234567",
        representante_id=representante_id,
    )
    db_session.add(menor)
    db_session.commit()
    db_session.refresh(menor)
    return menor


def _escenario(db_session):
    admin = _admin(db_session)
    nuevo, _ = _representante(db_session, 501)
    viejo, usuario_viejo = _representante(db_session, 502)
    menor = _menor(db_session, 503, viejo.id)
    return admin, viejo, usuario_viejo, nuevo, menor


def _reasignar(db_session, admin, menor, *, nuevo, actual, clave=CLAVE):
    return RelacionRepresentacionServicio(db_session).reasignar_presencial(
        admin_actor_id=admin.id, persona_id=menor.id,
        comando=ReasignarRepresentacionDTO(
            nuevo_representante_id=nuevo.id, representante_actual_id=actual,
            evidencia_identidad="cédula verificada en mostrador",
        ),
        idempotency_key=clave,
    )


def test_notifica_al_ex_representante_despues_del_commit(db_session):
    admin, viejo, _, nuevo, menor = _escenario(db_session)

    resultado = _reasignar(db_session, admin, menor, nuevo=nuevo, actual=viejo.id)

    evento = db_session.query(VinculacionRepresentante).one()
    aviso = db_session.query(Notificacion).filter_by(persona_id=viejo.id).one()
    assert aviso.tipo == TipoNotificacion.VINCULACION_REPRESENTANTE
    assert aviso.entidad_relacionada_id == evento.id
    assert aviso.mensaje
    assert resultado["representante_nuevo_id"] == nuevo.id


def test_fallo_de_notificacion_post_commit_no_revierte_el_exito(db_session):
    """El canal se cae DESPUÉS del commit: la reasignación ya está comiteada y
    el comando la devuelve igual -- el fallo no propaga."""
    import app.servicios_negocio.relacion_representacion_servicio as rrs

    admin, viejo, _, nuevo, menor = _escenario(db_session)

    class _CanalCaido:
        def __init__(self, *args, **kwargs):
            raise RuntimeError("canal de notificación caído")

    original = rrs.Notificacion
    rrs.Notificacion = _CanalCaido
    try:
        resultado = _reasignar(db_session, admin, menor, nuevo=nuevo, actual=viejo.id)
    finally:
        rrs.Notificacion = original

    assert resultado["representante_nuevo_id"] == nuevo.id
    db_session.refresh(menor)
    assert menor.representante_id == nuevo.id
    assert db_session.query(VinculacionRepresentante).count() == 1
    assert db_session.query(Notificacion).count() == 0


def test_el_fallo_de_notificacion_queda_observable_en_el_log(db_session, caplog):
    import logging

    import app.servicios_negocio.relacion_representacion_servicio as rrs

    admin, viejo, _, nuevo, menor = _escenario(db_session)

    class _CanalCaido:
        def __init__(self, *args, **kwargs):
            raise RuntimeError("canal de notificación caído")

    original = rrs.Notificacion
    rrs.Notificacion = _CanalCaido
    try:
        with caplog.at_level(
            logging.ERROR, logger="app.servicios_negocio.relacion_representacion_servicio"
        ):
            _reasignar(db_session, admin, menor, nuevo=nuevo, actual=viejo.id)
    finally:
        rrs.Notificacion = original

    assert "No se pudo notificar la operación de representación" in caplog.text
    assert str(viejo.id) in caplog.text
    assert "canal de notificación caído" in caplog.text


def test_no_se_crea_ningun_outbox_de_relacion(db_session):
    tablas = {
        fila[0] for fila in db_session.execute(text(
            "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
        )).all()
    }
    assert not [t for t in tablas if "outbox" in t and "relacion" in t]
    assert {t for t in tablas if "vinculacion" in t} == {"vinculacion_representante"}
