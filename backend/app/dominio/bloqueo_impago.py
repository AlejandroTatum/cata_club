"""Regla del bloqueo por impago (#1768).

Una membresía cuya cobertura terminó y ya pasó su gracia queda bloqueada: no se
registra su asistencia y el portal solo le deja pagar. La gracia depende de la
tarifa: MENSUAL 3 días, SEMANAL 1 día, DIARIA ninguno (ver
`_DIAS_HASTA_EL_BLOQUEO`). El bloqueo se calcula al leer (nunca se guarda), así
que cualquier pago aprobado lo levanta sin pasos extra y un rechazo lo devuelve
sin pasos extra.

Vive en el dominio (funciones puras, sin base de datos) para que asistencia,
roster, portal, alertas y el ancla de los pagos compartan UNA sola definición.
Los días son DÍAS DEL CLUB (`America/Guayaquil`): quien llama pasa `hoy`.
"""
from datetime import date, timedelta

from app.dominio.enums import EstadoMembresia
from app.dominio.periodicidad import PeriodicidadTarifa

#: Días de gracia de la tarifa MENSUAL: después del fin de la cobertura todavía
#: se puede entrenar y pagar sin perder nada. El bloqueo empieza el día
#: siguiente (el día 4). También ancla los pagos mensuales (`ancla_del_pago`).
DIAS_DE_GRACIA = 3

#: Días desde `cubierto_hasta` hasta el primer día bloqueado. `cubierto_hasta`
#: es el `fecha_fin` EXCLUSIVO del último pago (el primer día sin cubrir):
#: - DIARIA 0: un día pagado D guarda `fecha_fin = D + 1`, que ya bloquea
#:   ("diario se acabó y hay que pagar").
#: - SEMANAL 1: cubierta hasta E (`fecha_fin = E + 1`), sirve hasta E + 1
#:   (1 día de gracia) y bloquea desde E + 2.
#: - MENSUAL `DIAS_DE_GRACIA + 1`: sirve hasta `fecha_fin + 3`.
_DIAS_HASTA_EL_BLOQUEO = {
    PeriodicidadTarifa.DIARIA: 0,
    PeriodicidadTarifa.SEMANAL: 1,
    PeriodicidadTarifa.MENSUAL: DIAS_DE_GRACIA + 1,
}


def inicio_del_bloqueo(
    cubierto_hasta: date,
    fecha_lanzamiento: date,
    periodicidad: PeriodicidadTarifa,
) -> date:
    """Primer día en que la membresía está bloqueada.

    Quien ya estaba vencido el día del lanzamiento cuenta la gracia desde ese
    día (`max`), no desde un vencimiento viejo. `periodicidad` es obligatoria:
    cada tarifa tiene su gracia y un default silencioso daría la equivocada."""
    dias = _DIAS_HASTA_EL_BLOQUEO[periodicidad]
    return max(cubierto_hasta, fecha_lanzamiento) + timedelta(days=dias)


def esta_bloqueada_por_impago(
    *,
    periodicidad: PeriodicidadTarifa,
    estado: EstadoMembresia,
    es_gratuidad_familiar: bool,
    cubierto_hasta: date | None,
    hoy: date,
    fecha_lanzamiento: date | None,
    transferencia_pendiente: bool,
) -> bool:
    """True si la membresía está bloqueada por impago hoy.

    - Sin `fecha_lanzamiento` el bloqueo está apagado.
    - Aplica a toda tarifa (MENSUAL, SEMANAL y DIARIA), cada una con su gracia.
      Que la diaria y la semanal no acumulen deuda ni mora no las exime: solo
      cambia el bloqueo.
    - Una SUSPENDIDA y el socio gratuito de la familia quedan exentos; una
      INACTIVA (nunca pagó) conserva su comportamiento de siempre.
    - `cubierto_hasta` es la cobertura combinada de siempre (pagos aprobados y
      cobertura bonificada); sin cobertura no hay de dónde contar la gracia.
    - Una transferencia pendiente con comprobante levanta el bloqueo mientras
      el administrador la revisa. Quien llama decide qué pendiente cuenta: un
      efectivo declarado por el socio no la levanta.
    """
    if fecha_lanzamiento is None or cubierto_hasta is None:
        return False
    if es_gratuidad_familiar:
        return False
    if estado not in (EstadoMembresia.ACTIVA, EstadoMembresia.VENCIDA):
        return False
    if transferencia_pendiente:
        return False
    return hoy >= inicio_del_bloqueo(cubierto_hasta, fecha_lanzamiento, periodicidad)


def ancla_del_pago(
    cubierto_hasta: date | None, hoy: date, periodicidad: PeriodicidadTarifa,
) -> date:
    """Día en que arranca la cobertura de un pago nuevo.

    Un pago MENSUAL registrado hasta `DIAS_DE_GRACIA` días después del fin de la
    cobertura se ancla en ese fin, así no hay hueco. Cualquier otro caso ancla
    en el mayor entre el fin y hoy, y quien pagó tarde no paga los meses
    bloqueados."""
    if cubierto_hasta is None:
        return hoy
    if (
        periodicidad == PeriodicidadTarifa.MENSUAL
        and hoy <= cubierto_hasta + timedelta(days=DIAS_DE_GRACIA)
    ):
        return cubierto_hasta
    return max(cubierto_hasta, hoy)
