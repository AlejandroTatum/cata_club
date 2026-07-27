"""Tests de los reportes agregados: asistencia por horario/periodo/alumno
(E02-RF005), alumnos nuevos por periodo (E04-RF014), y exportación a PDF de
los reportes de periodo y asistencia (report-pdf-export). El reporte de
personas por etiquetas fue removido upstream (#131) junto con
`prioridad_municipal`/`porcentaje_beca`, así que su export PDF nunca llegó
a existir en `main`."""

from app.infraestructura.generador_pdf import generar_reporte_pdf


def _crear_persona(client, cedula):
    return client.post(
        "/api/v1/personas/",
        json={
            "nombres": "Test", "apellidos": cedula, "cedula": cedula,
            "fecha_nacimiento": "2000-05-14", "telefono": "0991234567",
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


def _crear_pago(client, cedula, estado_pago=None, monto="35.00"):
    """Crea persona + tipo de membresía + membresía + pago (flujo reutilizado
    de test_membresias_pagos.py). Si `estado_pago` se pasa, valida el pago
    con ese estado tras crearlo."""
    persona = _crear_persona(client, cedula)
    tipo = _crear_tipo_membresia(client)
    membresia = client.post(
        "/api/v1/membresias/",
        json={
            "monto_aplicado": monto, "fecha_activacion": "2026-07-01T00:00:00",
            "persona_id": persona["id"], "tipo_membresia_id": tipo["id"],
        },
    ).json()
    pago = client.post(
        "/api/v1/membresias/pagos",
        json={
            "monto": monto, "tipo_pago": "TRANSFERENCIA",
            "fecha_inicio": "2026-07-01", "fecha_fin": "2026-07-31",
            "persona_id": persona["id"], "membresia_id": membresia["id"],
        },
    ).json()
    if estado_pago is not None:
        client.patch(
            f"/api/v1/membresias/pagos/{pago['id']}/validar",
            json={"estado_pago": estado_pago},
        )
    return pago


def test_reporte_asistencia_requiere_admin_o_entrenador(client_sin_permisos):
    resp = client_sin_permisos.get("/api/v1/asistencias/reportes")
    assert resp.status_code == 403


def test_reporte_asistencia_filtra_por_horario_y_periodo(client):
    entrenador = _crear_persona(client, "1751515151")
    alumno = _crear_persona(client, "1751515152")
    client.post("/api/v1/auth/registro", json={
        "cedula": entrenador["cedula"], "correo": "ent@x.com", "contrasenia": "password123",
    })
    client.post(f"/api/v1/personas/{entrenador['id']}/roles", json={"tipo_rol": "ENTRENADOR"})

    horario = client.post(
        "/api/v1/asistencias/horarios",
        json={"categoria": "FORMATIVO", "dia_semana": "LUNES", "entrenador_id": entrenador["id"]},
    ).json()
    client.post(
        "/api/v1/asistencias/asignar-alumno",
        json={"persona_id": alumno["id"], "horario_id": horario["id"]},
    )

    client.post(
        "/api/v1/asistencias/",
        json={
            "fecha_entrenamiento": "2026-07-06", "estado": "PRESENTE",
            "persona_id": alumno["id"], "entrenador_id": entrenador["id"], "horario_id": horario["id"],
        },
    )
    client.post(
        "/api/v1/asistencias/",
        json={
            "fecha_entrenamiento": "2026-08-06", "estado": "AUSENTE",
            "persona_id": alumno["id"], "entrenador_id": entrenador["id"], "horario_id": horario["id"],
        },
    )

    resp = client.get(
        "/api/v1/asistencias/reportes",
        params={"horario_id": horario["id"], "fecha_inicio": "2026-07-01", "fecha_fin": "2026-07-31"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["estado"] == "PRESENTE"


def test_reporte_alumnos_nuevos_por_periodo(client):
    _crear_persona(client, "1761616161")
    resp = client.get(
        "/api/v1/personas/reportes/nuevos-por-periodo",
        params={"fecha_inicio": "2026-01-01", "fecha_fin": "2026-12-31"},
    )
    assert resp.status_code == 200
    assert len(resp.json()) >= 1


def test_reporte_alumnos_nuevos_por_periodo_requiere_admin(client_sin_permisos):
    resp = client_sin_permisos.get(
        "/api/v1/personas/reportes/nuevos-por-periodo",
        params={"fecha_inicio": "2026-01-01", "fecha_fin": "2026-12-31"},
    )
    assert resp.status_code == 403


# --- Phase 1: generar_reporte_pdf (unit) ------------------------------------

def test_generar_reporte_pdf_produce_bytes_pdf_validos():
    pdf_bytes = generar_reporte_pdf(
        titulo="Reporte de prueba",
        columnas=["Nombre", "Cédula"],
        filas=[["Juan Pérez", "1710034065"]],
    )
    assert isinstance(pdf_bytes, bytes)
    assert pdf_bytes[:4] == b"%PDF"


def test_generar_reporte_pdf_una_pagina_con_7_filas():
    filas = [[f"Persona {i}", f"{i:010d}"] for i in range(7)]
    pdf_bytes = generar_reporte_pdf(
        titulo="Reporte de 7 filas", columnas=["Nombre", "Cédula"], filas=filas,
    )
    assert pdf_bytes[:4] == b"%PDF"
    assert len(pdf_bytes) > 0


def test_generar_reporte_pdf_pagina_multiple_con_25_filas():
    filas_pocas = [[f"Persona {i}", f"{i:010d}"] for i in range(7)]
    filas_muchas = [[f"Persona {i}", f"{i:010d}"] for i in range(25)]
    pdf_pocas = generar_reporte_pdf(
        titulo="Reporte", columnas=["Nombre", "Cédula"], filas=filas_pocas,
    )
    pdf_muchas = generar_reporte_pdf(
        titulo="Reporte", columnas=["Nombre", "Cédula"], filas=filas_muchas,
    )
    assert pdf_muchas[:4] == b"%PDF"
    # Sanity de paginación: 25 filas (3 páginas de contenido) deben producir
    # un PDF sustancialmente más grande que uno de 7 filas (1 página).
    assert len(pdf_muchas) > len(pdf_pocas)


def test_generar_reporte_pdf_filas_vacias_no_lanza():
    pdf_bytes = generar_reporte_pdf(
        titulo="Reporte sin resultados", columnas=["Nombre", "Cédula"], filas=[],
    )
    assert pdf_bytes[:4] == b"%PDF"
    assert len(pdf_bytes) > 0


# --- Phase 2: endpoints PDF (integración) ------------------------------------

def test_reporte_periodo_pdf_sin_token_da_401(client_sin_token):
    resp = client_sin_token.get(
        "/api/v1/personas/reportes/nuevos-por-periodo/pdf",
        params={"fecha_inicio": "2026-01-01", "fecha_fin": "2026-12-31"},
    )
    assert resp.status_code == 401


def test_reporte_asistencia_pdf_sin_token_da_401(client_sin_token):
    assert client_sin_token.get("/api/v1/asistencias/reportes/pdf").status_code == 401


def test_reporte_periodo_pdf_requiere_admin(client_sin_permisos):
    resp = client_sin_permisos.get(
        "/api/v1/personas/reportes/nuevos-por-periodo/pdf",
        params={"fecha_inicio": "2026-01-01", "fecha_fin": "2026-12-31"},
    )
    assert resp.status_code == 403


def test_reporte_asistencia_pdf_requiere_admin(client_sin_permisos):
    resp = client_sin_permisos.get("/api/v1/asistencias/reportes/pdf")
    assert resp.status_code == 403


def test_reporte_asistencia_pdf_rechaza_entrenador(client_entrenador):
    """Regresión: el export PDF de asistencia es MÁS estricto que su hermano
    JSON -- ENTRENADOR puede ver el JSON pero NO exportar el PDF."""
    resp = client_entrenador.get("/api/v1/asistencias/reportes/pdf")
    assert resp.status_code == 403


def test_reporte_asistencia_json_permite_entrenador_como_control(client_entrenador):
    """Control: confirma que el endpoint JSON (sin tocar) sigue permitiendo
    ENTRENADOR -- contraste directo con el 403 del PDF de arriba."""
    resp = client_entrenador.get("/api/v1/asistencias/reportes")
    assert resp.status_code == 200


def test_reporte_periodo_pdf_admin_200(client):
    _crear_persona(client, "1781818181")
    resp = client.get(
        "/api/v1/personas/reportes/nuevos-por-periodo/pdf",
        params={"fecha_inicio": "2026-01-01", "fecha_fin": "2026-12-31"},
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert len(resp.content) > 0
    disposition = resp.headers["content-disposition"]
    assert "reporte-periodo_" in disposition


def test_reporte_periodo_pdf_422_fechas_invertidas(client):
    resp = client.get(
        "/api/v1/personas/reportes/nuevos-por-periodo/pdf",
        params={"fecha_inicio": "2026-12-31", "fecha_fin": "2026-01-01"},
    )
    assert resp.status_code == 422


def test_reporte_asistencia_pdf_admin_200(client):
    entrenador = _crear_persona(client, "1791919191")
    alumno = _crear_persona(client, "1792929292")
    client.post("/api/v1/auth/registro", json={
        "cedula": entrenador["cedula"], "correo": "ent2@x.com", "contrasenia": "password123",
    })
    client.post(f"/api/v1/personas/{entrenador['id']}/roles", json={"tipo_rol": "ENTRENADOR"})
    horario = client.post(
        "/api/v1/asistencias/horarios",
        json={"categoria": "FORMATIVO", "dia_semana": "LUNES", "entrenador_id": entrenador["id"]},
    ).json()
    client.post(
        "/api/v1/asistencias/",
        json={
            "fecha_entrenamiento": "2026-07-06", "estado": "PRESENTE",
            "persona_id": alumno["id"], "entrenador_id": entrenador["id"], "horario_id": horario["id"],
        },
    )

    resp = client.get("/api/v1/asistencias/reportes/pdf")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert len(resp.content) > 0
    disposition = resp.headers["content-disposition"]
    assert "reporte-asistencia_" in disposition


# --- Phase 5: regresión -- offload de `generar_reporte_pdf` fuera del ------
# event loop. Los 3 handlers son `async def` pero `generar_reporte_pdf` es
# CPU-bound (ReportLab). Sin `run_in_threadpool`, la generación corre inline
# en el event loop y bloquea al único worker uvicorn (ver
# `generar_comprobante_pago_pdf`, que por la misma razón se ejecuta en una
# tarea Celery, nunca inline en un handler). Estas pruebas confirman que cada
# endpoint delega la llamada al threadpool en vez de invocarla directamente.
def test_reporte_periodo_pdf_usa_threadpool(client, monkeypatch):
    import app.presentacion.routers.personas_router as router_mod

    llamadas = []
    original = router_mod.run_in_threadpool

    async def _run_in_threadpool_espia(func, *args, **kwargs):
        llamadas.append(func)
        return await original(func, *args, **kwargs)

    monkeypatch.setattr(router_mod, "run_in_threadpool", _run_in_threadpool_espia)

    resp = client.get(
        "/api/v1/personas/reportes/nuevos-por-periodo/pdf",
        params={"fecha_inicio": "2026-01-01", "fecha_fin": "2026-12-31"},
    )
    assert resp.status_code == 200
    assert llamadas == [generar_reporte_pdf]


def test_reporte_asistencia_pdf_usa_threadpool(client, monkeypatch):
    import app.presentacion.routers.asistencias_router as router_mod

    llamadas = []
    original = router_mod.run_in_threadpool

    async def _run_in_threadpool_espia(func, *args, **kwargs):
        llamadas.append(func)
        return await original(func, *args, **kwargs)

    monkeypatch.setattr(router_mod, "run_in_threadpool", _run_in_threadpool_espia)

    resp = client.get("/api/v1/asistencias/reportes/pdf")
    assert resp.status_code == 200
    assert llamadas == [generar_reporte_pdf]


# --- Reporte de pagos (E04-RF014-style, GET /membresias/pagos/reportes) -----

def test_reporte_pagos_requiere_admin(client_sin_permisos):
    resp = client_sin_permisos.get("/api/v1/membresias/pagos/reportes")
    assert resp.status_code == 403


def test_reporte_pagos_filtra_por_estado(client):
    _crear_pago(client, "1801010101", estado_pago="APROBADO")
    _crear_pago(client, "1801010102", estado_pago="RECHAZADO")

    resp = client.get("/api/v1/membresias/pagos/reportes", params={"estado_pago": "APROBADO"})
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["estadoPago"] == "APROBADO"


def test_reporte_pagos_filtra_por_periodo(client):
    _crear_pago(client, "1801010103")

    resp = client.get(
        "/api/v1/membresias/pagos/reportes",
        params={"fecha_inicio": "2026-01-01", "fecha_fin": "2026-12-31"},
    )
    assert resp.status_code == 200
    assert len(resp.json()) >= 1

    resp_fuera_de_rango = client.get(
        "/api/v1/membresias/pagos/reportes",
        params={"fecha_inicio": "2020-01-01", "fecha_fin": "2020-12-31"},
    )
    assert resp_fuera_de_rango.status_code == 200
    assert resp_fuera_de_rango.json() == []


def test_reporte_pagos_422_fechas_invertidas(client):
    resp = client.get(
        "/api/v1/membresias/pagos/reportes",
        params={"fecha_inicio": "2026-12-31", "fecha_fin": "2026-01-01"},
    )
    assert resp.status_code == 422


def test_reporte_pagos_pdf_sin_token_da_401(client_sin_token):
    resp = client_sin_token.get("/api/v1/membresias/pagos/reportes/pdf")
    assert resp.status_code == 401


def test_reporte_pagos_pdf_requiere_admin(client_sin_permisos):
    resp = client_sin_permisos.get("/api/v1/membresias/pagos/reportes/pdf")
    assert resp.status_code == 403


def test_reporte_pagos_pdf_admin_200(client):
    _crear_pago(client, "1801010104", estado_pago="APROBADO")

    resp = client.get("/api/v1/membresias/pagos/reportes/pdf")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert resp.content[:4] == b"%PDF"
    disposition = resp.headers["content-disposition"]
    assert "reporte-pagos_" in disposition


def test_reporte_pagos_pdf_422_fechas_invertidas(client):
    resp = client.get(
        "/api/v1/membresias/pagos/reportes/pdf",
        params={"fecha_inicio": "2026-12-31", "fecha_fin": "2026-01-01"},
    )
    assert resp.status_code == 422


def test_reporte_pagos_pdf_usa_threadpool(client, monkeypatch):
    import app.presentacion.routers.membresias_pagos_router as router_mod

    llamadas = []
    original = router_mod.run_in_threadpool

    async def _run_in_threadpool_espia(func, *args, **kwargs):
        llamadas.append(func)
        return await original(func, *args, **kwargs)

    monkeypatch.setattr(router_mod, "run_in_threadpool", _run_in_threadpool_espia)

    resp = client.get("/api/v1/membresias/pagos/reportes/pdf")
    assert resp.status_code == 200
    assert llamadas == [generar_reporte_pdf]
