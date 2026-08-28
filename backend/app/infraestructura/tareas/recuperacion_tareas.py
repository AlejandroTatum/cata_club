"""Despacho durable de enlaces de recuperación de contraseña."""
from datetime import datetime, timezone
import logging

from sqlalchemy import delete, func, or_, select

from app.dominio.modelos import RecuperacionOutbox, Usuario
from app.infraestructura.db import SessionLocal
from app.infraestructura.notificaciones_servicio import ServicioNotificaciones
from app.infraestructura.repositorios.recuperacion_outbox_repositorio import (
    RecuperacionOutboxRepositorio,
)
from app.seguridad.gestor_auth import GestorAutenticacion
from app.infraestructura.tareas.celery_app import celery_app

logger = logging.getLogger("cataclub.tareas.recuperacion")


# `enviar_enlace_recuperacion` vivía acá: recibía (correo, token) y llamaba a
# `ServicioNotificaciones`. La migración al outbox durable la dejó sin ningún
# llamador -- `procesar_recuperacion_outbox` acuña el token él mismo porque
# solo él sabe cuándo se envía de verdad -- pero la tarea quedó registrada, y
# `test_recuperacion_honesta.py` siguió parcheando su `.delay` para "simular
# un broker caído" sobre un camino que ya no la tocaba: un mock obsoleto
# encima de la única costura sin cobertura (issue #764). Se retira para que
# nadie vuelva a confundirla con el camino de envío.


@celery_app.task(
    name="app.infraestructura.tareas.recuperacion_tareas.procesar_recuperacion_outbox",
)
def procesar_recuperacion_outbox(evento_id: int) -> dict:
    """Procesa una fila reclamada y deja el retry bajo control del outbox."""
    with SessionLocal() as db:
        evento = db.get(RecuperacionOutbox, evento_id)
        if not evento or evento.status != "ENVIANDO":
            return {"evento_id": evento_id, "omitido": True}
        usuario = db.get(Usuario, evento.usuario_id)
        if not usuario or evento.expires_at <= datetime.now(timezone.utc):
            motivo = "el usuario ya no existe" if not usuario else "la solicitud venció"
            usuario_id = evento.usuario_id  # antes del commit: después expira
            evento.status = "AGOTADO"
            db.commit()
            logger.error(
                "Recuperación AGOTADO sin enviar: fila %s del usuario %s, %s",
                evento_id,
                usuario_id,
                motivo,
            )
            return {"evento_id": evento_id, "agotado": True}
        try:
            token = GestorAutenticacion.crear_token_recuperacion(
                usuario.correo, usuario.version_contrasenia
            )
            ServicioNotificaciones().enviar_recuperacion_contrasenia(usuario.correo, token)
        except Exception as error:
            RecuperacionOutboxRepositorio(db).requeue(evento, error)
            # `requeue` decide entre PENDIENTE y AGOTADO; se leen antes del
            # commit porque después la sesión expira los atributos.
            agotado = evento.status == "AGOTADO"
            intentos, usuario_id = evento.attempts, evento.usuario_id
            db.commit()
            if agotado:
                # AGOTADO es terminal: nadie más va a reintentar esta fila y el
                # usuario nunca va a recibir el enlace. Antes las seis fallas
                # loggeaban el mismo "quedó para retry" -- una mentira en la
                # sexta -- así que el único estado de fracaso definitivo era
                # indistinguible de un fallo transitorio (issue #764).
                logger.error(
                    "Recuperación AGOTADO tras %s intentos: fila %s del usuario "
                    "%s, el enlace nunca se envió y nadie va a reintentarlo",
                    intentos,
                    evento_id,
                    usuario_id,
                )
            else:
                logger.exception("Falló el envío de recuperación; quedó para retry")
            return {"evento_id": evento_id, "enviado": False, "agotado": agotado}
        RecuperacionOutboxRepositorio(db).mark_sent(evento)
        db.commit()
        return {"evento_id": evento_id, "enviado": True}


@celery_app.task(
    name="app.infraestructura.tareas.recuperacion_tareas.despachar_recuperaciones_pendientes",
)
def despachar_recuperaciones_pendientes() -> dict:
    """Reclama filas con lease y las entrega al worker SMTP."""
    reclamadas = 0
    with SessionLocal() as db:
        repo = RecuperacionOutboxRepositorio(db)
        while True:
            evento = repo.claim_pending()
            if evento is None:
                break
            db.commit()
            procesar_recuperacion_outbox.delay(evento.id)
            reclamadas += 1
    return {"reclamadas": reclamadas}


@celery_app.task(
    name="app.infraestructura.tareas.recuperacion_tareas.limpiar_recuperaciones_expiradas",
)
def limpiar_recuperaciones_expiradas() -> dict:
    """Retira filas terminales vencidas, sin tocar solicitudes activas.

    Una fila `PENDIENTE` vencida es una recuperación que el usuario pidió y
    que jamás se envió. Borrarla es correcto -- a las 24 horas el enlace ya no
    sirve --, pero hacerlo en silencio era lo que borraba la evidencia del
    fallo: por eso el issue #764 llegó como queja de un usuario y no como
    alarma, y por eso la consulta de diagnóstico había que correrla antes del
    próximo :05. El borrado se conserva; el silencio no.
    """
    now = datetime.now(timezone.utc)
    with SessionLocal() as db:
        nunca_enviadas = db.execute(
            select(func.count())
            .select_from(RecuperacionOutbox)
            .where(
                RecuperacionOutbox.expires_at <= now,
                RecuperacionOutbox.status == "PENDIENTE",
            )
        ).scalar_one()
        resultado = db.execute(
            delete(RecuperacionOutbox).where(
                RecuperacionOutbox.expires_at <= now,
                or_(
                    RecuperacionOutbox.status.in_(("ENVIADO", "AGOTADO")),
                    RecuperacionOutbox.status == "PENDIENTE",
                ),
            )
        )
        db.commit()
    if nunca_enviadas:
        logger.warning(
            "Se borraron %s solicitudes de recuperación en PENDIENTE que "
            "vencieron sin enviarse: el despachador nunca las reclamó",
            nunca_enviadas,
        )
    return {"eliminadas": resultado.rowcount, "nunca_enviadas": nunca_enviadas}
