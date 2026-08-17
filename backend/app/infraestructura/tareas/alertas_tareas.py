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
from datetime import date, datetime, time, timedelta
import logging

from sqlalchemy import func, select
from sqlalchemy.orm import joinedload

from app.infraestructura.db import SessionLocal
from app.infraestructura.tareas.celery_app import celery_app
from app.dominio.excepciones import ServicioNoDisponible
from app.dominio.modelos import Pago, Membresia, Persona, Notificacion, Rol, Usuario
from app.dominio.enums import EstadoPago, EstadoMembresia, TipoNotificacion, TipoRol
from app.servicios_negocio.notificacion_servicio import acortar_nombre_para_notificacion
from app.servicios_negocio.membresia_pago_servicio import _meses_enteros_desde
from app.soporte_transversal.resiliencia import CIRCUITO_SMTP_COOLDOWN_SEGUNDOS
from app.soporte_transversal.tiempo import ZONA_HORARIA_CLUB, hoy_club


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


def _ya_notificado(
    db,
    persona_id: int,
    pago_id: int,
    tipo: TipoNotificacion = TipoNotificacion.MIEMBRESIA_VENCIMIENTO_PROXIMO,
) -> bool:
    """Dedup de idempotencia: ¿ya existe una notificación de `tipo` para este
    destinatario y este pago? Clave `(tipo, persona_id,
    entidad_relacionada_id=pago.id)`, migración-free (`Notificacion.
    entidad_relacionada_id` ya es nullable y sin FK, ver `modelos.py`).

    `tipo` es parametrizable a propósito: el mismo pago puede recibir avisos
    distintos (ej. día 1 vs día 8 de mora) sin que la clave de dedup los
    confunda."""
    return db.execute(
        select(Notificacion.id).where(
            Notificacion.tipo == tipo,
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
            mensaje=f"Su membresía vence el {vence.strftime('%d/%m/%Y')}.",
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
                        f"Su membresía vence el {vence.strftime('%d/%m/%Y')}. "
                        f"Por favor, regularice su pago para evitar la suspensión de beneficios."
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
        nombre_alumno = acortar_nombre_para_notificacion(f"{persona.nombres} {persona.apellidos}")
        filas_pendientes.append(Notificacion(
            tipo=TipoNotificacion.MIEMBRESIA_VENCIMIENTO_PROXIMO,
            mensaje=(
                f"La membresía de {nombre_alumno} "
                f"vence el {vence.strftime('%d/%m/%Y')}."
            ),
            persona_id=persona.representante_id,
            entidad_relacionada_id=pago.id,
        ))

    with SessionLocal() as db_escritura:
        db_escritura.add_all(filas_pendientes)
        db_escritura.commit()


def _rango_dia_club(hoy: date) -> tuple[datetime, datetime]:
    """Devuelve (inicio, fin) del día del club `hoy` como instantes aware.

    `Notificacion.fecha_creacion` es un `timestamptz` (UTC); para deduplicar el
    resumen de mora "una vez por administrador por DÍA del club" hay que
    comparar contra la ventana del día en `America/Guayaquil`, no contra el día
    UTC."""
    inicio = datetime.combine(hoy, time.min, tzinfo=ZONA_HORARIA_CLUB)
    return inicio, inicio + timedelta(days=1)


def _disparar_notificacion_mora(
    db, persona: Persona, pago_id: int, fecha_vencimiento: date, tipo: TipoNotificacion
) -> bool:
    """Crea notificaciones in-app de mora para el alumno (y su representante si
    existe) y envía un correo real si SMTP está configurado. Devuelve True solo
    si al menos una notificación fue emitida (la dedup de familia ya pasó).

    Mismo orden que `_disparar_notificacion_vencimiento` (Decisión A): dedup
    sobre la sesión externa, envío sin transacción, y commit corto recién cuando
    el envío tuvo éxito o no aplica. `RuntimeError` (SMTP no configurado) se
    loguea y se sigue; `ServicioNoDisponible` (circuito SMTP abierto) propaga
    para que el lote reintente con el countdown del circuito."""
    alumno_pendiente = not _ya_notificado(db, persona.id, pago_id, tipo)
    representante_pendiente = bool(persona.representante_id) and not _ya_notificado(
        db, persona.representante_id, pago_id, tipo
    )

    if not alumno_pendiente and not representante_pendiente:
        return False

    fecha_str = fecha_vencimiento.strftime("%d/%m/%Y")
    if tipo == TipoNotificacion.MIEMBRESIA_MORA_DIA_1:
        mensaje = (
            f"Su membresía venció el {fecha_str}. Regularice su pago para no "
            f"perder los beneficios."
        )
    else:
        mensaje = (
            "Su membresía sigue vencida. Este es el último aviso: regularice su "
            "pago para reactivar sus beneficios."
        )

    filas_pendientes: list[Notificacion] = []

    if alumno_pendiente:
        filas_pendientes.append(Notificacion(
            tipo=tipo,
            mensaje=mensaje,
            persona_id=persona.id,
            entidad_relacionada_id=pago_id,
        ))

        if persona.usuario:
            try:
                from app.infraestructura.notificaciones_servicio import ServicioNotificaciones
                svc = ServicioNotificaciones()
                svc.enviar_correo(
                    destinatario=persona.usuario.correo,
                    asunto="Aviso de mora - Cata Club",
                    cuerpo_texto=f"Hola {persona.nombres},\n\n{mensaje}",
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
        nombre_alumno = acortar_nombre_para_notificacion(f"{persona.nombres} {persona.apellidos}")
        filas_pendientes.append(Notificacion(
            tipo=tipo,
            mensaje=f"Para {nombre_alumno}: {mensaje}",
            persona_id=persona.representante_id,
            entidad_relacionada_id=pago_id,
        ))

    with SessionLocal() as db_escritura:
        db_escritura.add_all(filas_pendientes)
        db_escritura.commit()

    return True


def _listar_administradores(db) -> list[Usuario]:
    """Usuarios ACTIVOS con rol ADMINISTRADOR (mismo criterio que
    `UsuarioRepositorio.contar_administradores_activos`)."""
    return (
        db.query(Usuario)
        .join(Usuario.roles)
        .filter(Rol.tipo_rol == TipoRol.ADMINISTRADOR, Usuario.activo.is_(True))
        .options(joinedload(Usuario.persona))
        .all()
    )


def _ya_notificado_admin_hoy(
    db, persona_id: int, inicio_dia: datetime, fin_dia: datetime
) -> bool:
    """Dedup del resumen diario: ¿ya existe un RESUMEN_MORA_ADMIN para este
    administrador dentro del día del club actual?"""
    return db.execute(
        select(Notificacion.id).where(
            Notificacion.tipo == TipoNotificacion.RESUMEN_MORA_ADMIN,
            Notificacion.persona_id == persona_id,
            Notificacion.fecha_creacion >= inicio_dia,
            Notificacion.fecha_creacion < fin_dia,
        )
    ).first() is not None


def _formatear_resumen_mora(hoy: date, morosos: list[dict]) -> str:
    """Arma el texto del resumen diario de mora para el administrador."""
    partes = []
    for moroso in morosos:
        nombre = acortar_nombre_para_notificacion(moroso["nombre"])
        partes.append(f"{nombre} ({moroso['meses_adeudados']} meses, ${moroso['monto_mensual']})")
    return (
        f"Mora del {hoy.strftime('%d/%m/%Y')}: {len(morosos)} miembros — "
        + ", ".join(partes)
    )


def _disparar_resumen_admin(
    db, admin_usuario: Usuario, resumen: str, inicio_dia: datetime, fin_dia: datetime
) -> bool:
    """Crea el RESUMEN_MORA_ADMIN in-app y envía el correo al administrador.

    Dedup por administrador por día; `ServicioNoDisponible` (circuito SMTP
    abierto) propaga al lote para reintentar con el countdown del circuito, igual
    que la rama de familia."""
    admin_persona = admin_usuario.persona
    if _ya_notificado_admin_hoy(db, admin_persona.id, inicio_dia, fin_dia):
        return False

    fila = Notificacion(
        tipo=TipoNotificacion.RESUMEN_MORA_ADMIN,
        mensaje=resumen,
        persona_id=admin_persona.id,
    )

    try:
        from app.infraestructura.notificaciones_servicio import ServicioNotificaciones
        svc = ServicioNotificaciones()
        svc.enviar_correo(
            destinatario=admin_usuario.correo,
            asunto=f"Resumen de mora - Cata Club ({inicio_dia.strftime('%d/%m/%Y')})",
            cuerpo_texto=resumen,
        )
    except RuntimeError:
        logger.warning(
            "SMTP no configurado — email de resumen no enviado para admin persona_id=%s",
            admin_persona.id,
        )

    with SessionLocal() as db_escritura:
        db_escritura.add(fila)
        db_escritura.commit()

    return True


@celery_app.task(
    name="app.infraestructura.tareas.alertas_tareas.alertar_mora_diaria",
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    max_retries=3,
    retry_jitter=True,
)
def alertar_mora_diaria(self) -> dict:
    """Ejecución diaria: avisos de mora de membresía (día 1 y día 8) y resumen
    al administrador.

    Regla (issue #285): una familia recibe exactamente DOS avisos tras vencer la
    membresía sin un pago aprobado — el día 1 y el día 8 desde el vencimiento.
    El día 15 y en adelante: silencio. Registrar un pago aprobado que extiende la
    cobertura detiene los avisos pendientes (`ultima_fecha_fin < hoy` deja de
    matchear). Correr dos veces el mismo día no duplica: la dedup de familia
    `(tipo, persona_id, pago_id)` y la dedup del resumen por admin/día lo cubren.

    Corre DESPUÉS de `marcar_membresias_vencidas` (02:35), así que las
    membresías expiradas ya están VENCIDA cuando este scan las lee."""
    hoy = hoy_club()
    avisos_familia: list[dict] = []
    resumen_admin_enviado = False

    with SessionLocal() as db:
        # Último pago APROBADO por membresía (su id y su fecha_fin), resolviendo
        # el empate por fecha_fin con `id DESC` para elegir un pago determinista.
        # Es el mismo criterio "última cobertura aprobada" que
        # `marcar_membresias_vencidas`, pero además trae el `pago_id` para usarlo
        # como `entidad_relacionada_id` de las notificaciones.
        ultimo_pago = (
            select(
                Pago.membresia_id.label("membresia_id"),
                Pago.id.label("pago_id"),
                Pago.fecha_fin.label("ultima_fecha_fin"),
                func.row_number()
                .over(
                    partition_by=Pago.membresia_id,
                    order_by=(Pago.fecha_fin.desc(), Pago.id.desc()),
                )
                .label("rn"),
            )
            .where(Pago.estado_pago == EstadoPago.APROBADO)
            .subquery()
        )

        stmt = (
            select(Membresia, Persona, ultimo_pago.c.pago_id, ultimo_pago.c.ultima_fecha_fin)
            .join(ultimo_pago, ultimo_pago.c.membresia_id == Membresia.id)
            .join(Persona, Persona.id == Membresia.persona_id)
            .options(joinedload(Persona.usuario))
            .where(
                Membresia.estado != EstadoMembresia.INACTIVA,
                ultimo_pago.c.rn == 1,
                ultimo_pago.c.ultima_fecha_fin < hoy,
            )
        )
        filas = db.execute(stmt).unique().all()

        for membresia, persona, pago_id, ultima_fecha_fin in filas:
            dias = (hoy - ultima_fecha_fin).days
            if dias == 1:
                tipo = TipoNotificacion.MIEMBRESIA_MORA_DIA_1
            elif dias == 8:
                tipo = TipoNotificacion.MIEMBRESIA_MORA_DIA_8
            else:
                continue

            try:
                enviado = _disparar_notificacion_mora(
                    db, persona, pago_id, ultima_fecha_fin, tipo
                )
            except ServicioNoDisponible as exc:
                logger.warning(
                    "Circuito SMTP abierto durante el lote de mora (pago_id=%s); "
                    "reintentando en %.0fs",
                    pago_id, CIRCUITO_SMTP_COOLDOWN_SEGUNDOS,
                )
                raise self.retry(exc=exc, countdown=CIRCUITO_SMTP_COOLDOWN_SEGUNDOS)
            except Exception:
                logger.exception("Fallo notificando mora (pago_id=%s)", pago_id)
                raise

            if enviado:
                avisos_familia.append({
                    "pago_id": pago_id,
                    "membresia_id": membresia.id,
                    "persona_id": persona.id,
                    "tipo": tipo.value,
                    "dias_mora": dias,
                    "meses_adeudados": _meses_enteros_desde(ultima_fecha_fin, hoy),
                    "monto_mensual": f"{membresia.monto_aplicado:,.2f}",
                    "nombre": f"{persona.nombres} {persona.apellidos}",
                })

        # Resumen diario al administrador SOLO si hoy cayó al menos un aviso.
        if avisos_familia:
            resumen = _formatear_resumen_mora(hoy, avisos_familia)
            inicio_dia, fin_dia = _rango_dia_club(hoy)
            for admin_usuario in _listar_administradores(db):
                try:
                    if _disparar_resumen_admin(db, admin_usuario, resumen, inicio_dia, fin_dia):
                        resumen_admin_enviado = True
                except ServicioNoDisponible as exc:
                    logger.warning(
                        "Circuito SMTP abierto enviando resumen de mora a admin "
                        "persona_id=%s; reintentando en %.0fs",
                        admin_usuario.persona_id, CIRCUITO_SMTP_COOLDOWN_SEGUNDOS,
                    )
                    raise self.retry(exc=exc, countdown=CIRCUITO_SMTP_COOLDOWN_SEGUNDOS)
                except Exception:
                    logger.exception(
                        "Fallo enviando resumen de mora a admin persona_id=%s",
                        admin_usuario.persona_id,
                    )
                    raise

    logger.info(
        "Mora %s -> %d avisos de familia (resumen admin: %s)",
        hoy.isoformat(), len(avisos_familia), resumen_admin_enviado,
    )
    return {
        "fecha": hoy.isoformat(),
        "total_avisos_familia": len(avisos_familia),
        "resumen_admin_enviado": resumen_admin_enviado,
        "avisos": avisos_familia,
    }
