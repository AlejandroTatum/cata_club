"""Tests de la regla de negocio: `categoria` en `HorarioEntrenamiento` bloquea
`hora_inicio`/`hora_fin` a los valores canónicos de la tabla `categoria_horario`
y restringe `dia_semana` al conjunto de días permitido por la categoría."""
import pytest

from app.dominio.enums import Categoria, DiaSemana
from app.dominio.excepciones import OperacionInvalida
from app.presentacion.schemas.asistencia_schemas import HorarioCreateDTO, HorarioUpdateDTO
from app.servicios_negocio.asistencia_servicio import AsistenciaServicio
from datetime import time


def test_crear_horario_deriva_hora_inicio_y_fin_de_la_categoria(db_session):
    servicio = AsistenciaServicio(db_session)

    horario = servicio.crear_horario(HorarioCreateDTO(
        categoria=Categoria.INFANTIL, dia_semana=DiaSemana.LUNES,
    ))

    assert horario.hora_inicio == time(16, 0)
    assert horario.hora_fin == time(17, 0)


def test_crear_horario_deriva_horas_distintas_para_otra_categoria(db_session):
    """Triangulación: distinta categoría -> distinta franja horaria derivada."""
    servicio = AsistenciaServicio(db_session)

    horario = servicio.crear_horario(HorarioCreateDTO(
        categoria=Categoria.ADULTOS, dia_semana=DiaSemana.MARTES,
    ))

    assert horario.hora_inicio == time(20, 0)
    assert horario.hora_fin == time(21, 15)


def test_crear_horario_rechaza_dia_fuera_del_conjunto_de_la_categoria(db_session):
    """FORMATIVO solo permite Lun-Vie: Sábado debe ser rechazado."""
    servicio = AsistenciaServicio(db_session)

    with pytest.raises(OperacionInvalida):
        servicio.crear_horario(HorarioCreateDTO(
            categoria=Categoria.FORMATIVO, dia_semana=DiaSemana.SABADO,
        ))


def test_crear_horario_competitivo_permite_sabado(db_session):
    """Triangulación: COMPETITIVO sí permite Sábado (a diferencia de las otras 4)."""
    servicio = AsistenciaServicio(db_session)

    horario = servicio.crear_horario(HorarioCreateDTO(
        categoria=Categoria.COMPETITIVO, dia_semana=DiaSemana.SABADO,
    ))

    assert horario.dia_semana == DiaSemana.SABADO
    assert horario.hora_inicio == time(18, 0)
    assert horario.hora_fin == time(20, 0)


def test_actualizar_horario_re_deriva_horas_al_cambiar_categoria(db_session):
    servicio = AsistenciaServicio(db_session)
    horario = servicio.crear_horario(HorarioCreateDTO(
        categoria=Categoria.INFANTIL, dia_semana=DiaSemana.LUNES,
    ))

    actualizado = servicio.actualizar_horario(
        horario.id, HorarioUpdateDTO(categoria=Categoria.JUVENIL, dia_semana=DiaSemana.LUNES)
    )

    assert actualizado.hora_inicio == time(17, 0)
    assert actualizado.hora_fin == time(18, 0)


def test_actualizar_horario_rechaza_dia_incompatible_con_nueva_categoria(db_session):
    servicio = AsistenciaServicio(db_session)
    horario = servicio.crear_horario(HorarioCreateDTO(
        categoria=Categoria.COMPETITIVO, dia_semana=DiaSemana.SABADO,
    ))

    with pytest.raises(OperacionInvalida):
        servicio.actualizar_horario(horario.id, HorarioUpdateDTO(categoria=Categoria.JUVENIL))


def test_get_horarios_filtra_por_query_param_categoria(client):
    """Integración: `GET /asistencias/horarios?categoria=X` solo retorna los
    horarios de esa categoría."""
    client.post("/api/v1/asistencias/horarios", json={
        "categoria": "JUVENIL", "dia_semana": "LUNES",
    })
    client.post("/api/v1/asistencias/horarios", json={
        "categoria": "ADULTOS", "dia_semana": "MARTES",
    })

    resp = client.get("/api/v1/asistencias/horarios", params={"categoria": "ADULTOS"})

    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["categoria"] == "ADULTOS"


# `test_actualizar_horario_sin_tocar_categoria_no_re_deriva_horas` murió con
# `entrenador_id` (issue #13): categoria y dia_semana son hoy los únicos campos
# actualizables y ambos re-derivan las horas, así que ya no existe una
# actualización que no las recalcule.
