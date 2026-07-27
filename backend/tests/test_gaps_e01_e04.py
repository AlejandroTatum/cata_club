"""
Tests de los gaps reales identificados en E01/E04 frente al backend
existente: asignación de roles, recuperación de contraseña, antecedentes
de club (mano dominante), estado de cuenta, y solo-lectura financiera
para menores.
"""
import pytest
from app.seguridad.gestor_auth import GestorAutenticacion


def _crear_persona(client, cedula, fecha_nacimiento="2000-05-14", representante_id=None):
    payload = {
        "nombres": "Test", "apellidos": cedula, "cedula": cedula,
        "fecha_nacimiento": fecha_nacimiento, "telefono": "0991234567",
    }
    if representante_id:
        payload["representante_id"] = representante_id
    return client.post("/api/v1/personas/", json=payload).json()


def _registrar_credenciales(client, cedula, correo, contrasenia="password123"):
    return client.post(
        "/api/v1/auth/registro",
        json={"cedula": cedula, "correo": correo, "contrasenia": contrasenia},
    )


# --- Roles (gap crítico E01-RF004/005/006/007) ------------------------------
def test_asignar_rol_requiere_admin(client_sin_permisos):
    resp = client_sin_permisos.post("/api/v1/personas/1/roles", json={"tipo_rol": "ENTRENADOR"})
    assert resp.status_code == 403


def test_asignar_rol_falla_sin_credenciales_registradas(client):
    persona = _crear_persona(client, "1711111111")
    resp = client.post(f"/api/v1/personas/{persona['id']}/roles", json={"tipo_rol": "ENTRENADOR"})
    assert resp.status_code == 400


def test_asignar_y_quitar_rol(client):
    persona = _crear_persona(client, "1722222222")
    _registrar_credenciales(client, persona["cedula"], "u1@x.com")

    resp = client.post(f"/api/v1/personas/{persona['id']}/roles", json={"tipo_rol": "ENTRENADOR"})
    assert resp.status_code == 201
    assert resp.json()["roles"] == ["ENTRENADOR"]

    resp = client.post(f"/api/v1/personas/{persona['id']}/roles", json={"tipo_rol": "ENTRENADOR"})
    assert resp.status_code == 400  # ya lo tiene

    resp = client.delete(f"/api/v1/personas/{persona['id']}/roles/ENTRENADOR")
    assert resp.status_code == 200
    assert resp.json()["roles"] == []


def test_obtener_roles_requiere_admin(client_sin_permisos):
    resp = client_sin_permisos.get("/api/v1/personas/1/roles")
    assert resp.status_code == 403


def test_obtener_roles_refleja_estado_actual_sin_mutar(client):
    persona = _crear_persona(client, "1740000004")
    _registrar_credenciales(client, persona["cedula"], "u_roles@x.com")

    # Sin roles asignados todavía: el GET debe reflejar eso, no un 404 ni un error.
    resp = client.get(f"/api/v1/personas/{persona['id']}/roles")
    assert resp.status_code == 200
    assert resp.json()["roles"] == []
    assert resp.json()["activo"] is True

    client.post(f"/api/v1/personas/{persona['id']}/roles", json={"tipo_rol": "ENTRENADOR"})
    client.post(f"/api/v1/personas/{persona['id']}/roles", json={"tipo_rol": "ALUMNO"})
    client.patch(f"/api/v1/personas/{persona['id']}/cuenta/estado", json={"activo": False})

    resp = client.get(f"/api/v1/personas/{persona['id']}/roles")
    assert resp.status_code == 200
    assert sorted(resp.json()["roles"]) == ["ALUMNO", "ENTRENADOR"]
    assert resp.json()["activo"] is False

    # Confirma que el GET no mutó nada: una segunda lectura da lo mismo.
    resp = client.get(f"/api/v1/personas/{persona['id']}/roles")
    assert sorted(resp.json()["roles"]) == ["ALUMNO", "ENTRENADOR"]
    assert resp.json()["activo"] is False


def test_login_real_funciona_tras_asignar_rol(client):
    """Antes de este fix, un Usuario nunca podía obtener ningún rol -> nunca
    pasaba GestorPermisos. Prueba end-to-end de que ahora sí funciona."""
    persona = _crear_persona(client, "1733333333")
    _registrar_credenciales(client, persona["cedula"], "u2@x.com")
    client.post(f"/api/v1/personas/{persona['id']}/roles", json={"tipo_rol": "ADMINISTRADOR"})

    resp = client.post(
        "/api/v1/auth/login", data={"username": "u2@x.com", "password": "password123"}
    )
    assert resp.status_code == 200
    token = resp.json()["access_token"]
    import jwt
    from app.soporte_transversal.configuracion import settings
    payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algoritmo])
    assert payload["roles"] == ["ADMINISTRADOR"]


def test_alumno_se_asigna_automaticamente_al_matricularse(client):
    """Asignación perezosa: al crear la primera Membresia de una persona con
    credenciales ya registradas, se le otorga ALUMNO automáticamente."""
    persona = _crear_persona(client, "1744444444")
    _registrar_credenciales(client, persona["cedula"], "u3@x.com")

    tipo = client.post(
        "/api/v1/membresias/tipos",
        json={"categoria": "adulto", "franja_horaria": "mañana", "modalidad": "MENSUAL", "precio": "35.00"},
    ).json()
    client.post(
        "/api/v1/membresias/",
        json={
            "monto_aplicado": "35.00", "persona_id": persona["id"], "tipo_membresia_id": tipo["id"],
        },
    )

    resp = client.post(
        "/api/v1/auth/login", data={"username": "u3@x.com", "password": "password123"}
    )
    import jwt
    from app.soporte_transversal.configuracion import settings
    payload = jwt.decode(resp.json()["access_token"], settings.jwt_secret_key, algorithms=[settings.jwt_algoritmo])
    assert "ALUMNO" in payload["roles"]


# --- Estado de cuenta (E01-RF013) --------------------------------------------
def test_cuenta_desactivada_no_puede_loguearse(client):
    persona = _crear_persona(client, "1755555555")
    _registrar_credenciales(client, persona["cedula"], "u4@x.com")

    resp = client.patch(f"/api/v1/personas/{persona['id']}/cuenta/estado", json={"activo": False})
    assert resp.status_code == 200
    assert resp.json()["activo"] is False

    resp = client.post(
        "/api/v1/auth/login", data={"username": "u4@x.com", "password": "password123"}
    )
    assert resp.status_code == 401


def test_cambiar_estado_cuenta_requiere_admin(client_sin_permisos):
    resp = client_sin_permisos.patch("/api/v1/personas/1/cuenta/estado", json={"activo": False})
    assert resp.status_code == 403


# --- Recuperación de contraseña (E01-RF003) ---------------------------------
def test_solicitar_recuperacion_no_revela_si_el_correo_existe(client):
    resp = client.post("/api/v1/auth/recuperar-contrasenia", json={"correo": "noexiste@x.com"})
    assert resp.status_code == 200
    assert "se envió" in resp.json()["mensaje"]


def test_restablecer_contrasenia_con_token_valido(client):
    persona = _crear_persona(client, "1766666666")
    _registrar_credenciales(client, persona["cedula"], "u5@x.com")

    token = GestorAutenticacion.crear_token_recuperacion("u5@x.com", version_contrasenia=1)
    resp = client.post(
        "/api/v1/auth/restablecer-contrasenia",
        json={"token": token, "nueva_contrasenia": "otraclave123"},
    )
    assert resp.status_code == 204

    resp = client.post(
        "/api/v1/auth/login", data={"username": "u5@x.com", "password": "otraclave123"}
    )
    assert resp.status_code == 200


def test_restablecer_contrasenia_con_token_de_acceso_falla():
    """El token de recuperación es de un solo propósito -- un access token
    normal no debe servir para resetear la contraseña."""
    token_acceso = GestorAutenticacion.crear_token_acceso({"sub": "x@x.com"}, version_sesion=1)
    with pytest.raises(Exception):
        GestorAutenticacion.decodificar_token_recuperacion(token_acceso)


def test_restablecer_contrasenia_token_no_se_puede_reusar(client):
    """Tras un restablecimiento exitoso la versión de contraseña cambia, por
    lo que el mismo token debe quedar invalidado (single-use)."""
    persona = _crear_persona(client, "1766666667")
    _registrar_credenciales(client, persona["cedula"], "u6@x.com")

    token = GestorAutenticacion.crear_token_recuperacion("u6@x.com", version_contrasenia=1)
    resp = client.post(
        "/api/v1/auth/restablecer-contrasenia",
        json={"token": token, "nueva_contrasenia": "otraclave123"},
    )
    assert resp.status_code == 204

    # Reutilizar el mismo token debe fallar aunque aún no haya expirado.
    resp = client.post(
        "/api/v1/auth/restablecer-contrasenia",
        json={"token": token, "nueva_contrasenia": "terceraclave123"},
    )
    assert resp.status_code == 401


# --- Antecedentes de club / mano dominante (E01-RF008) -----------------------
def test_crear_antecedentes_club_con_mano_dominante(client):
    persona = _crear_persona(client, "1799999991")
    resp = client.post(
        f"/api/v1/personas/{persona['id']}/antecedentes-club",
        json={
            "nivel_tecnico_alumno": "NIVEL 1", "fecha_inicio_club": "2024-01-01",
            "persona_id": persona["id"], "mano_dominante": "ZURDO",
        },
    )
    assert resp.status_code == 201
    assert resp.json()["manoDominante"] == "ZURDO"


def test_antecedentes_club_duplicado_falla(client):
    persona = _crear_persona(client, "1799999992")
    datos = {
        "nivel_tecnico_alumno": "NIVEL 1", "fecha_inicio_club": "2024-01-01",
        "persona_id": persona["id"],
    }
    client.post(f"/api/v1/personas/{persona['id']}/antecedentes-club", json=datos)
    resp = client.post(f"/api/v1/personas/{persona['id']}/antecedentes-club", json=datos)
    assert resp.status_code == 400


# --- Solo-lectura financiera para menores (E01-RF006/007, punto 8) ----------
def test_menor_no_puede_registrar_su_propio_pago(client):
    representante = _crear_persona(client, "1701010101", fecha_nacimiento="1990-01-01")
    menor = _crear_persona(client, "1701010102", fecha_nacimiento="2020-01-01", representante_id=representante["id"])
    _registrar_credenciales(client, menor["cedula"], "menor@x.com")

    tipo = client.post(
        "/api/v1/membresias/tipos",
        json={"categoria": "niño", "franja_horaria": "tarde", "modalidad": "MENSUAL", "precio": "30.00"},
    ).json()
    membresia = client.post(
        "/api/v1/membresias/",
        json={"monto_aplicado": "30.00", "persona_id": menor["id"], "tipo_membresia_id": tipo["id"]},
    ).json()

    from fastapi.testclient import TestClient
    from main import app

    # Simula que quien llama es el propio menor (su token, no el admin fijo
    # del fixture `client`).
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": "menor@x.com", "persona_id": menor["id"], "roles": ["ALUMNO"],
    }
    c_menor = TestClient(app)
    resp = c_menor.post(
        "/api/v1/membresias/pagos",
        json={
            "monto": "30.00", "tipo_pago": "EFECTIVO",
            "fecha_inicio": "2026-07-01", "fecha_fin": "2026-07-31",
            "persona_id": menor["id"], "membresia_id": membresia["id"],
        },
    )
    assert resp.status_code == 403
    assert "solo lectura" in resp.json()["detail"].lower()


def test_representante_si_puede_registrar_pago_del_representado(client):
    representante = _crear_persona(client, "1701010201", fecha_nacimiento="1985-01-01")
    menor = _crear_persona(client, "1701010202", fecha_nacimiento="2020-01-01", representante_id=representante["id"])

    tipo = client.post(
        "/api/v1/membresias/tipos",
        json={"categoria": "niño", "franja_horaria": "tarde", "modalidad": "MENSUAL", "precio": "30.00"},
    ).json()
    membresia = client.post(
        "/api/v1/membresias/",
        json={"monto_aplicado": "30.00", "persona_id": menor["id"], "tipo_membresia_id": tipo["id"]},
    ).json()

    from fastapi.testclient import TestClient
    from main import app

    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": "rep@x.com", "persona_id": representante["id"], "roles": [],
    }
    c_rep = TestClient(app)
    resp = c_rep.post(
        "/api/v1/membresias/pagos",
        json={
            "monto": "30.00", "tipo_pago": "EFECTIVO",
            "fecha_inicio": "2026-07-01", "fecha_fin": "2026-07-31",
            "persona_id": menor["id"], "membresia_id": membresia["id"],
        },
    )
    assert resp.status_code == 201


def test_pago_a_persona_inexistente_sin_vinculo_da_403_no_404(client_sin_permisos):
    """Preserva la protección anti-enumeración: un solicitante sin ningún
    vínculo con persona_id=999 (que no existe) debe recibir 403, no 404 --
    de lo contrario filtraría qué ids de persona existen."""
    resp = client_sin_permisos.post(
        "/api/v1/membresias/pagos",
        json={
            "monto": "35.00", "tipo_pago": "EFECTIVO",
            "fecha_inicio": "2026-07-01", "fecha_fin": "2026-07-31",
            "persona_id": 999, "membresia_id": 1,
        },
    )
    assert resp.status_code == 403
