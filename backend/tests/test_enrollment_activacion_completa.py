"""Issue #1040: el alta pública (`POST /enrollment/`) tenía su PROPIO emisor
de tokens (`EnrollmentServicio._emitir_tokens`), que nunca calculaba
`activacion_completa` -- a diferencia de `AuthServicio._emitir_par_tokens`
(login normal), que sí lo hace desde #858. El claim salía ausente, y el
guard del frontend (`hasPendingActivation`, deliberadamente) solo redirige
ante el `false` explícito: una cuenta recién autoinscripta, con el correo
sin verificar, entraba a los módulos en su primera sesión.

Estos tests ejercen el camino REAL de `POST /enrollment/` -- no fabrican el
token a mano -- porque lo que se rompió fue justamente ESE emisor. Si
`_emitir_tokens` vuelve a quedarse con una lista de claims propia y deja de
llamar al mismo cálculo que usa el login, este archivo se pone rojo.
"""
from datetime import datetime, timezone
from decimal import Decimal

import jwt

from app.dominio.cedula import cedula_valida
from app.dominio.enums import EstadoMembresia, TipoModalidad
from app.dominio.modelos import Membresia, TipoMembresia, Usuario
from app.soporte_transversal.configuracion import settings


def _ficha() -> dict:
    return {
        "tipo_sangre": "O_POSITIVO",
        "enfermedades": [],
        "contacto_emergencia": "María Torres",
        "telefono_emergencia": "0991112233",
    }


def _cuerpo_adulto(secuencia: int) -> dict:
    """Autoinscripción de un adulto (sin representante)."""
    return {
        "alumno": {
            "nombres": "Prueba",
            "apellidos": "Activacion",
            "cedula": cedula_valida(secuencia),
            "fecha_nacimiento": "1995-03-04",
            "telefono": "0987654321",
        },
        "credenciales_alumno": {
            "correo": f"activacion{secuencia}@example.com",
            "contrasenia": "password8",
        },
        "ficha_medica": _ficha(),
        "acepta_consentimientos": True,
    }


def _cuerpo_menor_con_representante(secuencia: int) -> dict:
    """Autoinscripción de un menor por su representante."""
    return {
        "representante": {
            "nombres": "Sofia", "apellidos": "Martinez",
            "cedula": cedula_valida(secuencia),
            "fecha_nacimiento": "1990-05-20", "telefono": "0991234567",
            "correo": f"representante{secuencia}@example.com",
            "contrasenia": "password8",
        },
        "alumno": {
            "nombres": "Mateo", "apellidos": "Martinez",
            "cedula": cedula_valida(secuencia + 1),
            "fecha_nacimiento": "2015-06-15", "telefono": "0991234568",
        },
        "ficha_medica": _ficha(),
        "acepta_consentimientos": True,
    }


def _decodificar(access_token: str) -> dict:
    return jwt.decode(access_token, settings.jwt_secret_key, algorithms=[settings.jwt_algoritmo])


def test_enrollment_de_un_adulto_emite_el_claim_activacion_completa(client_sin_token, db_session):
    """La cuenta nace con `correo_verificado=False` y sin membresía: el claim
    tiene que existir y valer `False`, igual que en el login normal con la
    misma cuenta (ver `test_auth_activation.py`)."""
    respuesta = client_sin_token.post("/api/v1/enrollment/", json=_cuerpo_adulto(801))

    assert respuesta.status_code == 201, respuesta.text
    payload = _decodificar(respuesta.json()["access_token"])

    assert "activacion_completa" in payload
    assert payload["activacion_completa"] is False


def test_enrollment_de_un_menor_por_representante_emite_el_claim(client_sin_token, db_session):
    """Mismo candado sobre el otro camino de alta pública: el representante
    tampoco probó su correo todavía."""
    respuesta = client_sin_token.post(
        "/api/v1/enrollment/", json=_cuerpo_menor_con_representante(810),
    )

    assert respuesta.status_code == 201, respuesta.text
    payload = _decodificar(respuesta.json()["access_token"])

    assert "activacion_completa" in payload
    assert payload["activacion_completa"] is False


def test_el_refresh_token_del_enrollment_tambien_lleva_el_claim(client_sin_token, db_session):
    """El refresh token es el que el guard de borde puede leer sin decodificar
    el JWT de acceso; si le faltara el claim, la restricción se perdería en
    cuanto el navegador refresque la sesión."""
    respuesta = client_sin_token.post("/api/v1/enrollment/", json=_cuerpo_adulto(820))

    assert respuesta.status_code == 201, respuesta.text
    payload = _decodificar(respuesta.json()["refresh_token"])

    assert "activacion_completa" in payload
    assert payload["activacion_completa"] is False


def test_tras_verificar_el_correo_el_refresh_ya_refleja_el_alta_sin_login_manual(
    client_sin_token, db_session,
):
    """Criterio de aceptación del issue: tras confirmar el correo, la cuenta
    accede a los módulos sin volver a iniciar sesión a mano. Se ejerce con
    `POST /auth/refresh` -- que reevalúa la compuerta en cada llamada -- sobre
    el refresh token que la propia autoinscripción entregó, nunca con un login
    nuevo. La membresía activa se agrega a mano porque el alta pública no crea
    ninguna: sin ella, `puede_acceder_modulos` seguiría en False aunque el
    correo ya esté verificado."""
    respuesta = client_sin_token.post("/api/v1/enrollment/", json=_cuerpo_adulto(830))
    assert respuesta.status_code == 201, respuesta.text
    tokens = respuesta.json()

    plan = TipoMembresia(categoria="Mensual", precio=Decimal("25.00"), modalidad=TipoModalidad.MENSUAL)
    db_session.add(plan)
    db_session.flush()
    cuenta = db_session.query(Usuario).filter(Usuario.correo == "activacion830@example.com").one()
    cuenta.correo_verificado = True
    db_session.add(Membresia(
        estado=EstadoMembresia.ACTIVA,
        monto_aplicado=Decimal("25.00"),
        fecha_activacion=datetime.now(timezone.utc),
        persona_id=cuenta.persona_id,
        tipo_membresia_id=plan.id,
    ))
    db_session.commit()

    refresco = client_sin_token.post(
        "/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]},
    )
    assert refresco.status_code == 200, refresco.text
    assert _decodificar(refresco.json()["access_token"])["activacion_completa"] is True
