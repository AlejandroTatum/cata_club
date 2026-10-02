"""Registro de actividad por usuario, día y franja del club (issue #1314).

Alimenta "Personas que ingresaron" de la pantalla de actividad del club: una
fila por (usuario, día del club, franja de 2 h) en `actividad_usuario`, más
`Usuario.ultimo_acceso`. Lo invocan el login, el refresh y la primera petición
autenticada de cada franja (ver `presencia.py`).

El registro es observacional: ninguna falla acá puede tumbar la operación que
lo dispara, así que los callers lo envuelven (`registrar_sin_fallar`).
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timezone

from sqlalchemy import update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.dominio.modelos import ActividadUsuario, Usuario
from app.infraestructura.db import SessionLocal
from app.soporte_transversal.tiempo import ZONA_HORARIA_CLUB

_log = logging.getLogger("cataclub.infraestructura.actividad")

HORAS_POR_FRANJA = 2
FRANJAS_POR_DIA = 24 // HORAS_POR_FRANJA

# Fábrica de la sesión propia de `registrar_actividad_aislada`. Módulo-nivel y
# reemplazable a propósito: los tests no deben escribir de verdad (y con
# commit) en la base compartida desde cada petición autenticada.
_sesion_factory = SessionLocal


def fecha_y_franja_del_club(instante: datetime) -> tuple[date, int]:
    """Día de calendario y franja (0..11) del CLUB para un instante.

    El día es el de `America/Guayaquil`, no el de UTC: la franja de las
    19:00-21:00 del club cruza la medianoche UTC.
    """
    local = instante.astimezone(ZONA_HORARIA_CLUB)
    return local.date(), local.hour // HORAS_POR_FRANJA


def registrar_actividad(db: Session, usuario_id: int, ahora: datetime | None = None) -> None:
    """Upsert idempotente de la actividad y marca de `ultimo_acceso`.

    No hace commit: lo decide el caller (login/refresh comitean en su propia
    transacción; la variante aislada abre y comitea la suya).
    """
    ahora = ahora or datetime.now(timezone.utc)
    fecha, franja = fecha_y_franja_del_club(ahora)
    db.execute(
        pg_insert(ActividadUsuario)
        .values(usuario_id=usuario_id, fecha=fecha, franja=franja)
        .on_conflict_do_nothing()
    )
    db.execute(update(Usuario).where(Usuario.id == usuario_id).values(ultimo_acceso=ahora))


def registrar_sin_fallar(db: Session, usuario_id: int) -> None:
    """`registrar_actividad` + commit sobre la sesión del caller, tragándose
    cualquier falla: perder un punto del gráfico es aceptable, perder un
    login no."""
    try:
        registrar_actividad(db, usuario_id)
        db.commit()
    except Exception:
        db.rollback()
        _log.warning("No se pudo registrar la actividad del usuario", exc_info=True)


def registrar_actividad_aislada(usuario_id: int) -> None:
    """Variante para la dependencia de autenticación: usa una sesión PROPIA
    (comitear la de la petición a mitad de camino expiraría los objetos que el
    handler ya cargó y confundiría las lecturas de solo lectura, que nunca
    comitean). Corre a lo sumo una vez por usuario y franja."""
    try:
        with _sesion_factory() as db:
            registrar_actividad(db, usuario_id)
            db.commit()
    except Exception:
        _log.warning("No se pudo registrar la actividad del usuario", exc_info=True)
