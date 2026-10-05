"""T5/S5 (pre-deploy, decisión L5): si la cobertura vigente de un socio se
pagó con descuento (parcial, fijo o el beneficio 100%), el socio solo puede
registrar otro pago o activar el beneficio cuando esa cobertura termine. Una
cobertura a precio completo sí se puede pagar por adelantado. El administrador
no queda bloqueado."""
from datetime import timedelta
from decimal import Decimal

from app.dominio.modelos import CoberturaBonificada, Pago
from app.soporte_transversal.tiempo import hoy_club
from tests.fabricas_pagos import (
    asignar_beneficio_api, crear_membresia_api, crear_persona_api,
    crear_tipo_membresia_api, registrar_pago_api,
)
from tests.test_cobertura_bonificada import (
    _aplicar, _autenticar_como, _autenticar_como_admin, _crear_descuento_api,
)


def _aprobar(client, pago_id: int) -> dict:
    _autenticar_como_admin()
    resp = client.patch(
        f"/api/v1/membresias/pagos/{pago_id}/validar",
        json={
            "estado_pago": "APROBADO",
            "motivo_excepcion_sin_comprobante": "Verificado directamente en la cuenta del club.",
        },
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _mensaje_bloqueo(fecha_fin) -> str:
    return (
        "Tu mes actual se pagó con descuento. Podrás renovar cuando termine, "
        f"el {fecha_fin.strftime('%d/%m/%Y')}."
    )


def _escenario(client, porcentaje: str | None = None):
    persona = crear_persona_api(client)
    tipo = crear_tipo_membresia_api(client)
    membresia = crear_membresia_api(client, persona["id"], tipo["id"])
    if porcentaje is not None:
        descuento = _crear_descuento_api(client, porcentaje=Decimal(porcentaje))
        asignar_beneficio_api(client, persona["id"], descuento["id"])
    return persona, membresia


def test_beneficio_total_activo_rechaza_segunda_activacion(client, db_session):
    persona, membresia = _escenario(client, "100.00")
    _autenticar_como(persona["id"], ["ALUMNO"])
    primera = _aplicar(client, membresia["id"])
    assert primera.status_code == 201, primera.text
    fin = primera.json()["fechaFin"]
    antes = db_session.query(CoberturaBonificada).filter_by(membresia_id=membresia["id"]).count()

    segunda = _aplicar(client, membresia["id"])
    assert segunda.status_code == 400, segunda.text
    from datetime import date
    assert _mensaje_bloqueo(date.fromisoformat(fin)) in segunda.text
    despues = db_session.query(CoberturaBonificada).filter_by(membresia_id=membresia["id"]).count()
    assert despues == antes == 1


def test_mes_con_descuento_parcial_activo_rechaza_pago_del_socio(client, db_session):
    persona, membresia = _escenario(client, "50.00")
    _autenticar_como(persona["id"], ["ALUMNO"])
    primero = registrar_pago_api(client, persona["id"], membresia["id"])
    assert primero.status_code == 201, primero.text
    aprobado = _aprobar(client, primero.json()["id"])

    _autenticar_como(persona["id"], ["ALUMNO"])
    segundo = registrar_pago_api(client, persona["id"], membresia["id"])
    assert segundo.status_code == 400, segundo.text
    from datetime import date
    assert _mensaje_bloqueo(date.fromisoformat(aprobado["fechaFin"])) in segundo.text
    assert db_session.query(Pago).filter_by(membresia_id=membresia["id"]).count() == 1


def test_mes_a_precio_completo_activo_permite_pago_anticipado_del_socio(client):
    persona, membresia = _escenario(client)
    pago = registrar_pago_api(client, persona["id"], membresia["id"]).json()
    octubre = _aprobar(client, pago["id"])

    descuento = _crear_descuento_api(client, porcentaje=Decimal("50.00"))
    asignar_beneficio_api(client, persona["id"], descuento["id"])
    _autenticar_como(persona["id"], ["ALUMNO"])
    segundo = registrar_pago_api(client, persona["id"], membresia["id"])
    assert segundo.status_code == 201, segundo.text
    assert segundo.json()["fechaInicio"] == octubre["fechaFin"]
    assert Decimal(str(segundo.json()["monto"])) == Decimal("17.50")


def test_administrador_puede_registrar_pago_con_mes_descontado_vigente(client):
    persona, membresia = _escenario(client, "50.00")
    _autenticar_como(persona["id"], ["ALUMNO"])
    primero = registrar_pago_api(client, persona["id"], membresia["id"]).json()
    octubre = _aprobar(client, primero["id"])

    _autenticar_como_admin()
    segundo = registrar_pago_api(client, persona["id"], membresia["id"])
    assert segundo.status_code == 201, segundo.text
    assert segundo.json()["fechaInicio"] == octubre["fechaFin"]


def test_al_terminar_la_cobertura_con_descuento_el_socio_puede_renovar(client, db_session):
    persona, membresia = _escenario(client, "50.00")
    _autenticar_como(persona["id"], ["ALUMNO"])
    primero = registrar_pago_api(client, persona["id"], membresia["id"]).json()
    _aprobar(client, primero["id"])

    hoy = hoy_club()
    fila = db_session.get(Pago, primero["id"])
    fila.fecha_inicio = hoy - timedelta(days=30)
    fila.fecha_fin = hoy
    db_session.flush()

    _autenticar_como(persona["id"], ["ALUMNO"])
    nuevo = registrar_pago_api(client, persona["id"], membresia["id"])
    assert nuevo.status_code == 201, nuevo.text


def test_renovacion_de_una_membresia_vencida_ancla_en_hoy(client, db_session):
    """Con la cobertura ya vencida no hay nada que respetar: el nuevo período
    arranca hoy (no en la fecha de fin antigua)."""
    persona, membresia = _escenario(client)
    pago = registrar_pago_api(client, persona["id"], membresia["id"]).json()
    _aprobar(client, pago["id"])

    hoy = hoy_club()
    fila = db_session.get(Pago, pago["id"])
    fila.fecha_inicio = hoy - timedelta(days=90)
    fila.fecha_fin = hoy - timedelta(days=60)
    db_session.flush()

    _autenticar_como(persona["id"], ["ALUMNO"])
    nuevo = registrar_pago_api(client, persona["id"], membresia["id"])
    assert nuevo.status_code == 201, nuevo.text
    assert nuevo.json()["fechaInicio"] == hoy.isoformat()
