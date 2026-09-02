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
from tests.smtp_falso import configurar_smtp_falso


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

def test_dia_1_notifica_solo_al_representante_con_ambos_canales(
    db_session, sesion_inyectada, monkeypatch
):
    # Issue #905: el representante es el ÚNICO responsable de pago.
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    representante = _crear_persona(db_session, cedula_valida(201))
    correo_representante = "representante201@cataclub.test"
    _crear_usuario(db_session, representante, correo_representante)
    alumno = _crear_persona(
        db_session, cedula_valida(202), nombres="Nino", apellidos="Chico",
        representante_id=representante.id,
    )
    _crear_usuario(db_session, alumno, "alumno202@cataclub.test")
    _crear_membresia_con_pago(db_session, alumno, HOY - timedelta(days=1))
    llamadas = _mock_envio(monkeypatch)

    resultado = alertas_mod.alertar_mora_diaria()

    assert resultado["total_avisos_familia"] == 1
    assert _notificaciones_de_familia(
        db_session, TipoNotificacion.MIEMBRESIA_MORA_DIA_1, representante.id
    ) == 1
    assert _notificaciones_de_familia(
        db_session, TipoNotificacion.MIEMBRESIA_MORA_DIA_1, alumno.id
    ) == 0
    assert [envio["destinatario"] for envio in llamadas] == [correo_representante]
    assert "Nino" in llamadas[0]["cuerpo_texto"]


def test_dia_1_sin_representante_solo_notifica_al_alumno(
    db_session, sesion_inyectada, monkeypatch
):
    # Issue #905: sin representante, la propia persona es responsable.
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    alumno = _crear_persona(db_session, cedula_valida(203))
    correo = "alumno203@cataclub.test"
    _crear_usuario(db_session, alumno, correo)
    _crear_membresia_con_pago(db_session, alumno, HOY - timedelta(days=1))
    llamadas = _mock_envio(monkeypatch)

    resultado = alertas_mod.alertar_mora_diaria()

    assert resultado["total_avisos_familia"] == 1
    assert _notificaciones_de_familia(
        db_session, TipoNotificacion.MIEMBRESIA_MORA_DIA_1, alumno.id
    ) == 1
    assert [envio["destinatario"] for envio in llamadas] == [correo]


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


# --- Issue #905/#898: el asunto distingue día 1 (aviso) de día 8 (último) --

@pytest.mark.parametrize(
    ("dias_mora", "estado", "asunto_esperado"),
    [
        (1, EstadoMembresia.ACTIVA, "Aviso de mora - Cata Club"),
        (8, EstadoMembresia.VENCIDA, "Último aviso de mora - Cata Club"),
    ],
)
def test_asunto_de_mora_distingue_dia_1_de_dia_8(
    db_session, sesion_inyectada, monkeypatch, dias_mora, estado, asunto_esperado,
):
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    alumno = _crear_persona(db_session, cedula_valida(241 + dias_mora))
    _crear_usuario(db_session, alumno, f"alumno{241 + dias_mora}@cataclub.test")
    _crear_membresia_con_pago(
        db_session, alumno, HOY - timedelta(days=dias_mora), estado=estado,
    )
    llamadas = _mock_envio(monkeypatch)

    alertas_mod.alertar_mora_diaria()

    assert llamadas[0]["asunto"] == asunto_esperado


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
    # El correo del alumno sale una vez; el resumen al admin es in-app y
    # nunca dispara `enviar_correo` (issue #905).
    assert [envio["destinatario"] for envio in llamadas] == ["alumno207@cataclub.test"]


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


# --- Membresías SUSPENDIDA no cuentan (issue #400, slice 5a) ----------------
# Gap del revisor: la query original solo excluía INACTIVA
# (`Membresia.estado != EstadoMembresia.INACTIVA`), lo que ADMITE SUSPENDIDA.
# "Suspender detiene la generación de deuda futura" no admite excepción: si
# la cobertura ya estaba vencida ANTES de que administración suspendiera,
# sin este filtro la familia seguía recibiendo el correo de mora (y el admin
# seguía viéndola en su resumen diario) durante toda la suspensión.

def test_membresia_suspendida_no_genera_aviso(db_session, sesion_inyectada, monkeypatch):
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    alumno = _crear_persona(db_session, cedula_valida(220))
    _crear_usuario(db_session, alumno, "alumno220@cataclub.test")
    _crear_membresia_con_pago(
        db_session, alumno, HOY - timedelta(days=1), estado=EstadoMembresia.SUSPENDIDA,
    )
    llamadas = _mock_envio(monkeypatch)

    resultado = alertas_mod.alertar_mora_diaria()

    assert resultado["total_avisos_familia"] == 0
    assert llamadas == []
    assert _notificaciones_de_familia(
        db_session, TipoNotificacion.MIEMBRESIA_MORA_DIA_1, alumno.id
    ) == 0


# --- Resumen diario al administrador -----------------------------------------

@pytest.mark.parametrize("cantidad_admins", [1, 2])
def test_resumen_admin_es_solo_in_app_sin_llamar_enviar_correo(
    db_session, sesion_inyectada, monkeypatch, cantidad_admins,
):
    # Issue #905: el resumen administrativo es exclusivamente in-app -- no
    # dispara ninguna solicitud SMTP, sin importar cuántos administradores haya.
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    admin_personas, _ = zip(*[
        _crear_admin(db_session, cedula_valida(211 + i), f"admin{211 + i}@cataclub.test")
        for i in range(cantidad_admins)
    ])
    alumno = _crear_persona(
        db_session, cedula_valida(210), nombres="Mora", apellidos="Uno",
    )
    _crear_usuario(db_session, alumno, "alumno210@cataclub.test")
    _crear_membresia_con_pago(db_session, alumno, HOY - timedelta(days=1))
    llamadas = _mock_envio(monkeypatch)

    resultado = alertas_mod.alertar_mora_diaria()

    assert resultado["total_avisos_familia"] == 1
    assert resultado["resumen_admin_enviado"] is True

    resumenes = (
        db_session.query(Notificacion)
        .filter(Notificacion.tipo == TipoNotificacion.RESUMEN_MORA_ADMIN)
        .all()
    )
    assert {fila.persona_id for fila in resumenes} == {p.id for p in admin_personas}
    meses = _meses_enteros_desde(HOY - timedelta(days=1), HOY)
    assert "Mora Uno" in resumenes[0].mensaje
    assert f"{meses} meses" in resumenes[0].mensaje

    # El correo del alumno en mora sí sale (canal de familia); el resumen al
    # administrador nunca llama a `enviar_correo`.
    assert [envio["destinatario"] for envio in llamadas] == ["alumno210@cataclub.test"]


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


# --- Issue #837: un correo rechazado de forma permanente no mata el lote ----
# Igual que en `test_alertas_vencimiento.py`, estos tests doblan `smtplib.SMTP`
# (ver `tests/smtp_falso.py`) en vez de `enviar_correo`: declaran el CÓDIGO
# SMTP crudo y dejan correr el clasificador real.

def test_lote_de_mora_sigue_cuando_una_familia_tiene_el_correo_rechazado(
    db_session, sesion_inyectada, monkeypatch
):
    """Tres familias en mora; la del medio tiene una dirección que el
    proveedor rechaza con 550. Antes, ese rechazo llegaba al handler como
    "circuito abierto", el lote se reprogramaba entero y el reintento volvía a
    chocar contra la misma dirección. Ahora se atiende a las tres."""
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    alumnos: list[Persona] = []
    correos: list[str] = []
    for indice in range(3):
        alumno = _crear_persona(db_session, cedula_valida(230 + indice))
        correo = f"mora{indice}@cataclub.test"
        _crear_usuario(db_session, alumno, correo)
        _crear_membresia_con_pago(db_session, alumno, HOY - timedelta(days=1))
        alumnos.append(alumno)
        correos.append(correo)
    registro = configurar_smtp_falso(
        monkeypatch, rechazos={correos[1]: (550, "buzón inexistente")},
    )
    mock_retry = Mock(side_effect=CeleryRetry("reintentando", None))
    monkeypatch.setattr(alertas_mod.alertar_mora_diaria, "retry", mock_retry)

    resultado = alertas_mod.alertar_mora_diaria()

    assert sorted(registro.enviados) == sorted([correos[0], correos[2]])
    assert mock_retry.call_count == 0
    # La familia rechazada sigue contando como avisada: su aviso in-app se
    # emitió, y su mora es real -- por eso también tiene que seguir figurando
    # en el resumen que ve el administrador.
    assert resultado["total_avisos_familia"] == 3
    assert resultado["total_rechazos_permanentes"] == 1

    for alumno in alumnos:
        assert _notificaciones_de_familia(
            db_session, TipoNotificacion.MIEMBRESIA_MORA_DIA_1, alumno.id
        ) == 1

    fila_rechazada = (
        db_session.query(Notificacion)
        .filter(
            Notificacion.tipo == TipoNotificacion.MIEMBRESIA_MORA_DIA_1,
            Notificacion.persona_id == alumnos[1].id,
        )
        .one()
    )
    assert fila_rechazada.last_error_redacted is not None
    assert "550" in fila_rechazada.last_error_redacted


def test_lote_de_mora_aborta_con_cooldown_si_el_fallo_es_global(
    db_session, sesion_inyectada, monkeypatch
):
    """Contracara: un fallo de transporte no es de una dirección, así que la
    política vieja sigue igual -- el lote se reprograma con el cooldown del
    circuito y no queda ninguna fila."""
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    alumno = _crear_persona(db_session, cedula_valida(236))
    _crear_usuario(db_session, alumno, "alumno236@cataclub.test")
    _crear_membresia_con_pago(db_session, alumno, HOY - timedelta(days=1))
    configurar_smtp_falso(
        monkeypatch, fallo_de_transporte=OSError("el relay no contesta"),
    )
    mock_retry = Mock(side_effect=CeleryRetry("reintentando", None))
    monkeypatch.setattr(alertas_mod.alertar_mora_diaria, "retry", mock_retry)

    with pytest.raises(CeleryRetry):
        alertas_mod.alertar_mora_diaria()

    assert mock_retry.call_count == 1
    _, kwargs = mock_retry.call_args
    assert kwargs["countdown"] == CIRCUITO_SMTP_COOLDOWN_SEGUNDOS
    assert _notificaciones_de_familia(
        db_session, TipoNotificacion.MIEMBRESIA_MORA_DIA_1, alumno.id
    ) == 0


# --- Recuperación de corrida perdida (issue #791, punto 2) -----------------
# El match original era `dias == 1` / `dias == 8` exactos: si Beat no corre
# ese día (OOM, colgado), la familia nunca recibe el aviso -- al día
# siguiente `dias` ya vale otra cosa y la fila deja de matchear para siempre.
# Las ventanas acotadas (1-7 para el día 1, 8-14 para el día 8) cubren la
# corrida perdida sin romper el silencio del día 15 (issue #285) y sin
# duplicar avisos ya emitidos, gracias a `_ya_notificado`
# (`(tipo, persona_id, pago_id)`, no por fecha/`dias`).

def test_mora_a_4_dias_recibe_aviso_dia_1_por_ventana_de_recuperacion(
    db_session, sesion_inyectada, monkeypatch
):
    """Simula una corrida de Beat perdida el día exacto (`dias == 1`): la
    familia lleva 4 días de mora y con el match exacto original nunca
    recibiría el aviso de día 1. La ventana 1-7 lo cubre."""
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    alumno = _crear_persona(db_session, cedula_valida(221))
    _crear_usuario(db_session, alumno, "alumno221@cataclub.test")
    _crear_membresia_con_pago(
        db_session, alumno, HOY - timedelta(days=4), estado=EstadoMembresia.VENCIDA,
    )
    llamadas = _mock_envio(monkeypatch)

    resultado = alertas_mod.alertar_mora_diaria()

    assert resultado["total_avisos_familia"] == 1
    assert len(llamadas) == 1
    assert _notificaciones_de_familia(
        db_session, TipoNotificacion.MIEMBRESIA_MORA_DIA_1, alumno.id
    ) == 1
    assert _notificaciones_de_familia(
        db_session, TipoNotificacion.MIEMBRESIA_MORA_DIA_8, alumno.id
    ) == 0
    # Pin de contenido (issue #791, corrección del reporte del defecto en
    # `alertar_vencimientos_hoy_mas_5`): a diferencia de ese caso, acá
    # `_disparar_notificacion_mora` recibe `ultima_fecha_fin` -- la fecha REAL
    # de esa fila, no un borde de ventana compartido -- así que el mensaje
    # debe nombrar la fecha real de vencimiento (HOY - 4 días).
    fecha_real = (HOY - timedelta(days=4)).strftime("%d/%m/%Y")
    fila = (
        db_session.query(Notificacion)
        .filter(
            Notificacion.tipo == TipoNotificacion.MIEMBRESIA_MORA_DIA_1,
            Notificacion.persona_id == alumno.id,
        )
        .one()
    )
    assert fecha_real in fila.mensaje
    assert fecha_real in llamadas[0]["cuerpo_texto"]


def test_mora_a_11_dias_recibe_aviso_dia_8_por_ventana_de_recuperacion(
    db_session, sesion_inyectada, monkeypatch
):
    """Simula una corrida de Beat perdida el día exacto (`dias == 8`): la
    familia lleva 11 días de mora y con el match exacto original nunca
    recibiría el segundo y último aviso. La ventana 8-14 lo cubre."""
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    alumno = _crear_persona(db_session, cedula_valida(222))
    _crear_usuario(db_session, alumno, "alumno222@cataclub.test")
    _crear_membresia_con_pago(
        db_session, alumno, HOY - timedelta(days=11), estado=EstadoMembresia.VENCIDA,
    )
    llamadas = _mock_envio(monkeypatch)

    resultado = alertas_mod.alertar_mora_diaria()

    assert resultado["total_avisos_familia"] == 1
    assert len(llamadas) == 1
    assert _notificaciones_de_familia(
        db_session, TipoNotificacion.MIEMBRESIA_MORA_DIA_8, alumno.id
    ) == 1
    assert _notificaciones_de_familia(
        db_session, TipoNotificacion.MIEMBRESIA_MORA_DIA_1, alumno.id
    ) == 0


def test_mora_a_20_dias_no_notifica_se_respeta_el_silencio_del_dia_15(
    db_session, sesion_inyectada, monkeypatch
):
    """Las ventanas de recuperación NO deben resucitar avisos más allá del
    día 15 (issue #285): una familia con 20 días de mora no recibe nada, ni
    siquiera bajo la ventana ampliada."""
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    alumno = _crear_persona(db_session, cedula_valida(223))
    _crear_usuario(db_session, alumno, "alumno223@cataclub.test")
    _crear_membresia_con_pago(
        db_session, alumno, HOY - timedelta(days=20), estado=EstadoMembresia.VENCIDA,
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


def test_ventana_de_recuperacion_no_duplica_en_corridas_de_dias_consecutivos(
    db_session, sesion_inyectada, monkeypatch
):
    """La prueba más importante de esta ventana: si la corrida de hoy cae
    dentro de la ventana 1-7 y la corrida de MAÑANA (día del club distinto)
    también cae dentro de esa misma ventana, la familia no debe recibir un
    segundo aviso de día 1. La ventana ensancha QUÉ días matchean, pero
    `_ya_notificado` sigue deduplicando por `(tipo, persona_id, pago_id)` --
    no por fecha ni por `dias` -- así que la segunda corrida no encuentra
    nada pendiente para esa familia."""
    alumno = _crear_persona(db_session, cedula_valida(224))
    _crear_usuario(db_session, alumno, "alumno224@cataclub.test")
    _crear_membresia_con_pago(
        db_session, alumno, HOY - timedelta(days=4), estado=EstadoMembresia.VENCIDA,
    )
    llamadas = _mock_envio(monkeypatch)

    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    primer = alertas_mod.alertar_mora_diaria()

    # "Mañana": la mora ahora es de 5 días, todavía dentro de la ventana 1-7.
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY + timedelta(days=1))
    segundo = alertas_mod.alertar_mora_diaria()

    assert primer["total_avisos_familia"] == 1
    assert segundo["total_avisos_familia"] == 0
    assert len(llamadas) == 1
    assert _notificaciones_de_familia(
        db_session, TipoNotificacion.MIEMBRESIA_MORA_DIA_1, alumno.id
    ) == 1
    assert _notificaciones_de_familia(
        db_session, TipoNotificacion.MIEMBRESIA_MORA_DIA_8, alumno.id
    ) == 0


# --- Los tipos de notificación son distintos (clave de dedup) ----------------

def test_dia_1_y_dia_8_son_tipos_distintos():
    assert TipoNotificacion.MIEMBRESIA_MORA_DIA_1.value == "MIEMBRESIA_MORA_DIA_1"
    assert TipoNotificacion.MIEMBRESIA_MORA_DIA_8.value == "MIEMBRESIA_MORA_DIA_8"
    assert TipoNotificacion.RESUMEN_MORA_ADMIN.value == "RESUMEN_MORA_ADMIN"
    assert TipoNotificacion.MIEMBRESIA_MORA_DIA_1 != TipoNotificacion.MIEMBRESIA_MORA_DIA_8
    assert TipoNotificacion.MIEMBRESIA_MORA_DIA_1 != TipoNotificacion.RESUMEN_MORA_ADMIN
    assert TipoNotificacion.MIEMBRESIA_MORA_DIA_8 != TipoNotificacion.RESUMEN_MORA_ADMIN


def test_retirada_no_recibe_alerta_de_mora(db_session, sesion_inyectada, monkeypatch):
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    persona = _crear_persona(db_session, cedula_valida(225))
    persona.activo = False
    _crear_usuario(db_session, persona, "retirada-mora@cataclub.test")
    _crear_membresia_con_pago(db_session, persona, HOY - timedelta(days=1))

    resultado = alertas_mod.alertar_mora_diaria()

    assert resultado["total_avisos_familia"] == 0


# --- Issue #833: el resumen de mora no debe crecer en SELECTs con N --------
# `_ya_notificado_admin_hoy` corría un SELECT de dedup POR administrador
# dentro de `_disparar_resumen_admin`, además de abrir una `SessionLocal()`
# propia por administrador para el commit. El candado de abajo mide solo los
# SELECT (`contar_selects`, mismo criterio que #810): con 3 y con 6
# administradores la cantidad de SELECT tiene que ser la MISMA -- si creciera
# con N, el fix no está aplicado.

def _sembrar_lote_de_mora_con_admins(db, monkeypatch, cantidad_admins: int) -> None:
    """Una familia en mora (dispara el resumen) más `cantidad_admins`
    administradores activos. Aislado en un helper para no duplicar el
    sembrado entre los dos casos parametrizados (gate de duplicación de
    SonarCloud)."""
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    alumno = _crear_persona(db, cedula_valida(240))
    _crear_usuario(db, alumno, "alumno240@cataclub.test")
    _crear_membresia_con_pago(db, alumno, HOY - timedelta(days=1))
    for indice in range(cantidad_admins):
        _crear_admin(
            db, cedula_valida(250 + indice), f"admin{250 + indice}@cataclub.test",
        )


@pytest.mark.parametrize("cantidad_admins", [3, 6])
def test_resumen_admin_no_crece_en_selects_con_la_cantidad_de_administradores(
    db_session, sesion_inyectada, contar_selects, monkeypatch, cantidad_admins,
):
    _sembrar_lote_de_mora_con_admins(db_session, monkeypatch, cantidad_admins)
    _mock_envio(monkeypatch)

    with contar_selects() as sentencias:
        resultado = alertas_mod.alertar_mora_diaria()

    assert resultado["resumen_admin_enviado"] is True
    selects = [s for s in sentencias if s.strip().upper().startswith("SELECT")]
    assert len(selects) == 4, (
        f"Se esperaban 4 SELECTs (lote de mora + dedup de familia en lote + "
        f"listado de administradores + dedup de resumen en lote), constantes "
        f"sin importar la cantidad de administradores; se ejecutaron "
        f"{len(selects)} con cantidad_admins={cantidad_admins}: {selects}"
    )
