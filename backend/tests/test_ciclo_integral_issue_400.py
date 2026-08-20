"""Prueba integral de ciclo completo (issue #400, entrega 08).

Ningún test existente ejercita la cadena entera contra la base real: cada
archivo prueba un slice aislado (tarifas, beneficios, cobertura bonificada,
suspensión/reactivación, corrección financiera, cambio de plan) con su
propio grafo mínimo. Este archivo arma UNA sola narrativa de extremo a
extremo -- inscripción -> plan -> pago -> aprobación -> cobertura -> cambio
de tarifa -> pago -> cambio de plan -> suspensión -> reactivación -> pago --
contra Postgres real, con una aserción explícita por paso citando el
invariante de #400 que confirma (ver la lista completa en
`HANDOFF-ISSUE-400.md`, sección "Objetivo e invariantes de #400").

Decisión de alcance ya tomada (prompt de la entrega 08): esto vive en
`backend/tests/`, no en Playwright -- la profundidad de lógica de negocio de
este repo vive en pytest (unitario/integración); Playwright cubre
interacción de UI por pantalla, ya con su propia cobertura separada
(`dead-canvas.spec.ts`, `back-nav-and-toasts.spec.ts`, etc.). Duplicar esta
profundidad ahí no agregaría nada.

Corrección de una premisa del prompt original (verificada contra el código,
no asumida -- ver `MembresiaServicio.actualizar_tipo_membresia` en
`membresia_pago_servicio.py` y `TipoMembresiaRepositorio`): un cambio de
tarifa de CATÁLOGO (`PATCH /membresias/tipos/{id}`) nunca resincroniza
`Membresia.monto_aplicado` de una membresía YA EXISTENTE -- ni al momento
del cambio ni en el próximo pago que se registre. Los ÚNICOS tres sitios
que escriben esa columna son `crear_membresia`, `cambiar_plan` y
`reactivar_membresia` (los tres grepeados y confirmados en
`membresia_pago_servicio.py`). `tests/test_tarifa_resuelta_server_side.py::
test_un_cambio_de_tarifa_alcanza_a_las_membresias_nuevas_y_no_a_las_viejas`
ya prueba exactamente esto: el cambio de catálogo alcanza a membresías
NUEVAS, nunca a una ya existente sin una acción explícita de por medio. El
paso 6 de abajo, entonces, prueba lo que el código REALMENTE hace (un
tercer pago sobre la MISMA membresía sigue usando la tarifa vieja
congelada) en vez de una expectativa que no correspondía; "usa la tarifa
nueva" se prueba de verdad en los pasos 7 (`cambiar_plan`) y 9
(`reactivar_membresia`), los dos únicos caminos reales de resync."""
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest

import app.servicios_negocio.membresia_pago_servicio as mps
from app.dominio.cedula import cedula_valida
from app.dominio.enums import EstadoMembresia, EstadoPago, TipoPago
from app.presentacion.schemas.membresia_pago_schemas import (
    CambioPlanMembresiaDTO,
    MembresiaCreateDTO,
    PagoCreateDTO,
    PagoValidarDTO,
    TipoMembresiaUpdateDTO,
)
from app.servicios_negocio.membresia_pago_servicio import MembresiaServicio, PagoServicio, _sumar_meses
from tests.fabricas_pagos import crear_persona_orm, crear_tipo_membresia_orm

HOY_CLUB_REAL = mps.hoy_club


def _fijar_hoy(monkeypatch, dia: date) -> None:
    """Congela `hoy_club()` (sin argumento) en `dia`, preservando la
    conversión real de un instante recibido -- mismo criterio que
    `test_suspension_reactivacion.py::_fijar_hoy`."""

    def _fake(instante: datetime | None = None) -> date:
        if instante is None:
            return dia
        return HOY_CLUB_REAL(instante)

    monkeypatch.setattr(mps, "hoy_club", _fake)


def test_ciclo_integral_inscripcion_a_reactivacion(db_session, monkeypatch):
    """Narrativa completa de extremo a extremo. Un único test (no una
    secuencia de tests separados) a propósito: cada paso depende del estado
    que dejó el anterior (el mismo `db_session`, la misma `membresia`), así
    que separarlos perdería justo lo que esta prueba existe para blindar --
    que la cadena completa, no cada eslabón aislado, se sostiene."""
    admin = crear_persona_orm(db_session, cedula_valida(700), telefono="0990000700")
    socio = crear_persona_orm(db_session, cedula_valida(701), telefono="0990000701")

    membresia_servicio = MembresiaServicio(db_session)
    pago_servicio = PagoServicio(db_session)

    # --- Paso 1: inscripción + asignación de plan --------------------------
    tipo_a = crear_tipo_membresia_orm(db_session, categoria="Adultos", precio=Decimal("30.00"))
    membresia = membresia_servicio.crear_membresia(
        MembresiaCreateDTO(persona_id=socio.id, tipo_membresia_id=tipo_a.id)
    )
    # Invariante 1 (#400): "el frontend nunca envía autoritativamente un
    # precio mensual; el backend resuelve TipoMembresia.precio" --
    # `MembresiaCreateDTO` ni siquiera tiene un campo de monto (ver su
    # docstring); acá se confirma que lo que quedó grabado es EXACTAMENTE
    # el precio del catálogo, no un valor inventado por este test.
    assert membresia.monto_aplicado == tipo_a.precio == Decimal("30.00")
    assert membresia.estado == EstadoMembresia.INACTIVA  # nace inactiva, se activa al aprobar el primer pago

    FECHA_INICIO = date(2027, 1, 1)
    _fijar_hoy(monkeypatch, FECHA_INICIO)

    # --- Paso 2: registrar_pago por meses, TRANSFERENCIA --------------------
    pago1 = pago_servicio.registrar_pago(
        PagoCreateDTO(meses=1, tipo_pago=TipoPago.TRANSFERENCIA, persona_id=socio.id, membresia_id=membresia.id),
        persona_id_solicitante=socio.id, roles_solicitante=[],
    )
    # Invariante 2 (#400): "cada pago congela tarifa, meses, monto base...".
    # El usuario eligió una cantidad de MESES, nunca un monto libre -- estas
    # tres columnas de snapshot se derivan server-side, nunca las manda el
    # cliente (`PagoCreateDTO` no tiene ningún campo de monto).
    assert pago1.estado_pago == EstadoPago.PENDIENTE_VALIDACION
    assert pago1.tarifa_mensual_aplicada == Decimal("30.00")
    assert pago1.meses_comprados == 1
    assert pago1.monto_base == Decimal("30.00")
    assert pago1.fecha_inicio == FECHA_INICIO
    assert pago1.fecha_fin == _sumar_meses(FECHA_INICIO, 1)

    # --- Paso 3: validar_pago (aprobación) ----------------------------------
    pago1 = pago_servicio.validar_pago(pago1.id, PagoValidarDTO(
        estado_pago=EstadoPago.APROBADO,
        # Issue #459: los cuatro pagos de este ciclo son TRANSFERENCIA sin
        # voucher (nunca se adjunta uno en esta narrativa) -- sin este
        # motivo, aprobar rechaza con `OperacionInvalida` desde este fix.
        motivo_excepcion_sin_comprobante="Verificado directamente en la cuenta del club.",
    ), actor_persona_id=admin.id)
    db_session.refresh(membresia)
    # Invariante 6 (#400): "la cobertura se deriva de la cantidad de meses
    # comprados; administración no puede escribir fechas de cobertura
    # durante la aprobación" -- `PagoValidarDTO` no tiene NINGÚN campo de
    # fecha (ver su definición), así que la aprobación no pudo haber tocado
    # `fecha_inicio`/`fecha_fin`: siguen siendo EXACTAMENTE las derivadas de
    # `meses` en el paso 2, nunca fechas tipeadas por un admin.
    assert pago1.estado_pago == EstadoPago.APROBADO
    assert pago1.fecha_inicio == FECHA_INICIO
    assert pago1.fecha_fin == _sumar_meses(FECHA_INICIO, 1)
    # Aprobar el primer pago activa la membresía (mismo criterio que
    # `aplicar_beneficio_bonificado`, `_activar_membresia_con_red_de_seguridad`).
    assert membresia.estado == EstadoMembresia.ACTIVA

    # --- Paso 4: segundo pago (mes siguiente), registrado y aprobado -------
    pago2 = pago_servicio.registrar_pago(
        PagoCreateDTO(meses=1, tipo_pago=TipoPago.TRANSFERENCIA, persona_id=socio.id, membresia_id=membresia.id),
        persona_id_solicitante=socio.id, roles_solicitante=[],
    )
    # Invariante 2 (#400), continuación: el ancla de cobertura es
    # EXACTAMENTE donde terminó la cobertura ya aprobada -- ni hueco ni
    # solape -- nunca una fecha que el cliente eligió.
    assert pago2.fecha_inicio == pago1.fecha_fin == _sumar_meses(FECHA_INICIO, 1)
    assert pago2.fecha_fin == _sumar_meses(FECHA_INICIO, 2)
    assert pago2.tarifa_mensual_aplicada == Decimal("30.00")
    pago2 = pago_servicio.validar_pago(pago2.id, PagoValidarDTO(
        estado_pago=EstadoPago.APROBADO,
        # Issue #459: los cuatro pagos de este ciclo son TRANSFERENCIA sin
        # voucher (nunca se adjunta uno en esta narrativa) -- sin este
        # motivo, aprobar rechaza con `OperacionInvalida` desde este fix.
        motivo_excepcion_sin_comprobante="Verificado directamente en la cuenta del club.",
    ), actor_persona_id=admin.id)
    assert pago2.estado_pago == EstadoPago.APROBADO

    # --- Paso 5: cambio de tarifa del catálogo (#394/2a) --------------------
    tipo_a = membresia_servicio.actualizar_tipo_membresia(tipo_a.id, TipoMembresiaUpdateDTO(precio=Decimal("40.00")))
    db_session.refresh(pago1)
    db_session.refresh(pago2)
    # Invariante 3 (#400): "un cambio de tarifa afecta pagos futuros, nunca
    # pagos previos". Los DOS pagos ya aprobados conservan su tarifa/monto
    # base ORIGINAL -- el catálogo cambió, el pasado no se reescribe.
    assert pago1.tarifa_mensual_aplicada == Decimal("30.00")
    assert pago1.monto_base == Decimal("30.00")
    assert pago2.tarifa_mensual_aplicada == Decimal("30.00")
    assert pago2.monto_base == Decimal("30.00")
    assert tipo_a.precio == Decimal("40.00")  # el catálogo sí cambió

    # --- Paso 6: tercer pago, registrado DESPUÉS del cambio de tarifa ------
    pago3 = pago_servicio.registrar_pago(
        PagoCreateDTO(meses=1, tipo_pago=TipoPago.TRANSFERENCIA, persona_id=socio.id, membresia_id=membresia.id),
        persona_id_solicitante=socio.id, roles_solicitante=[],
    )
    # Invariante 3 (#400), verificado con precisión (ver la corrección de
    # premisa en el docstring del módulo): un cambio de tarifa de CATÁLOGO
    # nunca resincroniza la membresía ya existente -- solo `cambiar_plan` y
    # `reactivar_membresia` lo hacen (paso 7 y 9 de abajo prueban ESO). Este
    # tercer pago, sobre la MISMA membresía todavía bajo `tipo_a`, sigue
    # congelando la tarifa VIEJA (`membresia.monto_aplicado`, nunca tocada
    # por el PATCH de catálogo) -- ni una escritura de catálogo "se cuela"
    # retroactivamente en una membresía que no pidió el cambio.
    assert pago3.tarifa_mensual_aplicada == Decimal("30.00")
    assert pago3.monto_base == Decimal("30.00")
    assert pago3.fecha_inicio == pago2.fecha_fin == _sumar_meses(FECHA_INICIO, 2)
    assert pago3.fecha_fin == _sumar_meses(FECHA_INICIO, 3)
    pago3 = pago_servicio.validar_pago(pago3.id, PagoValidarDTO(
        estado_pago=EstadoPago.APROBADO,
        # Issue #459: los cuatro pagos de este ciclo son TRANSFERENCIA sin
        # voucher (nunca se adjunta uno en esta narrativa) -- sin este
        # motivo, aprobar rechaza con `OperacionInvalida` desde este fix.
        motivo_excepcion_sin_comprobante="Verificado directamente en la cuenta del club.",
    ), actor_persona_id=admin.id)
    assert pago3.estado_pago == EstadoPago.APROBADO

    # --- Paso 7: cambiar_plan a un TipoMembresia distinto -------------------
    def _snapshot(pago) -> dict:
        return {
            "monto": pago.monto,
            "tarifa_mensual_aplicada": pago.tarifa_mensual_aplicada,
            "meses_comprados": pago.meses_comprados,
            "monto_base": pago.monto_base,
            "fecha_inicio": pago.fecha_inicio,
            "fecha_fin": pago.fecha_fin,
            "estado_pago": pago.estado_pago,
        }

    snapshots_antes = {pago.id: _snapshot(pago) for pago in (pago1, pago2, pago3)}

    tipo_b = crear_tipo_membresia_orm(db_session, categoria="Juveniles", precio=Decimal("45.00"))
    membresia = membresia_servicio.cambiar_plan(
        membresia.id, CambioPlanMembresiaDTO(nuevo_tipo_membresia_id=tipo_b.id), actor_persona_id=admin.id,
    )
    db_session.refresh(pago1)
    db_session.refresh(pago2)
    db_session.refresh(pago3)
    # Invariante 3 (#400), mitad "usa la tarifa nueva": `cambiar_plan` SÍ
    # resincroniza `monto_aplicado` -- este es uno de los dos caminos reales
    # (junto con `reactivar_membresia`, paso 9) por los que una membresía
    # existente adopta una tarifa nueva.
    assert membresia.tipo_membresia_id == tipo_b.id
    assert membresia.monto_aplicado == Decimal("45.00")
    # Decisión de producto ya tomada (07, criterio 1): cambio de plan es
    # PROSPECTIVO -- los TRES pagos ya aprobados no cambian NI UNA de sus
    # siete columnas de snapshot/estado (mismo set que
    # `test_cambio_plan_membresia.py::test_cambiar_plan_no_toca_la_cobertura_
    # ya_aprobada`, que ya lo prueba aislado sobre un único pago; acá se
    # repite sobre los TRES pagos reales de esta narrativa, no un duplicado
    # del otro test sino la misma garantía verificada en el contexto de la
    # cadena completa).
    for pago in (pago1, pago2, pago3):
        assert _snapshot(pago) == snapshots_antes[pago.id]

    # --- Paso 8: suspender_membresia ----------------------------------------
    # "hoy" avanza más allá de la cobertura de pago3 (vence 2027-04-01) para
    # que "no genera deuda" sea una aserción real, no trivial -- sin
    # suspensión, a esta altura ya habría un mes de mora.
    fecha_suspension = date(2027, 5, 1)
    _fijar_hoy(monkeypatch, fecha_suspension)
    membresia = pago_servicio.suspender_membresia(
        membresia.id, "Ausencia prolongada", actor_persona_id=admin.id,
        fecha_efectiva=datetime(2027, 5, 1, tzinfo=timezone.utc),
    )
    db_session.refresh(pago3)
    # Invariante 7 (#400), mitad suspensión: "detiene la generación de
    # deuda futura" -- pese a estar un mes pasada la cobertura de pago3, la
    # deuda es CERO mientras está suspendida.
    assert membresia.estado == EstadoMembresia.SUSPENDIDA
    assert pago_servicio.calcular_meses_adeudados(membresia.id) == 0
    # "...y la cobertura ya pagada no se toca" -- ni una columna de pago3 cambia.
    assert pago3.fecha_inicio == _sumar_meses(FECHA_INICIO, 2)
    assert pago3.fecha_fin == _sumar_meses(FECHA_INICIO, 3)
    assert pago3.estado_pago == EstadoPago.APROBADO
    # "...y bloquea nuevos pagos": un intento de registrar un pago nuevo se rechaza.
    with pytest.raises(mps.OperacionInvalida, match="suspendid"):
        pago_servicio.registrar_pago(
            PagoCreateDTO(meses=1, tipo_pago=TipoPago.TRANSFERENCIA, persona_id=socio.id, membresia_id=membresia.id),
            persona_id_solicitante=socio.id, roles_solicitante=[],
        )

    # --- Paso 9: reactivar_membresia ----------------------------------------
    fecha_reactivacion = date(2027, 6, 1)
    _fijar_hoy(monkeypatch, fecha_reactivacion)
    membresia = pago_servicio.reactivar_membresia(
        membresia.id, "Regresa al club", actor_persona_id=admin.id,
        fecha_efectiva=datetime(2027, 6, 1, tzinfo=timezone.utc),
    )
    # Invariante 7 (#400), mitad reactivación: "usa la tarifa vigente" --
    # resincroniza `monto_aplicado` desde el plan ACTUAL (`tipo_b`, el que
    # dejó el cambio de plan del paso 7), el segundo de los dos caminos
    # reales de resync.
    assert membresia.estado == EstadoMembresia.ACTIVA
    assert membresia.monto_aplicado == tipo_b.precio == Decimal("45.00")
    # "...no cobra el intervalo suspendido": el reloj de deuda arranca en la
    # fecha de REACTIVACIÓN (2027-06-01), no en el vencimiento original de
    # pago3 (2027-04-01) -- el mes de por medio (mientras estuvo suspendida)
    # nunca se convierte en deuda ni en saldo.
    assert pago_servicio.calcular_meses_adeudados(membresia.id) == 0

    # --- Paso 10: cuarto pago, registrado post-reactivación -----------------
    pago4 = pago_servicio.registrar_pago(
        PagoCreateDTO(meses=1, tipo_pago=TipoPago.TRANSFERENCIA, persona_id=socio.id, membresia_id=membresia.id),
        persona_id_solicitante=socio.id, roles_solicitante=[],
    )
    # Invariante 5a (#400, HANDOFF): "si vuelve DESPUÉS del vencimiento, el
    # nuevo período comienza en la fecha de reactivación" -- la cobertura de
    # pago3 (venció 2027-04-01) ya estaba vencida cuando se reactivó
    # (2027-06-01), así que el cuarto pago ancla en la fecha de
    # REACTIVACIÓN, no en el borde de pago3 -- el hueco de dos meses
    # (suspendida) queda libre, ni cobrado ni cubierto retroactivamente.
    assert pago4.fecha_inicio == fecha_reactivacion == _sumar_meses(FECHA_INICIO, 5)
    assert pago4.fecha_fin == _sumar_meses(fecha_reactivacion, 1)
    # Y usa la tarifa VIGENTE post-reactivación (tipo_b, $45), no la vieja
    # congelada de los primeros tres pagos -- mismo invariante 3 que el
    # paso 7, confirmado una vez más sobre el camino real de pago.
    assert pago4.tarifa_mensual_aplicada == Decimal("45.00")
    assert pago4.monto_base == Decimal("45.00")
    pago4 = pago_servicio.validar_pago(pago4.id, PagoValidarDTO(
        estado_pago=EstadoPago.APROBADO,
        # Issue #459: los cuatro pagos de este ciclo son TRANSFERENCIA sin
        # voucher (nunca se adjunta uno en esta narrativa) -- sin este
        # motivo, aprobar rechaza con `OperacionInvalida` desde este fix.
        motivo_excepcion_sin_comprobante="Verificado directamente en la cuenta del club.",
    ), actor_persona_id=admin.id)
    assert pago4.estado_pago == EstadoPago.APROBADO

    # Invariante 9 (#400): "dinero en Decimal, nunca float" -- tocado acá
    # como confirmación puntual de la cadena completa; el candado
    # exhaustivo vive en
    # `test_beneficio_en_pago.py::test_valores_congelados_son_decimal_no_float`.
    for pago in (pago1, pago2, pago3, pago4):
        assert isinstance(pago.monto, Decimal)
        assert isinstance(pago.tarifa_mensual_aplicada, Decimal)
    assert isinstance(membresia.monto_aplicado, Decimal)
