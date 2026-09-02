"""Cambio de plan de una membresía existente (issue #400, criterio 1).

Decisión de producto ya tomada, citada del prompt de la entrega 07:

    El cambio de plan es PROSPECTIVO. La cobertura YA PAGADA (fechas ya
    aprobadas, fecha_inicio/fecha_fin de pagos APROBADO existentes) no se
    toca ni se recalcula -- mismo criterio que ya existe para un cambio de
    tarifa de catálogo (#394/2a), aplicado ahora a nivel de una membresía
    individual en vez del catálogo entero. La tarifa nueva rige recién
    desde el próximo pago que se registre para esa membresía.

`MembresiaServicio.cambiar_plan` muta `Membresia.tipo_membresia_id` y
resincroniza `Membresia.monto_aplicado` (la columna que `registrar_pago` lee
para el PRÓXIMO pago); nunca toca ningún `Pago` existente. La auditoría vive
en `HistorialCambioPlanMembresia` -- tabla NUEVA, no reutiliza
`HistorialEstadoMembresia` (esa audita transiciones de ESTADO, con un CHECK
que exige que difieran; un cambio de plan no toca `Membresia.estado`)."""
import threading
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy.orm import Session

from app.dominio.cedula import cedula_valida
from app.dominio.enums import EstadoMembresia, EstadoPago, TipoPago
from app.dominio.excepciones import EntidadNoEncontrada, OperacionInvalida
from app.dominio.modelos import HistorialCambioPlanMembresia, Membresia, Pago, Persona, TipoMembresia
from app.servicios_negocio.dtos.membresia_pago_schemas import CambioPlanMembresiaDTO
from app.servicios_negocio.membresia_pago_servicio import MembresiaServicio, _sumar_meses
from tests.fabricas_pagos import crear_membresia_orm, crear_persona_orm, crear_tipo_membresia_orm

FECHA_INICIO = date(2027, 1, 1)


@pytest.fixture
def admin_id(db_session) -> int:
    return crear_persona_orm(db_session, cedula_valida(999)).id


def _pago_aprobado(db_session, persona: Persona, membresia: Membresia, *, tarifa: Decimal) -> Pago:
    fecha_fin = _sumar_meses(FECHA_INICIO, 1)
    pago = Pago(
        monto=tarifa,
        tarifa_mensual_aplicada=tarifa,
        meses_comprados=1,
        monto_base=tarifa,
        estado_pago=EstadoPago.APROBADO,
        tipo_pago=TipoPago.EFECTIVO,
        fecha_inicio=FECHA_INICIO,
        fecha_fin=fecha_fin,
        persona_id=persona.id,
        membresia_id=membresia.id,
    )
    db_session.add(pago)
    db_session.commit()
    return pago


@pytest.fixture
def grafo(db_session):
    """Persona + dos tipos de membresía ($30 y $45) + membresía ACTIVA bajo
    el primero + un pago APROBADO ya congelado con la tarifa vieja."""
    persona = crear_persona_orm(db_session, cedula_valida(900))
    tipo_viejo = crear_tipo_membresia_orm(db_session, categoria="Adultos", precio=Decimal("30.00"))
    tipo_nuevo = crear_tipo_membresia_orm(db_session, categoria="Juveniles", precio=Decimal("45.00"))
    membresia = crear_membresia_orm(
        db_session, persona, tipo_viejo, EstadoMembresia.ACTIVA, monto_aplicado=Decimal("30.00"),
    )
    pago = _pago_aprobado(db_session, persona, membresia, tarifa=Decimal("30.00"))
    return persona, tipo_viejo, tipo_nuevo, membresia, pago


# --- Camino feliz ------------------------------------------------------------

def test_cambiar_plan_actualiza_tipo_y_resincroniza_tarifa(db_session, grafo, admin_id):
    _, tipo_viejo, tipo_nuevo, membresia, _ = grafo

    resultado = MembresiaServicio(db_session).cambiar_plan(
        membresia.id,
        CambioPlanMembresiaDTO(nuevo_tipo_membresia_id=tipo_nuevo.id),
        actor_persona_id=admin_id,
    )

    assert resultado.tipo_membresia_id == tipo_nuevo.id
    assert resultado.monto_aplicado == Decimal("45.00")
    # El cambio de plan no es una transición de estado.
    assert resultado.estado == EstadoMembresia.ACTIVA


def test_cambiar_plan_no_toca_la_cobertura_ya_aprobada(db_session, grafo, admin_id):
    """La aserción central del criterio: ni una columna del `Pago` ya
    aprobado cambia -- ni fechas, ni el snapshot financiero congelado."""
    _, tipo_viejo, tipo_nuevo, membresia, pago = grafo
    snapshot_antes = {
        "monto": pago.monto,
        "tarifa_mensual_aplicada": pago.tarifa_mensual_aplicada,
        "meses_comprados": pago.meses_comprados,
        "monto_base": pago.monto_base,
        "fecha_inicio": pago.fecha_inicio,
        "fecha_fin": pago.fecha_fin,
        "estado_pago": pago.estado_pago,
    }

    MembresiaServicio(db_session).cambiar_plan(
        membresia.id,
        CambioPlanMembresiaDTO(nuevo_tipo_membresia_id=tipo_nuevo.id),
        actor_persona_id=admin_id,
    )

    db_session.refresh(pago)
    snapshot_despues = {
        "monto": pago.monto,
        "tarifa_mensual_aplicada": pago.tarifa_mensual_aplicada,
        "meses_comprados": pago.meses_comprados,
        "monto_base": pago.monto_base,
        "fecha_inicio": pago.fecha_inicio,
        "fecha_fin": pago.fecha_fin,
        "estado_pago": pago.estado_pago,
    }
    assert snapshot_antes == snapshot_despues


def test_cambiar_plan_registra_auditoria(db_session, grafo, admin_id):
    _, tipo_viejo, tipo_nuevo, membresia, _ = grafo

    MembresiaServicio(db_session).cambiar_plan(
        membresia.id,
        CambioPlanMembresiaDTO(nuevo_tipo_membresia_id=tipo_nuevo.id),
        actor_persona_id=admin_id,
    )

    filas = (
        db_session.query(HistorialCambioPlanMembresia)
        .filter_by(membresia_id=membresia.id)
        .all()
    )
    assert len(filas) == 1
    fila = filas[0]
    assert fila.tipo_membresia_id_anterior == tipo_viejo.id
    assert fila.tipo_membresia_id_nuevo == tipo_nuevo.id
    assert fila.actor_persona_id == admin_id


# --- Rechazos ------------------------------------------------------------

def _cambiar_plan(db_session, membresia_id: int, nuevo_tipo_id: int, admin_id: int) -> Membresia:
    """Atajo para los tres tests de rechazo de abajo: los tres invocan
    `MembresiaServicio.cambiar_plan` con la misma forma de llamada, solo
    variando qué id de membresía/tipo dispara el rechazo -- Sonar los
    marcaba como bloque duplicado (líneas 150/161/172 del PR original)."""
    return MembresiaServicio(db_session).cambiar_plan(
        membresia_id,
        CambioPlanMembresiaDTO(nuevo_tipo_membresia_id=nuevo_tipo_id),
        actor_persona_id=admin_id,
    )


def test_cambiar_plan_al_mismo_tipo_se_rechaza(db_session, grafo, admin_id):
    _, tipo_viejo, _, membresia, _ = grafo

    with pytest.raises(OperacionInvalida, match="ya tiene asignado ese tipo"):
        _cambiar_plan(db_session, membresia.id, tipo_viejo.id, admin_id)


def test_cambiar_plan_membresia_inexistente_da_entidad_no_encontrada(db_session, grafo, admin_id):
    _, _, tipo_nuevo, _, _ = grafo

    with pytest.raises(EntidadNoEncontrada):
        _cambiar_plan(db_session, 999999, tipo_nuevo.id, admin_id)


def test_cambiar_plan_tipo_inexistente_da_entidad_no_encontrada(db_session, grafo, admin_id):
    _, _, _, membresia, _ = grafo

    with pytest.raises(EntidadNoEncontrada):
        _cambiar_plan(db_session, membresia.id, 999999, admin_id)


# --- Autorización a nivel API -------------------------------------------------

def test_cambiar_plan_sin_rol_admin_da_403(client_sin_permisos, db_session):
    persona = crear_persona_orm(db_session, cedula_valida(901))
    tipo_viejo = crear_tipo_membresia_orm(db_session, categoria="Adultos", precio=Decimal("30.00"))
    tipo_nuevo = crear_tipo_membresia_orm(db_session, categoria="Juveniles", precio=Decimal("45.00"))
    membresia = crear_membresia_orm(db_session, persona, tipo_viejo, EstadoMembresia.ACTIVA)

    resp = client_sin_permisos.post(
        f"/api/v1/membresias/{membresia.id}/cambiar-plan",
        json={"nuevo_tipo_membresia_id": tipo_nuevo.id},
    )
    assert resp.status_code == 403


def test_cambiar_plan_via_api_admin_devuelve_membresia_actualizada(client, db_session):
    persona = crear_persona_orm(db_session, cedula_valida(902))
    tipo_viejo = crear_tipo_membresia_orm(db_session, categoria="Adultos", precio=Decimal("30.00"))
    tipo_nuevo = crear_tipo_membresia_orm(db_session, categoria="Juveniles", precio=Decimal("45.00"))
    membresia = crear_membresia_orm(
        db_session, persona, tipo_viejo, EstadoMembresia.ACTIVA, monto_aplicado=Decimal("30.00"),
    )

    resp = client.post(
        f"/api/v1/membresias/{membresia.id}/cambiar-plan",
        json={"nuevo_tipo_membresia_id": tipo_nuevo.id},
    )
    assert resp.status_code == 200, resp.text
    cuerpo = resp.json()
    assert cuerpo["tipoMembresiaId"] == tipo_nuevo.id
    assert cuerpo["montoAplicado"] == "45.00"


def test_cambiar_plan_al_mismo_tipo_via_api_da_400(client, db_session):
    """`OperacionInvalida` se traduce a 400 (mismo criterio que el resto de
    los rechazos de negocio de este router, ej. `MENSAJE_MEMBRESIA_ACTIVA_
    DUPLICADA` en `test_correccion_pago.py`), no 422 (reservado a errores de
    validación de forma del DTO)."""
    persona = crear_persona_orm(db_session, cedula_valida(903))
    tipo = crear_tipo_membresia_orm(db_session, categoria="Adultos", precio=Decimal("30.00"))
    membresia = crear_membresia_orm(db_session, persona, tipo, EstadoMembresia.ACTIVA)

    resp = client.post(
        f"/api/v1/membresias/{membresia.id}/cambiar-plan",
        json={"nuevo_tipo_membresia_id": tipo.id},
    )
    assert resp.status_code == 400, resp.text


# --- Concurrencia REAL: dos cambios de plan de la misma membresía ------------

def _limpiar_grafo(motor_test, *, persona_ids: list[int], membresia_id: int, tipo_ids: list[int]) -> None:
    limpieza = Session(bind=motor_test)
    try:
        limpieza.query(HistorialCambioPlanMembresia).filter(
            HistorialCambioPlanMembresia.membresia_id == membresia_id
        ).delete(synchronize_session=False)
        limpieza.query(Pago).filter(Pago.membresia_id == membresia_id).delete()
        limpieza.query(Membresia).filter(Membresia.id == membresia_id).delete()
        limpieza.query(TipoMembresia).filter(TipoMembresia.id.in_(tipo_ids)).delete(
            synchronize_session=False
        )
        limpieza.query(Persona).filter(Persona.id.in_(persona_ids)).delete(
            synchronize_session=False
        )
        limpieza.commit()
    finally:
        limpieza.close()


def test_dos_cambios_de_plan_concurrentes_de_la_misma_membresia_se_serializan(motor_test):
    """Concurrencia REAL (no simulada), mismo patrón que
    `test_correccion_pago.py::test_dos_correcciones_concurrentes_del_mismo_pago_se_serializan`:
    dos hilos cambian el plan de la MISMA membresía a la vez, con sesiones
    independientes. Sin `obtener_por_id_con_bloqueo`, los dos leerían el
    mismo `tipo_membresia_id` de origen; con el lock, se serializan y las
    DOS filas de auditoría quedan escritas sin perder ninguna."""
    sesion_setup = Session(bind=motor_test)
    admin = crear_persona_orm(sesion_setup, cedula_valida(970), telefono="0990000970")
    socio = crear_persona_orm(sesion_setup, cedula_valida(971), telefono="0990000971")
    tipo_a = crear_tipo_membresia_orm(sesion_setup, categoria="A", precio=Decimal("30.00"))
    tipo_b = crear_tipo_membresia_orm(sesion_setup, categoria="B", precio=Decimal("45.00"))
    tipo_c = crear_tipo_membresia_orm(sesion_setup, categoria="C", precio=Decimal("60.00"))
    membresia = crear_membresia_orm(
        sesion_setup, socio, tipo_a, EstadoMembresia.ACTIVA, monto_aplicado=Decimal("30.00"),
    )
    sesion_setup.commit()
    membresia_id = membresia.id
    socio_id, admin_id_local = socio.id, admin.id
    tipo_a_id, tipo_b_id, tipo_c_id = tipo_a.id, tipo_b.id, tipo_c.id
    sesion_setup.close()

    barrera = threading.Barrier(2, timeout=15)
    resultados: list = [None, None]

    def cambiar(indice: int, nuevo_tipo_id: int):
        sesion = Session(bind=motor_test)
        try:
            barrera.wait()
            resultado = MembresiaServicio(sesion).cambiar_plan(
                membresia_id,
                CambioPlanMembresiaDTO(nuevo_tipo_membresia_id=nuevo_tipo_id),
                actor_persona_id=admin_id_local,
            )
            resultados[indice] = resultado.tipo_membresia_id
        except BaseException as error:  # noqa: BLE001 -- el test inspecciona el fallo
            resultados[indice] = error
            sesion.rollback()
        finally:
            sesion.close()

    hilos = [
        threading.Thread(target=cambiar, args=(0, tipo_b_id)),
        threading.Thread(target=cambiar, args=(1, tipo_c_id)),
    ]
    for hilo in hilos:
        hilo.start()
    for hilo in hilos:
        hilo.join(timeout=30)

    errores = [r for r in resultados if isinstance(r, BaseException)]
    assert errores == [], f"ningún cambio de plan debía fallar: {errores}"

    verificacion = Session(bind=motor_test)
    try:
        filas = (
            verificacion.query(HistorialCambioPlanMembresia)
            .filter_by(membresia_id=membresia_id)
            .order_by(HistorialCambioPlanMembresia.id)
            .all()
        )
        assert len(filas) == 2
        tipos_nuevos_registrados = {fila.tipo_membresia_id_nuevo for fila in filas}
        assert tipos_nuevos_registrados == {tipo_b_id, tipo_c_id}
        # El segundo en aplicarse (por orden real de escritura, `id` ASC)
        # partió del tipo que dejó el primero -- ninguno se aplicó sobre un
        # `tipo_membresia_id` obsoleto.
        assert filas[1].tipo_membresia_id_anterior == filas[0].tipo_membresia_id_nuevo

        membresia_final = verificacion.get(Membresia, membresia_id)
        assert membresia_final.tipo_membresia_id == filas[1].tipo_membresia_id_nuevo
    finally:
        verificacion.close()

    _limpiar_grafo(
        motor_test,
        persona_ids=[admin_id_local, socio_id],
        membresia_id=membresia_id,
        tipo_ids=[tipo_a_id, tipo_b_id, tipo_c_id],
    )
