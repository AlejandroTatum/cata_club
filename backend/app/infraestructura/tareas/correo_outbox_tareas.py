"""Despacho durable de correos ya armados (issue #1710).

La mecánica de la cola -- lease, backoff, `AGOTADO`, diferimiento por cupo,
limpieza -- vive en `outbox_despacho`, compartida con las otras colas. Acá
queda solo lo propio de ESTA: la fila ya trae el mensaje completo, así que
entregarla es mandarlo tal cual.
"""
import logging

from app.dominio.modelos import CorreoOutbox
from app.infraestructura.db import SessionLocal
from app.infraestructura.notificaciones_servicio import ServicioNotificaciones
from app.infraestructura.repositorios.correo_outbox_repositorio import CorreoOutboxRepositorio
from app.infraestructura.tareas import outbox_despacho
from app.infraestructura.tareas.celery_app import celery_app

logger = logging.getLogger("cataclub.tareas.correo_outbox")

ETIQUETA = "Correo encolado"


def _entregar(fila: CorreoOutbox) -> None:
    ServicioNotificaciones(levantar_si_cupo_agotado=True).enviar_correo(
        destinatario=fila.destinatario,
        asunto=fila.asunto,
        cuerpo_texto=fila.cuerpo_texto,
        cuerpo_html=fila.cuerpo_html,
    )


@celery_app.task(
    name="app.infraestructura.tareas.correo_outbox_tareas.procesar_correo_outbox",
)
def procesar_correo_outbox(evento_id: int) -> dict:
    return outbox_despacho.entregar_fila(
        abrir_sesion=SessionLocal,
        modelo=CorreoOutbox,
        repositorio=CorreoOutboxRepositorio,
        logger=logger,
        etiqueta=ETIQUETA,
        evento_id=evento_id,
        # El destinatario es la fila misma: trae dirección y mensaje.
        cargar_destinatario=lambda _db, evento: evento,
        entregar=_entregar,
    )


@celery_app.task(
    name="app.infraestructura.tareas.correo_outbox_tareas.despachar_correos_pendientes",
)
def despachar_correos_pendientes() -> dict:
    return outbox_despacho.reclamar_y_publicar(
        SessionLocal,
        CorreoOutboxRepositorio,
        procesar_correo_outbox.delay,
    )


@celery_app.task(
    name="app.infraestructura.tareas.correo_outbox_tareas.limpiar_correos_vencidos",
)
def limpiar_correos_vencidos() -> dict:
    """Retira filas vencidas: las enviadas ya no hacen falta y guardan datos
    personales; las pendientes nunca salieron, y eso se avisa."""
    return outbox_despacho.limpiar_vencidas(
        abrir_sesion=SessionLocal,
        modelo=CorreoOutbox,
        logger=logger,
        mensaje_nunca_enviadas=(
            "Se retiraron %s correos encolados que vencieron sin haberse "
            "enviado nunca"
        ),
    )
