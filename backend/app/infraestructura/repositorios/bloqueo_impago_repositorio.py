"""Lectura del bloqueo por impago (#1768).

Junta lo que la regla pura (`app.dominio.bloqueo_impago`) necesita de la base
-- membresías, cobertura combinada y transferencias pendientes -- en UNA
consulta por fuente, sin importar cuántas personas se pregunten. Es el único
punto de lectura: asistencia, roster, portal, `auth/me` y los avisos lo usan,
así que ninguno puede divergir del otro.
"""
from dataclasses import dataclass
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.dominio.bloqueo_impago import esta_bloqueada_por_impago
from app.dominio.cobertura_estado import maximo_fecha_opcional
from app.dominio.enums import EstadoMembresia, EstadoPago, TipoPago
from app.dominio.modelos import Membresia, Pago
from app.infraestructura.repositorios.cobertura_estado_repositorio import CoberturaEstadoRepositorio
from app.soporte_transversal.configuracion import settings
from app.soporte_transversal.tiempo import hoy_club

#: Estados que cuentan para decidir si una persona está bloqueada. INACTIVA
#: (nunca pagó) queda fuera a propósito: conserva su comportamiento.
_ESTADOS_EVALUADOS = (EstadoMembresia.ACTIVA, EstadoMembresia.VENCIDA, EstadoMembresia.SUSPENDIDA)


@dataclass(frozen=True)
class EstadoBloqueoImpago:
    """`cubierto_hasta` es el fin de cobertura más lejano de la persona (el
    «venció el {fecha}» del banner del portal); `None` si no tiene cobertura."""
    bloqueado: bool = False
    cubierto_hasta: date | None = None


class BloqueoImpagoRepositorio:
    def __init__(self, db: Session):
        self.db = db
        self.repo_cobertura = CoberturaEstadoRepositorio(db)

    def por_persona(self, persona_id: int, hoy: date | None = None) -> EstadoBloqueoImpago:
        return self.por_personas([persona_id], hoy=hoy)[persona_id]

    def por_personas(
        self, persona_ids: list[int], hoy: date | None = None,
    ) -> dict[int, EstadoBloqueoImpago]:
        """Estado de cada persona pedida (todas figuran en el resultado).

        Una persona está bloqueada si tiene alguna membresía evaluable y TODAS
        lo están: una vigente (o una suspendida) la libra de una vencida vieja.
        `hoy` es el día del club; por defecto el de ahora."""
        ids = list(dict.fromkeys(persona_ids))
        if not ids:
            return {}
        hoy = hoy if hoy is not None else hoy_club()
        lanzamiento = settings.bloqueo_impago_fecha_lanzamiento

        membresias = list(self.db.scalars(
            select(Membresia)
            .options(joinedload(Membresia.tipo_membresia))
            .where(Membresia.persona_id.in_(ids), Membresia.estado.in_(_ESTADOS_EVALUADOS))
        ).unique())
        membresia_ids = [m.id for m in membresias]
        cobertura = self.repo_cobertura.fecha_fin_maxima_combinada_bulk(membresia_ids)
        con_transferencia = self._con_transferencia_pendiente(membresia_ids)

        por_persona: dict[int, list[tuple[bool, date | None]]] = {pid: [] for pid in ids}
        for m in membresias:
            fin = cobertura.get(m.id)
            bloqueada = esta_bloqueada_por_impago(
                periodicidad=m.tipo_membresia.periodicidad,
                estado=m.estado,
                es_gratuidad_familiar=m.es_gratuidad_familiar,
                cubierto_hasta=fin,
                hoy=hoy,
                fecha_lanzamiento=lanzamiento,
                transferencia_pendiente=m.id in con_transferencia,
            )
            por_persona[m.persona_id].append((bloqueada, fin))
        return {
            pid: EstadoBloqueoImpago(
                bloqueado=bool(filas) and all(bloqueada for bloqueada, _ in filas),
                cubierto_hasta=maximo_fecha_opcional(*(fin for _, fin in filas)),
            )
            for pid, filas in por_persona.items()
        }

    def _con_transferencia_pendiente(self, membresia_ids: list[int]) -> set[int]:
        """Membresías con una TRANSFERENCIA en revisión Y su comprobante
        adjunto. Un efectivo declarado por el socio, o una transferencia sin
        comprobante, no cuentan: el bloqueo solo lo levanta el administrador
        al registrar el cobro en persona."""
        if not membresia_ids:
            return set()
        return set(self.db.scalars(
            select(Pago.membresia_id).where(
                Pago.membresia_id.in_(membresia_ids),
                Pago.estado_pago == EstadoPago.PENDIENTE_VALIDACION,
                Pago.tipo_pago == TipoPago.TRANSFERENCIA,
                Pago.voucher_url.is_not(None),
            )
        ))
