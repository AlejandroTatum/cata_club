import logging

from sqlalchemy import func

from app.dominio.enums import TipoNotificacion
from app.dominio.excepciones import ServicioNoDisponible
from app.dominio.modelos import EnrollmentNotificacionOutbox, Notificacion, Persona
from app.infraestructura.db import SessionLocal
from app.infraestructura.notificaciones_servicio import ServicioNotificaciones
from app.infraestructura.repositorios.enrollment_notificacion_outbox_repositorio import EnrollmentNotificacionOutboxRepositorio
from app.infraestructura.tareas import outbox_despacho
from app.infraestructura.tareas.celery_app import celery_app

logger = logging.getLogger("cataclub.tareas.enrollment_notificacion")


def _enviar_bienvenida_al_alumno(db, event: EnrollmentNotificacionOutbox) -> None:
    """Correo de bienvenida al alumno, UNA sola vez por inscripción.

    El outbox tiene una fila por administrador (`EnrollmentServicio.
    _notificar_nueva_inscripcion` encola un aviso por cada admin), así que
    enviar desde cada entrega mandaría N correos idénticos al mismo alumno.
    Manda solo la fila LÍDER -- la de menor `id` para ese alumno. Es una
    elección que NO depende del orden de entrega ni del timing: dos workers
    concurrentes calculan el mismo líder, así que el alumno recibe un correo
    y nada más.

    Best-effort a propósito: cuando esto corre, el aviso in-app del admin ya
    está commiteado y la fila marcada `ENVIADO` -- la entrega durable de esta
    cola es ese aviso, no el correo. Por eso un SMTP sin configurar, un fallo
    de transporte o un rechazo permanente (issue #837) se loguean y la fila
    NO vuelve a la cola: reencolarla reenviaría un aviso que ya se entregó y
    expiraría la inscripción sin ninguna ganancia. Tampoco se reintenta el
    correo en la entrega repetida (`existente` sale antes), justamente para
    no duplicarlo.

    El destinatario es la cuenta de la propia persona
    (`persona.usuario.correo`): un alumno sin cuenta se queda sin correo y
    eso se loguea, nunca se inventa una dirección. El log no escribe el
    correo completo (issue #1066) ni el mensaje de la excepción, que trae el
    destinatario en su texto.
    """
    lider_id = db.query(func.min(EnrollmentNotificacionOutbox.id)).filter(
        EnrollmentNotificacionOutbox.alumno_persona_id == event.alumno_persona_id
    ).scalar()
    if event.id != lider_id:
        return
    alumno = db.get(Persona, event.alumno_persona_id)
    if alumno is None or alumno.usuario is None:
        logger.warning(
            "Correo de bienvenida omitido: alumno persona_id=%s no tiene cuenta "
            "con correo",
            event.alumno_persona_id,
        )
        return
    try:
        ServicioNotificaciones().enviar_bienvenida_inscripcion(
            alumno.usuario.correo, alumno.nombres,
        )
    except (RuntimeError, ServicioNoDisponible) as exc:
        logger.warning(
            "Correo de bienvenida no enviado a persona_id=%s: %s",
            event.alumno_persona_id, type(exc).__name__,
        )


@celery_app.task(name="app.infraestructura.tareas.enrollment_notificacion_tareas.despachar_inscripcion_notificaciones")
def despachar_inscripcion_notificaciones():
    """Reclama hasta un lote de avisos y publica la entrega de cada uno.

    El bucle se conserva acá en vez de delegar en
    `outbox_despacho.reclamar_y_publicar` (issue #841): esta cola ATRAPA el
    fallo de `.delay`, lo loguea y CONTINÚA, mientras que el helper lo deja
    escapar y corta la corrida. Son dos decisiones distintas frente a un
    broker caído, y unificarlas cambiaría el comportamiento de una de las dos
    sin que nada lo pidiera. Lo que sí se comparte es el techo del lote, que
    es un número, no una semántica.

    Ese techo importa especialmente acá: al tragarse el fallo, un broker caído
    hacía que esta corrida recorriera la tabla ENTERA gastando un intento por
    fila -- de los seis que hay antes de `AGOTADO` -- sin entregar ninguna.
    Ahora quema como mucho un lote por tick.
    """
    tope = outbox_despacho.tope_de_lote()
    reclamadas = 0
    with SessionLocal() as db:
        repo = EnrollmentNotificacionOutboxRepositorio(db)
        while reclamadas < tope:
            event = repo.claim_pending()
            if not event:
                break
            db.commit()
            try:
                entregar_inscripcion_notificacion.delay(event.id)
            except Exception as exc:
                logger.warning("No se pudo encolar la entrega %s: %s", event.id, type(exc).__name__)
            reclamadas += 1
    return outbox_despacho.resultado_de_despacho(reclamadas, tope)


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
        _enviar_bienvenida_al_alumno(db, event)
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
