"""Candados de `SUSPENDIDA` y del historial de estado de membresía (#400).

Dos hechos nuevos, y el segundo existe porque el primero sin él sería peor
que nada:

1. Una membresía puede quedar SUSPENDIDA. #400 lo pide para que el club
   pueda parar la generación de deuda de alguien que se va un tiempo, sin
   perder su plan, su beneficio ni su cobertura ya pagada.
2. Toda transición de estado deja huella: estado anterior, estado nuevo,
   fecha efectiva, actor y motivo. Sin eso, suspender sería un cambio de
   estado sin autor -- exactamente el defecto que #389 documenta para las
   correcciones de asistencia, donde la fila terminaba acreditada a quien no
   la escribió.

El candado más importante de este archivo es el tercero: agregar un estado
nuevo NO puede aflojar el invariante de "una sola membresía ACTIVA por
persona". Ese índice es parcial (`WHERE estado = 'ACTIVA'`), así que una
SUSPENDIDA tiene que poder convivir con una ACTIVA, y dos ACTIVAS tienen que
seguir siendo imposibles.
"""
from datetime import datetime, timezone

import pytest
from sqlalchemy.exc import IntegrityError

from app.dominio.cedula import cedula_valida
from app.dominio.enums import EstadoMembresia
from app.dominio.modelos import HistorialEstadoMembresia
from tests.fabricas_pagos import (
    crear_membresia_orm,
    crear_persona_orm,
    crear_tipo_membresia_orm,
)


def _ahora():
    return datetime.now(timezone.utc)


@pytest.fixture
def persona_y_tipo(db_session):
    persona = crear_persona_orm(db_session, cedula_valida(811))
    return persona, crear_tipo_membresia_orm(db_session)


# --- El estado nuevo ----------------------------------------------------------

def test_una_membresia_puede_quedar_suspendida(db_session, persona_y_tipo):
    persona, tipo = persona_y_tipo

    membresia = crear_membresia_orm(db_session, persona, tipo, EstadoMembresia.SUSPENDIDA)
    db_session.flush()

    assert membresia.estado is EstadoMembresia.SUSPENDIDA


def test_una_suspendida_convive_con_una_activa_de_la_misma_persona(db_session, persona_y_tipo):
    """El índice `uq_membresia_activa_por_persona` es PARCIAL: solo restringe
    ACTIVA. Agregar un estado nuevo no puede cambiar eso, porque el club
    necesita conservar el historial de la persona mientras tiene su plan
    vigente."""
    persona, tipo = persona_y_tipo
    crear_membresia_orm(db_session, persona, tipo, EstadoMembresia.ACTIVA)
    crear_membresia_orm(db_session, persona, tipo, EstadoMembresia.SUSPENDIDA)

    db_session.flush()  # no debe levantar


def test_dos_activas_siguen_prohibidas(db_session, persona_y_tipo):
    """Regresión: el invariante que ya existía sigue en pie después de sumar
    SUSPENDIDA al enum."""
    persona, tipo = persona_y_tipo
    crear_membresia_orm(db_session, persona, tipo, EstadoMembresia.ACTIVA)

    # La fábrica flushea sola, así que el índice salta acá adentro y no en un
    # flush posterior: envolver la SEGUNDA llamada es lo que fija el momento
    # real del rechazo.
    with pytest.raises(IntegrityError, match="uq_membresia_activa_por_persona"):
        crear_membresia_orm(db_session, persona, tipo, EstadoMembresia.ACTIVA)


# --- El historial -------------------------------------------------------------

def test_el_historial_registra_una_transicion_completa(db_session, persona_y_tipo):
    persona, tipo = persona_y_tipo
    membresia = crear_membresia_orm(db_session, persona, tipo, EstadoMembresia.SUSPENDIDA)
    efectiva = _ahora()

    transicion = HistorialEstadoMembresia(
        membresia_id=membresia.id,
        estado_anterior=EstadoMembresia.ACTIVA,
        estado_nuevo=EstadoMembresia.SUSPENDIDA,
        fecha_efectiva=efectiva,
        actor_persona_id=persona.id,
        motivo="Viaje de tres meses",
    )
    db_session.add(transicion)
    db_session.flush()

    assert transicion.id is not None
    assert transicion.estado_anterior is EstadoMembresia.ACTIVA
    assert transicion.estado_nuevo is EstadoMembresia.SUSPENDIDA
    assert transicion.motivo == "Viaje de tres meses"
    # `fecha_registro` (cuándo se escribió) es distinta de `fecha_efectiva`
    # (desde cuándo rige) y se llena sola: sin ella, una fila corregida más
    # tarde no se distingue de una escrita en su momento.
    assert transicion.fecha_registro is not None


def test_el_historial_admite_una_transicion_automatica_sin_actor(db_session, persona_y_tipo):
    """`actor_persona_id` y `motivo` son nullable a propósito: el vencimiento
    lo dispara el sistema, no una persona. Toda transición ADMINISTRATIVA sí
    lleva actor y motivo, y eso lo exige el servicio, no la tabla."""
    persona, tipo = persona_y_tipo
    membresia = crear_membresia_orm(db_session, persona, tipo, EstadoMembresia.VENCIDA)

    db_session.add(
        HistorialEstadoMembresia(
            membresia_id=membresia.id,
            estado_anterior=EstadoMembresia.ACTIVA,
            estado_nuevo=EstadoMembresia.VENCIDA,
            fecha_efectiva=_ahora(),
        )
    )
    db_session.flush()  # no debe levantar


def test_el_historial_rechaza_una_transicion_al_mismo_estado(db_session, persona_y_tipo):
    """Una transición de ACTIVA a ACTIVA no es una transición: es ruido que
    ensucia la auditoría y hace que un conteo de suspensiones mienta."""
    persona, tipo = persona_y_tipo
    membresia = crear_membresia_orm(db_session, persona, tipo, EstadoMembresia.ACTIVA)

    db_session.add(
        HistorialEstadoMembresia(
            membresia_id=membresia.id,
            estado_anterior=EstadoMembresia.ACTIVA,
            estado_nuevo=EstadoMembresia.ACTIVA,
            fecha_efectiva=_ahora(),
        )
    )

    with pytest.raises(IntegrityError, match="ck_historial_estado_cambia"):
        db_session.flush()


def test_el_historial_exige_una_membresia_existente(db_session):
    """La huella cuelga de la membresía: una transición huérfana no
    describe nada."""
    db_session.add(
        HistorialEstadoMembresia(
            membresia_id=999999,
            estado_anterior=EstadoMembresia.ACTIVA,
            estado_nuevo=EstadoMembresia.SUSPENDIDA,
            fecha_efectiva=_ahora(),
        )
    )

    with pytest.raises(IntegrityError):
        db_session.flush()
