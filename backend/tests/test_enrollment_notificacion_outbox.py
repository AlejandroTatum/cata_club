"""Contratos del outbox durable de notificaciones de inscripción."""

from datetime import date, datetime, timedelta, timezone
from unittest.mock import Mock

import pytest

from app.dominio.cedula import cedula_valida
from app.dominio.enums import TipoNotificacion
from app.dominio.modelos import EnrollmentNotificacionOutbox, Notificacion, Persona
from app.infraestructura.repositorios.enrollment_notificacion_outbox_repositorio import (
    MAX_ATTEMPTS,
    EnrollmentNotificacionOutboxRepositorio,
)
from tests import arnes_outbox as arnes


@pytest.fixture()
def logs_de_inscripcion():
    with arnes.logs_recogidos("cataclub.tareas.enrollment_notificacion") as registros:
        yield registros


def _mensajes(registros):
    return [registro.getMessage() for registro in registros]


def _personas(db_session, semilla: int = 0):
    """Dos cédulas distintas y estables por `semilla`. Antes se armaban
    concatenando (`1710000000 + semilla * 10 + n`), que produce diez dígitos
    pero no cédulas: el dígito verificador salía por casualidad. Desde el
    issue #828 el modelo las rechaza, así que se derivan del generador
    canónico del dominio."""
    base = 500 + semilla * 10
    admin = Persona(nombres="Admin", apellidos="Outbox", cedula=cedula_valida(base + 1), fecha_nacimiento=date(1990, 1, 1), telefono="0991111111")
    alumno = Persona(nombres="Alumno", apellidos="Outbox", cedula=cedula_valida(base + 2), fecha_nacimiento=date(2010, 1, 1), telefono="0991111112")
    db_session.add_all([admin, alumno])
    db_session.flush()
    return admin, alumno


def _evento(db_session, semilla: int = 0, **kwargs):
    admin, alumno = _personas(db_session, semilla=semilla)
    event = EnrollmentNotificacionOutbox(
        admin_persona_id=admin.id,
        alumno_persona_id=alumno.id,
        mensaje="Nuevo alumno inscrito",
        **kwargs,
    )
    db_session.add(event)
    db_session.commit()
    return event


def test_outbox_de_notificacion_de_inscripcion_es_un_modelo_durable(db_session):
    event = _evento(db_session)
    assert event.status == "PENDIENTE"
    assert event.attempts == 0
    assert event.mensaje == "Nuevo alumno inscrito"


def test_claim_usa_lease_y_requeue_aplica_backoff(db_session):
    event = _evento(db_session)
    repo = EnrollmentNotificacionOutboxRepositorio(db_session)
    claimed = repo.claim_pending()
    db_session.commit()
    assert claimed.id == event.id
    assert claimed.status == "ENVIANDO"
    assert claimed.attempts == 1
    assert repo.claim_pending() is None
    repo.requeue(claimed, RuntimeError("smtp no aplica"))
    assert claimed.status == "PENDIENTE"
    assert claimed.last_error_redacted == "RuntimeError: delivery failed"
    assert claimed.next_attempt_at > datetime.now(timezone.utc)


def test_worker_materializa_notificacion_y_repetir_es_idempotente(monkeypatch, db_session):
    from app.infraestructura.tareas import enrollment_notificacion_tareas as tasks

    event = _evento(db_session, status="ENVIANDO", attempts=1)
    event_id = event.id
    monkeypatch.setattr(tasks, "SessionLocal", lambda: db_session)
    assert tasks.entregar_inscripcion_notificacion(event_id)["enviado"] is True
    assert db_session.query(Notificacion).filter_by(enrollment_outbox_id=event_id).count() == 1
    assert tasks.entregar_inscripcion_notificacion(event_id)["enviado"] is False
    assert db_session.query(Notificacion).filter_by(enrollment_outbox_id=event_id).count() == 1


def test_worker_fallo_de_tarea_reencola(monkeypatch, db_session):
    from app.infraestructura.tareas import enrollment_notificacion_tareas as tasks

    event = _evento(db_session, status="ENVIANDO", attempts=1)
    event_id = event.id
    monkeypatch.setattr(tasks, "SessionLocal", lambda: db_session)
    original_add = db_session.add

    def failing_add(value):
        if isinstance(value, Notificacion):
            raise RuntimeError("fallo de tarea")
        original_add(value)

    monkeypatch.setattr(db_session, "add", failing_add)
    assert tasks.entregar_inscripcion_notificacion(event_id)["enviado"] is False
    assert db_session.get(EnrollmentNotificacionOutbox, event_id).status == "PENDIENTE"
    assert db_session.get(EnrollmentNotificacionOutbox, event_id).last_error_redacted == "RuntimeError: delivery failed"


def test_dispatcher_fallo_de_broker_reencola(monkeypatch, db_session):
    from app.infraestructura.tareas import enrollment_notificacion_tareas as tasks

    event = _evento(db_session)
    event_id = event.id
    monkeypatch.setattr(tasks, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(tasks.entregar_inscripcion_notificacion, "delay", Mock(side_effect=ConnectionError("broker")))
    tasks.despachar_inscripcion_notificaciones()
    event = db_session.get(EnrollmentNotificacionOutbox, event_id)
    assert event.status == "ENVIANDO"
    assert db_session.query(Notificacion).filter_by(enrollment_outbox_id=event_id).count() == 0


def test_claim_recupera_lease_vencido(db_session):
    event = _evento(
        db_session,
        status="ENVIANDO",
        attempts=1,
        claimed_at=datetime.now(timezone.utc) - timedelta(minutes=20),
    )
    claimed = EnrollmentNotificacionOutboxRepositorio(db_session).claim_pending(lease_minutes=10)
    assert claimed.id == event.id
    assert claimed.status == "ENVIANDO"


# --- El endpoint público no trabaja por filas ajenas (issue #703) -----------
# `POST /enrollment/` es PÚBLICO y sin auth. Antes drenaba el outbox entero
# in-request (`while True: claim_pending()`), así que una inscripción cualquiera
# pagaba la entrega de TODAS las notificaciones pendientes del club: medido en
# QA, 264 ms con el outbox vacío contra 8654 ms con 2000 filas pendientes.

def _admin(db_session):
    """Persona + Usuario con rol ADMINISTRADOR: precondición del aviso."""
    from datetime import date as _date

    from app.dominio.cedula import cedula_valida
    from app.dominio.enums import TipoRol
    from app.dominio.modelos import Rol, Usuario

    admin = Persona(
        nombres="Admin", apellidos="Backlog", cedula=cedula_valida(701),
        fecha_nacimiento=_date(1985, 3, 10), telefono="0990000001",
    )
    db_session.add(admin)
    db_session.flush()
    db_session.add(Usuario(
        correo="admin.backlog@cataclub.test", contrasenia="hash", persona_id=admin.id,
        roles=[Rol(tipo_rol=TipoRol.ADMINISTRADOR, descripcion="Administrador")],
    ))
    db_session.commit()
    return admin


def _inscribir(db_session, secuencia: int = 730):
    """Autoinscripción de un adulto, el camino del endpoint público."""
    from datetime import date as _date

    from app.dominio.cedula import cedula_valida
    from app.presentacion.schemas.enrollment_schemas import (
        EnrollmentAlumnoDTO,
        EnrollmentCreateDTO,
        EnrollmentCredencialesDTO,
        EnrollmentFichaMedicaDTO,
    )
    from app.servicios_negocio.enrollment_servicio import EnrollmentServicio

    return EnrollmentServicio(db_session).enroll(EnrollmentCreateDTO(
        alumno=EnrollmentAlumnoDTO(
            nombres="Nuevo", apellidos="Visitante", cedula=cedula_valida(secuencia),
            fecha_nacimiento=_date(2000, 1, 1), telefono="0991234567",
        ),
        credenciales_alumno=EnrollmentCredencialesDTO(
            correo=f"visitante{secuencia}@example.com", contrasenia="password8",
        ),
        # Issue #730: obligatoria en el alta pública. Este archivo mide la
        # entrega de la notificación al admin, no la ficha.
        ficha_medica=EnrollmentFichaMedicaDTO(
            tipo_sangre="O_POSITIVO", enfermedades=[],
            contacto_emergencia="María Torres", telefono_emergencia="0991112233",
        ),
        acepta_consentimientos=True,
    ))


def _correr_worker(db_session, monkeypatch) -> None:
    """Cadena real beat -> worker, como cuando el worker vuelve a levantar."""
    from app.infraestructura.tareas import enrollment_notificacion_tareas as tareas

    monkeypatch.setattr(tareas, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(
        tareas.entregar_inscripcion_notificacion,
        "delay",
        tareas.entregar_inscripcion_notificacion,
    )
    tareas.despachar_inscripcion_notificaciones()


def test_la_inscripcion_no_toca_las_filas_pendientes_de_otras_inscripciones(db_session):
    """Candado del despacho acotado.

    Falla si alguien vuelve a drenar el outbox dentro del request: las filas
    ajenas tienen que quedar intactas (PENDIENTE, attempts=0, sin reclamar) y
    sin `Notificacion` materializada, porque entregarlas es trabajo del
    worker."""
    from datetime import date as _date

    from app.dominio.cedula import cedula_valida

    admin = _admin(db_session)

    # Backlog de inscripciones ANTERIORES, ya commiteadas y todavía sin entregar
    # (worker caído): son exactamente las filas que el request no debe tocar.
    ajenos = []
    for i in range(5):
        otro = Persona(
            nombres=f"Previo{i}", apellidos="Backlog", cedula=cedula_valida(710 + i),
            fecha_nacimiento=_date(2010, 1, 1), telefono="0991111112",
        )
        db_session.add(otro)
        db_session.flush()
        ajenos.append(EnrollmentNotificacionOutboxRepositorio(db_session).crear(
            admin.id, otro.id, f"Nuevo alumno inscrito: Previo{i}.",
        ))
    db_session.commit()
    ids_ajenos = [e.id for e in ajenos]

    _inscribir(db_session)

    for event_id in ids_ajenos:
        ajeno = db_session.get(EnrollmentNotificacionOutbox, event_id)
        assert ajeno.status == "PENDIENTE", "el request reclamó una fila ajena"
        assert ajeno.attempts == 0, "el request intentó entregar una fila ajena"
        assert ajeno.claimed_at is None
    assert db_session.query(Notificacion).count() == 0, (
        "el request materializó notificaciones; entregarlas es del worker"
    )
    # Y su propia fila quedó encolada, durable, para que el worker la entregue.
    propias = (
        db_session.query(EnrollmentNotificacionOutbox)
        .filter(EnrollmentNotificacionOutbox.id.notin_(ids_ajenos))
        .all()
    )
    assert len(propias) == 1
    assert propias[0].status == "PENDIENTE"


def test_la_entrega_sobrevive_al_worker_caido_y_avisa_una_sola_vez(db_session, monkeypatch):
    """Garantía durable del PR #633, sin el drenaje in-request.

    El worker está caído durante la inscripción: nadie entrega nada y la fila
    queda PENDIENTE. Cuando el worker vuelve, el beat la entrega, y correrlo de
    nuevo NO duplica el aviso."""
    # `entregar_inscripcion_notificacion` cierra la sesión al terminar, así que
    # los ids se leen ANTES de correr el worker.
    admin_id = _admin(db_session).id

    _inscribir(db_session)

    # Worker caído: la inscripción respondió, pero el aviso sigue encolado.
    assert db_session.query(Notificacion).count() == 0
    encolado = db_session.query(EnrollmentNotificacionOutbox).one()
    encolado_id = encolado.id
    assert encolado.status == "PENDIENTE"

    # El worker vuelve: el beat drena lo que quedó pendiente.
    _correr_worker(db_session, monkeypatch)

    entregadas = db_session.query(Notificacion).filter_by(persona_id=admin_id).all()
    assert len(entregadas) == 1
    assert entregadas[0].tipo == TipoNotificacion.NUEVA_INSCRIPCION
    assert db_session.get(EnrollmentNotificacionOutbox, encolado_id).status == "ENVIADO"

    # Otro tick del beat no puede volver a avisar lo mismo.
    _correr_worker(db_session, monkeypatch)
    assert db_session.query(Notificacion).filter_by(persona_id=admin_id).count() == 1


# ─── El fracaso terminal deja de ser invisible (issue #791) ─────────────────
# `entregar_inscripcion_notificacion` no logueaba nada en el `except`: ni el
# reintento transitorio ni el sexto fallo que agota la fila. Un admin dejaba
# de recibir avisos de nueva inscripción sin que quedara una sola línea en los
# logs -- y `limpiar_inscripcion_notificaciones` borraba esa evidencia después,
# también en silencio. Mismo criterio que `outbox_despacho` (issue #764):
# el reintento transitorio y el AGOTADO terminal tienen que distinguirse en
# el log, y el borrado tiene que decir cuántas filas nunca llegaron al admin.

def _falla_al_materializar_notificacion(db_session, monkeypatch):
    """Hace que `db.add(Notificacion(...))` reviente, como si el broker
    entregara la tarea pero algo fallara al escribir la notificación."""
    original_add = db_session.add

    def failing_add(value):
        if isinstance(value, Notificacion):
            raise RuntimeError("fallo de entrega")
        original_add(value)

    monkeypatch.setattr(db_session, "add", failing_add)


def test_una_fila_que_agota_en_el_ultimo_intento_se_registra_como_agotada(
    monkeypatch, db_session, logs_de_inscripcion,
):
    """El sexto fallo no puede quedar registrado igual que un reintento: es
    el único estado terminal de fracaso y hoy no deja ningún rastro."""
    from app.infraestructura.tareas import enrollment_notificacion_tareas as tasks

    event = _evento(db_session, status="ENVIANDO", attempts=MAX_ATTEMPTS)
    event_id = event.id
    admin_persona_id = event.admin_persona_id
    monkeypatch.setattr(tasks, "SessionLocal", lambda: db_session)
    _falla_al_materializar_notificacion(db_session, monkeypatch)

    resultado = tasks.entregar_inscripcion_notificacion(event_id)

    assert resultado["enviado"] is False
    fila = db_session.get(EnrollmentNotificacionOutbox, event_id)
    assert fila.status == "AGOTADO"
    assert fila.attempts == MAX_ATTEMPTS

    agotados = [
        registro for registro in logs_de_inscripcion
        if "AGOTADO" in registro.getMessage()
    ]
    assert agotados, (
        "la fila se agotó sin dejar un log que lo diga. "
        f"Mensajes vistos: {_mensajes(logs_de_inscripcion)}"
    )
    assert agotados[0].levelno >= 40, "el agotamiento es un fracaso terminal, no una advertencia"  # ERROR
    assert str(event_id) in agotados[0].getMessage(), "el log de agotamiento no identifica la fila"
    assert str(admin_persona_id) in agotados[0].getMessage(), (
        "el log de agotamiento no identifica al admin que se quedó sin avisar"
    )


def test_una_falla_transitoria_se_registra_pero_no_se_confunde_con_agotada(
    monkeypatch, db_session, logs_de_inscripcion,
):
    """Un fallo que todavía tiene reintentos por delante tiene que quedar
    en el log -- pero sin decir "AGOTADO", que es el único estado terminal."""
    from app.infraestructura.tareas import enrollment_notificacion_tareas as tasks

    event = _evento(db_session, status="ENVIANDO", attempts=1)
    event_id = event.id
    monkeypatch.setattr(tasks, "SessionLocal", lambda: db_session)
    _falla_al_materializar_notificacion(db_session, monkeypatch)

    resultado = tasks.entregar_inscripcion_notificacion(event_id)

    assert resultado["enviado"] is False
    fila = db_session.get(EnrollmentNotificacionOutbox, event_id)
    assert fila.status == "PENDIENTE"

    assert logs_de_inscripcion, "un fallo transitorio no puede quedar en silencio"
    assert not any(
        "AGOTADO" in registro.getMessage() for registro in logs_de_inscripcion
    ), (
        "un reintento transitorio se logueó como si fuera el fracaso terminal: "
        f"{_mensajes(logs_de_inscripcion)}"
    )


def test_la_limpieza_reporta_cuantos_avisos_nunca_llegaron_al_admin(
    monkeypatch, db_session, logs_de_inscripcion,
):
    """Borrar `AGOTADO`/`ENVIADO` en silencio es lo que vuelve invisible al
    admin que dejó de recibir avisos: el borrado se conserva, el silencio no."""
    from app.infraestructura.tareas import enrollment_notificacion_tareas as tasks

    # Los ids se leen ANTES de correr la tarea: cierra su propia sesión (la
    # misma `db_session` inyectada), que desvincula los objetos ya cargados.
    agotada_id = _evento(db_session, semilla=1, status="AGOTADO", attempts=MAX_ATTEMPTS).id
    enviada_id = _evento(db_session, semilla=2, status="ENVIADO").id
    pendiente_id = _evento(db_session, semilla=3, status="PENDIENTE").id
    monkeypatch.setattr(tasks, "SessionLocal", lambda: db_session)

    resultado = tasks.limpiar_inscripcion_notificaciones()

    assert resultado["eliminadas"] == 2
    assert resultado["agotadas"] == 1
    restantes = {e.id for e in db_session.query(EnrollmentNotificacionOutbox).all()}
    assert restantes == {pendiente_id}
    assert db_session.get(EnrollmentNotificacionOutbox, agotada_id) is None
    assert db_session.get(EnrollmentNotificacionOutbox, enviada_id) is None

    mensajes = _mensajes(logs_de_inscripcion)
    assert any("AGOTADO" in mensaje and "1" in mensaje for mensaje in mensajes), (
        "la limpieza borró un aviso que nunca llegó al admin y no dejó rastro: "
        f"{mensajes}"
    )
