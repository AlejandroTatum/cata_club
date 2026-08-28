import logging

from sqlalchemy import func

from app.dominio.enums import TipoNotificacion
from app.dominio.modelos import EnrollmentNotificacionOutbox, Notificacion
from app.infraestructura.db import SessionLocal
from app.infraestructura.repositorios.enrollment_notificacion_outbox_repositorio import EnrollmentNotificacionOutboxRepositorio
from app.infraestructura.tareas.celery_app import celery_app

logger = logging.getLogger("cataclub.tareas.enrollment_notificacion")


@celery_app.task(name="app.infraestructura.tareas.enrollment_notificacion_tareas.despachar_inscripcion_notificaciones")
def despachar_inscripcion_notificaciones():
    reclamadas = 0
    with SessionLocal() as db:
        repo = EnrollmentNotificacionOutboxRepositorio(db)
        while True:
            event = repo.claim_pending()
            if not event:
                break
            db.commit()
            try:
                entregar_inscripcion_notificacion.delay(event.id)
            except Exception as exc:
                logger.warning("No se pudo encolar la entrega %s: %s", event.id, type(exc).__name__)
            reclamadas += 1
    return {"reclamadas": reclamadas}


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
                # `requeue` decide entre PENDIENTE y AGOTADO; se leen antes del
                # commit porque después la sesión expira los atributos.
                agotado = event.status == "AGOTADO"
                intentos, admin_persona_id = event.attempts, event.admin_persona_id
                db.commit()
                if agotado:
                    # AGOTADO es terminal: nadie más va a reintentar esta fila.
                    # Loguearlo igual que un fallo transitorio volvía invisible
                    # el único estado de fracaso definitivo (issue #791).
                    logger.error(
                        "Aviso de inscripción AGOTADO tras %s intentos: fila %s "
                        "del admin %s, la notificación nunca se envió y nadie "
                        "va a reintentarla",
                        intentos, event_id, admin_persona_id,
                    )
                else:
                    logger.exception(
                        "Falló el envío del aviso de inscripción; quedó para "
                        "retry (fila %s)",
                        event_id,
                    )
            return {"enviado": False}
        return {"enviado": True}
    finally:
        db.close()


@celery_app.task(name="app.infraestructura.tareas.enrollment_notificacion_tareas.limpiar_inscripcion_notificaciones")
def limpiar_inscripcion_notificaciones():
    """Retira los avisos de inscripción ya cerrados (`ENVIADO`/`AGOTADO`).

    El modelo no tiene `expires_at` -- a diferencia de las otras dos colas de
    salida --, así que el predicado de borrado se conserva tal cual estaba.
    Lo que faltaba era contar y loguear: borrar un `AGOTADO` en silencio es lo
    que convertía al único estado terminal de fracaso en una queja de un admin
    en vez de una alarma (issue #791).
    """
    db = SessionLocal()
    try:
        agotadas = db.query(func.count()).filter(
            EnrollmentNotificacionOutbox.status == "AGOTADO"
        ).scalar()
        eliminadas = db.query(EnrollmentNotificacionOutbox).filter(
            EnrollmentNotificacionOutbox.status.in_(("ENVIADO", "AGOTADO"))
        ).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()
    if agotadas:
        logger.warning(
            "La limpieza retiró %s aviso(s) de inscripción AGOTADOS que nunca "
            "llegaron al admin",
            agotadas,
        )
    return {"eliminadas": eliminadas, "agotadas": agotadas}
