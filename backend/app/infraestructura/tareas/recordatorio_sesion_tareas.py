"""
Tarea Celery Beat diaria: recordatorio IN-APP de la sesión de mañana.

Regla de negocio (PR F de la deuda de experiencia del alumno, G5):
    Cada noche, cada alumno que MAÑANA tiene entrenamiento recibe UNA
    `Notificacion` de tipo `RECORDATORIO_SESION`. Nada más.

Por qué NO hay correo acá (decisión de producto, no un pendiente):
    La ronda entera de deuda de experiencia del alumno tiene como restricción
    de producto no gastar cupo del plan gratuito de Resend. Este recordatorio
    es BELL-ONLY: este módulo no importa `ServicioNotificaciones`, no llama a
    `enviar_correo` y no encola nada en ninguna outbox. Si en el futuro se
    decide que salga por correo, ese es un cambio de producto con su propia
    decisión de cupo -- no algo que se desprenda de este archivo.

Qué cuenta como "tiene sesión mañana" (MVP honesto):
    1. `Membresia.estado == ACTIVA`. Es exactamente la noción de "vigente"
       que ya usan `vencimientos_tareas.marcar_membresias_vencidas` (02:35) y
       `alertas_tareas`: SUSPENDIDA queda afuera (el club le para la deuda
       mientras dura y no tiene por qué recordarle nada) y VENCIDA también.
       No hay ventana de tolerancia que programar: `marcar_membresias_vencidas`
       ya corrió a las 02:35 del mismo día, así que a las 21:30 una membresía
       cuya cobertura paga venció YA está en VENCIDA.
    2. `Persona.activo` -- la baja lógica que respeta el resto de los
       listados (mismo filtro que `alertas_tareas`).
    3. Existe al menos un `AlumnoHorario` suyo cuyo
       `HorarioEntrenamiento.dia_semana` es el día de la semana de MAÑANA. Eso
       es "su franja incluye el próximo día del club": el "mañana" se resuelve
       con `hoy_club()` (America/Guayaquil), nunca con el reloj UTC del
       contenedor.
    Lo que esto NO dice, a propósito: no predice asistencia, no mira faltas
    ni `SesionAsistencia`, y no distingue categorías. Es el recordatorio de la
    franja que el club le asignó, nada más.

Sin ventana de recuperación (a diferencia de `alertas_tareas`):
    Las ventanas de recuperación de vencimiento y mora existen porque un aviso
    que llega tarde sigue siendo útil (la deuda sigue ahí). Éste no: si Beat
    se saltó la noche, un recordatorio de "mañana" emitido pasado mañana
    avisa de una sesión que ya ocurrió. Por eso no hay rango ni
    reprogramación; la corrida perdida se pierde.

Dedup: una notificación por (alumno, día de la sesión)
    La clave es `(tipo, persona_id, entidad_relacionada_id)` -- la MISMA
    forma que usa `alertas_tareas` -- con `entidad_relacionada_id` = el día de
    la sesión codificado como `YYYYMMDD` (`20290615`). `Notificacion` no
    tiene columna de fecha de sesión y `entidad_relacionada_id` es, por
    diseño, "el id de la entidad relacionada, sin FK estricta porque el tipo
    de entidad varía según `tipo`": acá la entidad relacionada ES el día de
    entrenamiento. El entero es determinista, cabe holgado en la columna y no
    depende de que el mensaje se mantenga estable (deduplicar por texto sería
    frágil: el texto lleva la franja y su hora, que el admin puede cambiar).
    Rerun del mismo día -> mismas claves -> cero filas nuevas.

Titular, no representante (issue #1227)
    La fila se escribe SIEMPRE a nombre del alumno, nunca a nombre del
    representante. Desde #1227 el feed del representante ya incluye las filas
    de sus representados activos y le antepone "Para <nombre>:" al leer
    (`NotificacionServicio.listar_para_persona_y_hijos`), así que el alumno
    menor de edad -- que por la invariante B de #1137 no tiene cuenta propia
    -- recibe el aviso igual, en la campana de quien lo representa y sin que
    este módulo tenga que fabricar el prefijo a mano.

Resolución del destinatario alcanzable
    Mismo criterio que `membresia_pago_servicio._responsable_del_correo_de_pago`
    (issue #1133/#1283): la cuenta del propio alumno, o la de su representante
    cuando el alumno no tiene. Si NINGUNA de las dos existe, nadie podría leer
    esa campana jamás, así que no se crea la fila y se loguea -- replicado acá
    porque aquel helper vive en `servicios_negocio` y es privado.
"""
from datetime import date, time, timedelta
import logging

from sqlalchemy import select
from sqlalchemy.orm import joinedload

from app.dominio.enums import DiaSemana, EstadoMembresia, TipoNotificacion
from app.dominio.modelos import (
    AlumnoHorario,
    CategoriaHorario,
    HorarioEntrenamiento,
    Membresia,
    Notificacion,
    Persona,
)
from app.infraestructura.db import SessionLocal
from app.infraestructura.tareas.celery_app import celery_app
from app.soporte_transversal.tiempo import hoy_club


logger = logging.getLogger("cataclub.tareas.recordatorio_sesion")
logger.setLevel(logging.INFO)


# `date.weekday()` (Python, Lunes=0..Domingo=6) -> `DiaSemana`. Mismo mapa que
# `asistencia_servicio._WEEKDAY_A_DIA_SEMANA` y
# `dashboard_router._WEEKDAY_MAP`; se repite local a propósito: son tres
# módulos con ciclos de import distintos (worker de Celery, servicio, router) y
# el mapa no es política de negocio sino la traducción literal del contrato de
# `datetime`, tan estable como el propio `weekday()`. Importar el privado de
# `servicios_negocio` desde la tarea acoplaría el worker a un módulo de
# servicios solo para traducir un entero.
_WEEKDAY_A_DIA_SEMANA = {
    0: DiaSemana.LUNES,
    1: DiaSemana.MARTES,
    2: DiaSemana.MIERCOLES,
    3: DiaSemana.JUEVES,
    4: DiaSemana.VIERNES,
    5: DiaSemana.SABADO,
    6: DiaSemana.DOMINGO,
}


def _clave_del_dia(fecha: date) -> int:
    """Día de calendario como entero `YYYYMMDD` (`20290615`).

    Es el valor que viaja en `Notificacion.entidad_relacionada_id` y, con él,
    la parte que impide duplicar el aviso si la tarea se reintenta el mismo
    día. Se deriva de la fecha de la SESIÓN, no de la fecha de la corrida: la
    clave tiene que ser la misma para la misma sesión, corra cuando corra.
    """
    return int(fecha.strftime("%Y%m%d"))


def _cuenta_alcanzable(persona: Persona) -> Persona | None:
    """Quién puede leer la campana por esta persona: ella misma si tiene
    cuenta, si no su representante con cuenta, si no nadie.

    Réplica local deliberada de
    `MembresiaPagoServicio._responsable_del_correo_de_pago` (ver el docstring
    del módulo): `persona.usuario` llega precargado por `joinedload` en el
    lote del llamador, así que esto no agrega ningún `SELECT` por alumno.
    Devuelve `None` cuando no hay ninguna cuenta alcanzable; el llamador
    loguea y omite -- nunca inventa una fila que nadie podría leer."""
    if persona.usuario is not None:
        return persona
    representante = persona.representante if persona.representante_id else None
    if representante is not None and representante.usuario is not None:
        return representante
    return None


def _franja_en_texto(etiqueta: str, hora_inicio: time, hora_fin: time) -> str:
    """`"Formativo de 15:00 a 16:00"`: el nombre humano de la categoría (la
    etiqueta de `categoria_horario`, no el código técnico) más su horario."""
    return (
        f"{etiqueta} de {hora_inicio.strftime('%H:%M')} "
        f"a {hora_fin.strftime('%H:%M')}"
    )


def _mensaje_de_manana(franjas: list[tuple[time, str, time]]) -> str:
    """Texto del recordatorio, con la franja (o franjas) del día.

    Un alumno puede pertenecer a varias categorías a la vez (decisión del
    dueño, 2026-08-27), así que la misma sesión puede tener más de una franja
    el mismo día: se listan todas en el MISMO aviso -- la clave de dedup es
    por (alumno, día), no por franja, y mandar tres campanas seguidas por un
    martes con tres entrenamientos sería ruido, no información.

    Registro "usted", como el resto del copy visible del producto
    (`usted-register-lock` del frontend lo canda del lado del cliente): el
    mensaje es impersonal a propósito, porque el mismo texto lo lee el alumno
    en su campana o su representante en la suya con el prefijo
    "Para <nombre>: " que agrega `NotificacionServicio`."""
    detalle = "; ".join(
        _franja_en_texto(etiqueta, inicio, fin)
        for inicio, etiqueta, fin in franjas
    )
    return f"Entrenamiento mañana: {detalle}."


def _claves_ya_notificadas(
    db, claves: set[tuple[TipoNotificacion, int, int]]
) -> set[tuple[TipoNotificacion, int, int]]:
    """Dedup de idempotencia EN LOTE: un solo `SELECT` que resuelve, para todo
    el lote, cuáles de las claves `(tipo, persona_id, entidad_relacionada_id)`
    ya tienen su `Notificacion` persistida.

    Adaptación de `alertas_tareas._notificaciones_existentes` (misma forma de
    clave y misma estrategia: filtro por columnas sueltas -- `IN`
    multi-columna no es portable -- y correspondencia exacta resuelta en
    memoria, así que no hay falsos positivos). Se escribe local en vez de
    importar aquel privado para no acoplar esta tarea al módulo de alertas por
    un helper de dos docenas de líneas."""
    if not claves:
        return set()
    tipos = {tipo for tipo, _, _ in claves}
    personas = {persona_id for _, persona_id, _ in claves}
    entidades = {entidad for _, _, entidad in claves}
    filas = db.execute(
        select(
            Notificacion.tipo, Notificacion.persona_id,
            Notificacion.entidad_relacionada_id,
        ).where(
            Notificacion.tipo.in_(tipos),
            Notificacion.persona_id.in_(personas),
            Notificacion.entidad_relacionada_id.in_(entidades),
        )
    ).all()
    return {(fila.tipo, fila.persona_id, fila.entidad_relacionada_id) for fila in filas}


def _persistir_lote(filas: list[Notificacion]) -> None:
    """Persiste el lote acumulado en UNA sola sesión corta, después del bucle
    -- nunca durante una consulta abierta. Mismo criterio que
    `alertas_tareas._persistir_lote`."""
    if not filas:
        return
    with SessionLocal() as db_escritura:
        db_escritura.add_all(filas)
        db_escritura.commit()


@celery_app.task(
    name="app.infraestructura.tareas.recordatorio_sesion_tareas.recordar_sesion_de_manana",
)
def recordar_sesion_de_manana() -> dict:
    """Ejecución diaria (21:30 hora del club, ver `celery_app.py`): crea un
    recordatorio in-app por cada alumno con membresía ACTIVA y franja en el
    día de mañana.

    Sin `autoretry_for` a propósito (mismo criterio que
    `contador_correo_tareas.limpiar_contador_correo_diario`, que tampoco lo
    tiene): no hay ningún canal externo que pueda fallar de forma transitoria
    -- es una consulta y un `INSERT` contra la propia base -- y el aviso no
    sirve pasado su día, así que reintentar dentro de la misma noche no
    agregaría nada que la dedup no haga ya en la corrida siguiente de Beat.

    Returns:
        dict con el resumen ejecutable de la corrida (fecha de la sesión, día
        de la semana y el detalle de cada aviso), útil para el log y para un
        panel de salud del sistema.
    """
    # Día del CLUB, no del contenedor: Beat ya planifica en
    # `America/Guayaquil` (`celery_app.timezone`), así que usar el reloj UTC
    # haría que a las 19:00 hora del club el programador y la tarea
    # discreparan sobre qué día es "mañana".
    sesion = hoy_club() + timedelta(days=1)
    dia_de_la_sesion = _WEEKDAY_A_DIA_SEMANA[sesion.weekday()]
    clave_del_dia = _clave_del_dia(sesion)

    recordatorios: list[dict] = []
    sin_cuenta_alcanzable: list[int] = []

    with SessionLocal() as db:
        stmt = (
            select(Persona, HorarioEntrenamiento, CategoriaHorario.label)
            .join(Membresia, Membresia.persona_id == Persona.id)
            .join(AlumnoHorario, AlumnoHorario.persona_id == Persona.id)
            .join(
                HorarioEntrenamiento,
                HorarioEntrenamiento.id == AlumnoHorario.horario_id,
            )
            # La etiqueta humana de la categoría viaja en el mismo SELECT: el
            # mensaje la nombra, y resolverla después sería un `SELECT` por
            # alumno (N+1) sobre una tabla de cinco filas.
            .join(
                CategoriaHorario,
                CategoriaHorario.codigo == HorarioEntrenamiento.categoria,
            )
            # `persona.usuario` y `persona.representante.usuario` se leen en
            # `_cuenta_alcanzable`: son relaciones a-uno (`usuario.persona_id`
            # es UNIQUE), así que el LEFT JOIN no multiplica filas y
            # `joinedload` las resuelve en el MISMO SELECT sin una segunda
            # consulta -- mismo criterio que `alertas_tareas` (issue #905).
            .options(
                joinedload(Persona.usuario),
                joinedload(Persona.representante).joinedload(Persona.usuario),
            )
            .where(
                # Membresía vigente (ver el docstring del módulo): SUSPENDIDA
                # y VENCIDA quedan afuera; a esta hora la transición de
                # `marcar_membresias_vencidas` ya corrió.
                Membresia.estado == EstadoMembresia.ACTIVA,
                Persona.activo.is_(True),
                HorarioEntrenamiento.dia_semana == dia_de_la_sesion,
            )
        )
        # `.unique()` porque la persona aparece una vez por franja asignada a
        # ese día (varias filas por alumno, a propósito: el mensaje las
        # nombra todas) y porque el `joinedload` a-uno no debe reventar si
        # alguna de esas relaciones cambia de cardinalidad.
        filas = db.execute(stmt).unique().all()

        # Agrupación en memoria, una entrada por alumno: es lo que convierte
        # "N franjas del mismo día" en UN aviso por (alumno, día) y lo que
        # garantiza el dedup aunque la base llegara a tener más de una
        # membresía ACTIVA de la misma persona (el índice parcial
        # `uq_membresia_activa_por_persona` dice que no, pero el agrupamiento
        # hace que la corrección no dependa de eso).
        personas: dict[int, Persona] = {}
        franjas: dict[int, list[tuple[time, str, time]]] = {}
        for persona, horario, etiqueta in filas:
            personas[persona.id] = persona
            franjas.setdefault(persona.id, []).append(
                (horario.hora_inicio, etiqueta, horario.hora_fin)
            )

        claves = {
            (TipoNotificacion.RECORDATORIO_SESION, persona_id, clave_del_dia)
            for persona_id in personas
        }
        ya_notificados = _claves_ya_notificadas(db, claves)

        lote: list[Notificacion] = []
        # Orden estable por `persona_id`: el snapshot que devuelve la corrida
        # (y el de los tests) no depende del orden en que Postgres devolvió
        # las filas del JOIN.
        for persona_id in sorted(personas):
            persona = personas[persona_id]
            if _cuenta_alcanzable(persona) is None:
                sin_cuenta_alcanzable.append(persona_id)
                continue
            clave = (TipoNotificacion.RECORDATORIO_SESION, persona_id, clave_del_dia)
            if clave in ya_notificados:
                # Ya se emitió en una corrida anterior del mismo día: la
                # dedup es lo que hace que un rerun (o un Beat que dispara
                # dos veces) no duplique.
                continue
            por_hora = sorted(franjas[persona_id])
            lote.append(Notificacion(
                tipo=TipoNotificacion.RECORDATORIO_SESION,
                mensaje=_mensaje_de_manana(por_hora),
                persona_id=persona_id,
                entidad_relacionada_id=clave_del_dia,
            ))
            recordatorios.append({
                "persona_id": persona_id,
                "sesion": sesion.isoformat(),
                "dia_semana": dia_de_la_sesion.value,
                "franjas": [
                    _franja_en_texto(etiqueta, inicio, fin)
                    for inicio, etiqueta, fin in por_hora
                ],
            })
        _persistir_lote(lote)

    if sin_cuenta_alcanzable:
        logger.warning(
            "Recordatorios de sesión del %s omitidos: %d alumno(s) sin cuenta "
            "propia ni representante con cuenta (%s)",
            sesion.isoformat(), len(sin_cuenta_alcanzable),
            sin_cuenta_alcanzable,
        )
    logger.info(
        "Recordatorios de sesión %s (%s) -> %d notificaciones creadas",
        sesion.isoformat(), dia_de_la_sesion.value, len(recordatorios),
    )
    return {
        "sesion": sesion.isoformat(),
        "dia_semana": dia_de_la_sesion.value,
        "total_recordatorios": len(recordatorios),
        "recordatorios": recordatorios,
        "total_sin_cuenta_alcanzable": len(sin_cuenta_alcanzable),
        "sin_cuenta_alcanzable": sin_cuenta_alcanzable,
    }
