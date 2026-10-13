"""Regla que alinea el estado guardado de una membresía con su cobertura (#1762).

La cobertura y la deuda se derivan al leer de los pagos aprobados y de la
cobertura bonificada; lo único guardado es el estado. Aprobar un pago activa la
membresía, y tanto la corrección de pagos como la tarea nocturna de
vencimientos deben dejarla donde la cobertura dice. Vive en el dominio (sin
base de datos) para que ambos llamadores compartan UNA sola definición.
"""
from datetime import date

from app.dominio.enums import EstadoMembresia


def maximo_fecha_opcional(*fechas: date | None) -> date | None:
    """`max()` que tolera `None` (fecha ausente) sin romper -- `None` si
    NINGUNA fecha está presente, la mayor de las que sí lo están en caso
    contrario. Único lugar donde vive "combinar dos anclas de cobertura
    opcionales" (issue #326): la cobertura de una membresía (pagos y
    bonificada) y `PagoServicio.obtener_deuda_bulk` (N membresías, con mapas
    pre-cargados) lo comparten en vez de repetir el filtro de `None` cada uno
    por su lado."""
    candidatos = [fecha for fecha in fechas if fecha is not None]
    return max(candidatos) if candidatos else None


def estado_segun_cobertura(
    estado: EstadoMembresia,
    cubierto_hasta: date | None,
    hoy: date,
    *,
    persona_activa: bool,
    hay_otra_operativa: bool,
) -> EstadoMembresia:
    """Estado que corresponde a una membresía según su cobertura combinada.

    - Sin cobertura alguna (`None`): no se toca.
    - Cobertura que llega a `hoy`: INACTIVA/VENCIDA -> ACTIVA, con las mismas
      guardas que aprobar un pago: persona activa y ninguna OTRA membresía
      operativa de la persona (`uq_membresia_activa_por_persona` admite una
      sola ACTIVA/SUSPENDIDA). Si una guarda falla, se deja como está.
    - Cobertura ya terminada: ACTIVA -> VENCIDA, solo para personas activas
      (como la tarea de vencimientos).
    - SUSPENDIDA (decisión administrativa propia) nunca se toca.
    """
    if cubierto_hasta is None:
        return estado
    if cubierto_hasta >= hoy:
        if (
            estado in (EstadoMembresia.INACTIVA, EstadoMembresia.VENCIDA)
            and persona_activa
            and not hay_otra_operativa
        ):
            return EstadoMembresia.ACTIVA
        return estado
    if estado == EstadoMembresia.ACTIVA and persona_activa:
        return EstadoMembresia.VENCIDA
    return estado
