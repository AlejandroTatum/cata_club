"""
Tests de la tarea Celery `alertar_mora_diaria` — avisos de mora de membresía
(día 1 y día 8 desde el vencimiento) y resumen diario al administrador
(issue #285).

Mismo patrón que `test_alertas_vencimiento.py` y `test_vencimientos_tareas.py`:
se llama a la función de la tarea directo, parcheando `SessionLocal` con la
sesión del fixture (`db_session`) y congelando el día del club con `hoy_club`.
"""
from contextlib import contextmanager
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from unittest.mock import Mock

import pytest
from celery.exceptions import Retry as CeleryRetry

import app.infraestructura.tareas.alertas_tareas as alertas_mod
from app.dominio.cedula import cedula_valida
from app.dominio.enums import (
    EstadoMembresia,
    EstadoPago,
    TipoModalidad,
    TipoNotificacion,
    TipoPago,
    TipoRol,
)
from app.dominio.excepciones import ServicioNoDisponible
from app.dominio.modelos import (
    Membresia,
    Notificacion,
    Pago,
    Persona,
    Rol,
    TipoMembresia,
    Usuario,
)
from app.infraestructura.notificaciones_servicio import ServicioNotificaciones
from app.servicios_negocio.membresia_pago_servicio import _meses_enteros_desde
from app.soporte_transversal.resiliencia import CIRCUITO_SMTP_COOLDOWN_SEGUNDOS
from app.soporte_transversal.tiempo import ZONA_HORARIA_CLUB


HOY = date(2029, 6, 15)


@pytest.fixture()
def sesion_inyectada(db_session, monkeypatch):
    """Inyecta `db_session` en el `SessionLocal` del módulo de la tarea."""

    @contextmanager
    def _factory():
        yield db_session

    monkeypatch.setattr(alertas_mod, "SessionLocal", _factory)
    return db_session


def _crear_persona(
    db,
    cedula: str,
    *,
    representante_id: int | None = None,
    nombres: str = "Ana",
    apellidos: str = "Test",
) -> Persona:
    persona = Persona(
        nombres=nombres,
        apellidos=apellidos,
        cedula=cedula,
        fecha_nacimiento=date(1990, 1, 1),
        telefono="0991112222",
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


def _crear_admin(db, cedula: str, correo: str) -> tuple[Persona, Usuario]:
    """Persona + Usuario ACTIVO con rol ADMINISTRADOR (sin membresía)."""
    persona = _crear_persona(db, cedula)
    rol = Rol(tipo_rol=TipoRol.ADMINISTRADOR, descripcion="Administrador")
    usuario = Usuario(
        correo=correo, contrasenia="hash", persona_id=persona.id, roles=[rol],
    )
    db.add(usuario)
    db.flush()
    return persona, usuario


def _crear_membresia_con_pago(
    db,
    persona: Persona,
    fecha_fin: date,
    *,
    estado: EstadoMembresia = EstadoMembresia.ACTIVA,
) -> tuple[Membresia, Pago]:
    tipo = TipoMembresia(
        categoria="Mensual Adultos",
        precio=Decimal("35.00"),
        modalidad=TipoModalidad.MENSUAL,
    )
    db.add(tipo)
    db.flush()
    membresia = Membresia(
        estado=estado,
        monto_aplicado=Decimal("35.00"),
        fecha_activacion=datetime(2026, 1, 1, tzinfo=timezone.utc),
        persona_id=persona.id,
        tipo_membresia_id=tipo.id,
    )
    db.add(membresia)
    db.flush()
    pago = Pago(
        monto=Decimal("35.00"),
        estado_pago=EstadoPago.APROBADO,
        tipo_pago=TipoPago.TRANSFERENCIA,
        fecha_registro=datetime(2026, 1, 1, tzinfo=timezone.utc),
        fecha_inicio=date(2026, 1, 1),
        fecha_fin=fecha_fin,
        persona_id=persona.id,
        membresia_id=membresia.id,
    )
    db.add(pago)
    db.commit()
    return membresia, pago


def _agregar_pago_aprobado(
    db, membresia: Membresia, persona: Persona, fecha_fin: date
) -> Pago:
    pago = Pago(
        monto=Decimal("35.00"),
        estado_pago=EstadoPago.APROBADO,
        tipo_pago=TipoPago.TRANSFERENCIA,
        fecha_registro=datetime(2026, 1, 1, tzinfo=timezone.utc),
        fecha_inicio=date(2026, 1, 1),
        fecha_fin=fecha_fin,
        persona_id=persona.id,
        membresia_id=membresia.id,
    )
    db.add(pago)
    db.commit()
    return pago


def _mock_envio(monkeypatch, *, falla: Exception | None = None) -> list[dict]:
    """Reemplaza `ServicioNotificaciones.enviar_correo`; si `falla` se pasa, la
    simula lanzando esa excepción en vez de registrar el envío."""
    llamadas: list[dict] = []

    def _fake(self, **kwargs):
        if falla is not None:
            raise falla
        llamadas.append(kwargs)

    monkeypatch.setattr(ServicioNotificaciones, "enviar_correo", _fake)
    return llamadas


def _notificaciones_de_familia(db, tipo: TipoNotificacion, persona_id: int) -> int:
    return (
        db.query(Notificacion)
        .filter(Notificacion.tipo == tipo, Notificacion.persona_id == persona_id)
        .count()
    )


# --- Día 1: primer aviso a la familia ---------------------------------------

def test_dia_1_notifica_alumno_y_representante(db_session, sesion_inyectada, monkeypatch):
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    representante = _crear_persona(db_session, cedula_valida(201))
    alumno = _crear_persona(
        db_session, cedula_valida(202), representante_id=representante.id,
    )
    correo_alumno = "alumno202@cataclub.test"
    _crear_usuario(db_session, alumno, correo_alumno)
    _crear_membresia_con_pago(db_session, alumno, HOY - timedelta(days=1))
    llamadas = _mock_envio(monkeypatch)

    resultado = alertas_mod.alertar_mora_diaria()

    assert resultado["total_avisos_familia"] == 1
    assert _notificaciones_de_familia(
        db_session, TipoNotificacion.MIEMBRESIA_MORA_DIA_1, alumno.id
    ) == 1
    assert _notificaciones_de_familia(
        db_session, TipoNotificacion.MIEMBRESIA_MORA_DIA_1, representante.id
    ) == 1
    # El correo va SOLO al alumno (mismo criterio que las alertas de vencimiento).
    assert [envio["destinatario"] for envio in llamadas] == [correo_alumno]


def test_dia_1_sin_representante_solo_notifica_al_alumno(
    db_session, sesion_inyectada, monkeypatch
):
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    alumno = _crear_persona(db_session, cedula_valida(203))
    _crear_usuario(db_session, alumno, "alumno203@cataclub.test")
    _crear_membresia_con_pago(db_session, alumno, HOY - timedelta(days=1))
    _mock_envio(monkeypatch)

    resultado = alertas_mod.alertar_mora_diaria()

    assert resultado["total_avisos_familia"] == 1
    assert _notificaciones_de_familia(
        db_session, TipoNotificacion.MIEMBRESIA_MORA_DIA_1, alumno.id
    ) == 1


# --- Día 8: segundo y último aviso -------------------------------------------

def test_dia_8_notifica_segundo_aviso(db_session, sesion_inyectada, monkeypatch):
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    alumno = _crear_persona(db_session, cedula_valida(204))
    _crear_usuario(db_session, alumno, "alumno204@cataclub.test")
    _crear_membresia_con_pago(
        db_session, alumno, HOY - timedelta(days=8), estado=EstadoMembresia.VENCIDA,
    )
    _mock_envio(monkeypatch)

    resultado = alertas_mod.alertar_mora_diaria()

    assert resultado["total_avisos_familia"] == 1
    assert _notificaciones_de_familia(
        db_session, TipoNotificacion.MIEMBRESIA_MORA_DIA_8, alumno.id
    ) == 1
    assert _notificaciones_de_familia(
        db_session, TipoNotificacion.MIEMBRESIA_MORA_DIA_1, alumno.id
    ) == 0


# --- Día 15: silencio --------------------------------------------------------

def test_dia_15_no_notifica(db_session, sesion_inyectada, monkeypatch):
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    alumno = _crear_persona(db_session, cedula_valida(205))
    _crear_usuario(db_session, alumno, "alumno205@cataclub.test")
    _crear_membresia_con_pago(
        db_session, alumno, HOY - timedelta(days=15), estado=EstadoMembresia.VENCIDA,
    )
    llamadas = _mock_envio(monkeypatch)

    resultado = alertas_mod.alertar_mora_diaria()

    assert resultado["total_avisos_familia"] == 0
    assert llamadas == []
    assert _notificaciones_de_familia(
        db_session, TipoNotificacion.MIEMBRESIA_MORA_DIA_1, alumno.id
    ) == 0
    assert _notificaciones_de_familia(
        db_session, TipoNotificacion.MIEMBRESIA_MORA_DIA_8, alumno.id
    ) == 0


# --- Idempotencia ------------------------------------------------------------

def test_dos_corridas_el_mismo_dia_no_duplican(db_session, sesion_inyectada, monkeypatch):
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    _crear_admin(db_session, cedula_valida(206), "admin206@cataclub.test")
    alumno = _crear_persona(db_session, cedula_valida(207))
    _crear_usuario(db_session, alumno, "alumno207@cataclub.test")
    _crear_membresia_con_pago(db_session, alumno, HOY - timedelta(days=1))
    llamadas = _mock_envio(monkeypatch)

    primer = alertas_mod.alertar_mora_diaria()
    segundo = alertas_mod.alertar_mora_diaria()

    assert primer["total_avisos_familia"] == 1
    assert segundo["total_avisos_familia"] == 0
    assert _notificaciones_de_familia(
        db_session, TipoNotificacion.MIEMBRESIA_MORA_DIA_1, alumno.id
    ) == 1
    total_resumen = (
        db_session.query(Notificacion)
        .filter(Notificacion.tipo == TipoNotificacion.RESUMEN_MORA_ADMIN)
        .count()
    )
    assert total_resumen == 1
    # El correo del alumno sale una vez; el del admin (resumen) sale una vez.
    assert len([envio for envio in llamadas if envio["destinatario"] == "alumno207@cataclub.test"]) == 1
    assert len([envio for envio in llamadas if envio["destinatario"] == "admin206@cataclub.test"]) == 1


# --- Un pago aprobado posterior detiene los avisos ---------------------------

def test_pago_aprobado_que_extiende_cobertura_detiene_avisos(
    db_session, sesion_inyectada, monkeypatch
):
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    alumno = _crear_persona(db_session, cedula_valida(208))
    _crear_usuario(db_session, alumno, "alumno208@cataclub.test")
    membresia, _ = _crear_membresia_con_pago(
        db_session, alumno, HOY - timedelta(days=1),
    )
    # Pago aprobado MÁS reciente que extiende la cobertura más allá de hoy.
    _agregar_pago_aprobado(db_session, membresia, alumno, HOY + timedelta(days=30))
    llamadas = _mock_envio(monkeypatch)

    resultado = alertas_mod.alertar_mora_diaria()

    assert resultado["total_avisos_familia"] == 0
    assert llamadas == []


# --- Membresías INACTIVA no cuentan ------------------------------------------

def test_membresia_inactiva_no_genera_aviso(db_session, sesion_inyectada, monkeypatch):
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    alumno = _crear_persona(db_session, cedula_valida(209))
    _crear_usuario(db_session, alumno, "alumno209@cataclub.test")
    _crear_membresia_con_pago(
        db_session, alumno, HOY - timedelta(days=1), estado=EstadoMembresia.INACTIVA,
    )
    _mock_envio(monkeypatch)

    resultado = alertas_mod.alertar_mora_diaria()

    assert resultado["total_avisos_familia"] == 0


# --- Resumen diario al administrador -----------------------------------------

def test_resumen_admin_contiene_morosos_con_meses_adeudados(
    db_session, sesion_inyectada, monkeypatch
):
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    admin_persona, _ = _crear_admin(db_session, cedula_valida(210), "admin210@cataclub.test")
    alumno = _crear_persona(
        db_session, cedula_valida(211), nombres="Mora", apellidos="Uno",
    )
    _crear_usuario(db_session, alumno, "alumno211@cataclub.test")
    _crear_membresia_con_pago(db_session, alumno, HOY - timedelta(days=1))
    llamadas = _mock_envio(monkeypatch)

    resultado = alertas_mod.alertar_mora_diaria()

    assert resultado["total_avisos_familia"] == 1
    assert resultado["resumen_admin_enviado"] is True

    resumen = (
        db_session.query(Notificacion)
        .filter(
            Notificacion.tipo == TipoNotificacion.RESUMEN_MORA_ADMIN,
            Notificacion.persona_id == admin_persona.id,
        )
        .one()
    )
    meses = _meses_enteros_desde(HOY - timedelta(days=1), HOY)
    assert "Mora Uno" in resumen.mensaje
    assert f"{meses} meses" in resumen.mensaje
    assert "$35.00" in resumen.mensaje

    # El resumen también se envía por correo al administrador.
    assert "admin210@cataclub.test" in [envio["destinatario"] for envio in llamadas]


def test_resumen_admin_no_se_duplica_en_el_mismo_dia(
    db_session, sesion_inyectada, monkeypatch
):
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    admin_persona, _ = _crear_admin(db_session, cedula_valida(212), "admin212@cataclub.test")

    # Ya existe un RESUMEN_MORA_ADMIN de HOY (dentro del día del club).
    inicio_dia = datetime.combine(HOY, time.min, tzinfo=ZONA_HORARIA_CLUB)
    db_session.add(Notificacion(
        tipo=TipoNotificacion.RESUMEN_MORA_ADMIN,
        mensaje="resumen previo",
        persona_id=admin_persona.id,
        fecha_creacion=inicio_dia + timedelta(hours=1),
    ))
    db_session.commit()

    alumno = _crear_persona(db_session, cedula_valida(213))
    _crear_usuario(db_session, alumno, "alumno213@cataclub.test")
    _crear_membresia_con_pago(db_session, alumno, HOY - timedelta(days=1))
    _mock_envio(monkeypatch)

    resultado = alertas_mod.alertar_mora_diaria()

    assert resultado["total_avisos_familia"] == 1
    total_resumen = (
        db_session.query(Notificacion)
        .filter(
            Notificacion.tipo == TipoNotificacion.RESUMEN_MORA_ADMIN,
            Notificacion.persona_id == admin_persona.id,
        )
        .count()
    )
    assert total_resumen == 1  # solo el preexistente, sin duplicar


# --- SMTP degradado no rompe el lote -----------------------------------------

def test_smtp_no_configurado_igual_crea_notificacion(db_session, sesion_inyectada, monkeypatch):
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    alumno = _crear_persona(db_session, cedula_valida(214))
    _crear_usuario(db_session, alumno, "alumno214@cataclub.test")
    _crear_membresia_con_pago(db_session, alumno, HOY - timedelta(days=1))
    _mock_envio(monkeypatch, falla=RuntimeError("SMTP_HOST no está configurado"))

    resultado = alertas_mod.alertar_mora_diaria()

    assert resultado["total_avisos_familia"] == 1
    assert _notificaciones_de_familia(
        db_session, TipoNotificacion.MIEMBRESIA_MORA_DIA_1, alumno.id
    ) == 1


def test_circuito_smtp_abierto_reintenta_con_cooldown(
    db_session, sesion_inyectada, monkeypatch
):
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    alumno = _crear_persona(db_session, cedula_valida(215))
    _crear_usuario(db_session, alumno, "alumno215@cataclub.test")
    _crear_membresia_con_pago(db_session, alumno, HOY - timedelta(days=1))
    _mock_envio(monkeypatch, falla=ServicioNoDisponible("circuito SMTP abierto"))

    mock_retry = Mock(side_effect=CeleryRetry("reintentando", None))
    monkeypatch.setattr(alertas_mod.alertar_mora_diaria, "retry", mock_retry)

    with pytest.raises(CeleryRetry):
        alertas_mod.alertar_mora_diaria()

    assert mock_retry.call_count == 1
    _, kwargs = mock_retry.call_args
    assert kwargs["countdown"] == CIRCUITO_SMTP_COOLDOWN_SEGUNDOS
    assert isinstance(kwargs["exc"], ServicioNoDisponible)


# --- Los tipos de notificación son distintos (clave de dedup) ----------------

def test_dia_1_y_dia_8_son_tipos_distintos():
    assert TipoNotificacion.MIEMBRESIA_MORA_DIA_1.value == "MIEMBRESIA_MORA_DIA_1"
    assert TipoNotificacion.MIEMBRESIA_MORA_DIA_8.value == "MIEMBRESIA_MORA_DIA_8"
    assert TipoNotificacion.RESUMEN_MORA_ADMIN.value == "RESUMEN_MORA_ADMIN"
    assert TipoNotificacion.MIEMBRESIA_MORA_DIA_1 != TipoNotificacion.MIEMBRESIA_MORA_DIA_8
    assert TipoNotificacion.MIEMBRESIA_MORA_DIA_1 != TipoNotificacion.RESUMEN_MORA_ADMIN
    assert TipoNotificacion.MIEMBRESIA_MORA_DIA_8 != TipoNotificacion.RESUMEN_MORA_ADMIN
