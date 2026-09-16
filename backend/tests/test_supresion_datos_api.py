"""Router admin de supresión de datos (issue #1062, tarea T4).

Verifica por HTTP el ciclo RECIBIDA -> APROBADA -> EJECUTADA, el listado y
detalle, y el requerimiento de rol administrador. Los helpers mínimos están
duplicados desde `test_supresion_datos.py` para que este archivo sea
autocontenido (los endpoints y el wiring de `main.py` viven en el PR2 de la
cadena).
"""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.dominio.modelos import Persona, SolicitudSupresionDatos
from app.servicios_negocio.supresion_datos_servicio import (
    DIAS_GRACIA, SupresionDatosServicio,
)


# --- Fábricas (duplicadas mínimas; ver test_supresion_datos.py) ------------------
def _crear_persona(db_session, cedula="1710034065", nombres="Ana", apellidos="Vega",
                   con_foto=False, fecha_nacimiento=None) -> Persona:
    from datetime import date
    persona = Persona(
        nombres=nombres, apellidos=apellidos, cedula=cedula,
        fecha_nacimiento=fecha_nacimiento or date(1990, 1, 1),
        telefono="0990000000", telefono_contacto="022000000",
        foto_url="perfil_ana|7" if con_foto else None,
    )
    db_session.add(persona)
    db_session.commit()
    db_session.refresh(persona)
    return persona


def _crear_admin(db_session) -> Persona:
    return _crear_persona(db_session, cedula="1710010008", nombres="Admin",
                          apellidos="Club")


@pytest.fixture()
def cloudinary_falso(monkeypatch):
    class _Registro:
        def __init__(self):
            self.llamadas = []

        def __call__(self, nombre_publico, *, carpeta, resource_type, tipo, descripcion):
            self.llamadas.append((nombre_publico, carpeta, resource_type, tipo))

    registro = _Registro()
    monkeypatch.setattr(
        "app.servicios_negocio.supresion_datos_servicio.eliminar_recurso_privado",
        registro,
    )
    return registro


def _solicitud_aprobada_y_vencida(db_session, servicio, persona):
    solicitud = servicio.crear(persona.id, "cierre de cuenta", admin_persona_id=1)
    solicitud.fecha_solicitud = datetime.now(timezone.utc) - timedelta(days=DIAS_GRACIA + 1)
    db_session.commit()
    servicio.aprobar(solicitud.id, admin_persona_id=1)
    return solicitud


# --- T4: ciclo completo por los endpoints -----------------------------------------
def test_ciclo_completo_por_los_endpoints(client: TestClient, db_session, cloudinary_falso):
    _crear_admin(db_session)
    persona = _crear_persona(db_session, cedula="1710010032")
    respuesta = client.post(
        "/api/v1/supresion-datos/",
        json={"persona_id": persona.id, "motivo": "cierre de cuenta"},
    )
    assert respuesta.status_code == 201
    solicitud_id = respuesta.json()["id"]
    assert respuesta.json()["estado"] == "RECIBIDA"

    # Ejecutar sin aprobación ni gracia: 400.
    assert client.post(f"/api/v1/supresion-datos/{solicitud_id}/ejecutar").status_code == 400

    # Aprobar por API; vencer la gracia desde el test; ejecutar por API.
    assert client.post(f"/api/v1/supresion-datos/{solicitud_id}/aprobar").status_code == 200
    solicitud = db_session.get(SolicitudSupresionDatos, solicitud_id)
    solicitud.fecha_solicitud = datetime.now(timezone.utc) - timedelta(days=DIAS_GRACIA + 1)
    db_session.commit()
    respuesta = client.post(f"/api/v1/supresion-datos/{solicitud_id}/ejecutar")
    assert respuesta.status_code == 200
    assert respuesta.json()["estado"] == "EJECUTADA"

    db_session.expire_all()
    assert db_session.get(Persona, persona.id).nombres == "ANONIMIZADO"


def test_listar_y_detalle_por_endpoint(client: TestClient, db_session, cloudinary_falso):
    _crear_admin(db_session)
    persona = _crear_persona(db_session, cedula="1710010040")
    servicio = SupresionDatosServicio(db_session)
    servicio.crear(persona.id, "cierre", admin_persona_id=1)

    lista = client.get("/api/v1/supresion-datos/")
    assert lista.status_code == 200
    assert len(lista.json()) == 1
    detalle = client.get(f"/api/v1/supresion-datos/{lista.json()[0]['id']}")
    assert detalle.status_code == 200
    assert detalle.json()["motivo"] == "cierre"


def test_endpoints_requieren_administrador(client_sin_permisos: TestClient, db_session):
    _crear_admin(db_session)
    persona = _crear_persona(db_session, cedula="1710010057")
    respuesta = client_sin_permisos.post(
        "/api/v1/supresion-datos/",
        json={"persona_id": persona.id, "motivo": "cierre"},
    )
    assert respuesta.status_code == 403

    # Regresión de la guardia de autorización (REQ-SEC-2): los dos GET también
    # requieren ADMINISTRADOR -- quedaron públicos en la primera versión del
    # router y la guardia estructural lo detectó.
    assert client_sin_permisos.get("/api/v1/supresion-datos/").status_code == 403
    assert client_sin_permisos.get("/api/v1/supresion-datos/1").status_code == 403
