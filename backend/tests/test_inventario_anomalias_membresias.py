"""Tests del inventario de anomalías de membresías (issue #400).

Contexto: antes de tocar CUALQUIER escritura del ciclo de pagos, #400 exige
un relevamiento de solo lectura que documente filas y conteos exactos de
tres clases de anomalía en `membresia` -- sin exponer datos privados de la
persona. El módulo bajo prueba sigue el mismo patrón que
`scripts/reset_dev_db.py`: funciones puras que reciben una `Session` y
devuelven estructuras planas, así los tests las llaman directo sin
subproceso ni I/O (ver `test_reset_dev_db.py`). Detalle de A1/A2/A4 en el
docstring de `scripts/inventario_anomalias_membresias.py`.
"""
from decimal import Decimal

from app.dominio.enums import EstadoMembresia
from app.dominio.modelos import Membresia
from scripts.inventario_anomalias_membresias import (
    construir_inventario,
    detectar_deriva_de_tarifa,
    detectar_importes_cero,
    detectar_membresias_no_activas_duplicadas,
    formatear_json,
)
from tests.fabricas_pagos import crear_membresia_orm, crear_persona_orm, crear_tipo_membresia_orm


# --- A1: deriva de tarifa ----------------------------------------------------

def test_deriva_detecta_membresia_con_monto_distinto_al_precio_vigente(db_session):
    persona = crear_persona_orm(db_session, "1000000001")
    tipo = crear_tipo_membresia_orm(db_session, precio=Decimal("30.00"))
    membresia = crear_membresia_orm(
        db_session, persona, tipo, EstadoMembresia.ACTIVA, monto_aplicado=Decimal("25.00"),
    )

    filas = detectar_deriva_de_tarifa(db_session)

    assert len(filas) == 1
    assert filas[0]["membresia_id"] == membresia.id
    assert filas[0]["precio_vigente"] == Decimal("30.00")
    assert filas[0]["delta"] == Decimal("-5.00")


def test_deriva_no_flaggea_monto_igual_al_precio_vigente(db_session):
    persona = crear_persona_orm(db_session, "1000000002")
    tipo = crear_tipo_membresia_orm(db_session, precio=Decimal("30.00"))
    crear_membresia_orm(
        db_session, persona, tipo, EstadoMembresia.ACTIVA, monto_aplicado=Decimal("30.00"),
    )

    assert detectar_deriva_de_tarifa(db_session) == []


def test_deriva_no_flaggea_gratuidad_en_cero(db_session):
    """Un cero de gratuidad familiar es A2, nunca deriva de tarifa."""
    persona = crear_persona_orm(db_session, "1000000003")
    tipo = crear_tipo_membresia_orm(db_session, precio=Decimal("30.00"))
    membresia = crear_membresia_orm(
        db_session, persona, tipo, EstadoMembresia.ACTIVA, monto_aplicado=Decimal("0.00"),
    )
    membresia.es_gratuidad_familiar = True
    db_session.flush()

    assert detectar_deriva_de_tarifa(db_session) == []


# --- A2: importes en cero y gratuidad familiar -------------------------------

def test_importes_cero_gratuidad_coherente(db_session):
    persona = crear_persona_orm(db_session, "1000000004")
    tipo = crear_tipo_membresia_orm(db_session)
    membresia = crear_membresia_orm(
        db_session, persona, tipo, EstadoMembresia.ACTIVA, monto_aplicado=Decimal("0.00"),
    )
    membresia.es_gratuidad_familiar = True
    db_session.flush()

    resultado = detectar_importes_cero(db_session)

    assert [f["membresia_id"] for f in resultado["a2_gratuidad_coherente"]] == [membresia.id]
    assert resultado["a2_cero_inexplicado"] == []
    assert resultado["a2_gratuidad_incoherente"] == []


def test_importes_cero_cero_inexplicado(db_session):
    persona = crear_persona_orm(db_session, "1000000005")
    tipo = crear_tipo_membresia_orm(db_session)
    membresia = crear_membresia_orm(
        db_session, persona, tipo, EstadoMembresia.ACTIVA, monto_aplicado=Decimal("0.00"),
    )

    resultado = detectar_importes_cero(db_session)

    assert [f["membresia_id"] for f in resultado["a2_cero_inexplicado"]] == [membresia.id]
    assert resultado["a2_gratuidad_coherente"] == []
    assert resultado["a2_gratuidad_incoherente"] == []


def test_importes_cero_gratuidad_incoherente(db_session):
    persona = crear_persona_orm(db_session, "1000000006")
    tipo = crear_tipo_membresia_orm(db_session, precio=Decimal("30.00"))
    membresia = crear_membresia_orm(
        db_session, persona, tipo, EstadoMembresia.ACTIVA, monto_aplicado=Decimal("15.00"),
    )
    membresia.es_gratuidad_familiar = True
    db_session.flush()

    resultado = detectar_importes_cero(db_session)

    assert [f["membresia_id"] for f in resultado["a2_gratuidad_incoherente"]] == [membresia.id]
    assert resultado["a2_gratuidad_coherente"] == []
    assert resultado["a2_cero_inexplicado"] == []


# --- A4: múltiples membresías no activas por persona -------------------------

def test_no_activas_flaggea_persona_con_dos_membresias_no_activas(db_session):
    persona = crear_persona_orm(db_session, "1000000007")
    tipo = crear_tipo_membresia_orm(db_session)
    m1 = crear_membresia_orm(db_session, persona, tipo, EstadoMembresia.VENCIDA)
    m2 = crear_membresia_orm(db_session, persona, tipo, EstadoMembresia.INACTIVA)

    filas = detectar_membresias_no_activas_duplicadas(db_session)

    assert len(filas) == 1
    assert filas[0]["persona_id"] == persona.id
    assert filas[0]["cantidad"] == 2
    assert filas[0]["membresia_ids"] == sorted([m1.id, m2.id])


def test_no_activas_no_flaggea_una_activa_y_una_vencida(db_session):
    """Una ACTIVA + una VENCIDA es UNA sola membresía no-activa: no duplica."""
    persona = crear_persona_orm(db_session, "1000000008")
    tipo = crear_tipo_membresia_orm(db_session)
    crear_membresia_orm(db_session, persona, tipo, EstadoMembresia.ACTIVA)
    crear_membresia_orm(db_session, persona, tipo, EstadoMembresia.VENCIDA)

    assert detectar_membresias_no_activas_duplicadas(db_session) == []


# --- Privacidad y no-escritura ------------------------------------------------

def test_reporte_no_expone_datos_privados_de_la_persona(db_session):
    """Candado de privacidad (#400): el JSON serializado nunca debe contener
    nombre, apellido, cédula ni teléfono -- solo IDs, montos, booleanos y
    conteos."""
    persona = crear_persona_orm(
        db_session, "1717171717",
        nombres="Xilonenxxxxx", apellidos="Apuntobrilloso", telefono="0987654321",
    )
    tipo = crear_tipo_membresia_orm(db_session, precio=Decimal("30.00"))
    crear_membresia_orm(
        db_session, persona, tipo, EstadoMembresia.ACTIVA, monto_aplicado=Decimal("25.00"),
    )
    crear_membresia_orm(db_session, persona, tipo, EstadoMembresia.VENCIDA)
    crear_membresia_orm(db_session, persona, tipo, EstadoMembresia.INACTIVA)

    salida = formatear_json(construir_inventario(db_session))

    assert "Xilonenxxxxx" not in salida
    assert "Apuntobrilloso" not in salida
    assert "1717171717" not in salida
    assert "0987654321" not in salida


def test_construir_inventario_es_de_solo_lectura(db_session):
    persona = crear_persona_orm(db_session, "1000000009")
    tipo = crear_tipo_membresia_orm(db_session)
    crear_membresia_orm(
        db_session, persona, tipo, EstadoMembresia.ACTIVA, monto_aplicado=Decimal("0.00"),
    )

    antes = db_session.query(Membresia).count()
    construir_inventario(db_session)
    despues = db_session.query(Membresia).count()

    assert antes == despues
