"""`registrar_pago` ESCRIBE el snapshot de tarifa (issue #400, slice 04a).

Las tres columnas (`tarifa_mensual_aplicada`, `meses_comprados`,
`monto_base`) nacieron NULLABLE en la migración `c1f4b8e2a706` y hasta este
slice nadie las llenaba: `registrar_pago` ya calculaba `precio_mensual` y
`meses` para derivar el período de cobertura, y los tiraba después de
usarlos. Este archivo fija que ahora se congelan en el `Pago`, con los
mismos valores que el propio método ya usa para lo demás -- no una
recomputación paralela que pueda divergir.

Nota (issue #400, slice 4b): `PagoCreateDTO` cambió de `monto` a `meses`
después de que este archivo se escribió -- ya no hay ninguna división que
"derive" `meses`, el cliente lo pide directo y el servicio multiplica
(`monto_base = tarifa_vigente * meses`). Los call sites de acá pasan por
`registrar_pago_api` (`meses=`, no `monto=`), pero lo que este archivo fija
-- que el snapshot se escribe con los mismos valores que el método ya usa
para lo demás -- no cambió.
"""
from decimal import Decimal

from app.dominio.enums import EstadoMembresia
from app.dominio.modelos import Pago
from tests.fabricas_pagos import (
    asignar_beneficio_api,
    crear_membresia_orm,
    crear_persona_orm,
    crear_tipo_membresia_orm,
    escenario_membresia_sin_pago_api,
    registrar_pago_api,
)

RUTA_DESCUENTOS = "/api/v1/descuentos/"
RUTA_TIPOS = "/api/v1/membresias/tipos"


def _crear_descuento_api(client, nombre="Beca", *, porcentaje=None, monto=None):
    """Mismo helper que `test_beneficio_en_pago.py`: duplicado a propósito
    (ver docstring de `listar_pagos_de_persona` sobre el criterio de estilo
    ya establecido en este servicio -- no se extrae un módulo compartido
    para un helper de tres líneas)."""
    payload = {"nombre": nombre, "activo": True}
    if porcentaje is not None:
        payload["porcentaje"] = porcentaje
    if monto is not None:
        payload["monto"] = monto
    respuesta = client.post(RUTA_DESCUENTOS, json=payload)
    assert respuesta.status_code == 201, respuesta.text
    return respuesta.json()


def test_un_pago_normal_escribe_las_tres_columnas(client, db_session):
    """El caso base: sin beneficio, un mes. La tarifa congelada es la de la
    membresía, los meses son los que el cliente pidió, y el monto base
    coincide con el final porque no hay descuento que reste."""
    persona, membresia = escenario_membresia_sin_pago_api(client)  # tipo a $35.00

    respuesta = registrar_pago_api(client, persona["id"], membresia["id"])
    assert respuesta.status_code == 201, respuesta.text
    pago = respuesta.json()

    fila = db_session.get(Pago, pago["id"])
    assert fila.tarifa_mensual_aplicada == Decimal("35.00")
    assert fila.meses_comprados == 1
    assert fila.monto_base == Decimal("35.00")


def test_un_pago_con_beneficio_activo_congela_el_monto_base_previo_al_descuento(client, db_session):
    """`monto_base` es el monto ANTES de `_congelar_beneficio_activo`;
    `pago.monto` sigue siendo el FINAL, ya descontado -- deben diferir, y la
    diferencia debe ser exactamente el valor de descuento congelado."""
    persona, membresia = escenario_membresia_sin_pago_api(client)  # tipo a $35.00
    descuento = _crear_descuento_api(client, "Media beca", porcentaje="50")
    asignacion = asignar_beneficio_api(client, persona["id"], descuento["id"])
    assert asignacion.status_code == 201, asignacion.text

    respuesta = registrar_pago_api(client, persona["id"], membresia["id"])
    assert respuesta.status_code == 201, respuesta.text
    pago = respuesta.json()

    fila = db_session.get(Pago, pago["id"])
    assert fila.monto == Decimal("17.50")
    assert fila.monto_base == Decimal("35.00")
    assert fila.monto_base != fila.monto
    assert fila.monto_base == fila.monto + fila.descuento_valor_aplicado
    # La tarifa y los meses no dependen del beneficio: se derivan del monto
    # BASE contra el precio mensual, igual que el período de cobertura.
    assert fila.tarifa_mensual_aplicada == Decimal("35.00")
    assert fila.meses_comprados == 1


def test_un_pago_de_varios_meses_registra_los_meses_comprados(client, db_session):
    """Pedir varios meses compra más de uno; el snapshot debe decir
    cuántos, no asumir siempre 1."""
    persona, membresia = escenario_membresia_sin_pago_api(client)  # tipo a $35.00

    respuesta = registrar_pago_api(client, persona["id"], membresia["id"], meses=3)
    assert respuesta.status_code == 201, respuesta.text
    pago = respuesta.json()

    fila = db_session.get(Pago, pago["id"])
    assert fila.tarifa_mensual_aplicada == Decimal("35.00")
    assert fila.meses_comprados == 3
    assert fila.monto_base == Decimal("105.00")


def test_un_pago_contra_tarifa_cero_no_inventa_snapshot(client, db_session):
    """Caso `precio_mensual == 0` (hoy, solo alcanzable por la gratuidad
    familiar E04-RF002: `membresia.monto_aplicado` en 0.00). Desde issue
    #400/4b, `meses` ya no es un valor de guardia -- es lo que el cliente
    pidió, y `monto_base = precio_mensual * meses` es aritmética real
    incluso acá (0.00 * meses = 0.00, siempre exacto). Aun así el servicio
    sigue dejando el snapshot AUSENTE en vez de escribir tarifa=0.00: ver
    el comentario en `PagoServicio.registrar_pago` para el razonamiento
    completo (una tarifa $0.00 con forma de dato bueno sobre una membresía
    que en los hechos no tiene ninguna)."""
    persona = crear_persona_orm(db_session, "1710034065")
    tipo = crear_tipo_membresia_orm(db_session, precio=Decimal("35.00"))
    membresia = crear_membresia_orm(
        db_session, persona, tipo, EstadoMembresia.ACTIVA, monto_aplicado=Decimal("0.00"),
    )
    db_session.commit()

    respuesta = registrar_pago_api(client, persona.id, membresia.id)
    assert respuesta.status_code == 201, respuesta.text
    pago = respuesta.json()

    fila = db_session.get(Pago, pago["id"])
    assert fila.tarifa_mensual_aplicada is None
    assert fila.meses_comprados is None
    assert fila.monto_base is None


def test_el_snapshot_sobrevive_a_un_cambio_posterior_de_tarifa(client, db_session):
    """El punto entero de congelar (issue #400/#394): subir el precio del
    catálogo DESPUÉS de un pago no debe reescribir su snapshot. Si esto
    fallara, `membresia.monto_aplicado` seguiría protegido pero el snapshot
    -- que existe justamente para no depender de esa columna mutable --
    quedaría mintiendo con el mismo problema que vino a resolver."""
    persona, membresia = escenario_membresia_sin_pago_api(client)
    tipo_id = membresia["tipoMembresiaId"]

    pago = registrar_pago_api(client, persona["id"], membresia["id"]).json()
    fila_antes = db_session.get(Pago, pago["id"])
    assert fila_antes.tarifa_mensual_aplicada == Decimal("35.00")
    assert fila_antes.meses_comprados == 1
    assert fila_antes.monto_base == Decimal("35.00")

    respuesta_patch = client.patch(f"{RUTA_TIPOS}/{tipo_id}", json={"precio": "50.00"})
    assert respuesta_patch.status_code == 200, respuesta_patch.text

    db_session.expire_all()
    fila_despues = db_session.get(Pago, pago["id"])
    assert fila_despues.tarifa_mensual_aplicada == Decimal("35.00")
    assert fila_despues.meses_comprados == 1
    assert fila_despues.monto_base == Decimal("35.00")
