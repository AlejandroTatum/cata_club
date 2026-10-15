"""
Tarea Celery Beat diaria: aviso de cumpleaños a los administradores (S6).

Cada día del club se arma UNA notificación in-app por administrador activo con
los jugadores que cumplen años hoy (ver `cumpleanos_repositorio`). Sin
cumpleaños no hay fila. Es exclusivamente in-app: nada de correo y nada a
jugadores ni a familias.

Idempotencia: la dedup es por `(tipo, administrador, día del club)`, la misma
ventana que usa el resumen de mora, así que reejecutar la tarea el mismo día
(reintento de Beat) no duplica el aviso.
"""
from datetime import datetime
import logging

from sqlalchemy import select

from app.dominio.enums import TipoNotificacion
from app.dominio.modelos import Notificacion
from app.infraestructura.db import SessionLocal
from app.infraestructura.tareas.alertas_tareas import (
    _listar_administradores,
    _rango_dia_club,
)
from app.infraestructura.tareas.celery_app import celery_app
from app.infraestructura.repositorios.cumpleanos_repositorio import CumpleanosHoy, cumpleanos_de_hoy
from app.soporte_transversal.tiempo import hoy_club


logger = logging.getLogger("cataclub.tareas.cumpleanos")
logger.setLevel(logging.INFO)

# `Notificacion.MENSAJE_MAX` es 500; el margen cubre el encabezado y el
# "y N más" del recorte.
_LIMITE_LISTA = 420

# Un nombre aislado no debe comerse el cupo de toda la lista.
_LIMITE_NOMBRE = 60


def _acortar(nombre: str) -> str:
    if len(nombre) <= _LIMITE_NOMBRE:
        return nombre
    return nombre[: _LIMITE_NOMBRE - 1].rstrip() + "…"


def _formatear_aviso(hoy, cumpleaneros: list[CumpleanosHoy]) -> str:
    """Texto del aviso: encabezado con la fecha y `Nombre (edad)` por jugador.
    Pura -- sin I/O. Si la lista no cabe, corta y dice cuántos faltan."""
    entradas = [
        f"{_acortar(c.nombre)} ({c.edad})" for c in cumpleaneros
    ]
    visibles: list[str] = []
    largo = 0
    for entrada in entradas:
        if visibles and largo + len(entrada) + 2 > _LIMITE_LISTA:
            break
        visibles.append(entrada)
        largo += len(entrada) + 2
    lista = ", ".join(visibles)
    restantes = len(entradas) - len(visibles)
    if restantes:
        lista += f" y {restantes} más"
    return f"Cumpleaños de hoy ({hoy.strftime('%d/%m/%Y')}): {lista}"


def _admins_ya_avisados_hoy(
    db, persona_ids: set[int], inicio_dia: datetime, fin_dia: datetime
) -> set[int]:
    """Un solo `SELECT` con los administradores que ya tienen el aviso de hoy."""
    if not persona_ids:
        return set()
    filas = db.execute(
        select(Notificacion.persona_id).where(
            Notificacion.tipo == TipoNotificacion.CUMPLEANOS_HOY_ADMIN,
            Notificacion.persona_id.in_(persona_ids),
            Notificacion.fecha_creacion >= inicio_dia,
            Notificacion.fecha_creacion < fin_dia,
        )
    ).all()
    return {fila.persona_id for fila in filas}


@celery_app.task(
    name="app.infraestructura.tareas.cumpleanos_tareas.avisar_cumpleanos_del_dia",
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    max_retries=3,
    retry_jitter=True,
)
def avisar_cumpleanos_del_dia(self) -> dict:
    """Ejecución diaria: una notificación in-app por administrador con los
    jugadores que cumplen años hoy; nada si no hay ninguno."""
    hoy = hoy_club()
    avisos_admin = 0

    with SessionLocal() as db:
        cumpleaneros = cumpleanos_de_hoy(db, hoy)
        total = len(cumpleaneros)
        if cumpleaneros:
            mensaje = _formatear_aviso(hoy, cumpleaneros)
            inicio_dia, fin_dia = _rango_dia_club(hoy)
            admins = _listar_administradores(db)
            ya_avisados = _admins_ya_avisados_hoy(
                db, {admin.persona.id for admin in admins}, inicio_dia, fin_dia
            )
            lote = [
                Notificacion(
                    tipo=TipoNotificacion.CUMPLEANOS_HOY_ADMIN,
                    mensaje=mensaje,
                    persona_id=admin.persona.id,
                )
                for admin in admins
                if admin.persona.id not in ya_avisados
            ]
            db.add_all(lote)
            db.commit()
            avisos_admin = len(lote)

    logger.info(
        "Cumpleaños %s -> %d jugadores, %d avisos a administradores",
        hoy.isoformat(), total, avisos_admin,
    )
    return {
        "fecha": hoy.isoformat(),
        "total_cumpleanos": total,
        "avisos_admin": avisos_admin,
    }
