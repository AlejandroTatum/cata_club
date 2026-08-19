"""
Deuda en bloque (issue #326): `GET /membresias/deuda/bulk`.

El admin `/members` necesitaba una consulta por membresía vencida para mostrar
monto y meses adeudados -- exactamente el N+1 que #362 (ficha médica) ya había
resuelto para "quién tiene ficha médica". Este endpoint reutiliza LA MISMA
fórmula día-15/16 que `PagoServicio.calcular_meses_adeudados` (issue #284),
nunca la reimplementa: el núcleo puro vive en
`PagoServicio._calcular_meses_adeudados_desde_datos` y lo llaman tanto el
camino de una sola membresía como el de bloque, con datos pre-cargados en 3
consultas agrupadas (no 3*N).

Contrato de 4 campos (decisión del owner, ver el issue): `membresia_id`,
`meses_adeudados`, `ultima_cobertura_fin`, `monto_mensual`. Sin
`es_gratuidad_familiar` -- fuera de alcance a propósito, ver el DTO.
"""
from datetime import date
from decimal import Decimal

import app.servicios_negocio.membresia_pago_servicio as mps
from app.dominio.enums import EstadoMembresia, EstadoPago, TipoPago
from app.dominio.modelos import Pago
from app.servicios_negocio.membresia_pago_servicio import PagoServicio
from tests.fabricas_pagos import crear_persona_orm, crear_tipo_membresia_orm, crear_membresia_orm

RUTA_BULK = "/api/v1/membresias/deuda/bulk"


def _crear_persona_membresia(sesion, monto_aplicado: str = "30.00", *, cedula: str = "1710034065"):
    persona = crear_persona_orm(sesion, cedula)
    tipo = crear_tipo_membresia_orm(sesion, precio=Decimal("30.00"))
    membresia = crear_membresia_orm(
        sesion, persona, tipo, EstadoMembresia.ACTIVA,
        monto_aplicado=Decimal(monto_aplicado),
    )
    return persona, membresia


def _crear_pago_aprobado(sesion, persona, membresia, fecha_fin: date, monto: str = "30.00") -> Pago:
    pago = Pago(
        monto=Decimal(monto),
        estado_pago=EstadoPago.APROBADO,
        tipo_pago=TipoPago.EFECTIVO,
        fecha_inicio=date(fecha_fin.year, fecha_fin.month, 1),
        fecha_fin=fecha_fin,
        persona_id=persona.id,
        membresia_id=membresia.id,
    )
    sesion.add(pago)
    sesion.flush()
    return pago


def _url_bulk(*membresia_ids: int) -> str:
    query = "&".join(f"membresia_ids={mid}" for mid in membresia_ids)
    return f"{RUTA_BULK}?{query}"


# --- Paridad con el endpoint individual --------------------------------------

def test_bulk_paridad_con_endpoint_individual(client, db_session, monkeypatch):
    monkeypatch.setattr(mps, "hoy_club", lambda: date(2026, 8, 15))
    persona, membresia = _crear_persona_membresia(db_session)
    _crear_pago_aprobado(db_session, persona, membresia, date(2026, 3, 31))

    individual = client.get(f"/api/v1/membresias/{membresia.id}/deuda")
    assert individual.status_code == 200
    esperado = individual.json()

    bulk = client.get(_url_bulk(membresia.id))
    assert bulk.status_code == 200, bulk.text
    cuerpo = bulk.json()
    assert len(cuerpo) == 1
    fila = cuerpo[0]
    assert fila["membresiaId"] == membresia.id
    assert fila["mesesAdeudados"] == esperado["mesesAdeudados"]
    assert fila["ultimaCoberturaFin"] == esperado["ultimaCoberturaFin"]
    assert Decimal(str(fila["montoMensual"])) == Decimal(str(esperado["montoMensual"]))


# --- Frontera día 15/16 reutilizada correctamente ----------------------------

def test_bulk_borde_dia_15_exacto(client, db_session, monkeypatch):
    monkeypatch.setattr(mps, "hoy_club", lambda: date(2026, 8, 15))
    persona, membresia = _crear_persona_membresia(db_session)
    _crear_pago_aprobado(db_session, persona, membresia, date(2026, 4, 15))

    resp = client.get(_url_bulk(membresia.id))
    assert resp.status_code == 200
    assert resp.json()[0]["mesesAdeudados"] == 4


def test_bulk_borde_dia_16(client, db_session, monkeypatch):
    monkeypatch.setattr(mps, "hoy_club", lambda: date(2026, 8, 15))
    persona, membresia = _crear_persona_membresia(db_session)
    _crear_pago_aprobado(db_session, persona, membresia, date(2026, 4, 16))

    resp = client.get(_url_bulk(membresia.id))
    assert resp.status_code == 200
    assert resp.json()[0]["mesesAdeudados"] == 3


# --- Permisos -----------------------------------------------------------------

def test_bulk_admin_ve_la_deuda(client, db_session, monkeypatch):
    monkeypatch.setattr(mps, "hoy_club", lambda: date(2026, 8, 15))
    persona, membresia = _crear_persona_membresia(db_session)
    _crear_pago_aprobado(db_session, persona, membresia, date(2026, 3, 31))

    resp = client.get(_url_bulk(membresia.id))
    assert resp.status_code == 200


def test_bulk_sin_rol_admin_da_403(client_sin_permisos, db_session, monkeypatch):
    monkeypatch.setattr(mps, "hoy_club", lambda: date(2026, 8, 15))
    _, membresia = _crear_persona_membresia(db_session)

    resp = client_sin_permisos.get(_url_bulk(membresia.id))
    assert resp.status_code == 403


# --- Límites de tamaño ----------------------------------------------------------

def test_bulk_ids_vacio_da_422(client, db_session):
    resp = client.get(RUTA_BULK)
    assert resp.status_code == 422


def test_bulk_201_ids_da_422(client, db_session):
    ids = list(range(1, 202))
    resp = client.get(_url_bulk(*ids))
    assert resp.status_code == 422


def test_bulk_200_ids_ok(client, db_session, monkeypatch):
    monkeypatch.setattr(mps, "hoy_club", lambda: date(2026, 8, 15))
    persona, membresia = _crear_persona_membresia(db_session)
    _crear_pago_aprobado(db_session, persona, membresia, date(2026, 3, 31))

    # 199 ids inexistentes + la membresía real: exactamente 200, aceptado.
    ids_inexistentes = [membresia.id + 1000 + i for i in range(199)]
    resp = client.get(_url_bulk(membresia.id, *ids_inexistentes))
    assert resp.status_code == 200, resp.text
    cuerpo = resp.json()
    # Los ids inexistentes se omiten silenciosamente (mismo espíritu que
    # `listar_persona_ids_con_ficha`, issue #362), no rompen el batch entero.
    assert len(cuerpo) == 1
    assert cuerpo[0]["membresiaId"] == membresia.id


# --- Ids repetidos --------------------------------------------------------------

def test_bulk_ids_duplicados_no_duplica_respuesta(client, db_session, monkeypatch):
    monkeypatch.setattr(mps, "hoy_club", lambda: date(2026, 8, 15))
    persona, membresia = _crear_persona_membresia(db_session)
    _crear_pago_aprobado(db_session, persona, membresia, date(2026, 3, 31))

    resp = client.get(_url_bulk(membresia.id, membresia.id, membresia.id))
    assert resp.status_code == 200
    cuerpo = resp.json()
    assert len(cuerpo) == 1


# --- Ids desconocidos/inaccesibles se omiten, no 404an el batch -----------------

def test_bulk_id_inexistente_se_omite(client, db_session, monkeypatch):
    monkeypatch.setattr(mps, "hoy_club", lambda: date(2026, 8, 15))
    persona, membresia = _crear_persona_membresia(db_session)
    _crear_pago_aprobado(db_session, persona, membresia, date(2026, 3, 31))

    resp = client.get(_url_bulk(membresia.id, membresia.id + 999))
    assert resp.status_code == 200
    cuerpo = resp.json()
    assert len(cuerpo) == 1
    assert cuerpo[0]["membresiaId"] == membresia.id


# --- Sin N+1: O(1) consultas, no O(n) --------------------------------------------

def test_bulk_no_incurre_en_n_mas_uno(db_session, contar_selects, monkeypatch):
    """El número de SELECTs que dispara `obtener_deuda_bulk` no debe crecer
    con la cantidad de ids -- las 3 fuentes de datos (membresías, cobertura
    aprobada por `Pago`, cobertura bonificada, reactivaciones) se resuelven
    con UNA consulta agrupada cada una, sin importar cuántas membresías se
    pidan."""
    monkeypatch.setattr(mps, "hoy_club", lambda: date(2026, 8, 15))
    servicio = PagoServicio(db_session)

    ids_pocos = []
    for i in range(3):
        persona, membresia = _crear_persona_membresia(db_session, cedula=f"170100000{i}")
        _crear_pago_aprobado(db_session, persona, membresia, date(2026, 3, 31))
        ids_pocos.append(membresia.id)

    with contar_selects() as sentencias_pocos:
        servicio.obtener_deuda_bulk(ids_pocos)
    selects_pocos = [s for s in sentencias_pocos if s.strip().upper().startswith("SELECT")]

    ids_muchos = list(ids_pocos)
    for i in range(10):
        persona, membresia = _crear_persona_membresia(db_session, cedula=f"170200{i:04d}")
        _crear_pago_aprobado(db_session, persona, membresia, date(2026, 3, 31))
        ids_muchos.append(membresia.id)

    with contar_selects() as sentencias_muchos:
        servicio.obtener_deuda_bulk(ids_muchos)
    selects_muchos = [s for s in sentencias_muchos if s.strip().upper().startswith("SELECT")]

    assert len(selects_pocos) == len(selects_muchos), (
        "El número de SELECTs debería ser O(1) (no depender de la cantidad de "
        f"ids): {len(selects_pocos)} con 3 ids vs {len(selects_muchos)} con 13 ids"
    )
    assert len(selects_pocos) <= 4, (
        f"Se esperaban a lo sumo 4 SELECTs agrupados, se ejecutaron "
        f"{len(selects_pocos)}: {selects_pocos}"
    )
