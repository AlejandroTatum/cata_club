"""Corrección financiera de pagos aprobados (issue #400, slice 5b).

Contrato de negocio bajo prueba, citado del issue ("Corrección financiera"):

    Toda corrección conserva: pago original; valores anteriores y nuevos;
    motivo obligatorio; administrador; fecha; efecto explícito sobre
    cobertura. No se permite borrar ni sobrescribir el rastro original.

Y la decisión de diseño ya tomada sobre superposición: reducir la
`fecha_fin` de un pago aprobado se rechaza si el nuevo rango rompe la
continuidad de cobertura de OTRO pago aprobado/cobertura bonificada de la
misma membresía (reutiliza `_hay_cobertura_en_rango`).

A diferencia de `regularizar_deuda` (que crea un `Pago` NUEVO),
`corregir_pago` muta el `Pago` EXISTENTE -- conserva su `id` -- y deja el
rastro en una fila `CorreccionPago` nueva.

Dos hallazgos MÁS de una revisión adversarial posterior, cerrados en este
mismo archivo:

1. Consistencia cruzada entre los seis campos corregibles: `fecha_fin` se
   deriva de `fecha_inicio` + `meses_comprados` (`_sumar_meses`), `monto_base`
   se deriva de `tarifa_mensual_aplicada * meses_comprados`, y `monto` se
   deriva de `monto_base` menos el descuento YA congelado del pago
   (`descuento_valor_aplicado`, que este DTO no permite tocar). Por esto,
   `_pago_aprobado` (más abajo) SIEMPRE construye un pago donde las tres
   fórmulas ya cierran desde el vamos -- igual que `registrar_pago` las
   deja -- así que cualquier corrección de un único campo relacionado
   (sin ajustar los demás) desalinea a propósito la fórmula que se está
   probando, en vez de partir de datos ya inconsistentes por descuido del
   fixture.
2. Race real entre `corregir_pago` y `registrar_pago`: antes de este fix,
   `registrar_pago` leía `_fecha_fin_maxima_combinada` sin lock, así que una
   corrección concurrente de `fecha_fin` podía dejarlo anclado sobre un
   valor viejo. Ambos ahora lockean la `Membresia` (orden consistente:
   Membresia primero, Pago después) antes de leer/escribir.
"""
import threading
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy.orm import Session

from app.dominio.cedula import cedula_valida
from app.dominio.enums import EfectoCoberturaCorreccion, EstadoMembresia, EstadoPago, TipoPago
from app.dominio.excepciones import EntidadNoEncontrada, OperacionInvalida
from app.dominio.modelos import CorreccionPago, Membresia, Pago, Persona, TipoMembresia
from app.presentacion.schemas.membresia_pago_schemas import CorreccionPagoDTO, PagoCreateDTO
from app.servicios_negocio.membresia_pago_servicio import PagoServicio, _sumar_meses
from tests.fabricas_pagos import crear_membresia_orm, crear_persona_orm, crear_tipo_membresia_orm

FECHA_INICIO = date(2027, 1, 1)
TARIFA = Decimal("30.00")


@pytest.fixture
def admin_id(db_session) -> int:
    """`actor_persona_id` es FK NOT NULL a `persona` (issue #400/5b): un id
    inventado rompe con `ForeignKeyViolation` en vez de ejercitar la regla
    de negocio bajo prueba."""
    return crear_persona_orm(db_session, cedula_valida(999)).id


def _pago_aprobado(
    db_session,
    persona: Persona,
    membresia,
    *,
    tarifa: Decimal = TARIFA,
    meses: int = 1,
    fecha_inicio: date = FECHA_INICIO,
    descuento_valor_aplicado: Decimal | None = None,
) -> Pago:
    """Pago APROBADO con las tres fórmulas de consistencia YA cerradas
    (mismas que `registrar_pago` deja): `fecha_fin = _sumar_meses(fecha_
    inicio, meses)`, `monto_base = tarifa * meses`, `monto = monto_base -
    descuento_valor_aplicado`. Los tests de este archivo desalinean UNA
    fórmula a la vez, a propósito, para probar el rechazo -- partir de un
    fixture ya inconsistente haría que esos tests no probaran nada nuevo."""
    monto_base = tarifa * meses
    monto = monto_base - (descuento_valor_aplicado or Decimal("0.00"))
    fecha_fin = _sumar_meses(fecha_inicio, meses)
    pago = Pago(
        monto=monto,
        tarifa_mensual_aplicada=tarifa,
        meses_comprados=meses,
        monto_base=monto_base,
        descuento_valor_aplicado=descuento_valor_aplicado,
        estado_pago=EstadoPago.APROBADO,
        tipo_pago=TipoPago.EFECTIVO,
        fecha_inicio=fecha_inicio,
        fecha_fin=fecha_fin,
        persona_id=persona.id,
        membresia_id=membresia.id,
    )
    db_session.add(pago)
    db_session.commit()
    return pago


def _pago_aprobado_sin_snapshot(
    db_session, persona: Persona, membresia, *,
    monto: Decimal = TARIFA, fecha_inicio: date = FECHA_INICIO, fecha_fin: date | None = None,
) -> Pago:
    """Pago APROBADO SIN snapshot congelado (`tarifa_mensual_aplicada`/
    `meses_comprados`/`monto_base` los tres `None`, mismo patrón que un pago
    histórico pre-#400 -- ver `Pago.tarifa_mensual_aplicada`). Las tres
    validaciones de consistencia cruzada del hallazgo 1 se saltan a
    propósito cuando el valor efectivo de la fórmula es `None` (no hay nada
    contra qué validar), así que ESTE es el fixture correcto para probar
    una corrección de `monto` verdaderamente AISLADA, sin que la fórmula
    `monto = monto_base - descuento` la desalinee."""
    pago = Pago(
        monto=monto,
        tarifa_mensual_aplicada=None,
        meses_comprados=None,
        monto_base=None,
        estado_pago=EstadoPago.APROBADO,
        tipo_pago=TipoPago.EFECTIVO,
        fecha_inicio=fecha_inicio,
        fecha_fin=fecha_fin or _sumar_meses(fecha_inicio, 1),
        persona_id=persona.id,
        membresia_id=membresia.id,
    )
    db_session.add(pago)
    db_session.commit()
    return pago


@pytest.fixture
def grafo(db_session):
    """Persona + tipo ($30/mes) + membresía ACTIVA + un pago APROBADO de
    1 mes (junio 2026, fecha_fin = 2026-07-01 por `_sumar_meses`)."""
    persona = crear_persona_orm(db_session, cedula_valida(900))
    tipo = crear_tipo_membresia_orm(db_session, precio=TARIFA)
    membresia = crear_membresia_orm(
        db_session, persona, tipo, EstadoMembresia.ACTIVA, monto_aplicado=TARIFA,
    )
    pago = _pago_aprobado(db_session, persona, membresia)
    return persona, tipo, membresia, pago


def _correcciones(db_session, pago_id: int) -> list[CorreccionPago]:
    return (
        db_session.query(CorreccionPago)
        .filter_by(pago_id=pago_id)
        .order_by(CorreccionPago.id)
        .all()
    )


# --- Corrección exitosa de un campo aislado (monto, sobre pago sin snapshot) --

def test_corregir_monto_actualiza_el_pago_y_registra_la_correccion(db_session, admin_id):
    persona = crear_persona_orm(db_session, cedula_valida(910))
    tipo = crear_tipo_membresia_orm(db_session, precio=TARIFA)
    membresia = crear_membresia_orm(db_session, persona, tipo, EstadoMembresia.ACTIVA, monto_aplicado=TARIFA)
    pago = _pago_aprobado_sin_snapshot(db_session, persona, membresia)

    resultado_pago, correccion = PagoServicio(db_session).corregir_pago(
        pago.id,
        CorreccionPagoDTO(monto=Decimal("45.00"), motivo="Corrección de tipeo"),
        actor_persona_id=admin_id,
    )

    assert resultado_pago.id == pago.id
    assert resultado_pago.monto == Decimal("45.00")

    filas = _correcciones(db_session, pago.id)
    assert len(filas) == 1
    fila = filas[0]
    assert fila.id == correccion.id
    assert fila.pago_id == pago.id
    assert fila.monto_anterior == Decimal("30.00")
    assert fila.monto_nuevo == Decimal("45.00")
    # Campos NO tocados: anterior == nuevo, pero SIGUEN registrados
    # (trazabilidad completa, no solo el delta). Este pago no tiene
    # snapshot, así que los tres quedan None/None.
    assert fila.fecha_inicio_anterior == fila.fecha_inicio_nuevo == pago.fecha_inicio
    assert fila.fecha_fin_anterior == fila.fecha_fin_nuevo == pago.fecha_fin
    assert fila.tarifa_mensual_aplicada_anterior is fila.tarifa_mensual_aplicada_nuevo is None
    assert fila.meses_comprados_anterior is fila.meses_comprados_nuevo is None
    assert fila.monto_base_anterior is fila.monto_base_nuevo is None
    assert fila.motivo == "Corrección de tipeo"
    assert fila.actor_persona_id == admin_id
    assert fila.fecha_registro is not None
    # Sin tocar fecha_fin: SIN_CAMBIO.
    assert fila.efecto_cobertura == EfectoCoberturaCorreccion.SIN_CAMBIO


def test_el_pago_original_conserva_su_id_no_se_crea_un_pago_nuevo(db_session, admin_id):
    """A diferencia de `regularizar_deuda` (crea un `Pago` NUEVO),
    `corregir_pago` muta el EXISTENTE."""
    persona = crear_persona_orm(db_session, cedula_valida(911))
    tipo = crear_tipo_membresia_orm(db_session, precio=TARIFA)
    membresia = crear_membresia_orm(db_session, persona, tipo, EstadoMembresia.ACTIVA, monto_aplicado=TARIFA)
    pago = _pago_aprobado_sin_snapshot(db_session, persona, membresia)
    total_antes = db_session.query(Pago).filter_by(membresia_id=membresia.id).count()

    PagoServicio(db_session).corregir_pago(
        pago.id,
        CorreccionPagoDTO(monto=Decimal("45.00"), motivo="motivo"),
        actor_persona_id=admin_id,
    )

    total_despues = db_session.query(Pago).filter_by(membresia_id=membresia.id).count()
    assert total_despues == total_antes
    assert db_session.get(Pago, pago.id) is not None


# --- Efecto sobre cobertura: AMPLIADA / REDUCIDA (set completo y coherente) --

def test_corregir_meses_amplia_la_cobertura_con_el_set_completo_coherente(db_session, grafo, admin_id):
    """Extiende de 1 a 2 meses: `fecha_fin`, `monto_base` y `monto` viajan
    JUNTOS con `meses_comprados`, manteniendo las tres fórmulas cerradas
    (issue #400/5b, hallazgo 1) -- así es como luce una corrección válida
    de cobertura en la práctica."""
    _, _, _, pago = grafo

    _, correccion = PagoServicio(db_session).corregir_pago(
        pago.id,
        CorreccionPagoDTO(
            meses_comprados=2,
            monto_base=Decimal("60.00"),
            monto=Decimal("60.00"),
            fecha_fin=_sumar_meses(FECHA_INICIO, 2),
            motivo="Extensión por gesto comercial",
        ),
        actor_persona_id=admin_id,
    )

    assert correccion.efecto_cobertura == EfectoCoberturaCorreccion.AMPLIADA
    assert correccion.fecha_fin_anterior == _sumar_meses(FECHA_INICIO, 1)
    assert correccion.fecha_fin_nuevo == _sumar_meses(FECHA_INICIO, 2)
    db_session.refresh(pago)
    assert pago.fecha_fin == _sumar_meses(FECHA_INICIO, 2)
    assert pago.monto_base == Decimal("60.00")
    assert pago.monto == Decimal("60.00")


def test_corregir_meses_reduce_la_cobertura_con_el_set_completo_coherente(db_session, admin_id):
    """Pago de 3 meses corregido a 2: mismo criterio, reducción en vez de
    extensión."""
    persona = crear_persona_orm(db_session, cedula_valida(912))
    tipo = crear_tipo_membresia_orm(db_session, precio=TARIFA)
    membresia = crear_membresia_orm(db_session, persona, tipo, EstadoMembresia.ACTIVA, monto_aplicado=TARIFA)
    pago = _pago_aprobado(db_session, persona, membresia, meses=3)

    _, correccion = PagoServicio(db_session).corregir_pago(
        pago.id,
        CorreccionPagoDTO(
            meses_comprados=2,
            monto_base=Decimal("60.00"),
            monto=Decimal("60.00"),
            fecha_fin=_sumar_meses(FECHA_INICIO, 2),
            motivo="El socio solo pagó 2 meses, no 3",
        ),
        actor_persona_id=admin_id,
    )

    assert correccion.efecto_cobertura == EfectoCoberturaCorreccion.REDUCIDA
    assert correccion.fecha_fin_nuevo == _sumar_meses(FECHA_INICIO, 2)


# --- Motivo obligatorio ---------------------------------------------------

def test_dto_sin_motivo_es_rechazado():
    with pytest.raises(ValueError):
        CorreccionPagoDTO(monto=Decimal("45.00"), motivo="   ")


def test_corregir_sin_motivo_es_rechazada_en_el_servicio(db_session, admin_id):
    """Doble validación (DTO Y servicio), mismo criterio que
    `regularizar_deuda`: el servicio no debe confiar únicamente en el DTO."""
    persona = crear_persona_orm(db_session, cedula_valida(913))
    tipo = crear_tipo_membresia_orm(db_session, precio=TARIFA)
    membresia = crear_membresia_orm(db_session, persona, tipo, EstadoMembresia.ACTIVA, monto_aplicado=TARIFA)
    pago = _pago_aprobado_sin_snapshot(db_session, persona, membresia)
    datos = CorreccionPagoDTO.model_construct(
        monto=Decimal("45.00"), motivo="   ",
        tarifa_mensual_aplicada=None, meses_comprados=None, monto_base=None,
        fecha_inicio=None, fecha_fin=None,
    )
    with pytest.raises(OperacionInvalida):
        PagoServicio(db_session).corregir_pago(pago.id, datos, actor_persona_id=admin_id)


# --- Guardia de estado: solo un pago APROBADO puede corregirse ---------------

@pytest.mark.parametrize("estado", [EstadoPago.PENDIENTE_VALIDACION, EstadoPago.RECHAZADO])
def test_corregir_pago_no_aprobado_es_rechazada(db_session, estado, admin_id):
    persona = crear_persona_orm(db_session, cedula_valida(901))
    tipo = crear_tipo_membresia_orm(db_session)
    membresia = crear_membresia_orm(db_session, persona, tipo, EstadoMembresia.INACTIVA)
    pago = Pago(
        monto=Decimal("30.00"),
        estado_pago=estado,
        tipo_pago=TipoPago.EFECTIVO,
        fecha_inicio=date(2026, 6, 1),
        fecha_fin=date(2026, 6, 30),
        persona_id=persona.id,
        membresia_id=membresia.id,
    )
    db_session.add(pago)
    db_session.commit()

    with pytest.raises(OperacionInvalida, match="aprobado puede corregirse"):
        PagoServicio(db_session).corregir_pago(
            pago.id,
            CorreccionPagoDTO(monto=Decimal("50.00"), motivo="motivo"),
            actor_persona_id=admin_id,
        )
    assert _correcciones(db_session, pago.id) == []


def test_corregir_pago_inexistente_lanza_entidad_no_encontrada(db_session, admin_id):
    with pytest.raises(EntidadNoEncontrada):
        PagoServicio(db_session).corregir_pago(
            999999,
            CorreccionPagoDTO(monto=Decimal("50.00"), motivo="motivo"),
            actor_persona_id=admin_id,
        )


# --- Ningún valor cambia: rechazada -------------------------------------------

def test_corregir_sin_cambiar_ningun_valor_es_rechazada(db_session, admin_id):
    persona = crear_persona_orm(db_session, cedula_valida(914))
    tipo = crear_tipo_membresia_orm(db_session, precio=TARIFA)
    membresia = crear_membresia_orm(db_session, persona, tipo, EstadoMembresia.ACTIVA, monto_aplicado=TARIFA)
    pago = _pago_aprobado_sin_snapshot(db_session, persona, membresia)

    with pytest.raises(OperacionInvalida, match="no modifica ningún valor"):
        PagoServicio(db_session).corregir_pago(
            pago.id,
            CorreccionPagoDTO(monto=Decimal("30.00"), motivo="motivo"),
            actor_persona_id=admin_id,
        )
    assert _correcciones(db_session, pago.id) == []


# --- Hallazgo 1: consistencia cruzada entre los seis campos ------------------

def test_corregir_meses_comprados_solo_sin_ajustar_fechas_es_rechazada(db_session, grafo, admin_id):
    """Tocar `meses_comprados` sin ajustar `fecha_fin` (ni `monto_base`)
    deja el pago describiendo un período que ya no coincide con lo que dice
    haber comprado -- se rechaza."""
    _, _, _, pago = grafo

    with pytest.raises(OperacionInvalida, match="fecha de fin no coincide"):
        PagoServicio(db_session).corregir_pago(
            pago.id,
            CorreccionPagoDTO(meses_comprados=2, motivo="Solo cambio los meses"),
            actor_persona_id=admin_id,
        )
    assert _correcciones(db_session, pago.id) == []
    db_session.refresh(pago)
    assert pago.meses_comprados == 1
    assert pago.fecha_fin == _sumar_meses(FECHA_INICIO, 1)


def test_corregir_monto_base_sin_ajustar_monto_es_rechazada(db_session, grafo, admin_id):
    """`tarifa_mensual_aplicada` y `monto_base` corregidos de forma
    coherente entre sí (45 = 45 * 1 mes) pero SIN ajustar `monto` -- que
    sigue describiendo el monto viejo (30) -- se rechaza: `monto` debe
    seguir siendo `monto_base - descuento_valor_aplicado`."""
    _, _, _, pago = grafo

    with pytest.raises(OperacionInvalida, match="monto final no coincide"):
        PagoServicio(db_session).corregir_pago(
            pago.id,
            CorreccionPagoDTO(
                tarifa_mensual_aplicada=Decimal("45.00"),
                monto_base=Decimal("45.00"),
                motivo="Ajuste de tarifa sin tocar el monto final",
            ),
            actor_persona_id=admin_id,
        )
    assert _correcciones(db_session, pago.id) == []
    db_session.refresh(pago)
    assert pago.monto == Decimal("30.00")


def test_corregir_monto_base_inconsistente_con_tarifa_y_meses_es_rechazada(db_session, grafo, admin_id):
    """`monto_base` corregido sin que `tarifa_mensual_aplicada * meses_
    comprados` lo respalde -- se rechaza incluso antes de llegar al chequeo
    de `monto`."""
    _, _, _, pago = grafo

    with pytest.raises(OperacionInvalida, match="monto base no coincide"):
        PagoServicio(db_session).corregir_pago(
            pago.id,
            CorreccionPagoDTO(monto_base=Decimal("99.00"), motivo="Monto base arbitrario"),
            actor_persona_id=admin_id,
        )
    assert _correcciones(db_session, pago.id) == []


def test_corregir_set_completo_coherente_de_campos_relacionados_es_aceptada(db_session, grafo, admin_id):
    """Contraparte positiva: cuando el DTO manda TODOS los campos que una
    fórmula relaciona, de forma consistente entre sí, la corrección se
    acepta -- las validaciones de consistencia cruzada no bloquean una
    corrección genuinamente coherente."""
    _, _, _, pago = grafo

    resultado_pago, correccion = PagoServicio(db_session).corregir_pago(
        pago.id,
        CorreccionPagoDTO(
            tarifa_mensual_aplicada=Decimal("45.00"),
            meses_comprados=1,
            monto_base=Decimal("45.00"),
            monto=Decimal("45.00"),
            motivo="Se corrige la tarifa aplicada por completo",
        ),
        actor_persona_id=admin_id,
    )

    assert resultado_pago.tarifa_mensual_aplicada == Decimal("45.00")
    assert resultado_pago.monto_base == Decimal("45.00")
    assert resultado_pago.monto == Decimal("45.00")
    assert correccion.tarifa_mensual_aplicada_nuevo == Decimal("45.00")
    # fecha_fin no se tocó: sigue siendo consistente con meses_comprados=1
    # (que tampoco cambió de valor efectivo), así que el chequeo 1 no
    # aplica y la corrección no queda bloqueada por eso.
    assert correccion.efecto_cobertura == EfectoCoberturaCorreccion.SIN_CAMBIO


def test_corregir_monto_respeta_el_descuento_ya_congelado(db_session, admin_id):
    """El chequeo `monto == monto_base - descuento_valor_aplicado` usa el
    descuento YA congelado del pago (no corregible por este DTO) -- una
    corrección de `monto_base` debe traer un `monto` que siga respetando
    ESE descuento, no un monto_base sin descuento."""
    persona = crear_persona_orm(db_session, cedula_valida(915))
    tipo = crear_tipo_membresia_orm(db_session, precio=TARIFA)
    membresia = crear_membresia_orm(db_session, persona, tipo, EstadoMembresia.ACTIVA, monto_aplicado=TARIFA)
    pago = _pago_aprobado(db_session, persona, membresia, descuento_valor_aplicado=Decimal("10.00"))
    assert pago.monto == Decimal("20.00")  # 30 monto_base - 10 descuento

    with pytest.raises(OperacionInvalida, match="monto final no coincide"):
        PagoServicio(db_session).corregir_pago(
            pago.id,
            CorreccionPagoDTO(
                tarifa_mensual_aplicada=Decimal("40.00"),
                monto_base=Decimal("40.00"),
                monto=Decimal("40.00"),
                motivo="Ignora el descuento",
            ),
            actor_persona_id=admin_id,
        )
    db_session.rollback()

    # La corrección CORRECTA debe descontar el mismo valor congelado (10.00),
    # no el monto_base a secas.
    resultado_pago, _ = PagoServicio(db_session).corregir_pago(
        pago.id,
        CorreccionPagoDTO(
            tarifa_mensual_aplicada=Decimal("40.00"),
            monto_base=Decimal("40.00"),
            monto=Decimal("30.00"),
            motivo="Respeta el descuento",
        ),
        actor_persona_id=admin_id,
    )
    assert resultado_pago.monto == Decimal("30.00")
    assert resultado_pago.monto_base == Decimal("40.00")


# --- Superposición con la cobertura de otro pago aprobado ---------------------

def test_reducir_cobertura_que_rompe_continuidad_con_pago_posterior_es_rechazada(
    db_session, admin_id,
):
    """Decisión de diseño ya tomada: un pago POSTERIOR ancló su
    `fecha_inicio` exactamente sobre el `fecha_fin` original de este pago
    -- mismo criterio que `registrar_pago` usa siempre (`fecha_inicio =
    ultima_fecha_fin`). Reducir la cobertura de 3 a 2 meses dejaría un
    hueco roto en la cadena -- se rechaza."""
    persona = crear_persona_orm(db_session, cedula_valida(916))
    tipo = crear_tipo_membresia_orm(db_session, precio=TARIFA)
    membresia = crear_membresia_orm(db_session, persona, tipo, EstadoMembresia.ACTIVA, monto_aplicado=TARIFA)
    pago = _pago_aprobado(db_session, persona, membresia, meses=3)
    fecha_fin_original = _sumar_meses(FECHA_INICIO, 3)
    pago_posterior = Pago(
        monto=Decimal("30.00"),
        estado_pago=EstadoPago.APROBADO,
        tipo_pago=TipoPago.EFECTIVO,
        fecha_inicio=fecha_fin_original,
        fecha_fin=_sumar_meses(fecha_fin_original, 1),
        persona_id=persona.id,
        membresia_id=membresia.id,
    )
    db_session.add(pago_posterior)
    db_session.commit()

    with pytest.raises(OperacionInvalida, match="superpone o rompe la continuidad"):
        PagoServicio(db_session).corregir_pago(
            pago.id,
            CorreccionPagoDTO(
                meses_comprados=2,
                monto_base=Decimal("60.00"),
                monto=Decimal("60.00"),
                fecha_fin=_sumar_meses(FECHA_INICIO, 2),
                motivo="Ajuste",
            ),
            actor_persona_id=admin_id,
        )
    assert _correcciones(db_session, pago.id) == []
    db_session.refresh(pago)
    assert pago.fecha_fin == fecha_fin_original


def test_corregir_cobertura_sin_solapar_ningun_otro_pago_no_se_rechaza_a_si_mismo(
    db_session, grafo, admin_id,
):
    """Ancla negativa del test anterior: sin excluir el propio pago del
    chequeo de superposición, CUALQUIER corrección de fecha se rechazaría
    (el pago se solaparía consigo mismo)."""
    _, _, _, pago = grafo

    resultado_pago, correccion = PagoServicio(db_session).corregir_pago(
        pago.id,
        CorreccionPagoDTO(
            meses_comprados=2,
            monto_base=Decimal("60.00"),
            monto=Decimal("60.00"),
            fecha_fin=_sumar_meses(FECHA_INICIO, 2),
            motivo="Ajuste sin conflicto",
        ),
        actor_persona_id=admin_id,
    )

    assert resultado_pago.fecha_fin == _sumar_meses(FECHA_INICIO, 2)
    assert correccion.efecto_cobertura == EfectoCoberturaCorreccion.AMPLIADA


# --- Actor no admin: PermisosInsuficientes (a nivel router) -------------------

def test_corregir_pago_sin_rol_admin_da_403(client_sin_permisos, db_session):
    persona = crear_persona_orm(db_session, cedula_valida(902))
    tipo = crear_tipo_membresia_orm(db_session)
    membresia = crear_membresia_orm(db_session, persona, tipo, EstadoMembresia.ACTIVA)
    pago = _pago_aprobado_sin_snapshot(db_session, persona, membresia)

    resp = client_sin_permisos.post(
        f"/api/v1/membresias/pagos/{pago.id}/corregir",
        json={"monto": "45.00", "motivo": "motivo"},
    )
    assert resp.status_code == 403


def test_corregir_pago_via_api_admin_devuelve_pago_y_correccion(client, db_session):
    """Camino feliz vía API (mismo criterio que
    `test_regularizacion_deuda.py::test_regularizacion_total`): el `client`
    de conftest está autenticado como ADMINISTRADOR con `persona_id=1`."""
    persona = crear_persona_orm(db_session, cedula_valida(903))
    tipo = crear_tipo_membresia_orm(db_session)
    membresia = crear_membresia_orm(db_session, persona, tipo, EstadoMembresia.ACTIVA)
    pago = _pago_aprobado_sin_snapshot(db_session, persona, membresia)

    resp = client.post(
        f"/api/v1/membresias/pagos/{pago.id}/corregir",
        json={"monto": "55.00", "motivo": "Corrección vía API"},
    )
    assert resp.status_code == 201, resp.text
    cuerpo = resp.json()
    assert cuerpo["pago"]["monto"] == "55.00"
    assert cuerpo["correccion"]["montoAnterior"] == "30.00"
    assert cuerpo["correccion"]["montoNuevo"] == "55.00"
    assert cuerpo["correccion"]["motivo"] == "Corrección vía API"

    resp_listado = client.get(f"/api/v1/membresias/pagos/{pago.id}/correcciones")
    assert resp_listado.status_code == 200
    assert len(resp_listado.json()) == 1


# --- Concurrencia REAL: dos correcciones del mismo pago -----------------------

def _limpiar_grafo(motor_test, *, persona_ids: list[int], membresia_id: int, tipo_id: int) -> None:
    limpieza = Session(bind=motor_test)
    try:
        limpieza.query(CorreccionPago).filter(
            CorreccionPago.pago_id.in_(
                limpieza.query(Pago.id).filter(Pago.membresia_id == membresia_id)
            )
        ).delete(synchronize_session=False)
        limpieza.query(Pago).filter(Pago.membresia_id == membresia_id).delete()
        limpieza.query(Membresia).filter(Membresia.id == membresia_id).delete()
        limpieza.query(TipoMembresia).filter(TipoMembresia.id == tipo_id).delete()
        limpieza.query(Persona).filter(Persona.id.in_(persona_ids)).delete(
            synchronize_session=False
        )
        limpieza.commit()
    finally:
        limpieza.close()


def test_dos_correcciones_concurrentes_del_mismo_pago_se_serializan(motor_test):
    """Concurrencia REAL (no simulada), mismo patrón que
    `test_suspension_reactivacion.py::
    test_dos_reactivaciones_concurrentes_de_la_misma_membresia_solo_una_gana`:
    dos hilos corrigen el MISMO pago a la vez, con sesiones independientes.

    Sin `obtener_por_id_con_bloqueo` (`SELECT ... FOR UPDATE`), los dos
    hilos leerían el mismo `monto` de origen y las dos escrituras
    competirían sin ningún orden garantizado. Con el lock, el segundo hilo
    espera el commit del primero y relee el valor YA corregido -- las dos
    correcciones se aplican en secuencia, ninguna se pierde, y el
    `monto_anterior` de la segunda fila es el `monto_nuevo` de la primera.

    Pago SIN snapshot (`_pago_aprobado_sin_snapshot`) a propósito: las dos
    correcciones tocan solo `monto`, y el chequeo de consistencia cruzada
    (hallazgo 1) exigiría tocar `monto_base` también si el pago tuviera
    snapshot -- acá el foco es la serialización, no esa validación."""
    sesion_setup = Session(bind=motor_test)
    admin = crear_persona_orm(sesion_setup, cedula_valida(980), telefono="0990000980")
    socio = crear_persona_orm(sesion_setup, cedula_valida(981), telefono="0990000981")
    tipo = crear_tipo_membresia_orm(sesion_setup, precio=Decimal("30.00"))
    membresia = crear_membresia_orm(
        sesion_setup, socio, tipo, EstadoMembresia.ACTIVA, monto_aplicado=Decimal("30.00"),
    )
    pago = _pago_aprobado_sin_snapshot(sesion_setup, socio, membresia)
    sesion_setup.commit()
    pago_id, membresia_id = pago.id, membresia.id
    socio_id, admin_id_local, tipo_id = socio.id, admin.id, tipo.id
    sesion_setup.close()

    barrera = threading.Barrier(2, timeout=15)
    resultados: list = [None, None]

    def corregir(indice: int, monto_nuevo: str):
        sesion = Session(bind=motor_test)
        try:
            barrera.wait()
            pago_resultado, correccion = PagoServicio(sesion).corregir_pago(
                pago_id,
                CorreccionPagoDTO(monto=Decimal(monto_nuevo), motivo=f"Corrección {indice}"),
                actor_persona_id=admin_id_local,
            )
            resultados[indice] = (pago_resultado.monto, correccion.monto_anterior)
        except BaseException as error:  # noqa: BLE001 -- el test inspecciona el fallo
            resultados[indice] = error
            sesion.rollback()
        finally:
            sesion.close()

    hilos = [
        threading.Thread(target=corregir, args=(0, "40.00")),
        threading.Thread(target=corregir, args=(1, "50.00")),
    ]
    for hilo in hilos:
        hilo.start()
    for hilo in hilos:
        hilo.join(timeout=30)

    # Ninguno de los dos hilos debe haber lanzado una excepción: el lock
    # serializa, no rechaza -- a diferencia de suspender/reactivar, corregir
    # dos veces el MISMO pago con motivos distintos es una secuencia válida
    # de correcciones, no un choque de estado.
    errores = [r for r in resultados if isinstance(r, BaseException)]
    assert errores == [], f"ninguna corrección debía fallar: {errores}"

    verificacion = Session(bind=motor_test)
    try:
        filas = (
            verificacion.query(CorreccionPago)
            .filter_by(pago_id=pago_id)
            .order_by(CorreccionPago.id)
            .all()
        )
        # Las DOS correcciones quedaron registradas -- ninguna se perdió.
        assert len(filas) == 2
        montos_nuevos_registrados = {fila.monto_nuevo for fila in filas}
        assert montos_nuevos_registrados == {Decimal("40.00"), Decimal("50.00")}
        # La segunda en aplicarse (por orden de escritura real, `id` ASC)
        # partió del `monto_nuevo` que dejó la primera -- ninguna corrección
        # se aplicó sobre datos obsoletos.
        assert filas[1].monto_anterior == filas[0].monto_nuevo

        pago_final = verificacion.get(Pago, pago_id)
        assert pago_final.monto == filas[1].monto_nuevo
    finally:
        verificacion.close()

    _limpiar_grafo(
        motor_test,
        persona_ids=[admin_id_local, socio_id],
        membresia_id=membresia_id,
        tipo_id=tipo_id,
    )


# --- Hallazgo 2: race real entre corregir_pago y registrar_pago --------------

def test_corregir_pago_concurrente_con_registrar_pago_no_pierde_ni_solapa_cobertura(motor_test):
    """Concurrencia REAL (issue #400/5b, hallazgo del revisor): antes de
    este fix, un `Pago` APROBADO era inmutable, así que `registrar_pago`
    podía leer `_fecha_fin_maxima_combinada` sin lock -- nunca había una
    escritura concurrente que la corriera. `corregir_pago` introduce esa
    ventana: reduce la cobertura de un pago de 3 meses a 2, mientras otro
    hilo registra un pago NUEVO anclado en `_fecha_fin_maxima_combinada`
    para la MISMA membresía.

    Ambos métodos ahora lockean la `Membresia` con `FOR UPDATE` antes de
    leer/escribir (orden Membresia-primero en los dos, sin ciclo posible de
    deadlock), así que las dos operaciones se serializan por completo: cada
    una ve o el estado ANTERIOR completo o el estado NUEVO completo de la
    otra, nunca una mezcla. Con solo dos órdenes posibles:

    - Si `registrar_pago` corre DESPUÉS de que la corrección commiteó, ancla
      sobre el valor YA reducido: el pago nuevo queda perfectamente
      contiguo con el pago corregido (sin hueco, sin solape).
    - Si `registrar_pago` corre ANTES (o gana la carrera por el lock), ancla
      sobre el valor VIEJO (sin reducir todavía): el pago nuevo ocupa el
      tramo que la corrección, al reducir DESPUÉS, deja de reclamar -- sin
      solape (el pago corregido termina antes de donde empieza el nuevo),
      aunque con un hueco intermedio, que es la consecuencia esperada de
      haber registrado antes de que se conociera la reducción, no una
      corrupción.

    En NINGÚN caso el pago nuevo puede terminar solapando al corregido --
    eso exigiría que `registrar_pago` leyera un ancla que ya no es ni el
    valor viejo ni el nuevo (una lectura a medio escribir), que es
    precisamente lo que el lock de `Membresia` impide."""
    sesion_setup = Session(bind=motor_test)
    admin = crear_persona_orm(sesion_setup, cedula_valida(990), telefono="0990000990")
    socio = crear_persona_orm(sesion_setup, cedula_valida(991), telefono="0990000991")
    tipo = crear_tipo_membresia_orm(sesion_setup, precio=TARIFA)
    membresia = crear_membresia_orm(
        sesion_setup, socio, tipo, EstadoMembresia.ACTIVA, monto_aplicado=TARIFA,
    )
    pago_a = _pago_aprobado(sesion_setup, socio, membresia, meses=3)
    sesion_setup.commit()
    pago_a_id, membresia_id = pago_a.id, membresia.id
    socio_id, admin_id_local, tipo_id = socio.id, admin.id, tipo.id
    fecha_fin_original = _sumar_meses(FECHA_INICIO, 3)
    fecha_fin_reducida = _sumar_meses(FECHA_INICIO, 2)
    sesion_setup.close()

    barrera = threading.Barrier(2, timeout=15)
    resultados: list = [None, None]

    def corregir():
        sesion = Session(bind=motor_test)
        try:
            barrera.wait()
            PagoServicio(sesion).corregir_pago(
                pago_a_id,
                CorreccionPagoDTO(
                    meses_comprados=2,
                    monto_base=Decimal("60.00"),
                    monto=Decimal("60.00"),
                    fecha_fin=fecha_fin_reducida,
                    motivo="El socio solo pagó 2 meses",
                ),
                actor_persona_id=admin_id_local,
            )
            resultados[0] = "ok"
        except BaseException as error:  # noqa: BLE001 -- el test inspecciona el fallo
            resultados[0] = error
            sesion.rollback()
        finally:
            sesion.close()

    def registrar():
        sesion = Session(bind=motor_test)
        try:
            barrera.wait()
            PagoServicio(sesion).registrar_pago(
                PagoCreateDTO(
                    meses=1, tipo_pago=TipoPago.EFECTIVO,
                    persona_id=socio_id, membresia_id=membresia_id,
                ),
                persona_id_solicitante=socio_id,
                roles_solicitante=[],
            )
            resultados[1] = "ok"
        except BaseException as error:  # noqa: BLE001 -- el test inspecciona el fallo
            resultados[1] = error
            sesion.rollback()
        finally:
            sesion.close()

    hilos = [
        threading.Thread(target=corregir),
        threading.Thread(target=registrar),
    ]
    for hilo in hilos:
        hilo.start()
    for hilo in hilos:
        hilo.join(timeout=30)

    errores = [r for r in resultados if isinstance(r, BaseException)]
    assert errores == [], f"ninguna de las dos operaciones debía fallar: {errores}"

    verificacion = Session(bind=motor_test)
    try:
        pago_a_final = verificacion.get(Pago, pago_a_id)
        pago_b = (
            verificacion.query(Pago)
            .filter(Pago.membresia_id == membresia_id, Pago.id != pago_a_id)
            .one()
        )

        # La corrección se aplicó tal cual se pidió, sin importar el orden.
        assert pago_a_final.fecha_fin == fecha_fin_reducida

        # Invariante universal: nunca queda cobertura SOLAPADA entre el pago
        # corregido y el recién registrado (semántica medio-abierta, mismo
        # criterio que `aplicar_beneficio_bonificado`).
        solapan = (
            pago_a_final.fecha_inicio < pago_b.fecha_fin
            and pago_a_final.fecha_fin > pago_b.fecha_inicio
        )
        assert not solapan, (
            f"cobertura solapada: A=[{pago_a_final.fecha_inicio},{pago_a_final.fecha_fin}] "
            f"B=[{pago_b.fecha_inicio},{pago_b.fecha_fin}]"
        )

        # El ancla de `registrar_pago` debe ser EXACTAMENTE uno de los dos
        # valores válidos (viejo o nuevo) -- nunca un tercer valor, que solo
        # podría salir de una lectura a medio escribir.
        assert pago_b.fecha_inicio in (fecha_fin_original, fecha_fin_reducida)
        if pago_b.fecha_inicio == fecha_fin_reducida:
            # `registrar_pago` corrió DESPUÉS de la corrección: contiguo,
            # sin hueco.
            assert pago_b.fecha_inicio == pago_a_final.fecha_fin
        else:
            # `registrar_pago` corrió ANTES: el pago corregido termina en
            # o antes de donde el nuevo empieza -- nunca lo pisa.
            assert pago_a_final.fecha_fin <= pago_b.fecha_inicio
    finally:
        verificacion.close()

    _limpiar_grafo(
        motor_test,
        persona_ids=[admin_id_local, socio_id],
        membresia_id=membresia_id,
        tipo_id=tipo_id,
    )
