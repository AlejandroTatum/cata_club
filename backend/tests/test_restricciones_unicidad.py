"""
Prueba de que la unicidad declarada en el modelo la aplica de verdad la base.

`AlumnoHorario.__table_args__` declara `uq_alumno_horario` sobre
(`persona_id`, `horario_id`). Esa declaración sola no garantiza nada: es
metadata del ORM. Lo que protege ante dos peticiones concurrentes que pasen
las dos el chequeo previo de `AsistenciaServicio.asignar_alumno_a_horario`
es el constraint real de PostgreSQL, creado por `b2c3d4e5f6a7`. Esta prueba
corre contra el esquema que Alembic aplicó (fixture `esquema_migrado` de
`conftest.py`), así que comprueba el constraint de la base, no el del modelo.
"""
from datetime import date, time

import pytest
from sqlalchemy.exc import IntegrityError

from app.dominio.enums import Categoria, DiaSemana
from app.dominio.modelos import AlumnoHorario, HorarioEntrenamiento, Persona
from tests.conftest import crear_entrenador


def test_alumno_horario_duplicado_viola_uq_alumno_horario(db_session):
    entrenador_id = crear_entrenador(db_session, cedula="1710034589")
    horario = HorarioEntrenamiento(
        dia_semana=DiaSemana.LUNES,
        hora_inicio=time(18, 0),
        hora_fin=time(19, 0),
        categoria=Categoria.JUVENIL,
        entrenador_id=entrenador_id,
    )
    persona = Persona(
        nombres="Duplicada", apellidos="Prueba", cedula="1710034590",
        fecha_nacimiento=date(2000, 1, 1), telefono="0991234567",
    )
    db_session.add_all([horario, persona])
    db_session.flush()

    db_session.add(AlumnoHorario(persona_id=persona.id, horario_id=horario.id))
    db_session.flush()
    db_session.add(AlumnoHorario(persona_id=persona.id, horario_id=horario.id))

    with pytest.raises(IntegrityError, match="uq_alumno_horario"):
        db_session.flush()
