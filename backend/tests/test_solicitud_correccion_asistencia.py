"""QA4 ENT-25: el entrenador pide a administración corregir una lista cerrada.

El entrenador crea y ve SOLO sus solicitudes; aprobar o rechazar es solo del
administrador. Aprobar aplica la corrección por el mecanismo auditado de
siempre (`AsistenciaServicio.corregir_asistencia`).
"""
from datetime import timedelta

import pytest

import app.servicios_negocio.solicitud_correccion_servicio as servicio_solicitud
from app.dominio.modelos import AsistenciaCorreccion
from app.seguridad.gestor_auth import GestorAutenticacion
from app.dominio.cedula import cedula_valida
from tests.test_asistencias import (
    _HOY_CORRECCION, _congelar_hoy_asistencia, _crear_persona_api, _id_de_la_asistencia,
    _preparar_asistencia_para_corregir, _restaurar_token_entrenador,
)

BASE = "/api/v1/asistencias/solicitudes-correccion"


def _como_entrenador(persona_id):
    from main import app
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": f"entrenador{persona_id}@cataclub.test", "persona_id": persona_id,
        "roles": ["ENTRENADOR"],
    }


def _como_admin():
    from main import app
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": "admin@cataclub.test", "persona_id": 1, "roles": ["ADMINISTRADOR"],
    }


@pytest.fixture()
def lista_cerrada(client, monkeypatch):
    """Una asistencia PRESENTE de hace 5 días; devuelve su id."""
    _congelar_hoy_asistencia(monkeypatch, _HOY_CORRECCION)
    monkeypatch.setattr(servicio_solicitud, "hoy_club", lambda: _HOY_CORRECCION)
    fecha = str(_HOY_CORRECCION - timedelta(days=5))
    payload = _preparar_asistencia_para_corregir(client, fecha)
    return _id_de_la_asistencia(client, payload["persona_id"])


def _dos_entrenadores(client):
    """Dos personas reales (la FK de `solicitado_por_id` exige que existan)."""
    return [
        _crear_persona_api(client, cedula_valida(700 + i), f"Entrenador{'AB'[i]}")["id"]
        for i in range(2)
    ]


def _pedir(cliente, asistencia_id, estado="AUSENTE", motivo="Debía figurar como ausente."):
    return cliente.post(
        BASE,
        json={"asistencia_id": asistencia_id, "estado_solicitado": estado, "motivo": motivo},
    )


def _estado_de(client, asistencia_id):
    historial = client.get(f"/api/v1/asistencias/{asistencia_id}/correcciones").json()
    return historial


def test_entrenador_crea_una_solicitud_pendiente_sin_tocar_la_asistencia(
    client_entrenador, client, lista_cerrada,
):
    _restaurar_token_entrenador()
    resp = _pedir(client_entrenador, lista_cerrada)

    assert resp.status_code == 201, resp.text
    cuerpo = resp.json()
    assert cuerpo["estado"] == "PENDIENTE"
    assert cuerpo["asistenciaId"] == lista_cerrada
    assert cuerpo["estadoActual"] == "PRESENTE"
    assert cuerpo["estadoSolicitado"] == "AUSENTE"
    assert cuerpo["personaNombre"]
    assert cuerpo["solicitadoPorId"] == 1
    _como_admin()
    assert _estado_de(client, lista_cerrada) == []


def test_solicitud_sin_cambio_o_sin_motivo_se_rechaza(client_entrenador, client, lista_cerrada):
    _restaurar_token_entrenador()

    assert _pedir(client_entrenador, lista_cerrada, estado="PRESENTE").status_code == 400
    assert _pedir(client_entrenador, lista_cerrada, motivo="   ").status_code == 400
    assert _pedir(client_entrenador, lista_cerrada, motivo="").status_code == 422


def test_solicitud_de_asistencia_inexistente_es_404(client_entrenador, client, lista_cerrada):
    _restaurar_token_entrenador()
    assert _pedir(client_entrenador, lista_cerrada + 999).status_code == 404


def test_solicitud_fuera_de_la_ventana_de_correccion_se_rechaza(
    client_entrenador, client, lista_cerrada, monkeypatch,
):
    monkeypatch.setattr(
        servicio_solicitud, "hoy_club", lambda: _HOY_CORRECCION + timedelta(days=60),
    )
    _restaurar_token_entrenador()

    resp = _pedir(client_entrenador, lista_cerrada)

    assert resp.status_code == 400
    assert "días" in resp.json()["detail"]


def test_no_se_acepta_una_segunda_solicitud_pendiente_para_la_misma_fila(
    client_entrenador, client, lista_cerrada,
):
    _restaurar_token_entrenador()
    assert _pedir(client_entrenador, lista_cerrada).status_code == 201

    resp = _pedir(client_entrenador, lista_cerrada, estado="ATRASADO")

    assert resp.status_code == 400
    assert "pendiente" in resp.json()["detail"]


def test_el_entrenador_solo_ve_sus_solicitudes_y_el_admin_ve_todas(
    client_entrenador, client, lista_cerrada,
):
    uno, otro = _dos_entrenadores(client)
    _como_entrenador(uno)
    assert _pedir(client_entrenador, lista_cerrada).status_code == 201

    _como_entrenador(otro)
    assert client_entrenador.get(BASE).json() == []

    _como_entrenador(uno)
    propias = client_entrenador.get(BASE).json()
    assert [s["asistenciaId"] for s in propias] == [lista_cerrada]

    _como_admin()
    todas = client.get(BASE, params={"estado": "PENDIENTE"}).json()
    assert [s["asistenciaId"] for s in todas] == [lista_cerrada]
    assert todas[0]["solicitadoPorNombre"] is not None


def test_el_filtro_por_sesion_acota_la_lista(client_entrenador, client, lista_cerrada):
    _restaurar_token_entrenador()
    solicitud = _pedir(client_entrenador, lista_cerrada).json()

    coincide = client_entrenador.get(
        BASE, params={"horario_id": solicitud["horarioId"], "fecha": solicitud["fecha"]},
    ).json()
    otra_fecha = client_entrenador.get(
        BASE, params={"horario_id": solicitud["horarioId"], "fecha": "2020-01-06"},
    ).json()

    assert len(coincide) == 1
    assert otra_fecha == []


def test_el_entrenador_no_puede_aprobar_ni_rechazar(client_entrenador, client, lista_cerrada):
    _restaurar_token_entrenador()
    solicitud = _pedir(client_entrenador, lista_cerrada).json()

    assert client_entrenador.post(f"{BASE}/{solicitud['id']}/aprobar").status_code == 403
    assert client_entrenador.post(
        f"{BASE}/{solicitud['id']}/rechazar", json={"motivo": "No."},
    ).status_code == 403


def test_aprobar_aplica_la_correccion_auditada_y_el_entrenador_ve_el_resultado(
    client_entrenador, client, lista_cerrada, db_session,
):
    uno, _ = _dos_entrenadores(client)
    _como_entrenador(uno)
    solicitud = _pedir(client_entrenador, lista_cerrada).json()

    _como_admin()
    resp = client.post(f"{BASE}/{solicitud['id']}/aprobar")

    assert resp.status_code == 200, resp.text
    assert resp.json()["estado"] == "APROBADA"
    assert resp.json()["resueltoPorId"] == 1
    assert resp.json()["estadoActual"] == "AUSENTE"
    filas = db_session.query(AsistenciaCorreccion).filter_by(asistencia_id=lista_cerrada).all()
    assert len(filas) == 1
    assert filas[0].estado_anterior.value == "PRESENTE"
    assert "Debía figurar como ausente." in filas[0].motivo

    _como_entrenador(uno)
    vista = client_entrenador.get(BASE).json()
    assert vista[0]["estado"] == "APROBADA"

    # Ya resuelta: no se puede resolver otra vez.
    _como_admin()
    assert client.post(f"{BASE}/{solicitud['id']}/aprobar").status_code == 400
    assert client.post(
        f"{BASE}/{solicitud['id']}/rechazar", json={"motivo": "Tarde."},
    ).status_code == 400


def test_rechazar_exige_motivo_y_deja_la_asistencia_intacta(
    client_entrenador, client, lista_cerrada, db_session,
):
    uno, _ = _dos_entrenadores(client)
    _como_entrenador(uno)
    solicitud = _pedir(client_entrenador, lista_cerrada).json()

    _como_admin()
    assert client.post(
        f"{BASE}/{solicitud['id']}/rechazar", json={"motivo": "   "},
    ).status_code == 400
    resp = client.post(
        f"{BASE}/{solicitud['id']}/rechazar", json={"motivo": "Vi el video, estaba presente."},
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["estado"] == "RECHAZADA"
    assert resp.json()["motivoResolucion"] == "Vi el video, estaba presente."
    assert resp.json()["estadoActual"] == "PRESENTE"
    assert db_session.query(AsistenciaCorreccion).count() == 0

    # Resuelta la anterior, el entrenador puede pedir de nuevo.
    _como_entrenador(uno)
    assert _pedir(client_entrenador, lista_cerrada, estado="ATRASADO").status_code == 201


def test_aprobar_una_solicitud_inexistente_es_404(client, lista_cerrada):
    assert client.post(f"{BASE}/9999/aprobar").status_code == 404
