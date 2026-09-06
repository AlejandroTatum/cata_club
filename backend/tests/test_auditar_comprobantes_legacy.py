"""Tests de la auditoría de comprobantes legacy en Cloudinary (issue #1072,
fila A-7 de `production-readiness.md`).

Hermano de `test_auditar_colisiones_correo.py`: mismo tipo de auditoría de
solo lectura contra producción (`abrir_sesion_solo_lectura`), pero sobre un
dominio distinto -- almacenamiento de Cloudinary, no identidad de usuario.

Siembra directo por `db_session` (ORM), NUNCA por `client`/`client_sin_token`:
esos dos comparten overrides de sesión y sembrar con uno para leer con el
otro da un 401 en silencio (ver `client-y-client-sin-token-comparten-
overrides` en la memoria del repo)."""
import os

from sqlalchemy import create_engine, event, text
from sqlalchemy.exc import DBAPIError
import pytest

from app.dominio.enums import EstadoMembresia, EstadoPago
from app.dominio.modelos import ComprobantePago
from scripts.auditar_comprobantes_legacy import (
    abrir_sesion_solo_lectura,
    construir_auditoria,
    detectar_archivo_url_legacy,
    detectar_voucher_url_legacy,
    formatear_json,
    formatear_texto,
)
from tests.fabricas_pagos import (
    crear_membresia_orm,
    crear_pago_orm,
    crear_persona_orm,
    crear_tipo_membresia_orm,
)

_URL_LEGACY = "https://res.cloudinary.com/test/image/upload/v1/cataclub/vouchers/voucher_{id}.jpg"


def _armar_pago(db_session, cedula: str, *, voucher_url):
    persona = crear_persona_orm(db_session, cedula)
    tipo = crear_tipo_membresia_orm(db_session)
    membresia = crear_membresia_orm(db_session, persona, tipo, EstadoMembresia.ACTIVA)
    pago = crear_pago_orm(db_session, persona, membresia, EstadoPago.APROBADO)
    pago.voucher_url = voucher_url
    db_session.commit()
    db_session.refresh(pago)
    return pago


def _armar_comprobante(db_session, pago, *, archivo_url):
    comprobante = ComprobantePago(
        pago_id=pago.id, archivo_url=archivo_url, formato_archivo="jpg",
    )
    db_session.add(comprobante)
    db_session.commit()
    db_session.refresh(comprobante)
    return comprobante


# --- Clasificación de Pago.voucher_url ---------------------------------------

def test_voucher_url_legacy_se_cuenta_por_esquema(db_session):
    _armar_pago(db_session, "1710034065", voucher_url=_URL_LEGACY.format(id=1))
    _armar_pago(db_session, "1710034073", voucher_url="voucher_pelado")
    _armar_pago(db_session, "1710034081", voucher_url=None)

    resultado = detectar_voucher_url_legacy(db_session)

    assert resultado == {"legacy": 1, "migrada": 1, "vacia": 1, "total": 3}


def test_voucher_url_con_https_mayusculas_tambien_es_legacy(db_session):
    """Mismo criterio que `resolver_url_entrega`: `urlparse` normaliza el
    esquema a minúsculas, así que `HTTPS://` heredado también cuenta."""
    _armar_pago(
        db_session, "1710034065",
        voucher_url="HTTPS://res.cloudinary.com/test/image/upload/v1/x.jpg",
    )

    resultado = detectar_voucher_url_legacy(db_session)

    assert resultado == {"legacy": 1, "migrada": 0, "vacia": 0, "total": 1}


def test_voucher_url_cadena_vacia_cuenta_como_vacia(db_session):
    _armar_pago(db_session, "1710034065", voucher_url="  ")

    resultado = detectar_voucher_url_legacy(db_session)

    assert resultado == {"legacy": 0, "migrada": 0, "vacia": 1, "total": 1}


# --- Clasificación de ComprobantePago.archivo_url ----------------------------

def test_archivo_url_legacy_se_cuenta_por_esquema(db_session):
    pago_a = _armar_pago(db_session, "1710034065", voucher_url="voucher_pelado")
    pago_b = _armar_pago(db_session, "1710034073", voucher_url="voucher_pelado")
    _armar_comprobante(db_session, pago_a, archivo_url=_URL_LEGACY.format(id=pago_a.id))
    _armar_comprobante(db_session, pago_b, archivo_url="comprobante_pelado")

    resultado = detectar_archivo_url_legacy(db_session)

    assert resultado == {"legacy": 1, "migrada": 1, "vacia": 0, "total": 2}


def test_archivo_url_cadena_vacia_cuenta_como_vacia(db_session):
    # `archivo_url` no admite NULL en el esquema (columna NOT NULL); una
    # cadena vacía es el equivalente representable de "sin archivo" para
    # esta columna y clasifica igual que un `voucher_url` en NULL.
    pago = _armar_pago(db_session, "1710034065", voucher_url="voucher_pelado")
    _armar_comprobante(db_session, pago, archivo_url="")

    resultado = detectar_archivo_url_legacy(db_session)

    assert resultado == {"legacy": 0, "migrada": 0, "vacia": 1, "total": 1}


# --- Agregador y formateo -----------------------------------------------------

def test_construir_auditoria_agrega_las_dos_columnas(db_session):
    pago = _armar_pago(db_session, "1710034065", voucher_url=_URL_LEGACY.format(id=1))
    _armar_comprobante(db_session, pago, archivo_url="comprobante_pelado")

    auditoria = construir_auditoria(db_session)

    assert auditoria["pago_voucher_url"]["legacy"] == 1
    assert auditoria["comprobante_archivo_url"]["migrada"] == 1


def test_formatear_json_y_texto_no_explotan_y_reportan_conteos(db_session):
    pago = _armar_pago(db_session, "1710034065", voucher_url=_URL_LEGACY.format(id=1))
    _armar_comprobante(db_session, pago, archivo_url=_URL_LEGACY.format(id=pago.id))

    auditoria = construir_auditoria(db_session)

    salida_json = formatear_json(auditoria)
    salida_texto = formatear_texto(auditoria)
    assert '"legacy": 1' in salida_json
    assert "legacy=1" in salida_texto
    # Nunca datos privados: ni cédula, ni URL completa en el texto de salida.
    assert "1710034065" not in salida_texto
    assert "cloudinary.com" not in salida_texto


# --- Cero escrituras: demostrado con un listener ------------------------------

def test_auditoria_solo_emite_select_o_with(db_session):
    _armar_pago(db_session, "1710034065", voucher_url=_URL_LEGACY.format(id=1))

    sentencias: list[str] = []

    def _registrar(conn, cursor, statement, parameters, context, executemany):
        sentencias.append(statement)

    conexion = db_session.connection()
    event.listen(conexion, "before_cursor_execute", _registrar)
    try:
        construir_auditoria(db_session)
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
    pago = _armar_pago(db_session, "1710034065", voucher_url="voucher_pelado")
    try:
        sesion = abrir_sesion_solo_lectura(engine)
        try:
            with pytest.raises(DBAPIError) as excinfo:
                sesion.execute(
                    text(
                        "INSERT INTO comprobante_pago (archivo_url, "
                        "formato_archivo, pago_id) "
                        "VALUES ('nunca', 'jpg', :pago_id)"
                    ),
                    {"pago_id": pago.id},
                )
            assert "read-only transaction" in str(excinfo.value).lower()
        finally:
            sesion.rollback()
            sesion.close()
    finally:
        engine.dispose()
