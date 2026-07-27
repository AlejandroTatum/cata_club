"""
Tarea Celery Beat diaria: Alertas de Vencimiento de Membresías.

Regla de negocio:
    Cada noche se buscan pagos APROBADOS cuyo `fecha_fin` sea exactamente HOY + 5
    días, y se dispara una alerta/notificación asociada a la membresía vigente.

Justificación del modelo:
    `Membresia` NO tiene `fecha_vencimiento` propio (decisión de diseño: reusar
    `Pago.fecha_fin` como vigencia). Por eso la query se hace sobre Pago, no
    sobre Membresia. Se filtra por `EstadoPago.APROBADO` y se une a la membresía
    ACTIVA para no alertar sobre pagos rechazados/pendientes.

Notificaciones:
    Esta tarea NO conoce SMTP ni WhatsApp. Llama a un `ServicioNotificaciones`
    que es el adaptador de mensajería. Mientras ese adaptador no exista o éste
    sea un dry-run, se persiste un log estructurado que simula la notificación.
"""
from datetime import date, timedelta
import logging

from sqlalchemy import select

from app.infraestructura.db import SessionLocal
from app.infraestructura.tareas.celery_app import celery_app
from app.dominio.modelos import Pago, Membresia, Persona
from app.dominio.enums import EstadoPago, EstadoMembresia
from app.soporte_transversal.tiempo import hoy_club


logger = logging.getLogger("cataclub.tareas.alertas")
logger.setLevel(logging.INFO)


@celery_app.task(
    name="app.infraestructura.tareas.alertas_tareas.alertar_vencimientos_hoy_mas_5",
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_max=3,
    retry_jitter=True,
)
def alertar_vencimientos_hoy_mas_5(self) -> dict:
    """
    Ejecución diaria: alerta a los alumnos cuyas membresías vencen en 5 días.

    Returns:
        dict con resumen ejecutable de la corrida (snapshot útil para logging
        y para mostrar en un panel de salud del systema).
    """
    # Día del CLUB, no del contenedor (mismo criterio que
    # `vencimientos_tareas.py`): la ventana "hoy + 5 días" se compara contra
    # `Pago.fecha_fin`, una fecha de calendario del club, y Celery Beat ya
    # planifica en `America/Guayaquil`.
    hoy = hoy_club()
    fecha_objetivo = hoy + timedelta(days=5)

    alertas_enviadas: list[dict] = []

    with SessionLocal() as db:
        stmt = (
            select(Pago, Membresia, Persona)
            .join(Membresia, Membresia.id == Pago.membresia_id)
            .join(Persona, Persona.id == Pago.persona_id)
            .where(
                Pago.estado_pago == EstadoPago.APROBADO,
                Pago.fecha_fin == fecha_objetivo,
                Membresia.estado == EstadoMembresia.ACTIVA,
            )
        )
        filas = db.execute(stmt).all()

        for pago, membresia, persona in filas:
            try:
                _disparar_notificacion_vencimiento(persona, membresia, pago, fecha_objetivo)
                alertas_enviadas.append({
                    "pago_id": pago.id,
                    "membresia_id": membresia.id,
                    "persona_id": persona.id,
                    "vence": pago.fecha_fin.isoformat(),
                })
            except Exception:
                logger.exception(
                    "Fallo notificando vencimiento (pago_id=%s)", pago.id
                )
                raise

    logger.info(
        "Alertas vencimiento %s -> %d notificaciones enviadas",
        fecha_objetivo.isoformat(),
        len(alertas_enviadas),
    )
    return {
        "fecha_objetivo": fecha_objetivo.isoformat(),
        "total_alertas": len(alertas_enviadas),
        "alertas": alertas_enviadas,
    }


def _disparar_notificacion_vencimiento(
    persona: Persona, membresia: Membresia, pago: Pago, vence: date
) -> None:
    """Crea notificaciones in-app para el alumno (y su representante si existe),
    y envía un correo electrónico real si SMTP está configurado."""
    from app.dominio.modelos import Notificacion
    from app.dominio.enums import TipoNotificacion

    with SessionLocal() as db:
        notif_alumno = Notificacion(
            tipo=TipoNotificacion.MIEMBRESIA_VENCIMIENTO_PROXIMO,
            mensaje=f"Tu membresía vence el {vence.strftime('%d/%m/%Y')}.",
            persona_id=persona.id,
        )
        db.add(notif_alumno)

        if persona.representante_id:
            notif_rep = Notificacion(
                tipo=TipoNotificacion.MIEMBRESIA_VENCIMIENTO_PROXIMO,
                mensaje=f"La membresía de {persona.nombres} {persona.apellidos} vence el {vence.strftime('%d/%m/%Y')}.",
                persona_id=persona.representante_id,
            )
            db.add(notif_rep)

        db.commit()
        db.refresh(persona, ["usuario"])

    if not persona.usuario:
        logger.warning("persona_id=%s no tiene usuario vinculado — email omitido", persona.id)
        return

    try:
        from app.infraestructura.notificaciones_servicio import ServicioNotificaciones
        svc = ServicioNotificaciones()
        svc.enviar_correo(
            destinatario=persona.usuario.correo,
            asunto="Vencimiento de membresía - Cata Club",
            cuerpo_texto=(
                f"Hola {persona.nombres},\n\n"
                f"Tu membresía vence el {vence.strftime('%d/%m/%Y')}. "
                f"Por favor, regulariza tu pago para evitar la suspensión de beneficios."
            ),
        )
    except RuntimeError:
        logger.warning(
            "SMTP no configurado — email no enviado para persona_id=%s", persona.id
        )
