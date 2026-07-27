"""
Tests de autenticación en endpoints previamente públicos.

Tras cerrar el gap de seguridad, todos los endpoints de negocio requieren
al menos un token válido (no necesariamente admin). Aquí se cubre:

  - Sin token: GET/POST de endpoints que antes eran públicos devuelven 401.
  - Rol no-admin intenta escribir/leer ficha médica -> 403.

Las peticiones no usan body completo cuando solo buscamos el 401/403 temprano
(el check de auth corre ANTES que el de validación del body, así no llegamos
a 422 por schema incompleto).
"""


# --- Sin token -> 401 -------------------------------------------------------
# Probamos uno por endpoint expuesto para evitar regresiones silenciosas de
# "alguien quitó el Depends". El 401 alcanza (no hace falta llegar al 422
# por schema incompleto).

def test_get_personas_sin_token_da_401(client_sin_token):
    assert client_sin_token.get("/api/v1/personas/").status_code == 401


def test_get_persona_por_id_sin_token_da_401(client_sin_token):
    assert client_sin_token.get("/api/v1/personas/1").status_code == 401


def test_get_representados_sin_token_da_401(client_sin_token):
    assert client_sin_token.get("/api/v1/personas/1/representados").status_code == 401


def test_post_ficha_medica_sin_token_da_401(client_sin_token):
    resp = client_sin_token.post(
        "/api/v1/fichas-medicas/",
        json={"tipo_sangre": "O_POSITIVO", "persona_id": 1},
    )
    assert resp.status_code == 401


def test_get_ficha_medica_sin_token_da_401(client_sin_token):
    assert client_sin_token.get("/api/v1/fichas-medicas/persona/1").status_code == 401


def test_post_pago_sin_token_da_401(client_sin_token):
    resp = client_sin_token.post(
        "/api/v1/membresias/pagos",
        json={
            "monto": "10.00", "tipo_pago": "EFECTIVO",
            "fecha_inicio": "2026-07-01", "fecha_fin": "2026-07-31",
            "persona_id": 1, "membresia_id": 1,
        },
    )
    assert resp.status_code == 401


def test_get_pago_sin_token_da_401(client_sin_token):
    assert client_sin_token.get("/api/v1/membresias/pagos/1").status_code == 401


def test_post_comprobante_oficial_sin_token_da_401(client_sin_token):
    resp = client_sin_token.post(
        "/api/v1/membresias/pagos/1/comprobante",
        json={"archivo_url": "https://x", "formato_archivo": "pdf", "pago_id": 1},
    )
    assert resp.status_code == 401


def test_get_tipos_membresia_sin_token_da_401(client_sin_token):
    assert client_sin_token.get("/api/v1/membresias/tipos").status_code == 401


def test_get_membresia_sin_token_da_401(client_sin_token):
    assert client_sin_token.get("/api/v1/membresias/1").status_code == 401


def test_get_horarios_sin_token_da_401(client_sin_token):
    assert client_sin_token.get("/api/v1/asistencias/horarios").status_code == 401


def test_get_historial_asistencia_sin_token_da_401(client_sin_token):
    assert client_sin_token.get("/api/v1/asistencias/persona/1").status_code == 401


# --- Con token pero sin rol admin -> 403 (ficha médica) ----------------------
def test_post_ficha_medica_sin_admin_da_403(client_sin_permisos):
    """Ficha médica requiere ADMINISTRADOR, no acepta ALUMNO."""
    resp = client_sin_permisos.post(
        "/api/v1/fichas-medicas/",
        json={"tipo_sangre": "O_POSITIVO", "persona_id": 1},
    )
    assert resp.status_code == 403


def test_get_ficha_medica_sin_admin_da_403(client_sin_permisos):
    assert client_sin_permisos.get("/api/v1/fichas-medicas/persona/1").status_code == 403


# --- El conftest._mock_disparo_celery_comprobante sigue cubriendo a validar_pago,
# así que no hace falta crear pago real para probar comprobante admin.


# --- Representante menor de edad (Gap 2) ------------------------------------
def _payload_persona_menor_17(cedula="1710034065"):
    """Con la fecha congelada del conftest (2029-01-01), esta cédula corresponde
    a una persona de 17 años (nacida 2012-01-01)."""
    return {
        "nombres": "Menor", "apellidos": "Tutor", "cedula": cedula,
        "fecha_nacimiento": "2012-01-01", "telefono": "0991234567",
    }


def test_registrar_hijo_con_representante_menor_de_edad_da_400(client):
    """Gap 2: el representante legal debe ser mayor de edad.

    Esquema: creamos un adulto (sin representante, mayor de edad -> OK),
    luego a una persona de 17 años como su representado (menor, pero CON
    representante adulto -> OK), y finalmente intentamos usar a esa persona
    de 17 años como `representante_id` de un tercero. Debe rechazarse con
    400 porque el representante indicado no es mayor de edad.
    """
    adulto = client.post(
        "/api/v1/personas/",
        json={
            "nombres": "Adulto", "apellidos": "Tutor", "cedula": "1710034065",
            "fecha_nacimiento": "1990-01-01", "telefono": "0991234567",
        },
    )
    assert adulto.status_code == 201, adulto.text

    menor_de_17 = client.post(
        "/api/v1/personas/",
        json={
            **_payload_persona_menor_17("1710034073"),
            "representante_id": adulto.json()["id"],
        },
    )
    assert menor_de_17.status_code == 201, menor_de_17.text

    # Ahora intentar usar a la persona de 17 años como representante de un
    # tercero: debe fallar porque no es mayor de edad.
    resp = client.post(
        "/api/v1/personas/",
        json={
            **_payload_persona_menor_17("1710034081"),
            "representante_id": menor_de_17.json()["id"],
        },
    )
    assert resp.status_code == 400
    assert "mayor de edad" in resp.json()["detail"].lower()


def test_registrar_hijo_con_representante_mayor_de_edad_funciona(client):
    """Smoke test: el happy path del fix (representante adulto) sigue OK."""
    adulto = client.post(
        "/api/v1/personas/",
        json={
            "nombres": "Adulto", "apellidos": "Tutor", "cedula": "1710034065",
            "fecha_nacimiento": "1990-01-01", "telefono": "0991234567",
        },
    )
    assert adulto.status_code == 201, adulto.text
    adulto_id = adulto.json()["id"]

    hijo = client.post(
        "/api/v1/personas/",
        json={
            "nombres": "Niño", "apellidos": "Tutor", "cedula": "1710034073",
            "fecha_nacimiento": "2015-01-01", "telefono": "0991234567",
            "representante_id": adulto_id,
        },
    )
    assert hijo.status_code == 201, hijo.text
