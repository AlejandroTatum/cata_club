"""Dry-run de solo lectura de `Persona.nombres`/`apellidos` (issue #904).
Aplica `clasificar` vía `abrir_sesion_solo_lectura` (compartida con #902);
ninguna escritura sin aprobación humana (#875). Reporte GENERAL: solo
conteos e ids. Artifact RESTRINGIDO opcional (`--artifact`, booleano): ruta
fija bajo `./artifacts-restringidos/`, `0600`, no sobrescribe."""
import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.engine import create_engine
from sqlalchemy.orm import Session

_RAIZ_BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_RAIZ_BACKEND))

from app.dominio.modelos import Persona  # noqa: E402
from app.soporte_transversal.configuracion import settings  # noqa: E402
from scripts.normalizacion_nombres import clasificar  # noqa: E402
from scripts.sesion_solo_lectura import abrir_sesion_solo_lectura  # noqa: E402

_CLASES = ("sin_cambio", "cambio_propuesto", "ambiguo")


def construir_dry_run(session: Session) -> dict:
    """`{"general": redactado, "pares": antes/después del artifact}`."""
    with session.no_autoflush:
        personas = session.execute(select(Persona.id, Persona.nombres, Persona.apellidos)).all()
    conteos_clase = dict.fromkeys(_CLASES, 0)
    conteos_motivo: dict[str, int] = {}
    ids_por_clase: dict[str, set[int]] = {clase: set() for clase in _CLASES}
    pares: list[dict] = []
    for persona_id, nombres, apellidos in personas:
        for campo, valor in (("nombres", nombres), ("apellidos", apellidos)):
            resultado = clasificar(valor)
            conteos_clase[resultado.clase] += 1
            ids_por_clase[resultado.clase].add(persona_id)
            for motivo in resultado.motivos:
                conteos_motivo[motivo] = conteos_motivo.get(motivo, 0) + 1
            pares.append({
                "persona_id": persona_id, "campo": campo, "antes": valor,
                "despues": resultado.valor_normalizado, "clase": resultado.clase, "motivos": list(resultado.motivos),
            })
    ids = {c: sorted(v) for c, v in ids_por_clase.items()}
    general = {"conteos_por_clase": conteos_clase, "conteos_por_motivo": conteos_motivo, "ids_por_clase": ids}
    return {"general": general, "pares": pares}


def construir_ruta_artifact() -> Path:
    """Ruta fija desde `Path.cwd()`, nunca argv/env (cero path injection)."""
    directorio = Path.cwd() / "artifacts-restringidos"
    directorio.mkdir(mode=0o700, exist_ok=True)
    marca = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return directorio / f"dry-run-nombres-{marca}.json"


def escribir_artifact(pares: list[dict], ruta: Path) -> None:
    """Modo `0600`, nunca sobrescribe (contiene nombres, dato personal)."""
    if ruta.exists():
        raise FileExistsError(f"El artifact ya existe, no se sobrescribe: {ruta}")
    descriptor = os.open(ruta, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as archivo:
            json.dump(pares, archivo, ensure_ascii=False, indent=2)
    except Exception:
        ruta.unlink(missing_ok=True)
        raise


def formatear_json(general: dict) -> str:
    return json.dumps(general, ensure_ascii=False, indent=2)


def formatear_texto(general: dict) -> str:
    lineas = ["Dry-run de normalización de nombres (issue #904)", "", "Conteos por clase:"]
    lineas += [f"  {c}: {n}" for c, n in general["conteos_por_clase"].items()]
    lineas += ["", "Conteos por motivo de ambigüedad:"]
    lineas += [f"  {m}: {n}" for m, n in sorted(general["conteos_por_motivo"].items())]
    lineas += ["", "Ids de persona por clase:"]
    lineas += [f"  {c}: {ids}" for c, ids in general["ids_por_clase"].items()]
    if "artifact_en" in general:
        lineas += ["", f"Artifact escrito en: {general['artifact_en']}"]
    return "\n".join(lineas)


def ejecutar(sesion: Session, *, como_json: bool, artifact: bool) -> str:
    """La ruta del artifact se construye acá mismo desde `Path.cwd()`."""
    resultado = construir_dry_run(sesion)
    general = resultado["general"]
    if artifact:
        ruta = construir_ruta_artifact()
        escribir_artifact(resultado["pares"], ruta)
        general = {**general, "artifact_en": str(ruta)}
    return formatear_json(general) if como_json else formatear_texto(general)


def main() -> None:
    # Código de salida SIEMPRE 0: un valor ambiguo es el resultado esperado.
    parser = argparse.ArgumentParser(description="Dry-run de normalización de nombres/apellidos (issue #904).")
    parser.add_argument("--json", action="store_true", help="Salida general en JSON.")
    parser.add_argument("--artifact", action="store_true", help="Escribe el artifact bajo ./artifacts-restringidos/.")
    args = parser.parse_args()
    engine = create_engine(settings.database_url)  # El destino sale del entorno, nunca de argv.
    try:
        sesion = abrir_sesion_solo_lectura(engine)
        try:
            salida = ejecutar(sesion, como_json=args.json, artifact=args.artifact)
        finally:
            sesion.close()
    finally:
        engine.dispose()
    print(salida)


if __name__ == "__main__":
    main()
