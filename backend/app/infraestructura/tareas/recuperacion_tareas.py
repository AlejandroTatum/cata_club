"""
Tarea Celery: envío del enlace de recuperación de contraseña (E01-RF003).

Delega el envío real a `ServicioNotificaciones` (SMTP configurable). Si el
broker SMTP no está configurado, la tarea falla explícitamente y Celery
reintentará según su política de retry.
"""
import logging

from app.infraestructura.notificaciones_servicio import ServicioNotificaciones
from app.infraestructura.tareas.celery_app import celery_app

logger = logging.getLogger("cataclub.tareas.recuperacion")
logger.setLevel(logging.INFO)


@celery_app.task(
    name="app.infraestructura.tareas.recuperacion_tareas.enviar_enlace_recuperacion",
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    max_retries=3,
    retry_jitter=True,
)
def enviar_enlace_recuperacion(self, correo: str, token: str) -> dict:
    """Envía el correo de recuperación con el enlace al frontend."""
    ServicioNotificaciones().enviar_recuperacion_contrasenia(correo, token)
    return {"correo": correo, "enviado": True}
