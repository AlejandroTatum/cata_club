"""Suspensión y reactivación de membresías (issue #400, slice 5a).

Reglas de negocio bajo prueba, citadas del issue ("Suspensión temporal"):

- Solo administración suspende o reactiva (guardia de rol: ver
  `test_guardia_autorizacion_rutas.py`, no acá).
- Suspender detiene la generación de deuda futura y bloquea nuevos pagos.
- La cobertura ya pagada conserva su fecha final original: no se congela,
  no se extiende, no se devuelve, no se convierte en saldo.
- Si vuelve antes del vencimiento, usa la cobertura que todavía sigue
  vigente. Si vuelve después, el nuevo período comienza en la fecha de
  reactivación y usa la tarifa vigente.
- Los meses entre el fin de cobertura y la reactivación no generan deuda.
- Se conservan plan, beneficio, pagos e historial.
- Suspensión y reactivación registran fecha efectiva, actor y motivo.

Más cinco gaps concretos que un relevamiento previo encontró y que este
archivo cierra explícitamente (ver los docstrings de cada método en
`PagoServicio` para el razonamiento completo):

1. `calcular_meses_adeudados` no leía `Membresia.estado`.
2. El índice único y el chequeo Python de "una sola membresía operativa"
   solo cubrían ACTIVA, no SUSPENDIDA.
3. `reactivar_membresia` re-sincroniza la tarifa desde el catálogo.
4. La reactivación NUNCA compara contra `Membresia.estado` para decidir
   cobertura vigente vs. vencida -- compara fechas, siempre.
5. `registrar_pago` y `aplicar_beneficio_bonificado` bloquean sobre
   SUSPENDIDA.

`alertar_mora_diaria` (gap 1, mitad del selector) se probó en
`test_alertas_mora.py::test_membresia_suspendida_no_genera_aviso`, junto a
su hermana `test_membresia_inactiva_no_genera_aviso` -- ese archivo ya trae
el arnés completo (Celery, SMTP mockeado, `hoy_club` congelado) y duplicarlo
acá no habría ganado nada.

Dos hallazgos MÁS de una revisión adversarial posterior, cerrados en este
mismo archivo:

6. Sin lock de fila, dos `reactivar_membresia`/`suspender_membresia`
   concurrentes sobre la MISMA membresía leían el mismo estado de origen y
   las dos pasaban la guardia -- el índice único parcial no las ve chocar
   porque las dos actualizan la fila que YA ocupa el slot, nunca una fila
   distinta. Cerrado con `MembresiaRepositorio.obtener_por_id_con_bloqueo`
   (`SELECT ... FOR UPDATE`, mismo patrón que `validar_pago`), probado con
   concurrencia REAL (dos hilos, dos sesiones) en
   `test_dos_reactivaciones_concurrentes_de_la_misma_membresia_solo_una_gana`.
7. `fecha_efectiva` llegaba sin validar: un valor futuro corría el ancla de
   `calcular_meses_adeudados` hacia adelante ("meses gratis" fabricados), y
   un naive datetime se interpretaba con el tz del proceso en vez de UTC.
   Cerrado con `PagoServicio._validar_fecha_efectiva` (rechaza futuro y
   retroceso respecto de la transición previa) y `SuspensionReactivacionDTO.
   _normalizar_timezone` (naive -> UTC, mismo criterio que `_ensure_utc_
   aware` del lado de salida).
"""
import threading
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import app.servicios_negocio.membresia_pago_servicio as mps
from app.dominio.cedula import cedula_valida
from app.dominio.enums import EstadoMembresia, TipoPago
from app.dominio.excepciones import OperacionInvalida
from app.dominio.modelos import (
    AsignacionDescuento, CoberturaBonificada, Descuento, HistorialEstadoMembresia, Membresia,
    Pago, Persona, TipoMembresia,
)
from app.presentacion.schemas.cobertura_bonificada_schemas import CoberturaBonificadaCreateDTO
from app.presentacion.schemas.membresia_pago_schemas import PagoCreateDTO, SuspensionReactivacionDTO
from app.servicios_negocio.membresia_pago_servicio import MembresiaServicio, PagoServicio
from tests.fabricas_pagos import crear_membresia_orm, crear_persona_orm, crear_tipo_membresia_orm

HOY_CLUB_REAL = mps.hoy_club


def _fijar_hoy(monkeypatch, dia: date) -> None:
    """Congela `hoy_club()` (sin argumento) en `dia`, pero preserva la
    conversión REAL de un instante recibido (`hoy_club(instante)`) -- la
    necesita `calcular_meses_adeudados` para convertir `fecha_efectiva` de
    la última reactivación a día del club. Mismo criterio de mock que
    `test_regularizacion_deuda.py`, extendido para no romper la variante con
    argumento."""

    def _fake(instante: datetime | None = None) -> date:
        if instante is None:
            return dia
        return HOY_CLUB_REAL(instante)

    monkeypatch.setattr(mps, "hoy_club", _fake)


@pytest.fixture
def grafo(db_session):
    """Persona + tipo ($30/mes) + membresía ACTIVA, sin pago todavía."""
    persona = crear_persona_orm(db_session, cedula_valida(900))
    tipo = crear_tipo_membresia_orm(db_session, precio=Decimal("30.00"))
    membresia = crear_membresia_orm(
        db_session, persona, tipo, EstadoMembresia.ACTIVA,
        monto_aplicado=Decimal("30.00"),
    )
    return persona, tipo, membresia


@pytest.fixture
def admin_id(db_session) -> int:
    """`actor_persona_id` es FK a `persona` (issue #400): un id inventado
    (999) rompe con `ForeignKeyViolation` en vez de ejercitar la regla de
    negocio bajo prueba. El admin de las pruebas es una `Persona` real, sin
    rol ni membresía -- nada de este archivo verifica el guardia de rol
    (eso vive en `test_guardia_autorizacion_rutas.py`), solo que el actor
    quede bien registrado en la auditoría."""
    return crear_persona_orm(db_session, cedula_valida(999)).id


def _aprobar_pago(db_session, persona, membresia, fecha_inicio: date, fecha_fin: date) -> Pago:
    pago = Pago(
        monto=Decimal("30.00"),
        estado_pago=mps.EstadoPago.APROBADO,
        tipo_pago=TipoPago.EFECTIVO,
        fecha_inicio=fecha_inicio,
        fecha_fin=fecha_fin,
        persona_id=persona.id,
        membresia_id=membresia.id,
    )
    db_session.add(pago)
    db_session.commit()
    return pago


def _sembrar_cobertura_bonificada(
    db_session, persona, membresia, admin_id: int, fecha_inicio: date, fecha_fin: date,
) -> CoberturaBonificada:
    """Siembra directa por ORM (sin pasar por `aplicar_beneficio_bonificado`
    ni por el endpoint): más barata que armar un beneficio 100% real de
    punta a punta, y acá solo hace falta la FILA -- el objetivo es un
    baseline de `CoberturaBonificada` NO-CERO para
    `test_reactivar_antes_del_vencimiento_usa_la_cobertura_vigente`, no
    ejercitar el camino de otorgamiento (eso ya lo cubre
    `test_cobertura_bonificada.py`)."""
    descuento = Descuento(nombre=f"Becado {membresia.id}", porcentaje=Decimal("100.00"), activo=True)
    db_session.add(descuento)
    db_session.flush()
    asignacion = AsignacionDescuento(
        persona_id=persona.id, descuento_id=descuento.id, asignado_por_persona_id=admin_id,
    )
    db_session.add(asignacion)
    db_session.flush()
    cobertura = CoberturaBonificada(
        membresia_id=membresia.id,
        persona_id=persona.id,
        asignacion_descuento_id=asignacion.id,
        tarifa_mensual_aplicada=Decimal("30.00"),
        meses_comprados=1,
        descuento_valor_aplicado=Decimal("30.00"),
        descuento_porcentaje_aplicado=Decimal("100.00"),
        fecha_inicio=fecha_inicio,
        fecha_fin=fecha_fin,
        otorgada_por_persona_id=persona.id,
    )
    db_session.add(cobertura)
    db_session.commit()
    return cobertura


def _historial(db_session, membresia_id: int) -> list[HistorialEstadoMembresia]:
    return (
        db_session.query(HistorialEstadoMembresia)
        .filter_by(membresia_id=membresia_id)
        .order_by(HistorialEstadoMembresia.id)
        .all()
    )


# --- Suspender ----------------------------------------------------------------

def test_suspender_activa_cambia_estado_y_registra_historial(db_session, grafo, admin_id):
    persona, _, membresia = grafo
    pago = _aprobar_pago(db_session, persona, membresia, date(2026, 6, 1), date(2026, 12, 31))
    efectiva = datetime(2026, 8, 1, 12, 0, tzinfo=timezone.utc)

    resultado = PagoServicio(db_session).suspender_membresia(
        membresia.id, "Viaje de tres meses", admin_id, fecha_efectiva=efectiva,
    )

    assert resultado.estado == EstadoMembresia.SUSPENDIDA
    filas = _historial(db_session, membresia.id)
    assert len(filas) == 1
    assert filas[0].estado_anterior == EstadoMembresia.ACTIVA
    assert filas[0].estado_nuevo == EstadoMembresia.SUSPENDIDA
    assert filas[0].actor_persona_id == admin_id
    assert filas[0].motivo == "Viaje de tres meses"
    assert filas[0].fecha_efectiva == efectiva
    # La cobertura YA pagada no se toca: ni se congela, ni se extiende, ni
    # se acorta.
    db_session.refresh(pago)
    assert pago.fecha_fin == date(2026, 12, 31)


def test_suspender_sin_motivo_es_rechazada(db_session, grafo, admin_id):
    _, _, membresia = grafo
    with pytest.raises(OperacionInvalida):
        PagoServicio(db_session).suspender_membresia(membresia.id, "   ", admin_id)


@pytest.mark.parametrize(
    "estado_origen", [EstadoMembresia.INACTIVA, EstadoMembresia.VENCIDA, EstadoMembresia.SUSPENDIDA],
)
def test_suspender_membresia_no_activa_es_rechazada(db_session, estado_origen, admin_id):
    persona = crear_persona_orm(db_session, cedula_valida(901))
    tipo = crear_tipo_membresia_orm(db_session)
    membresia = crear_membresia_orm(db_session, persona, tipo, estado_origen)

    with pytest.raises(OperacionInvalida, match="activa puede suspenderse"):
        PagoServicio(db_session).suspender_membresia(membresia.id, "motivo", admin_id)
    assert _historial(db_session, membresia.id) == []


# --- Gap 1: deuda/mora bloqueadas mientras dura la suspensión -----------------

def test_suspendida_no_adeuda_aunque_la_cobertura_este_vencida(db_session, monkeypatch, grafo, admin_id):
    _fijar_hoy(monkeypatch, date(2026, 8, 15))
    persona, _, membresia = grafo
    _aprobar_pago(db_session, persona, membresia, date(2026, 1, 1), date(2026, 3, 31))
    PagoServicio(db_session).suspender_membresia(
        membresia.id, "motivo", admin_id, fecha_efectiva=datetime(2026, 4, 1, tzinfo=timezone.utc),
    )

    assert PagoServicio(db_session).calcular_meses_adeudados(membresia.id) == 0
    assert PagoServicio(db_session).obtener_deuda(membresia.id)["meses_adeudados"] == 0


# --- Gap 5: suspender bloquea nuevos pagos y beneficios bonificados -----------

def test_registrar_pago_rechazado_si_esta_suspendida(db_session, grafo, admin_id):
    persona, _, membresia = grafo
    PagoServicio(db_session).suspender_membresia(membresia.id, "motivo", admin_id)

    servicio = PagoServicio(db_session)
    datos = PagoCreateDTO(
        meses=1, tipo_pago=TipoPago.EFECTIVO, persona_id=persona.id, membresia_id=membresia.id,
    )
    with pytest.raises(OperacionInvalida, match="suspendida"):
        servicio.registrar_pago(datos, persona_id_solicitante=persona.id, roles_solicitante=[])


def test_aplicar_beneficio_bonificado_rechazado_si_esta_suspendida(db_session, grafo, admin_id):
    """Sin necesidad de armar un beneficio 100% real: el guard de
    suspensión corre ANTES de resolver el descuento (mismo orden que
    `registrar_pago`), así que dispara aunque la persona no tenga ningún
    beneficio asignado -- eso es justamente lo que prueba que es el guard
    de estado, y no el de "beneficio no es total", el que está fallando."""
    persona, _, membresia = grafo
    PagoServicio(db_session).suspender_membresia(membresia.id, "motivo", admin_id)

    servicio = PagoServicio(db_session)
    datos = CoberturaBonificadaCreateDTO(meses=1)
    with pytest.raises(OperacionInvalida, match="suspendida"):
        servicio.aplicar_beneficio_bonificado(
            membresia.id, datos, persona_id_solicitante=persona.id, roles_solicitante=[],
        )


# --- Gap 2: SUSPENDIDA cuenta como membresía operativa ------------------------

def test_crear_membresia_nueva_rechazada_si_la_persona_tiene_una_suspendida(db_session, grafo, admin_id):
    persona, tipo, membresia = grafo
    PagoServicio(db_session).suspender_membresia(membresia.id, "motivo", admin_id)

    from app.presentacion.schemas.membresia_pago_schemas import MembresiaCreateDTO
    with pytest.raises(OperacionInvalida, match="activa o suspendida"):
        MembresiaServicio(db_session).crear_membresia(
            MembresiaCreateDTO(persona_id=persona.id, tipo_membresia_id=tipo.id)
        )


def test_indice_parcial_rechaza_activa_y_suspendida_de_la_misma_persona(db_session):
    """Nivel de base: dos INSERT crudos (segundo debe fallar) prueban que el
    índice `uq_membresia_activa_por_persona` ensanchado por la migración
    `fbd783a457d3` realmente cubre ('ACTIVA', 'SUSPENDIDA'), no solo que el
    chequeo Python de arriba lo haga."""
    persona = crear_persona_orm(db_session, cedula_valida(902))
    tipo = crear_tipo_membresia_orm(db_session)
    db_session.execute(
        text(
            "INSERT INTO membresia (estado, monto_aplicado, fecha_activacion, "
            "es_gratuidad_familiar, persona_id, tipo_membresia_id) "
            "VALUES ('SUSPENDIDA', 30.00, now(), FALSE, :persona_id, :tipo_id)"
        ),
        {"persona_id": persona.id, "tipo_id": tipo.id},
    )
    db_session.flush()

    with pytest.raises(IntegrityError, match="uq_membresia_activa_por_persona"):
        db_session.execute(
            text(
                "INSERT INTO membresia (estado, monto_aplicado, fecha_activacion, "
                "es_gratuidad_familiar, persona_id, tipo_membresia_id) "
                "VALUES ('ACTIVA', 30.00, now(), FALSE, :persona_id, :tipo_id)"
            ),
            {"persona_id": persona.id, "tipo_id": tipo.id},
        )
        db_session.flush()


# --- Reactivar ------------------------------------------------------------

def test_reactivar_no_suspendida_es_rechazada(db_session, grafo, admin_id):
    """La membresía del fixture está ACTIVA (nunca se suspendió)."""
    _, _, membresia = grafo
    with pytest.raises(OperacionInvalida, match="suspendida puede reactivarse"):
        PagoServicio(db_session).reactivar_membresia(membresia.id, "motivo", admin_id)


def test_reactivar_antes_del_vencimiento_usa_la_cobertura_vigente(db_session, monkeypatch, grafo, admin_id):
    """Cobertura hasta diciembre; se suspende en agosto y se reactiva en
    setiembre, ANTES de que la cobertura pagada venza. No debe crearse
    ningún Pago ni CoberturaBonificada nuevos: la cobertura existente sigue
    valiendo tal cual.

    `coberturas_antes` arranca en 1, no en 0 (hallazgo del revisor: la
    versión anterior de esta prueba comparaba 0 contra 0, trivialmente
    cierto sin probar nada) -- se siembra una `CoberturaBonificada` real
    (enero-febrero, ANTES del período del pago para no solaparla) para que
    "no se creó ninguna nueva" sea una afirmación sobre un caso no-cero."""
    _fijar_hoy(monkeypatch, date(2026, 9, 15))
    persona, tipo, membresia = grafo
    _aprobar_pago(db_session, persona, membresia, date(2026, 6, 1), date(2026, 12, 31))
    _sembrar_cobertura_bonificada(
        db_session, persona, membresia, admin_id, date(2026, 1, 1), date(2026, 2, 1),
    )
    pagos_antes = db_session.query(Pago).filter_by(membresia_id=membresia.id).count()
    coberturas_antes = db_session.query(CoberturaBonificada).filter_by(membresia_id=membresia.id).count()
    assert coberturas_antes == 1

    servicio = PagoServicio(db_session)
    servicio.suspender_membresia(
        membresia.id, "Viaje", admin_id, fecha_efectiva=datetime(2026, 8, 1, tzinfo=timezone.utc),
    )
    resultado = servicio.reactivar_membresia(
        membresia.id, "De vuelta", admin_id,
        fecha_efectiva=datetime(2026, 9, 15, tzinfo=timezone.utc),
    )

    assert resultado.estado == EstadoMembresia.ACTIVA
    assert db_session.query(Pago).filter_by(membresia_id=membresia.id).count() == pagos_antes
    assert (
        db_session.query(CoberturaBonificada).filter_by(membresia_id=membresia.id).count()
        == coberturas_antes
    )
    assert servicio.calcular_meses_adeudados(membresia.id) == 0
    filas = _historial(db_session, membresia.id)
    assert len(filas) == 2
    assert filas[1].estado_anterior == EstadoMembresia.SUSPENDIDA
    assert filas[1].estado_nuevo == EstadoMembresia.ACTIVA


def test_reactivar_resincroniza_la_tarifa_vigente(db_session, grafo, admin_id):
    """'Usa la tarifa vigente' (issue #400): si el catálogo cambió durante
    la suspensión, `monto_aplicado` debe reflejar el precio NUEVO, no el
    congelado en `crear_membresia`."""
    persona, tipo, membresia = grafo
    assert membresia.monto_aplicado == Decimal("30.00")
    PagoServicio(db_session).suspender_membresia(membresia.id, "motivo", admin_id)

    tipo.precio = Decimal("45.00")
    db_session.commit()

    resultado = PagoServicio(db_session).reactivar_membresia(membresia.id, "motivo", admin_id)

    assert resultado.monto_aplicado == Decimal("45.00")


def test_reactivar_despues_del_vencimiento_reinicia_el_reloj_de_deuda(db_session, monkeypatch, grafo, admin_id):
    """El corazón del gap 4/debt-restart-clock: la cobertura venció en
    marzo, se reactiva en junio (después del vencimiento -- "el nuevo
    período comienza en la fecha de reactivación"), y para agosto (dos
    meses después de REACTIVAR, sin pago nuevo) la deuda debe contar SOLO
    desde la reactivación (2 meses: junio->agosto), NUNCA desde el fin de
    cobertura original de marzo (que darían 4 meses, marzo->agosto). Si
    esta prueba diera 4, "los meses entre el fin de cobertura y la
    reactivación no generan deuda" se estaría violando en cuanto se
    reactiva sin pagar de inmediato."""
    persona, _, membresia = grafo
    _aprobar_pago(db_session, persona, membresia, date(2026, 1, 1), date(2026, 3, 31))

    servicio = PagoServicio(db_session)
    _fijar_hoy(monkeypatch, date(2026, 4, 15))
    servicio.suspender_membresia(
        membresia.id, "Viaje", admin_id, fecha_efectiva=datetime(2026, 4, 15, tzinfo=timezone.utc),
    )
    # "Hoy" avanza a la fecha de reactivación antes de reactivar: `_validar_
    # fecha_efectiva` (hallazgo del revisor) rechaza una `fecha_efectiva`
    # posterior a "hoy", y sin este avance el mock seguiría fijo en abril.
    _fijar_hoy(monkeypatch, date(2026, 6, 10))
    servicio.reactivar_membresia(
        membresia.id, "De vuelta", admin_id,
        fecha_efectiva=datetime(2026, 6, 10, 12, 0, tzinfo=timezone.utc),
    )

    _fijar_hoy(monkeypatch, date(2026, 8, 15))
    assert servicio.calcular_meses_adeudados(membresia.id) == 2


@pytest.mark.parametrize(
    "estado_origen", [EstadoMembresia.INACTIVA, EstadoMembresia.ACTIVA, EstadoMembresia.VENCIDA],
)
def test_reactivar_membresia_no_suspendida_es_rechazada(db_session, estado_origen, admin_id):
    persona = crear_persona_orm(db_session, cedula_valida(903))
    tipo = crear_tipo_membresia_orm(db_session)
    membresia = crear_membresia_orm(db_session, persona, tipo, estado_origen)

    with pytest.raises(OperacionInvalida, match="suspendida puede reactivarse"):
        PagoServicio(db_session).reactivar_membresia(membresia.id, "motivo", admin_id)


def test_reactivar_sin_motivo_es_rechazada(db_session, grafo, admin_id):
    _, _, membresia = grafo
    PagoServicio(db_session).suspender_membresia(membresia.id, "motivo", admin_id)

    with pytest.raises(OperacionInvalida):
        PagoServicio(db_session).reactivar_membresia(membresia.id, "", admin_id)


# --- Rastro de auditoría completo ----------------------------------------------

def test_suspender_y_reactivar_dejan_dos_filas_de_historial_completas(db_session, grafo):
    _, _, membresia = grafo
    admin_uno = crear_persona_orm(db_session, cedula_valida(996)).id
    admin_dos = crear_persona_orm(db_session, cedula_valida(997)).id
    servicio = PagoServicio(db_session)
    servicio.suspender_membresia(
        membresia.id, "Motivo A", admin_uno, fecha_efectiva=datetime(2026, 5, 1, tzinfo=timezone.utc),
    )
    servicio.reactivar_membresia(
        membresia.id, "Motivo B", admin_dos, fecha_efectiva=datetime(2026, 6, 1, tzinfo=timezone.utc),
    )

    filas = _historial(db_session, membresia.id)
    assert len(filas) == 2
    assert (filas[0].estado_anterior, filas[0].estado_nuevo) == (
        EstadoMembresia.ACTIVA, EstadoMembresia.SUSPENDIDA,
    )
    assert (filas[0].actor_persona_id, filas[0].motivo) == (admin_uno, "Motivo A")
    assert (filas[1].estado_anterior, filas[1].estado_nuevo) == (
        EstadoMembresia.SUSPENDIDA, EstadoMembresia.ACTIVA,
    )
    assert (filas[1].actor_persona_id, filas[1].motivo) == (admin_dos, "Motivo B")
    # Ninguna fila se sobrescribe: las dos siguen siendo legibles por separado.
    assert filas[0].id != filas[1].id


# --- Validación de fecha_efectiva (hallazgo del revisor, gap 7) --------------
# "Los meses entre el fin de cobertura y la reactivación no generan deuda"
# depende de que `fecha_efectiva` sea honesta: un valor futuro fabricado
# corre el ancla de `calcular_meses_adeudados` hacia adelante y regala meses
# que nunca pasaron. Ver `PagoServicio._validar_fecha_efectiva`.

def test_suspender_con_fecha_efectiva_futura_es_rechazada(db_session, monkeypatch, grafo, admin_id):
    _fijar_hoy(monkeypatch, date(2026, 8, 15))
    _, _, membresia = grafo
    # Mediodía UTC, no medianoche (hallazgo en vivo de este mismo archivo):
    # `hoy_club` traduce a America/Guayaquil (UTC-5), así que una medianoche
    # UTC exacta cae del lado del día ANTERIOR en calendario del club y esta
    # prueba dejaría de ejercitar el rechazo por futuro. Mediodía UTC = 07:00
    # club, siempre del lado correcto del día para cualquier fecha de prueba.
    futura = datetime(2026, 8, 16, 12, 0, tzinfo=timezone.utc)

    with pytest.raises(OperacionInvalida, match="futura"):
        PagoServicio(db_session).suspender_membresia(
            membresia.id, "motivo", admin_id, fecha_efectiva=futura,
        )
    assert _historial(db_session, membresia.id) == []


def test_reactivar_con_fecha_efectiva_futura_es_rechazada(db_session, monkeypatch, grafo, admin_id):
    _fijar_hoy(monkeypatch, date(2026, 8, 15))
    _, _, membresia = grafo
    servicio = PagoServicio(db_session)
    servicio.suspender_membresia(
        membresia.id, "motivo", admin_id, fecha_efectiva=datetime(2026, 8, 1, tzinfo=timezone.utc),
    )
    futura = datetime(2026, 8, 20, tzinfo=timezone.utc)

    with pytest.raises(OperacionInvalida, match="futura"):
        servicio.reactivar_membresia(membresia.id, "motivo", admin_id, fecha_efectiva=futura)
    # La membresía sigue SUSPENDIDA: el rechazo no dejó un estado a medias.
    assert db_session.get(Membresia, membresia.id).estado == EstadoMembresia.SUSPENDIDA


def test_fecha_efectiva_no_puede_retroceder_respecto_de_la_ultima_transicion(
    db_session, monkeypatch, grafo, admin_id,
):
    """Una reactivación backdateada a ANTES de la suspensión que la precede
    no tiene sentido de negocio (una transición no puede regir antes de que
    la anterior haya regido) y además rompería
    `fecha_efectiva_ultima_reactivacion` (que asume que la `fecha_efectiva`
    más alta es la más reciente)."""
    _fijar_hoy(monkeypatch, date(2026, 8, 15))
    _, _, membresia = grafo
    servicio = PagoServicio(db_session)
    servicio.suspender_membresia(
        membresia.id, "motivo", admin_id, fecha_efectiva=datetime(2026, 8, 10, tzinfo=timezone.utc),
    )
    anterior_a_la_suspension = datetime(2026, 8, 5, tzinfo=timezone.utc)

    with pytest.raises(OperacionInvalida, match="anterior"):
        servicio.reactivar_membresia(
            membresia.id, "motivo", admin_id, fecha_efectiva=anterior_a_la_suspension,
        )
    assert len(_historial(db_session, membresia.id)) == 1


def test_dto_normaliza_fecha_efectiva_naive_como_utc():
    """Mismo criterio que `_ensure_utc_aware` (`schemas/base.py`) del lado
    de salida: un datetime SIN timezone se asume UTC, nunca la hora local
    del proceso que lo recibió."""
    naive = datetime(2026, 8, 1, 10, 0)
    assert naive.tzinfo is None

    dto = SuspensionReactivacionDTO(motivo="motivo", fecha_efectiva=naive)

    assert dto.fecha_efectiva == datetime(2026, 8, 1, 10, 0, tzinfo=timezone.utc)


def test_dto_conserva_timezone_no_utc_sin_alterar_el_instante():
    con_tz = datetime(2026, 8, 1, 5, 0, tzinfo=timezone(timedelta(hours=-5)))  # 10:00 UTC

    dto = SuspensionReactivacionDTO(motivo="motivo", fecha_efectiva=con_tz)

    assert dto.fecha_efectiva == datetime(2026, 8, 1, 10, 0, tzinfo=timezone.utc)


# --- Concurrencia REAL (hallazgo del revisor, gap 6) --------------------------

def _limpiar_grafo(motor_test, *, persona_ids: list[int], membresia_id: int, tipo_id: int) -> None:
    """Mismo criterio que `test_cobertura_bonificada.py::_limpiar_grafo_orm`:
    este test usa `motor_test` directo (commits REALES, sin rollback
    automático), así que hay que borrar a mano en orden de FK o la fila
    pisa un id bajo que la siguiente prueba `db_session` vuelve a pedir."""
    limpieza = Session(bind=motor_test)
    try:
        limpieza.query(HistorialEstadoMembresia).filter(
            HistorialEstadoMembresia.membresia_id == membresia_id
        ).delete()
        limpieza.query(Pago).filter(Pago.membresia_id == membresia_id).delete()
        limpieza.query(Membresia).filter(Membresia.id == membresia_id).delete()
        limpieza.query(Persona).filter(Persona.id.in_(persona_ids)).delete(
            synchronize_session=False
        )
        limpieza.query(TipoMembresia).filter(TipoMembresia.id == tipo_id).delete()
        limpieza.commit()
    finally:
        limpieza.close()


def test_dos_reactivaciones_concurrentes_de_la_misma_membresia_solo_una_gana(motor_test):
    """Concurrencia REAL (no simulada, hallazgo del revisor issue #400/5a):
    dos hilos reactivan la MISMA membresía SUSPENDIDA a la vez, con
    sesiones independientes -- mismo patrón que `test_cobertura_bonificada.
    py::test_dos_aplicaciones_concurrentes_para_periodos_solapados_solo_una_
    gana`.

    Sin `obtener_por_id_con_bloqueo` (`SELECT ... FOR UPDATE`), los dos
    hilos leen `estado == SUSPENDIDA` antes de que cualquiera commitee, los
    dos pasan la guardia de "estado de origen inválido", y los dos
    commitean -- dos filas de `HistorialEstadoMembresia` para una sola
    transición lógica, sin que ningún error avise. Con el lock, el segundo
    hilo espera al commit del primero y relee `estado == ACTIVA` (ya
    transicionado), así que la guardia normal lo rechaza -- el MISMO
    mecanismo que ya usa `validar_pago`, no uno nuevo."""
    sesion_setup = Session(bind=motor_test)
    admin = crear_persona_orm(sesion_setup, cedula_valida(970), telefono="0990000970")
    socio = crear_persona_orm(sesion_setup, cedula_valida(971), telefono="0990000971")
    tipo = crear_tipo_membresia_orm(sesion_setup, precio=Decimal("30.00"))
    membresia = crear_membresia_orm(
        sesion_setup, socio, tipo, EstadoMembresia.SUSPENDIDA, monto_aplicado=Decimal("30.00"),
    )
    sesion_setup.commit()
    membresia_id, socio_id, admin_id_local, tipo_id = membresia.id, socio.id, admin.id, tipo.id
    sesion_setup.close()

    barrera = threading.Barrier(2, timeout=15)
    resultados: list = [None, None]

    def reactivar(indice: int):
        sesion = Session(bind=motor_test)
        try:
            barrera.wait()
            resultados[indice] = PagoServicio(sesion).reactivar_membresia(
                membresia_id, "De vuelta", admin_id_local,
            )
        except BaseException as error:  # noqa: BLE001 -- el test inspecciona el fallo
            resultados[indice] = error
            sesion.rollback()
        finally:
            sesion.close()

    hilos = [threading.Thread(target=reactivar, args=(i,)) for i in (0, 1)]
    for hilo in hilos:
        hilo.start()
    for hilo in hilos:
        hilo.join(timeout=30)

    exitos = [r for r in resultados if isinstance(r, Membresia)]
    rechazos = [r for r in resultados if isinstance(r, OperacionInvalida)]
    assert len(exitos) == 1, f"esperaba exactamente un ganador: {resultados}"
    assert len(rechazos) == 1, f"esperaba exactamente un perdedor con error de dominio: {resultados}"

    verificacion = Session(bind=motor_test)
    try:
        filas = (
            verificacion.query(HistorialEstadoMembresia)
            .filter_by(membresia_id=membresia_id)
            .all()
        )
        # La prueba de auditoría real: exactamente UNA transición quedó
        # registrada, no dos -- es justo lo que el lock evita.
        assert len(filas) == 1
    finally:
        verificacion.close()

    _limpiar_grafo(
        motor_test, persona_ids=[admin_id_local, socio_id], membresia_id=membresia_id, tipo_id=tipo_id,
    )
