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


# --- A2: gratuidad familiar y ceros inexplicados -----------------------------

def test_importes_cero_gratuidad_con_tarifa_real(db_session):
    """Caso NORMAL desde el slice 4c-b (#400): bandera en `True` y tarifa
    REAL (no cero) -- ya no zerea `monto_aplicado`. Cae en `a2_gratuidad`,
    nunca en `incoherente`, porque la persona SÍ tiene representante (la
    precondición de negocio de la regla)."""
    representante = crear_persona_orm(db_session, "1000000004")
    alumno = crear_persona_orm(db_session, "1000000014")
    alumno.representante_id = representante.id
    tipo = crear_tipo_membresia_orm(db_session, precio=Decimal("35.00"))
    membresia = crear_membresia_orm(
        db_session, alumno, tipo, EstadoMembresia.ACTIVA, monto_aplicado=Decimal("35.00"),
    )
    membresia.es_gratuidad_familiar = True
    db_session.flush()

    resultado = detectar_importes_cero(db_session)

    assert [f["membresia_id"] for f in resultado["a2_gratuidad"]] == [membresia.id]
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
    assert resultado["a2_gratuidad"] == []
    assert resultado["a2_gratuidad_incoherente"] == []


def test_importes_cero_gratuidad_incoherente_sin_representante(db_session):
    """A2 `incoherente` redefinida (slice 4c-b): ya NO es "bandera True,
    monto != 0" -- eso es lo esperado ahora. Es "bandera True" en una
    persona SIN `representante_id", la única precondición que
    `_aplicar_regla_familiar_si_corresponde` exige antes de ponerla; sin
    representante, ningún camino del código pudo haber llegado a
    `True`."""
    persona = crear_persona_orm(db_session, "1000000006")
    tipo = crear_tipo_membresia_orm(db_session, precio=Decimal("30.00"))
    membresia = crear_membresia_orm(
        db_session, persona, tipo, EstadoMembresia.ACTIVA, monto_aplicado=Decimal("15.00"),
    )
    membresia.es_gratuidad_familiar = True
    db_session.flush()

    resultado = detectar_importes_cero(db_session)

    assert [f["membresia_id"] for f in resultado["a2_gratuidad_incoherente"]] == [membresia.id]
    assert resultado["a2_gratuidad"] == []
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


# --- Particion de clases ------------------------------------------------------

def test_a1_y_a2_no_se_solapan(db_session):
    """A1 y A2 particionan: una gratuidad incoherente (bandera dice gratis,
    monto no es cero ni igual al precio) cae en A2 y NUNCA tambien en A1.
    Sin este test la exclusion mutua queda afirmada solo por inspeccion."""
    persona = crear_persona_orm(db_session, "1000000010")
    tipo = crear_tipo_membresia_orm(db_session, precio=Decimal("30.00"))
    membresia = crear_membresia_orm(
        db_session, persona, tipo, EstadoMembresia.ACTIVA, monto_aplicado=Decimal("15.00"),
    )
    membresia.es_gratuidad_familiar = True
    db_session.flush()

    en_a1 = {f["membresia_id"] for f in detectar_deriva_de_tarifa(db_session)}
    ceros = detectar_importes_cero(db_session)
    en_a2 = {f["membresia_id"] for filas in ceros.values() for f in filas}

    assert membresia.id in en_a2
    assert en_a1 & en_a2 == set()


# --- Privacidad y no-escritura ------------------------------------------------

# Allow-list, no block-list: la version anterior de este candado solo verificaba
# que cuatro strings sembrados no aparecieran, asi que una fuga con otra forma
# (un nombre recortado, un telefono formateado distinto) pasaba limpia. Lo que
# hay que fijar es que ninguna fila lleve una clave que no sea ID, plata,
# booleano o conteo.
_CLAVES_PERMITIDAS = {
    "membresia_id", "tipo_membresia_id", "estado", "monto_aplicado", "precio_vigente",
    "delta", "es_gratuidad_familiar", "persona_id", "cantidad", "membresia_ids", "estados",
}


def _filas_del_inventario(inventario):
    yield from inventario["a1_deriva_de_tarifa"]["filas"]
    for bloque in inventario["a2_importes_cero"].values():
        yield from bloque["filas"]
    yield from inventario["a4_no_activas_duplicadas"]["filas"]


def test_reporte_no_expone_datos_privados_de_la_persona(db_session):
    """Candado de privacidad (#400): ninguna fila puede llevar una clave fuera
    de la allow-list, y los datos sembrados no aparecen en el JSON."""
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

    inventario = construir_inventario(db_session)
    filas = list(_filas_del_inventario(inventario))
    assert filas, "el escenario debe producir filas, si no el candado es vacuo"
    for fila in filas:
        assert set(fila) <= _CLAVES_PERMITIDAS, f"clave no permitida en {sorted(fila)}"

    salida = formatear_json(inventario)
    for privado in ("Xilonenxxxxx", "Apuntobrilloso", "1717171717", "0987654321"):
        assert privado not in salida


def test_construir_inventario_no_vacia_cambios_pendientes_del_llamador(db_session):
    """Candado de la garantia de solo lectura. `Session` trae `autoflush=True`:
    sin `no_autoflush`, la primera consulta del reporte bajaria a la base los
    cambios que el llamador todavia tenia pendientes. Estas funciones reciben
    una sesion ajena a proposito, asi que el caso no es hipotetico. Contar
    filas antes y despues no lo detecta: un UPDATE no cambia el conteo."""
    persona = crear_persona_orm(db_session, "1000000009")
    tipo = crear_tipo_membresia_orm(db_session, precio=Decimal("30.00"))
    membresia = crear_membresia_orm(
        db_session, persona, tipo, EstadoMembresia.ACTIVA, monto_aplicado=Decimal("30.00"),
    )

    # El conteo se toma ANTES de ensuciar: `query(...).count()` tambien
    # autoflushea, asi que medirlo despues limpiaria el objeto sucio y el
    # candado quedaria vacuo -- exactamente la trampa que este test vigila.
    antes = db_session.query(Membresia).count()

    membresia.monto_aplicado = Decimal("99.00")  # sucio a proposito, SIN flush
    assert membresia in db_session.dirty

    construir_inventario(db_session)

    assert membresia in db_session.dirty, "el reporte vacio un cambio pendiente del llamador"
    with db_session.no_autoflush:
        assert db_session.query(Membresia).count() == antes
