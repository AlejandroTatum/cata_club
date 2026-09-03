"""
Entrega durable del enlace de verificación de correo (issue #790).

Reusa la forma ya probada del outbox de recuperación (#764) en vez de
inventar un segundo mecanismo: una fila de intención commiteada con la
inscripción, un beat que la reclama con lease, backoff exponencial,
`AGOTADO` terminal, y un token acuñado en el momento del envío que NUNCA se
persiste -- lo único guardado es a quién hay que escribirle y hasta cuándo
vale el intento.

Cubre la cadena completa, que es justo la junta que el issue #764 encontró
sin probar: fila `PENDIENTE` -> `despachar_verificaciones_pendientes` ->
`procesar_verificacion_correo_outbox` -> `enviar_verificacion_correo` ->
`sendmail`. Lo único sustituido es el socket.

Disciplina anti-enumeración: el reenvío responde EXACTAMENTE lo mismo exista
o no la cuenta, y esté o no ya verificada. Si difiriera, el formulario de
reenvío sería un buscador de direcciones registradas -- el mismo oráculo que
`MENSAJE_IDENTIDAD_DUPLICADA` y la recuperación de contraseña ya evitan.
"""
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest

from app.dominio.cedula import cedula_valida
from app.dominio.mensajes import MENSAJE_VERIFICACION_ENVIADA
from app.dominio.modelos import Usuario, VerificacionCorreoOutbox
from app.infraestructura.repositorios.verificacion_correo_outbox_repositorio import (
    MAX_ATTEMPTS,
    VerificacionCorreoOutboxRepositorio,
)
from app.infraestructura.tareas import verificacion_correo_tareas
from app.infraestructura.tareas.verificacion_correo_tareas import (
    despachar_verificaciones_pendientes,
    limpiar_verificaciones_expiradas,
    procesar_verificacion_correo_outbox,
)
from app.servicios_negocio.dtos.enrollment_schemas import (
    EnrollmentAlumnoDTO, EnrollmentCreateDTO, EnrollmentFichaMedicaDTO,
    EnrollmentRepresentanteDTO,
)
from app.dominio.enums import TipoSangre
from app.seguridad.gestor_auth import GestorAutenticacion
from app.servicios_negocio.auth_servicio import AuthServicio
from app.servicios_negocio.enrollment_servicio import EnrollmentServicio
from app.soporte_transversal.configuracion import settings
from tests import arnes_outbox as arnes
from tests.fabricas_auth import crear_usuario_auth

from datetime import date


ASUNTO_VERIFICACION = "Cata Club | Verificación de correo"


# ─── Arnés ──────────────────────────────────────────────────────────────────
# El andamiaje (sesión inyectada, Celery eager, SMTP falso, lectura del MIME)
# vive en `tests/arnes_outbox.py`, compartido con las demás colas. Acá quedan
# solo las fixtures que lo atan a ESTE módulo de tareas y a ESTE logger.
@pytest.fixture()
def sesion_inyectada(db_session, monkeypatch):
    with arnes.sesion_inyectada_en(verificacion_correo_tareas, db_session, monkeypatch):
        yield db_session


@pytest.fixture()
def celery_sincrono(monkeypatch):
    arnes.celery_en_proceso(verificacion_correo_tareas, monkeypatch)


@pytest.fixture()
def smtp_configurado(monkeypatch):
    arnes.configurar_smtp(monkeypatch)


@pytest.fixture()
def logs_de_verificacion():
    with arnes.logs_recogidos("cataclub.tareas.verificacion_correo") as registros:
        yield registros


def _inscribir(db_session, correo="sofia@example.com", semilla=800) -> Usuario:
    """Ejerce el alta pública real, que es quien debe encolar la verificación."""
    datos = EnrollmentCreateDTO(
        representante=EnrollmentRepresentanteDTO(
            nombres="Sofia", apellidos="Martinez", cedula=cedula_valida(semilla),
            fecha_nacimiento=date(1990, 5, 20), telefono="0991234567",
            correo=correo, contrasenia="password8",
        ),
        alumno=EnrollmentAlumnoDTO(
            nombres="Mateo", apellidos="Martinez", cedula=cedula_valida(semilla + 1),
            fecha_nacimiento=date(2015, 6, 15), telefono="0991234568",
        ),
        ficha_medica=EnrollmentFichaMedicaDTO(
            tipo_sangre=TipoSangre.O_POSITIVO, enfermedades=[],
            contacto_emergencia="Sofia Martinez", telefono_emergencia="0991112233",
        ),
        acepta_consentimientos=True,
    )
    EnrollmentServicio(db_session).enroll(datos)
    return db_session.query(Usuario).filter(Usuario.correo == correo).one()


# ─── La inscripción encola la verificación ──────────────────────────────────
def test_la_inscripcion_publica_deja_la_verificacion_pendiente(db_session):
    """La fila se commitea con la inscripción, antes de hablar con Redis: una
    caída del broker no puede perder una verificación ya aceptada."""
    cuenta = _inscribir(db_session)

    filas = db_session.query(VerificacionCorreoOutbox).all()
    assert [(f.usuario_id, f.status, f.attempts) for f in filas] == [
        (cuenta.id, "PENDIENTE", 0)
    ]
    assert cuenta.correo_verificado is False


def test_la_cuenta_recien_inscripta_nace_sin_verificar(db_session):
    _inscribir(db_session)
    db_session.rollback()  # simula el cierre de la sesión del request

    assert db_session.query(Usuario).filter(
        Usuario.correo == "sofia@example.com"
    ).one().correo_verificado is False


# ─── Anti-enumeración del reenvío ───────────────────────────────────────────
def test_el_reenvio_responde_igual_exista_o_no_la_cuenta(client_sin_token, db_session):
    """Si las dos respuestas difirieran, el formulario sería un buscador de
    direcciones registradas."""
    crear_usuario_auth(db_session, correo="registrada@example.com")

    registrada = client_sin_token.post(
        "/api/v1/auth/verificar-correo/reenviar", json={"correo": "registrada@example.com"}
    )
    desconocida = client_sin_token.post(
        "/api/v1/auth/verificar-correo/reenviar", json={"correo": "nadie@example.com"}
    )

    assert registrada.status_code == desconocida.status_code == 200
    assert registrada.json() == desconocida.json()
    assert registrada.json()["mensaje"] == MENSAJE_VERIFICACION_ENVIADA


def test_el_reenvio_responde_igual_si_la_cuenta_ya_esta_verificada(
    client_sin_token, db_session
):
    """El otro sentido del mismo oráculo: la respuesta tampoco puede delatar
    en qué estado está una cuenta que sí existe."""
    cuenta = crear_usuario_auth(db_session, correo="verificada@example.com")
    cuenta.correo_verificado = True
    db_session.commit()

    respuesta = client_sin_token.post(
        "/api/v1/auth/verificar-correo/reenviar", json={"correo": cuenta.correo}
    )

    assert respuesta.status_code == 200
    assert respuesta.json()["mensaje"] == MENSAJE_VERIFICACION_ENVIADA
    # ...pero no se encola trabajo inútil para una cuenta ya verificada.
    assert db_session.query(VerificacionCorreoOutbox).count() == 0


def test_una_direccion_desconocida_no_deja_ninguna_fila(client_sin_token, db_session):
    client_sin_token.post(
        "/api/v1/auth/verificar-correo/reenviar", json={"correo": "nadie@example.com"}
    )

    assert db_session.query(VerificacionCorreoOutbox).count() == 0


def test_el_reenvio_reusa_la_fila_activa_y_adelanta_el_reintento(db_session):
    """El índice parcial único exige reusar la fila activa. Reusarla SIN
    adelantar `next_attempt_at` convertía "reenviar" en un 200 que no hace
    nada mientras el backoff empujaba el reintento (issue #764)."""
    cuenta = _inscribir(db_session)
    fila = db_session.query(VerificacionCorreoOutbox).one()
    fila.next_attempt_at = datetime.now(timezone.utc) + timedelta(minutes=16)
    db_session.commit()

    AuthServicio(db_session).solicitar_verificacion_correo(cuenta.correo)

    db_session.expire_all()
    filas = db_session.query(VerificacionCorreoOutbox).all()
    assert len(filas) == 1
    assert filas[0].next_attempt_at <= datetime.now(timezone.utc) + timedelta(seconds=5)


# ─── Confirmación ───────────────────────────────────────────────────────────
def test_un_enlace_invalido_no_distingue_entre_causas(client_sin_token, db_session):
    """Un token corrupto y un token bien formado de una cuenta inexistente
    reciben la MISMA respuesta: el endpoint de confirmación tampoco es un
    oráculo de qué direcciones existen."""
    corrupto = client_sin_token.post(
        "/api/v1/auth/verificar-correo", json={"token": "esto.no.es.un.jwt"}
    )
    de_cuenta_inexistente = client_sin_token.post(
        "/api/v1/auth/verificar-correo",
        json={"token": GestorAutenticacion.crear_token_verificacion_correo(
            "nadie@example.com"
        )},
    )

    assert corrupto.status_code == de_cuenta_inexistente.status_code == 401
    assert corrupto.json() == de_cuenta_inexistente.json()


def test_una_cuenta_desactivada_no_verifica_su_correo(client_sin_token, db_session):
    """Mismo criterio que `restablecer_contrasenia`: los estados que impiden
    iniciar sesión tampoco habilitan a ganar capacidades, y el motivo no se
    revela a quien tenga el enlace."""
    cuenta = crear_usuario_auth(db_session, correo="suspendida@cataclub.test")
    cuenta.activo = False
    db_session.commit()

    respuesta = client_sin_token.post(
        "/api/v1/auth/verificar-correo",
        json={"token": GestorAutenticacion.crear_token_verificacion_correo(cuenta.correo)},
    )

    assert respuesta.status_code == 401
    db_session.expire_all()
    assert db_session.get(Usuario, cuenta.id).correo_verificado is False


# ─── Repositorio: lease, backoff y AGOTADO ──────────────────────────────────
def test_el_reclamo_usa_lease_y_no_toma_dos_veces_la_misma_fila(db_session):
    cuenta = crear_usuario_auth(db_session, correo="lease@cataclub.test")
    db_session.add(VerificacionCorreoOutbox(
        usuario_id=cuenta.id,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=24),
    ))
    db_session.commit()
    repo = VerificacionCorreoOutboxRepositorio(db_session)

    primera = repo.claim_pending()
    segunda = repo.claim_pending()

    assert primera is not None and primera.status == "ENVIANDO" and primera.attempts == 1
    assert segunda is None


def test_el_backoff_agota_la_fila_en_el_ultimo_intento(db_session):
    """`AGOTADO` es terminal: nadie más reintenta, y la cuenta se queda sin
    verificar. Debe quedar registrado, no morir en silencio."""
    cuenta = crear_usuario_auth(db_session, correo="agotada@cataclub.test")
    fila = VerificacionCorreoOutbox(
        usuario_id=cuenta.id,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=24),
    )
    db_session.add(fila)
    db_session.commit()
    repo = VerificacionCorreoOutboxRepositorio(db_session)

    for _ in range(MAX_ATTEMPTS):
        fila.status = "PENDIENTE"
        fila.next_attempt_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        db_session.commit()
        reclamada = repo.claim_pending()
        assert reclamada is not None
        repo.requeue(reclamada, RuntimeError("boom"))
        db_session.commit()

    assert fila.status == "AGOTADO"
    assert fila.attempts == MAX_ATTEMPTS
    # El detalle del error no se persiste: solo su clase.
    assert fila.last_error_redacted == "RuntimeError: delivery failed"


# ─── La cadena completa ─────────────────────────────────────────────────────
def test_una_fila_pendiente_termina_en_un_correo_con_el_enlace(
    sesion_inyectada, celery_sincrono, smtp_configurado, monkeypatch
):
    """La junta que nadie prueba si cada eslabón se prueba por separado."""
    db_session = sesion_inyectada
    monkeypatch.setattr(settings, "frontend_url", "https://club.test")
    cuenta = _inscribir(db_session)

    with patch(
        "app.infraestructura.notificaciones_servicio.smtplib.SMTP", MagicMock()
    ) as smtp_cls:
        # Issue #841: la corrida reporta además el techo del lote y si lo tocó.
        assert despachar_verificaciones_pendientes() == {
            "reclamadas": 1,
            "tope": settings.celery_outbox_lote_maximo,
            "tope_alcanzado": False,
        }

    _, destinatario, mensaje = arnes.mensaje_enviado(smtp_cls)
    assert destinatario == cuenta.correo
    cuerpo = arnes.texto_plano(mensaje)
    assert "https://club.test/verificar-correo?token=" in cuerpo

    db_session.expire_all()
    fila = db_session.query(VerificacionCorreoOutbox).one()
    assert fila.status == "ENVIADO" and fila.sent_at is not None


def test_el_token_del_correo_verifica_de_verdad_la_cuenta(
    sesion_inyectada, celery_sincrono, smtp_configurado, monkeypatch, client_sin_token
):
    """Punta a punta: el enlace que sale por SMTP es el que marca la cuenta.
    El token se acuña al enviar y no queda persistido en ninguna fila."""
    db_session = sesion_inyectada
    monkeypatch.setattr(settings, "frontend_url", "https://club.test")
    cuenta = _inscribir(db_session)

    with patch(
        "app.infraestructura.notificaciones_servicio.smtplib.SMTP", MagicMock()
    ) as smtp_cls:
        despachar_verificaciones_pendientes()

    _, _, mensaje = arnes.mensaje_enviado(smtp_cls)
    token = arnes.texto_plano(mensaje).split("verificar-correo?token=")[1].split()[0]

    assert client_sin_token.post(
        "/api/v1/auth/verificar-correo", json={"token": token}
    ).status_code == 204

    db_session.expire_all()
    assert db_session.get(Usuario, cuenta.id).correo_verificado is True
    fila = db_session.query(VerificacionCorreoOutbox).one()
    assert token not in str(fila.__dict__.values())


def test_una_fila_de_una_cuenta_ya_verificada_no_envia_nada(
    sesion_inyectada, celery_sincrono, smtp_configurado, logs_de_verificacion
):
    """La cuenta pudo verificarse por otra vía entre el encolado y el
    despacho; mandar el correo igual sería ruido sin propósito."""
    db_session = sesion_inyectada
    cuenta = _inscribir(db_session)
    cuenta.correo_verificado = True
    db_session.commit()

    with patch(
        "app.infraestructura.notificaciones_servicio.smtplib.SMTP", MagicMock()
    ) as smtp_cls:
        despachar_verificaciones_pendientes()

    assert arnes.sendmail_de(smtp_cls).call_count == 0
    db_session.expire_all()
    assert db_session.query(VerificacionCorreoOutbox).one().status == "ENVIADO"


def test_una_fila_vencida_queda_agotada_y_lo_registra(
    sesion_inyectada, celery_sincrono, smtp_configurado, logs_de_verificacion
):
    """El único estado de fracaso definitivo no puede ser indistinguible de un
    fallo transitorio (issue #764)."""
    db_session = sesion_inyectada
    cuenta = crear_usuario_auth(db_session, correo="vencida@cataclub.test")
    fila = VerificacionCorreoOutbox(
        usuario_id=cuenta.id,
        # `ENVIANDO`: la fila venció DESPUÉS de que un worker la reclamara,
        # que es el único camino por el que la tarea llega a mirarla.
        status="ENVIANDO",
        claimed_at=datetime.now(timezone.utc),
        expires_at=datetime.now(timezone.utc) - timedelta(minutes=1),
    )
    db_session.add(fila)
    db_session.commit()

    procesar_verificacion_correo_outbox(fila.id)

    db_session.expire_all()
    assert db_session.get(VerificacionCorreoOutbox, fila.id).status == "AGOTADO"


def test_la_limpieza_retira_filas_terminales_vencidas(sesion_inyectada):
    db_session = sesion_inyectada
    cuenta = crear_usuario_auth(db_session, correo="limpieza@cataclub.test")
    db_session.add(VerificacionCorreoOutbox(
        usuario_id=cuenta.id, status="ENVIADO",
        expires_at=datetime.now(timezone.utc) - timedelta(days=2),
    ))
    db_session.commit()

    resultado = limpiar_verificaciones_expiradas()

    assert resultado["eliminadas"] == 1
    assert db_session.query(VerificacionCorreoOutbox).count() == 0
