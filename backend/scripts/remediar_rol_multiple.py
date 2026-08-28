"""Remediación de las cuentas multirol legadas del issue #762.

Esta es la ÚNICA operación autorizada para tocar una cuenta con más de un
rol activo. Existe aparte de la migración `e762rolunico` a propósito: la
migración detecta y registra, pero elegir cuál de los dos roles conservar
destruye información que después no se reconstruye, y esa decisión es del
dueño del club. Un deploy no puede tomarla por él.

Tres candados, y ninguno es cosmético:

  1. `--keep-role` es OBLIGATORIO y no tiene valor por defecto. No hay
     heurística de precedencia ni "se queda el más privilegiado": el script
     se niega a adivinar. Un rol que no esté entre los que la cuenta tiene
     es un error, no un no-op -- si el dueño escribe ENTRENADOR sobre una
     cuenta ADMINISTRADOR+ALUMNO, lo más probable es que se haya
     equivocado de cuenta.
  2. `--aplicar` es OBLIGATORIO para mutar. Sin él corre en seco: informa
     exactamente qué borraría y sale sin escribir nada.
  3. El destino sale SIEMPRE de `settings.database_url`, nunca de argv --
     misma regla que `scripts/inventario_anomalias_*.py`. Contra qué base
     corre esto se decide por entorno, que es un acto deliberado, no por
     una bandera que se copia y pega.

Revocación de sesiones (issue #4, criterio unificado): quitar un rol RETIRA
acceso, y el rol viaja EMBEBIDO en el access token. Sin bombear el epoch, un
token emitido antes de la remediación sigue autorizando el rol recién
quitado hasta que expire solo. Por eso se llama a `Usuario.revocar_sesiones()`
-- el único lugar del dominio que expresa "retirar acceso" -- y no se
inventa un segundo mecanismo al lado.

La lógica vive en `remediar_cuenta`, que recibe una `Session`, para que los
tests la ejerciten sin subproceso ni I/O (misma convención que los
inventarios). El `main()` solo arma la sesión y formatea.

Uso:
    uv run python scripts/remediar_rol_multiple.py --usuario-id 7 --keep-role ADMINISTRADOR
    uv run python scripts/remediar_rol_multiple.py --usuario-id 7 --keep-role ADMINISTRADOR --aplicar
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timezone

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.dominio.enums import TipoRol  # noqa: E402
from app.dominio.modelos import RolMultipleDetectado, Usuario  # noqa: E402
from app.soporte_transversal.configuracion import settings  # noqa: E402


def remediar_cuenta(
    session: Session,
    usuario_id: int,
    rol_conservado: TipoRol,
    aplicar: bool = True,
) -> dict:
    """Deja a la cuenta `usuario_id` con un solo rol: `rol_conservado`.

    Devuelve el resumen de lo que hizo (o de lo que haría, con
    `aplicar=False`). Lanza `ValueError` si la cuenta no existe o si el rol
    elegido no es uno de los que la cuenta tiene hoy.
    """
    usuario = session.get(Usuario, usuario_id)
    if usuario is None:
        raise ValueError(f"No existe una cuenta con usuario_id={usuario_id}.")

    tipos_actuales = sorted(rol.tipo_rol.value for rol in usuario.roles)
    if rol_conservado.value not in tipos_actuales:
        raise ValueError(
            f"La cuenta usuario_id={usuario_id} tiene {tipos_actuales} y no "
            f"{rol_conservado.value}. No se remedia nada: elegir un rol que "
            f"la cuenta no tiene es, casi siempre, haberse equivocado de "
            f"cuenta."
        )

    a_quitar = sorted(
        rol.tipo_rol.value for rol in usuario.roles
        if rol.tipo_rol is not rol_conservado
    )
    resumen = {
        "usuario_id": usuario_id,
        "roles_actuales": tipos_actuales,
        "rol_conservado": rol_conservado.value,
        "roles_a_quitar": a_quitar,
        "aplicado": False,
        "version_sesion_previa": usuario.version_sesion,
    }
    if not aplicar or not a_quitar:
        return resumen

    usuario.roles = [
        rol for rol in usuario.roles if rol.tipo_rol is rol_conservado
    ]
    # Issue #4: el rol viaja dentro del access token, así que quitarlo de la
    # base no basta -- hay que matar los tokens que todavía lo llevan.
    usuario.revocar_sesiones()
    _asentar_la_decision(session, usuario_id, rol_conservado)
    session.commit()

    resumen["aplicado"] = True
    resumen["version_sesion_nueva"] = usuario.version_sesion
    return resumen


def _asentar_la_decision(
    session: Session, usuario_id: int, rol_conservado: TipoRol,
) -> None:
    """Completa la fila que dejó la migración: de "detectado" a "remediado
    con esta decisión". Es el rastro de auditoría que un reemplazo implícito
    no dejaría -- queda por escrito qué rol se conservó y cuándo.

    Si no hay fila de detección (por ejemplo, una cuenta que quedó multirol
    por una vía distinta a la migración) se crea una: el asiento importa más
    que su origen."""
    registro = session.execute(
        select(RolMultipleDetectado)
        .where(RolMultipleDetectado.usuario_id == usuario_id)
        .where(RolMultipleDetectado.remediado_en.is_(None))
    ).scalars().first()
    if registro is None:
        registro = RolMultipleDetectado(
            usuario_id=usuario_id, roles_detectados="", cantidad_roles=0,
        )
        session.add(registro)
    registro.rol_conservado = rol_conservado.value
    registro.remediado_en = datetime.now(timezone.utc)


def formatear(resumen: dict) -> str:
    lineas = [
        f"usuario_id={resumen['usuario_id']}",
        f"  roles actuales : {resumen['roles_actuales']}",
        f"  se conserva    : {resumen['rol_conservado']}",
        f"  se quita       : {resumen['roles_a_quitar'] or '(nada)'}",
    ]
    if resumen["aplicado"]:
        lineas.append(
            f"  APLICADO. Sesiones revocadas: version_sesion "
            f"{resumen['version_sesion_previa']} -> "
            f"{resumen['version_sesion_nueva']}."
        )
    else:
        lineas.append(
            "  EN SECO: no se escribió nada. Volvé a correrlo con --aplicar "
            "para ejecutar esta remediación."
        )
    return "\n".join(lineas)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Deja una cuenta multirol legada (issue #762) con un solo "
        "rol activo, elegido explícitamente, y revoca sus sesiones. "
        "Sin --aplicar corre en seco."
    )
    parser.add_argument("--usuario-id", type=int, required=True)
    # `required=True` y sin `default`: el script no elige rol por nadie.
    parser.add_argument(
        "--keep-role", required=True, choices=[tipo.value for tipo in TipoRol],
        help="Rol que la cuenta conserva. Los demás se quitan.",
    )
    parser.add_argument(
        "--aplicar", action="store_true",
        help="Ejecuta la mutación. Sin esta bandera solo informa.",
    )
    args = parser.parse_args()

    engine = create_engine(settings.database_url)
    try:
        with sessionmaker(bind=engine)() as session:
            resumen = remediar_cuenta(
                session,
                usuario_id=args.usuario_id,
                rol_conservado=TipoRol(args.keep_role),
                aplicar=args.aplicar,
            )
    finally:
        engine.dispose()

    print(formatear(resumen))


if __name__ == "__main__":
    main()
