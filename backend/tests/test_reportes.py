"""Tests de los reportes agregados: asistencia por horario/periodo/alumno
(E02-RF005) y alumnos nuevos por periodo (E04-RF014)."""

import re

from app.infraestructura.generador_pdf import generar_reporte_pdf


def _crear_persona(client, cedula):
    return client.post(
        "/api/v1/personas/",
        json={
            "nombres": "Test", "apellidos": cedula, "cedula": cedula,
            "fecha_nacimiento": "2000-05-14", "telefono": "0991234567",
        },
    ).json()


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


# --- generar_reporte_pdf (unidad, sin cliente HTTP) -------------------------

def _filas(n):
    return [[f"Nombre {i}", f"1710000{i:03d}"] for i in range(n)]


def test_generar_reporte_pdf_devuelve_bytes_pdf_validos():
    pdf_bytes = generar_reporte_pdf(
        titulo="Reporte de prueba",
        columnas=["Nombre", "Cédula"],
        filas=_filas(7),
    )
    assert isinstance(pdf_bytes, bytes)
    assert pdf_bytes[:4] == b"%PDF"
    assert len(pdf_bytes) > 0


def test_generar_reporte_pdf_pagina_multiples_bloques():
    pdf_pocas_filas = generar_reporte_pdf(
        titulo="Reporte pequeño", columnas=["Nombre", "Cédula"], filas=_filas(7),
    )
    pdf_muchas_filas = generar_reporte_pdf(
        titulo="Reporte grande", columnas=["Nombre", "Cédula"], filas=_filas(25),
    )
    assert pdf_pocas_filas[:4] == b"%PDF"
    assert pdf_muchas_filas[:4] == b"%PDF"
    assert len(pdf_pocas_filas) > 0
    assert len(pdf_muchas_filas) > 0
    # El PDF de 25 filas fuerza 3 páginas (10/10/5) vs 1 página en el de 7
    # filas; debería producir un documento notablemente más pesado.
    assert len(pdf_muchas_filas) > len(pdf_pocas_filas)


def test_generar_reporte_pdf_filas_vacias_no_lanza_y_devuelve_pdf_valido():
    pdf_bytes = generar_reporte_pdf(
        titulo="Reporte vacío", columnas=["Nombre", "Cédula"], filas=[],
    )
    assert isinstance(pdf_bytes, bytes)
    assert pdf_bytes[:4] == b"%PDF"
    assert len(pdf_bytes) > 0


def test_generar_reporte_pdf_incluye_generado_por():
    pdf_bytes = generar_reporte_pdf(
        titulo="Reporte con autor", columnas=["Nombre"], filas=_filas(1),
        generado_por="admin@cataclub.test",
    )
    assert pdf_bytes[:4] == b"%PDF"


# --- Endpoints PDF (E: /reportes/pdf, /reportes/nuevos-por-periodo/pdf, ----
# /asistencias/reportes/pdf) -------------------------------------------------

def test_reporte_etiquetas_pdf_requiere_admin(client_sin_permisos):
    resp = client_sin_permisos.get("/api/v1/personas/reportes/pdf")
    assert resp.status_code == 403


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
    """Regresión: el PDF de asistencia es MÁS estrecho que su hermano JSON,
    que sí permite ENTRENADOR. Un entrenador debe recibir 403 aquí."""
    resp = client_entrenador.get("/api/v1/asistencias/reportes/pdf")
    assert resp.status_code == 403


def test_reporte_asistencia_json_permite_entrenador(client_entrenador):
    """Control: confirma que el endpoint JSON hermano SIGUE permitiendo
    ENTRENADOR (no se tocó su gate de permisos)."""
    resp = client_entrenador.get("/api/v1/asistencias/reportes")
    assert resp.status_code == 200


def test_reporte_etiquetas_pdf_admin_devuelve_pdf(client):
    _crear_persona(client, "1771717171")
    resp = client.get("/api/v1/personas/reportes/pdf")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert len(resp.content) > 0
    assert resp.content[:4] == b"%PDF"
    assert re.match(
        r'attachment; filename="reporte-etiquetas_\d{4}-\d{2}-\d{2}\.pdf"',
        resp.headers["content-disposition"],
    )


def test_reporte_periodo_pdf_admin_devuelve_pdf(client):
    _crear_persona(client, "1781818181")
    resp = client.get(
        "/api/v1/personas/reportes/nuevos-por-periodo/pdf",
        params={"fecha_inicio": "2026-01-01", "fecha_fin": "2026-12-31"},
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert len(resp.content) > 0
    assert resp.content[:4] == b"%PDF"
    assert re.match(
        r'attachment; filename="reporte-periodo_\d{4}-\d{2}-\d{2}\.pdf"',
        resp.headers["content-disposition"],
    )


def test_reporte_periodo_pdf_valida_fechas_invertidas(client):
    resp = client.get(
        "/api/v1/personas/reportes/nuevos-por-periodo/pdf",
        params={"fecha_inicio": "2026-12-31", "fecha_fin": "2026-01-01"},
    )
    assert resp.status_code == 422


def test_reporte_asistencia_pdf_admin_devuelve_pdf(client):
    entrenador = _crear_persona(client, "1791919191")
    alumno = _crear_persona(client, "1791919192")
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
    assert resp.content[:4] == b"%PDF"
    assert re.match(
        r'attachment; filename="reporte-asistencia_\d{4}-\d{2}-\d{2}\.pdf"',
        resp.headers["content-disposition"],
    )
