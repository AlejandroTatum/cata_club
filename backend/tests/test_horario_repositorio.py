"""Cobertura directa de `HorarioRepositorio` (CRUD + filtro por categoria).

Cierra el hueco de cobertura cero pre-existente detectado en el blast-radius
de PR #70 (el repositorio solo se ejercitaba indirectamente vía el servicio/
router, nunca con asserts directos sobre sus métodos)."""
from datetime import time

from app.dominio.enums import Categoria, DiaSemana
from app.dominio.modelos import HorarioEntrenamiento
from app.infraestructura.repositorios.asistencia_repositorio import HorarioRepositorio

def _horario(categoria: Categoria, dia: DiaSemana, h_inicio: time, h_fin: time) -> HorarioEntrenamiento:
    return HorarioEntrenamiento(
        categoria=categoria, dia_semana=dia, hora_inicio=h_inicio, hora_fin=h_fin,
    )


def test_crear_persiste_y_retorna_horario_con_id_asignado(db_session):
    repo = HorarioRepositorio(db_session)

    creado = repo.crear(_horario(Categoria.JUVENIL, DiaSemana.LUNES, time(17, 0), time(18, 0)))

    assert creado.id is not None
    assert repo.obtener_por_id(creado.id).categoria == Categoria.JUVENIL


def test_listar_sin_filtro_retorna_todos_los_horarios(db_session):
    repo = HorarioRepositorio(db_session)
    repo.crear(_horario(Categoria.JUVENIL, DiaSemana.LUNES, time(17, 0), time(18, 0)))
    repo.crear(_horario(Categoria.ADULTOS, DiaSemana.MARTES, time(20, 0), time(21, 15)))

    resultado = repo.listar()

    assert len(resultado) == 2


def test_listar_con_filtro_categoria_retorna_solo_esa_categoria(db_session):
    """Triangulación: mismo dataset, distinto filtro -> distinto subconjunto."""
    repo = HorarioRepositorio(db_session)
    repo.crear(_horario(Categoria.JUVENIL, DiaSemana.LUNES, time(17, 0), time(18, 0)))
    repo.crear(_horario(Categoria.JUVENIL, DiaSemana.MARTES, time(17, 0), time(18, 0)))
    repo.crear(_horario(Categoria.ADULTOS, DiaSemana.MIERCOLES, time(20, 0), time(21, 15)))

    solo_juvenil = repo.listar(categoria=Categoria.JUVENIL)
    solo_adultos = repo.listar(categoria=Categoria.ADULTOS)

    assert len(solo_juvenil) == 2
    assert all(h.categoria == Categoria.JUVENIL for h in solo_juvenil)
    assert len(solo_adultos) == 1
    assert solo_adultos[0].categoria == Categoria.ADULTOS


def test_actualizar_persiste_cambios_en_el_horario(db_session):
    repo = HorarioRepositorio(db_session)
    horario = repo.crear(_horario(Categoria.JUVENIL, DiaSemana.LUNES, time(17, 0), time(18, 0)))

    horario.dia_semana = DiaSemana.MARTES
    actualizado = repo.actualizar(horario)

    assert actualizado.dia_semana == DiaSemana.MARTES
    assert repo.obtener_por_id(horario.id).dia_semana == DiaSemana.MARTES


def test_eliminar_borra_el_horario(db_session):
    repo = HorarioRepositorio(db_session)
    horario = repo.crear(_horario(Categoria.JUVENIL, DiaSemana.LUNES, time(17, 0), time(18, 0)))

    repo.eliminar(horario)

    assert repo.obtener_por_id(horario.id) is None


def test_obtener_por_id_retorna_none_si_no_existe(db_session):
    repo = HorarioRepositorio(db_session)

    assert repo.obtener_por_id(9999) is None
