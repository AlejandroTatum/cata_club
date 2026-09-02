"""Tests del backfill reversible de normalización de nombres (issue #875):
plan/conteos de solo lectura, el candado de --confirmar-cambios, el ciclo
aplicar/revertir con criterio optimista, y que el parser no admita ninguna
ruta por argv (mismo candado de path injection de Sonar que #949)."""
import json
import os
import stat
from datetime import date

import pytest
from sqlalchemy import event, insert, select, update

from app.dominio.cedula import cedula_valida
from app.dominio.modelos import Persona
from scripts.backfill_normalizacion_nombres import (
    aplicar,
    construir_parser,
    construir_plan,
    construir_ruta_artifact,
    escribir_artifact,
    revertir,
    validar_argumentos,
)
from tests.fabricas_pagos import crear_persona_orm

_LEGACY_1 = (cedula_valida(780), "faby", "ESPINOZA")
_LEGACY_2 = (cedula_valida(781), "MARÍA josé", "de la cruz")


def _sembrar(db_session):
    # `@validates` normaliza en el constructor de `Persona`; un INSERT de
    # Core lo saltea y simula la fila LEGACY, previa a la regla.
    for cedula, nombres, apellidos in (_LEGACY_1, _LEGACY_2):
        db_session.execute(insert(Persona).values(
            cedula=cedula, nombres=nombres, apellidos=apellidos,
            fecha_nacimiento=date(1990, 1, 1), telefono="0990001111",
        ))
    canonico = crear_persona_orm(db_session, cedula_valida(782), nombres="Juan Pérez", apellidos="García López")
    ambiguo = crear_persona_orm(db_session, cedula_valida(783), nombres="d'angelo", apellidos="McArthur")
    db_session.commit()
    return canonico, ambiguo


def _valor(db_session, cedula, campo):
    return db_session.execute(select(getattr(Persona, campo)).where(Persona.cedula == cedula)).scalar_one()


def test_construir_plan_reporta_conteos_y_cambios_sin_escribir(db_session):
    _sembrar(db_session)
    sentencias: list[str] = []
    _registrar = lambda conn, cur, st, params, ctx, many: sentencias.append(st)  # noqa: E731
    conexion = db_session.connection()
    event.listen(conexion, "before_cursor_execute", _registrar)
    try:
        plan = construir_plan(db_session)
    finally:
        event.remove(conexion, "before_cursor_execute", _registrar)

    assert len(plan.cambios) == 4  # 2 filas legacy x 2 campos
    assert plan.total_filas == 4
    assert plan.conteos["nombres"]["cambio_propuesto"] == 2
    assert plan.conteos["apellidos"]["cambio_propuesto"] == 2
    assert plan.conteos["nombres"]["ambiguo"] == 1  # d'angelo
    assert plan.conteos["apellidos"]["ambiguo"] == 1  # McArthur
    assert sentencias and all(s.strip().upper().startswith(("SELECT", "WITH")) for s in sentencias)


def test_aplicar_rechaza_conteo_no_coincide_y_no_escribe(db_session, tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    _sembrar(db_session)
    plan = construir_plan(db_session)
    with pytest.raises(ValueError):
        aplicar(db_session, plan, len(plan.cambios) + 1)
    assert _valor(db_session, _LEGACY_1[0], "nombres") == "faby"  # intacto
    assert not (tmp_path / "artifacts-restringidos").exists()


def test_aplicar_normaliza_legacy_deja_artifact_y_es_idempotente(db_session, tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    _sembrar(db_session)
    plan = construir_plan(db_session)
    assert len(plan.cambios) == 4
    resultado = aplicar(db_session, plan, 4)
    assert resultado["aplicados"] == 4
    assert resultado["omitidos"] == 0
    assert _valor(db_session, _LEGACY_1[0], "nombres") == "Faby"
    assert _valor(db_session, _LEGACY_1[0], "apellidos") == "Espinoza"
    assert _valor(db_session, _LEGACY_2[0], "nombres") == "María José"
    assert _valor(db_session, _LEGACY_2[0], "apellidos") == "De la Cruz"
    assert _valor(db_session, cedula_valida(782), "nombres") == "Juan Pérez"  # canónica intacta
    assert _valor(db_session, cedula_valida(783), "nombres") == "d'angelo"  # ambigua intacta

    ruta = resultado["ruta"]
    assert stat.S_IMODE(os.stat(ruta).st_mode) == 0o600
    assert len(json.loads(ruta.read_text(encoding="utf-8"))["cambios"]) == 4
    plan_despues = construir_plan(db_session)
    assert plan_despues.conteos["nombres"]["cambio_propuesto"] == 0
    assert plan_despues.conteos["apellidos"]["cambio_propuesto"] == 0
    assert plan_despues.conteos["nombres"]["ambiguo"] == 1  # sin cambios
    resultado_2 = aplicar(db_session, plan_despues, 0)
    assert resultado_2 == {"ruta": None, "aplicados": 0, "omitidos": 0}  # nada que artifactar


def test_revertir_restaura_y_omite_fila_modificada_despues(db_session, tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    _sembrar(db_session)
    plan = construir_plan(db_session)
    aplicar(db_session, plan, len(plan.cambios))
    # Alguien edita la fila 1 DESPUÉS del backfill: `revertir` no debe pisarla.
    db_session.execute(update(Persona).where(Persona.cedula == _LEGACY_1[0]).values(nombres="Editado"))
    db_session.commit()
    resultado = revertir(db_session)
    assert resultado["restaurados"] == 3
    assert resultado["omitidos"] == 1
    assert _valor(db_session, _LEGACY_1[0], "nombres") == "Editado"  # se salteó
    assert _valor(db_session, _LEGACY_1[0], "apellidos") == "ESPINOZA"  # restaurado
    assert _valor(db_session, _LEGACY_2[0], "nombres") == "MARÍA josé"
    assert _valor(db_session, _LEGACY_2[0], "apellidos") == "de la cruz"
    assert len(list((tmp_path / "artifacts-restringidos").iterdir())) == 1  # no se borra


def test_revertir_sin_artifact_no_hace_nada(db_session, tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    assert revertir(db_session) == {"ruta": None, "restaurados": 0, "omitidos": 0}


def test_revertir_rechaza_campo_fuera_de_lista_blanca_sin_escribir(db_session, tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    escribir_artifact(
        {"cambios": [{"persona_id": 1, "campo": "cedula", "antes": "1", "despues": "2"}]},
        construir_ruta_artifact(),
    )
    sentencias: list[str] = []
    _registrar = lambda conn, cur, st, params, ctx, many: sentencias.append(st)  # noqa: E731
    conexion = db_session.connection()
    event.listen(conexion, "before_cursor_execute", _registrar)
    try:
        with pytest.raises(ValueError):
            revertir(db_session)
    finally:
        event.remove(conexion, "before_cursor_execute", _registrar)
    assert not any(s.strip().upper().startswith("UPDATE") for s in sentencias)  # nada escrito


def test_parser_no_admite_ninguna_ruta_por_argv():
    dests = {accion.dest for accion in construir_parser()._actions}
    assert dests == {"help", "aplicar", "confirmar_cambios", "revertir"}


@pytest.mark.parametrize("argv", [
    ["--aplicar", "--confirmar-cambios", "1", "--revertir"],  # mutuamente excluyentes
    ["--aplicar"],  # falta --confirmar-cambios
])
def test_validar_argumentos_rechaza_combinaciones_invalidas(argv):
    parser = construir_parser()
    with pytest.raises(SystemExit):
        validar_argumentos(parser, parser.parse_args(argv))
