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
from datetime import date
from contextlib import contextmanager

from app.dominio.modelos import Persona, Membresia, TipoMembresia, Pago
from app.dominio.enums import (
    EstadoMembresia, EstadoPago, TipoPago, TipoModalidad,
)
import app.infraestructura.tareas.vencimientos_tareas as venc_mod
from app.infraestructura.tareas.vencimientos_tareas import marcar_membresias_vencidas


def _crear_persona_y_membresia(db, estado_membresia: EstadoMembresia) -> tuple[Persona, Membresia]:
    persona = Persona(
        nombres="Ana", apellidos="Test", cedula="1002003001",
        fecha_nacimiento=date(1990, 1, 1), telefono="0991112222",
    )
    db.add(persona)
    db.flush()

    tipo = TipoMembresia(
        categoria="Mensual Adultos", franja_horaria="18:00-19:00",
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

