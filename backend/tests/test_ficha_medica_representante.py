"""
Acceso del representante a la ficha médica de sus representados.

`PersonaServicio.crear_representado` ya escribe la `FichaMedica` del menor con
los datos que el propio representante declara en la inscripción, pero los tres
endpoints de `/fichas-medicas/*` eran ADMINISTRADOR-only: el tutor no podía
volver a ver -- ni corregir -- lo que él mismo cargó. Si el hijo desarrolla una
alergia nueva, no había forma de actualizarla sin pasar por administración.

Estos tests fijan la regla nueva sobre GET y PATCH:

    ADMINISTRADOR, o el representante legal de ESA persona. Nadie más.

Deliberadamente NO se habilita al propio titular sobre su ficha (a diferencia
de `GET /ranking/{persona_id}/perfil`, que sí lo permite): es una decisión de
producto aparte y todavía no tomada. Ver `incluir_titular` en
`PoliticaAccesoPersona`.

El caso IDOR -- un representante real pidiendo el menor de OTRA familia -- es
el test central del archivo: son ids enteros consecutivos y enumerables.
"""
from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.dominio.modelos import FichaMedica, Persona
from app.dominio.enums import TipoSangre
from app.infraestructura.db import obtener_sesion
from app.seguridad.gestor_auth import GestorAutenticacion
from main import app


def _crear_familia(db_session, sufijo: str):
    """Representante + hijo menor con ficha médica ya cargada."""
    representante = Persona(
        nombres="Madre", apellidos=f"Tutora{sufijo}", cedula=f"17100340{sufijo}",
        fecha_nacimiento=date(1980, 1, 1), telefono="0991110000",
    )
    db_session.add(representante)
    db_session.flush()
    hijo = Persona(
        nombres="Hijo", apellidos=f"Tutorado{sufijo}", cedula=f"17100341{sufijo}",
        fecha_nacimiento=date(2015, 1, 1), telefono="0991110001",
        representante_id=representante.id,
    )
    db_session.add(hijo)
    db_session.flush()
    db_session.add(FichaMedica(
        tipo_sangre=TipoSangre.O_POSITIVO, persona_id=hijo.id, alergias="Ninguna",
    ))
    db_session.commit()
    db_session.refresh(representante)
    db_session.refresh(hijo)
    return representante, hijo


@pytest.fixture()
def familia(db_session):
    return _crear_familia(db_session, "80")


@pytest.fixture()
def otra_familia(db_session):
    """Segunda familia sin ningún vínculo con la primera: el objetivo IDOR."""
    return _crear_familia(db_session, "90")


def _client_como(db_session, persona_id, roles):
    """Cliente autenticado con un `persona_id`/`roles` arbitrarios, mismo
    idiom que `tests/test_seguridad_acceso_recursos.py`."""
    def _sesion():
        yield db_session

    app.dependency_overrides[obtener_sesion] = _sesion
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": "sesion@cataclub.test", "persona_id": persona_id, "roles": roles,
    }
    return TestClient(app)


def _client_sin_persona_id(db_session, roles):
    """Token válido al que le FALTA el claim `persona_id`. Debe denegar: un
    claim ausente nunca puede leerse como "coincide"."""
    def _sesion():
        yield db_session

    app.dependency_overrides[obtener_sesion] = _sesion
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": "sinpersona@cataclub.test", "roles": roles,
    }
    return TestClient(app)


# --- El vínculo real: sí pasa --------------------------------------------
def test_el_representante_si_lee_la_ficha_medica_de_su_representado(db_session, familia):
    representante, hijo = familia
    with _client_como(db_session, representante.id, ["REPRESENTANTE"]) as c:
        respuesta = c.get(f"/api/v1/fichas-medicas/persona/{hijo.id}")
    app.dependency_overrides.clear()
    assert respuesta.status_code == 200
    assert respuesta.json()["personaId"] == hijo.id


def test_el_representante_si_actualiza_la_ficha_medica_de_su_representado(db_session, familia):
    """El caso que motiva el cambio: el menor desarrolla una alergia nueva."""
    representante, hijo = familia
    with _client_como(db_session, representante.id, ["REPRESENTANTE"]) as c:
        respuesta = c.patch(
            f"/api/v1/fichas-medicas/persona/{hijo.id}",
            json={"alergias": "Penicilina"},
        )
    app.dependency_overrides.clear()
    assert respuesta.status_code == 200
    assert respuesta.json()["alergias"] == "Penicilina"


def test_el_representante_crea_la_ficha_via_patch_si_el_representado_no_tiene(db_session):
    """`actualizar_por_persona` hace upsert: el PATCH también cubre el alta
    para un representado que todavía no tiene ficha."""
    representante = Persona(
        nombres="Madre", apellidos="SinFicha", cedula="1710034060",
        fecha_nacimiento=date(1980, 1, 1), telefono="0991110000",
    )
    db_session.add(representante)
    db_session.flush()
    hijo = Persona(
        nombres="Hijo", apellidos="SinFicha", cedula="1710034061",
        fecha_nacimiento=date(2015, 1, 1), telefono="0991110001",
        representante_id=representante.id,
    )
    db_session.add(hijo)
    db_session.commit()
    db_session.refresh(representante)
    db_session.refresh(hijo)

    with _client_como(db_session, representante.id, ["REPRESENTANTE"]) as c:
        respuesta = c.patch(
            f"/api/v1/fichas-medicas/persona/{hijo.id}",
            json={"tipo_sangre": "A_POSITIVO"},
        )
    app.dependency_overrides.clear()
    assert respuesta.status_code == 200
    assert respuesta.json()["tipoSangre"] == "A_POSITIVO"


# --- IDOR: el menor de OTRA familia --------------------------------------
def test_el_representante_no_lee_la_ficha_medica_de_otra_familia(
    db_session, familia, otra_familia
):
    """EL test del cambio. `representante` es un tutor legítimo -- tiene el
    rol y un representado propio -- pero el `persona_id` de la URL pertenece
    a otra familia. Debe ser 403 (permisos), NO 404 ni un fallo incidental de
    validación: se afirma el mensaje del manejador de `PermisosInsuficientes`
    para que el test no pase por el motivo equivocado."""
    representante, _ = familia
    _, hijo_ajeno = otra_familia
    with _client_como(db_session, representante.id, ["REPRESENTANTE"]) as c:
        respuesta = c.get(f"/api/v1/fichas-medicas/persona/{hijo_ajeno.id}")
    app.dependency_overrides.clear()
    assert respuesta.status_code == 403
    assert "representante" in respuesta.json()["detail"].lower()


def test_el_representante_no_actualiza_la_ficha_medica_de_otra_familia(
    db_session, familia, otra_familia
):
    representante, _ = familia
    _, hijo_ajeno = otra_familia
    with _client_como(db_session, representante.id, ["REPRESENTANTE"]) as c:
        respuesta = c.patch(
            f"/api/v1/fichas-medicas/persona/{hijo_ajeno.id}",
            json={"alergias": "Inyectada por un tercero"},
        )
    app.dependency_overrides.clear()
    assert respuesta.status_code == 403


def test_el_representante_no_lee_una_persona_inexistente_y_no_revienta(db_session, familia):
    """Persona objetivo inexistente: deniega (403, mismo cuerpo que "no es
    tuya" -- no distingue ambos casos) y nunca 500."""
    representante, _ = familia
    with _client_como(db_session, representante.id, ["REPRESENTANTE"]) as c:
        respuesta = c.get("/api/v1/fichas-medicas/persona/999999")
    app.dependency_overrides.clear()
    assert respuesta.status_code == 403


# --- Todo lo demás sigue cerrado -----------------------------------------
def test_un_alumno_no_lee_la_ficha_medica_de_otra_persona(db_session, familia):
    representante, hijo = familia
    with _client_como(db_session, 999, ["ALUMNO"]) as c:
        respuesta = c.get(f"/api/v1/fichas-medicas/persona/{hijo.id}")
    app.dependency_overrides.clear()
    assert respuesta.status_code == 403


def test_el_titular_no_lee_su_propia_ficha_medica(db_session, familia):
    """Límite de alcance explícito: este cambio NO abre la ficha propia,
    aunque `PoliticaAccesoPersona` lo permita por defecto en otras rutas.
    Es una decisión de producto aparte; el `incluir_titular=False` del router
    la mantiene apagada y este test lo fija."""
    _, hijo = familia
    with _client_como(db_session, hijo.id, ["ALUMNO"]) as c:
        respuesta = c.get(f"/api/v1/fichas-medicas/persona/{hijo.id}")
    app.dependency_overrides.clear()
    assert respuesta.status_code == 403


def test_un_token_sin_persona_id_es_denegado(db_session, familia):
    """Fail closed: sin el claim de identidad no hay vínculo que verificar."""
    _, hijo = familia
    with _client_sin_persona_id(db_session, ["REPRESENTANTE"]) as c:
        respuesta = c.get(f"/api/v1/fichas-medicas/persona/{hijo.id}")
    app.dependency_overrides.clear()
    assert respuesta.status_code == 403


def test_el_administrador_conserva_acceso_a_ambos_verbos(db_session, familia):
    _, hijo = familia
    with _client_como(db_session, 999, ["ADMINISTRADOR"]) as c:
        lectura = c.get(f"/api/v1/fichas-medicas/persona/{hijo.id}")
        escritura = c.patch(
            f"/api/v1/fichas-medicas/persona/{hijo.id}",
            json={"alergias": "Revisado por administración"},
        )
    app.dependency_overrides.clear()
    assert lectura.status_code == 200
    assert escritura.status_code == 200
    assert escritura.json()["alergias"] == "Revisado por administración"


def test_el_representante_no_puede_crear_fichas_por_post(db_session, familia):
    """POST sigue siendo ADMINISTRADOR-only: es el alta suelta por
    `persona_id` del payload, herramienta de administración. El alta que el
    representante necesita ya la cubre el PATCH con upsert."""
    representante, hijo = familia
    with _client_como(db_session, representante.id, ["REPRESENTANTE"]) as c:
        respuesta = c.post(
            "/api/v1/fichas-medicas/",
            json={"tipo_sangre": "O_POSITIVO", "persona_id": hijo.id, "enfermedades": []},
        )
    app.dependency_overrides.clear()
    assert respuesta.status_code == 403
