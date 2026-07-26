from app.seguridad.gestor_auth import GestorAutenticacion


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
            "monto": "35.00", "tipo_pago": "EFECTIVO",
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
            "monto": "35.00", "tipo_pago": "EFECTIVO",
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
            "monto": "35.00", "tipo_pago": "EFECTIVO",
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
            "monto": "35.00", "tipo_pago": "EFECTIVO",
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


def test_listar_membresias_respeta_skip_y_limit(client):
    tipo = _crear_tipo_membresia(client)
    for i in range(3):
        persona = _crear_persona(client, cedula=f"171003{4200 + i}")
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
            "monto": "35.00", "tipo_pago": "EFECTIVO",
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
    representante = _crear_persona(client, cedula="1733344455")
    assert representante["id"] == 1
    alumno = client.post(
        "/api/v1/personas/",
        json={
            "nombres": "Hijo", "apellidos": "Representado", "cedula": "1744455566",
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
            "monto": "35.00", "tipo_pago": "EFECTIVO",
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
    persona = _crear_persona(client, cedula="1799999997")
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

    resp = client.get(f"/api/v1/membresias/pagos/persona/{persona['id']}")
    assert resp.status_code == 200
    assert len(resp.json()) == 1


def test_persona_sin_relacion_no_puede_ver_historial_de_pagos_ajeno(client_sin_permisos, client):
    """POST /personas/ es admin-only, así que las personas se crean con
    `client` y luego se restaura el token de `client_sin_permisos` (persona_id=1,
    rol ALUMNO) antes de la petición que se evalúa -- mismo truco que
    `test_voucher_pago.py::test_subir_voucher_sin_ser_duenio_ni_admin_da_403`.
    Relleno para que `otra_persona` no quede con id=1."""
    _crear_persona(client, cedula="1700000002")
    otra_persona = _crear_persona(client, cedula="1799999996")

    from main import app
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": "alumno@cataclub.test", "persona_id": 1, "roles": ["ALUMNO"],
    }

    resp = client_sin_permisos.get(f"/api/v1/membresias/pagos/persona/{otra_persona['id']}")
    assert resp.status_code == 403


def test_historial_de_pagos_vacio_cuando_no_hay(client):
    persona = _crear_persona(client, cedula="1755566677")

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


def test_representante_ve_membresias_de_representado(client_sin_permisos, client):
    """Esquema: se crea todo con `client` (admin) y luego se restaura el token
    de `client_sin_permisos` (persona_id=1, rol ALUMNO) para que la autorización
    dependa exclusivamente del vínculo representante_id."""
    representante = _crear_persona(client, cedula="1733344455")
    assert representante["id"] == 1
    alumno = client.post(
        "/api/v1/personas/",
        json={
            "nombres": "Hijo", "apellidos": "Representado", "cedula": "1744455566",
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
    persona = _crear_persona(client, cedula="1799999997")
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
    _crear_persona(client, cedula="1700000002")
    otra_persona = _crear_persona(client, cedula="1799999996")

    from main import app
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": "alumno@cataclub.test", "persona_id": 1, "roles": ["ALUMNO"],
    }

    resp = client_sin_permisos.get(f"/api/v1/membresias/persona/{otra_persona['id']}")
    assert resp.status_code == 403


def test_listar_membresias_por_persona_vacio_cuando_no_hay(client):
    persona = _crear_persona(client, cedula="1755566688")

    resp = client.get(f"/api/v1/membresias/persona/{persona['id']}")
    assert resp.status_code == 200
    assert resp.json() == []


# --- GET /membresias/mias (lectura derivada del JWT) ------------------------
def test_membresias_mias_aplica_matriz_de_propiedad_sin_exponer_al_extrano(client, client_sin_permisos):
    from main import app

    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": "admin@cataclub.test", "persona_id": 999, "roles": ["ADMINISTRADOR"],
    }
    representante = _crear_persona(client, cedula="1733344455")
    alumno = client.post(
        "/api/v1/personas/",
        json={
            "nombres": "Hijo", "apellidos": "Representado", "cedula": "1744455566",
            "fecha_nacimiento": "2015-05-14", "telefono": "0991234567",
            "representante_id": representante["id"],
        },
    ).json()
    ajeno = _crear_persona(client, cedula="1799999996")
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
            "monto": "35.00", "tipo_pago": "EFECTIVO",
            "fecha_inicio": "2026-07-01", "fecha_fin": "2026-07-31",
            "persona_id": persona_id, "membresia_id": membresia["id"],
        },
    ).json()
    resp = client.patch(f"/api/v1/membresias/pagos/{pago['id']}/validar", json={"estado_pago": "APROBADO"})
    return membresia, resp


def test_e04_rf002_primera_membresia_familiar_sin_gratuidad(client):
    """1er miembro de la familia: precio normal, sin gratuidad."""
    from decimal import Decimal

    representante = _crear_persona(client, cedula="1700000011")
    alumno = _crear_alumno_con_representante(client, "1700000012", representante["id"])
    tipo = _crear_tipo_membresia(client)
    membresia, resp = _crear_membresia_activa(client, alumno["id"], tipo["id"])
    assert resp.status_code == 200
    membresia_actualizada = client.get(f"/api/v1/membresias/{membresia['id']}").json()
    assert membresia_actualizada["estado"] == "ACTIVA"
    # 1er miembro: sin gratuidad, precio completo
    assert Decimal(membresia_actualizada["montoAplicado"]) == Decimal("35.00")


def test_e04_rf002_cuarta_membresia_familiar_con_gratuidad(client):
    """4to miembro de la familia (mismo representante, mismo periodo):
    monto_aplicado debe quedar en 0 por gratuidad familiar E04-RF002."""
    from decimal import Decimal

    representante = _crear_persona(client, cedula="1700000021")
    tipo = _crear_tipo_membresia(client)

    # Crear 3 membresías aprobadas (familia con 3 miembros activos)
    for i in range(3):
        alumno = _crear_alumno_con_representante(client, f"170000002{i + 2}", representante["id"])
        _, resp = _crear_membresia_activa(client, alumno["id"], tipo["id"])
        assert resp.status_code == 200

    # 4ta membresía: debe recibir gratuidad familiar
    alumno_4 = _crear_alumno_con_representante(client, "1700000025", representante["id"])
    membresia_4, resp = _crear_membresia_activa(client, alumno_4["id"], tipo["id"])
    assert resp.status_code == 200
    membresia_4_actualizada = client.get(f"/api/v1/membresias/{membresia_4['id']}").json()
    assert membresia_4_actualizada["estado"] == "ACTIVA"
    # La 4ta membresía debe tener monto 0 por gratuidad familiar E04-RF002
    assert Decimal(membresia_4_actualizada["montoAplicado"]) == Decimal("0.00")


def test_e04_rf002_tercera_membresia_familiar_sin_gratuidad(client):
    """3er miembro de la familia: precio normal, aún no alcanza el umbral de 4."""
    from decimal import Decimal

    representante = _crear_persona(client, cedula="1700000031")
    tipo = _crear_tipo_membresia(client)

    # Crear 2 membresías activas primero
    for i in range(2):
        alumno = _crear_alumno_con_representante(client, f"170000003{i + 2}", representante["id"])
        _crear_membresia_activa(client, alumno["id"], tipo["id"])

    # 3ra membresía: NO debe tener gratuidad (umbral es 4, no 3)
    alumno_3 = _crear_alumno_con_representante(client, "1700000034", representante["id"])
    membresia_3, resp = _crear_membresia_activa(client, alumno_3["id"], tipo["id"])
    assert resp.status_code == 200
    membresia_3_actualizada = client.get(f"/api/v1/membresias/{membresia_3['id']}").json()
    assert membresia_3_actualizada["estado"] == "ACTIVA"
    # La 3ra membresía NO debe tener gratuidad
    assert Decimal(membresia_3_actualizada["montoAplicado"]) == Decimal("35.00")


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


def test_obtener_membresia_representante_puede_acceder(client_sin_permisos, client):
    """El representante del dueño puede consultar la membresía."""
    representante = _crear_persona(client, cedula="1700000041")
    alumno = client.post(
        "/api/v1/personas/",
        json={
            "nombres": "Hijo", "apellidos": "Representado", "cedula": "1700000042",
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
    persona = _crear_persona(client, cedula="1700000051")
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
    persona = _crear_persona(client, cedula="1700000061")
    tipo = _crear_tipo_membresia(client)
    membresia = client.post(
        "/api/v1/membresias/",
        json={
            "monto_aplicado": "35.00", "fecha_activacion": "2026-07-01T00:00:00",
            "persona_id": persona["id"], "tipo_membresia_id": tipo["id"],
        },
    ).json()

    # "extraña" persona con id=9998
    otra_persona = _crear_persona(client, cedula="1700000062")

    from main import app
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": "stranger@cataclub.test", "persona_id": otra_persona["id"], "roles": ["ALUMNO"],
    }
    resp = client_sin_permisos.get(f"/api/v1/membresias/{membresia['id']}")
    assert resp.status_code == 403
    # El mensaje de error no debe filtrar el id de la membresia
    assert str(membresia["id"]) not in resp.json()["detail"]
