"""
Tests de la tarea Celery `alertar_vencimientos_hoy_mas_5` — alertas de
vencimiento de membresía a 5 días (auditoría degradacion-controlada, slice 1).

Bug corregido: `db.refresh(persona, ["usuario"])` se llamaba sobre una sesión
distinta a la que había cargado `persona` (dos `with SessionLocal() as db:`
anidados; `SessionLocal` es un `sessionmaker` plano -- no un
`scoped_session` -- así que son objetos `Session` genuinamente distintos).
El primer test de este archivo reproduce el bug con sesiones REALES, sin usar
el fixture `sesion_inyectada` de `test_dia_del_club_en_call_sites.py` (que
monkeypatchea `SessionLocal` para devolver siempre la MISMA sesión y por eso
colapsa ambas sesiones en una sola, enmascarando el bug -- ver diseño,
sección "Correction to the proposal").

El resto de las pruebas de este archivo SÍ usa sesión inyectada (mismo
patrón que `test_vencimientos_tareas.py`): verifican reglas de negocio
(dedup, orden envío-antes-de-commit) que son ortogonales al bug de sesión
cruzada, ya corregido para cuando estas pruebas corren.
"""
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest
from sqlalchemy.orm import Session

import app.infraestructura.tareas.alertas_tareas as alertas_mod
from app.dominio.enums import EstadoMembresia, EstadoPago, TipoModalidad, TipoPago
from app.dominio.modelos import Membresia, Notificacion, Pago, Persona, TipoMembresia, Usuario
from app.infraestructura.notificaciones_servicio import ServicioNotificaciones


HOY = date(2029, 6, 15)
VENCE = HOY + timedelta(days=5)


# --- Fase 1.1: reproducción con sesiones REALES, sin `sesion_inyectada` ----

@pytest.fixture()
def escenario_vencimiento_real(motor_test):
    """Persona + Usuario + Membresía ACTIVA + Pago APROBADO, COMMITEADOS de
    verdad en su propia sesión/conexión -- necesario para que la tarea (que
    abre su propia `SessionLocal()`, real, SIN mockear) los lea desde una
    sesión GENUINAMENTE distinta de la que sembró los datos (mismo patrón que
    `test_pago_comprobante_atomico.py::escenario_pago_concurrente`)."""
    sesion = Session(bind=motor_test)
    persona = Persona(
        nombres="Marta", apellidos="Vence", cedula="1799000991",
        fecha_nacimiento=date(1990, 1, 1), telefono="0990009991",
    )
    sesion.add(persona)
    sesion.flush()
    correo = "marta.vence991@cataclub.test"
    usuario = Usuario(correo=correo, contrasenia="hash", persona_id=persona.id)
    sesion.add(usuario)
    tipo = TipoMembresia(
        categoria="Vencimiento Real", franja_horaria="18:00-19:00",
        precio=Decimal("35.00"), modalidad=TipoModalidad.MENSUAL,
    )
    sesion.add(tipo)
    sesion.flush()
    membresia = Membresia(
        estado=EstadoMembresia.ACTIVA, monto_aplicado=Decimal("35.00"),
        fecha_activacion=datetime(2026, 1, 1, tzinfo=timezone.utc),
        persona_id=persona.id, tipo_membresia_id=tipo.id,
    )
    sesion.add(membresia)
    sesion.flush()
    pago = Pago(
        monto=Decimal("35.00"), estado_pago=EstadoPago.APROBADO,
        tipo_pago=TipoPago.TRANSFERENCIA,
        fecha_registro=datetime(2026, 1, 1, tzinfo=timezone.utc),
        fecha_inicio=date(2026, 1, 1), fecha_fin=VENCE,
        persona_id=persona.id, membresia_id=membresia.id,
    )
    sesion.add(pago)
    sesion.commit()
    ids = (persona.id, usuario.id, membresia.id, tipo.id, pago.id)
    sesion.close()

    try:
        yield {
            "persona_id": ids[0], "usuario_id": ids[1],
            "membresia_id": ids[2], "tipo_id": ids[3], "pago_id": ids[4],
            "correo": correo,
        }
    finally:
        limpieza = Session(bind=motor_test)
        limpieza.query(Notificacion).filter(
            Notificacion.persona_id == ids[0]
        ).delete()
        limpieza.query(Pago).filter(Pago.id == ids[4]).delete()
        limpieza.query(Membresia).filter(Membresia.id == ids[2]).delete()
        limpieza.query(TipoMembresia).filter(TipoMembresia.id == ids[3]).delete()
        limpieza.query(Usuario).filter(Usuario.id == ids[1]).delete()
        limpieza.query(Persona).filter(Persona.id == ids[0]).delete()
        limpieza.commit()
        limpieza.close()


def test_disparar_notificacion_no_cruza_sesiones(escenario_vencimiento_real, monkeypatch):
    """Reproduce el bug con sesiones REALES: hoy, `alertar_vencimientos_hoy_
    mas_5` abre una sesión para leer el lote y `_disparar_notificacion_
    vencimiento` abre OTRA para escribir -- `SessionLocal` es un
    `sessionmaker` plano, así que son instancias `Session` distintas.
    `db.refresh(persona, ["usuario"])` sobre la sesión equivocada lanza
    `InvalidRequestError` antes de intentar ningún envío. Sin este test (que
    evita `sesion_inyectada`, que colapsa ambas sesiones en una sola y
    enmascara el bug), la corrida real queda invisible a la suite."""
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    llamadas = []
    monkeypatch.setattr(
        ServicioNotificaciones, "enviar_correo",
        lambda self, **kwargs: llamadas.append(kwargs),
    )

    resultado = alertas_mod.alertar_vencimientos_hoy_mas_5()

    assert resultado["total_alertas"] == 1
    assert len(llamadas) == 1
    assert llamadas[0]["destinatario"] == escenario_vencimiento_real["correo"]


# --- Fases 1.2-1.4: reglas de negocio, con sesión inyectada -----------------
# Ortogonales al bug de sesión cruzada (ya corregido cuando estas pruebas
# corren); usar `db_session` inyectado es más simple y rápido (aislamiento
# por transacción, sin limpieza manual), mismo criterio que
# `test_vencimientos_tareas.py`.

@pytest.fixture()
def sesion_inyectada(db_session, monkeypatch):
    """Inyecta `db_session` en el `SessionLocal` del módulo de la tarea."""
    @contextmanager
    def _factory():
        yield db_session

    monkeypatch.setattr(alertas_mod, "SessionLocal", _factory)
    return db_session


def _crear_persona(db, cedula: str, *, representante_id: int | None = None) -> Persona:
    persona = Persona(
        nombres="Ana", apellidos="Test", cedula=cedula,
        fecha_nacimiento=date(1990, 1, 1), telefono="0991112222",
        representante_id=representante_id,
    )
    db.add(persona)
    db.flush()
    return persona


def _crear_usuario(db, persona: Persona, correo: str) -> Usuario:
    usuario = Usuario(correo=correo, contrasenia="hash", persona_id=persona.id)
    db.add(usuario)
    db.flush()
    return usuario


def _crear_membresia_con_pago(db, persona: Persona, fecha_fin: date) -> tuple[Membresia, Pago]:
    tipo = TipoMembresia(
        categoria="Mensual Adultos", franja_horaria="18:00-19:00",
        precio=Decimal("35.00"), modalidad=TipoModalidad.MENSUAL,
    )
    db.add(tipo)
    db.flush()
    membresia = Membresia(
        estado=EstadoMembresia.ACTIVA, monto_aplicado=Decimal("35.00"),
        fecha_activacion=datetime(2026, 1, 1, tzinfo=timezone.utc),
        persona_id=persona.id, tipo_membresia_id=tipo.id,
    )
    db.add(membresia)
    db.flush()
    pago = Pago(
        monto=Decimal("35.00"), estado_pago=EstadoPago.APROBADO,
        tipo_pago=TipoPago.TRANSFERENCIA,
        fecha_registro=datetime(2026, 1, 1, tzinfo=timezone.utc),
        fecha_inicio=date(2026, 1, 1), fecha_fin=fecha_fin,
        persona_id=persona.id, membresia_id=membresia.id,
    )
    db.add(pago)
    db.commit()
    return membresia, pago


def _mock_envio(monkeypatch, *, falla: Exception | None = None) -> list[dict]:
    """Reemplaza `ServicioNotificaciones.enviar_correo`; si `falla` se pasa,
    la simula lanzando esa excepción en vez de registrar el envío."""
    llamadas: list[dict] = []

    def _fake(self, **kwargs):
        if falla is not None:
            raise falla
        llamadas.append(kwargs)

    monkeypatch.setattr(ServicioNotificaciones, "enviar_correo", _fake)
    return llamadas


def test_notificacion_guarda_entidad_relacionada_id_del_pago(
    db_session, sesion_inyectada, monkeypatch
):
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    persona = _crear_persona(db_session, "1002003011")
    _crear_usuario(db_session, persona, "alumno011@cataclub.test")
    _, pago = _crear_membresia_con_pago(db_session, persona, VENCE)
    _mock_envio(monkeypatch)

    alertas_mod.alertar_vencimientos_hoy_mas_5()

    fila = db_session.query(Notificacion).filter(
        Notificacion.persona_id == persona.id
    ).one()
    assert fila.entidad_relacionada_id == pago.id


def test_fallo_de_envio_no_deja_fila_marcada(db_session, sesion_inyectada, monkeypatch):
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    persona = _crear_persona(db_session, "1002003012")
    _crear_usuario(db_session, persona, "alumno012@cataclub.test")
    _crear_membresia_con_pago(db_session, persona, VENCE)
    _mock_envio(monkeypatch, falla=ConnectionError("smtp caído"))

    with pytest.raises(ConnectionError):
        alertas_mod.alertar_vencimientos_hoy_mas_5()

    total = db_session.query(Notificacion).filter(
        Notificacion.persona_id == persona.id
    ).count()
    assert total == 0


def test_no_hay_transaccion_abierta_durante_el_envio(
    db_session, sesion_inyectada, monkeypatch
):
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    persona = _crear_persona(db_session, "1002003013")
    _crear_usuario(db_session, persona, "alumno013@cataclub.test")
    _crear_membresia_con_pago(db_session, persona, VENCE)

    observado: dict = {}

    def _espiar(self, **kwargs):
        observado["filas_durante_envio"] = (
            db_session.query(Notificacion)
            .filter(Notificacion.persona_id == persona.id)
            .count()
        )

    monkeypatch.setattr(ServicioNotificaciones, "enviar_correo", _espiar)

    alertas_mod.alertar_vencimientos_hoy_mas_5()

    assert observado["filas_durante_envio"] == 0


def test_sin_smtp_configurado_igual_crea_notificacion(
    db_session, sesion_inyectada, monkeypatch
):
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    persona = _crear_persona(db_session, "1002003014")
    _crear_usuario(db_session, persona, "alumno014@cataclub.test")
    _crear_membresia_con_pago(db_session, persona, VENCE)
    _mock_envio(monkeypatch, falla=RuntimeError("SMTP_HOST no está configurado"))

    resultado = alertas_mod.alertar_vencimientos_hoy_mas_5()

    assert resultado["total_alertas"] == 1
    total = db_session.query(Notificacion).filter(
        Notificacion.persona_id == persona.id
    ).count()
    assert total == 1


def test_persona_sin_usuario_crea_notificacion_sin_correo(
    db_session, sesion_inyectada, monkeypatch
):
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    persona = _crear_persona(db_session, "1002003015")
    _crear_membresia_con_pago(db_session, persona, VENCE)
    llamadas = _mock_envio(monkeypatch)

    resultado = alertas_mod.alertar_vencimientos_hoy_mas_5()

    assert resultado["total_alertas"] == 1
    assert llamadas == []
    total = db_session.query(Notificacion).filter(
        Notificacion.persona_id == persona.id
    ).count()
    assert total == 1


def test_reintento_no_duplica_notificacion_ni_correo(
    db_session, sesion_inyectada, monkeypatch
):
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    persona = _crear_persona(db_session, "1002003016")
    _crear_usuario(db_session, persona, "alumno016@cataclub.test")
    _crear_membresia_con_pago(db_session, persona, VENCE)
    llamadas = _mock_envio(monkeypatch)

    alertas_mod.alertar_vencimientos_hoy_mas_5()
    alertas_mod.alertar_vencimientos_hoy_mas_5()

    assert len(llamadas) == 1
    total = db_session.query(Notificacion).filter(
        Notificacion.persona_id == persona.id
    ).count()
    assert total == 1


def test_representante_recibe_una_sola_notificacion_en_reintento(
    db_session, sesion_inyectada, monkeypatch
):
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    representante = _crear_persona(db_session, "1002003017")
    alumno = _crear_persona(db_session, "1002003018", representante_id=representante.id)
    _crear_usuario(db_session, alumno, "alumno018@cataclub.test")
    _crear_membresia_con_pago(db_session, alumno, VENCE)
    _mock_envio(monkeypatch)

    alertas_mod.alertar_vencimientos_hoy_mas_5()
    alertas_mod.alertar_vencimientos_hoy_mas_5()

    total_rep = db_session.query(Notificacion).filter(
        Notificacion.persona_id == representante.id
    ).count()
    assert total_rep == 1
