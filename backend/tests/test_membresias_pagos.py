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
            "categoria": "Adultos", "franja_horaria": "18:00-19:00",
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
            "monto": "35.00", "tipo_pago": "EFECTIVO",
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
            "monto": "35.00", "tipo_pago": "EFECTIVO",
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
            "monto": "35.00", "tipo_pago": "TRANSFERENCIA",
            "fecha_inicio": "2026-07-01", "fecha_fin": "2026-07-31",
            "persona_id": persona["id"], "membresia_id": membresia["id"],
        },
    ).json()
    assert pago["estadoPago"] == "PENDIENTE_VALIDACION"

    resp = client.patch(
        f"/api/v1/membresias/pagos/{pago['id']}/validar",
        json={"estado_pago": "APROBADO"},
    )
    assert resp.status_code == 200

    membresia_actualizada = client.get(f"/api/v1/membresias/{membresia['id']}").json()
    assert membresia_actualizada["estado"] == "ACTIVA"


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
            "monto": "35.00", "tipo_pago": "EFECTIVO",
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
            "monto": "35.00", "tipo_pago": "EFECTIVO",
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
            "monto": "35.00", "tipo_pago": "EFECTIVO",
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
            "monto": "35.00", "tipo_pago": "EFECTIVO", "fecha_inicio": "2026-07-01", "fecha_fin": "2026-07-31",
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
