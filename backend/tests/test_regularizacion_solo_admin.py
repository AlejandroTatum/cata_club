"""FAM-01: el tipo REGULARIZACION es contable y solo lo registra un administrador."""
from datetime import date

import pytest

from app.dominio.cedula import cedula_valida
from app.dominio.enums import EstadoMembresia, EstadoPago, TipoPago
from app.dominio.excepciones import PermisosInsuficientes
from app.servicios_negocio.dtos.membresia_pago_schemas import PagoCreateDTO
from app.servicios_negocio.membresia_pago_servicio import PagoServicio
from tests.fabricas_pagos import crear_membresia_orm, crear_persona_orm, crear_tipo_membresia_orm


def _escenario(db_session):
    representante = crear_persona_orm(db_session, cedula_valida(320))
    alumno = crear_persona_orm(
        db_session, cedula_valida(321), fecha_nacimiento=date(2012, 1, 1),
    )
    alumno.representante_id = representante.id
    tipo = crear_tipo_membresia_orm(db_session)
    membresia = crear_membresia_orm(db_session, alumno, tipo, EstadoMembresia.INACTIVA)
    db_session.flush()
    return representante, alumno, membresia


@pytest.mark.parametrize("rol", ["REPRESENTANTE", "ALUMNO", "ENTRENADOR"])
def test_regularizacion_rechazada_para_roles_no_admin(db_session, rol):
    representante, alumno, membresia = _escenario(db_session)
    datos = PagoCreateDTO(
        persona_id=alumno.id, membresia_id=membresia.id,
        tipo_pago=TipoPago.REGULARIZACION, meses=1,
    )

    with pytest.raises(PermisosInsuficientes, match="administrador"):
        PagoServicio(db_session).registrar_pago(datos, representante.id, [rol])


def test_regularizacion_permitida_para_admin(db_session):
    _, alumno, membresia = _escenario(db_session)
    admin = crear_persona_orm(db_session, cedula_valida(322))
    datos = PagoCreateDTO(
        persona_id=alumno.id, membresia_id=membresia.id,
        tipo_pago=TipoPago.REGULARIZACION, meses=1,
    )

    pago = PagoServicio(db_session).registrar_pago(datos, admin.id, ["ADMINISTRADOR"])

    assert pago.tipo_pago == TipoPago.REGULARIZACION
    assert pago.estado_pago == EstadoPago.PENDIENTE_VALIDACION


def test_transferencia_sigue_permitida_para_representante(db_session):
    representante, alumno, membresia = _escenario(db_session)
    datos = PagoCreateDTO(
        persona_id=alumno.id, membresia_id=membresia.id,
        tipo_pago=TipoPago.TRANSFERENCIA, meses=1,
    )

    pago = PagoServicio(db_session).registrar_pago(datos, representante.id, ["REPRESENTANTE"])

    assert pago.tipo_pago == TipoPago.TRANSFERENCIA
