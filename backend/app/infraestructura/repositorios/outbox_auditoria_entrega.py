"""
Auditoría del paso de ENTREGA de las colas de salida por correo (issue #839).

El contrato: AT-LEAST-ONCE
--------------------------
`outbox_despacho.entregar_fila` coordina dos sistemas que no comparten
transacción -- el proveedor SMTP y Postgres --, y no existe un commit de dos
fases entre ellos. Entre que `sendmail` vuelve y que el `mark_sent()` se
commitea hay una ventana en la que el proceso puede morir con el correo ya
entregado y la base todavía sin saberlo.

Esa ventana no se cierra; se ELIGE de qué lado caer. El club elige
at-least-once: antes que perder un enlace de acceso o de recuperación se
acepta que una muerte extrema del worker entregue un duplicado. Lo contrario
-- commitear "enviado" ANTES de mandar -- convertiría la misma ventana en
correo perdido en silencio, que para estas dos colas es el fallo caro: un
representante que no recibe su enlace no puede entrar a su cuenta.

Este módulo no reduce el duplicado a cero. No puede. Hace dos cosas que sí
son posibles: lo ACOTA y lo hace VISIBLE.

Por qué no alcanzaba con `attempts`
-----------------------------------
`attempts` lo incrementa únicamente `claim_pending`. La redelivery del
broker -- `task_acks_late=True` y `task_reject_on_worker_lost=True` en
`celery_app.py` -- vuelve a publicar el MISMO mensaje `procesar_*(evento_id)`
sin pasar por ningún reclamo, y `entregar_fila` solo LEE la fila. Un worker
que muere siempre en el mismo punto reenviaba, por lo tanto, sin techo:
`attempts` se quedaba quieto y `AGOTADO` era inalcanzable.

El contador de acá es SEPARADO a propósito. `attempts` gobierna el backoff y
el `AGOTADO` terminal, y esa semántica ya está custodiada por
`test_recuperacion_outbox.py` y `test_verificacion_correo_outbox.py`;
reusarlo para contar entregas habría movido el backoff de rebote.

Qué se escribe y cuándo
-----------------------
- `marcar_entrega_iniciada` se llama y se COMMITEA justo antes de `sendmail`.
  Es lo único que puede sobrevivir a la muerte del worker: un rastro escrito
  después del envío se pierde en la misma ventana que vendría a documentar.
  NO toca `status` ni `sent_at`, así que una fila con el marcador puesto y
  sin envío sigue siendo `ENVIANDO` del worker que la reclamó, y el
  vencimiento del lease la vuelve a entregar. Por eso el marcador no puede
  perder correo.
- `marcar_entrega_resuelta` va dentro de `mark_sent` y de `requeue`, que son
  los dos desenlaces posibles. Vive ahí y no en el llamador para que no haya
  forma de olvidarlo.

Una entrega INICIADA y nunca RESUELTA es la firma de la ventana: se llegó al
envío y nadie registró qué pasó. La siguiente entrega de esa misma fila es,
por lo tanto, un duplicado probable -- y se entrega igual, porque el contrato
es at-least-once y el marcador existe para diagnosticar, no para suprimir.
"""
from __future__ import annotations

from datetime import datetime, timezone


# Techo de veces que UNA fila puede llegar al paso de envío, en toda su vida.
#
# Está por ENCIMA de `MAX_ATTEMPTS` (6, el mismo en las dos colas) y no por
# debajo, y esa desigualdad es el punto: cada intento del outbox llega al
# envío como mucho una vez, así que un techo <= 6 bloquearía entregas
# legítimas. Con 8 el camino sano -- seis intentos, seis envíos -- nunca lo
# toca; lo único que puede tocarlo es la redelivery del broker, que no gasta
# `attempts`. `test_el_techo_de_entregas_deja_lugar_al_camino_sano` fija la
# desigualdad para que no se pierda si alguien mueve uno de los dos números.
MAX_ENTREGAS_INICIADAS = 8


class TopeDeEntregasAlcanzado(Exception):
    """La fila llegó al techo de entregas y no se manda de nuevo.

    Se pasa a `requeue`, que persiste SOLO el nombre de la clase en
    `last_error_redacted`. Que ese nombre sea legible no es cosmético: es lo
    que le dice a un operador, mirando la fila, que el reenvío se detuvo por
    el techo y no por un fallo del proveedor.
    """


def marcar_entrega_iniciada(evento) -> None:
    """Cuenta este paso por el envío y lo fecha. El llamador DEBE commitear
    antes de `sendmail`; si no, el rastro muere con el worker."""
    evento.entregas_intentadas = (evento.entregas_intentadas or 0) + 1
    evento.entrega_iniciada_at = datetime.now(timezone.utc)


def marcar_entrega_resuelta(evento) -> None:
    """El desenlace de la entrega quedó registrado, haya sido envío o fallo."""
    evento.entrega_resuelta_at = datetime.now(timezone.utc)


def entrega_previa_sin_resolver(evento) -> bool:
    """¿Una entrega anterior llegó al envío sin registrar su desenlace?

    Se compara contra `entrega_iniciada_at` en vez de mirar solo si
    `entrega_resuelta_at` es nulo: una fila que ya falló una vez tiene las
    dos marcas puestas, y lo que la distingue de la ventana peligrosa es
    CUÁL es más reciente. Un fallo conocido resolvió su intento; una muerte
    del worker, no.
    """
    iniciada = evento.entrega_iniciada_at
    if iniciada is None:
        return False
    resuelta = evento.entrega_resuelta_at
    return resuelta is None or resuelta < iniciada


def tope_de_entregas_alcanzado(evento) -> bool:
    return (evento.entregas_intentadas or 0) >= MAX_ENTREGAS_INICIADAS
