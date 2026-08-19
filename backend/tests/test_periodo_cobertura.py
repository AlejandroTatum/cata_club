"""
Fix período de cobertura (PAG-5, docs/archive/fixes/06-periodo-de-cobertura.md).

El agujero: `POST /membresias/pagos` aceptaba `fecha_inicio`/`fecha_fin` del
cliente y solo validaba que una fuera anterior a la otra -- reproducido en
vivo contra QA con un pago de UN mes pidiendo DOCE de cobertura, 201. La
regla del múltiplo (`monto % precio_mensual`) validaba el MONTO y daba la
ilusión de que el período estaba atado a él; no lo estaba.

El fix original: el backend derivaba `fecha_inicio`/`fecha_fin` del monto
BASE y la cuota mensual -- el cliente ya no podía mandarlos (`PagoCreateDTO`
los quitó del contrato). La cobertura arrancaba donde terminaba la del
último pago APROBADO (o hoy si no había ninguno) y avanzaba
`monto // precio_mensual` meses completos.

Actualización (issue #400, slice 4b): `PagoCreateDTO.monto` se reemplazó por
`meses: int` -- el usuario elige una cantidad ENTERA de meses, no un monto
libre, y el backend calcula `monto_base = tarifa_vigente * meses`. La regla
del múltiplo DESAPARECE (no queda: ver `test_meses_no_positivo_o_fuera_de_
rango_es_rechazado` más abajo, la invariante nueva que ocupa su lugar) --
con `meses` como input no hay ningún resto que calcular, la cantidad de
meses YA es la cantidad de meses. La cobertura sigue avanzando tantos meses
completos como el cliente pidió; ahora es una lectura directa de
`datos.meses`, no una división de `datos.monto` contra la cuota.
"""
from datetime import date
from decimal import Decimal

from tests.conftest import FECHA_CONGELADA_HOY
import app.servicios_negocio.membresia_pago_servicio as mps


def _congelar_hoy_en_pagos(monkeypatch, fecha: date = FECHA_CONGELADA_HOY) -> None:
    """`hoy_club()` en `membresia_pago_servicio` no está congelado por el
    autouse de conftest (ese solo cubre `persona_servicio`) -- se fija acá,
    a la MISMA fecha que ya rige la mayoría de edad de las personas de
    prueba, para que ambos relojes no puedan discrepar dentro de un test."""
    monkeypatch.setattr(mps, "hoy_club", lambda: fecha)


def _crear_persona(client, cedula="1710034065"):
    return client.post(
        "/api/v1/personas/",
        json={
            "nombres": "Ana", "apellidos": "Torres", "cedula": cedula,
            "fecha_nacimiento": "2010-05-14", "telefono": "0991234567",
        },
    ).json()


def _crear_tipo_membresia(client, precio="35.00"):
    return client.post(
        "/api/v1/membresias/tipos",
        json={"categoria": "Adultos", "precio": precio, "modalidad": "MENSUAL"},
    ).json()


def _crear_membresia(client, persona_id, tipo_id, monto_aplicado="35.00"):
    return client.post(
        "/api/v1/membresias/",
        json={
            "monto_aplicado": monto_aplicado,
            "fecha_activacion": "2026-07-01T00:00:00",
            "persona_id": persona_id, "tipo_membresia_id": tipo_id,
        },
    ).json()


def _asignar_beneficio(client, persona_id, descuento_id):
    """POST /personas/{id}/beneficio (issue #398): reemplaza al viejo
    `descuento_ids` del POST de pago -- `test_cobertura_se_calcula_sobre_
    el_monto_base_no_el_descontado` de más abajo lo necesita para seguir
    ejercitando el mismo escenario (membresía anual con descuento) bajo el
    contrato nuevo."""
    resp = client.post(
        f"/api/v1/personas/{persona_id}/beneficio",
        json={"descuento_id": descuento_id},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _registrar_pago(client, persona_id, membresia_id, meses, *, descuento_ids=None,
                     fecha_inicio=None, fecha_fin=None):
    payload = {
        "meses": meses, "tipo_pago": "TRANSFERENCIA",
        "persona_id": persona_id, "membresia_id": membresia_id,
    }
    if descuento_ids is not None:
        # Issue #398/#400: `PagoCreateDTO` ya no tiene este campo -- lo que
        # sigue mandando acá es exactamente el payload de un cliente
        # desactualizado, y el backend debe ignorarlo (Pydantic descarta
        # campos de más). Ningún test de este archivo depende ya de que
        # tenga efecto.
        payload["descuento_ids"] = descuento_ids
    # `fecha_inicio`/`fecha_fin`, cuando se mandan, son EXACTAMENTE el
    # payload que un cliente desactualizado (o un curl como el de la
    # reproducción) seguiría enviando -- el backend tiene que ignorarlos.
    if fecha_inicio is not None:
        payload["fecha_inicio"] = fecha_inicio
    if fecha_fin is not None:
        payload["fecha_fin"] = fecha_fin
    return client.post("/api/v1/membresias/pagos", json=payload)


def _aprobar(client, pago_id):
    resp = client.patch(
        f"/api/v1/membresias/pagos/{pago_id}/validar",
        json={"estado_pago": "APROBADO"},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


# --- El candado: el agujero reproducido en vivo, cerrado ---------------------

def test_un_pago_de_un_mes_no_puede_pedir_doce_de_cobertura(client, monkeypatch):
    """Reproduce la vulnerabilidad reportada por el dueño: POST con
    `fecha_inicio`/`fecha_fin` separadas por un año, pidiendo UN solo mes
    (`meses=1`). Antes del fix, el backend aceptaba esas fechas tal cual
    (201, doce meses de cobertura por la cuota de uno). Con el fix, el
    período lo calcula el backend y esas fechas del payload no tienen ningún
    efecto."""
    _congelar_hoy_en_pagos(monkeypatch)
    persona = _crear_persona(client)
    tipo = _crear_tipo_membresia(client, precio="25.00")
    membresia = _crear_membresia(client, persona["id"], tipo["id"], monto_aplicado="25.00")

    resp = _registrar_pago(
        client, persona["id"], membresia["id"], 1,
        fecha_inicio="2026-08-11", fecha_fin="2027-08-11",  # doce meses, en el payload
    )
    assert resp.status_code == 201
    pago = resp.json()

    assert pago["fechaInicio"] == FECHA_CONGELADA_HOY.isoformat()
    # Un mes exacto desde la ancla -- NO el año que mandó el payload.
    assert pago["fechaFin"] == date(
        FECHA_CONGELADA_HOY.year, FECHA_CONGELADA_HOY.month + 1, FECHA_CONGELADA_HOY.day
    ).isoformat()


# --- Comportamiento esperado del cálculo nuevo --------------------------------

def test_primer_pago_arranca_hoy(client, monkeypatch):
    _congelar_hoy_en_pagos(monkeypatch)
    persona = _crear_persona(client)
    tipo = _crear_tipo_membresia(client, precio="35.00")
    membresia = _crear_membresia(client, persona["id"], tipo["id"], monto_aplicado="35.00")

    pago = _registrar_pago(client, persona["id"], membresia["id"], 1).json()

    assert pago["fechaInicio"] == FECHA_CONGELADA_HOY.isoformat()
    assert pago["fechaFin"] == date(2029, 2, 1).isoformat()


def test_renovacion_arranca_donde_termino_la_aprobada(client, monkeypatch):
    _congelar_hoy_en_pagos(monkeypatch)
    persona = _crear_persona(client)
    tipo = _crear_tipo_membresia(client, precio="35.00")
    membresia = _crear_membresia(client, persona["id"], tipo["id"], monto_aplicado="35.00")

    primero = _registrar_pago(client, persona["id"], membresia["id"], 1).json()
    aprobado = _aprobar(client, primero["id"])
    assert aprobado["fechaFin"] == date(2029, 2, 1).isoformat()

    segundo = _registrar_pago(client, persona["id"], membresia["id"], 1).json()
    # Retoma exactamente donde terminó el aprobado -- sin gap ni superposición.
    assert segundo["fechaInicio"] == date(2029, 2, 1).isoformat()
    assert segundo["fechaFin"] == date(2029, 3, 1).isoformat()


def test_adelantar_dos_meses(client, monkeypatch):
    _congelar_hoy_en_pagos(monkeypatch)
    persona = _crear_persona(client)
    tipo = _crear_tipo_membresia(client, precio="25.00")
    membresia = _crear_membresia(client, persona["id"], tipo["id"], monto_aplicado="25.00")

    pago = _registrar_pago(client, persona["id"], membresia["id"], 2).json()
    assert pago["fechaInicio"] == FECHA_CONGELADA_HOY.isoformat()
    assert pago["fechaFin"] == date(2029, 3, 1).isoformat()


def test_adelantar_tres_meses(client, monkeypatch):
    _congelar_hoy_en_pagos(monkeypatch)
    persona = _crear_persona(client)
    tipo = _crear_tipo_membresia(client, precio="25.00")
    membresia = _crear_membresia(client, persona["id"], tipo["id"], monto_aplicado="25.00")

    pago = _registrar_pago(client, persona["id"], membresia["id"], 3).json()
    assert pago["fechaInicio"] == FECHA_CONGELADA_HOY.isoformat()
    assert pago["fechaFin"] == date(2029, 4, 1).isoformat()


def test_meses_no_positivo_o_fuera_de_rango_es_rechazado(client, monkeypatch):
    """La regla del múltiplo (`monto % precio_mensual`) YA NO EXISTE (issue
    #400/4b): con `meses` como input no hay ningún resto que calcular, la
    cantidad de meses ES la cantidad de meses. La invariante que ocupa su
    lugar es la que ya protege `PagoCreateDTO.meses` (`gt=0, le=12`): esto
    es validación de esquema (422), no una regla de negocio del servicio
    (400) como la que reemplaza -- Pydantic la atrapa antes de que
    `registrar_pago` corra."""
    _congelar_hoy_en_pagos(monkeypatch)
    persona = _crear_persona(client)
    tipo = _crear_tipo_membresia(client, precio="25.00")
    membresia = _crear_membresia(client, persona["id"], tipo["id"], monto_aplicado="25.00")

    assert _registrar_pago(client, persona["id"], membresia["id"], 0).status_code == 422
    assert _registrar_pago(client, persona["id"], membresia["id"], -1).status_code == 422
    assert _registrar_pago(client, persona["id"], membresia["id"], 13).status_code == 422


def test_cobertura_se_calcula_sobre_el_monto_base_no_el_descontado(client, monkeypatch):
    """La membresía anual del club: descuento del catálogo sobre doce meses
    adelantados. Bajo el contrato viejo (`monto`, no `meses`) esto se
    probaba pidiendo $300 base (múltiplo exacto de la cuota $25) con 10% de
    descuento -> pago final $270, y el riesgo era que la cobertura se
    calculara dividiendo el monto YA descontado (`floor(270/25) = 10`
    meses, en vez de doce).

    Desde issue #400/4b, `meses` es el input directo del cliente -- no hay
    ninguna división que "contamine" con el descuento, `meses=12` significa
    doce sea cual sea el beneficio aplicado. El riesgo se desplazó, no
    desapareció: `monto_base` (`precio_mensual * meses`) tiene que
    congelarse ANTES de `_congelar_beneficio_activo`, y la cobertura
    (`_sumar_meses`) tiene que avanzar los DOCE meses pedidos, nunca algo
    derivado del monto final. Si `monto_base` se calculara sobre el monto
    YA descontado, el padre pagaría doce meses y el snapshot mentiría con
    diez."""
    _congelar_hoy_en_pagos(monkeypatch)
    persona = _crear_persona(client)
    tipo = _crear_tipo_membresia(client, precio="25.00")
    membresia = _crear_membresia(client, persona["id"], tipo["id"], monto_aplicado="25.00")

    descuento = client.post(
        "/api/v1/descuentos/",
        json={"nombre": "Anual", "porcentaje": "10", "activo": True},
    ).json()
    # Issue #398/#400: el descuento ya no se envía en el POST del pago -- se
    # ASIGNA como beneficio vigente de la persona, y `registrar_pago` lo
    # resuelve solo.
    _asignar_beneficio(client, persona["id"], descuento["id"])

    resp = _registrar_pago(client, persona["id"], membresia["id"], 12)
    assert resp.status_code == 201, resp.text
    pago = resp.json()

    assert Decimal(str(pago["monto"])) == Decimal("270.00")
    assert pago["fechaInicio"] == FECHA_CONGELADA_HOY.isoformat()
    assert pago["fechaFin"] == date(2030, 1, 1).isoformat()  # doce meses, no diez
