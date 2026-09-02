"""Tests de la auditoría de colisiones de correo por capitalización
(issue #902, fase B de #827; la fase A sigue abierta y no entregó nada).

Cubre detección correcta, cero fuga de PII en la salida, y cero
escrituras demostrado (listener de sentencias + rechazo real del server)."""
import os

import pytest
from sqlalchemy import create_engine, event, text
from sqlalchemy.exc import DBAPIError

from app.dominio.modelos import Usuario
from scripts.auditar_colisiones_correo import (
    abrir_sesion_solo_lectura,
    detectar_colisiones,
    formatear_json,
    formatear_texto,
)
from tests.fabricas_pagos import crear_persona_orm


def _crear_usuario(db_session, cedula, correo, activo=True) -> Usuario:
    persona = crear_persona_orm(db_session, cedula)
    usuario = Usuario(correo=correo, contrasenia="hash", persona_id=persona.id, activo=activo)
    db_session.add(usuario)
    db_session.flush()
    return usuario


# --- Detección ---------------------------------------------------------------

def test_detecta_par_en_colision_y_reporta_activo_por_id(db_session):
    uno = _crear_usuario(db_session, "1710034065", "Colision@Ejemplo.test", activo=True)
    dos = _crear_usuario(db_session, "1710034073", "colision@ejemplo.test", activo=False)
    db_session.commit()

    resultado = detectar_colisiones(db_session)

    assert resultado["buckets_en_colision"] == 1
    assert resultado["usuarios_en_colision"] == 2
    bucket = resultado["buckets"][0]
    assert bucket["cantidad"] == 2
    assert sorted(bucket["ids"]) == sorted([uno.id, dos.id])
    por_id = dict(zip(bucket["ids"], bucket["activos"]))
    assert por_id[uno.id] is True
    assert por_id[dos.id] is False


def test_detecta_bucket_triple(db_session):
    a = _crear_usuario(db_session, "1710034065", "trio@ejemplo.test")
    b = _crear_usuario(db_session, "1710034073", "Trio@Ejemplo.test")
    c = _crear_usuario(db_session, "1710034081", "TRIO@EJEMPLO.TEST")
    db_session.commit()

    resultado = detectar_colisiones(db_session)

    bucket = next(bk for bk in resultado["buckets"] if bk["cantidad"] == 3)
    assert sorted(bucket["ids"]) == sorted([a.id, b.id, c.id])


def test_usuarios_no_colisionados_quedan_afuera(db_session):
    _crear_usuario(db_session, "1710034065", "sola@ejemplo.test")
    _crear_usuario(db_session, "1710034073", "otra@ejemplo.test")
    db_session.commit()

    resultado = detectar_colisiones(db_session)

    assert resultado["buckets_en_colision"] == 0
    assert resultado["usuarios_en_colision"] == 0
    assert resultado["buckets"] == []
    assert resultado["total_usuarios"] == 2


# --- Huellas: no reversibles, estables dentro de una corrida -----------------

def test_huellas_son_hex_de_12_y_distintas_por_bucket(db_session):
    _crear_usuario(db_session, "1710034065", "hash@ejemplo.test")
    _crear_usuario(db_session, "1710034073", "Hash@Ejemplo.test")
    _crear_usuario(db_session, "1710034081", "otro@ejemplo.test")
    _crear_usuario(db_session, "1710034099", "Otro@Ejemplo.test")
    db_session.commit()

    resultado = detectar_colisiones(db_session)

    huellas = [bucket["huella"] for bucket in resultado["buckets"]]
    assert len(huellas) == 2 == len(set(huellas))
    for huella in huellas:
        assert len(huella) == 12
        int(huella, 16)


# --- Cero fuga de PII en la salida --------------------------------------------

CORREOS_SEMBRADOS = [
    "Filtrado@Ejemplo.test",
    "filtrado@ejemplo.test",
    "solitario@ejemplo.test",
]


def test_salida_no_contiene_correos_ni_arrobas(db_session):
    _crear_usuario(db_session, "1710034065", CORREOS_SEMBRADOS[0])
    _crear_usuario(db_session, "1710034073", CORREOS_SEMBRADOS[1])
    _crear_usuario(db_session, "1710034081", CORREOS_SEMBRADOS[2])
    db_session.commit()

    resultado = detectar_colisiones(db_session)
    salida_json = formatear_json(resultado)
    salida_texto = formatear_texto(resultado)

    for correo in CORREOS_SEMBRADOS:
        assert correo not in salida_json
        assert correo.lower() not in salida_json.lower()
        assert correo not in salida_texto
        assert correo.lower() not in salida_texto.lower()
    assert "@" not in salida_json
    assert "@" not in salida_texto


# --- Cero escrituras: demostrado con un listener ------------------------------

def test_detector_solo_emite_select_o_with(db_session):
    _crear_usuario(db_session, "1710034065", "solo-lectura@ejemplo.test")
    _crear_usuario(db_session, "1710034073", "Solo-Lectura@Ejemplo.test")
    db_session.commit()

    sentencias: list[str] = []

    def _registrar(conn, cursor, statement, parameters, context, executemany):
        sentencias.append(statement)

    conexion = db_session.connection()
    event.listen(conexion, "before_cursor_execute", _registrar)
    try:
        detectar_colisiones(db_session)
    finally:
        event.remove(conexion, "before_cursor_execute", _registrar)

    assert sentencias
    for sentencia in sentencias:
        inicio = sentencia.strip().upper()
        assert inicio.startswith("SELECT") or inicio.startswith("WITH")


# --- Cero escrituras: demostrado por el propio servidor -----------------------

def test_sesion_solo_lectura_rechaza_un_insert(db_session):
    url = os.environ["TEST_DATABASE_URL"]
    engine = create_engine(url)
    persona = crear_persona_orm(db_session, "1710034065")
    db_session.commit()
    try:
        sesion = abrir_sesion_solo_lectura(engine)
        try:
            with pytest.raises(DBAPIError) as excinfo:
                sesion.execute(
                    text(
                        "INSERT INTO usuario (correo, contrasenia, persona_id) "
                        "VALUES ('nunca@ejemplo.test', 'hash', :persona_id)"
                    ),
                    {"persona_id": persona.id},
                )
            assert "read-only transaction" in str(excinfo.value).lower()
        finally:
            sesion.rollback()
            sesion.close()
    finally:
        engine.dispose()
