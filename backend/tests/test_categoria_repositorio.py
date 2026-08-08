"""Tests de `CategoriaRepositorio`: fuente única de verdad para las 5
categorías fijas de horario (edad, hora_inicio/hora_fin, días permitidos),
ahora una tabla (`categoria_horario` + `categoria_horario_dia`) sembrada por
la migración `a4e7c2f9b1d8` en vez de un `dict` en memoria."""
from datetime import time

from app.dominio.enums import DiaSemana
from app.infraestructura.repositorios.categoria_repositorio import CategoriaRepositorio

LUN_VIE = frozenset({
    DiaSemana.LUNES, DiaSemana.MARTES, DiaSemana.MIERCOLES,
    DiaSemana.JUEVES, DiaSemana.VIERNES,
})
LUN_SAB = LUN_VIE | {DiaSemana.SABADO}


def _dias(categoria) -> frozenset[DiaSemana]:
    return frozenset(d.dia_semana for d in categoria.dias_permitidos)


def test_categoria_horario_tiene_las_5_categorias_con_horas_correctas(db_session):
    repo = CategoriaRepositorio(db_session)

    assert repo.obtener_por_codigo("FORMATIVO").hora_inicio == time(15, 0)
    assert repo.obtener_por_codigo("FORMATIVO").hora_fin == time(16, 0)

    assert repo.obtener_por_codigo("INFANTIL").hora_inicio == time(16, 0)
    assert repo.obtener_por_codigo("INFANTIL").hora_fin == time(17, 0)

    assert repo.obtener_por_codigo("JUVENIL").hora_inicio == time(17, 0)
    assert repo.obtener_por_codigo("JUVENIL").hora_fin == time(18, 0)

    assert repo.obtener_por_codigo("COMPETITIVO").hora_inicio == time(18, 0)
    assert repo.obtener_por_codigo("COMPETITIVO").hora_fin == time(20, 0)

    assert repo.obtener_por_codigo("ADULTOS").hora_inicio == time(20, 0)
    assert repo.obtener_por_codigo("ADULTOS").hora_fin == time(21, 15)


def test_dias_permitidos_competitivo_incluye_sabado(db_session):
    repo = CategoriaRepositorio(db_session)
    assert _dias(repo.obtener_por_codigo("COMPETITIVO")) == LUN_SAB


def test_dias_permitidos_otras_categorias_no_incluyen_sabado(db_session):
    repo = CategoriaRepositorio(db_session)
    assert _dias(repo.obtener_por_codigo("FORMATIVO")) == LUN_VIE
    assert _dias(repo.obtener_por_codigo("INFANTIL")) == LUN_VIE
    assert _dias(repo.obtener_por_codigo("JUVENIL")) == LUN_VIE
    assert _dias(repo.obtener_por_codigo("ADULTOS")) == LUN_VIE


def test_obtener_por_codigo_desconocido_retorna_none(db_session):
    repo = CategoriaRepositorio(db_session)
    assert repo.obtener_por_codigo("NO_EXISTE") is None


def test_listar_retorna_las_5_categorias(db_session):
    repo = CategoriaRepositorio(db_session)
    codigos = {c.codigo for c in repo.listar()}
    assert codigos == {"FORMATIVO", "INFANTIL", "JUVENIL", "COMPETITIVO", "ADULTOS"}
