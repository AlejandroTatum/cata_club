"""Tests de la regla de negocio: `categoria` en `HorarioEntrenamiento` bloquea
`hora_inicio`/`hora_fin` a los valores canónicos de la tabla `categoria_horario`
y restringe `dia_semana` al conjunto de días permitido por la categoría."""
import pytest

from app.dominio.enums import Categoria, DiaSemana
from app.dominio.excepciones import OperacionInvalida
from app.dominio.modelos import CategoriaHorario, CategoriaHorarioDia
from app.servicios_negocio.dtos.asistencia_schemas import HorarioCreateDTO, HorarioUpdateDTO
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


# --- INS-3: una sola fila por (categoria, dia_semana) -----------------------
# Decisión de negocio #5 (2026-08-11): es invariante, con candado en la base.
# Las horas se derivan de la categoria, así que dos filas Formativo-Lunes
# serían idénticas -- no existe el caso legítimo de "dos grupos el mismo día".
def test_crear_horario_rechaza_dia_ya_existente_en_la_categoria(db_session):
    """Sin este chequeo, la segunda llamada crearía una fila duplicada en
    silencio: mismo categoria+día, mismas horas derivadas, y cualquier
    alumno asignado después queda enrolado en AMBAS (rompe la inscripción
    atómica del issue #181)."""
    servicio = AsistenciaServicio(db_session)
    servicio.crear_horario(HorarioCreateDTO(
        categoria=Categoria.FORMATIVO, dia_semana=DiaSemana.LUNES,
    ))

    with pytest.raises(OperacionInvalida) as exc_info:
        servicio.crear_horario(HorarioCreateDTO(
            categoria=Categoria.FORMATIVO, dia_semana=DiaSemana.LUNES,
        ))

    # Mensaje legible, no un IntegrityError crudo de Postgres.
    assert "Formativo" in str(exc_info.value)
    assert "lunes" in str(exc_info.value)
    assert len(servicio.listar_horarios(Categoria.FORMATIVO)) == 1


# --- M1: la categoría se lee de la tabla, no del enum Python -----------------
# El enum `Categoria` (FORMATIVO/INFANTIL/JUVENIL/COMPETITIVO/ADULTOS) sigue
# existiendo como constante con nombre, pero desde M1 ya NO gatea qué código
# acepta la API: la fila real vive en `categoria_horario`, y un admin puede
# sumar una categoría ahí sin que exista deploy de código ni miembro nuevo en
# el enum (`CategoriaHorario.__doc__`). Este test siembra una SEXTA categoría
# directamente en la tabla -- fuera del enum a propósito -- y prueba que
# funciona de punta a punta: filtro de horarios (antes 422 por el `Query`
# tipado `Categoria`) y el mensaje de usuario con su label real (antes
# `KeyError`/`ValueError` en `categoria_en_castellano`, que ya no existe).
def test_categoria_seedeada_fuera_del_enum_funciona_de_punta_a_punta(client, db_session):
    db_session.add(CategoriaHorario(
        codigo="BEGINNERS", label="Principiantes",
        hora_inicio=time(14, 0), hora_fin=time(15, 0),
    ))
    db_session.add(CategoriaHorarioDia(categoria_codigo="BEGINNERS", dia_semana=DiaSemana.LUNES))
    db_session.commit()

    # 1. El filtro de /horarios no debe 422ear por un código fuera del enum.
    resp = client.get("/api/v1/asistencias/horarios", params={"categoria": "BEGINNERS"})
    assert resp.status_code == 200
    assert resp.json() == []

    # 2. El mensaje de usuario debe llevar el label REAL de la tabla
    # ("Principiantes"), no reventar con KeyError/ValueError.
    servicio = AsistenciaServicio(db_session)
    servicio.crear_horario(HorarioCreateDTO(categoria="BEGINNERS", dia_semana=DiaSemana.LUNES))

    with pytest.raises(OperacionInvalida) as exc_info:
        servicio.crear_horario(HorarioCreateDTO(categoria="BEGINNERS", dia_semana=DiaSemana.LUNES))

    assert "Principiantes" in str(exc_info.value)


def test_crear_horario_permite_mismo_dia_en_otra_categoria(db_session):
    """Triangulación: el candado es por PAR (categoria, día), no por día
    suelto -- dos categorías distintas sí pueden compartir el Lunes."""
    servicio = AsistenciaServicio(db_session)
    servicio.crear_horario(HorarioCreateDTO(
        categoria=Categoria.FORMATIVO, dia_semana=DiaSemana.LUNES,
    ))

    otra = servicio.crear_horario(HorarioCreateDTO(
        categoria=Categoria.JUVENIL, dia_semana=DiaSemana.LUNES,
    ))

    assert otra.dia_semana == DiaSemana.LUNES
