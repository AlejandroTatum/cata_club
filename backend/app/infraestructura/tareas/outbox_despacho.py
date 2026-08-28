"""
Mecánica compartida de las colas de salida (outbox) por correo.

El club tiene tres colas con la MISMA mecánica y tres motivos distintos:
recuperación de contraseña (#764), avisos de nueva inscripción (#633) y
verificación de correo (#790). Las tres reclaman una fila con lease, publican
una tarea por fila, entregan, reintentan con backoff y terminan en `AGOTADO`;
lo único que cambia entre ellas es QUÉ se manda y a quién.

Esa mecánica vivía escrita de nuevo en cada módulo de tareas. Acá vive una
sola vez, parametrizada por lo que de verdad difiere.

Sobre `abrir_sesion`: se recibe como parámetro y no se importa `SessionLocal`
acá a propósito. Cada módulo de tareas pasa el `SessionLocal` de SU módulo, y
lo resuelve en el momento de la llamada -- que es lo que permite que los tests
sigan inyectando una sesión con `monkeypatch.setattr(modulo, "SessionLocal",
...)` sobre el módulo que ya parcheaban. Importarlo acá rompería esa costura
sin que ningún test lo dijera hasta que fallara la entrega en producción.
"""
from datetime import datetime, timezone
from typing import Callable, Optional

from sqlalchemy import delete, func, or_, select


def reclamar_y_publicar(abrir_sesion, repositorio, publicar) -> dict:
    """Reclama filas con lease y publica una tarea por cada una.

    El `commit()` va ANTES de publicar: si el broker está caído, la fila ya
    quedó marcada `ENVIANDO` con su lease, y el vencimiento de ese lease la
    devuelve a la cola. Publicar primero y comitear después dejaría al worker
    leyendo una fila que todavía no existe para nadie más.
    """
    reclamadas = 0
    with abrir_sesion() as db:
        repo = repositorio(db)
        while True:
            evento = repo.claim_pending()
            if evento is None:
                break
            db.commit()
            publicar(evento.id)
            reclamadas += 1
    return {"reclamadas": reclamadas}


def entregar_fila(
    *,
    abrir_sesion,
    modelo,
    repositorio,
    logger,
    etiqueta: str,
    evento_id: int,
    cargar_destinatario: Callable,
    entregar: Callable,
    omitir: Optional[Callable] = None,
) -> dict:
    """Entrega UNA fila ya reclamada y deja el reintento en manos del outbox.

    `etiqueta` es el nombre del flujo tal como aparece en los registros
    ("Recuperación", "Verificación de correo"): lo que se loguea tiene que
    decir de qué cola habla, porque las tres escriben en el mismo destino.

    `omitir(destinatario)` permite saltar la entrega sin gastar un intento
    cuando el motivo de la fila ya no existe -- una cuenta que se verificó por
    otra vía entre el encolado y el despacho. La fila se cierra como enviada:
    dejarla viva la haría reintentar para siempre.
    """
    with abrir_sesion() as db:
        evento = db.get(modelo, evento_id)
        if not evento or evento.status != "ENVIANDO":
            return {"evento_id": evento_id, "omitido": True}

        destinatario = cargar_destinatario(db, evento)
        vencida = evento.expires_at <= datetime.now(timezone.utc)
        if not destinatario or vencida:
            motivo = "la solicitud venció" if destinatario else "el usuario ya no existe"
            usuario_id = evento.usuario_id  # antes del commit: después expira
            evento.status = "AGOTADO"
            db.commit()
            logger.error(
                "%s AGOTADO sin enviar: fila %s del usuario %s, %s",
                etiqueta, evento_id, usuario_id, motivo,
            )
            return {"evento_id": evento_id, "agotado": True}

        if omitir is not None and omitir(destinatario):
            repositorio(db).mark_sent(evento)
            db.commit()
            return {"evento_id": evento_id, "enviado": False, "omitido_por_estado": True}

        try:
            entregar(destinatario)
        except Exception as error:
            repositorio(db).requeue(evento, error)
            # `requeue` decide entre PENDIENTE y AGOTADO; se leen antes del
            # commit porque después la sesión expira los atributos.
            agotado = evento.status == "AGOTADO"
            intentos, usuario_id = evento.attempts, evento.usuario_id
            db.commit()
            if agotado:
                # AGOTADO es terminal: nadie más va a reintentar esta fila.
                # Loguearlo igual que un fallo transitorio volvía invisible el
                # único estado de fracaso definitivo (issue #764).
                logger.error(
                    "%s AGOTADO tras %s intentos: fila %s del usuario %s, el "
                    "enlace nunca se envió y nadie va a reintentarlo",
                    etiqueta, intentos, evento_id, usuario_id,
                )
            else:
                logger.exception("Falló el envío (%s); quedó para retry", etiqueta)
            return {"evento_id": evento_id, "enviado": False, "agotado": agotado}

        repositorio(db).mark_sent(evento)
        db.commit()
        return {"evento_id": evento_id, "enviado": True}


def limpiar_vencidas(*, abrir_sesion, modelo, logger, mensaje_nunca_enviadas: str) -> dict:
    """Retira filas vencidas, sin tocar solicitudes activas.

    Una fila `PENDIENTE` vencida es una solicitud que alguien hizo y que jamás
    se envió. Borrarla es correcto -- el enlace ya no serviría --, pero
    hacerlo EN SILENCIO es lo que convierte ese fallo en una queja de usuario
    en vez de una alarma (issue #764). El borrado se conserva; el silencio no.
    """
    now = datetime.now(timezone.utc)
    with abrir_sesion() as db:
        nunca_enviadas = db.execute(
            select(func.count())
            .select_from(modelo)
            .where(modelo.expires_at <= now, modelo.status == "PENDIENTE")
        ).scalar_one()
        resultado = db.execute(
            delete(modelo).where(
                modelo.expires_at <= now,
                or_(
                    modelo.status.in_(("ENVIADO", "AGOTADO")),
                    modelo.status == "PENDIENTE",
                ),
            )
        )
        db.commit()
    if nunca_enviadas:
        logger.warning(mensaje_nunca_enviadas, nunca_enviadas)
    return {"eliminadas": resultado.rowcount, "nunca_enviadas": nunca_enviadas}
