def test_crear_persona_sin_rol_administrador_da_403(client_sin_permisos):
    resp = client_sin_permisos.post(
        "/api/v1/personas/",
        json={
            "nombres": "Ana", "apellidos": "Torres", "cedula": "1710034065",
            "fecha_nacimiento": "2010-05-14", "telefono": "0991234567",
        },
    )
    assert resp.status_code == 403


def test_listar_personas_sin_rol_administrador_da_403(client_sin_permisos):
    """GET /personas/ expone PII completa (cédula, teléfono, fecha de
    nacimiento, beca) del roster entero: exige ADMINISTRADOR igual que las
    mutaciones, no basta con un token válido cualquiera."""
    resp = client_sin_permisos.get("/api/v1/personas/")
    assert resp.status_code == 403


def test_dashboard_stats_sin_rol_administrador_da_403(client_sin_permisos):
    """GET /dashboard/stats expone estadísticas admin (personas, membresías,
    pagos pendientes) del club entero: exige ADMINISTRADOR."""
    resp = client_sin_permisos.get("/api/v1/dashboard/stats")
    assert resp.status_code == 403
