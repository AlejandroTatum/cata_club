"""Inventario de solo lectura de anomalías en `membresia` (issue #400).

Por qué existe: #400 exige documentar, con filas y conteos exactos, tres
clases de inconsistencia en el ciclo de pagos ANTES de tocar cualquier
escritura financiera. Este script DIAGNOSTICA -- nunca repara: ningún
`UPDATE`/`INSERT`/`DELETE`, y el código de salida es siempre 0 (ver
`main()`) porque un reporte no es un gate de CI. Sigue el patrón de
`scripts/reset_dev_db.py` (`validar_reset_permitido`): la lógica vive en
funciones puras que reciben una `Session` y devuelven estructuras planas,
así los tests las ejercitan directo sin subproceso ni I/O.

El reporte NUNCA expone datos privados de la persona (nombre, cédula,
teléfono, correo) -- solo IDs numéricos, montos, booleanos y conteos. Esa
es la garantía que permite pegar la salida en un issue de GitHub.

Sobre "no escribe": no alcanza con no emitir `UPDATE`/`INSERT` propios.
`Session` viene con `autoflush=True`, así que CUALQUIER `session.query(...)`
vacía primero los objetos sucios que el llamador tenga pendientes -- y estas
funciones reciben una `Session` ajena a propósito. Un llamador que las
componga dentro de un script más grande, o que las invoque a mitad de una
transacción, vería sus cambios pendientes bajar a la base por culpa de un
reporte. Por eso cada detector consulta dentro de `session.no_autoflush`:
sin eso la garantía del párrafo anterior es una intención, no un hecho.

Tres clases de anomalía:
  A1 -- `monto_aplicado` != `precio` VIGENTE del plan, sin contar gratuidad
        familiar (eso es A2). El plan pudo subir de precio después de la
        activación, o cargarse mal a mano: plata "flotando" sin explicar.
  A2 -- Gratuidad familiar y ceros inexplicados, en TRES subclases
        separadas porque significan cosas distintas:
          * `gratuidad` -- `es_gratuidad_familiar = True`, CUALQUIER
            tarifa. Hasta el slice 4c-b de #400 la gratuidad zereaba
            `monto_aplicado`, así que la bandera y el cero viajaban
            siempre juntos; desde ese slice la membresía conserva su
            tarifa real y la bandera es la única señal de "no paga" (ver
            `PagoServicio.registrar_pago`) -- una tarifa real con la
            bandera en `True` es ahora el caso NORMAL de cada membresía
            gratuita, no una incoherencia.
          * `cero_inexplicado` -- `monto_aplicado == 0` SIN la bandera:
            sigue significando lo mismo que antes, plata ambigua que
            ningún camino conocido del código produce (ni la gratuidad,
            que ya no zerea, ni la creación server-side, que copia
            `tipo.precio`; solo llega acá una fila con `tipo.precio == 0`
            en el catálogo, o una carga manual).
          * `gratuidad_incoherente` -- redefinida en este slice. Ya no
            puede significar "bandera True, monto != 0" (eso es lo
            esperado ahora). La única precondición que
            `_aplicar_regla_familiar_si_corresponde` exige ANTES de poner
            la bandera es que la persona representada tenga
            `representante_id`; la bandera nunca vuelve a `False` una vez
            puesta. Por lo tanto la única forma de que la bandera esté
            en `True` sin que la regla de negocio la explique es que la
            persona NO tenga representante -- eso solo puede pasar por
            fuera del camino normal (una corrección manual, una
            migración, un dato cargado directo). Esa es la nueva
            definición de "la bandera miente".
  A4 -- Más de una membresía no-ACTIVA por persona. El índice único parcial
        `uq_membresia_activa_por_persona` (`app/dominio/modelos.py`) solo
        guarda `estado = 'ACTIVA'`; en cualquier otro estado los duplicados
        se acumulan libres, y #400 exige a lo sumo una membresía operativa
        por persona.

El destino se toma SIEMPRE de `settings.database_url`, nunca de un argumento
de línea de comandos. Un `--database-url` libre convierte a argv en un canal
para redirigir la conexión a una base arbitraria, y este script se corre
contra la base real del club: quien necesite otro destino define
`DATABASE_URL` en el entorno, que es de donde `settings` ya lo lee.

Uso:
    uv run python scripts/inventario_anomalias_membresias.py [--json]
"""
import argparse
import json
import sys
from decimal import Decimal
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

_RAIZ_BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_RAIZ_BACKEND))

from app.dominio.enums import EstadoMembresia  # noqa: E402
from app.dominio.modelos import Membresia, Persona, TipoMembresia  # noqa: E402
from app.soporte_transversal.configuracion import settings  # noqa: E402


def detectar_deriva_de_tarifa(session: Session) -> list[dict]:
    """A1: `monto_aplicado != precio_vigente`, excluyendo gratuidad familiar
    y ceros (esos casos son A2, nunca deriva de tarifa)."""
    filas = []
    with session.no_autoflush:
        pares = session.query(Membresia, TipoMembresia).join(
            TipoMembresia, Membresia.tipo_membresia_id == TipoMembresia.id
        ).all()
    for membresia, tipo in pares:
        if membresia.es_gratuidad_familiar or membresia.monto_aplicado == 0:
            continue
        if membresia.monto_aplicado == tipo.precio:
            continue
        filas.append({
            "membresia_id": membresia.id, "tipo_membresia_id": tipo.id,
            "estado": membresia.estado.value, "monto_aplicado": membresia.monto_aplicado,
            "precio_vigente": tipo.precio, "delta": membresia.monto_aplicado - tipo.precio,
        })
    filas.sort(key=lambda f: f["membresia_id"])
    return filas


def detectar_importes_cero(session: Session) -> dict[str, list[dict]]:
    """A2: separa las tres subclases de gratuidad/cero -- NUNCA se
    fusionan, porque significan cosas distintas (ver docstring del
    módulo). Se une `Persona` (no solo `Membresia`/`TipoMembresia`) porque
    la subclase `incoherente` redefinida en el slice 4c-b necesita
    `representante_id`, la única precondición que
    `_aplicar_regla_familiar_si_corresponde` exige antes de poner la
    bandera."""
    gratuidad: list[dict] = []
    inexplicado: list[dict] = []
    incoherente: list[dict] = []

    with session.no_autoflush:
        filas_db = session.query(Membresia, TipoMembresia, Persona).join(
            TipoMembresia, Membresia.tipo_membresia_id == TipoMembresia.id
        ).join(
            Persona, Membresia.persona_id == Persona.id
        ).all()
    for membresia, tipo, persona in filas_db:
        fila = {
            "membresia_id": membresia.id, "tipo_membresia_id": tipo.id,
            "estado": membresia.estado.value, "monto_aplicado": membresia.monto_aplicado,
            "es_gratuidad_familiar": membresia.es_gratuidad_familiar,
            "precio_vigente": tipo.precio,
        }
        if membresia.es_gratuidad_familiar and persona.representante_id is None:
            # La única precondición de negocio para que la bandera exista
            # es "la persona representada tiene representante_id" -- si no
            # la cumple, ningún camino conocido del código pudo haberla
            # puesto en `True`.
            incoherente.append(fila)
        elif membresia.es_gratuidad_familiar:
            gratuidad.append(fila)
        elif membresia.monto_aplicado == 0:
            inexplicado.append(fila)

    for lista in (gratuidad, inexplicado, incoherente):
        lista.sort(key=lambda f: f["membresia_id"])

    return {
        "a2_gratuidad": gratuidad,
        "a2_cero_inexplicado": inexplicado,
        "a2_gratuidad_incoherente": incoherente,
    }


def detectar_membresias_no_activas_duplicadas(session: Session) -> list[dict]:
    """A4: personas con más de una membresía en `estado != ACTIVA`. El
    agrupamiento se hace en Python (no `GROUP BY`) porque el volumen de
    `membresia` es chico y así la lista de ids/estados por persona sale
    directo del mismo recorrido, sin una segunda consulta."""
    with session.no_autoflush:
        no_activas = (
            session.query(Membresia).filter(Membresia.estado != EstadoMembresia.ACTIVA).all()
        )

    por_persona: dict[int, list[Membresia]] = {}
    for membresia in no_activas:
        por_persona.setdefault(membresia.persona_id, []).append(membresia)

    filas = []
    for persona_id, membresias in por_persona.items():
        if len(membresias) <= 1:
            continue
        ordenadas = sorted(membresias, key=lambda m: m.id)
        filas.append({
            "persona_id": persona_id, "cantidad": len(ordenadas),
            "membresia_ids": [m.id for m in ordenadas],
            "estados": [m.estado.value for m in ordenadas],
        })
    filas.sort(key=lambda f: f["persona_id"])
    return filas


def construir_inventario(session: Session) -> dict:
    """Agregador: arma el reporte completo con conteos y filas por clase.
    Estructura ya serializable (solo dicts/listas/Decimal/bool/str/int),
    lista para `formatear_texto` o `formatear_json`."""
    deriva = detectar_deriva_de_tarifa(session)
    ceros = detectar_importes_cero(session)
    duplicadas = detectar_membresias_no_activas_duplicadas(session)
    return {
        "a1_deriva_de_tarifa": {"cantidad": len(deriva), "filas": deriva},
        "a2_importes_cero": {
            clave: {"cantidad": len(filas), "filas": filas} for clave, filas in ceros.items()
        },
        "a4_no_activas_duplicadas": {"cantidad": len(duplicadas), "filas": duplicadas},
    }


def _decimal_default(obj):
    """`json.dumps` no sabe serializar `Decimal` (money nunca es float, ver
    convención del repo) -- lo bajamos a `str` explícitamente para no
    perder precisión ni dejar que `json.dumps` explote con un TypeError."""
    if isinstance(obj, Decimal):
        return str(obj)
    raise TypeError(f"No se puede serializar {type(obj)!r} a JSON")


def formatear_json(inventario: dict) -> str:
    return json.dumps(inventario, default=_decimal_default, ensure_ascii=False, indent=2)


def formatear_texto(inventario: dict) -> str:
    lineas = ["Inventario de anomalías de membresías (issue #400)", ""]

    a1 = inventario["a1_deriva_de_tarifa"]
    lineas.append(f"A1 - Deriva de tarifa: {a1['cantidad']}")
    lineas += [
        f"  membresia={f['membresia_id']} tipo={f['tipo_membresia_id']} estado={f['estado']} "
        f"monto={f['monto_aplicado']} precio_vigente={f['precio_vigente']} delta={f['delta']}"
        for f in a1["filas"]
    ]

    etiquetas = {
        "a2_gratuidad": "A2 - Gratuidad familiar (tarifa real, no paga)",
        "a2_cero_inexplicado": "A2 - Cero inexplicado (dinero ambiguo)",
        "a2_gratuidad_incoherente": "A2 - Gratuidad incoherente (bandera sin representante)",
    }
    for clave, etiqueta in etiquetas.items():
        bloque = inventario["a2_importes_cero"][clave]
        lineas.append(f"{etiqueta}: {bloque['cantidad']}")
        lineas += [
            f"  membresia={f['membresia_id']} tipo={f['tipo_membresia_id']} estado={f['estado']} "
            f"monto={f['monto_aplicado']} gratuidad={f['es_gratuidad_familiar']} "
            f"precio_vigente={f['precio_vigente']}"
            for f in bloque["filas"]
        ]

    a4 = inventario["a4_no_activas_duplicadas"]
    lineas.append(f"A4 - Membresías no activas duplicadas por persona: {a4['cantidad']}")
    lineas += [
        f"  persona={f['persona_id']} cantidad={f['cantidad']} "
        f"membresias={f['membresia_ids']} estados={f['estados']}"
        for f in a4["filas"]
    ]

    return "\n".join(lineas)


def main() -> None:
    # Código de salida SIEMPRE 0 (nunca `sys.exit(1)` acá): las anomalías
    # encontradas SON el output esperado de un diagnóstico, no una falla de
    # proceso -- este script no es un gate de CI.
    parser = argparse.ArgumentParser(
        description="Inventario de solo lectura de anomalías de membresías "
        "(deriva de tarifa, importes en cero/gratuidad, duplicados no "
        "activos). No escribe nada; ver issue #400."
    )
    parser.add_argument("--json", action="store_true", help="Salida en JSON.")
    args = parser.parse_args()

    # El destino NO se toma de argv (ver docstring del módulo): `settings` lo
    # resuelve desde el entorno, que es el único canal por el que se elige
    # contra qué base corre este reporte.
    engine = create_engine(settings.database_url)
    try:
        with sessionmaker(bind=engine)() as session:
            inventario = construir_inventario(session)
    finally:
        engine.dispose()

    print(formatear_json(inventario) if args.json else formatear_texto(inventario))


if __name__ == "__main__":
    main()
