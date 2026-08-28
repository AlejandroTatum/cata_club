"""Despacho durable de enlaces de verificación de correo (issue #790)."""
from datetime import datetime, timezone
import logging

from sqlalchemy import delete, func, or_, select

from app.dominio.modelos import Usuario, VerificacionCorreoOutbox
from app.infraestructura.db import SessionLocal
from app.infraestructura.notificaciones_servicio import ServicioNotificaciones
from app.infraestructura.repositorios.verificacion_correo_outbox_repositorio import (
    VerificacionCorreoOutboxRepositorio,
)
from app.seguridad.gestor_auth import GestorAutenticacion
from app.infraestructura.tareas.celery_app import celery_app

logger = logging.getLogger("cataclub.tareas.verificacion_correo")


@celery_app.task(
    name="app.infraestructura.tareas.verificacion_correo_tareas.procesar_verificacion_correo_outbox",
)
def procesar_verificacion_correo_outbox(evento_id: int) -> dict:
    """Procesa una fila reclamada y deja el retry bajo control del outbox.

    El token se acuña ACÁ y no al aceptar la solicitud: solo esta tarea sabe
    cuándo el correo sale de verdad, y así el enlace no empieza a envejecer
    mientras la fila espera en la cola."""
    with SessionLocal() as db:
        evento = db.get(VerificacionCorreoOutbox, evento_id)
        if not evento or evento.status != "ENVIANDO":
            return {"evento_id": evento_id, "omitido": True}
        usuario = db.get(Usuario, evento.usuario_id)
        if not usuario or evento.expires_at <= datetime.now(timezone.utc):
            motivo = "el usuario ya no existe" if not usuario else "la solicitud venció"
            usuario_id = evento.usuario_id  # antes del commit: después expira
            evento.status = "AGOTADO"
            db.commit()
            logger.error(
                "Verificación de correo AGOTADO sin enviar: fila %s del usuario %s, %s",
                evento_id,
                usuario_id,
                motivo,
            )
            return {"evento_id": evento_id, "agotado": True}
        if usuario.correo_verificado:
            # La cuenta se verificó por otra vía entre el encolado y el
            # despacho (por ejemplo, un enlace anterior que sí llegó). Mandar
            # el correo igual sería ruido sin propósito, y dejar la fila viva
            # la haría reintentar para siempre.
            VerificacionCorreoOutboxRepositorio(db).mark_sent(evento)
            db.commit()
            return {"evento_id": evento_id, "enviado": False, "ya_verificado": True}
        try:
            token = GestorAutenticacion.crear_token_verificacion_correo(usuario.correo)
            ServicioNotificaciones().enviar_verificacion_correo(usuario.correo, token)
        except Exception as error:
            VerificacionCorreoOutboxRepositorio(db).requeue(evento, error)
            # `requeue` decide entre PENDIENTE y AGOTADO; se leen antes del
            # commit porque después la sesión expira los atributos.
            agotado = evento.status == "AGOTADO"
            intentos, usuario_id = evento.attempts, evento.usuario_id
            db.commit()
            if agotado:
                # AGOTADO es terminal: nadie más va a reintentar y esa cuenta
                # se queda sin poder vincular a un representado. Loguearlo
                # igual que un fallo transitorio volvería invisible el único
                # estado de fracaso definitivo (misma lección que el #764).
                logger.error(
                    "Verificación de correo AGOTADO tras %s intentos: fila %s del "
                    "usuario %s, el enlace nunca se envió y nadie va a reintentarlo",
                    intentos,
                    evento_id,
                    usuario_id,
                )
            else:
                logger.exception("Falló el envío de verificación; quedó para retry")
            return {"evento_id": evento_id, "enviado": False, "agotado": agotado}
        VerificacionCorreoOutboxRepositorio(db).mark_sent(evento)
        db.commit()
        return {"evento_id": evento_id, "enviado": True}


@celery_app.task(
    name="app.infraestructura.tareas.verificacion_correo_tareas.despachar_verificaciones_pendientes",
)
def despachar_verificaciones_pendientes() -> dict:
    """Reclama filas con lease y las entrega al worker SMTP."""
    reclamadas = 0
    with SessionLocal() as db:
        repo = VerificacionCorreoOutboxRepositorio(db)
        while True:
            evento = repo.claim_pending()
            if evento is None:
                break
            db.commit()
            procesar_verificacion_correo_outbox.delay(evento.id)
            reclamadas += 1
    return {"reclamadas": reclamadas}


@celery_app.task(
    name="app.infraestructura.tareas.verificacion_correo_tareas.limpiar_verificaciones_expiradas",
)
def limpiar_verificaciones_expiradas() -> dict:
    """Retira filas terminales vencidas, sin tocar solicitudes activas.

    Una fila `PENDIENTE` vencida es una verificación que nunca se envió, y su
    dueño está ahora mismo sin poder vincular a su hijo sin entender por qué.
    Borrarla es correcto -- el enlace ya no serviría --, pero borrarla EN
    SILENCIO es lo que convierte ese fallo en una queja de usuario en vez de
    una alarma (issue #764)."""
    now = datetime.now(timezone.utc)
    with SessionLocal() as db:
        nunca_enviadas = db.execute(
            select(func.count())
            .select_from(VerificacionCorreoOutbox)
            .where(
                VerificacionCorreoOutbox.expires_at <= now,
                VerificacionCorreoOutbox.status == "PENDIENTE",
            )
        ).scalar_one()
        resultado = db.execute(
            delete(VerificacionCorreoOutbox).where(
                VerificacionCorreoOutbox.expires_at <= now,
                or_(
                    VerificacionCorreoOutbox.status.in_(("ENVIADO", "AGOTADO")),
                    VerificacionCorreoOutbox.status == "PENDIENTE",
                ),
            )
        )
        db.commit()
        if nunca_enviadas:
            logger.warning(
                "Se retiraron %s verificaciones de correo que vencieron sin "
                "haberse enviado nunca",
                nunca_enviadas,
            )
        return {"eliminadas": resultado.rowcount, "nunca_enviadas": nunca_enviadas}
