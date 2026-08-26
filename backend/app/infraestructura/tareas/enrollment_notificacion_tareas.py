import logging

from app.dominio.enums import TipoNotificacion
from app.dominio.modelos import EnrollmentNotificacionOutbox, Notificacion
from app.infraestructura.db import SessionLocal
from app.infraestructura.repositorios.enrollment_notificacion_outbox_repositorio import EnrollmentNotificacionOutboxRepositorio
from app.infraestructura.tareas.celery_app import celery_app

logger = logging.getLogger("cataclub.tareas.enrollment_notificacion")


@celery_app.task(name="app.infraestructura.tareas.enrollment_notificacion_tareas.despachar_inscripcion_notificaciones")
def despachar_inscripcion_notificaciones():
    db = SessionLocal()
    try:
        while True:
            event = EnrollmentNotificacionOutboxRepositorio(db).claim_pending()
            if not event:
                db.commit()
                return
            event_id = event.id
            db.commit()
            entregar_inscripcion_notificacion(event_id)
            try:
                entregar_inscripcion_notificacion.delay(event_id)
            except Exception as exc:
                logger.warning("No se pudo encolar la entrega %s: %s", event_id, type(exc).__name__)
    finally:
        db.close()


@celery_app.task(name="app.infraestructura.tareas.enrollment_notificacion_tareas.entregar_inscripcion_notificacion")
def entregar_inscripcion_notificacion(event_id: int):
    db = SessionLocal()
    try:
        event = db.get(EnrollmentNotificacionOutbox, event_id)
        if not event or event.status != "ENVIANDO":
            return {"enviado": False}
        existente = db.query(Notificacion).filter(Notificacion.enrollment_outbox_id == event.id).one_or_none()
        if existente:
            EnrollmentNotificacionOutboxRepositorio(db).mark_sent(event)
            db.commit()
            return {"enviado": True}
        try:
            db.add(Notificacion(
                tipo=TipoNotificacion.NUEVA_INSCRIPCION,
                mensaje=event.mensaje,
                persona_id=event.admin_persona_id,
                entidad_relacionada_id=event.alumno_persona_id,
                enrollment_outbox_id=event.id,
            ))
            EnrollmentNotificacionOutboxRepositorio(db).mark_sent(event)
            db.commit()
        except Exception as exc:
            db.rollback()
            event = db.get(EnrollmentNotificacionOutbox, event_id)
            if event:
                EnrollmentNotificacionOutboxRepositorio(db).requeue(event, exc)
                db.commit()
            return {"enviado": False}
        return {"enviado": True}
    finally:
        db.close()


@celery_app.task(name="app.infraestructura.tareas.enrollment_notificacion_tareas.limpiar_inscripcion_notificaciones")
def limpiar_inscripcion_notificaciones():
    db = SessionLocal()
    try:
        db.query(EnrollmentNotificacionOutbox).filter(
            EnrollmentNotificacionOutbox.status.in_(("ENVIADO", "AGOTADO"))
        ).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()
