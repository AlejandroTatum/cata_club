from datetime import time

from app.dominio.enums import DiaSemana
from app.dominio.modelos import CategoriaHorario, CategoriaHorarioDia


RUTA = "/api/v1/asistencias/horarios-publicos"


def test_public_schedule_catalog_is_available_without_auth_and_empty(client_sin_permisos, monkeypatch):
    monkeypatch.setattr("app.servicios_negocio.asistencia_servicio.AsistenciaServicio.listar_categorias", lambda self: [])

    response = client_sin_permisos.get(RUTA)

    assert response.status_code == 200
    assert response.json() == []


def test_public_schedule_catalog_groups_ordered_blocks_without_internal_fields(
    client_sin_permisos, db_session
):
    adultos = CategoriaHorario(
        codigo="public-adultos", label="Public Adultos", hora_inicio=time(8), hora_fin=time(9, 15),
        dias_permitidos=[CategoriaHorarioDia(dia_semana=DiaSemana.VIERNES)],
    )
    formativo = CategoriaHorario(
        codigo="public-formativo", label="Public Formativo", hora_inicio=time(15), hora_fin=time(16),
        dias_permitidos=[
            CategoriaHorarioDia(dia_semana=DiaSemana.MIERCOLES),
            CategoriaHorarioDia(dia_semana=DiaSemana.LUNES),
        ],
    )
    db_session.add_all([adultos, formativo])
    db_session.commit()

    response = client_sin_permisos.get(RUTA)

    assert response.status_code == 200
    body = response.json()
    public_items = [item for item in body if item["category"].startswith("Public ")]
    assert public_items == [
        {
            "category": "Public Adultos",
            "blocks": [{"days": ["VIERNES"], "startTime": "08:00", "endTime": "09:15"}],
        },
        {
            "category": "Public Formativo",
            "blocks": [{"days": ["LUNES", "MIERCOLES"], "startTime": "15:00", "endTime": "16:00"}],
        },
    ]
    assert [item["category"] for item in body] == sorted(item["category"] for item in body)
    assert all(set(item) == {"category", "blocks"} for item in body)
