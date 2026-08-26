"""Despacho durable de enlaces de recuperación de contraseña."""
from datetime import datetime, timezone
import logging

from sqlalchemy import delete, or_

from app.dominio.modelos import RecuperacionOutbox, Usuario
from app.infraestructura.db import SessionLocal
from app.infraestructura.notificaciones_servicio import ServicioNotificaciones
from app.infraestructura.repositorios.recuperacion_outbox_repositorio import (
    RecuperacionOutboxRepositorio,
)
from app.seguridad.gestor_auth import GestorAutenticacion
from app.infraestructura.tareas.celery_app import celery_app

logger = logging.getLogger("cataclub.tareas.recuperacion")


@celery_app.task(
    name="app.infraestructura.tareas.recuperacion_tareas.enviar_enlace_recuperacion",
    bind=True,
)
def enviar_enlace_recuperacion(self, correo: str, token: str) -> dict:
    """Envío SMTP, conservado como tarea pequeña y testeable."""
    ServicioNotificaciones().enviar_recuperacion_contrasenia(correo, token)
    return {"correo": correo, "enviado": True}


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
            evento.status = "AGOTADO"
            db.commit()
            return {"evento_id": evento_id, "agotado": True}
        try:
            token = GestorAutenticacion.crear_token_recuperacion(
                usuario.correo, usuario.version_contrasenia
            )
            ServicioNotificaciones().enviar_recuperacion_contrasenia(usuario.correo, token)
        except Exception as error:
            RecuperacionOutboxRepositorio(db).requeue(evento, error)
            db.commit()
            logger.exception("Falló el envío de recuperación; quedó para retry")
            return {"evento_id": evento_id, "enviado": False}
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
    """Retira filas terminales vencidas, sin tocar solicitudes activas."""
    now = datetime.now(timezone.utc)
    with SessionLocal() as db:
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
    return {"eliminadas": resultado.rowcount}
