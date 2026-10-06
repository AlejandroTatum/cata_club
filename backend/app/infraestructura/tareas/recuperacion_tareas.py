"""Despacho durable de enlaces de recuperación de contraseña.

La mecánica de la cola -- lease, backoff, `AGOTADO`, limpieza -- vive en
`outbox_despacho`, compartida con las otras colas del club (issue #790). Acá
queda solo lo propio de ESTA: a quién se le escribe y qué se le manda.
"""
import logging

from sqlalchemy.orm import object_session

from app.dominio.invitacion_co_representante import PROPOSITO_INVITACION_CO_REPRESENTANTE
from app.dominio.invitacion_entrenador import (
    PROPOSITO_INVITACION_ENTRENADOR, invitacion_pendiente,
)
from app.dominio.modelos import RecuperacionOutbox, Usuario
from app.infraestructura.db import SessionLocal
from app.infraestructura.notificaciones_servicio import ServicioNotificaciones
from app.infraestructura.repositorios.co_representante_repositorio import CoRepresentanteRepositorio
from app.infraestructura.repositorios.recuperacion_outbox_repositorio import (
    RecuperacionOutboxRepositorio,
)
from app.infraestructura.tareas import outbox_despacho
from app.seguridad.gestor_auth import GestorAutenticacion
from app.infraestructura.tareas.celery_app import celery_app

logger = logging.getLogger("cataclub.tareas.recuperacion")

ETIQUETA = "Recuperación"


# `enviar_enlace_recuperacion` vivía acá: recibía (correo, token) y llamaba a
# `ServicioNotificaciones`. La migración al outbox durable la dejó sin ningún
# llamador -- el procesamiento acuña el token él mismo porque solo él sabe
# cuándo se envía de verdad -- pero la tarea quedó registrada, y
# `test_recuperacion_honesta.py` siguió parcheando su `.delay` para "simular
# un broker caído" sobre un camino que ya no la tocaba: un mock obsoleto
# encima de la única costura sin cobertura (issue #764). Se retira para que
# nadie vuelva a confundirla con el camino de envío.


def _enviar_enlace(usuario: Usuario) -> None:
    """El token se acuña al ENVIAR y nunca se persiste. Lleva la versión
    actual de la contraseña, que es lo que lo invalida tras un
    restablecimiento exitoso (single-use)."""
    notificaciones = ServicioNotificaciones(levantar_si_cupo_agotado=True)
    if invitacion_pendiente(usuario):
        # Issue #1575: el entrenador creado por el administrador recibe la
        # invitación por esta misma cola; su token lleva el propósito que
        # permite verificar el correo al fijar la contraseña.
        token = GestorAutenticacion.crear_token_recuperacion(
            usuario.correo, usuario.version_contrasenia,
            proposito=PROPOSITO_INVITACION_ENTRENADOR,
        )
        notificaciones.enviar_invitacion_entrenador(
            usuario.correo, token, usuario.persona.nombres,
        )
        return
    sesion = object_session(usuario)
    invitaciones = CoRepresentanteRepositorio(sesion).listar_pendientes_de_cuenta(usuario.persona_id)
    if invitaciones and not usuario.correo_verificado:
        # Issue #1666: la cuenta del segundo guardián la creó una invitación;
        # mismo mecanismo y mismo token que la del entrenador, con otro
        # propósito. Los menores van solo por nombre de pila.
        from app.dominio.modelos import Persona
        menores = [sesion.get(Persona, i.persona_id).nombres for i in invitaciones]
        invitante = sesion.get(Persona, invitaciones[0].invitada_por_persona_id)
        token = GestorAutenticacion.crear_token_recuperacion(
            usuario.correo, usuario.version_contrasenia,
            proposito=PROPOSITO_INVITACION_CO_REPRESENTANTE,
        )
        notificaciones.enviar_invitacion_co_representante(
            usuario.correo, token, usuario.persona.nombres,
            nombre_menor=" y ".join(menores) if len(menores) <= 2 else ", ".join(menores),
            nombre_invitante=f"{invitante.nombres} {invitante.apellidos}",
        )
        return
    token = GestorAutenticacion.crear_token_recuperacion(
        usuario.correo, usuario.version_contrasenia
    )
    notificaciones.enviar_recuperacion_contrasenia(usuario.correo, token)


@celery_app.task(
    name="app.infraestructura.tareas.recuperacion_tareas.procesar_recuperacion_outbox",
)
def procesar_recuperacion_outbox(evento_id: int) -> dict:
    return outbox_despacho.entregar_fila(
        abrir_sesion=SessionLocal,
        modelo=RecuperacionOutbox,
        repositorio=RecuperacionOutboxRepositorio,
        logger=logger,
        etiqueta=ETIQUETA,
        evento_id=evento_id,
        cargar_destinatario=lambda db, evento: db.get(Usuario, evento.usuario_id),
        entregar=_enviar_enlace,
    )


@celery_app.task(
    name="app.infraestructura.tareas.recuperacion_tareas.despachar_recuperaciones_pendientes",
)
def despachar_recuperaciones_pendientes() -> dict:
    return outbox_despacho.reclamar_y_publicar(
        SessionLocal,
        RecuperacionOutboxRepositorio,
        procesar_recuperacion_outbox.delay,
    )


@celery_app.task(
    name="app.infraestructura.tareas.recuperacion_tareas.limpiar_recuperaciones_expiradas",
)
def limpiar_recuperaciones_expiradas() -> dict:
    """Una fila `PENDIENTE` vencida es una recuperación que el usuario pidió y
    que jamás se envió; a las 24 horas el enlace ya no sirve, pero borrarla en
    silencio era lo que borraba la evidencia del fallo (issue #764)."""
    return outbox_despacho.limpiar_vencidas(
        abrir_sesion=SessionLocal,
        modelo=RecuperacionOutbox,
        logger=logger,
        mensaje_nunca_enviadas=(
            "Se borraron %s solicitudes de recuperación en PENDIENTE que "
            "vencieron sin enviarse: el despachador nunca las reclamó"
        ),
    )
