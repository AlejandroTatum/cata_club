"""
Tareas Celery del aviso de un día sin clase (issues #1665 y #1709).

Campana al crear, correo la víspera
    La campana sale al crear el día. El correo NO (#1709): el 2026-10-08 tres
    días creados juntos mandaron todos sus correos el mismo día, agotaron el
    tope diario de 100 y se perdieron 52. Ahora el correo sale a las
    `HORA_CORREO_VISPERA` del club del día anterior al inicio, UNO por cuenta
    con todos los días que empiezan mañana. Con unas 70 cuentas por día queda
    reserva para el resto de los correos del club.

    Excepción: un día que empieza hoy, o mañana cuando el envío de las 08:00
    ya pasó, se avisa por correo al crearlo -- si no, nunca llegaría.

Destinatarios
    Socios con membresía ACTIVA y persona no dada de baja -- la misma noción de
    "vigente" que usa `recordatorio_sesion_tareas`. La campana y el correo van a
    la cuenta alcanzable del socio: la suya, o la de su representante cuando el
    socio no tiene cuenta propia (invariante B de #1137). Una cuenta recibe UN
    solo aviso aunque represente a varios socios. La víspera vuelve a calcular
    los destinatarios: quien se activó después del alta recibe campana y correo.

Idempotencia
    La campana se deduplica por `(tipo, persona_id, entidad_relacionada_id=id
    del día)`; el correo, por la marca `DiaSinClaseCorreo` de (día, cuenta).
    Campana, marca y correo encolado (`correo_outbox`) se commitean juntos: un
    reintento no repite nada, y un tope agotado difiere el correo en vez de
    perderlo.
"""
import logging
from datetime import date, time, timedelta

from sqlalchemy import select
from sqlalchemy.orm import joinedload

from app.dominio.enums import EstadoMembresia, TipoNotificacion
from app.dominio.modelos import DiaSinClase, DiaSinClaseCorreo, Membresia, Notificacion, Persona
from app.infraestructura.db import SessionLocal
from app.infraestructura.notificaciones_servicio import ServicioNotificaciones
from app.infraestructura.tareas.celery_app import celery_app
from app.soporte_transversal.tiempo import ahora_club, hoy_club

logger = logging.getLogger("cataclub.tareas.dia_sin_clase")
logger.setLevel(logging.INFO)

# Hora del club del envío de la víspera; el beat la usa para su crontab.
HORA_CORREO_VISPERA = time(8, 0)


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


def _cuentas_alcanzables(db) -> tuple[dict[int, Persona], int]:
    """Cuentas a avisar, por id, y cuántos socios no tienen ninguna."""
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
        else:
            cuentas[cuenta.id] = cuenta
    return cuentas, sin_cuenta


def _crear_campanas(db, dia: DiaSinClase, cuentas: dict[int, Persona]) -> int:
    """Agrega la campana que falta a cada cuenta (sin commit)."""
    if not cuentas:
        return 0
    ya_avisadas = set(db.execute(
        select(Notificacion.persona_id).where(
            Notificacion.tipo == TipoNotificacion.DIA_SIN_CLASE,
            Notificacion.entidad_relacionada_id == dia.id,
            Notificacion.persona_id.in_(cuentas.keys()),
        )
    ).scalars().all())
    nuevas = [i for i in sorted(cuentas) if i not in ya_avisadas]
    mensaje = _mensaje(dia)
    db.add_all(
        Notificacion(
            tipo=TipoNotificacion.DIA_SIN_CLASE, mensaje=mensaje,
            persona_id=i, entidad_relacionada_id=dia.id,
        )
        for i in nuevas
    )
    return len(nuevas)


def _encolar_correos(db, dias: list[DiaSinClase], cuentas: dict[int, Persona]) -> int:
    """Encola UN correo por cuenta con los días que aún no le avisó y deja la
    marca de cada uno (sin commit). Devuelve cuántos correos encoló."""
    if not dias or not cuentas:
        return 0
    marcadas = {
        (fila.dia_sin_clase_id, fila.persona_id)
        for fila in db.execute(
            select(DiaSinClaseCorreo.dia_sin_clase_id, DiaSinClaseCorreo.persona_id).where(
                DiaSinClaseCorreo.dia_sin_clase_id.in_([d.id for d in dias]),
                DiaSinClaseCorreo.persona_id.in_(cuentas.keys()),
            )
        )
    }
    servicio = ServicioNotificaciones(encolar_en=db)
    encolados = 0
    for cuenta_id in sorted(cuentas):
        pendientes = [d for d in dias if (d.id, cuenta_id) not in marcadas]
        if not pendientes:
            continue
        cuenta = cuentas[cuenta_id]
        servicio.enviar_dia_sin_clase(
            cuenta.usuario.correo, cuenta.nombres,
            [(d.fecha_inicio, d.fecha_fin, d.motivo) for d in pendientes],
        )
        db.add_all(DiaSinClaseCorreo(dia_sin_clase_id=d.id, persona_id=cuenta_id) for d in pendientes)
        encolados += 1
    return encolados


def correo_al_crear(fecha_inicio: date) -> bool:
    """Si el correo de un día que se crea ahora tiene que salir ya: empieza
    hoy (o empezó), o empieza mañana y el envío de la víspera ya pasó."""
    ahora = ahora_club()
    hoy = hoy_club(ahora)
    if fecha_inicio <= hoy:
        return True
    return fecha_inicio == hoy + timedelta(days=1) and ahora.time() >= HORA_CORREO_VISPERA


@celery_app.task(
    name="app.infraestructura.tareas.dia_sin_clase_tareas.avisar_dia_sin_clase",
)
def avisar_dia_sin_clase(dia_id: int, con_correo: bool = True) -> dict:
    """Crea la campana de un día sin clase, una vez por cuenta, y encola el
    correo solo si ya no hay víspera que lo mande (`correo_al_crear`).

    `con_correo=False` es el reenvío del administrador: solo campana.
    Sin `autoretry_for`: la dedup hace seguro reencolar a mano."""
    with SessionLocal() as db:
        dia = db.get(DiaSinClase, dia_id)
        if dia is None:
            return {"dia_id": dia_id, "avisados": 0, "motivo": "inexistente"}
        # Un día que ya terminó (alta retroactiva para corregir la asistencia)
        # no avisa a nadie de algo que ya pasó.
        if dia.fecha_fin < hoy_club(ahora_club()):
            return {"dia_id": dia_id, "avisados": 0, "motivo": "ya_paso"}

        cuentas, sin_cuenta = _cuentas_alcanzables(db)
        avisados = _crear_campanas(db, dia, cuentas)
        correos = 0
        if con_correo and correo_al_crear(dia.fecha_inicio):
            correos = _encolar_correos(db, [dia], cuentas)
        db.commit()

    if sin_cuenta:
        logger.warning(
            "Día sin clase %s: %d socio(s) sin cuenta ni representante con cuenta", dia_id, sin_cuenta,
        )
    logger.info("Día sin clase %s -> %d campanas, %d correos encolados", dia_id, avisados, correos)
    return {
        "dia_id": dia_id, "avisados": avisados, "correos": correos,
        "sin_cuenta_alcanzable": sin_cuenta,
    }


@celery_app.task(
    name="app.infraestructura.tareas.dia_sin_clase_tareas.enviar_correos_del_dia_anterior",
    autoretry_for=(Exception,),
    retry_backoff=True,
    max_retries=5,
)
def enviar_correos_del_dia_anterior() -> dict:
    """Víspera (#1709): encola el correo de todo día que empieza mañana, uno
    por cuenta, y completa la campana de quien se activó después del alta.

    Con reintento: la corrida es UN commit para todo el lote, y si choca con
    un alta simultánea que marcó la misma cuenta (clave de la marca) se
    revierte entera. Las marcas hacen seguro repetirla: el reintento solo
    escribe lo que falte."""
    manana = hoy_club(ahora_club()) + timedelta(days=1)
    with SessionLocal() as db:
        dias = db.execute(
            select(DiaSinClase).where(DiaSinClase.fecha_inicio == manana).order_by(DiaSinClase.id)
        ).scalars().all()
        if not dias:
            return {"fecha": manana.isoformat(), "dias": 0, "correos": 0}
        cuentas, _sin_cuenta = _cuentas_alcanzables(db)
        for dia in dias:
            _crear_campanas(db, dia, cuentas)
        correos = _encolar_correos(db, dias, cuentas)
        db.commit()
    logger.info("Víspera %s: %d día(s) sin clase, %d correos encolados", manana, len(dias), correos)
    return {"fecha": manana.isoformat(), "dias": len(dias), "correos": correos}
