"""Inventario de solo lectura de anomalías en `pago` y su cobertura (#400).

Hermano de `scripts/inventario_anomalias_membresias.py`: aquel mide sobre
`membresia` (deriva de tarifa, ceros y gratuidad, duplicados no activos),
este sobre `pago`. Mismas garantías: DIAGNOSTICA y nunca repara, código de
salida siempre 0, y la lógica vive en funciones puras que reciben una
`Session` para que los tests las ejerciten sin subproceso ni I/O.

El reporte NUNCA expone datos privados: solo IDs numéricos, montos, fechas,
valores de enum, motivos y conteos. Nada de nombres, cédulas ni teléfonos.

Como en el hermano, cada detector consulta dentro de `session.no_autoflush`:
`Session` viene con `autoflush=True`, así que sin eso una consulta del
reporte bajaría a la base los objetos sucios que el llamador tuviera
pendientes -- y estas funciones reciben una sesión ajena a propósito. El
destino sale SIEMPRE de `settings.database_url`, nunca de `argv`.

LO MÁS IMPORTANTE DE ESTE ARCHIVO -- qué significa un hallazgo:

    A3b y A5 se calculan contra el `monto_aplicado` VIGENTE de la membresía,
    porque hoy no existe ningún snapshot histórico de la tarifa: esa
    ausencia es justamente lo que #400 agrega más adelante en la cadena.
    Por lo tanto un hallazgo significa UNA DE DOS COSAS -- datos realmente
    rotos, o un cambio de tarifa legítimo que nadie registró -- y este
    reporte NO PUEDE distinguirlas. Por eso no dice que la fila esté mal:
    dice que la fila no es reconstruible. Ninguna plata histórica ambigua
    se repara automáticamente.

Tres clases:
  A3a -- Coberturas APROBADAS superpuestas sobre la misma membresía.
  A3b -- Cobertura incompatible con los meses que el monto compra.
  A5  -- Meses no derivables: falta el snapshot para reconstruir el pago.

Uso:
    uv run python scripts/inventario_anomalias_pagos.py [--json]
"""
import argparse
import json
import sys
from datetime import date
from decimal import Decimal
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

_RAIZ_BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_RAIZ_BACKEND))

from app.dominio.enums import EstadoPago, TipoPago  # noqa: E402
from app.dominio.modelos import Membresia, Pago  # noqa: E402
# Se importa deliberadamente un nombre con guion bajo: `_sumar_meses` recorta
# al último día del mes destino (31 ene + 1 mes = 28 feb), así que la cuenta
# NO se puede invertir con una resta de fechas sin inventar falsos positivos.
# Reimplementarla acá crearía una segunda definición del mismo hecho, que es
# exactamente lo que este repo rechaza (ver #326). Se reusa la de producción.
from app.servicios_negocio.membresia_pago_servicio import _sumar_meses  # noqa: E402
from app.soporte_transversal.configuracion import settings  # noqa: E402


def _pagos_con_membresia(session: Session, *, solo_aprobados: bool) -> list:
    consulta = session.query(Pago, Membresia).join(
        Membresia, Pago.membresia_id == Membresia.id
    )
    if solo_aprobados:
        consulta = consulta.filter(Pago.estado_pago == EstadoPago.APROBADO)
    with session.no_autoflush:
        return consulta.all()


def _meses_derivados(monto: Decimal, precio_mensual: Decimal) -> int | None:
    """Meses que el monto compra, o `None` si no se pueden derivar. El cero
    se chequea ANTES del módulo: `monto % 0` revienta, y un precio en cero es
    justamente una de las anomalías que este reporte busca."""
    if precio_mensual <= 0 or monto % precio_mensual != 0:
        return None
    return int(monto // precio_mensual)


def detectar_coberturas_superpuestas(session: Session) -> list[dict]:
    """A3a: pares de pagos APROBADOS de la misma membresía cuyos períodos se
    pisan. El intervalo es SEMIABIERTO `[inicio, fin)`: el ancla del pago
    siguiente es exactamente el `fecha_fin` del anterior (ver la derivación
    en `PagoServicio.registrar_pago`), así que dos períodos que se tocan son
    lo normal, no una anomalía. Tratarlos como cerrados reportaría todo par
    de pagos consecutivos del club.

    Incluye REGULARIZACION: una superposición está mal sin importar por qué
    camino se creó."""
    por_membresia: dict[int, list[Pago]] = {}
    for pago, _membresia in _pagos_con_membresia(session, solo_aprobados=True):
        por_membresia.setdefault(pago.membresia_id, []).append(pago)

    filas = []
    for membresia_id, pagos in por_membresia.items():
        ordenados = sorted(pagos, key=lambda p: (p.fecha_inicio, p.id))
        for i, a in enumerate(ordenados):
            for b in ordenados[i + 1:]:
                if a.fecha_inicio < b.fecha_fin and b.fecha_inicio < a.fecha_fin:
                    filas.append({
                        "membresia_id": membresia_id,
                        "pago_id_a": a.id, "fecha_inicio_a": a.fecha_inicio,
                        "fecha_fin_a": a.fecha_fin,
                        "pago_id_b": b.id, "fecha_inicio_b": b.fecha_inicio,
                        "fecha_fin_b": b.fecha_fin,
                    })
    filas.sort(key=lambda f: (f["membresia_id"], f["pago_id_a"], f["pago_id_b"]))
    return filas


def detectar_cobertura_incompatible(session: Session) -> list[dict]:
    """A3b: pagos APROBADOS cuyo `fecha_fin` no es el que la cantidad de meses
    comprada produce. La comparación va HACIA ADELANTE con `_sumar_meses`,
    nunca invirtiendo la cuenta con una resta de fechas.

    Excluye REGULARIZACION: `regularizar_deuda` deja al admin fijar fechas
    retroactivas explícitas a propósito (#284), así que reportarlas sería
    llamar defecto a lo intencional. Excluye también los pagos sin meses
    derivables: ahí la cobertura no es incompatible, es indecidible, y eso
    lo reporta A5."""
    filas = []
    for pago, membresia in _pagos_con_membresia(session, solo_aprobados=True):
        if pago.tipo_pago == TipoPago.REGULARIZACION:
            continue
        meses = _meses_derivados(pago.monto, membresia.monto_aplicado)
        if meses is None:
            continue
        esperada = _sumar_meses(pago.fecha_inicio, meses)
        if pago.fecha_fin == esperada:
            continue
        filas.append({
            "pago_id": pago.id, "membresia_id": pago.membresia_id,
            "monto": pago.monto, "precio_mensual": membresia.monto_aplicado,
            "meses_derivados": meses, "fecha_inicio": pago.fecha_inicio,
            "fecha_fin": pago.fecha_fin, "fecha_fin_esperada": esperada,
        })
    filas.sort(key=lambda f: f["pago_id"])
    return filas


def detectar_meses_no_derivables(session: Session) -> list[dict]:
    """A5: pagos -- en CUALQUIER estado -- de los que hoy no se puede
    reconstruir cuántos meses compraron. Ver la advertencia del docstring del
    módulo: un hallazgo acá puede ser dato roto o una tarifa que cambió sin
    que nadie la registrara, y el reporte no puede distinguirlas."""
    filas = []
    for pago, membresia in _pagos_con_membresia(session, solo_aprobados=False):
        precio = membresia.monto_aplicado
        if precio <= 0:
            motivo = "precio_mensual_cero"
        elif pago.monto % precio != 0:
            motivo = "monto_no_multiplo"
        else:
            continue
        filas.append({
            "pago_id": pago.id, "membresia_id": pago.membresia_id,
            "estado_pago": pago.estado_pago.value, "tipo_pago": pago.tipo_pago.value,
            "monto": pago.monto, "precio_mensual": precio, "motivo": motivo,
        })
    filas.sort(key=lambda f: f["pago_id"])
    return filas


def construir_inventario(session: Session) -> dict:
    """Agregador: el reporte completo con conteos y filas por clase."""
    superpuestas = detectar_coberturas_superpuestas(session)
    incompatibles = detectar_cobertura_incompatible(session)
    no_derivables = detectar_meses_no_derivables(session)
    return {
        "a3a_coberturas_superpuestas": {"cantidad": len(superpuestas), "filas": superpuestas},
        "a3b_cobertura_incompatible": {"cantidad": len(incompatibles), "filas": incompatibles},
        "a5_meses_no_derivables": {"cantidad": len(no_derivables), "filas": no_derivables},
    }


def _json_default(obj):
    """`json.dumps` no sabe serializar `Decimal` ni `date`. El `Decimal` baja
    a `str` para no perder precisión (la plata nunca es float acá), y la
    fecha a ISO-8601."""
    if isinstance(obj, Decimal):
        return str(obj)
    if isinstance(obj, date):
        return obj.isoformat()
    raise TypeError(f"No se puede serializar {type(obj)!r} a JSON")


def formatear_json(inventario: dict) -> str:
    return json.dumps(inventario, default=_json_default, ensure_ascii=False, indent=2)


def formatear_texto(inventario: dict) -> str:
    lineas = ["Inventario de anomalías de pago y cobertura (issue #400)", ""]

    a3a = inventario["a3a_coberturas_superpuestas"]
    lineas.append(f"A3a - Coberturas aprobadas superpuestas: {a3a['cantidad']}")
    lineas += [
        f"  membresia={f['membresia_id']} pago={f['pago_id_a']} "
        f"[{f['fecha_inicio_a']}..{f['fecha_fin_a']}) pisa pago={f['pago_id_b']} "
        f"[{f['fecha_inicio_b']}..{f['fecha_fin_b']})"
        for f in a3a["filas"]
    ]

    a3b = inventario["a3b_cobertura_incompatible"]
    lineas.append(f"A3b - Cobertura incompatible con los meses pagados: {a3b['cantidad']}")
    lineas += [
        f"  pago={f['pago_id']} membresia={f['membresia_id']} monto={f['monto']} "
        f"precio={f['precio_mensual']} meses={f['meses_derivados']} "
        f"fin={f['fecha_fin']} esperado={f['fecha_fin_esperada']}"
        for f in a3b["filas"]
    ]

    a5 = inventario["a5_meses_no_derivables"]
    lineas.append(f"A5 - Meses no derivables (falta snapshot): {a5['cantidad']}")
    lineas += [
        f"  pago={f['pago_id']} membresia={f['membresia_id']} estado={f['estado_pago']} "
        f"monto={f['monto']} precio={f['precio_mensual']} motivo={f['motivo']}"
        for f in a5["filas"]
    ]

    lineas += [
        "",
        "AVISO: A3b y A5 se calculan contra la tarifa VIGENTE porque no hay",
        "snapshot histórico. Un hallazgo puede ser dato roto O una tarifa que",
        "cambió sin registrarse: este reporte no puede distinguirlas y no",
        "repara nada.",
    ]
    return "\n".join(lineas)


def main() -> None:
    # Código de salida SIEMPRE 0: las anomalías encontradas SON el output
    # esperado de un diagnóstico, no una falla de proceso.
    parser = argparse.ArgumentParser(
        description="Inventario de solo lectura de anomalías de pago y cobertura "
        "(superposiciones, cobertura incompatible, meses no derivables). "
        "No escribe nada; ver issue #400."
    )
    parser.add_argument("--json", action="store_true", help="Salida en JSON.")
    args = parser.parse_args()

    # El destino NO se toma de argv: `settings` lo resuelve desde el entorno,
    # que es el único canal por el que se elige contra qué base corre esto.
    engine = create_engine(settings.database_url)
    try:
        with sessionmaker(bind=engine)() as session:
            inventario = construir_inventario(session)
    finally:
        engine.dispose()

    print(formatear_json(inventario) if args.json else formatear_texto(inventario))


if __name__ == "__main__":
    main()
