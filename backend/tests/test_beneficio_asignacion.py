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
from app.dominio.enums import EstadoMembresia
from app.dominio.excepciones import OperacionInvalida
from app.dominio.modelos import AsignacionDescuento, Descuento, Persona
from app.infraestructura.repositorios.descuento_repositorio import AsignacionDescuentoRepositorio
from app.servicios_negocio.beneficio_servicio import BeneficioServicio
from tests.fabricas_pagos import crear_membresia_orm, crear_persona_orm, crear_tipo_membresia_orm

RUTA_BENEFICIO = "/api/v1/personas/{persona_id}/beneficio"


# --- Fábricas locales ---------------------------------------------------------

def _crear_beneficiario(sesion, seed: int, **kwargs) -> Persona:
    return crear_persona_orm(sesion, cedula_valida(seed), **kwargs)


def _crear_descuento(sesion, *, nombre="Becado", porcentaje=Decimal("50.00"),
                      monto=None, activo=True) -> Descuento:
    if monto is not None:
        porcentaje = None
    descuento = Descuento(nombre=nombre, porcentaje=porcentaje, monto=monto, activo=activo)
    sesion.add(descuento)
    sesion.flush()
    return descuento


def _dar_membresia_operativa(sesion, persona: Persona, *, monto_aplicado: Decimal,
                              estado: EstadoMembresia = EstadoMembresia.ACTIVA) -> None:
    """Le da a `persona` la membresía OPERATIVA (ACTIVA o SUSPENDIDA) contra
    la que el nuevo gate de `BeneficioServicio.asignar` (issue #665) mide un
    beneficio candidato."""
    tipo = crear_tipo_membresia_orm(sesion, precio=monto_aplicado)
    crear_membresia_orm(sesion, persona, tipo, estado, monto_aplicado=monto_aplicado)


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


def test_asignacion_expone_el_nombre_del_admin_no_solo_su_id(db_session):
    """Issue #714: el panel "Beneficio del club" mostraba `Asignado por
    persona #1` porque el DTO solo llevaba el id crudo. Toda otra referencia a
    un actor en la app resuelve a un nombre (`registrado_por_nombre`,
    `corregido_por_nombre`); esta era la excepción.

    Se ejercita `a_response_dto` y no el endpoint a propósito: es EL punto
    donde una `AsignacionDescuento` ORM se vuelve respuesta HTTP (ver su
    docstring), y así el admin puede ser una persona con nombre propio en vez
    del `persona_id=1` fijo que el token de `client` impone."""
    admin = _crear_beneficiario(db_session, 798, nombres="Admin", apellidos="Dev")
    beneficiario = _crear_beneficiario(db_session, 799)
    descuento = _crear_descuento(db_session)
    db_session.commit()

    servicio = BeneficioServicio(db_session)
    asignacion = servicio.asignar(beneficiario.id, descuento.id, admin.id)
    dto = servicio.a_response_dto(asignacion)

    # El id sigue estando (referencia estable), pero ya no es lo único.
    assert dto.asignado_por_persona_id == admin.id
    assert dto.asignado_por_nombre == "Admin Dev"


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


# --- 4b. Issue #665: un beneficio no puede superar la tarifa mensual ---------
# Solo se puede medir contra una tarifa real: la membresía OPERATIVA (ACTIVA o
# SUSPENDIDA) de la persona, la única garantizada única por
# `uq_membresia_activa_por_persona`. Sin ninguna operativa (nunca se
# inscribió, o la única que tiene sigue INACTIVA esperando su primer pago) no
# hay nada contra qué medir -- el gate se omite ahí a propósito y el chequeo
# de `PagoServicio._congelar_beneficio_activo` sigue siendo la red de
# seguridad para ese caso (ver `test_beneficio_en_pago.py`).

def test_asignar_beneficio_de_monto_mayor_a_la_tarifa_operativa_es_rechazado(client, db_session):
    beneficiario = _crear_beneficiario(db_session, 710)
    _dar_membresia_operativa(db_session, beneficiario, monto_aplicado=Decimal("80.00"))
    descuento = _crear_descuento(db_session, nombre="Convenio excesivo", monto=Decimal("50000.00"))
    db_session.commit()

    resp = client.post(
        RUTA_BENEFICIO.format(persona_id=beneficiario.id),
        json={"descuento_id": descuento.id},
    )
    assert resp.status_code == 400, resp.text
    detalle = resp.json()["detail"]
    assert "80" in detalle
    assert "50000" in detalle


def test_asignar_beneficio_de_monto_igual_a_la_tarifa_operativa_es_permitido(client, db_session):
    """"Mayor que" es estricto: un beneficio que iguala el 100% de la tarifa
    (una beca completa) sigue siendo válido."""
    beneficiario = _crear_beneficiario(db_session, 711)
    _dar_membresia_operativa(db_session, beneficiario, monto_aplicado=Decimal("80.00"))
    descuento = _crear_descuento(db_session, nombre="Beca completa", monto=Decimal("80.00"))
    db_session.commit()

    resp = client.post(
        RUTA_BENEFICIO.format(persona_id=beneficiario.id),
        json={"descuento_id": descuento.id},
    )
    assert resp.status_code == 201, resp.text


def test_asignar_beneficio_porcentual_nunca_supera_la_tarifa(client, db_session):
    """Un porcentaje está acotado a <= 100 en el propio catálogo
    (`DescuentoCreateDTO.porcentaje`, `le=100`), así que su valor NUNCA puede
    superar la tarifa contra la que se calcula -- este gate nunca lo
    rechaza, sin importar cuán chica sea la tarifa."""
    beneficiario = _crear_beneficiario(db_session, 712)
    _dar_membresia_operativa(db_session, beneficiario, monto_aplicado=Decimal("5.00"))
    descuento = _crear_descuento(db_session, nombre="Beca total", porcentaje=Decimal("100.00"))
    db_session.commit()

    resp = client.post(
        RUTA_BENEFICIO.format(persona_id=beneficiario.id),
        json={"descuento_id": descuento.id},
    )
    assert resp.status_code == 201, resp.text


def test_asignar_beneficio_excesivo_con_membresia_suspendida_tambien_se_rechaza(client, db_session):
    """SUSPENDIDA cuenta como OPERATIVA, mismo criterio que
    `uq_membresia_activa_por_persona` (ver `modelos.py`): sigue siendo la
    tarifa vigente de la persona aunque esté pausada."""
    beneficiario = _crear_beneficiario(db_session, 713)
    _dar_membresia_operativa(
        db_session, beneficiario, monto_aplicado=Decimal("80.00"),
        estado=EstadoMembresia.SUSPENDIDA,
    )
    descuento = _crear_descuento(db_session, nombre="Convenio excesivo", monto=Decimal("50000.00"))
    db_session.commit()

    resp = client.post(
        RUTA_BENEFICIO.format(persona_id=beneficiario.id),
        json={"descuento_id": descuento.id},
    )
    assert resp.status_code == 400, resp.text


def test_asignar_beneficio_excesivo_sin_membresia_operativa_no_se_valida(client, db_session):
    """Narrowing deliberado (issue #665): sin membresía operativa no hay
    tarifa contra la que medir el beneficio -- ni porque la persona nunca se
    inscribió, ni porque la única que tiene sigue INACTIVA. Este caso queda
    cubierto en el pago (`test_beneficio_en_pago.py`), no acá."""
    beneficiario = _crear_beneficiario(db_session, 714)
    descuento = _crear_descuento(db_session, nombre="Convenio excesivo", monto=Decimal("50000.00"))
    db_session.commit()

    resp = client.post(
        RUTA_BENEFICIO.format(persona_id=beneficiario.id),
        json={"descuento_id": descuento.id},
    )
    assert resp.status_code == 201, resp.text


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
