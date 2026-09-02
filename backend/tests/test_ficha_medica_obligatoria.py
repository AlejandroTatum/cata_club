"""
Issue #730: la ficha médica deja de ser un bloque opcional en las dos altas
que crean un ALUMNO.

Medido el 2026-08-27 contra el stack de QA: `POST /api/v1/enrollment/` con
`ficha_medica` omitida por completo devolvía 201 y creaba un alumno
plenamente funcional; `GET /fichas-medicas/persona/{id}` daba 404 y
`/emergencia` devolvía los tres campos en `null`. El club ya arrastraba 42
personas así.

Lo que NO cambia y estos tests custodian: la validación POR CAMPO de
`EnrollmentFichaMedicaDTO` (tipo de sangre ausente, `DESCONOCIDO`, teléfono
mal formado, contacto vacío) sigue viviendo en `test_ficha_medica_completa.py`
y no se toca. Acá sólo se cierra el hueco "el objeto entero no vino".

Por qué el rechazo sale de un `model_validator` y no de tipar el campo como
obligatorio: un campo requerido de Pydantic produce `"Field required"`, en
inglés y sin decir QUÉ falta. `main.py::_validation_exception_handler`
publica `errores[0]["msg"]` tal cual al cliente, así que ese texto sería lo
que lee un representante en el navegador. El `model_validator` es el mismo
recurso que ya usa `_representante_o_credenciales` en este mismo DTO, y por
el mismo motivo.
"""
from datetime import date

import pytest
from pydantic import ValidationError

from app.dominio.cedula import cedula_valida
from app.dominio.modelos import FichaMedica, Persona
from app.servicios_negocio.dtos.admin_cuenta_schemas import AdminCrearCuentaDTO
from app.servicios_negocio.dtos.enrollment_schemas import EnrollmentCreateDTO


def _ficha(**overrides) -> dict:
    cuerpo = {
        "tipo_sangre": "O_POSITIVO",
        "enfermedades": [],
        "contacto_emergencia": "María Torres",
        "telefono_emergencia": "0991112233",
    }
    cuerpo.update(overrides)
    return cuerpo


def _cuerpo_enrollment(secuencia: int, **overrides) -> dict:
    """Autoinscripción de un adulto: el camino exacto del issue #730."""
    cuerpo = {
        "alumno": {
            "nombres": "Prueba",
            "apellidos": "SinFicha",
            "cedula": cedula_valida(secuencia),
            "fecha_nacimiento": "1995-03-04",
            "telefono": "0987654321",
        },
        "credenciales_alumno": {
            "correo": f"sinficha{secuencia}@example.com",
            "contrasenia": "password8",
        },
        "ficha_medica": _ficha(),
        "acepta_consentimientos": True,
    }
    cuerpo.update(overrides)
    return cuerpo


def _cuerpo_admin(secuencia: int, **overrides) -> dict:
    cuerpo = {
        "tipo_cuenta": "JUGADOR",
        "nombres": "Carlos",
        "apellidos": "Ruiz",
        "cedula": cedula_valida(secuencia),
        "fecha_nacimiento": "1995-06-15",
        "telefono": "0991234567",
        "correo": f"carlos{secuencia}@example.com",
        "contrasenia": "clave12345",
        "ficha_medica": _ficha(),
    }
    cuerpo.update(overrides)
    return cuerpo


# --- Alta pública (POST /enrollment/) ---------------------------------------

def test_enrollment_sin_ficha_medica_es_rechazado(client):
    """El 201 del issue #730, ahora un 422.

    Se prueba por HTTP y no sólo contra el DTO porque lo que el issue midió
    fue un `POST` que devolvía 201: la prueba tiene que fallar donde falló
    la realidad.
    """
    cuerpo = _cuerpo_enrollment(701)
    del cuerpo["ficha_medica"]

    resp = client.post("/api/v1/enrollment/", json=cuerpo)

    assert resp.status_code == 422


def test_el_rechazo_del_enrollment_dice_en_castellano_qué_falta(client):
    """Un 422 que dice `Field required` no le sirve a nadie del otro lado.

    El mensaje tiene que nombrar la ficha médica y los dos datos que el club
    necesita, en el mismo registro que el resto de la API.
    """
    cuerpo = _cuerpo_enrollment(702)
    del cuerpo["ficha_medica"]

    mensaje = client.post("/api/v1/enrollment/", json=cuerpo).json()["detail"]

    assert "Field required" not in mensaje
    assert "ficha médica" in mensaje.lower()
    assert "tipo de sangre" in mensaje.lower()
    assert "contacto de emergencia" in mensaje.lower()


def test_enrollment_con_ficha_medica_en_null_es_rechazado(client):
    """`"ficha_medica": null` es la misma ausencia escrita distinto.

    Sin este caso, cerrar el hueco de la clave omitida dejaría abierta la
    puerta de al lado — y es la que más fácil manda un cliente que arma el
    cuerpo con un campo opcional sin valor.
    """
    resp = client.post("/api/v1/enrollment/", json=_cuerpo_enrollment(703, ficha_medica=None))

    assert resp.status_code == 422


def test_enrollment_con_ficha_medica_sigue_creando_la_ficha(client, db_session):
    """La mitad que no debe romperse: un alta completa sigue dando 201 y
    persistiendo la ficha."""
    resp = client.post("/api/v1/enrollment/", json=_cuerpo_enrollment(704))

    assert resp.status_code == 201
    persona_id = resp.json()["persona_id"]
    ficha = db_session.query(FichaMedica).filter(FichaMedica.persona_id == persona_id).one()
    assert ficha.contacto_emergencia == "María Torres"


# --- Alta por el panel de admin (POST /personas/admin/cuentas) --------------

def test_alta_admin_de_jugador_sin_ficha_medica_es_rechazada(client):
    """`AdminCrearCuentaDTO` arrastraba la misma opcionalidad que el alta
    pública. Un JUGADOR es un alumno, así que la regla es la misma."""
    cuerpo = _cuerpo_admin(710)
    del cuerpo["ficha_medica"]

    resp = client.post("/api/v1/personas/admin/cuentas", json=cuerpo)

    assert resp.status_code == 422
    assert "ficha médica" in resp.json()["detail"].lower()


def test_alta_admin_de_menor_sin_ficha_medica_es_rechazada(client, db_session):
    """Un MENOR es el caso que el issue nombra: es un club con niños."""
    representante = Persona(
        nombres="María", apellidos="López", cedula=cedula_valida(711),
        fecha_nacimiento=date(1985, 3, 20), telefono="0998765432",
    )
    db_session.add(representante)
    db_session.commit()

    cuerpo = _cuerpo_admin(
        712, tipo_cuenta="MENOR", fecha_nacimiento="2015-06-15",
        representante_id=representante.id,
    )
    del cuerpo["ficha_medica"]

    resp = client.post("/api/v1/personas/admin/cuentas", json=cuerpo)

    assert resp.status_code == 422


def test_alta_admin_de_entrenador_no_exige_ficha_medica(client):
    """El límite deliberado de la regla.

    `tipo_cuenta` también acuña ENTRENADOR y REPRESENTANTE, que no son
    alumnos: nadie los va a buscar a la cancha con un tipo de sangre. Exigir
    una ficha médica ahí sería aplicar la regla donde no corresponde, que es
    su propio defecto. Este test es el candado de esa frontera: si alguien
    sube la exigencia al DTO entero, se pone rojo.
    """
    cuerpo = _cuerpo_admin(713, tipo_cuenta="ENTRENADOR")
    del cuerpo["ficha_medica"]

    resp = client.post("/api/v1/personas/admin/cuentas", json=cuerpo)

    assert resp.status_code == 201


def test_alta_admin_de_representante_no_exige_ficha_medica(client):
    """Mismo límite que ENTRENADOR: un representante no entrena."""
    cuerpo = _cuerpo_admin(714, tipo_cuenta="REPRESENTANTE")
    del cuerpo["ficha_medica"]

    resp = client.post("/api/v1/personas/admin/cuentas", json=cuerpo)

    assert resp.status_code == 201


# --- La validación por campo no se movió ------------------------------------

def test_la_ficha_incompleta_sigue_rechazándose_campo_por_campo():
    """Custodia de lo que YA funcionaba (#643): el hueco cerrado acá es el
    del objeto ausente, no el de sus campos. Si hacer obligatorio el bloque
    hubiera aflojado alguna regla de adentro, este test lo dice."""
    for faltante in ("tipo_sangre", "contacto_emergencia", "telefono_emergencia"):
        ficha = _ficha()
        del ficha[faltante]
        with pytest.raises(ValidationError):
            EnrollmentCreateDTO(**_cuerpo_enrollment(715, ficha_medica=ficha))

    with pytest.raises(ValidationError):
        EnrollmentCreateDTO(**_cuerpo_enrollment(716, ficha_medica=_ficha(tipo_sangre="DESCONOCIDO")))

    with pytest.raises(ValidationError):
        AdminCrearCuentaDTO(**_cuerpo_admin(717, ficha_medica=_ficha(telefono_emergencia="123")))
