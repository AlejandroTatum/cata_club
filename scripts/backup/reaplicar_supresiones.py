"""Reaplicación de supresiones ejecutadas sobre una base restaurada (issue #1062, D6).

Un restore desde un backup anterior reintroduce los datos identificables de
personas cuya supresión ya se había EJECUTADO después de la fecha del backup.
Este script cierra esa ventana con UN solo criterio de "borrado": la
re-ejecución pasa por `SupresionDatosServicio`, exactamente el mismo camino
que la supresión original. Nada de duplicar el scrub acá.

Dos fases, deliberadamente separadas:

  export   Contra la base VIVA (antes de decomisionarla): vuelca a JSON las
           solicitudes EJECUTADAS. Ejecutarlo ANTES de restaurar es lo que
           da la nómina completa; si la base viva está ilegible, se usa el
           export más reciente disponible y la brecha queda documentada por
           el operador -- el script nunca inventa completitud.
  reapply  Contra la base RESTAURADA: por cada supresión exportada,
             - ya EJECUTADA en la restaurada  -> SKIP (idempotente);
             - persona ya suprimida             -> SKIP (nada identificable);
             - solicitud ausente (creada después del backup) -> se RECREA
               desde el export y se ejecuta;
             - solicitud RECIBIDA (el backup la precedió) -> se aprueba y
               se ejecuta;
             - guardia D2/D3 bloqueante          -> FALLO reportado: es una
               DISCREPANCIA que el admin debe resolver, no un skip silencioso.

El exit code es != 0 si ALGUNA reaplicación falló o fue bloqueada, para que
el runbook pueda usarlo como gate ANTES de reabrir el sistema.

Importa `app.*` a propósito (un solo código de borrado), así que corre con el
venv del backend, NO con el python del sistema:

    cd backend && uv run python ../scripts/backup/reaplicar_supresiones.py \
        export --db-url postgresql+psycopg://... -o supresiones.json
    cd backend && uv run python ../scripts/backup/reaplicar_supresiones.py \
        reapply --db-url postgresql+psycopg://... supresiones.json

Sin `--db-url` se usa `DATABASE_URL` (la misma variable de la app). El destino
de Cloudinary se destruye de nuevo por el servicio: repetir `destroy` de un
recurso inexistente no es error (ver el docstring del servicio).
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

# El script vive en scripts/backup/ pero importa `app.*` del backend: se
# agrega la raíz del backend al path en vez de exigir instalar el paquete.
_BACKEND = Path(__file__).resolve().parent.parent.parent / "backend"
sys.path.insert(0, str(_BACKEND))

from sqlalchemy import create_engine, func, select, text  # noqa: E402
from sqlalchemy.orm import Session, sessionmaker  # noqa: E402

from app.dominio.modelos import Persona, SolicitudSupresionDatos  # noqa: E402
from app.servicios_negocio.supresion_datos_servicio import (  # noqa: E402
    _cedula_sentinela,
    _NOMBRES_SUPRIDOS,
    SupresionDatosServicio,
)

VERSION_EXPORT = 1


# --- Fase 1: export -----------------------------------------------------------


def exportar_supresiones(db: Session) -> dict:
    """Nómina de las supresiones EJECUTADAS en la base que va a restaurarse.

    Guarda los campos de la solicitud, no el contenido de la persona: la
    identidad a suprimir se lee de la base RESTAURADA al reaplicar, y la fila
    `Persona` del backup ya trae los datos que hay que borrar.
    """
    filas = (
        db.execute(
            select(SolicitudSupresionDatos).where(
                SolicitudSupresionDatos.estado == "EJECUTADA"
            )
        )
        .scalars()
        .all()
    )
    solicitudes = [
        {
            "solicitud_id": s.id,
            "persona_id": s.persona_id,
            "estado": s.estado,
            "motivo": s.motivo,
            "notas": s.notas,
            "solicitada_por_persona_id": s.solicitada_por_persona_id,
            "aprobada_por_persona_id": s.aprobada_por_persona_id,
            "fecha_solicitud": s.fecha_solicitud.isoformat(),
            "fecha_aprobacion": (
                s.fecha_aprobacion.isoformat() if s.fecha_aprobacion else None
            ),
            "fecha_ejecucion": (
                s.fecha_ejecucion.isoformat() if s.fecha_ejecucion else None
            ),
            "detalle_ejecucion": s.detalle_ejecucion,
        }
        for s in filas
    ]
    return {
        "version": VERSION_EXPORT,
        "exportado_en": datetime.now(timezone.utc).isoformat(),
        "cantidad": len(solicitudes),
        "solicitudes": solicitudes,
    }


# --- Fase 2: reapply ----------------------------------------------------------


def _parsear_fecha(valor):
    return datetime.fromisoformat(valor) if valor else None


def _solicitud_de_persona(db: Session, persona_id: int):
    return (
        db.execute(
            select(SolicitudSupresionDatos)
            .where(SolicitudSupresionDatos.persona_id == persona_id)
            .order_by(SolicitudSupresionDatos.id.desc())
        )
        .scalars()
        .first()
    )


def _persona_ya_suprimida(persona: Persona) -> bool:
    return (
        persona.nombres == _NOMBRES_SUPRIDOS
        and persona.cedula == _cedula_sentinela(persona.id)
    )


def reaplicar_una(db: Session, registro: dict, admin_persona_id: int) -> dict:
    """Reaplica UNA supresión exportada. Nunca lanza: devuelve el resultado.

    `{"persona_id", "solicitud_id", "resultado": "SKIP_*"|"REAPLICADA",
    "detalle"}` para los caminos normales, `{"persona_id", "fallo": mensaje}`
    para las discrepancias que el operador debe resolver.
    """
    persona_id = registro["persona_id"]
    base = {"persona_id": persona_id, "solicitud_id": registro.get("solicitud_id")}

    persona = db.get(Persona, persona_id)
    if persona is None:
        return {**base, "fallo": "la persona no existe en la base restaurada"}

    solicitud = _solicitud_de_persona(db, persona_id)
    por_id = db.get(SolicitudSupresionDatos, registro["solicitud_id"])
    if por_id is not None and por_id.persona_id != persona_id:
        return {
            **base,
            "fallo": (
                f"la solicitud {por_id.id} de la base restaurada pertenece a otra "
                f"persona (persona_id={por_id.persona_id}): discrepancia de ids, "
                "resolver a mano"
            ),
        }
    if solicitud is None:
        solicitud = por_id

    # Idempotencia 1: ya ejecutada en la restaurada. Nada que hacer.
    if solicitud is not None and solicitud.estado == "EJECUTADA":
        return {
            **base,
            "solicitud_id": solicitud.id,
            "resultado": "SKIP_EJECUTADA",
            "detalle": "la base restaurada ya la tiene EJECUTADA",
        }

    # Idempotencia 2: la persona ya salió suprimida (restore posterior a la
    # ejecución, p. ej. otro restore encima). Solo se reasienta la fila si
    # falta, para que la auditoría muestre la decisión.
    if _persona_ya_suprimida(persona):
        if solicitud is None:
            servicio = SupresionDatosServicio(db)
            nueva = SolicitudSupresionDatos(
                id=registro["solicitud_id"],
                persona_id=persona_id,
                solicitada_por_persona_id=registro.get("solicitada_por_persona_id"),
                motivo=registro.get("motivo") or "reaplicación post-restore",
                estado="EJECUTADA",
                notas=registro.get("notas"),
                fecha_solicitud=_parsear_fecha(registro["fecha_solicitud"]),
                fecha_ejecucion=datetime.now(timezone.utc),
                detalle_ejecucion=(
                    "reaplicación post-restore: persona ya suprimida; fila "
                    "reasentada desde el export para conservar la decisión"
                ),
            )
            db.add(nueva)
            db.commit()
            return {
                **base,
                "solicitud_id": nueva.id,
                "resultado": "SKIP_YA_SUPRIMIDA",
                "detalle": "persona ya suprimida; solicitud EJECUTADA reasentada",
            }
        return {
            **base,
            "solicitud_id": solicitud.id,
            "resultado": "SKIP_YA_SUPRIMIDA",
            "detalle": "persona ya suprimida; solicitud sin re-ejecutar",
        }

    # Discrepancia histórica: la decisión fue ejecutarla; RECHAZADA no puede
    # ser el estado de una base que se restauró hacia atrás.
    if solicitud is not None and solicitud.estado == "RECHAZADA":
        return {
            **base,
            "fallo": (
                "la solicitud figura RECHAZADA en la base restaurada pero el "
                "export la tiene EJECUTADA: discrepancia, resolver a mano"
            ),
        }

    servicio = SupresionDatosServicio(db)

    if solicitud is None:
        # La solicitud nació después del backup: se RECREA desde el export ya
        # APROBADA (la decisión histórica incluyó aprobación y ejecución) y
        # con su fecha original, que ya venció el plazo de gracia (D8).
        solicitud = SolicitudSupresionDatos(
            id=registro["solicitud_id"],
            persona_id=persona_id,
            solicitada_por_persona_id=registro.get("solicitada_por_persona_id"),
            aprobada_por_persona_id=(
                registro.get("aprobada_por_persona_id") or admin_persona_id
            ),
            motivo=registro.get("motivo") or "reaplicación post-restore",
            estado="APROBADA",
            notas=registro.get("notas"),
            fecha_solicitud=_parsear_fecha(registro["fecha_solicitud"]),
            fecha_aprobacion=(
                _parsear_fecha(registro["fecha_aprobacion"])
                or datetime.now(timezone.utc)
            ),
        )
        db.add(solicitud)
        db.commit()
    elif solicitud.estado == "RECIBIDA":
        # El backup precede a la aprobación: se restaura la decisión de
        # aprobar antes de poder re-ejecutar (ejecutar exige APROBADA).
        servicio.aprobar(solicitud.id, admin_persona_id=admin_persona_id)

    # UN solo código de borrado: el servicio, con sus guardias D2/D3 vivas
    # contra los datos RESTAURADOS. Un bloqueo acá es una discrepancia real
    # (p. ej. el backup reintrodujo un pago pendiente) y se reporta.
    try:
        ejecutada = servicio.ejecutar(solicitud.id, admin_persona_id=admin_persona_id)
    except Exception as exc:  # noqa: BLE001 - el reporte es el contrato
        db.rollback()
        return {
            **base,
            "fallo": f"la ejecución del servicio fue bloqueada: {exc}",
        }

    return {
        **base,
        "solicitud_id": ejecutada.id,
        "resultado": "REAPLICADA",
        "detalle": ejecutada.detalle_ejecucion,
    }


def reaplicar_supresiones(
    db: Session, export: dict, admin_persona_id: int
) -> list[dict]:
    resultados = [
        reaplicar_una(db, registro, admin_persona_id)
        for registro in export.get("solicitudes", [])
    ]
    return resultados


def _hubo_fallos(resultados: list[dict]) -> bool:
    return any("fallo" in r for r in resultados)


def _reparar_secuencia_ids(db: Session) -> None:
    """Recrear solicitudes con id explicito deja la secuencia del serial
    atras: el siguiente INSERT automatico chocaria con un id ya usado. Solo
    aplica a PostgreSQL (serial/identity); otro dialecto no tiene nada que
    reparar."""
    if db.bind.dialect.name != "postgresql":
        return
    tabla = SolicitudSupresionDatos.__table__.name
    secuencia = db.execute(
        select(func.pg_get_serial_sequence(tabla, "id"))
    ).scalar()
    if not secuencia:
        return
    db.execute(
        text(
            "SELECT setval(:seq, COALESCE((SELECT MAX(id) FROM "
            f"{tabla}), 1))"
        ),
        {"seq": secuencia},
    )
    db.commit()


# --- CLI ----------------------------------------------------------------------


def _imprimir_reporte(export: dict, resultados: list[dict]) -> None:
    print(f"Supresiones en el export: {export.get('cantidad', len(resultados))}")
    for r in resultados:
        if "fallo" in r:
            print(f"  FALLO     persona={r['persona_id']}: {r['fallo']}")
        else:
            print(f"  {r['resultado']:<16} persona={r['persona_id']} "
                  f"solicitud={r['solicitud_id']}: {r['detalle']}")


def _motor(db_url: str):
    engine = create_engine(db_url)
    return sessionmaker(bind=engine)()


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description="Exporta o reaplica supresiones de datos ejecutadas (issue #1062)."
    )
    sub = parser.add_subparsers(dest="comando", required=True)

    def agregar_db(p):
        p.add_argument(
            "--db-url",
            default=None,
            help="URL SQLAlchemy de la base (default: DATABASE_URL del entorno).",
        )

    p_export = sub.add_parser(
        "export", help="Exportar solicitudes EJECUTADAS de la base VIVA a JSON."
    )
    agregar_db(p_export)
    p_export.add_argument("-o", "--salida", required=True, help="Archivo JSON destino.")

    p_re = sub.add_parser(
        "reapply", help="Reaplicar un export contra la base RESTAURADA."
    )
    agregar_db(p_re)
    p_re.add_argument("export_json", help="JSON producido por `export`.")
    p_re.add_argument(
        "--admin-persona-id",
        type=int,
        required=True,
        help="Persona id del admin que queda como actor de la reaplicación.",
    )

    args = parser.parse_args(argv)

    db_url = args.db_url
    if not db_url:
        # Import diferido: `settings` valida el entorno al importarse y solo
        # el modo sin --db-url lo necesita.
        from app.soporte_transversal.configuracion import settings

        db_url = settings.database_url

    db = _motor(db_url)
    try:
        if args.comando == "export":
            datos = exportar_supresiones(db)
            Path(args.salida).write_text(
                json.dumps(datos, indent=2, ensure_ascii=False), encoding="utf-8"
            )
            print(
                f"Exportadas {datos['cantidad']} supresiones EJECUTADAS "
                f"a {args.salida}"
            )
            return 0

        export = json.loads(Path(args.export_json).read_text(encoding="utf-8"))
        resultados = reaplicar_supresiones(db, export, args.admin_persona_id)
        _reparar_secuencia_ids(db)
        _imprimir_reporte(export, resultados)
        if _hubo_fallos(resultados):
            print(
                "REAPLICACION INCOMPLETA: hay discrepancias sin resolver. NO "
                "reabras el sistema con la base en este estado."
            )
            return 1
        print("REAPLICACION OK")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
