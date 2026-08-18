"""Tests del inventario de anomalías de pago y cobertura (issue #400).

Hermano de `test_inventario_anomalias_membresias.py`: aquel mide sobre
`membresia`, este sobre `pago`. Mismas garantías y mismos candados -- solo
lectura real (`no_autoflush`), allow-list de claves para privacidad, y
funciones puras que reciben una `Session`.

El riesgo propio de este archivo son los FALSOS POSITIVOS. La cobertura se
deriva como `[fecha_inicio, _sumar_meses(fecha_inicio, meses))`, y el ancla
del pago siguiente es exactamente el `fecha_fin` del anterior: si el
detector tratara el intervalo como cerrado, TODO par de pagos consecutivos
normales saldría reportado como superposición. Por eso hay un test dedicado
al caso adyacente, y otro al recorte de fin de mes de `_sumar_meses`.
"""
from datetime import date
from decimal import Decimal

import pytest

from app.dominio.enums import EstadoMembresia, EstadoPago, TipoPago
from app.dominio.modelos import Pago
from scripts.inventario_anomalias_pagos import (
    construir_inventario,
    detectar_cobertura_incompatible,
    detectar_coberturas_superpuestas,
    detectar_meses_no_derivables,
    formatear_json,
)
from tests.fabricas_pagos import crear_membresia_orm, crear_persona_orm, crear_tipo_membresia_orm


def _pago(sesion, persona, membresia, inicio, fin, *,
          estado=EstadoPago.APROBADO, monto=Decimal("30.00"), tipo_pago=TipoPago.EFECTIVO,
          descuento_valor_aplicado=None):
    """`crear_pago_orm` fija `fecha_inicio`/`fecha_fin` a un período propio y
    no las parametriza; acá la cobertura ES lo que se prueba, así que se
    ajustan después del `add` y se flushea. Envolver la fábrica compartida
    evita duplicarla, que es lo que este repo no quiere (ver #326)."""
    pago = Pago(
        monto=monto, estado_pago=estado, tipo_pago=tipo_pago,
        fecha_inicio=inicio, fecha_fin=fin,
        descuento_valor_aplicado=descuento_valor_aplicado,
        persona_id=persona.id, membresia_id=membresia.id,
    )
    sesion.add(pago)
    sesion.flush()
    return pago


@pytest.fixture
def escenario(db_session):
    """Persona + tipo a $30 + membresía a $30, el caso sano de referencia."""
    persona = crear_persona_orm(db_session, "1200000001")
    tipo = crear_tipo_membresia_orm(db_session, precio=Decimal("30.00"))
    membresia = crear_membresia_orm(
        db_session, persona, tipo, EstadoMembresia.ACTIVA, monto_aplicado=Decimal("30.00"),
    )
    return persona, membresia


# --- A3a: coberturas aprobadas superpuestas ----------------------------------

def test_superpuestas_detecta_dos_aprobados_que_se_pisan(db_session, escenario):
    persona, membresia = escenario
    p1 = _pago(db_session, persona, membresia, date(2026, 1, 1), date(2026, 3, 1),
               monto=Decimal("60.00"))
    p2 = _pago(db_session, persona, membresia, date(2026, 2, 1), date(2026, 4, 1),
               monto=Decimal("60.00"))

    filas = detectar_coberturas_superpuestas(db_session)

    assert len(filas) == 1, "el par debe reportarse UNA vez, no dos"
    assert {filas[0]["pago_id_a"], filas[0]["pago_id_b"]} == {p1.id, p2.id}


def test_superpuestas_no_flaggea_periodos_adyacentes(db_session, escenario):
    """El caso normal: el ancla del pago siguiente ES el `fecha_fin` del
    anterior. El intervalo es semiabierto [inicio, fin), así que tocarse no
    es pisarse. Tratarlo como cerrado reportaría todo pago consecutivo."""
    persona, membresia = escenario
    _pago(db_session, persona, membresia, date(2026, 1, 1), date(2026, 2, 1))
    _pago(db_session, persona, membresia, date(2026, 2, 1), date(2026, 3, 1))

    assert detectar_coberturas_superpuestas(db_session) == []


def test_superpuestas_ignora_membresias_distintas(db_session, escenario):
    persona, membresia = escenario
    otra_persona = crear_persona_orm(db_session, "1200000002")
    tipo2 = crear_tipo_membresia_orm(db_session, precio=Decimal("30.00"))
    otra_membresia = crear_membresia_orm(
        db_session, otra_persona, tipo2, EstadoMembresia.ACTIVA, monto_aplicado=Decimal("30.00"),
    )
    _pago(db_session, persona, membresia, date(2026, 1, 1), date(2026, 3, 1),
          monto=Decimal("60.00"))
    _pago(db_session, otra_persona, otra_membresia, date(2026, 1, 1), date(2026, 3, 1),
          monto=Decimal("60.00"))

    assert detectar_coberturas_superpuestas(db_session) == []


def test_superpuestas_ignora_pagos_no_aprobados(db_session, escenario):
    persona, membresia = escenario
    _pago(db_session, persona, membresia, date(2026, 1, 1), date(2026, 3, 1),
          monto=Decimal("60.00"))
    _pago(db_session, persona, membresia, date(2026, 2, 1), date(2026, 4, 1),
          monto=Decimal("60.00"), estado=EstadoPago.RECHAZADO)

    assert detectar_coberturas_superpuestas(db_session) == []


# --- A3b: cobertura incompatible con los meses pagados -----------------------

def test_incompatible_detecta_un_mes_pagado_con_doce_de_cobertura(db_session, escenario):
    """El agujero que #400 cita: un pago de un mes no puede conceder doce."""
    persona, membresia = escenario
    pago = _pago(db_session, persona, membresia, date(2026, 1, 1), date(2027, 1, 1))

    filas = detectar_cobertura_incompatible(db_session)

    assert len(filas) == 1
    assert filas[0]["pago_id"] == pago.id
    assert filas[0]["meses_derivados"] == 1
    assert filas[0]["fecha_fin_esperada"] == date(2026, 2, 1)


def test_incompatible_no_flaggea_cobertura_bien_derivada(db_session, escenario):
    persona, membresia = escenario
    _pago(db_session, persona, membresia, date(2026, 1, 1), date(2026, 4, 1),
          monto=Decimal("90.00"))

    assert detectar_cobertura_incompatible(db_session) == []


def test_incompatible_no_flaggea_el_recorte_de_fin_de_mes(db_session, escenario):
    """`_sumar_meses` recorta al último día del mes destino: 31 ene + 1 mes es
    28 feb, no 3 de marzo. Invertir la cuenta con resta de fechas marcaría
    este pago sano; por eso el detector compara hacia adelante reusando la
    misma función que usa producción."""
    persona, membresia = escenario
    _pago(db_session, persona, membresia, date(2026, 1, 31), date(2026, 2, 28))

    assert detectar_cobertura_incompatible(db_session) == []


def test_incompatible_no_flaggea_una_regularizacion(db_session, escenario):
    """`regularizar_deuda` deja al admin fijar fechas retroactivas explícitas
    a propósito (#284). Reportarlas sería llamar defecto a lo intencional."""
    persona, membresia = escenario
    _pago(db_session, persona, membresia, date(2025, 1, 1), date(2026, 1, 1),
          tipo_pago=TipoPago.REGULARIZACION)

    assert detectar_cobertura_incompatible(db_session) == []


# --- A5: meses no derivables (falta de snapshot) -----------------------------

def test_no_derivables_detecta_precio_mensual_cero(db_session):
    persona = crear_persona_orm(db_session, "1200000003")
    tipo = crear_tipo_membresia_orm(db_session, precio=Decimal("30.00"))
    membresia = crear_membresia_orm(
        db_session, persona, tipo, EstadoMembresia.ACTIVA, monto_aplicado=Decimal("0.00"),
    )
    pago = _pago(db_session, persona, membresia, date(2026, 1, 1), date(2026, 2, 1))

    filas = detectar_meses_no_derivables(db_session)

    assert [(f["pago_id"], f["motivo"]) for f in filas] == [(pago.id, "precio_mensual_cero")]


def test_no_derivables_detecta_monto_no_multiplo(db_session, escenario):
    persona, membresia = escenario
    pago = _pago(db_session, persona, membresia, date(2026, 1, 1), date(2026, 2, 1),
                 monto=Decimal("45.00"))

    filas = detectar_meses_no_derivables(db_session)

    assert [(f["pago_id"], f["motivo"]) for f in filas] == [(pago.id, "monto_no_multiplo")]


def test_no_derivables_no_flaggea_un_multiplo_exacto(db_session, escenario):
    persona, membresia = escenario
    _pago(db_session, persona, membresia, date(2026, 1, 1), date(2026, 4, 1),
          monto=Decimal("90.00"))

    assert detectar_meses_no_derivables(db_session) == []


def test_no_derivables_no_flaggea_un_pago_con_descuento(db_session, escenario):
    """`pago.monto` guarda el monto FINAL, ya descontado, mientras los meses
    se derivan del BASE. Contar sobre `monto` marcaría como anomalía todo
    pago con descuento -- la membresía anual se vende justamente así. El base
    se reconstruye sumando el valor congelado del descuento."""
    persona, membresia = escenario
    _pago(db_session, persona, membresia, date(2026, 1, 1), date(2026, 2, 1),
          monto=Decimal("27.00"), descuento_valor_aplicado=Decimal("3.00"))

    assert detectar_meses_no_derivables(db_session) == []


def test_incompatible_deriva_los_meses_del_monto_base_no_del_final(db_session, escenario):
    """Doce meses con descuento anual: base 360 sobre tarifa 30 son 12 meses,
    y la cobertura de un ano esta bien. Si se contara sobre el monto final
    (324) no seria multiplo y el pago ni se evaluaria."""
    persona, membresia = escenario
    _pago(db_session, persona, membresia, date(2026, 1, 1), date(2027, 1, 1),
          monto=Decimal("324.00"), descuento_valor_aplicado=Decimal("36.00"))

    assert detectar_cobertura_incompatible(db_session) == []
    assert detectar_meses_no_derivables(db_session) == []


def test_incompatible_no_evalua_un_pago_sin_meses_derivables(db_session, escenario):
    """A3b y A5 no se solapan: si los meses no se pueden derivar, la cobertura
    no es 'incompatible', es indecidible -- y eso lo dice A5."""
    persona, membresia = escenario
    _pago(db_session, persona, membresia, date(2026, 1, 1), date(2027, 1, 1),
          monto=Decimal("45.00"))

    assert detectar_cobertura_incompatible(db_session) == []
    assert len(detectar_meses_no_derivables(db_session)) == 1


# --- Privacidad y no-escritura ------------------------------------------------

_CLAVES_PERMITIDAS = {
    "membresia_id", "pago_id", "pago_id_a", "pago_id_b", "estado_pago", "tipo_pago",
    "monto", "monto_base", "precio_mensual", "meses_derivados", "motivo",
    "fecha_inicio", "fecha_fin", "fecha_fin_esperada",
    "fecha_inicio_a", "fecha_fin_a", "fecha_inicio_b", "fecha_fin_b",
}


def _filas_del_inventario(inventario):
    for bloque in inventario.values():
        yield from bloque["filas"]


def test_reporte_no_expone_datos_privados_de_la_persona(db_session):
    """Allow-list de claves, no block-list: lo que hay que fijar es que
    ninguna fila lleve una clave fuera de IDs, plata, fechas y conteos."""
    persona = crear_persona_orm(
        db_session, "1919191919",
        nombres="Zutanoxxxxx", apellidos="Mengueitoso", telefono="0987650000",
    )
    tipo = crear_tipo_membresia_orm(db_session, precio=Decimal("30.00"))
    membresia = crear_membresia_orm(
        db_session, persona, tipo, EstadoMembresia.ACTIVA, monto_aplicado=Decimal("30.00"),
    )
    _pago(db_session, persona, membresia, date(2026, 1, 1), date(2026, 3, 1),
          monto=Decimal("60.00"))
    _pago(db_session, persona, membresia, date(2026, 2, 1), date(2027, 4, 1),
          monto=Decimal("45.00"))

    inventario = construir_inventario(db_session)
    filas = list(_filas_del_inventario(inventario))
    assert filas, "el escenario debe producir filas, si no el candado es vacuo"
    for fila in filas:
        assert set(fila) <= _CLAVES_PERMITIDAS, f"clave no permitida en {sorted(fila)}"

    salida = formatear_json(inventario)
    for privado in ("Zutanoxxxxx", "Mengueitoso", "1919191919", "0987650000"):
        assert privado not in salida


def test_construir_inventario_no_vacia_cambios_pendientes_del_llamador(db_session, escenario):
    """Mismo candado que el inventario de membresías: `Session` trae
    `autoflush=True`, así que sin `no_autoflush` la primera consulta del
    reporte bajaría a la base los cambios pendientes del llamador."""
    persona, membresia = escenario
    pago = _pago(db_session, persona, membresia, date(2026, 1, 1), date(2026, 2, 1))

    antes = db_session.query(Pago).count()

    pago.monto = Decimal("999.00")  # sucio a propósito, SIN flush
    assert pago in db_session.dirty

    construir_inventario(db_session)

    assert pago in db_session.dirty, "el reporte vació un cambio pendiente del llamador"
    with db_session.no_autoflush:
        assert db_session.query(Pago).count() == antes
