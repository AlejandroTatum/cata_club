"""Despacho durable de enlaces de verificación de correo (issue #790).

La mecánica de la cola -- lease, backoff, `AGOTADO`, limpieza -- vive en
`outbox_despacho`, compartida con las otras colas del club. Acá queda solo lo
que es propio de ESTA: a quién se le escribe, qué se le manda, y cuándo no
hace falta mandarle nada.
"""
import logging

from app.dominio.modelos import Usuario, VerificacionCorreoOutbox
from app.infraestructura.db import SessionLocal
from app.infraestructura.notificaciones_servicio import ServicioNotificaciones
from app.infraestructura.repositorios.verificacion_correo_outbox_repositorio import (
    VerificacionCorreoOutboxRepositorio,
)
from app.infraestructura.tareas import outbox_despacho
from app.seguridad.gestor_auth import GestorAutenticacion
from app.infraestructura.tareas.celery_app import celery_app

logger = logging.getLogger("cataclub.tareas.verificacion_correo")

ETIQUETA = "Verificación de correo"


def _enviar_enlace(usuario: Usuario) -> None:
    """El token se acuña ACÁ y no al aceptar la solicitud: solo el momento del
    envío sabe cuándo el correo sale de verdad, así el enlace no empieza a
    envejecer mientras la fila espera en la cola. Nunca se persiste."""
    token = GestorAutenticacion.crear_token_verificacion_correo(usuario.correo)
    ServicioNotificaciones().enviar_verificacion_correo(usuario.correo, token)


@celery_app.task(
    name="app.infraestructura.tareas.verificacion_correo_tareas.procesar_verificacion_correo_outbox",
)
def procesar_verificacion_correo_outbox(evento_id: int) -> dict:
    return outbox_despacho.entregar_fila(
        abrir_sesion=SessionLocal,
        modelo=VerificacionCorreoOutbox,
        repositorio=VerificacionCorreoOutboxRepositorio,
        logger=logger,
        etiqueta=ETIQUETA,
        evento_id=evento_id,
        cargar_destinatario=lambda db, evento: db.get(Usuario, evento.usuario_id),
        entregar=_enviar_enlace,
        # La cuenta pudo verificarse por otra vía entre el encolado y el
        # despacho (por ejemplo, un enlace anterior que sí llegó). Mandar el
        # correo igual sería ruido sin propósito.
        omitir=lambda usuario: usuario.correo_verificado,
    )


@celery_app.task(
    name="app.infraestructura.tareas.verificacion_correo_tareas.despachar_verificaciones_pendientes",
)
def despachar_verificaciones_pendientes() -> dict:
    return outbox_despacho.reclamar_y_publicar(
        SessionLocal,
        VerificacionCorreoOutboxRepositorio,
        procesar_verificacion_correo_outbox.delay,
    )


@celery_app.task(
    name="app.infraestructura.tareas.verificacion_correo_tareas.limpiar_verificaciones_expiradas",
)
def limpiar_verificaciones_expiradas() -> dict:
    """Una fila `PENDIENTE` vencida deja a su dueño sin poder vincular a su
    hijo, y sin entender por qué: por eso el borrado avisa."""
    return outbox_despacho.limpiar_vencidas(
        abrir_sesion=SessionLocal,
        modelo=VerificacionCorreoOutbox,
        logger=logger,
        mensaje_nunca_enviadas=(
            "Se retiraron %s verificaciones de correo que vencieron sin "
            "haberse enviado nunca"
        ),
    )
