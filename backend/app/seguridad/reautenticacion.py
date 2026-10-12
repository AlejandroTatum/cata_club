"""Step-up de contraseña para el cambio de roles (#1653, S5).

El administrador re-ingresa su contraseña (`POST /auth/reautenticar`) y la fila
`sesion` de SU equipo guarda la marca `reautenticada_en`. Los endpoints que
cambian roles exigen esa marca con menos de `VENTANA_REAUTENTICACION` de edad.

La marca vive en la fila de la sesión a propósito: así es por equipo (el step-up
del equipo A no autoriza al B), muere junto con la sesión (logout, revocación,
epoch) y no suma infraestructura nueva.
"""
from datetime import datetime, timedelta, timezone

from fastapi import Depends
from sqlalchemy.orm import Session

from app.dominio.excepciones import ReautenticacionRequerida
from app.dominio.modelos import Sesion
from app.infraestructura.db import obtener_sesion
from app.seguridad.gestor_auth import GestorAutenticacion

VENTANA_REAUTENTICACION = timedelta(minutes=10)


def ahora_utc() -> datetime:
    """Reloj del step-up; los tests lo reemplazan en vez de dormir."""
    return datetime.now(timezone.utc)


def reautenticacion_vigente(sesion: Sesion | None) -> bool:
    """Solo vale con una marca cuya edad sea ESTRICTAMENTE menor que la
    ventana: a los 10 minutos justos ya venció."""
    if sesion is None or sesion.reautenticada_en is None:
        return False
    edad = ahora_utc() - sesion.reautenticada_en
    return timedelta(0) <= edad < VENTANA_REAUTENTICACION


def exigir_reautenticacion_reciente(
    payload: dict = Depends(GestorAutenticacion.decodificar_token),
    db: Session = Depends(obtener_sesion),
) -> dict:
    """Dependencia de las rutas de cambio de roles. Va DESPUÉS de
    `GestorPermisos(["ADMINISTRADOR"])` en la lista de dependencias: quien no
    es administrador recibe el 403 de permisos, nunca el pedido de contraseña.

    Un token sin `sid` (anterior a la rotación, <= 60 min de vida) no tiene
    sesión a la que atar el step-up, así que tampoco lo tiene."""
    sid = payload.get("sid")
    sesion = db.get(Sesion, sid) if isinstance(sid, int) and not isinstance(sid, bool) else None
    if not reautenticacion_vigente(sesion):
        raise ReautenticacionRequerida(
            "Por seguridad, confirma tu contraseña para cambiar roles."
        )
    return payload
