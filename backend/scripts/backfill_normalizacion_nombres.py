"""Backfill REVERSIBLE de `Persona.nombres`/`apellidos` legado (issue #875).
Usa `clasificar` (#904); reescribe `cambio_propuesto` con `update(Persona)`
de Core, con `--confirmar-cambios N` EXACTO y artifact de reversión previo
a cualquier escritura. `--revertir` (sin ruta) restaura desde el artifact
más reciente. Runbook: docs/operations/backfill-normalizacion-nombres.md.
"""
import argparse
import json
import os
import sys
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select, update
from sqlalchemy.engine import create_engine
from sqlalchemy.orm import Session, sessionmaker

_RAIZ_BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_RAIZ_BACKEND))

from app.dominio.modelos import Persona  # noqa: E402
from app.dominio.nombre_propio import clasificar  # noqa: E402
from app.soporte_transversal.configuracion import settings  # noqa: E402
from scripts.sesion_solo_lectura import abrir_sesion_solo_lectura  # noqa: E402

_CLASES = ("sin_cambio", "cambio_propuesto", "ambiguo")
_CAMPOS = ("nombres", "apellidos")
_PREFIJO_ARTIFACT = "backfill-nombres"


@dataclass(frozen=True)
class Cambio:
    persona_id: int
    campo: str
    antes: str
    despues: str


@dataclass(frozen=True)
class Plan:
    cambios: list[Cambio]
    conteos: dict[str, dict[str, int]]
    total_filas: int


def construir_plan(session: Session) -> Plan:
    """Orden determinístico (`persona_id`, luego campo). Solo `cambio_propuesto` entra a `cambios`."""
    with session.no_autoflush:
        personas = session.execute(
            select(Persona.id, Persona.nombres, Persona.apellidos).order_by(Persona.id)
        ).all()
    conteos = {campo: dict.fromkeys(_CLASES, 0) for campo in _CAMPOS}
    cambios: list[Cambio] = []
    for persona_id, nombres, apellidos in personas:
        valores = {"nombres": nombres, "apellidos": apellidos}
        for campo in _CAMPOS:
            resultado = clasificar(valores[campo])
            conteos[campo][resultado.clase] += 1
            if resultado.clase == "cambio_propuesto":
                cambios.append(Cambio(persona_id, campo, valores[campo], resultado.valor_normalizado))
    return Plan(cambios=cambios, conteos=conteos, total_filas=len(personas))


def construir_ruta_artifact() -> Path:
    """Ruta fija desde `Path.cwd()`, nunca argv/env (cero path injection)."""
    directorio = Path.cwd() / "artifacts-restringidos"
    directorio.mkdir(mode=0o700, exist_ok=True)
    marca = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return directorio / f"{_PREFIJO_ARTIFACT}-{marca}.json"


def escribir_artifact(datos: dict, ruta: Path) -> None:
    """Modo `0600`, nunca sobrescribe (contiene nombres, dato personal)."""
    if ruta.exists():
        raise FileExistsError(f"El artifact ya existe, no se sobrescribe: {ruta}")
    descriptor = os.open(ruta, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as archivo:
            json.dump(datos, archivo, ensure_ascii=False, indent=2)
    except Exception:
        ruta.unlink(missing_ok=True)
        raise


def aplicar(session: Session, plan: Plan, confirmar_cambios: int) -> dict:
    """Aplica `plan.cambios` solo si `confirmar_cambios` coincide EXACTO. Artifact
    primero; UPDATE optimista (WHERE `campo == antes`) salta filas cambiadas entre medio."""
    if confirmar_cambios != len(plan.cambios):
        raise ValueError(f"--confirmar-cambios {confirmar_cambios} != plan revisado ({len(plan.cambios)}). Nada aplicado.")
    if not plan.cambios:
        return {"ruta": None, "aplicados": 0, "omitidos": 0}  # nada que artifactar
    ruta = construir_ruta_artifact()
    escribir_artifact({"cambios": [asdict(c) for c in plan.cambios], "conteos_antes": plan.conteos}, ruta)
    aplicados = 0
    for cambio in plan.cambios:
        columna = getattr(Persona, cambio.campo)
        resultado = session.execute(
            update(Persona)
            .where(Persona.id == cambio.persona_id, columna == cambio.antes)
            .values(**{cambio.campo: cambio.despues})
        )
        aplicados += resultado.rowcount
    session.commit()
    return {"ruta": ruta, "aplicados": aplicados, "omitidos": len(plan.cambios) - aplicados}


def revertir(session: Session) -> dict:
    """Artifact más reciente; restaura `antes` (WHERE `campo == despues`, optimista),
    sin borrarlo. Rechaza (sin escribir nada) un `campo` fuera de `_CAMPOS`."""
    directorio = Path.cwd() / "artifacts-restringidos"
    candidatos = sorted(directorio.glob(f"{_PREFIJO_ARTIFACT}-*.json")) if directorio.exists() else []
    if not candidatos:
        return {"ruta": None, "restaurados": 0, "omitidos": 0}
    ruta = candidatos[-1]
    cambios = json.loads(ruta.read_text(encoding="utf-8"))["cambios"]
    for cambio in cambios:
        if cambio["campo"] not in _CAMPOS:
            raise ValueError(f"campo inesperado en el artifact: {cambio['campo']!r}")
    restaurados = 0
    for cambio in cambios:
        columna = getattr(Persona, cambio["campo"])
        resultado = session.execute(
            update(Persona)
            .where(Persona.id == cambio["persona_id"], columna == cambio["despues"])
            .values(**{cambio["campo"]: cambio["antes"]})
        )
        restaurados += resultado.rowcount
    session.commit()
    return {"ruta": ruta, "restaurados": restaurados, "omitidos": len(cambios) - restaurados}


def _lineas_conteos(conteos: dict[str, dict[str, int]]) -> list[str]:
    lineas: list[str] = []
    for campo in _CAMPOS:
        lineas.append(f"  {campo}:")
        lineas += [f"    {clase}: {conteos[campo][clase]}" for clase in _CLASES]
    return lineas


def formatear_plan(plan: Plan) -> str:
    cabecera = f"EN SECO -- cambios que aplicaría: {len(plan.cambios)} de {plan.total_filas} filas."
    return "\n".join([cabecera, *_lineas_conteos(plan.conteos)])


def formatear_aplicado(resultado: dict, plan_despues: Plan) -> str:
    artifact = resultado["ruta"] if resultado["ruta"] is not None else "(sin cambios, no se escribió)"
    cabecera = (
        f"APLICADO -- aplicados: {resultado['aplicados']}, omitidos: {resultado['omitidos']}, "
        f"artifact: {artifact}. Conteos después:"
    )
    return "\n".join([cabecera, *_lineas_conteos(plan_despues.conteos)])


def formatear_revertido(resultado: dict) -> str:
    if resultado["ruta"] is None:
        return "Sin artifact bajo ./artifacts-restringidos/. No se revirtió nada."
    return (
        f"REVERTIDO -- artifact: {resultado['ruta']}, restaurados: {resultado['restaurados']}, "
        f"omitidos: {resultado['omitidos']}."
    )


def construir_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Backfill reversible de nombres/apellidos (issue #875).")
    parser.add_argument("--aplicar", action="store_true", help="Aplica el backfill. Sin esta bandera corre en seco.")
    parser.add_argument("--confirmar-cambios", type=int, default=None, dest="confirmar_cambios", help="N exacto del dry-run; obligatorio con --aplicar.")
    parser.add_argument("--revertir", action="store_true", help="Restaura el artifact más reciente. Sin ruta.")
    return parser


def validar_argumentos(parser: argparse.ArgumentParser, args: argparse.Namespace) -> None:
    if args.aplicar and args.revertir:
        parser.error("--aplicar y --revertir son mutuamente excluyentes.")
    if args.aplicar and args.confirmar_cambios is None:
        parser.error("--aplicar requiere --confirmar-cambios N.")


def main() -> None:
    parser = construir_parser()
    args = parser.parse_args()
    validar_argumentos(parser, args)

    engine = create_engine(settings.database_url)  # El destino sale del entorno, nunca de argv.
    try:
        if args.revertir:
            with sessionmaker(bind=engine)() as sesion:
                resultado = revertir(sesion)
            print(formatear_revertido(resultado))
            return
        if args.aplicar:
            with sessionmaker(bind=engine)() as sesion:
                plan = construir_plan(sesion)
                try:
                    resultado = aplicar(sesion, plan, args.confirmar_cambios)
                except ValueError as error:
                    print(str(error))
                    sys.exit(2)
                plan_despues = construir_plan(sesion)
            print(formatear_aplicado(resultado, plan_despues))
            return
        with abrir_sesion_solo_lectura(engine) as sesion:
            plan = construir_plan(sesion)
        print(formatear_plan(plan))
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
