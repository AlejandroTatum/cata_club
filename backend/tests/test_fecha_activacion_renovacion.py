"""
`fecha_activacion` sobrevive a una renovación (issue #1225).

`_activar_membresia_con_red_de_seguridad` pisaba `fecha_activacion` con
`datetime.now(timezone.utc)` en CADA pago aprobado, aunque su docstring ya
describía la transición INACTIVA/VENCIDA -> ACTIVA. Un segundo pago aprobado
sobre una membresía ya ACTIVA (una renovación) corría la misma línea y
movía "Socio desde" a la fecha de la renovación -- hallazgo en vivo durante
la ronda de QA del 2026-09-15 (persona 91, membresía 68).

El fix: solo se escribe `fecha_activacion` cuando la membresía está
INACTIVA al entrar al método (la primera activación real). ACTIVA, VENCIDA
o SUSPENDIDA mantienen la que ya tenían -- la antigüedad del socio es su
primera activación, nunca la última renovación.
"""
from datetime import datetime, timezone

from app.dominio.enums import EstadoMembresia
from app.dominio.modelos import Membresia

from .fabricas_pagos import (
    crear_membresia_api,
    crear_persona_api,
    crear_tipo_membresia_api,
    registrar_pago_api,
)


def _aprobar(client, pago_id: int):
    return client.patch(
        f"/api/v1/membresias/pagos/{pago_id}/validar",
        json={"estado_pago": "APROBADO"},
    )


def _fecha_activacion_api(client, membresia_id: int) -> datetime:
    body = client.get(f"/api/v1/membresias/{membresia_id}").json()
    return datetime.fromisoformat(body["fechaActivacion"].replace("Z", "+00:00"))


def test_primer_pago_aprobado_en_membresia_inactiva_fija_fecha_activacion_real(client):
    """Caso 1: la primera activación SÍ escribe un instante real de
    `fecha_activacion` -- la membresía nace INACTIVA con una fecha
    placeholder (issue #1212), y este es el momento en que deja de serlo."""
    persona = crear_persona_api(client)
    tipo = crear_tipo_membresia_api(client)
    membresia = crear_membresia_api(client, persona["id"], tipo["id"])
    assert membresia["estado"] == "INACTIVA"

    pago = registrar_pago_api(
        client, persona["id"], membresia["id"], tipo_pago="EFECTIVO",
    ).json()

    antes = datetime.now(timezone.utc)
    resp = _aprobar(client, pago["id"])
    despues = datetime.now(timezone.utc)
    assert resp.status_code == 200

    membresia_actualizada = client.get(f"/api/v1/membresias/{membresia['id']}").json()
    assert membresia_actualizada["estado"] == "ACTIVA"
    fecha_activacion = _fecha_activacion_api(client, membresia["id"])
    assert antes <= fecha_activacion <= despues


def test_segundo_pago_aprobado_en_membresia_activa_no_pisa_fecha_activacion(client):
    """Caso 2: una renovación (segundo pago aprobado sobre una membresía ya
    ACTIVA) deja `fecha_activacion` byte-idéntica -- ese es exactamente el
    hallazgo de QA que motivó el issue #1225."""
    persona = crear_persona_api(client)
    tipo = crear_tipo_membresia_api(client)
    membresia = crear_membresia_api(client, persona["id"], tipo["id"])

    primer_pago = registrar_pago_api(
        client, persona["id"], membresia["id"], tipo_pago="EFECTIVO",
    ).json()
    assert _aprobar(client, primer_pago["id"]).status_code == 200

    membresia_activa = client.get(f"/api/v1/membresias/{membresia['id']}").json()
    assert membresia_activa["estado"] == "ACTIVA"
    fecha_activacion_original = _fecha_activacion_api(client, membresia["id"])

    segundo_pago = registrar_pago_api(
        client, persona["id"], membresia["id"], tipo_pago="EFECTIVO",
    ).json()
    resp = _aprobar(client, segundo_pago["id"])
    assert resp.status_code == 200

    membresia_renovada = client.get(f"/api/v1/membresias/{membresia['id']}").json()
    assert membresia_renovada["estado"] == "ACTIVA"
    assert _fecha_activacion_api(client, membresia["id"]) == fecha_activacion_original


def test_pago_aprobado_en_membresia_vencida_reactiva_sin_pisar_fecha_activacion(
    client, db_session,
):
    """Caso 3: una reactivación desde VENCIDA vuelve a poner el estado en
    ACTIVA, pero `fecha_activacion` sigue siendo la de la primera
    activación real -- VENCIDA no es "nunca estuvo activa", es "dejó de
    estarlo"."""
    persona = crear_persona_api(client)
    tipo = crear_tipo_membresia_api(client)
    membresia = crear_membresia_api(client, persona["id"], tipo["id"])

    primer_pago = registrar_pago_api(
        client, persona["id"], membresia["id"], tipo_pago="EFECTIVO",
    ).json()
    assert _aprobar(client, primer_pago["id"]).status_code == 200
    fecha_activacion_original = _fecha_activacion_api(client, membresia["id"])

    # Mismo idiom que `test_membresias_pagos.py::
    # test_cola_excluye_pendientes_archivados_y_pausados`: forzar el estado
    # directo por ORM, sin pasar por ningún servicio que hoy exista para
    # vencer una membresía.
    db_session.get(Membresia, membresia["id"]).estado = EstadoMembresia.VENCIDA
    db_session.commit()

    segundo_pago = registrar_pago_api(
        client, persona["id"], membresia["id"], tipo_pago="EFECTIVO",
    ).json()
    resp = _aprobar(client, segundo_pago["id"])
    assert resp.status_code == 200

    membresia_reactivada = client.get(f"/api/v1/membresias/{membresia['id']}").json()
    assert membresia_reactivada["estado"] == "ACTIVA"
    assert _fecha_activacion_api(client, membresia["id"]) == fecha_activacion_original
