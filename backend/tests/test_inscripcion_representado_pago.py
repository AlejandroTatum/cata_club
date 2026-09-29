from datetime import date

import pytest

from app.dominio.cedula import cedula_valida
from app.dominio.enums import EstadoPago, TipoPago
from app.dominio.excepciones import PermisosInsuficientes
from app.dominio.modelos import Membresia, Pago
from app.servicios_negocio.dtos.membresia_pago_schemas import InscripcionRepresentadoPagoDTO
from app.servicios_negocio.membresia_pago_servicio import PagoServicio
from tests.fabricas_pagos import crear_persona_orm, crear_tipo_membresia_orm


def _datos(persona, tipo):
    return InscripcionRepresentadoPagoDTO(
        persona_id=persona.id, tipo_membresia_id=tipo.id,
        tipo_pago=TipoPago.EFECTIVO, meses=1,
    )


def _familia(db_session):
    representante = crear_persona_orm(db_session, cedula_valida(935))
    menor = crear_persona_orm(
        db_session, cedula_valida(936), fecha_nacimiento=date(2015, 1, 1),
    )
    menor.representante_id = representante.id
    tipo = crear_tipo_membresia_orm(db_session)
    db_session.commit()
    return representante, menor, tipo


def test_inscripcion_representado_registra_pendiente_y_reintento_reusa(db_session):
    representante, menor, tipo = _familia(db_session)
    servicio = PagoServicio(db_session)
    primero = servicio.inscribir_representado_con_pago(_datos(menor, tipo), representante.id)
    segundo = servicio.inscribir_representado_con_pago(_datos(menor, tipo), representante.id)
    assert primero.id == segundo.id
    assert segundo.estado_pago == EstadoPago.PENDIENTE_VALIDACION
    assert db_session.query(Membresia).filter_by(persona_id=menor.id).count() == 1
    assert db_session.query(Pago).filter_by(persona_id=menor.id).count() == 1


def test_inscripcion_representado_no_autoriza_persona_ajena(db_session):
    representante, _, tipo = _familia(db_session)
    ajeno = crear_persona_orm(db_session, cedula_valida(937))
    db_session.commit()
    with pytest.raises(PermisosInsuficientes):
        PagoServicio(db_session).inscribir_representado_con_pago(
            _datos(ajeno, tipo), representante.id,
        )
    assert db_session.query(Membresia).filter_by(persona_id=ajeno.id).count() == 0


def test_inscripcion_representado_notifica_despues_del_commit(db_session, monkeypatch):
    representante, menor, tipo = _familia(db_session)
    avisos = []

    def notificar(self, pago):
        # A second session can see the committed payment before any notification.
        from sqlalchemy.orm import Session

        with Session(db_session.bind) as lector:
            assert lector.get(Pago, pago.id) is not None
        avisos.append(pago.id)

    monkeypatch.setattr(PagoServicio, "_notificar_pago_registrado", notificar)
    servicio = PagoServicio(db_session)
    pago = servicio.inscribir_representado_con_pago(_datos(menor, tipo), representante.id)
    servicio.inscribir_representado_con_pago(_datos(menor, tipo), representante.id)
    assert avisos == [pago.id]


def test_inscripcion_representado_revierte_membresia_si_pago_falla(db_session, monkeypatch):
    representante, menor, tipo = _familia(db_session)

    def fallar(*args, **kwargs):
        raise RuntimeError("payment failed")

    monkeypatch.setattr(PagoServicio, "_registrar_pago_sin_commit", fallar, raising=False)
    with pytest.raises(RuntimeError, match="payment failed"):
        PagoServicio(db_session).inscribir_representado_con_pago(
            _datos(menor, tipo), representante.id,
        )
    assert db_session.query(Membresia).filter_by(persona_id=menor.id).count() == 0
