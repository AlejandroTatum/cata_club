"""Tests del dry-run de normalización de nombres (issue #904). Clasificación
agregada, cero fuga de PII, cero escrituras y controles del artifact
restringido. El rechazo server-side ya está cubierto en
test_auditar_colisiones_correo.py (issue #902); no se duplica acá."""
import json
import os
import stat
from datetime import date

import pytest
from sqlalchemy import event, insert

from app.dominio.cedula import cedula_valida
from app.dominio.modelos import Persona
from scripts.dry_run_normalizacion_nombres import construir_dry_run, ejecutar, escribir_artifact, formatear_json, formatear_texto
from tests.fabricas_pagos import crear_persona_orm

_TOKENS = ("Juan", "Pérez", "García", "López", "maría", "JOSÉ", "cruz", "angelo", "McArthur")


def _sembrar(db_session):
    canonico = crear_persona_orm(db_session, cedula_valida(201), nombres="Juan Pérez", apellidos="García López")
    # Issue #875: el constructor de `Persona` ya normaliza vía `@validates`,
    # así que sembrar "propuesto" con `Persona(...)` lo dejaría canónico de
    # entrada. Un INSERT de Core (documentado en modelos.py como el camino
    # que SÍ saltea `@validates`) simula la fila LEGACY, previa a la regla,
    # que es justo lo que este dry-run tiene que poder detectar.
    db_session.execute(
        insert(Persona).values(
            cedula=cedula_valida(202), nombres="maría JOSÉ", apellidos="de la cruz",
            fecha_nacimiento=date(1990, 1, 1), telefono="0990001111",
        )
    )
    db_session.flush()
    propuesto = db_session.query(Persona).filter_by(cedula=cedula_valida(202)).one()
    ambiguo = crear_persona_orm(db_session, cedula_valida(203), nombres="d'angelo", apellidos="McArthur")
    db_session.commit()
    return canonico, propuesto, ambiguo


def test_clasifica_personas_por_clase_y_motivo(db_session):
    canonico, propuesto, ambiguo = _sembrar(db_session)
    general = construir_dry_run(db_session)["general"]
    assert canonico.id in general["ids_por_clase"]["sin_cambio"]
    assert propuesto.id in general["ids_por_clase"]["cambio_propuesto"]
    assert ambiguo.id in general["ids_por_clase"]["ambiguo"]
    assert general["conteos_por_clase"]["ambiguo"] == 2  # nombres + apellidos
    assert general["conteos_por_motivo"]["apostrofe"] == 1
    assert general["conteos_por_motivo"]["mayuscula_interior"] == 1


def test_salida_general_no_contiene_nombres_ni_cedulas(db_session):
    _sembrar(db_session)
    cedulas = [cedula_valida(n) for n in (201, 202, 203)]
    general = construir_dry_run(db_session)["general"]
    salida_json, salida_texto = formatear_json(general), formatear_texto(general)
    for pii in (*cedulas, *_TOKENS):
        assert pii not in salida_json
        assert pii not in salida_texto


def test_construir_dry_run_solo_emite_select_o_with(db_session):
    _sembrar(db_session)
    sentencias: list[str] = []
    _registrar = lambda conn, cur, st, params, ctx, many: sentencias.append(st)  # noqa: E731
    conexion = db_session.connection()
    event.listen(conexion, "before_cursor_execute", _registrar)
    try:
        construir_dry_run(db_session)
    finally:
        event.remove(conexion, "before_cursor_execute", _registrar)
    assert sentencias
    assert all(s.strip().upper().startswith(("SELECT", "WITH")) for s in sentencias)


def test_escribir_artifact_permisos_0600_y_rechaza_sobrescribir(tmp_path):
    pares = [{"persona_id": 1, "campo": "nombres", "antes": "x", "despues": "X", "clase": "cambio_propuesto", "motivos": []}]
    ruta = tmp_path / "artifact.json"
    escribir_artifact(pares, ruta)
    assert stat.S_IMODE(os.stat(ruta).st_mode) == 0o600
    assert json.loads(ruta.read_text(encoding="utf-8")) == pares

    with pytest.raises(FileExistsError):
        escribir_artifact([], ruta)
    assert json.loads(ruta.read_text(encoding="utf-8")) == pares  # intacto


def test_ejecutar_escribe_artifact_bajo_cwd_solo_con_la_flag(db_session, tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    _sembrar(db_session)
    directorio = tmp_path / "artifacts-restringidos"

    ejecutar(db_session, como_json=False, artifact=False)
    assert not directorio.exists()

    salida = ejecutar(db_session, como_json=True, artifact=True)
    (archivo,) = directorio.iterdir()
    assert stat.S_IMODE(os.stat(directorio).st_mode) == 0o700
    assert stat.S_IMODE(os.stat(archivo).st_mode) == 0o600
    assert len(json.loads(archivo.read_text(encoding="utf-8"))) == 6  # 3 personas x 2 campos
    assert str(archivo) in salida
