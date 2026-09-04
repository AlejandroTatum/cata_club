"""Tests de la auditoría de colisiones de correo por capitalización
(issue #902, fase B de #827).

Fase A (issue #1016) YA ENTREGÓ desde la migración `d1016emailunico`: un
índice único case-insensitive real en `usuario.correo`. Eso significa que,
desde esa migración, dos filas colisionadas por capitalización NO PUEDEN
coexistir en una base al día -- exactamente lo que este script auditaba.
Sigue teniendo un trabajo real: detectar colisiones LEGADAS en una base
que todavía NO corrió esa migración (el escenario que
`scripts/detectar_correos_duplicados.py` cubre antes del deploy). Por eso
las pruebas de detección siembran contra el arnés de migraciones
(`tests/arnes_migraciones.py`), preparado en la revisión ANTERIOR a
`d1016emailunico` -- la última en la que el índice todavía no es único y
dos filas colisionadas pueden convivir -- en vez de contra `db_session`
(que corre siempre al HEAD migrado, donde ese `INSERT` ya lo rechaza la
base).

Cubre detección correcta, cero fuga de PII en la salida, y cero
escrituras demostrado (listener de sentencias + rechazo real del server)."""
import os

import pytest
from sqlalchemy import create_engine, event, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.dominio.modelos import Usuario
from scripts.auditar_colisiones_correo import (
    abrir_sesion_solo_lectura,
    detectar_colisiones,
    formatear_json,
    formatear_texto,
)
from tests.fabricas_pagos import crear_persona_orm

# Última revisión ANTES de que `usuario.correo` se vuelva único
# case-insensitive (issue #1016, migración `d1016emailunico`): la que
# corresponde a una base todavía no migrada, el escenario real que este
# script audita.
REVISION_SIN_INDICE_UNICO = "780ef12115e6"


def _sembrar_usuario(arnes, id_: int, cedula: str, correo: str, activo: bool = True) -> int:
    arnes.ejecutar(
        """
        INSERT INTO persona (id, nombres, apellidos, cedula, fecha_nacimiento,
                             telefono, fecha_registro, activo)
        VALUES (:id, 'Ana', 'Torres', :cedula, DATE '1990-01-01',
                '0991234567', TIMESTAMPTZ '2024-03-01 12:00:00+00', TRUE)
        """,
        id=id_, cedula=cedula,
    )
    arnes.ejecutar(
        """
        INSERT INTO usuario (id, correo, contrasenia, fecha_creacion,
                             version_contrasenia, activo, version_sesion,
                             persona_id)
        VALUES (:id, :correo, 'hash',
                TIMESTAMPTZ '2024-03-01 12:00:00+00', 1, :activo, 5, :id)
        """,
        id=id_, correo=correo, activo=activo,
    )
    return id_


def _detectar(arnes) -> dict:
    """Abre una `Session` sobre el motor del arnés, corre la detección y la
    CIERRA antes de devolver -- una `Session` sin cerrar retiene la
    conexión de `NullPool` abierta, y el `DROP SCHEMA public CASCADE` del
    `preparar()` del test SIGUIENTE queda bloqueado esperando esa
    conexión."""
    sesion = Session(bind=arnes.motor)
    try:
        return detectar_colisiones(sesion)
    finally:
        sesion.close()


# --- Detección ---------------------------------------------------------------

def test_detecta_par_en_colision_y_reporta_activo_por_id(arnes_migracion):
    arnes_migracion.preparar(REVISION_SIN_INDICE_UNICO)
    uno = _sembrar_usuario(arnes_migracion, 1, "1710034065", "Colision@Ejemplo.test", activo=True)
    dos = _sembrar_usuario(arnes_migracion, 2, "1710034073", "colision@ejemplo.test", activo=False)

    resultado = _detectar(arnes_migracion)

    assert resultado["buckets_en_colision"] == 1
    assert resultado["usuarios_en_colision"] == 2
    bucket = resultado["buckets"][0]
    assert bucket["cantidad"] == 2
    assert sorted(bucket["ids"]) == sorted([uno, dos])
    por_id = dict(zip(bucket["ids"], bucket["activos"]))
    assert por_id[uno] is True
    assert por_id[dos] is False


def test_detecta_bucket_triple(arnes_migracion):
    arnes_migracion.preparar(REVISION_SIN_INDICE_UNICO)
    a = _sembrar_usuario(arnes_migracion, 1, "1710034065", "trio@ejemplo.test")
    b = _sembrar_usuario(arnes_migracion, 2, "1710034073", "Trio@Ejemplo.test")
    c = _sembrar_usuario(arnes_migracion, 3, "1710034081", "TRIO@EJEMPLO.TEST")

    resultado = _detectar(arnes_migracion)

    bucket = next(bk for bk in resultado["buckets"] if bk["cantidad"] == 3)
    assert sorted(bucket["ids"]) == sorted([a, b, c])


def test_usuarios_no_colisionados_quedan_afuera(db_session):
    # Este caso no siembra ninguna colisión: corre igual contra la base al
    # HEAD migrado (issue #1016 no cambia nada de lo que este test afirma).
    persona_uno = crear_persona_orm(db_session, "1710034065")
    persona_dos = crear_persona_orm(db_session, "1710034073")
    db_session.add_all([
        Usuario(correo="sola@ejemplo.test", contrasenia="hash", persona_id=persona_uno.id),
        Usuario(correo="otra@ejemplo.test", contrasenia="hash", persona_id=persona_dos.id),
    ])
    db_session.commit()

    resultado = detectar_colisiones(db_session)

    assert resultado["buckets_en_colision"] == 0
    assert resultado["usuarios_en_colision"] == 0
    assert resultado["buckets"] == []
    assert resultado["total_usuarios"] == 2


# --- Huellas: no reversibles, estables dentro de una corrida -----------------

def test_huellas_son_hex_de_12_y_distintas_por_bucket(arnes_migracion):
    arnes_migracion.preparar(REVISION_SIN_INDICE_UNICO)
    _sembrar_usuario(arnes_migracion, 1, "1710034065", "hash@ejemplo.test")
    _sembrar_usuario(arnes_migracion, 2, "1710034073", "Hash@Ejemplo.test")
    _sembrar_usuario(arnes_migracion, 3, "1710034081", "otro@ejemplo.test")
    _sembrar_usuario(arnes_migracion, 4, "1710034099", "Otro@Ejemplo.test")

    resultado = _detectar(arnes_migracion)

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


def test_salida_no_contiene_correos_ni_arrobas(arnes_migracion):
    arnes_migracion.preparar(REVISION_SIN_INDICE_UNICO)
    _sembrar_usuario(arnes_migracion, 1, "1710034065", CORREOS_SEMBRADOS[0])
    _sembrar_usuario(arnes_migracion, 2, "1710034073", CORREOS_SEMBRADOS[1])
    _sembrar_usuario(arnes_migracion, 3, "1710034081", CORREOS_SEMBRADOS[2])

    resultado = _detectar(arnes_migracion)
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

def test_detector_solo_emite_select_o_with(arnes_migracion):
    arnes_migracion.preparar(REVISION_SIN_INDICE_UNICO)
    _sembrar_usuario(arnes_migracion, 1, "1710034065", "solo-lectura@ejemplo.test")
    _sembrar_usuario(arnes_migracion, 2, "1710034073", "Solo-Lectura@Ejemplo.test")

    sesion = Session(bind=arnes_migracion.motor)
    sentencias: list[str] = []

    def _registrar(conn, cursor, statement, parameters, context, executemany):
        sentencias.append(statement)

    conexion = sesion.connection()
    event.listen(conexion, "before_cursor_execute", _registrar)
    try:
        detectar_colisiones(sesion)
    finally:
        event.remove(conexion, "before_cursor_execute", _registrar)
        sesion.close()

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
