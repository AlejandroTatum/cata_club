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
from sqlalchemy.orm import joinedload

from app.infraestructura.db import SessionLocal
from app.infraestructura.tareas.celery_app import celery_app
from app.dominio.excepciones import ServicioNoDisponible
from app.dominio.modelos import Pago, Membresia, Persona, Notificacion
from app.dominio.enums import EstadoPago, EstadoMembresia, TipoNotificacion
from app.soporte_transversal.resiliencia import CIRCUITO_SMTP_COOLDOWN_SEGUNDOS
from app.soporte_transversal.tiempo import hoy_club


logger = logging.getLogger("cataclub.tareas.alertas")
logger.setLevel(logging.INFO)


@celery_app.task(
    name="app.infraestructura.tareas.alertas_tareas.alertar_vencimientos_hoy_mas_5",
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    max_retries=3,
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
            # `Persona.usuario` se leía perezosamente dentro del loop de abajo
            # (`persona.usuario.correo`): una consulta extra por destinatario
            # (N+1). Es relación a-uno (`uselist=False`, `usuario.persona_id`
            # es UNIQUE), así que el LEFT JOIN no puede multiplicar filas y
            # `joinedload` la resuelve en el MISMO SELECT sin costo de una
            # segunda consulta (a diferencia de `selectinload`). El lote
            # sigue sin ser libre de N+1: `_ya_notificado` (más abajo) sigue
            # corriendo una vez por destinatario a propósito (idempotencia).
            .options(joinedload(Persona.usuario))
            .where(
                Pago.estado_pago == EstadoPago.APROBADO,
                Pago.fecha_fin == fecha_objetivo,
                Membresia.estado == EstadoMembresia.ACTIVA,
            )
        )
        # `.unique()` es defensiva, no obligatoria para una relación a-uno:
        # protege a este `joinedload` de fallar en silencio si en el futuro
        # `Persona.usuario` pasara a ser a-muchos.
        filas = db.execute(stmt).unique().all()

        for pago, membresia, persona in filas:
            try:
                _disparar_notificacion_vencimiento(db, persona, membresia, pago, fecha_objetivo)
                alertas_enviadas.append({
                    "pago_id": pago.id,
                    "membresia_id": membresia.id,
                    "persona_id": persona.id,
                    "vence": pago.fecha_fin.isoformat(),
                })
            except ServicioNoDisponible as exc:
                # Decisión B del diseño: el circuito SMTP ABIERTO hace fallar
                # rápido a `enviar_correo`. Sin este override, el backoff
                # exponencial por defecto de Celery (`retry_backoff=True`,
                # 0-1s/0-2s/0-4s -- ~7s peor caso) agotaría los 3 reintentos
                # DENTRO del cooldown del circuito y el lote del día se
                # perdería. `self.retry(countdown=...)` alinea el reintento
                # al cooldown en vez del backoff exponencial; `max_retries`
                # no cambia -- el decorador lo sigue fijando en 3, y
                # `autoretry_for` re-lanza un `Retry` sin tocarlo (ver
                # `celery/app/autoretry.py`), así que `test_celery_tope_de_
                # reintentos.py` queda intacto. La dedup de la fase 1.4 hace
                # que el reintento retome donde el intento anterior se quedó.
                logger.warning(
                    "Circuito SMTP abierto durante el lote (pago_id=%s); "
                    "reintentando en %.0fs",
                    pago.id, CIRCUITO_SMTP_COOLDOWN_SEGUNDOS,
                )
                raise self.retry(exc=exc, countdown=CIRCUITO_SMTP_COOLDOWN_SEGUNDOS)
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


def _ya_notificado(db, persona_id: int, pago_id: int) -> bool:
    """Dedup de idempotencia: ¿ya existe una notificación de vencimiento para
    este destinatario y este pago? Clave `(tipo, persona_id,
    entidad_relacionada_id=pago.id)`, migración-free (`Notificacion.
    entidad_relacionada_id` ya es nullable y sin FK, ver `modelos.py`)."""
    return db.execute(
        select(Notificacion.id).where(
            Notificacion.tipo == TipoNotificacion.MIEMBRESIA_VENCIMIENTO_PROXIMO,
            Notificacion.persona_id == persona_id,
            Notificacion.entidad_relacionada_id == pago_id,
        )
    ).first() is not None


def _disparar_notificacion_vencimiento(
    db, persona: Persona, membresia: Membresia, pago: Pago, vence: date
) -> None:
    """Crea notificaciones in-app para el alumno (y su representante si
    existe) y envía un correo electrónico real si SMTP está configurado.

    Orden deliberado (Decisión A del diseño): se lee y se deduplica sobre la
    sesión EXTERNA del lote (`db`, la abierta por `alertar_vencimientos_hoy_
    mas_5`) -- eso además elimina el `refresh` entre sesiones distintas que
    causaba `InvalidRequestError`. El envío ocurre SIN transacción abierta.
    Recién si el envío tiene éxito (o no aplica) se abre una sesión corta
    para insertar y commitear las filas con `entidad_relacionada_id=pago.id`.
    Así la fila commiteada significa "en-app registrado Y correo enviado" en
    vez de solo "en-app registrado" -- se acepta una ventana de milisegundos
    de duplicado ante una caída justo después del envío, a cambio de eliminar
    la pérdida silenciosa y permanente de la alerta."""
    alumno_pendiente = not _ya_notificado(db, persona.id, pago.id)
    representante_pendiente = bool(persona.representante_id) and not _ya_notificado(
        db, persona.representante_id, pago.id
    )

    if not alumno_pendiente and not representante_pendiente:
        return  # ya procesado por completo en un intento anterior

    filas_pendientes: list[Notificacion] = []

    if alumno_pendiente:
        filas_pendientes.append(Notificacion(
            tipo=TipoNotificacion.MIEMBRESIA_VENCIMIENTO_PROXIMO,
            mensaje=f"Tu membresía vence el {vence.strftime('%d/%m/%Y')}.",
            persona_id=persona.id,
            entidad_relacionada_id=pago.id,
        ))

        if persona.usuario:
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
        else:
            logger.warning(
                "persona_id=%s no tiene usuario vinculado — email omitido", persona.id
            )

    if representante_pendiente:
        filas_pendientes.append(Notificacion(
            tipo=TipoNotificacion.MIEMBRESIA_VENCIMIENTO_PROXIMO,
            mensaje=(
                f"La membresía de {persona.nombres} {persona.apellidos} "
                f"vence el {vence.strftime('%d/%m/%Y')}."
            ),
            persona_id=persona.representante_id,
            entidad_relacionada_id=pago.id,
        ))

    with SessionLocal() as db_escritura:
        db_escritura.add_all(filas_pendientes)
        db_escritura.commit()
