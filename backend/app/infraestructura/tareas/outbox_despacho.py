"""
Mecánica compartida de las colas de salida (outbox) por correo.

El club tiene tres colas con la MISMA mecánica y tres motivos distintos:
recuperación de contraseña (#764), avisos de nueva inscripción (#633) y
verificación de correo (#790). Las tres reclaman una fila con lease, publican
una tarea por fila, entregan, reintentan con backoff y terminan en `AGOTADO`;
lo único que cambia entre ellas es QUÉ se manda y a quién.

Esa mecánica vivía escrita de nuevo en cada módulo de tareas. Acá vive una
sola vez, parametrizada por lo que de verdad difiere.

GARANTÍA DE ENTREGA: AT-LEAST-ONCE, nunca exactly-once
------------------------------------------------------
Una entrega toca dos sistemas que NO comparten transacción: el proveedor
SMTP y Postgres. No hay commit de dos fases entre ellos, así que entre que
`sendmail` vuelve y que el `mark_sent()` se commitea existe una ventana en la
que el worker puede morir con el correo ya entregado y la base sin saberlo.
Esa ventana no se cierra: se elige de qué lado caer, y el club elige que un
enlace de acceso llegue dos veces antes que no llegar (issue #839).

Lo que sí se hace con el duplicado: acotarlo y hacerlo visible. Ver
`app/infraestructura/repositorios/outbox_auditoria_entrega.py` para el
mecanismo, y `docs/operations/entrega-de-correo.md` para lo que un operador
necesita saber cuando alguien reporta dos correos iguales.

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

from app.infraestructura.repositorios import outbox_auditoria_entrega as auditoria
from app.soporte_transversal.configuracion import settings


def tope_de_lote() -> int:
    """Filas que UNA corrida de despacho puede reclamar, como mucho.

    El número es el mismo para las tres colas y vive una sola vez, en
    `settings`. Se resuelve en el momento de la llamada y no al importar: leer
    el valor tarde es lo que permite moverlo -- en un test o por variable de
    entorno -- sin reimportar los tres módulos de tareas.
    """
    return settings.celery_outbox_lote_maximo


def resultado_de_despacho(reclamadas: int, tope: int) -> dict:
    """Las cuentas de UNA corrida, armadas sin ninguna consulta extra.

    `tope_alcanzado` es la única señal de "puede quedar atraso", y se deriva
    del contador que la corrida ya venía llevando. Informar cuántas filas
    QUEDAN exigiría un `COUNT(*)` sobre la tabla en cada tick -- exactamente
    el trabajo sin techo que este cambio retira --, y ese número estaría
    viejo antes de llegar al registro.

    Que `reclamadas == tope` con la tabla justo vacía diga igual "puede
    quedar" es deliberado: ese falso positivo cuesta un tick de más, mientras
    que el error simétrico escondería un atraso real.
    """
    return {
        "reclamadas": reclamadas,
        "tope": tope,
        "tope_alcanzado": reclamadas >= tope,
    }


def reclamar_y_publicar(abrir_sesion, repositorio, publicar) -> dict:
    """Reclama hasta un lote de filas con lease y publica una tarea por cada una.

    El `commit()` va ANTES de publicar: si el broker está caído, la fila ya
    quedó marcada `ENVIANDO` con su lease, y el vencimiento de ese lease la
    devuelve a la cola. Publicar primero y comitear después dejaría al worker
    leyendo una fila que todavía no existe para nadie más.

    El lote tiene techo (issue #841). `claim_pending()` devuelve UNA fila por
    consulta, así que un bucle sin tope convertía una tabla atrasada en tantas
    idas y vueltas a Postgres -- y tantos commits -- como filas hubiera,
    dentro de un tick que se repite cada minuto sobre un worker de
    `--concurrency=1`. Acotar no descarta nada: lo que no entró en el lote
    sigue `PENDIENTE` y elegible, y el tick siguiente lo toma.

    Si `publicar` falla, el error NO se atrapa y la corrida se corta ahí. Es
    la semántica de esta función y se conserva a propósito: con el broker
    caído, seguir reclamando gastaría un intento por fila (de los seis que hay
    antes de `AGOTADO`) sin entregar ni una.
    """
    tope = tope_de_lote()
    reclamadas = 0
    with abrir_sesion() as db:
        repo = repositorio(db)
        while reclamadas < tope:
            evento = repo.claim_pending()
            if evento is None:
                break
            db.commit()
            publicar(evento.id)
            reclamadas += 1
    return resultado_de_despacho(reclamadas, tope)


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

    La entrega es AT-LEAST-ONCE (ver el encabezado del módulo). El marcador
    de auditoría se commitea ANTES de `entregar`, y esa es la única posición
    que sirve: escrito después, se pierde en la misma ventana que viene a
    documentar. Ese commit NO da la fila por enviada -- `status` sigue
    `ENVIANDO` y `sent_at` sigue nulo --, así que una muerte entre el
    marcador y el envío deja la fila exactamente como estaba para el
    reintento, y no puede perder correo.
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
            # Este `AGOTADO` no pasa por `mark_sent` ni por `requeue`, que es
            # donde vive `marcar_entrega_resuelta`. Sin esta línea, una fila
            # que inició una entrega, perdió su worker y venció antes de la
            # redelivery quedaría para siempre con la entrega iniciada y sin
            # desenlace -- leyéndose como ventana abierta en una fila que ya
            # es terminal y que nadie va a reintentar.
            auditoria.marcar_entrega_resuelta(evento)
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

        if auditoria.tope_de_entregas_alcanzado(evento):
            # Techo del duplicado (issue #839). Se llega acá solo por
            # redelivery del broker: `task_acks_late` republica el MISMO
            # mensaje cuando el worker muere, sin pasar por `claim_pending`,
            # que es el único que gasta `attempts`. Sin este corte, un worker
            # que muere siempre en el mismo punto reenvía sin fin y `AGOTADO`
            # nunca llega.
            #
            # La fila se devuelve al outbox por el camino de siempre en vez de
            # cerrarse acá: `requeue` la deja `PENDIENTE` con backoff (o
            # `AGOTADO` en el último intento), y eso corta la ráfaga en seco
            # porque la redelivery siguiente ya no la encuentra `ENVIANDO`.
            repositorio(db).requeue(evento, auditoria.TopeDeEntregasAlcanzado())
            agotado = evento.status == "AGOTADO"
            entregas, usuario_id = evento.entregas_intentadas, evento.usuario_id
            db.commit()
            logger.error(
                "%s alcanzó el techo de %s entregas iniciadas: fila %s del "
                "usuario %s, NO se manda de nuevo; revisá por qué el worker "
                "muere entregando esta fila",
                etiqueta, entregas, evento_id, usuario_id,
            )
            return {
                "evento_id": evento_id,
                "enviado": False,
                "agotado": agotado,
                "tope_de_entregas": True,
            }

        duplicado_probable = auditoria.entrega_previa_sin_resolver(evento)
        entrega_previa = evento.entrega_iniciada_at
        auditoria.marcar_entrega_iniciada(evento)
        db.commit()
        if duplicado_probable:
            # Se entrega IGUAL: el contrato es at-least-once y este aviso
            # sirve para diagnosticar el duplicado, no para suprimirlo.
            # Suprimir exigiría saber si el envío anterior llegó, y eso es
            # exactamente lo que la ventana no deja saber.
            logger.warning(
                "%s posible DUPLICADO: la fila %s ya había iniciado una "
                "entrega el %s que nunca registró su desenlace; se entrega "
                "igual (at-least-once)",
                etiqueta, evento_id, entrega_previa,
            )

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
