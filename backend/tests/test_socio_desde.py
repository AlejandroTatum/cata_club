"""«Socio desde» editable por el administrador (QA ronda 2, L15).

Un miembro migrado se inscribe en la plataforma el día del lanzamiento, pero
lleva años en el club. La fecha que ve el alumno en «Jugador desde» tiene que
ser la real. Vive en `AntecedentesClub.fecha_inicio_club` y NO en
`Membresia.fecha_activacion`: esa columna ordena "cuál es la membresía más
reciente" (asistencia, repositorio, autenticación) y reescribirla cambiaría
cuál se elige. Cambiar `fecha_inicio_club` jamás toca estado, cobertura ni
deuda."""
from datetime import date, timedelta

import pytest

from app.dominio.cedula import cedula_valida
from app.dominio.enums import EstadoMembresia
from app.dominio.modelos import AntecedentesClub, Membresia
from app.seguridad.gestor_auth import GestorAutenticacion
from app.soporte_transversal.tiempo import hoy_club
from main import app
from tests.fabricas_pagos import crear_membresia_orm, crear_persona_orm, crear_tipo_membresia_orm


@pytest.fixture
def grafo(db_session):
    persona = crear_persona_orm(db_session, cedula_valida(940))
    tipo = crear_tipo_membresia_orm(db_session)
    membresia = crear_membresia_orm(db_session, persona, tipo, EstadoMembresia.ACTIVA)
    db_session.commit()
    return persona, membresia


def _url(persona_id: int) -> str:
    return f"/api/v1/personas/{persona_id}/socio-desde"


def _socio_desde_en_api(client, persona_id: int):
    resp = client.get(f"/api/v1/membresias/persona/{persona_id}")
    assert resp.status_code == 200
    return resp.json()[0]["socioDesde"]


def test_admin_fija_fecha_pasada_y_el_alumno_la_ve(client, db_session, grafo):
    persona, _ = grafo

    resp = client.put(_url(persona.id), json={"fecha_inicio_club": "2019-03-15"})

    assert resp.status_code == 200
    assert resp.json()["fechaInicioClub"] == "2019-03-15"
    assert _socio_desde_en_api(client, persona.id) == "2019-03-15"

    # El propio alumno, por `/membresias/mias`, ve el mismo valor.
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": "alumno@cataclub.test", "persona_id": persona.id, "roles": ["ALUMNO"],
    }
    mias = client.get("/api/v1/membresias/mias")
    assert mias.status_code == 200
    assert mias.json()[0]["socioDesde"] == "2019-03-15"


def test_segunda_edicion_actualiza_la_misma_fila(client, db_session, grafo):
    persona, _ = grafo
    client.put(_url(persona.id), json={"fecha_inicio_club": "2019-03-15"})

    resp = client.put(_url(persona.id), json={"fecha_inicio_club": "2018-01-02"})

    assert resp.status_code == 200
    filas = db_session.query(AntecedentesClub).filter_by(persona_id=persona.id).all()
    assert [f.fecha_inicio_club for f in filas] == [date(2018, 1, 2)]


def test_hoy_es_valido(client, grafo):
    persona, _ = grafo
    resp = client.put(_url(persona.id), json={"fecha_inicio_club": hoy_club().isoformat()})
    assert resp.status_code == 200


def test_fecha_futura_da_422_en_castellano_y_no_cambia_nada(client, db_session, grafo):
    persona, _ = grafo
    client.put(_url(persona.id), json={"fecha_inicio_club": "2020-05-05"})

    manana = (hoy_club() + timedelta(days=1)).isoformat()
    resp = client.put(_url(persona.id), json={"fecha_inicio_club": manana})

    assert resp.status_code == 422
    assert "futura" in resp.json()["message"]
    assert _socio_desde_en_api(client, persona.id) == "2020-05-05"


def test_no_admin_da_403_y_no_cambia_nada(client, client_sin_permisos, db_session, grafo):
    persona, _ = grafo

    resp = client_sin_permisos.put(_url(persona.id), json={"fecha_inicio_club": "2019-03-15"})

    assert resp.status_code == 403
    assert db_session.query(AntecedentesClub).filter_by(persona_id=persona.id).count() == 0


def test_entrenador_da_403(client_entrenador, grafo):
    persona, _ = grafo
    resp = client_entrenador.put(_url(persona.id), json={"fecha_inicio_club": "2019-03-15"})
    assert resp.status_code == 403


def test_persona_inexistente_da_404(client):
    resp = client.put(_url(987654), json={"fecha_inicio_club": "2019-03-15"})
    assert resp.status_code == 404


def test_sin_registro_previo_se_crea_y_con_registro_conserva_nivel(client, db_session, grafo):
    persona, _ = grafo
    client.put(_url(persona.id), json={"fecha_inicio_club": "2019-03-15"})
    fila = db_session.query(AntecedentesClub).filter_by(persona_id=persona.id).one()
    fila.nivel_tecnico_alumno = fila.nivel_tecnico_alumno.__class__.NIVEL_5
    db_session.commit()

    client.put(_url(persona.id), json={"fecha_inicio_club": "2018-01-02"})

    db_session.refresh(fila)
    assert fila.nivel_tecnico_alumno.value == "NIVEL 5"


def test_sin_fecha_el_alumno_ve_none_y_el_front_cae_a_fecha_activacion(client, grafo):
    persona, _ = grafo
    assert _socio_desde_en_api(client, persona.id) is None


def test_no_toca_estado_fecha_activacion_ni_deuda(client, db_session, grafo):
    persona, membresia = grafo
    antes = client.get(f"/api/v1/membresias/persona/{persona.id}").json()[0]
    deuda_antes = client.get(f"/api/v1/membresias/{membresia.id}/deuda").json()

    resp = client.put(_url(persona.id), json={"fecha_inicio_club": "2015-01-01"})

    assert resp.status_code == 200
    db_session.expire_all()
    despues = client.get(f"/api/v1/membresias/persona/{persona.id}").json()[0]
    for campo in ("estado", "fechaActivacion", "cubiertoHasta", "montoAplicado"):
        assert despues[campo] == antes[campo]
    assert client.get(f"/api/v1/membresias/{membresia.id}/deuda").json() == deuda_antes
    assert db_session.get(Membresia, membresia.id).estado == EstadoMembresia.ACTIVA
