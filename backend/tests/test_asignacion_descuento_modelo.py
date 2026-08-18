"""Invariantes de `AsignacionDescuento` garantizados EN LA BASE (issue #398,
mismo criterio que `test_invariantes_constraints.py`, issue #8): el chequeo
del servicio que asigne o retire un beneficio sigue siendo el camino
primario de error (UX); los constraints de este archivo son la red de
seguridad ante escrituras que los esquiven -- en particular dos peticiones
concurrentes de asignación aprobando dos beneficios activos para la misma
persona.

Esta suite es solo de MODELO: no existe todavía servicio ni router para
`AsignacionDescuento` (esta rebanada es deliberadamente solo datos, ver
issue #400). Las fábricas usadas son ORM directo (`crear_persona_orm`
compartida de `tests/fabricas_pagos.py`) y un `Descuento` construido inline,
porque no hay fábrica compartida de catálogo de descuentos todavía.
"""
from datetime import datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy.exc import IntegrityError

from app.dominio.cedula import cedula_valida
from app.dominio.modelos import AsignacionDescuento, Descuento
from tests.fabricas_pagos import crear_persona_orm as _crear_persona


def _crear_descuento(sesion, *, nombre: str = "Becado", porcentaje: Decimal = Decimal("50.00")) -> Descuento:
    descuento = Descuento(nombre=nombre, porcentaje=porcentaje, activo=True)
    sesion.add(descuento)
    sesion.flush()
    return descuento


def test_una_asignacion_se_crea_y_se_lee_de_vuelta(db_session):
    admin = _crear_persona(db_session, cedula_valida(501))
    beneficiario = _crear_persona(db_session, cedula_valida(502))
    descuento = _crear_descuento(db_session)

    asignacion = AsignacionDescuento(
        persona_id=beneficiario.id,
        descuento_id=descuento.id,
        asignado_por_persona_id=admin.id,
    )
    db_session.add(asignacion)
    db_session.flush()

    leida = db_session.get(AsignacionDescuento, asignacion.id)
    assert leida is not None
    assert leida.persona_id == beneficiario.id
    assert leida.descuento_id == descuento.id
    assert leida.asignado_por_persona_id == admin.id
    assert leida.asignado_en is not None
    assert leida.retirado_en is None
    assert leida.retirado_por_persona_id is None


# ---------------------------------------------------------------------------
# Invariante: una sola asignación VIGENTE (retirado_en IS NULL) por persona.
# ---------------------------------------------------------------------------
def test_dos_asignaciones_activas_para_la_misma_persona_violan_el_indice(db_session):
    admin = _crear_persona(db_session, cedula_valida(503))
    beneficiario = _crear_persona(db_session, cedula_valida(504))
    descuento = _crear_descuento(db_session)

    db_session.add(AsignacionDescuento(
        persona_id=beneficiario.id, descuento_id=descuento.id,
        asignado_por_persona_id=admin.id,
    ))
    db_session.flush()

    db_session.add(AsignacionDescuento(
        persona_id=beneficiario.id, descuento_id=descuento.id,
        asignado_por_persona_id=admin.id,
    ))

    with pytest.raises(
        IntegrityError, match="uq_asignacion_descuento_activa_por_persona"
    ):
        db_session.flush()


def test_una_asignacion_retirada_mas_una_nueva_activa_es_valido(db_session):
    """El punto entero del índice parcial: el historial de beneficios
    retirados no compite con la asignación vigente."""
    admin = _crear_persona(db_session, cedula_valida(505))
    beneficiario = _crear_persona(db_session, cedula_valida(506))
    descuento = _crear_descuento(db_session)

    retirada = AsignacionDescuento(
        persona_id=beneficiario.id, descuento_id=descuento.id,
        asignado_por_persona_id=admin.id,
    )
    db_session.add(retirada)
    db_session.flush()
    retirada.retirado_en = datetime.now(timezone.utc)
    retirada.retirado_por_persona_id = admin.id
    db_session.flush()

    db_session.add(AsignacionDescuento(
        persona_id=beneficiario.id, descuento_id=descuento.id,
        asignado_por_persona_id=admin.id,
    ))

    db_session.flush()  # no debe lanzar


def test_dos_asignaciones_activas_para_personas_distintas_es_valido(db_session):
    admin = _crear_persona(db_session, cedula_valida(507))
    persona_a = _crear_persona(db_session, cedula_valida(508))
    persona_b = _crear_persona(db_session, cedula_valida(509))
    descuento = _crear_descuento(db_session)

    db_session.add(AsignacionDescuento(
        persona_id=persona_a.id, descuento_id=descuento.id,
        asignado_por_persona_id=admin.id,
    ))
    db_session.add(AsignacionDescuento(
        persona_id=persona_b.id, descuento_id=descuento.id,
        asignado_por_persona_id=admin.id,
    ))

    db_session.flush()  # no debe lanzar


# ---------------------------------------------------------------------------
# Invariante: un retiro siempre lleva timestamp Y actor, nunca solo uno.
# ---------------------------------------------------------------------------
def test_retirado_en_sin_actor_viola_el_check(db_session):
    admin = _crear_persona(db_session, cedula_valida(510))
    beneficiario = _crear_persona(db_session, cedula_valida(511))
    descuento = _crear_descuento(db_session)

    db_session.add(AsignacionDescuento(
        persona_id=beneficiario.id, descuento_id=descuento.id,
        asignado_por_persona_id=admin.id,
        retirado_en=datetime.now(timezone.utc),
        retirado_por_persona_id=None,
    ))

    with pytest.raises(IntegrityError, match="ck_asignacion_retiro_completo"):
        db_session.flush()


def test_actor_de_retiro_sin_retirado_en_viola_el_check(db_session):
    admin = _crear_persona(db_session, cedula_valida(512))
    beneficiario = _crear_persona(db_session, cedula_valida(513))
    descuento = _crear_descuento(db_session)

    db_session.add(AsignacionDescuento(
        persona_id=beneficiario.id, descuento_id=descuento.id,
        asignado_por_persona_id=admin.id,
        retirado_en=None,
        retirado_por_persona_id=admin.id,
    ))

    with pytest.raises(IntegrityError, match="ck_asignacion_retiro_completo"):
        db_session.flush()
