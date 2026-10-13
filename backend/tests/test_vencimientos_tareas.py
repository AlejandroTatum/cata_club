"""
Tests de la tarea Celery `marcar_membresias_vencidas` — transición
automática ACTIVA → VENCIDA.

Estos tests llaman directamente a la función de la tarea (sin pasar por
Celery ni Redis), parcheando `SessionLocal` con la sesión SQLite del
fixture para aislar el test del broker y de la BD real. La firma
`bind=True` provista en `@celery_app.task` hace que la función tagged
acepte `self`, pero Celery injerta `self` automáticamente al invocar la
tarea como callable (ver `celery.app.task.Task.__call__`).
"""
from datetime import date, timedelta
from decimal import Decimal
from contextlib import contextmanager

from app.dominio.cedula import cedula_valida
from app.dominio.modelos import (
    AsignacionDescuento, CoberturaBonificada, CorreccionPago, Descuento, Persona, Membresia, TipoMembresia, Pago,
)
from app.dominio.enums import (
    EstadoMembresia, EstadoPago, TipoPago, TipoModalidad,
)
import app.infraestructura.tareas.vencimientos_tareas as venc_mod
from app.infraestructura.tareas.vencimientos_tareas import marcar_membresias_vencidas


def _crear_persona_y_membresia(db, estado_membresia: EstadoMembresia) -> tuple[Persona, Membresia]:
    persona = Persona(
        nombres="Ana", apellidos="Test", cedula=cedula_valida(610),
        fecha_nacimiento=date(1990, 1, 1), telefono="0991112222",
    )
    db.add(persona)
    db.flush()

    tipo = TipoMembresia(
        categoria="Mensual Adultos",
        precio=35.00, modalidad=TipoModalidad.MENSUAL,
    )
    db.add(tipo)
    db.flush()

    membresia = Membresia(
        estado=estado_membresia,
        monto_aplicado=35.00,
        fecha_activacion=date(2026, 1, 1),
        persona_id=persona.id,
        tipo_membresia_id=tipo.id,
    )
    db.add(membresia)
    db.commit()
    db.refresh(membresia)
    return persona, membresia


def _crear_persona_y_membresia_n(db, estado_membresia: EstadoMembresia, n: int) -> tuple[Persona, Membresia]:
    """Como `_crear_persona_y_membresia` con otra cédula, para varios casos por test."""
    persona = Persona(
        nombres="Luis", apellidos="Test", cedula=cedula_valida(n),
        fecha_nacimiento=date(1990, 1, 1), telefono="0991112222",
    )
    db.add(persona)
    db.flush()
    tipo = TipoMembresia(
        categoria=f"Plan {n}", precio=35.00, modalidad=TipoModalidad.MENSUAL,
    )
    db.add(tipo)
    db.flush()
    membresia = Membresia(
        estado=estado_membresia, monto_aplicado=35.00, fecha_activacion=date(2026, 1, 1),
        persona_id=persona.id, tipo_membresia_id=tipo.id,
    )
    db.add(membresia)
    db.commit()
    db.refresh(membresia)
    return persona, membresia


def _agregar_pago(db, membresia: Membresia, persona: Persona, estado_pago: EstadoPago, fecha_fin: date) -> Pago:
    pago = Pago(
        monto=35.00,
        estado_pago=estado_pago,
        tipo_pago=TipoPago.TRANSFERENCIA,
        fecha_registro=date(2026, 1, 1),
        fecha_inicio=date(2026, 1, 1),
        fecha_fin=fecha_fin,
        persona_id=persona.id,
        membresia_id=membresia.id,
    )
    db.add(pago)
    db.commit()
    return pago


def _connegar_hoy(monkeypatch, hoy: date) -> None:
    """Parchea `hoy_club()` dentro del módulo de la tarea. La tarea ya no usa
    `date.today()`: el día que le importa es el del club, no el del
    contenedor (UTC) — ver `app/soporte_transversal/tiempo.py`."""
    monkeypatch.setattr(venc_mod, "hoy_club", lambda: hoy)


def _run_task(db_session, monkeypatch, hoy: date) -> dict:
    """Inyecta el db_session del fixture en `SessionLocal` (la tarea usa
    `with SessionLocal() as db:`), congela el día del club, y llama la
    tarea directamente."""
    _connegar_hoy(monkeypatch, hoy)

    @contextmanager
    def _override_session_local():
        yield db_session

    monkeypatch.setattr(venc_mod, "SessionLocal", _override_session_local)

    # Invocación directa: el callable de la tarea es el método `__call__`
    # de la `celery.Task` que pasa `self` automáticamente.
    return marcar_membresias_vencidas()


def test_marca_vencida_si_pago_aprobado_ya_pasado(db_session, monkeypatch):
    """Membresia ACTIVA cuyo último Pago APROBADO tiene fecha_fin anterior a
    hoy -> debe quedar VENCIDA."""
    hoy = date(2029, 6, 15)
    persona, membresia = _crear_persona_y_membresia(db_session, EstadoMembresia.ACTIVA)
    _agregar_pago(db_session, membresia, persona, EstadoPago.APROBADO, date(2029, 6, 10))

    resultado = _run_task(db_session, monkeypatch, hoy)

    assert resultado["total_vencidas"] == 1
    db_session.refresh(membresia)
    assert membresia.estado == EstadoMembresia.VENCIDA


def test_no_marca_vencida_si_pago_aprobado_aun_vigente(db_session, monkeypatch):
    """Membresia ACTIVA cuyo último Pago APROBADO tiene fecha_fin posterior
    a hoy -> la membresía NO se debe tocar."""
    hoy = date(2029, 6, 15)
    persona, membresia = _crear_persona_y_membresia(db_session, EstadoMembresia.ACTIVA)
    _agregar_pago(db_session, membresia, persona, EstadoPago.APROBADO, date(2029, 7, 31))

    resultado = _run_task(db_session, monkeypatch, hoy)

    assert resultado["total_vencidas"] == 0
    db_session.refresh(membresia)
    assert membresia.estado == EstadoMembresia.ACTIVA


def test_no_marca_vencida_si_ya_esta_vencida(db_session, monkeypatch):
    """Idempotencia: una Membresia ya VENCIDA cuyo pago aprobado sigue
    vencido no debe reaparecer en el reporte ni duplicarse."""
    hoy = date(2029, 6, 15)
    persona, membresia = _crear_persona_y_membresia(db_session, EstadoMembresia.VENCIDA)
    _agregar_pago(db_session, membresia, persona, EstadoPago.APROBADO, date(2029, 6, 10))

    resultado = _run_task(db_session, monkeypatch, hoy)

    assert resultado["total_vencidas"] == 0
    db_session.refresh(membresia)
    assert membresia.estado == EstadoMembresia.VENCIDA


def test_no_marca_vencida_si_solo_tiene_pago_pendiente(db_session, monkeypatch):
    """Una Membresia ACTIVA con un Pago PENDIENTE_VALIDACION vencido no
    debe pasar a VENCIDA: pendientes no cuentan como vigencia invocada."""
    hoy = date(2029, 6, 15)
    persona, membresia = _crear_persona_y_membresia(db_session, EstadoMembresia.ACTIVA)
    _agregar_pago(db_session, membresia, persona, EstadoPago.PENDIENTE_VALIDACION, date(2029, 6, 10))

    resultado = _run_task(db_session, monkeypatch, hoy)

    assert resultado["total_vencidas"] == 0
    db_session.refresh(membresia)
    assert membresia.estado == EstadoMembresia.ACTIVA


def test_marca_vencida_usa_el_ultimo_pago_aprobado(db_session, monkeypatch):
    """Si hay varios pagos aprobados, la vigencia se mide por el más reciente:
    un pago vencido viejo + un pago vigente más reciente => la membresía sigue
    ACTIVA."""
    hoy = date(2029, 6, 15)
    persona, membresia = _crear_persona_y_membresia(db_session, EstadoMembresia.ACTIVA)
    _agregar_pago(db_session, membresia, persona, EstadoPago.APROBADO, date(2029, 5, 1))
    _agregar_pago(db_session, membresia, persona, EstadoPago.APROBADO, date(2029, 7, 31))

    resultado = _run_task(db_session, monkeypatch, hoy)

    assert resultado["total_vencidas"] == 0
    db_session.refresh(membresia)
    assert membresia.estado == EstadoMembresia.ACTIVA


def test_marca_vencida_caso_inverso_pago_reciente_vencido(db_session, monkeypatch):
    """Pago viejo vigente + pago reciente vencido => VENCIDA: la subconsulta
    usa el MAX(fecha_fin) entre pagos aprobados, así que la fecha más reciente
    (aunque vencida respecto al "hoy" congelado) es la que decide."""
    hoy = date(2029, 6, 15)
    persona, membresia = _crear_persona_y_membresia(db_session, EstadoMembresia.ACTIVA)
    _agregar_pago(db_session, membresia, persona, EstadoPago.APROBADO, date(2029, 7, 31))
    # P-end anterior: este se contempla como "el más reciente" porque
    # fecha_fin > 2029-07-31 es posterior a la fecha_fin del pago anterior.
    db_session.query(Pago).filter(Pago.fecha_fin == date(2029, 7, 31)).delete()
    _agregar_pago(db_session, membresia, persona, EstadoPago.APROBADO, date(2029, 6, 10))

    resultado = _run_task(db_session, monkeypatch, hoy)

    assert resultado["total_vencidas"] == 1
    db_session.refresh(membresia)
    assert membresia.estado == EstadoMembresia.VENCIDA


def test_retirada_no_pasa_de_activa_a_vencida(db_session, monkeypatch):
    hoy = date(2029, 6, 15)
    persona, membresia = _crear_persona_y_membresia(db_session, EstadoMembresia.ACTIVA)
    persona.activo = False
    _agregar_pago(db_session, membresia, persona, EstadoPago.APROBADO, date(2029, 6, 10))

    resultado = _run_task(db_session, monkeypatch, hoy)

    assert resultado["total_vencidas"] == 0
    db_session.refresh(membresia)
    assert membresia.estado == EstadoMembresia.ACTIVA



# --- Reconciliación en ambas direcciones (issue #1762) -----------------------
# El estado se guarda y la cobertura se deriva de los pagos aprobados. La tarea
# además de vencer (ACTIVA -> VENCIDA) levanta una VENCIDA que ya tiene
# cobertura vigente (datos corregidos antes de que la corrección reconciliara).

def test_levanta_una_vencida_con_pago_aprobado_vigente(db_session, monkeypatch):
    hoy = date(2029, 6, 15)
    persona, membresia = _crear_persona_y_membresia(db_session, EstadoMembresia.VENCIDA)
    _agregar_pago(db_session, membresia, persona, EstadoPago.APROBADO, date(2029, 7, 31))

    resultado = _run_task(db_session, monkeypatch, hoy)

    assert resultado["total_reactivadas"] == 1
    assert resultado["reactivadas"][0]["membresia_id"] == membresia.id
    assert resultado["total_vencidas"] == 0
    db_session.refresh(membresia)
    assert membresia.estado == EstadoMembresia.ACTIVA


def test_levantar_es_idempotente(db_session, monkeypatch):
    hoy = date(2029, 6, 15)
    persona, membresia = _crear_persona_y_membresia(db_session, EstadoMembresia.VENCIDA)
    _agregar_pago(db_session, membresia, persona, EstadoPago.APROBADO, date(2029, 7, 31))

    _run_task(db_session, monkeypatch, hoy)
    segunda = _run_task(db_session, monkeypatch, hoy)

    assert segunda["total_reactivadas"] == 0
    assert segunda["total_vencidas"] == 0
    db_session.refresh(membresia)
    assert membresia.estado == EstadoMembresia.ACTIVA


def test_no_levanta_una_vencida_sin_cobertura_vigente(db_session, monkeypatch):
    hoy = date(2029, 6, 15)
    persona, membresia = _crear_persona_y_membresia(db_session, EstadoMembresia.VENCIDA)
    _agregar_pago(db_session, membresia, persona, EstadoPago.APROBADO, date(2029, 6, 10))

    resultado = _run_task(db_session, monkeypatch, hoy)

    assert resultado["total_reactivadas"] == 0
    db_session.refresh(membresia)
    assert membresia.estado == EstadoMembresia.VENCIDA


def test_no_levanta_una_vencida_con_pago_solo_pendiente_o_sin_pagos(db_session, monkeypatch):
    hoy = date(2029, 6, 15)
    persona, membresia = _crear_persona_y_membresia(db_session, EstadoMembresia.VENCIDA)
    _agregar_pago(db_session, membresia, persona, EstadoPago.PENDIENTE_VALIDACION, date(2029, 7, 31))

    resultado = _run_task(db_session, monkeypatch, hoy)

    assert resultado["total_reactivadas"] == 0
    db_session.refresh(membresia)
    assert membresia.estado == EstadoMembresia.VENCIDA


def test_no_levanta_la_membresia_de_una_persona_dada_de_baja(db_session, monkeypatch):
    hoy = date(2029, 6, 15)
    persona, membresia = _crear_persona_y_membresia(db_session, EstadoMembresia.VENCIDA)
    persona.activo = False
    _agregar_pago(db_session, membresia, persona, EstadoPago.APROBADO, date(2029, 7, 31))

    resultado = _run_task(db_session, monkeypatch, hoy)

    assert resultado["total_reactivadas"] == 0
    db_session.refresh(membresia)
    assert membresia.estado == EstadoMembresia.VENCIDA


def test_no_toca_una_suspendida_ni_una_inactiva_con_cobertura(db_session, monkeypatch):
    hoy = date(2029, 6, 15)
    for estado in (EstadoMembresia.SUSPENDIDA, EstadoMembresia.INACTIVA):
        persona, membresia = _crear_persona_y_membresia_n(db_session, estado, 700 + len(estado.value))
        _agregar_pago(db_session, membresia, persona, EstadoPago.APROBADO, date(2029, 7, 31))

        resultado = _run_task(db_session, monkeypatch, hoy)

        assert resultado["total_reactivadas"] == 0
        db_session.refresh(membresia)
        assert membresia.estado == estado


def test_no_levanta_una_vencida_si_la_persona_ya_tiene_otra_activa_y_no_falla(db_session, monkeypatch):
    hoy = date(2029, 6, 15)
    persona, vieja = _crear_persona_y_membresia(db_session, EstadoMembresia.VENCIDA)
    _agregar_pago(db_session, vieja, persona, EstadoPago.APROBADO, date(2029, 7, 31))
    tipo = db_session.get(TipoMembresia, vieja.tipo_membresia_id)
    actual = Membresia(
        estado=EstadoMembresia.ACTIVA, monto_aplicado=35.00, fecha_activacion=date(2026, 3, 1),
        persona_id=persona.id, tipo_membresia_id=tipo.id,
    )
    db_session.add(actual)
    db_session.commit()
    _agregar_pago(db_session, actual, persona, EstadoPago.APROBADO, date(2029, 7, 31))

    resultado = _run_task(db_session, monkeypatch, hoy)

    assert resultado["total_reactivadas"] == 0
    db_session.refresh(vieja)
    db_session.refresh(actual)
    assert vieja.estado == EstadoMembresia.VENCIDA
    assert actual.estado == EstadoMembresia.ACTIVA


def test_levantar_una_no_impide_levantar_las_demas(db_session, monkeypatch):
    """Una candidata que se saltea no corta el lote."""
    hoy = date(2029, 6, 15)
    persona_a, vieja = _crear_persona_y_membresia(db_session, EstadoMembresia.VENCIDA)
    _agregar_pago(db_session, vieja, persona_a, EstadoPago.APROBADO, date(2029, 7, 31))
    tipo = db_session.get(TipoMembresia, vieja.tipo_membresia_id)
    db_session.add(Membresia(
        estado=EstadoMembresia.ACTIVA, monto_aplicado=35.00, fecha_activacion=date(2026, 3, 1),
        persona_id=persona_a.id, tipo_membresia_id=tipo.id,
    ))
    db_session.commit()
    persona_b, otra = _crear_persona_y_membresia_n(db_session, EstadoMembresia.VENCIDA, 701)
    _agregar_pago(db_session, otra, persona_b, EstadoPago.APROBADO, date(2029, 7, 31))

    resultado = _run_task(db_session, monkeypatch, hoy)

    assert resultado["total_reactivadas"] == 1
    db_session.refresh(otra)
    assert otra.estado == EstadoMembresia.ACTIVA


# --- Cobertura combinada: pagos + cobertura bonificada (issue #1762) ---------
# El resto de la app (deuda, `cubiertoHasta`, la corrección de pagos) toma la
# cobertura como el MÁXIMO entre pagos aprobados y cobertura bonificada. La
# tarea usa la misma definición en ambas direcciones; si no, el estado guardado
# oscila contra el derivado (la tarea vence, la corrección levanta, repite).

def _agregar_bonificada(db, membresia: Membresia, persona: Persona, inicio: date, fin: date) -> CoberturaBonificada:
    admin = Persona(
        nombres="Admin", apellidos="Test", cedula=cedula_valida(790 + membresia.id % 50),
        fecha_nacimiento=date(1980, 1, 1), telefono="0990000790",
    )
    descuento = Descuento(nombre=f"Beca {membresia.id}", porcentaje=Decimal("100.00"), activo=True)
    db.add_all([admin, descuento])
    db.flush()
    asignacion = AsignacionDescuento(
        persona_id=persona.id, descuento_id=descuento.id, asignado_por_persona_id=admin.id,
    )
    db.add(asignacion)
    db.flush()
    cobertura = CoberturaBonificada(
        membresia_id=membresia.id, persona_id=persona.id, asignacion_descuento_id=asignacion.id,
        tarifa_mensual_aplicada=Decimal("35.00"), meses_comprados=1,
        descuento_valor_aplicado=Decimal("35.00"), descuento_porcentaje_aplicado=Decimal("100.00"),
        fecha_inicio=inicio, fecha_fin=fin, otorgada_por_persona_id=admin.id,
    )
    db.add(cobertura)
    db.commit()
    return cobertura


def test_no_vence_una_activa_cuyo_pago_termino_pero_la_bonificada_cubre_hoy(db_session, monkeypatch):
    hoy = date(2029, 6, 15)
    persona, membresia = _crear_persona_y_membresia(db_session, EstadoMembresia.ACTIVA)
    _agregar_pago(db_session, membresia, persona, EstadoPago.APROBADO, hoy - timedelta(days=1))
    _agregar_bonificada(db_session, membresia, persona, hoy - timedelta(days=1), hoy + timedelta(days=30))

    resultado = _run_task(db_session, monkeypatch, hoy)

    assert resultado["total_vencidas"] == 0
    db_session.refresh(membresia)
    assert membresia.estado == EstadoMembresia.ACTIVA


def test_vence_una_activa_cuando_ni_el_pago_ni_la_bonificada_cubren_hoy(db_session, monkeypatch):
    hoy = date(2029, 6, 15)
    persona, membresia = _crear_persona_y_membresia(db_session, EstadoMembresia.ACTIVA)
    _agregar_pago(db_session, membresia, persona, EstadoPago.APROBADO, hoy - timedelta(days=10))
    _agregar_bonificada(db_session, membresia, persona, hoy - timedelta(days=10), hoy - timedelta(days=2))

    resultado = _run_task(db_session, monkeypatch, hoy)

    assert resultado["total_vencidas"] == 1
    db_session.refresh(membresia)
    assert membresia.estado == EstadoMembresia.VENCIDA


def test_levanta_una_vencida_cubierta_solo_por_bonificada(db_session, monkeypatch):
    hoy = date(2029, 6, 15)
    persona, membresia = _crear_persona_y_membresia(db_session, EstadoMembresia.VENCIDA)
    _agregar_bonificada(db_session, membresia, persona, hoy - timedelta(days=1), hoy + timedelta(days=30))

    resultado = _run_task(db_session, monkeypatch, hoy)

    assert resultado["total_reactivadas"] == 1
    db_session.refresh(membresia)
    assert membresia.estado == EstadoMembresia.ACTIVA


def test_vencida_cubierta_por_bonificada_no_se_levanta_si_la_persona_esta_dada_de_baja(db_session, monkeypatch):
    hoy = date(2029, 6, 15)
    persona, membresia = _crear_persona_y_membresia(db_session, EstadoMembresia.VENCIDA)
    persona.activo = False
    _agregar_bonificada(db_session, membresia, persona, hoy - timedelta(days=1), hoy + timedelta(days=30))

    resultado = _run_task(db_session, monkeypatch, hoy)

    assert resultado["total_reactivadas"] == 0
    db_session.refresh(membresia)
    assert membresia.estado == EstadoMembresia.VENCIDA


def test_la_correccion_y_la_tarea_no_se_contradicen_con_cobertura_bonificada(db_session, monkeypatch):
    """El bucle que mostró la verificación: pago terminado ayer + bonificada
    que cubre hoy. La tarea no vence, corregir el pago tampoco cambia nada, y
    la tarea siguiente sigue sin vencer."""
    from app.servicios_negocio.dtos.membresia_pago_schemas import CorreccionPagoDTO
    from app.servicios_negocio.membresia_pago_servicio import PagoServicio
    from app.soporte_transversal.tiempo import hoy_club

    hoy = hoy_club()
    persona, membresia = _crear_persona_y_membresia(db_session, EstadoMembresia.ACTIVA)
    pago = _agregar_pago(db_session, membresia, persona, EstadoPago.APROBADO, hoy - timedelta(days=1))
    _agregar_bonificada(db_session, membresia, persona, hoy - timedelta(days=1), hoy + timedelta(days=30))
    admin = Persona(
        nombres="Admin", apellidos="Corrige", cedula=cedula_valida(840),
        fecha_nacimiento=date(1980, 1, 1), telefono="0990000840",
    )
    db_session.add(admin)
    db_session.commit()

    _run_task(db_session, monkeypatch, hoy)
    PagoServicio(db_session).corregir_pago(
        pago.id, CorreccionPagoDTO(monto=Decimal("40.00"), motivo="Monto mal cargado"),
        actor_persona_id=admin.id,
    )
    db_session.refresh(membresia)
    assert membresia.estado == EstadoMembresia.ACTIVA
    segunda = _run_task(db_session, monkeypatch, hoy)

    assert segunda["total_vencidas"] == 0
    db_session.refresh(membresia)
    assert membresia.estado == EstadoMembresia.ACTIVA
    assert db_session.query(CorreccionPago).filter_by(pago_id=pago.id).count() == 1
