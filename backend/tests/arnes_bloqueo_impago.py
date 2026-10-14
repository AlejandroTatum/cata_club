"""
Arnés del bloqueo por impago (#1768): arma, por ORM, un miembro con la
cobertura que cada test necesita y fija la fecha de lanzamiento.

Escribe directo por SQLAlchemy a propósito (mismo criterio que
`fabricas_pagos.*_orm`): los tests de la regla necesitan fechas de cobertura
exactas, que los servicios no dejan elegir.
"""
import itertools
from datetime import date, datetime, timezone
from decimal import Decimal

from app.dominio.cedula import cedula_valida
from app.dominio.enums import EstadoMembresia, EstadoPago, TipoModalidad, TipoPago
from app.dominio.modelos import Membresia, Pago, Persona, TipoMembresia
from app.dominio.periodicidad import PeriodicidadTarifa
from app.soporte_transversal.configuracion import settings

#: Lanzamiento lejano: los tests de la regla no dependen de la transición
#: salvo los que la prueban a propósito.
LANZAMIENTO_LEJANO = date(2020, 1, 1)

_SECUENCIA = itertools.count(1)


def fijar_lanzamiento(monkeypatch, fecha: date | None = LANZAMIENTO_LEJANO) -> None:
    monkeypatch.setattr(settings, "bloqueo_impago_fecha_lanzamiento", fecha)


def crear_miembro(
    db,
    *,
    cubierto_hasta: date | None,
    estado: EstadoMembresia = EstadoMembresia.VENCIDA,
    periodicidad: PeriodicidadTarifa = PeriodicidadTarifa.MENSUAL,
    gratuidad_familiar: bool = False,
    representante: Persona | None = None,
    nombres: str = "Mora",
) -> tuple[Persona, Membresia]:
    """Persona + membresía con un pago APROBADO que termina en `cubierto_hasta`
    (sin pago alguno si es `None`)."""
    n = next(_SECUENCIA)
    persona = Persona(
        nombres=nombres, apellidos=f"Socio{n}", cedula=cedula_valida(7_000_000 + n),
        fecha_nacimiento=date(2012, 3, 1) if representante else date(1990, 1, 1),
        telefono="0991234567",
        representante_id=representante.id if representante else None,
    )
    db.add(persona)
    db.flush()
    tipo = TipoMembresia(
        categoria=f"Bloqueo {n}", precio=Decimal("25.00"),
        modalidad=TipoModalidad.MENSUAL, periodicidad=periodicidad,
    )
    db.add(tipo)
    db.flush()
    membresia = Membresia(
        estado=estado, monto_aplicado=Decimal("25.00"),
        fecha_activacion=datetime.now(timezone.utc),
        es_gratuidad_familiar=gratuidad_familiar,
        persona_id=persona.id, tipo_membresia_id=tipo.id,
    )
    db.add(membresia)
    db.flush()
    if cubierto_hasta is not None:
        agregar_pago(
            db, persona, membresia, EstadoPago.APROBADO,
            fecha_inicio=cubierto_hasta.replace(day=1), fecha_fin=cubierto_hasta,
        )
    return persona, membresia


def agregar_pago(
    db,
    persona: Persona,
    membresia: Membresia,
    estado: EstadoPago,
    *,
    tipo_pago: TipoPago = TipoPago.EFECTIVO,
    fecha_inicio: date,
    fecha_fin: date,
    con_voucher: bool = False,
) -> Pago:
    pago = Pago(
        monto=Decimal("25.00"), estado_pago=estado, tipo_pago=tipo_pago,
        fecha_inicio=fecha_inicio, fecha_fin=fecha_fin,
        persona_id=persona.id, membresia_id=membresia.id,
        voucher_url="cataclub/vouchers/prueba" if con_voucher else None,
    )
    db.add(pago)
    db.flush()
    return pago
