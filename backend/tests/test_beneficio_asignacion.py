"""
Asignar y retirar el beneficio personal del club (issue #398, slice 3b):
servicio + repositorio + endpoints de `AsignacionDescuento`. El modelo y sus
constraints de base ya están cubiertos por `test_asignacion_descuento_modelo.py`
-- esta suite ejercita la CAPA de negocio y HTTP por encima.

Fuera de alcance acá (ver issue #398 y docstring de `BeneficioServicio`):
resolver el beneficio contra un `Pago` (3c) y cualquier UI (3d).

Reglas de producto bajo prueba:
- Solo ADMINISTRADOR asigna o retira.
- A lo sumo UNA asignación activa por persona (pre-check + índice único
  parcial como red de seguridad ante la carrera).
- Un descuento INACTIVO no puede asignarse; desactivarlo después de asignado
  no retira ni altera la asignación ya vigente.
- Asignar y retirar registran SIEMPRE actor y fecha; el retiro no borra la
  fila, solo la marca.
"""
from decimal import Decimal

import pytest
from sqlalchemy.orm import Session

from app.dominio.cedula import cedula_valida
from app.dominio.excepciones import OperacionInvalida
from app.dominio.modelos import AsignacionDescuento, Descuento, Persona
from app.infraestructura.repositorios.descuento_repositorio import AsignacionDescuentoRepositorio
from app.servicios_negocio.beneficio_servicio import BeneficioServicio
from tests.fabricas_pagos import crear_persona_orm

RUTA_BENEFICIO = "/api/v1/personas/{persona_id}/beneficio"


# --- Fábricas locales ---------------------------------------------------------

def _crear_beneficiario(sesion, seed: int, **kwargs) -> Persona:
    return crear_persona_orm(sesion, cedula_valida(seed), **kwargs)


def _crear_descuento(sesion, *, nombre="Becado", porcentaje=Decimal("50.00"),
                      activo=True) -> Descuento:
    descuento = Descuento(nombre=nombre, porcentaje=porcentaje, activo=activo)
    sesion.add(descuento)
    sesion.flush()
    return descuento


# --- 1. Asignar y leer --------------------------------------------------------

def test_asignar_beneficio_y_leerlo_por_get(client, db_session):
    beneficiario = _crear_beneficiario(db_session, 701)
    descuento = _crear_descuento(db_session)
    db_session.commit()

    resp = client.post(
        RUTA_BENEFICIO.format(persona_id=beneficiario.id),
        json={"descuento_id": descuento.id},
    )
    assert resp.status_code == 201, resp.text
    cuerpo = resp.json()
    assert cuerpo["personaId"] == beneficiario.id
    assert cuerpo["descuento"]["id"] == descuento.id
    # `client` (conftest.py) autentica como persona_id=1: el actor asignado
    # debe salir del token, nunca de un campo que el cuerpo no envió.
    assert cuerpo["asignadoPorPersonaId"] == 1
    assert cuerpo["retiradoEn"] is None
    assert cuerpo["retiradoPorPersonaId"] is None

    resp_get = client.get(RUTA_BENEFICIO.format(persona_id=beneficiario.id))
    assert resp_get.status_code == 200
    leido = resp_get.json()
    assert leido["id"] == cuerpo["id"]
    assert leido["descuento"]["id"] == descuento.id


def test_get_sin_beneficio_devuelve_vacio(client, db_session):
    beneficiario = _crear_beneficiario(db_session, 702)
    db_session.commit()

    resp = client.get(RUTA_BENEFICIO.format(persona_id=beneficiario.id))
    assert resp.status_code == 200
    assert resp.json() is None


# --- 2. Segundo beneficio mientras uno está activo: 400, no 500 --------------

def test_asignar_segundo_beneficio_activo_es_rechazado(client, db_session):
    beneficiario = _crear_beneficiario(db_session, 703)
    descuento_a = _crear_descuento(db_session, nombre="Becado A")
    descuento_b = _crear_descuento(db_session, nombre="Becado B", porcentaje=Decimal("30.00"))
    db_session.commit()

    primero = client.post(
        RUTA_BENEFICIO.format(persona_id=beneficiario.id),
        json={"descuento_id": descuento_a.id},
    )
    assert primero.status_code == 201, primero.text

    segundo = client.post(
        RUTA_BENEFICIO.format(persona_id=beneficiario.id),
        json={"descuento_id": descuento_b.id},
    )
    assert segundo.status_code == 400
    assert "beneficio activo" in segundo.json()["detail"]


# --- 3. Retirar y volver a asignar --------------------------------------------

def test_retirar_y_asignar_uno_nuevo_deja_ver_solo_el_nuevo(client, db_session):
    beneficiario = _crear_beneficiario(db_session, 704)
    descuento_a = _crear_descuento(db_session, nombre="Becado A")
    descuento_b = _crear_descuento(db_session, nombre="Becado B", porcentaje=Decimal("30.00"))
    db_session.commit()

    client.post(
        RUTA_BENEFICIO.format(persona_id=beneficiario.id),
        json={"descuento_id": descuento_a.id},
    )

    retiro = client.delete(RUTA_BENEFICIO.format(persona_id=beneficiario.id))
    assert retiro.status_code == 200, retiro.text
    cuerpo_retiro = retiro.json()
    assert cuerpo_retiro["retiradoEn"] is not None
    assert cuerpo_retiro["retiradoPorPersonaId"] == 1

    nuevo = client.post(
        RUTA_BENEFICIO.format(persona_id=beneficiario.id),
        json={"descuento_id": descuento_b.id},
    )
    assert nuevo.status_code == 201, nuevo.text

    leido = client.get(RUTA_BENEFICIO.format(persona_id=beneficiario.id))
    assert leido.json()["descuento"]["id"] == descuento_b.id

    # La fila original retirada sigue existiendo -- nunca se borra.
    filas = db_session.query(AsignacionDescuento).filter(
        AsignacionDescuento.persona_id == beneficiario.id
    ).all()
    assert len(filas) == 2
    retiradas = [f for f in filas if f.retirado_en is not None]
    assert len(retiradas) == 1
    assert retiradas[0].descuento_id == descuento_a.id


# --- 4. Descuento inactivo no puede asignarse; desactivar después no retira --

def test_asignar_descuento_inactivo_es_rechazado(client, db_session):
    beneficiario = _crear_beneficiario(db_session, 705)
    descuento = _crear_descuento(db_session, nombre="Descuento dado de baja", activo=False)
    db_session.commit()

    resp = client.post(
        RUTA_BENEFICIO.format(persona_id=beneficiario.id),
        json={"descuento_id": descuento.id},
    )
    assert resp.status_code == 400
    assert "inactivo" in resp.json()["detail"]


def test_desactivar_el_catalogo_despues_de_asignar_no_retira_la_asignacion(client, db_session):
    beneficiario = _crear_beneficiario(db_session, 706)
    descuento = _crear_descuento(db_session)
    db_session.commit()

    resp = client.post(
        RUTA_BENEFICIO.format(persona_id=beneficiario.id),
        json={"descuento_id": descuento.id},
    )
    assert resp.status_code == 201, resp.text

    # El admin desactiva el descuento del catálogo DESPUÉS de asignarlo.
    descuento.activo = False
    db_session.commit()

    leido = client.get(RUTA_BENEFICIO.format(persona_id=beneficiario.id))
    assert leido.status_code == 200
    cuerpo = leido.json()
    assert cuerpo is not None
    assert cuerpo["retiradoEn"] is None
    assert cuerpo["descuento"]["id"] == descuento.id


# --- 5. Retirar sin beneficio activo: 404, no 500 -----------------------------

def test_retirar_sin_beneficio_activo_da_404(client, db_session):
    beneficiario = _crear_beneficiario(db_session, 707)
    db_session.commit()

    resp = client.delete(RUTA_BENEFICIO.format(persona_id=beneficiario.id))
    assert resp.status_code == 404


# --- 6. Permisos: 403 sin rol, 401 sin token ----------------------------------
# IMPORTANTE: nunca se pide el fixture admin `client` en el mismo test que
# `client_sin_permisos`/`client_sin_token` (los overrides de dependencias son
# globales a la app y `client` reinstalaría el token admin). Se usa un id fijo
# -- la dependencia de permisos corre ANTES que el handler, así que no hace
# falta que la persona exista de verdad para probar 403/401.
PERSONA_ID_FIJO = 999999


def test_get_beneficio_403_sin_rol_admin(client_sin_permisos):
    resp = client_sin_permisos.get(RUTA_BENEFICIO.format(persona_id=PERSONA_ID_FIJO))
    assert resp.status_code == 403


def test_post_beneficio_403_sin_rol_admin(client_sin_permisos):
    resp = client_sin_permisos.post(
        RUTA_BENEFICIO.format(persona_id=PERSONA_ID_FIJO),
        json={"descuento_id": 1},
    )
    assert resp.status_code == 403


def test_delete_beneficio_403_sin_rol_admin(client_sin_permisos):
    resp = client_sin_permisos.delete(RUTA_BENEFICIO.format(persona_id=PERSONA_ID_FIJO))
    assert resp.status_code == 403


def test_get_beneficio_401_sin_token(client_sin_token):
    resp = client_sin_token.get(RUTA_BENEFICIO.format(persona_id=PERSONA_ID_FIJO))
    assert resp.status_code == 401


def test_post_beneficio_401_sin_token(client_sin_token):
    resp = client_sin_token.post(
        RUTA_BENEFICIO.format(persona_id=PERSONA_ID_FIJO),
        json={"descuento_id": 1},
    )
    assert resp.status_code == 401


def test_delete_beneficio_401_sin_token(client_sin_token):
    resp = client_sin_token.delete(RUTA_BENEFICIO.format(persona_id=PERSONA_ID_FIJO))
    assert resp.status_code == 401


# --- 7. Concurrencia: la carrera que el pre-check no puede ver ---------------
# NO usa `client`/`db_session` (mismo criterio documentado en
# `test_pago_comprobante_atomico.py`: una sola transacción jamás compite
# consigo misma). Abre sesiones independientes sobre `motor_test`, commitea
# de verdad, y limpia en el `finally`.

def test_dos_asignaciones_concurrentes_no_dejan_dos_activas(motor_test, monkeypatch):
    sesion_setup = Session(bind=motor_test)
    admin = crear_persona_orm(
        sesion_setup, cedula_valida(708), nombres="Admin", apellidos="Carrera",
        telefono="0990000708",
    )
    beneficiario = crear_persona_orm(
        sesion_setup, cedula_valida(709), nombres="Beneficiario", apellidos="Carrera",
        telefono="0990000709",
    )
    descuento = Descuento(nombre="Becado Carrera", porcentaje=Decimal("50.00"), activo=True)
    sesion_setup.add(descuento)
    sesion_setup.commit()
    admin_id, beneficiario_id, descuento_id = admin.id, beneficiario.id, descuento.id
    sesion_setup.close()

    def _colarse_en_la_carrera(persona_id: int) -> None:
        """Inserta y commitea, desde una sesión real independiente, la
        asignación "ganadora" -- exactamente la ventana entre el pre-check
        del servicio (que todavía no la ve) y su propio INSERT."""
        intrusa = Session(bind=motor_test)
        try:
            intrusa.add(AsignacionDescuento(
                persona_id=persona_id, descuento_id=descuento_id,
                asignado_por_persona_id=admin_id,
            ))
            intrusa.commit()
        finally:
            intrusa.close()

    def _pre_check_que_no_ve_la_carrera(self, persona_id: int):
        _colarse_en_la_carrera(persona_id)
        return None  # simula: el pre-check corrió ANTES de que exista la fila

    monkeypatch.setattr(
        AsignacionDescuentoRepositorio, "obtener_activa_por_persona",
        _pre_check_que_no_ve_la_carrera,
    )

    sesion_servicio = Session(bind=motor_test)
    try:
        servicio = BeneficioServicio(sesion_servicio)
        with pytest.raises(OperacionInvalida, match="beneficio activo"):
            servicio.asignar(beneficiario_id, descuento_id, admin_id)
    finally:
        sesion_servicio.rollback()
        sesion_servicio.close()
        limpieza = Session(bind=motor_test)
        try:
            limpieza.query(AsignacionDescuento).filter(
                AsignacionDescuento.persona_id == beneficiario_id
            ).delete()
            limpieza.query(Descuento).filter(Descuento.id == descuento_id).delete()
            limpieza.query(Persona).filter(
                Persona.id.in_([admin_id, beneficiario_id])
            ).delete()
            limpieza.commit()
        finally:
            limpieza.close()
