"""
Ayuda compartida para lecturas `SELECT ... FOR UPDATE` con timeout explícito
de Postgres (issue #451, hallazgo de la auditoría en vivo: reproducción
real de un deadlock de PROCESO -- 5m32s sin autorrecuperación, `/health`
incluido -- bajo pagos concurrentes sobre la misma fila). Único punto usado
por `PagoRepositorio.obtener_por_id_con_bloqueo` y `MembresiaRepositorio.
obtener_por_id_con_bloqueo`, así ningún caller nuevo puede olvidarse del
timeout.

Dos partes del mismo fix, ninguna alcanza sola:
  A. `run_in_threadpool` en los routers `async def` que llegan hasta acá
     (ver `membresias_pagos_router.py`) saca esta espera del hilo del event
     loop -- sin eso, quien pierde la carrera por el lock bloquea el ÚNICO
     hilo del proceso, y quien ganó nunca puede volver a ejecutarse para
     hacer COMMIT y liberar el lock (deadlock real, confirmado en vivo).
  B. Este módulo: aun con el event loop libre, una request individual
     seguiría esperando el lock INDEFINIDAMENTE sin este timeout. `SET
     LOCAL` lo acota a ESTA transacción -- nunca sobrevive al commit/
     rollback ni afecta otras conexiones/sesiones.
"""
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.dominio.excepciones import ConflictoConcurrencia

# 5s: margen suficiente para una operación humana normal (un admin
# decidiendo un pago, una corrección financiera) y corto contra un cliente
# HTTP esperando respuesta. Si el valor cambia, documentar acá el porqué
# del nuevo número -- no es un tope sagrado, es una estimación razonada.
TIMEOUT_LOCK_FILA_MS = 5000

# SQLSTATE de Postgres para "no se pudo obtener el lock a tiempo" (venció
# `lock_timeout`) -- https://www.postgresql.org/docs/current/errcodes-appendix.html
_SQLSTATE_LOCK_NO_DISPONIBLE = "55P03"


def obtener_con_bloqueo_y_timeout(sesion: Session, modelo, id_: int, *, mensaje_conflicto: str):
    """`SELECT ... FOR UPDATE` con `lock_timeout` de `TIMEOUT_LOCK_FILA_MS`
    aplicado SOLO a esta transacción (`SET LOCAL`). Traduce el vencimiento
    del lock (SQLSTATE 55P03) a `ConflictoConcurrencia` (-> HTTP 409);
    cualquier otro `OperationalError` (ej. la conexión se cayó) se re-lanza
    tal cual, para no enmascarar un problema real de BD detrás de un
    mensaje que no lo describe."""
    sesion.execute(text(f"SET LOCAL lock_timeout = '{TIMEOUT_LOCK_FILA_MS}ms'"))
    try:
        return sesion.get(modelo, id_, with_for_update=True)
    except OperationalError as error:
        sesion.rollback()
        sqlstate = getattr(getattr(error, "orig", None), "sqlstate", None)
        if sqlstate == _SQLSTATE_LOCK_NO_DISPONIBLE:
            raise ConflictoConcurrencia(
                mensaje_conflicto,
                detalle_tecnico=f"modelo={modelo.__name__} id={id_} lock_timeout_ms={TIMEOUT_LOCK_FILA_MS}",
            ) from error
        raise
