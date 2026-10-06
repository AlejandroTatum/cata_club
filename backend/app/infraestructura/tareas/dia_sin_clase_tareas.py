"""
Tarea Celery: avisa a los socios de un día sin clase recién creado (issue #1665).

Decisiones del dueño (2026-10-05): el día es del club entero y el aviso sale
por campana Y por correo, una vez, al crear. Sin recordatorio el día anterior,
y editar o borrar el día no reenvía nada.

Destinatarios
    Socios con membresía ACTIVA y persona no dada de baja -- la misma noción de
    "vigente" que usa `recordatorio_sesion_tareas`. La campana y el correo van a
    la cuenta alcanzable del socio: la suya, o la de su representante cuando el
    socio no tiene cuenta propia (invariante B de #1137). Una cuenta recibe UN
    solo aviso aunque represente a varios socios: tres hijos no son tres campanas
    ni tres correos por el mismo día.

Idempotencia
    La fila de `Notificacion` se deduplica por `(tipo, persona_id,
    entidad_relacionada_id=id del día)`. El correo sale solo para las filas
    NUEVAS de esta corrida: un reintento de la tarea no repite el correo.

Correo best-effort
    El aviso in-app se commitea primero; un fallo del correo se loguea (sin
    la dirección completa) y no deshace nada ni corta al resto del lote.
"""
import logging

from sqlalchemy import select
from sqlalchemy.orm import joinedload

from app.dominio.enums import EstadoMembresia, TipoNotificacion
from app.dominio.modelos import DiaSinClase, Membresia, Notificacion, Persona
from app.infraestructura.db import SessionLocal
from app.infraestructura.notificaciones_servicio import ServicioNotificaciones
from app.infraestructura.tareas.celery_app import celery_app
from app.soporte_transversal.tiempo import hoy_club

logger = logging.getLogger("cataclub.tareas.dia_sin_clase")
logger.setLevel(logging.INFO)


def _mensaje(dia: DiaSinClase) -> str:
    inicio = dia.fecha_inicio.strftime("%d/%m/%Y")
    if dia.fecha_fin == dia.fecha_inicio:
        return f"Sin clases el {inicio}: {dia.motivo}."
    return f"Sin clases del {inicio} al {dia.fecha_fin.strftime('%d/%m/%Y')}: {dia.motivo}."


def _cuenta_alcanzable(persona: Persona) -> Persona | None:
    """La cuenta que puede leer el aviso: la del propio socio, o la de su
    representante; `None` si ninguna existe (nadie podría leerlo)."""
    if persona.usuario is not None:
        return persona
    representante = persona.representante if persona.representante_id else None
    if representante is not None and representante.usuario is not None:
        return representante
    return None


@celery_app.task(
    name="app.infraestructura.tareas.dia_sin_clase_tareas.avisar_dia_sin_clase",
)
def avisar_dia_sin_clase(dia_id: int) -> dict:
    """Crea la campana y envía el correo de un día sin clase, una vez por cuenta.

    Sin `autoretry_for`: la dedup hace seguro reencolar a mano, y reintentar
    solo el correo no es posible sin duplicar la campana ya escrita."""
    with SessionLocal() as db:
        dia = db.get(DiaSinClase, dia_id)
        if dia is None:
            return {"dia_id": dia_id, "avisados": 0, "motivo": "inexistente"}
        # Un día que ya terminó (alta retroactiva para corregir la asistencia)
        # no avisa a nadie de algo que ya pasó.
        if dia.fecha_fin < hoy_club():
            return {"dia_id": dia_id, "avisados": 0, "motivo": "ya_paso"}

        personas = db.execute(
            select(Persona)
            .join(Membresia, Membresia.persona_id == Persona.id)
            .options(
                joinedload(Persona.usuario),
                joinedload(Persona.representante).joinedload(Persona.usuario),
            )
            .where(Membresia.estado == EstadoMembresia.ACTIVA, Persona.activo.is_(True))
        ).unique().scalars().all()

        cuentas: dict[int, Persona] = {}
        sin_cuenta = 0
        for persona in personas:
            cuenta = _cuenta_alcanzable(persona)
            if cuenta is None:
                sin_cuenta += 1
                continue
            cuentas[cuenta.id] = cuenta

        ya_avisadas = set(db.execute(
            select(Notificacion.persona_id).where(
                Notificacion.tipo == TipoNotificacion.DIA_SIN_CLASE,
                Notificacion.entidad_relacionada_id == dia.id,
                Notificacion.persona_id.in_(cuentas.keys()),
            )
        ).scalars().all()) if cuentas else set()

        nuevas = [cuentas[i] for i in sorted(cuentas) if i not in ya_avisadas]
        mensaje = _mensaje(dia)
        db.add_all(
            Notificacion(
                tipo=TipoNotificacion.DIA_SIN_CLASE, mensaje=mensaje,
                persona_id=cuenta.id, entidad_relacionada_id=dia.id,
            )
            for cuenta in nuevas
        )
        destinos = [(c.usuario.correo, c.nombres) for c in nuevas]
        fecha_inicio, fecha_fin, motivo = dia.fecha_inicio, dia.fecha_fin, dia.motivo
        db.commit()

    if sin_cuenta:
        logger.warning(
            "Día sin clase %s: %d socio(s) sin cuenta ni representante con cuenta", dia_id, sin_cuenta,
        )

    servicio = ServicioNotificaciones()
    for correo, nombre in destinos:
        try:
            servicio.enviar_dia_sin_clase(correo, nombre, fecha_inicio, fecha_fin, motivo)
        except Exception as exc:
            logger.warning(
                "Correo del día sin clase %s no enviado: %s", dia_id, type(exc).__name__,
            )
    logger.info("Día sin clase %s -> %d cuentas avisadas", dia_id, len(destinos))
    return {"dia_id": dia_id, "avisados": len(destinos), "sin_cuenta_alcanzable": sin_cuenta}
