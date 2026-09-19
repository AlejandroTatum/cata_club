import logging
from datetime import date, datetime, time, timezone
from decimal import Decimal
from typing import get_args

import pytest

from app.dominio.cedula import cedula_valida
from app.dominio.enums import EstadoMembresia, EstadoPago
from app.dominio.modelos import AsignacionDescuento, CoberturaBonificada, Descuento, Membresia, Pago, Persona
from app.presentacion.routers import membresias_pagos_router as membresias_pagos_router_mod
from app.seguridad.gestor_auth import GestorAutenticacion
from app.servicios_negocio.dtos.membresia_pago_schemas import MembresiaResponseDTO
from app.servicios_negocio.membresia_pago_servicio import PagoServicio
from tests.fabricas_pagos import (
    crear_membresia_orm, crear_pago_orm, crear_persona_orm, crear_tipo_membresia_orm,
)


def _crear_persona(client, cedula="1710034065"):
    return client.post(
        "/api/v1/personas/",
        json={
            "nombres": "Ana", "apellidos": "Torres", "cedula": cedula,
            "fecha_nacimiento": "2010-05-14", "telefono": "0991234567",
        },
    ).json()


def _crear_tipo_membresia(client, modalidad="MENSUAL"):
    return client.post(
        "/api/v1/membresias/tipos",
        json={
            "categoria": "Adultos",
            "precio": "35.00", "modalidad": modalidad,
        },
    ).json()


def test_membresia_nace_inactiva_no_pendiente_pago(client):
    """Corrección D11: el estado inicial ya NO es PENDIENTE_PAGO (ese
    concepto pertenece a Pago), sino INACTIVA."""
    persona = _crear_persona(client)
    tipo = _crear_tipo_membresia(client)

    resp = client.post(
        "/api/v1/membresias/",
        json={
            "monto_aplicado": "35.00", "fecha_activacion": "2026-07-01T00:00:00",
            "persona_id": persona["id"], "tipo_membresia_id": tipo["id"],
        },
    )
    assert resp.status_code == 201
    assert resp.json()["estado"] == "INACTIVA"


def test_registrar_pago_ajeno_da_403(client_sin_permisos):
    """Gap: un usuario ALUMNO (persona_id=1 según el fixture) no puede
    registrar un pago a nombre de otra persona (persona_id=999)."""
    resp = client_sin_permisos.post(
        "/api/v1/membresias/pagos",
        json={
            "meses": 1, "tipo_pago": "EFECTIVO",
            "fecha_inicio": "2026-07-01", "fecha_fin": "2026-07-31",
            "persona_id": 999, "membresia_id": 1,
        },
    )
    assert resp.status_code == 403


def test_registrar_pago_propio_no_requiere_admin(client_sin_permisos):
    """El dueño (persona_id=1, igual al persona_id del token) sí puede
    registrar su propio pago aunque no sea ADMINISTRADOR."""
    resp = client_sin_permisos.post(
        "/api/v1/membresias/pagos",
        json={
            "meses": 1, "tipo_pago": "EFECTIVO",
            "fecha_inicio": "2026-07-01", "fecha_fin": "2026-07-31",
            "persona_id": 1, "membresia_id": 999999,
        },
    )
    assert resp.status_code == 404  # no 403: la autorización sí pasó


def test_pago_aprobado_activa_membresia(client):
    persona = _crear_persona(client)
    tipo = _crear_tipo_membresia(client)
    membresia = client.post(
        "/api/v1/membresias/",
        json={
            "monto_aplicado": "35.00", "fecha_activacion": "2026-07-01T00:00:00",
            "persona_id": persona["id"], "tipo_membresia_id": tipo["id"],
        },
    ).json()

    pago = client.post(
        "/api/v1/membresias/pagos",
        json={
            "meses": 1, "tipo_pago": "TRANSFERENCIA",
            "fecha_inicio": "2026-07-01", "fecha_fin": "2026-07-31",
            "persona_id": persona["id"], "membresia_id": membresia["id"],
        },
    ).json()
    assert pago["estadoPago"] == "PENDIENTE_VALIDACION"

    resp = client.patch(
        f"/api/v1/membresias/pagos/{pago['id']}/validar",
        # Issue #459: TRANSFERENCIA sin voucher adjunto.
        json={
            "estado_pago": "APROBADO",
            "motivo_excepcion_sin_comprobante": "Verificado directamente en la cuenta del club.",
        },
    )
    assert resp.status_code == 200

    membresia_actualizada = client.get(f"/api/v1/membresias/{membresia['id']}").json()
    assert membresia_actualizada["estado"] == "ACTIVA"


def test_pago_aprobado_fija_fecha_activacion_al_instante_real_no_a_medianoche_utc(client):
    """Issue #1212: `_activar_membresia_con_red_de_seguridad` persistía
    `fecha_activacion` como medianoche UTC de `pago.fecha_inicio`,
    descartando la hora real de aprobación. En un browser UTC-negativo esa
    medianoche cae en el día calendario ANTERIOR (`getDate()` lee hora
    local), así que el carnet mostraba "Socio desde" un día antes del pago
    aprobado. Ahora se persiste el instante real (`datetime.now(timezone.
    utc)`), igual que la creación INACTIVA (`membresia_pago_servicio.py:
    274`) -- ningún llamador depende de que sea la fecha calendario de
    `fecha_inicio` (ver `Membresia.fecha_activacion.desc()` en
    `membresia_repositorio.py`, un `ORDER BY` al que le sirve cualquier
    instante real)."""
    persona = _crear_persona(client)
    tipo = _crear_tipo_membresia(client)
    membresia = client.post(
        "/api/v1/membresias/",
        json={
            "monto_aplicado": "35.00", "fecha_activacion": "2026-07-01T00:00:00",
            "persona_id": persona["id"], "tipo_membresia_id": tipo["id"],
        },
    ).json()

    pago = client.post(
        "/api/v1/membresias/pagos",
        json={
            "meses": 1, "tipo_pago": "TRANSFERENCIA",
            "fecha_inicio": "2026-07-01", "fecha_fin": "2026-07-31",
            "persona_id": persona["id"], "membresia_id": membresia["id"],
        },
    ).json()

    antes = datetime.now(timezone.utc)
    resp = client.patch(
        f"/api/v1/membresias/pagos/{pago['id']}/validar",
        # Issue #459: TRANSFERENCIA sin voucher adjunto.
        json={
            "estado_pago": "APROBADO",
            "motivo_excepcion_sin_comprobante": "Verificado directamente en la cuenta del club.",
        },
    )
    despues = datetime.now(timezone.utc)
    assert resp.status_code == 200

    membresia_actualizada = client.get(f"/api/v1/membresias/{membresia['id']}").json()
    fecha_activacion = datetime.fromisoformat(
        membresia_actualizada["fechaActivacion"].replace("Z", "+00:00"),
    )
    assert antes <= fecha_activacion <= despues
    # La regresión concreta que motivó el issue: `fecha_inicio` es
    # "2026-07-01", así que la reconstrucción vieja daba exactamente
    # medianoche UTC. El instante real de este test no cae ahí.
    assert fecha_activacion.timetz() != time(0, 0, 0, tzinfo=timezone.utc)


def test_rechazar_pago_sin_motivo_falla(client):
    persona = _crear_persona(client)
    tipo = _crear_tipo_membresia(client)
    membresia = client.post(
        "/api/v1/membresias/",
        json={
            "monto_aplicado": "35.00", "fecha_activacion": "2026-07-01T00:00:00",
            "persona_id": persona["id"], "tipo_membresia_id": tipo["id"],
        },
    ).json()
    pago = client.post(
        "/api/v1/membresias/pagos",
        json={
            "meses": 1, "tipo_pago": "EFECTIVO",
            "fecha_inicio": "2026-07-01", "fecha_fin": "2026-07-31",
            "persona_id": persona["id"], "membresia_id": membresia["id"],
        },
    ).json()

    resp = client.patch(
        f"/api/v1/membresias/pagos/{pago['id']}/validar",
        json={"estado_pago": "RECHAZADO"},
    )
    assert resp.status_code == 422


def test_rechazar_pago_con_motivo_solo_espacios_falla(client):
    persona = _crear_persona(client)
    tipo = _crear_tipo_membresia(client)
    membresia = client.post(
        "/api/v1/membresias/",
        json={
            "monto_aplicado": "35.00", "fecha_activacion": "2026-07-01T00:00:00",
            "persona_id": persona["id"], "tipo_membresia_id": tipo["id"],
        },
    ).json()
    pago = client.post(
        "/api/v1/membresias/pagos",
        json={
            "meses": 1, "tipo_pago": "EFECTIVO",
            "fecha_inicio": "2026-07-01", "fecha_fin": "2026-07-31",
            "persona_id": persona["id"], "membresia_id": membresia["id"],
        },
    ).json()

    resp = client.patch(
        f"/api/v1/membresias/pagos/{pago['id']}/validar",
        json={"estado_pago": "RECHAZADO", "motivo_rechazo": "   "},
    )
    assert resp.status_code == 422


def test_rechazar_pago_con_motivo_valido_persiste(client):
    persona = _crear_persona(client)
    tipo = _crear_tipo_membresia(client)
    membresia = client.post(
        "/api/v1/membresias/",
        json={
            "monto_aplicado": "35.00", "fecha_activacion": "2026-07-01T00:00:00",
            "persona_id": persona["id"], "tipo_membresia_id": tipo["id"],
        },
    ).json()
    pago = client.post(
        "/api/v1/membresias/pagos",
        json={
            "meses": 1, "tipo_pago": "EFECTIVO",
            "fecha_inicio": "2026-07-01", "fecha_fin": "2026-07-31",
            "persona_id": persona["id"], "membresia_id": membresia["id"],
        },
    ).json()

    resp = client.patch(
        f"/api/v1/membresias/pagos/{pago['id']}/validar",
        json={"estado_pago": "RECHAZADO", "motivo_rechazo": "Comprobante ilegible"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["estadoPago"] == "RECHAZADO"
    assert body["motivoRechazo"] == "Comprobante ilegible"


def test_aprobar_pago_sin_motivo_rechazo_funciona(client):
    persona = _crear_persona(client)
    tipo = _crear_tipo_membresia(client)
    membresia = client.post(
        "/api/v1/membresias/",
        json={
            "monto_aplicado": "35.00", "fecha_activacion": "2026-07-01T00:00:00",
            "persona_id": persona["id"], "tipo_membresia_id": tipo["id"],
        },
    ).json()
    pago = client.post(
        "/api/v1/membresias/pagos",
        json={
            "meses": 1, "tipo_pago": "EFECTIVO",
            "fecha_inicio": "2026-07-01", "fecha_fin": "2026-07-31",
            "persona_id": persona["id"], "membresia_id": membresia["id"],
        },
    ).json()

    resp = client.patch(
        f"/api/v1/membresias/pagos/{pago['id']}/validar",
        json={"estado_pago": "APROBADO"},
    )
    assert resp.status_code == 200
    assert resp.json()["estadoPago"] == "APROBADO"


def test_pago_rechazado_no_reutiliza_estado_de_membresia(client):
    """Corrección D11: rechazar un pago NO debe forzar la membresía a un
    estado que en realidad pertenece al ciclo de vida de Pago."""
    persona = _crear_persona(client)
    tipo = _crear_tipo_membresia(client)
    membresia = client.post(
        "/api/v1/membresias/",
        json={
            "monto_aplicado": "35.00", "fecha_activacion": "2026-07-01T00:00:00",
            "persona_id": persona["id"], "tipo_membresia_id": tipo["id"],
        },
    ).json()
    pago = client.post(
        "/api/v1/membresias/pagos",
        json={
            "meses": 1, "tipo_pago": "EFECTIVO",
            "fecha_inicio": "2026-07-01", "fecha_fin": "2026-07-31",
            "persona_id": persona["id"], "membresia_id": membresia["id"],
        },
    ).json()

    client.patch(
        f"/api/v1/membresias/pagos/{pago['id']}/validar",
        json={"estado_pago": "RECHAZADO", "motivo_rechazo": "Comprobante ilegible"},
    )

    membresia_actualizada = client.get(f"/api/v1/membresias/{membresia['id']}").json()
    assert membresia_actualizada["estado"] == "INACTIVA"
    assert "PENDIENTE_PAGO" not in [membresia_actualizada["estado"]]


# --- GET /membresias/pagos (cola de validación) -----------------------------
def test_listar_pagos_incluye_nombre_de_persona(client):
    persona = _crear_persona(client)
    tipo = _crear_tipo_membresia(client)
    membresia = client.post(
        "/api/v1/membresias/",
        json={
            "monto_aplicado": "35.00", "fecha_activacion": "2026-07-01T00:00:00",
            "persona_id": persona["id"], "tipo_membresia_id": tipo["id"],
        },
    ).json()
    client.post(
        "/api/v1/membresias/pagos",
        json={
            "meses": 1, "tipo_pago": "EFECTIVO",
            "fecha_inicio": "2026-07-01", "fecha_fin": "2026-07-31",
            "persona_id": persona["id"], "membresia_id": membresia["id"],
        },
    )

    resp = client.get("/api/v1/membresias/pagos")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    assert len(body["items"]) == 1
    assert body["items"][0]["personaNombreCompleto"] == "Ana Torres"
    assert body["items"][0]["estadoPago"] == "PENDIENTE_VALIDACION"


def test_cola_excluye_pendientes_archivados_y_pausados(client, db_session):
    personas = [_crear_persona(client, cedula_valida(301)), _crear_persona(client, cedula_valida(302))]
    membresias = []
    for persona in personas:
        tipo = _crear_tipo_membresia(client)
        membresias.append(client.post("/api/v1/membresias/", json={
            "monto_aplicado": "35.00", "fecha_activacion": "2026-07-01T00:00:00",
            "persona_id": persona["id"], "tipo_membresia_id": tipo["id"],
        }).json())
        client.post("/api/v1/membresias/pagos", json={
            "meses": 1, "tipo_pago": "EFECTIVO", "fecha_inicio": "2026-07-01",
            "fecha_fin": "2026-07-31", "persona_id": persona["id"], "membresia_id": membresias[-1]["id"],
        })
    db_session.get(Persona, personas[0]["id"]).activo = False
    db_session.get(Membresia, membresias[1]["id"]).estado = EstadoMembresia.SUSPENDIDA
    db_session.commit()

    body = client.get("/api/v1/membresias/pagos").json()
    assert body["items"] == []
    assert body["total"] == 0


def test_listar_pagos_filtra_por_estado(client):
    persona = _crear_persona(client)
    tipo = _crear_tipo_membresia(client)
    membresia = client.post(
        "/api/v1/membresias/",
        json={
            "monto_aplicado": "35.00", "fecha_activacion": "2026-07-01T00:00:00",
            "persona_id": persona["id"], "tipo_membresia_id": tipo["id"],
        },
    ).json()
    pago = client.post(
        "/api/v1/membresias/pagos",
        json={
            "meses": 1, "tipo_pago": "EFECTIVO",
            "fecha_inicio": "2026-07-01", "fecha_fin": "2026-07-31",
            "persona_id": persona["id"], "membresia_id": membresia["id"],
        },
    ).json()
    client.patch(f"/api/v1/membresias/pagos/{pago['id']}/validar", json={"estado_pago": "APROBADO"})

    resp = client.get("/api/v1/membresias/pagos", params={"estado_pago": "PENDIENTE_VALIDACION"})
    assert resp.status_code == 200
    assert resp.json()["items"] == []

    resp = client.get("/api/v1/membresias/pagos", params={"estado_pago": "APROBADO"})
    assert resp.json()["total"] == 1


def test_listar_pagos_requiere_admin(client_sin_permisos):
    resp = client_sin_permisos.get("/api/v1/membresias/pagos")
    assert resp.status_code == 403


def test_estadisticas_membresias_cuenta_solo_activas(client):
    persona = _crear_persona(client)
    tipo = _crear_tipo_membresia(client)
    membresia_activa = client.post(
        "/api/v1/membresias/",
        json={
            "monto_aplicado": "35.00", "persona_id": persona["id"], "tipo_membresia_id": tipo["id"],
        },
    ).json()
    client.post(
        "/api/v1/membresias/",
        json={
            "monto_aplicado": "35.00", "persona_id": persona["id"], "tipo_membresia_id": tipo["id"],
        },
    )
    pago = client.post(
        "/api/v1/membresias/pagos",
        json={
            "meses": 1, "tipo_pago": "EFECTIVO", "fecha_inicio": "2026-07-01", "fecha_fin": "2026-07-31",
            "persona_id": persona["id"], "membresia_id": membresia_activa["id"],
        },
    ).json()
    client.patch(f"/api/v1/membresias/pagos/{pago['id']}/validar", json={"estado_pago": "APROBADO"})

    response = client.get("/api/v1/membresias/estadisticas")

    assert response.status_code == 200
    assert response.json() == {"activeMemberships": 1}


def test_estadisticas_membresias_requiere_admin(client_sin_permisos):
    response = client_sin_permisos.get("/api/v1/membresias/estadisticas")

    assert response.status_code == 403


# --- GET /membresias/ (listado paginado admin) ------------------------------
# `MembresiaRepositorio.listar` había quedado como código huérfano (ver
# `test_membresia_repositorio.py`): el endpoint respondía 500 desde que se
# agregó. Estos tests fijan la forma de la respuesta a nivel API.

def test_listar_membresias_vacio_da_200_con_items_vacios(client):
    response = client.get("/api/v1/membresias/")

    assert response.status_code == 200
    body = response.json()
    assert body["items"] == []
    assert body["total"] == 0


def test_listar_membresias_devuelve_paginated_response_con_shape_correcta(client):
    persona = _crear_persona(client)
    tipo = _crear_tipo_membresia(client)
    creada = client.post(
        "/api/v1/membresias/",
        json={
            "monto_aplicado": "35.00", "fecha_activacion": "2026-07-01T00:00:00",
            "persona_id": persona["id"], "tipo_membresia_id": tipo["id"],
        },
    ).json()

    response = client.get("/api/v1/membresias/")

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["skip"] == 0
    assert body["limit"] == 50
    assert len(body["items"]) == 1
    assert body["items"][0]["id"] == creada["id"]
    assert body["items"][0]["estado"] == "INACTIVA"
    assert body["items"][0]["esGratuidadFamiliar"] is False


def test_listar_membresias_respeta_skip_y_limit(client):
    tipo = _crear_tipo_membresia(client)
    for i in range(3):
        persona = _crear_persona(client, cedula=cedula_valida(402 + i))
        client.post(
            "/api/v1/membresias/",
            json={
                "monto_aplicado": "35.00", "fecha_activacion": "2026-07-01T00:00:00",
                "persona_id": persona["id"], "tipo_membresia_id": tipo["id"],
            },
        )

    response = client.get("/api/v1/membresias/?skip=1&limit=1")

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 3
    assert body["skip"] == 1
    assert body["limit"] == 1
    assert len(body["items"]) == 1


def test_listar_membresias_requiere_admin(client_sin_permisos):
    response = client_sin_permisos.get("/api/v1/membresias/")

    assert response.status_code == 403


# --- GET /membresias/pagos/persona/{persona_id} (historial propio) ----------
def test_alumno_ve_su_propio_historial_de_pagos_incluyendo_rechazado_con_motivo(client):
    """`client` autentica como persona_id=1; al ser la primera persona creada
    en una BD limpia, ésta recibe id=1, con lo que queda siendo "la propia"
    desde la perspectiva del token (mismo truco que test_ranking.py)."""
    persona = _crear_persona(client)
    assert persona["id"] == 1
    tipo = _crear_tipo_membresia(client)
    membresia = client.post(
        "/api/v1/membresias/",
        json={
            "monto_aplicado": "35.00", "fecha_activacion": "2026-07-01T00:00:00",
            "persona_id": persona["id"], "tipo_membresia_id": tipo["id"],
        },
    ).json()
    pago = client.post(
        "/api/v1/membresias/pagos",
        json={
            "meses": 1, "tipo_pago": "EFECTIVO",
            "fecha_inicio": "2026-07-01", "fecha_fin": "2026-07-31",
            "persona_id": persona["id"], "membresia_id": membresia["id"],
        },
    ).json()
    client.patch(
        f"/api/v1/membresias/pagos/{pago['id']}/validar",
        json={"estado_pago": "RECHAZADO", "motivo_rechazo": "Comprobante ilegible"},
    )

    resp = client.get(f"/api/v1/membresias/pagos/persona/{persona['id']}")
    assert resp.status_code == 200
    historial = resp.json()
    assert len(historial) == 1
    assert historial[0]["estadoPago"] == "RECHAZADO"
    assert historial[0]["motivoRechazo"] == "Comprobante ilegible"


def test_representante_ve_los_pagos_de_su_representado(client_sin_permisos, client):
    """Esquema (igual que test_voucher_pago.py): se crea todo con `client`
    (admin) y luego se restaura el token de `client_sin_permisos` (persona_id=1,
    rol ALUMNO, sin ADMINISTRADOR) para que la autorización dependa
    exclusivamente del vínculo representante_id, no de un bypass admin."""
    representante = _crear_persona(client, cedula=cedula_valida(430))
    assert representante["id"] == 1
    alumno = client.post(
        "/api/v1/personas/",
        json={
            "nombres": "Hijo", "apellidos": "Representado", "cedula": cedula_valida(431),
            "fecha_nacimiento": "2015-05-14", "telefono": "0991234567",
            "representante_id": representante["id"],
        },
    ).json()
    tipo = _crear_tipo_membresia(client)
    membresia = client.post(
        "/api/v1/membresias/",
        json={
            "monto_aplicado": "35.00", "fecha_activacion": "2026-07-01T00:00:00",
            "persona_id": alumno["id"], "tipo_membresia_id": tipo["id"],
        },
    ).json()
    client.post(
        "/api/v1/membresias/pagos",
        json={
            "meses": 1, "tipo_pago": "EFECTIVO",
            "fecha_inicio": "2026-07-01", "fecha_fin": "2026-07-31",
            "persona_id": alumno["id"], "membresia_id": membresia["id"],
        },
    )

    from main import app
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": "alumno@cataclub.test", "persona_id": 1, "roles": ["ALUMNO"],
    }

    resp = client_sin_permisos.get(f"/api/v1/membresias/pagos/persona/{alumno['id']}")
    assert resp.status_code == 200
    historial = resp.json()
    assert len(historial) == 1
    assert historial[0]["personaId"] == alumno["id"]


def test_admin_puede_listar_pagos_de_cualquier_persona(client):
    persona = _crear_persona(client, cedula=cedula_valida(432))
    tipo = _crear_tipo_membresia(client)
    membresia = client.post(
        "/api/v1/membresias/",
        json={
            "monto_aplicado": "35.00", "fecha_activacion": "2026-07-01T00:00:00",
            "persona_id": persona["id"], "tipo_membresia_id": tipo["id"],
        },
    ).json()
    client.post(
        "/api/v1/membresias/pagos",
        json={
            "meses": 1, "tipo_pago": "EFECTIVO",
            "fecha_inicio": "2026-07-01", "fecha_fin": "2026-07-31",
            "persona_id": persona["id"], "membresia_id": membresia["id"],
        },
    )

    resp = client.get(f"/api/v1/membresias/pagos/persona/{persona['id']}")
    assert resp.status_code == 200
    assert len(resp.json()) == 1


def test_persona_sin_relacion_no_puede_ver_historial_de_pagos_ajeno(client_sin_permisos, client):
    """POST /personas/ es admin-only, así que las personas se crean con
    `client` y luego se restaura el token de `client_sin_permisos` (persona_id=1,
    rol ALUMNO) antes de la petición que se evalúa -- mismo truco que
    `test_voucher_pago.py::test_subir_voucher_sin_ser_duenio_ni_admin_da_403`.
    Relleno para que `otra_persona` no quede con id=1."""
    _crear_persona(client, cedula=cedula_valida(433))
    otra_persona = _crear_persona(client, cedula=cedula_valida(434))

    from main import app
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": "alumno@cataclub.test", "persona_id": 1, "roles": ["ALUMNO"],
    }

    resp = client_sin_permisos.get(f"/api/v1/membresias/pagos/persona/{otra_persona['id']}")
    assert resp.status_code == 403


def test_historial_de_pagos_vacio_cuando_no_hay(client):
    persona = _crear_persona(client, cedula=cedula_valida(435))

    resp = client.get(f"/api/v1/membresias/pagos/persona/{persona['id']}")
    assert resp.status_code == 200
    assert resp.json() == []


# --- GET /membresias/persona/{persona_id} (lectura propia) ----------------
def test_alumno_ve_sus_propias_membresias(client):
    """`client` autentica como persona_id=1; al ser la primera persona creada
    en una BD limpia, ésta recibe id=1, con lo que queda siendo "la propia"."""
    persona = _crear_persona(client)
    assert persona["id"] == 1
    tipo = _crear_tipo_membresia(client)
    client.post(
        "/api/v1/membresias/",
        json={
            "monto_aplicado": "35.00", "fecha_activacion": "2026-07-01T00:00:00",
            "persona_id": persona["id"], "tipo_membresia_id": tipo["id"],
        },
    )

    resp = client.get(f"/api/v1/membresias/persona/{persona['id']}")
    assert resp.status_code == 200
    membresias = resp.json()
    assert len(membresias) == 1
    assert membresias[0]["personaId"] == persona["id"]
    assert membresias[0]["esGratuidadFamiliar"] is False


def test_representante_ve_membresias_de_representado(client_sin_permisos, client):
    """Esquema: se crea todo con `client` (admin) y luego se restaura el token
    de `client_sin_permisos` (persona_id=1, rol ALUMNO) para que la autorización
    dependa exclusivamente del vínculo representante_id."""
    representante = _crear_persona(client, cedula=cedula_valida(430))
    assert representante["id"] == 1
    alumno = client.post(
        "/api/v1/personas/",
        json={
            "nombres": "Hijo", "apellidos": "Representado", "cedula": cedula_valida(431),
            "fecha_nacimiento": "2015-05-14", "telefono": "0991234567",
            "representante_id": representante["id"],
        },
    ).json()
    tipo = _crear_tipo_membresia(client)
    client.post(
        "/api/v1/membresias/",
        json={
            "monto_aplicado": "35.00", "fecha_activacion": "2026-07-01T00:00:00",
            "persona_id": alumno["id"], "tipo_membresia_id": tipo["id"],
        },
    )

    from main import app
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": "alumno@cataclub.test", "persona_id": 1, "roles": ["ALUMNO"],
    }

    resp = client_sin_permisos.get(f"/api/v1/membresias/persona/{alumno['id']}")
    assert resp.status_code == 200
    membresias = resp.json()
    assert len(membresias) == 1
    assert membresias[0]["personaId"] == alumno["id"]


def test_admin_puede_listar_membresias_de_cualquier_persona(client):
    persona = _crear_persona(client, cedula=cedula_valida(432))
    tipo = _crear_tipo_membresia(client)
    client.post(
        "/api/v1/membresias/",
        json={
            "monto_aplicado": "35.00", "fecha_activacion": "2026-07-01T00:00:00",
            "persona_id": persona["id"], "tipo_membresia_id": tipo["id"],
        },
    )

    resp = client.get(f"/api/v1/membresias/persona/{persona['id']}")
    assert resp.status_code == 200
    assert len(resp.json()) == 1


def test_persona_sin_relacion_no_puede_ver_membresias_ajenas(client_sin_permisos, client):
    """POST /personas/ es admin-only, así que las personas se crean con `client`
    y luego se restaura el token de `client_sin_permisos` (persona_id=1, rol
    ALUMNO) antes de la petición que se evalúa."""
    _crear_persona(client, cedula=cedula_valida(433))
    otra_persona = _crear_persona(client, cedula=cedula_valida(434))

    from main import app
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": "alumno@cataclub.test", "persona_id": 1, "roles": ["ALUMNO"],
    }

    resp = client_sin_permisos.get(f"/api/v1/membresias/persona/{otra_persona['id']}")
    assert resp.status_code == 403


def test_listar_membresias_por_persona_vacio_cuando_no_hay(client):
    persona = _crear_persona(client, cedula=cedula_valida(436))

    resp = client.get(f"/api/v1/membresias/persona/{persona['id']}")
    assert resp.status_code == 200
    assert resp.json() == []


# --- GET /membresias/mias (lectura derivada del JWT) ------------------------
def test_membresias_mias_aplica_matriz_de_propiedad_sin_exponer_al_extrano(client, client_sin_permisos):
    from main import app

    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": "admin@cataclub.test", "persona_id": 999, "roles": ["ADMINISTRADOR"],
    }
    representante = _crear_persona(client, cedula=cedula_valida(430))
    alumno = client.post(
        "/api/v1/personas/",
        json={
            "nombres": "Hijo", "apellidos": "Representado", "cedula": cedula_valida(431),
            "fecha_nacimiento": "2015-05-14", "telefono": "0991234567",
            "representante_id": representante["id"],
        },
    ).json()
    ajeno = _crear_persona(client, cedula=cedula_valida(434))
    tipo = _crear_tipo_membresia(client)
    client.post(
        "/api/v1/membresias/",
        json={
            "monto_aplicado": "35.00", "fecha_activacion": "2026-07-01T00:00:00",
            "persona_id": alumno["id"], "tipo_membresia_id": tipo["id"],
        },
    )

    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": "representante@cataclub.test", "persona_id": representante["id"], "roles": ["ALUMNO"],
    }
    representante_resp = client_sin_permisos.get(f"/api/v1/membresias/mias?persona_id={alumno['id']}")
    assert representante_resp.status_code == 200
    assert representante_resp.json()[0]["personaId"] == alumno["id"]
    assert representante_resp.json()[0]["esGratuidadFamiliar"] is False

    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": "admin@cataclub.test", "persona_id": ajeno["id"], "roles": ["ADMINISTRADOR"],
    }
    admin_resp = client_sin_permisos.get(f"/api/v1/membresias/mias?persona_id={alumno['id']}")
    assert admin_resp.status_code == 200
    assert admin_resp.json()[0]["personaId"] == alumno["id"]

    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": "ajeno@cataclub.test", "persona_id": ajeno["id"], "roles": ["ALUMNO"],
    }
    stranger_resp = client_sin_permisos.get(f"/api/v1/membresias/mias?persona_id={alumno['id']}")
    assert stranger_resp.status_code == 403
    assert str(alumno["id"]) not in stranger_resp.json()["detail"]

    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": "alumno@cataclub.test", "persona_id": alumno["id"], "roles": ["ALUMNO"],
    }
    owner_resp = client_sin_permisos.get("/api/v1/membresias/mias")
    assert owner_resp.status_code == 200
    assert owner_resp.json()[0]["personaId"] == alumno["id"]


# --- Issue #1328: `cubiertoHasta` combina Pago aprobado y CoberturaBonificada --
# Una sola fuente de verdad para "cubierto hasta" en el portal del alumno: la
# misma ancla que `PagoServicio._fecha_fin_maxima_combinada` ya usa para
# encadenar beneficios (`aplicar_beneficio_bonificado`), expuesta acá para que
# el frontend deje de recalcularla mirando solo `Pago` (issue original: la
# cobertura otorgada por un beneficio quedaba invisible en pantalla).
def test_membresias_mias_cubierto_hasta_combina_pago_y_cobertura_bonificada(client, db_session):
    persona = crear_persona_orm(db_session, cedula_valida(910))
    tipo = crear_tipo_membresia_orm(db_session)
    membresia = crear_membresia_orm(db_session, persona, tipo, EstadoMembresia.ACTIVA)
    pago = crear_pago_orm(db_session, persona, membresia, EstadoPago.APROBADO)
    pago.fecha_fin = date(2026, 11, 30)

    descuento = Descuento(nombre="Becado #1328", porcentaje=Decimal("100.00"), activo=True)
    db_session.add(descuento)
    db_session.flush()
    asignacion = AsignacionDescuento(
        persona_id=persona.id, descuento_id=descuento.id, asignado_por_persona_id=persona.id,
    )
    db_session.add(asignacion)
    db_session.flush()
    db_session.add(CoberturaBonificada(
        membresia_id=membresia.id, persona_id=persona.id,
        asignacion_descuento_id=asignacion.id,
        tarifa_mensual_aplicada=Decimal("35.00"), meses_comprados=1,
        descuento_valor_aplicado=Decimal("35.00"),
        descuento_porcentaje_aplicado=Decimal("100.00"),
        fecha_inicio=date(2026, 12, 1), fecha_fin=date(2027, 1, 31),
        otorgada_por_persona_id=persona.id,
    ))
    db_session.commit()

    resp = client.get(f"/api/v1/membresias/mias?persona_id={persona.id}")
    assert resp.status_code == 200
    # La cobertura bonificada (2027-01-31) es más lejana que el pago
    # aprobado (2026-11-30): la ancla combinada debe tomar la más lejana,
    # nunca solo la de `Pago`.
    assert resp.json()[0]["cubiertoHasta"] == "2027-01-31"


def test_membresias_mias_cubierto_hasta_null_sin_ninguna_cobertura(client, db_session):
    persona = crear_persona_orm(db_session, cedula_valida(911))
    tipo = crear_tipo_membresia_orm(db_session)
    crear_membresia_orm(db_session, persona, tipo, EstadoMembresia.INACTIVA)
    db_session.commit()

    resp = client.get(f"/api/v1/membresias/mias?persona_id={persona.id}")
    assert resp.status_code == 200
    assert resp.json()[0]["cubiertoHasta"] is None


def test_membresias_mias_cubierto_hasta_no_incurre_en_n_mas_uno(client, db_session, contar_selects):
    """Tres membresías de la misma persona: la ancla combinada se resuelve
    con las mismas dos consultas AGRUPADAS que `PagoServicio.obtener_deuda_
    bulk` ya usa (issue #326) -- nunca una consulta por membresía."""
    persona = crear_persona_orm(db_session, cedula_valida(912))
    tipo = crear_tipo_membresia_orm(db_session)
    fechas_fin_esperadas = {}
    for indice in range(3):
        membresia = crear_membresia_orm(db_session, persona, tipo, EstadoMembresia.INACTIVA)
        pago = crear_pago_orm(db_session, persona, membresia, EstadoPago.APROBADO)
        pago.fecha_fin = date(2026, 9, 1 + indice)
        fechas_fin_esperadas[membresia.id] = pago.fecha_fin
    db_session.commit()
    db_session.expire_all()  # fuerza recarga real desde la BD

    with contar_selects() as sentencias:
        resp = client.get(f"/api/v1/membresias/mias?persona_id={persona.id}")

    assert resp.status_code == 200
    cuerpo = resp.json()
    assert len(cuerpo) == 3
    for membresia_dto in cuerpo:
        assert membresia_dto["cubiertoHasta"] == fechas_fin_esperadas[membresia_dto["id"]].isoformat()
    selects = [s for s in sentencias if s.strip().upper().startswith("SELECT")]
    assert len(selects) <= 4, (
        f"Se esperaban a lo sumo 4 SELECTs (autorización + membresías + 2 "
        f"anclas agrupadas), se ejecutaron {len(selects)}: {selects}"
    )


# --- Issue #1337 (R2-002): `cubierto_hasta` poblado en TODOS los endpoints
# que devuelven `MembresiaResponseDTO`, no solo en `/mias` y `/persona/{id}`.
# Antes de este slice, `None` en el resto de los endpoints significaba "no
# calculado" -- un significado distinto de "sin cobertura" para el MISMO
# campo. Mismo patrón que los tests de arriba: una `CoberturaBonificada` con
# `fecha_fin` MÁS LEJANA que el pago aprobado, para probar que cada endpoint
# lee la ancla combinada real (`PagoServicio.fecha_fin_maxima_combinada_bulk`)
# y no solo lo que la columna `Pago.fecha_fin` sugiere.
def _persona_con_cobertura_combinada(db_session, cedula):
    """Persona + membresía ACTIVA + pago aprobado + `CoberturaBonificada`
    posterior -- devuelve `(persona, membresia, tipo)`. `cubiertoHasta`
    esperado: `2026-11-30` (la cobertura bonificada, no el pago)."""
    persona = crear_persona_orm(db_session, cedula_valida(cedula))
    tipo = crear_tipo_membresia_orm(db_session)
    membresia = crear_membresia_orm(db_session, persona, tipo, EstadoMembresia.ACTIVA)
    pago = crear_pago_orm(db_session, persona, membresia, EstadoPago.APROBADO)
    pago.fecha_fin = date(2026, 9, 30)

    descuento = Descuento(nombre=f"Becado #1337-{cedula}", porcentaje=Decimal("100.00"), activo=True)
    db_session.add(descuento)
    db_session.flush()
    asignacion = AsignacionDescuento(
        persona_id=persona.id, descuento_id=descuento.id, asignado_por_persona_id=persona.id,
    )
    db_session.add(asignacion)
    db_session.flush()
    db_session.add(CoberturaBonificada(
        membresia_id=membresia.id, persona_id=persona.id,
        asignacion_descuento_id=asignacion.id,
        tarifa_mensual_aplicada=Decimal("35.00"), meses_comprados=1,
        descuento_valor_aplicado=Decimal("35.00"),
        descuento_porcentaje_aplicado=Decimal("100.00"),
        fecha_inicio=date(2026, 10, 1), fecha_fin=date(2026, 11, 30),
        otorgada_por_persona_id=persona.id,
    ))
    db_session.commit()
    return persona, membresia, tipo


def test_listar_membresias_admin_incluye_cubierto_hasta(client, db_session):
    """La cola paginada del panel admin (issue #4) es donde el review de
    #1328 encontró el hueco original: `None` ahí no distinguía "sin
    cobertura" de "nadie lo calculó todavía"."""
    _, membresia, _ = _persona_con_cobertura_combinada(db_session, 920)

    resp = client.get("/api/v1/membresias/")
    assert resp.status_code == 200
    fila = next(m for m in resp.json()["items"] if m["id"] == membresia.id)
    assert fila["cubiertoHasta"] == "2026-11-30"


def test_obtener_membresia_incluye_cubierto_hasta(client, db_session):
    _, membresia, _ = _persona_con_cobertura_combinada(db_session, 921)

    resp = client.get(f"/api/v1/membresias/{membresia.id}")
    assert resp.status_code == 200
    assert resp.json()["cubiertoHasta"] == "2026-11-30"


def test_suspender_membresia_incluye_cubierto_hasta(client, db_session):
    _, membresia, _ = _persona_con_cobertura_combinada(db_session, 922)

    resp = client.post(f"/api/v1/membresias/{membresia.id}/suspender", json={"motivo": "motivo"})
    assert resp.status_code == 200
    assert resp.json()["cubiertoHasta"] == "2026-11-30"


def test_reactivar_membresia_incluye_cubierto_hasta(client, db_session):
    _, membresia, _ = _persona_con_cobertura_combinada(db_session, 923)
    client.post(f"/api/v1/membresias/{membresia.id}/suspender", json={"motivo": "motivo"})

    resp = client.post(f"/api/v1/membresias/{membresia.id}/reactivar", json={"motivo": "motivo"})
    assert resp.status_code == 200
    assert resp.json()["cubiertoHasta"] == "2026-11-30"


def test_cambiar_plan_membresia_incluye_cubierto_hasta(client, db_session):
    _, membresia, tipo_actual = _persona_con_cobertura_combinada(db_session, 924)
    tipo_nuevo = _crear_tipo_membresia(client)
    assert tipo_nuevo["id"] != tipo_actual.id

    resp = client.post(
        f"/api/v1/membresias/{membresia.id}/cambiar-plan",
        json={"nuevo_tipo_membresia_id": tipo_nuevo["id"]},
    )
    assert resp.status_code == 200
    assert resp.json()["cubiertoHasta"] == "2026-11-30"


def test_crear_membresia_incluye_la_clave_cubierto_hasta(client, db_session):
    """Una membresía recién creada no tiene ningún `Pago` ni
    `CoberturaBonificada` todavía -- `null` es correcto acá por
    construcción, no por omisión -- pero la CLAVE debe estar presente,
    igual que en el resto de los endpoints.

    Issue #1349 (R3-003): la invariante "ninguna alta tiene cobertura
    propia todavía" vivía solo en un comentario de `_recien_creada_sin_
    cobertura`. Acá se prueba contra la base: cero filas de `Pago`/
    `CoberturaBonificada` referencian la membresía recién creada, y el
    mismo cálculo que usa `_con_cubierto_hasta` para una membresía YA
    existente (`PagoServicio.fecha_fin_maxima_combinada_bulk`) da `None`
    para esta -- el valor que el helper hardcodea coincide con lo que
    daría la lectura real."""
    persona = _crear_persona(client, cedula=cedula_valida(925))
    tipo = _crear_tipo_membresia(client)

    resp = client.post(
        "/api/v1/membresias/",
        json={
            "monto_aplicado": "35.00", "fecha_activacion": "2026-07-01T00:00:00",
            "persona_id": persona["id"], "tipo_membresia_id": tipo["id"],
        },
    )
    assert resp.status_code == 201
    assert "cubiertoHasta" in resp.json()
    assert resp.json()["cubiertoHasta"] is None

    membresia_id = resp.json()["id"]
    assert db_session.query(Pago).filter(Pago.membresia_id == membresia_id).count() == 0
    assert (
        db_session.query(CoberturaBonificada)
        .filter(CoberturaBonificada.membresia_id == membresia_id)
        .count() == 0
    )
    cobertura_leida = PagoServicio(db_session).fecha_fin_maxima_combinada_bulk([membresia_id])
    assert cobertura_leida.get(membresia_id) is None


def _expone_membresia_response_dto(response_model) -> bool:
    """Verdadero si `response_model` es `MembresiaResponseDTO` directo, una
    lista de esa clase, o el campo `items` de un `PaginatedResponse[...]` --
    las tres formas en que el router expone el DTO."""
    if response_model is MembresiaResponseDTO:
        return True
    if MembresiaResponseDTO in get_args(response_model):
        return True
    items_field = getattr(response_model, "model_fields", {}).get("items")
    if items_field is not None:
        return MembresiaResponseDTO in get_args(items_field.annotation)
    return False


def _cubierto_hasta_presente_en(cuerpo) -> bool:
    """Reduce las tres formas de respuesta (objeto, lista, paginada) a "toda
    fila trae la clave `cubiertoHasta`"."""
    if isinstance(cuerpo, dict) and "items" in cuerpo:
        filas = cuerpo["items"]
    elif isinstance(cuerpo, list):
        filas = cuerpo
    else:
        filas = [cuerpo]
    assert filas, "la ruta no devolvió ninguna fila para verificar"
    return all("cubiertoHasta" in fila for fila in filas)


def _llamar_propia(client, persona_id, tipo_membresia_id):
    """Llama a `POST /membresias/propia` autenticado transitoriamente como
    REPRESENTANTE del portal, y restaura el override de `decodificar_token`
    exactamente como estaba antes -- SIN override si no había ninguno
    (issue #1349, R3-001: restaurar solo `if anterior is not None` dejaba la
    identidad del portal pegada cuando no había override previo, filtrándola
    a la llamada admin-only siguiente que comparte la misma app de
    FastAPI)."""
    from main import app as fastapi_app

    tenia_override = GestorAutenticacion.decodificar_token in fastapi_app.dependency_overrides
    anterior = fastapi_app.dependency_overrides.get(GestorAutenticacion.decodificar_token)
    fastapi_app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": "portal@cataclub.test", "persona_id": persona_id, "roles": ["REPRESENTANTE"],
    }
    try:
        return client.post(
            "/api/v1/membresias/propia", json={"tipo_membresia_id": tipo_membresia_id},
        )
    finally:
        if tenia_override:
            fastapi_app.dependency_overrides[GestorAutenticacion.decodificar_token] = anterior
        else:
            fastapi_app.dependency_overrides.pop(GestorAutenticacion.decodificar_token, None)


def test_llamar_propia_no_filtra_la_identidad_del_portal_a_la_llamada_siguiente(
    client_sin_token, db_session,
):
    """Issue #1349 (R3-001): antes, `_llamar_propia` solo restauraba el
    override anterior de `decodificar_token` `if anterior is not None`. Con
    `client_sin_token` (arranca SIN ningún override) eso significaba no
    restaurar nada -- el override REPRESENTANTE quedaba pegado en la app
    compartida, y la siguiente llamada admin-only heredaba esa identidad en
    vez de fallar por falta de autenticación. RED sin el fix: la llamada de
    abajo respondía 403 (autenticada como REPRESENTANTE) en lugar de 401."""
    persona_portal = crear_persona_orm(db_session, cedula_valida(943), nombres="Portal", apellidos="Fuga")
    tipo = crear_tipo_membresia_orm(db_session)
    db_session.commit()

    _llamar_propia(client_sin_token, persona_portal.id, tipo.id)

    respuesta = client_sin_token.get("/api/v1/membresias/")
    assert respuesta.status_code == 401


def test_todo_endpoint_que_expone_membresia_response_dto_incluye_cubierto_hasta(client, db_session):
    """Issue #1349 (R2-002): "todo endpoint que devuelve `MembresiaResponseDTO`
    pasa por `_con_cubierto_hasta` o `_recien_creada_sin_cobertura`" vivía
    solo en un comentario. Este test itera las rutas REALES del router
    (nunca una lista copiada a mano) y las compara contra el registro de
    llamadas de abajo -- si el router agrega o quita una ruta que expone el
    DTO, el test falla pidiendo actualizar el registro, en vez de quedar
    afuera en silencio."""
    persona_para_mutar = crear_persona_orm(db_session, cedula_valida(940), nombres="Muta", apellidos="Ble")
    tipo_original = crear_tipo_membresia_orm(db_session)
    membresia_para_mutar = crear_membresia_orm(
        db_session, persona_para_mutar, tipo_original, EstadoMembresia.ACTIVA,
    )
    persona_para_crear = crear_persona_orm(db_session, cedula_valida(941), nombres="Alta", apellidos="Nueva")
    persona_portal = crear_persona_orm(db_session, cedula_valida(942), nombres="Portal", apellidos="Self")
    db_session.commit()
    tipo_nuevo = _crear_tipo_membresia(client)

    llamadas_por_ruta = {
        ("POST", "/membresias/"): lambda: client.post(
            "/api/v1/membresias/",
            json={
                "monto_aplicado": "35.00", "fecha_activacion": "2026-07-01T00:00:00",
                "persona_id": persona_para_crear.id, "tipo_membresia_id": tipo_original.id,
            },
        ),
        ("POST", "/membresias/propia"): lambda: _llamar_propia(client, persona_portal.id, tipo_original.id),
        ("GET", "/membresias/"): lambda: client.get("/api/v1/membresias/"),
        ("GET", "/membresias/mias"): lambda: client.get(
            f"/api/v1/membresias/mias?persona_id={persona_para_mutar.id}"
        ),
        ("GET", "/membresias/persona/{persona_id}"): lambda: client.get(
            f"/api/v1/membresias/persona/{persona_para_mutar.id}"
        ),
        ("GET", "/membresias/{membresia_id}"): lambda: client.get(
            f"/api/v1/membresias/{membresia_para_mutar.id}"
        ),
        ("POST", "/membresias/{membresia_id}/suspender"): lambda: client.post(
            f"/api/v1/membresias/{membresia_para_mutar.id}/suspender", json={"motivo": "motivo"},
        ),
        ("POST", "/membresias/{membresia_id}/reactivar"): lambda: client.post(
            f"/api/v1/membresias/{membresia_para_mutar.id}/reactivar", json={"motivo": "motivo"},
        ),
        ("POST", "/membresias/{membresia_id}/cambiar-plan"): lambda: client.post(
            f"/api/v1/membresias/{membresia_para_mutar.id}/cambiar-plan",
            json={"nuevo_tipo_membresia_id": tipo_nuevo["id"]},
        ),
    }

    rutas_del_router = {
        (metodo, route.path)
        for route in membresias_pagos_router_mod.router.routes
        for metodo in route.methods
        if _expone_membresia_response_dto(getattr(route, "response_model", None))
    }
    assert rutas_del_router == set(llamadas_por_ruta), (
        "el router agregó o quitó una ruta que expone MembresiaResponseDTO; "
        "actualizar el registro de llamadas de este test"
    )

    for (metodo, ruta), llamar in llamadas_por_ruta.items():
        respuesta = llamar()
        assert respuesta.status_code < 300, f"{metodo} {ruta}: {respuesta.text}"
        assert _cubierto_hasta_presente_en(respuesta.json()), f"{metodo} {ruta} no expone cubiertoHasta"


# --- Issue #1349 (R4-002): la mutación de suspender/reactivar/cambiar-plan
# YA ocurrió (cada servicio hace su propio commit) antes de intentar leer
# `cubierto_hasta` de vuelta; si esa lectura falla, el admin ve un 500 por
# una acción que sí surtió efecto. El id de la membresía queda en el log
# para que sea diagnosticable -- estos tres tests parchean el helper de
# lectura para que reviente y verifican que el log lo registra.
def _unico_registro_de_error(caplog, logger_name):
    """Issue #1349 (R3-002): `str(membresia.id) in caplog.text` no fija NADA
    -- con un id chico, cualquier línea capturada que contenga ese dígito
    (un número de línea de traceback, el mensaje de otro logger) satisface
    la comparación. Acá se filtra por logger y nivel, y se exige que
    `exc_info` haya quedado adjunto al registro -- lo que sí prueba que vino
    de `logger.exception` dentro del `except`, no de cualquier log ERROR
    coincidente por casualidad."""
    registros = [
        registro for registro in caplog.records
        if registro.name == logger_name and registro.levelno == logging.ERROR
    ]
    assert len(registros) == 1, (
        f"se esperaba exactamente un ERROR de {logger_name}, hubo {len(registros)}"
    )
    registro = registros[0]
    assert registro.exc_info is not None, "el ERROR no llevaba exc_info adjunto"
    return registro


def test_suspender_membresia_loguea_el_id_si_falla_el_enriquecimiento(
    client, db_session, monkeypatch, caplog,
):
    persona = crear_persona_orm(db_session, cedula_valida(950))
    tipo = crear_tipo_membresia_orm(db_session)
    membresia = crear_membresia_orm(db_session, persona, tipo, EstadoMembresia.ACTIVA)
    db_session.commit()

    def _falla(*args, **kwargs):
        raise RuntimeError("fallo simulado de enriquecimiento")

    monkeypatch.setattr(membresias_pagos_router_mod, "_con_cubierto_hasta", _falla)

    with caplog.at_level(logging.ERROR, logger="cataclub.membresias_pagos"):
        with pytest.raises(RuntimeError):
            client.post(f"/api/v1/membresias/{membresia.id}/suspender", json={"motivo": "motivo"})

    registro = _unico_registro_de_error(caplog, "cataclub.membresias_pagos")
    assert str(membresia.id) in registro.getMessage()


def test_reactivar_membresia_loguea_el_id_si_falla_el_enriquecimiento(
    client, db_session, monkeypatch, caplog,
):
    persona = crear_persona_orm(db_session, cedula_valida(951))
    tipo = crear_tipo_membresia_orm(db_session)
    membresia = crear_membresia_orm(db_session, persona, tipo, EstadoMembresia.ACTIVA)
    db_session.commit()
    client.post(f"/api/v1/membresias/{membresia.id}/suspender", json={"motivo": "motivo"})

    def _falla(*args, **kwargs):
        raise RuntimeError("fallo simulado de enriquecimiento")

    monkeypatch.setattr(membresias_pagos_router_mod, "_con_cubierto_hasta", _falla)

    with caplog.at_level(logging.ERROR, logger="cataclub.membresias_pagos"):
        with pytest.raises(RuntimeError):
            client.post(f"/api/v1/membresias/{membresia.id}/reactivar", json={"motivo": "motivo"})

    registro = _unico_registro_de_error(caplog, "cataclub.membresias_pagos")
    assert str(membresia.id) in registro.getMessage()


def test_cambiar_plan_membresia_loguea_el_id_si_falla_el_enriquecimiento(
    client, db_session, monkeypatch, caplog,
):
    persona = crear_persona_orm(db_session, cedula_valida(952))
    tipo_actual = crear_tipo_membresia_orm(db_session)
    membresia = crear_membresia_orm(db_session, persona, tipo_actual, EstadoMembresia.ACTIVA)
    db_session.commit()
    tipo_nuevo = _crear_tipo_membresia(client)

    def _falla(*args, **kwargs):
        raise RuntimeError("fallo simulado de enriquecimiento")

    monkeypatch.setattr(membresias_pagos_router_mod, "_con_cubierto_hasta", _falla)

    with caplog.at_level(logging.ERROR, logger="cataclub.membresias_pagos"):
        with pytest.raises(RuntimeError):
            client.post(
                f"/api/v1/membresias/{membresia.id}/cambiar-plan",
                json={"nuevo_tipo_membresia_id": tipo_nuevo["id"]},
            )

    registro = _unico_registro_de_error(caplog, "cataclub.membresias_pagos")
    assert str(membresia.id) in registro.getMessage()


# --- E04-RF002: gratuidad del 4to miembro familiar ---------------------------
def _crear_alumno_con_representante(client, cedula, representante_id):
    """Helper: crea un alumno cuya fecha_nacimiento da >18 años con FECHA_CONGELADA_HOY."""
    return client.post(
        "/api/v1/personas/",
        json={
            "nombres": "Alumno", "apellidos": f"Familia{cedula}", "cedula": cedula,
            "fecha_nacimiento": "2010-05-14", "telefono": "0991234567",
            "representante_id": representante_id,
        },
    ).json()


def _crear_membresia_activa(client, persona_id, tipo_membresia_id):
    """Crea una membresía y aprueba su pago. Devuelve (membresia, resp_validacion)."""
    membresia = client.post(
        "/api/v1/membresias/",
        json={
            "monto_aplicado": "35.00", "fecha_activacion": "2026-07-01T00:00:00",
            "persona_id": persona_id, "tipo_membresia_id": tipo_membresia_id,
        },
    ).json()
    pago = client.post(
        "/api/v1/membresias/pagos",
        json={
            "meses": 1, "tipo_pago": "EFECTIVO",
            "fecha_inicio": "2026-07-01", "fecha_fin": "2026-07-31",
            "persona_id": persona_id, "membresia_id": membresia["id"],
        },
    ).json()
    resp = client.patch(f"/api/v1/membresias/pagos/{pago['id']}/validar", json={"estado_pago": "APROBADO"})
    return membresia, resp


def test_e04_rf002_primera_membresia_familiar_sin_gratuidad(client):
    """1er miembro de la familia: precio normal, sin gratuidad."""
    from decimal import Decimal

    representante = _crear_persona(client, cedula=cedula_valida(400))
    alumno = _crear_alumno_con_representante(client, cedula_valida(401), representante["id"])
    tipo = _crear_tipo_membresia(client)
    membresia, resp = _crear_membresia_activa(client, alumno["id"], tipo["id"])
    assert resp.status_code == 200
    membresia_actualizada = client.get(f"/api/v1/membresias/{membresia['id']}").json()
    assert membresia_actualizada["estado"] == "ACTIVA"
    # 1er miembro: sin gratuidad, precio completo
    assert Decimal(membresia_actualizada["montoAplicado"]) == Decimal("35.00")
    assert membresia_actualizada["esGratuidadFamiliar"] is False


def test_e04_rf002_cuarta_membresia_familiar_con_gratuidad(client):
    """4to miembro de la familia (mismo representante, mismo periodo):
    E04-RF002 debe marcar `esGratuidadFamiliar = True` SIN zerear
    `montoAplicado` (issue #400, slice 4c-b) -- la membresía conserva su
    tarifa real, resuelta server-side del catálogo; la bandera es la única
    señal de que este socio no paga (ver `PagoServicio.registrar_pago`,
    que gatea el cobro por la bandera y nunca por el precio)."""
    from decimal import Decimal

    representante = _crear_persona(client, cedula=cedula_valida(410))
    tipo = _crear_tipo_membresia(client)

    # Crear 3 membresías aprobadas (familia con 3 miembros activos)
    for i in range(3):
        alumno = _crear_alumno_con_representante(client, cedula_valida(411 + i), representante["id"])
        _, resp = _crear_membresia_activa(client, alumno["id"], tipo["id"])
        assert resp.status_code == 200

    # 4ta membresía: debe recibir gratuidad familiar
    alumno_4 = _crear_alumno_con_representante(client, cedula_valida(414), representante["id"])
    membresia_4, resp = _crear_membresia_activa(client, alumno_4["id"], tipo["id"])
    assert resp.status_code == 200
    membresia_4_actualizada = client.get(f"/api/v1/membresias/{membresia_4['id']}").json()
    assert membresia_4_actualizada["estado"] == "ACTIVA"
    # La 4ta membresía CONSERVA su tarifa real: la gratuidad ya no la zerea.
    assert Decimal(membresia_4_actualizada["montoAplicado"]) == Decimal("35.00")
    assert membresia_4_actualizada["esGratuidadFamiliar"] is True


def test_e04_rf002_tercera_membresia_familiar_sin_gratuidad(client):
    """3er miembro de la familia: precio normal, aún no alcanza el umbral de 4."""
    from decimal import Decimal

    representante = _crear_persona(client, cedula=cedula_valida(420))
    tipo = _crear_tipo_membresia(client)

    # Crear 2 membresías activas primero
    for i in range(2):
        alumno = _crear_alumno_con_representante(client, cedula_valida(421 + i), representante["id"])
        _crear_membresia_activa(client, alumno["id"], tipo["id"])

    # 3ra membresía: NO debe tener gratuidad (umbral es 4, no 3)
    alumno_3 = _crear_alumno_con_representante(client, cedula_valida(423), representante["id"])
    membresia_3, resp = _crear_membresia_activa(client, alumno_3["id"], tipo["id"])
    assert resp.status_code == 200
    membresia_3_actualizada = client.get(f"/api/v1/membresias/{membresia_3['id']}").json()
    assert membresia_3_actualizada["estado"] == "ACTIVA"
    # La 3ra membresía NO debe tener gratuidad
    assert Decimal(membresia_3_actualizada["montoAplicado"]) == Decimal("35.00")
    assert membresia_3_actualizada["esGratuidadFamiliar"] is False


# --- GET /membresias/{membresia_id} authorization -----------------------------
def test_obtener_membresia_owner_puede_acceder(client):
    """El dueño de la membresía puede consultarla."""
    persona = _crear_persona(client)
    tipo = _crear_tipo_membresia(client)
    membresia = client.post(
        "/api/v1/membresias/",
        json={
            "monto_aplicado": "35.00", "fecha_activacion": "2026-07-01T00:00:00",
            "persona_id": persona["id"], "tipo_membresia_id": tipo["id"],
        },
    ).json()

    from main import app
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": "owner@cataclub.test", "persona_id": persona["id"], "roles": ["ALUMNO"],
    }
    resp = client.get(f"/api/v1/membresias/{membresia['id']}")
    assert resp.status_code == 200
    assert resp.json()["id"] == membresia["id"]
    assert resp.json()["esGratuidadFamiliar"] is False


def test_obtener_membresia_representante_puede_acceder(client_sin_permisos, client):
    """El representante del dueño puede consultar la membresía."""
    representante = _crear_persona(client, cedula=cedula_valida(440))
    alumno = client.post(
        "/api/v1/personas/",
        json={
            "nombres": "Hijo", "apellidos": "Representado", "cedula": cedula_valida(441),
            "fecha_nacimiento": "2015-05-14", "telefono": "0991234567",
            "representante_id": representante["id"],
        },
    ).json()
    tipo = _crear_tipo_membresia(client)
    membresia = client.post(
        "/api/v1/membresias/",
        json={
            "monto_aplicado": "35.00", "fecha_activacion": "2026-07-01T00:00:00",
            "persona_id": alumno["id"], "tipo_membresia_id": tipo["id"],
        },
    ).json()

    from main import app
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": "representante@cataclub.test", "persona_id": representante["id"], "roles": ["ALUMNO"],
    }
    resp = client_sin_permisos.get(f"/api/v1/membresias/{membresia['id']}")
    assert resp.status_code == 200
    assert resp.json()["id"] == membresia["id"]


def test_obtener_membresia_admin_puede_acceder(client_sin_permisos, client):
    """Un administrador puede consultar cualquier membresía."""
    persona = _crear_persona(client, cedula=cedula_valida(442))
    tipo = _crear_tipo_membresia(client)
    membresia = client.post(
        "/api/v1/membresias/",
        json={
            "monto_aplicado": "35.00", "fecha_activacion": "2026-07-01T00:00:00",
            "persona_id": persona["id"], "tipo_membresia_id": tipo["id"],
        },
    ).json()

    from main import app
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": "admin@cataclub.test", "persona_id": 9999, "roles": ["ADMINISTRADOR"],
    }
    resp = client_sin_permisos.get(f"/api/v1/membresias/{membresia['id']}")
    assert resp.status_code == 200
    assert resp.json()["id"] == membresia["id"]


def test_obtener_membresia_stranger_no_puede_acceder(client_sin_permisos, client):
    """Un usuario sin vínculo no puede consultar una membresía ajena (403)."""
    persona = _crear_persona(client, cedula=cedula_valida(443))
    tipo = _crear_tipo_membresia(client)
    membresia = client.post(
        "/api/v1/membresias/",
        json={
            "monto_aplicado": "35.00", "fecha_activacion": "2026-07-01T00:00:00",
            "persona_id": persona["id"], "tipo_membresia_id": tipo["id"],
        },
    ).json()

    # "extraña" persona con id=9998
    otra_persona = _crear_persona(client, cedula=cedula_valida(444))

    from main import app
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": "stranger@cataclub.test", "persona_id": otra_persona["id"], "roles": ["ALUMNO"],
    }
    resp = client_sin_permisos.get(f"/api/v1/membresias/{membresia['id']}")
    assert resp.status_code == 403
    # El mensaje de error no debe filtrar el id de la membresia
    assert str(membresia["id"]) not in resp.json()["detail"]


def test_retirada_bloquea_aprobacion_y_pago_nuevo_pero_permite_rechazo(client, db_session):
    persona = _crear_persona(client, cedula=cedula_valida(445))
    tipo = _crear_tipo_membresia(client)
    membresia = client.post("/api/v1/membresias/", json={
        "monto_aplicado": "35.00", "fecha_activacion": "2026-07-01T00:00:00",
        "persona_id": persona["id"], "tipo_membresia_id": tipo["id"],
    }).json()
    pago = client.post("/api/v1/membresias/pagos", json={
        "meses": 1, "tipo_pago": "EFECTIVO", "persona_id": persona["id"],
        "membresia_id": membresia["id"],
    }).json()
    db_session.get(Persona, persona["id"]).activo = False
    db_session.commit()

    aprobado = client.patch(f"/api/v1/membresias/pagos/{pago['id']}/validar", json={"estado_pago": "APROBADO"})
    rechazado = client.patch(f"/api/v1/membresias/pagos/{pago['id']}/validar", json={
        "estado_pago": "RECHAZADO", "motivo_rechazo": "Retiro confirmado",
    })
    nuevo = client.post("/api/v1/membresias/pagos", json={
        "meses": 1, "tipo_pago": "EFECTIVO", "persona_id": persona["id"],
        "membresia_id": membresia["id"],
    })

    assert aprobado.status_code == 400
    assert rechazado.status_code == 200
    assert rechazado.json()["estadoPago"] == "RECHAZADO"
    assert nuevo.status_code == 400


def test_retirada_tiene_deuda_individual_y_bulk_en_cero(client, db_session):
    persona = _crear_persona(client, cedula=cedula_valida(446))
    tipo = _crear_tipo_membresia(client)
    membresia = client.post("/api/v1/membresias/", json={
        "monto_aplicado": "35.00", "fecha_activacion": "2026-07-01T00:00:00",
        "persona_id": persona["id"], "tipo_membresia_id": tipo["id"],
    }).json()
    pago = client.post("/api/v1/membresias/pagos", json={
        "meses": 1, "tipo_pago": "EFECTIVO", "persona_id": persona["id"],
        "membresia_id": membresia["id"],
    }).json()
    assert client.patch(
        f"/api/v1/membresias/pagos/{pago['id']}/validar", json={"estado_pago": "APROBADO"},
    ).status_code == 200
    db_session.get(Pago, pago["id"]).fecha_fin = date(2020, 1, 1)
    db_session.get(Persona, persona["id"]).activo = False
    db_session.commit()

    individual = client.get(f"/api/v1/membresias/{membresia['id']}/deuda")
    bulk = client.get(f"/api/v1/membresias/deuda/bulk?membresia_ids={membresia['id']}")
    regularizacion = client.post(f"/api/v1/membresias/{membresia['id']}/regularizar-deuda", json={
        "monto": "35.00", "fecha_inicio": "2020-01-01", "fecha_fin": "2020-02-01", "motivo": "Cierre",
    })

    assert individual.json()["mesesAdeudados"] == 0
    assert bulk.json()[0]["mesesAdeudados"] == 0
    assert regularizacion.status_code == 400
