# Entrega de correo: qué garantiza el club y qué no

Las dos colas que mandan un enlace con el que alguien entra a su cuenta
—recuperación de contraseña y verificación de correo— entregan
**at-least-once**. No exactly-once. Este documento existe porque hasta el
issue #839 esa garantía no estaba escrita en ningún lado, y una garantía que
nadie escribió es una que cada quien supone distinta.

## La garantía, en una frase

> Un correo de acceso encolado se entrega **al menos una vez**. En una falla
> extrema del worker puede entregarse **dos veces**, y como mucho ocho en
> toda la vida de la solicitud. Nunca se descarta en silencio.

## Por qué exactly-once no es una opción

`entregar_fila` (`backend/app/infraestructura/tareas/outbox_despacho.py`)
coordina **dos sistemas que no comparten transacción**: el proveedor SMTP y
Postgres. La secuencia real es:

1. leer la fila del outbox (`ENVIANDO`, con lease),
2. `sendmail` — el correo sale,
3. `mark_sent()` + `commit()` — la base registra que salió.

Entre el paso 2 y el 3 hay una ventana. Si el proceso muere ahí, el correo ya
está en el buzón del usuario y ninguna escritura de la base lo sabe. No hay
commit de dos fases sobre SMTP, así que esa ventana **no se cierra**: solo se
elige de qué lado caer.

- Commitear *después* del envío → riesgo de **duplicado**.
- Commitear "enviado" *antes* del envío → riesgo de **correo perdido**.

El club elige el duplicado. Un representante que no recibe su enlace de
recuperación no puede entrar a su cuenta y no tiene forma de saber por qué;
uno que lo recibe dos veces usa el primero. Esa asimetría es toda la
decisión.

Nada de esto se arregla con un `Message-ID` determinista. Un `Message-ID`
repetido solo desduplica si el proveedor de correo se comprometió por escrito
a desduplicar por ese encabezado, y el club no tiene ese compromiso de
ninguno de los suyos. Sin esa garantía documentada, un `Message-ID` estable
es un dato de trazabilidad, no un mecanismo de desduplicación.

## De dónde salen los duplicados

Son **dos caminos independientes**, y conviene no confundirlos porque se
diagnostican distinto:

1. **Vencimiento del lease.** La fila quedó `ENVIANDO` con su `claimed_at`
   puesto. A los 10 minutos `claim_pending` la considera abandonada y la
   vuelve a tomar. Esto **sí** gasta uno de los seis `attempts`.
2. **Redelivery del broker.** `celery_app.py` fija `task_acks_late=True` y
   `task_reject_on_worker_lost=True`: cuando un worker muere a mitad de una
   tarea, el broker republica el **mismo** mensaje `procesar_*(evento_id)` de
   inmediato, sin esperar ningún lease. Este camino **no** pasa por
   `claim_pending`, así que **no gasta `attempts`**.

El segundo era el problema del issue #839. Como `entregar_fila` solo *lee* la
fila y el único que incrementa `attempts` es el reclamo, un worker que moría
siempre en el mismo punto reenviaba **sin techo**: `AGOTADO` era inalcanzable
y la única cota real era que alguien mirara.

## El techo, y por qué es 8

`entregas_intentadas` cuenta cuántas veces se llegó a hablar con SMTP por esa
fila, y **ve los dos caminos**. Al llegar a
`MAX_ENTREGAS_INICIADAS = 8` la entrega se corta: la fila no se manda de
nuevo y vuelve al outbox por el camino de siempre (`requeue`), lo que la deja
`PENDIENTE` con backoff —o `AGOTADO` si era el último intento— y corta la
ráfaga en seco, porque la redelivery siguiente ya no la encuentra `ENVIANDO`.

El número está **por encima** de `MAX_ATTEMPTS` (6) a propósito. Cada intento
del outbox llega al paso de envío como mucho una vez, así que el camino sano
consume 6 y **nunca** toca el techo; lo único que puede tocarlo es la
redelivery del broker. Un techo de 6 o menos bloquearía entregas legítimas.

Es un contador **separado** de `attempts`, y no un reuso, porque `attempts`
gobierna el backoff exponencial y el `AGOTADO` terminal: moverlo habría
cambiado esa política de rebote.

## Qué se guarda y cuándo

Tres columnas por cola (`recuperacion_outbox` y
`verificacion_correo_outbox`), agregadas por la migración `a839entrega`:

| Columna | Cuándo se escribe | Qué significa |
| --- | --- | --- |
| `entregas_intentadas` | commit **antes** de `sendmail` | veces que se llegó al paso de envío |
| `entrega_iniciada_at` | commit **antes** de `sendmail` | cuándo empezó la última de esas entregas |
| `entrega_resuelta_at` | con `mark_sent()` o con `requeue()` | cuándo se registró su desenlace |

El marcador va **antes** del envío porque es la única posición que sirve: un
rastro escrito después se pierde en la misma ventana que vendría a
documentar.

Ese commit previo **no da la fila por enviada**. No toca `status` ni
`sent_at`. Una fila con el marcador puesto sigue siendo `ENVIANDO` del worker
que la reclamó, así que si el proceso muere entre el marcador y `sendmail` el
vencimiento del lease la devuelve a la cola y se entrega igual. Por eso el
marcador no puede perder correo.

## Cómo se ve un duplicado probable

Cuando alguien reporta dos correos iguales, hay dos lugares donde mirar.

**En la fila.** Una entrega **iniciada y nunca resuelta** es la firma exacta
de la ventana:

```sql
SELECT id, usuario_id, status, attempts, entregas_intentadas,
       entrega_iniciada_at, entrega_resuelta_at, last_error_redacted
FROM recuperacion_outbox
WHERE entrega_iniciada_at IS NOT NULL
  AND (entrega_resuelta_at IS NULL OR entrega_resuelta_at < entrega_iniciada_at);
```

`entregas_intentadas > attempts` es la otra señal, y apunta derecho a la
redelivery del broker: hubo más pasos por SMTP que reclamos del outbox.

**En el registro.** La entrega siguiente lo avisa antes de mandar:

```
Recuperación posible DUPLICADO: la fila 412 ya había iniciado una entrega el
2026-08-30 03:14:22+00 que nunca registró su desenlace; se entrega igual
(at-least-once)
```

Se entrega igual a propósito. Suprimir exigiría saber si el envío anterior
llegó, y eso es justamente lo que la ventana no deja saber.

Y si se tocó el techo:

```
Recuperación alcanzó el techo de 8 entregas iniciadas: fila 412 del usuario
57, NO se manda de nuevo; revisá por qué el worker muere entregando esta fila
```

Ese mensaje no es sobre el correo: es sobre el worker. Ocho muertes seguidas
entregando la misma fila no es un fallo del proveedor, es un proceso que se
está cayendo —OOM, `SIGKILL`, un límite duro de Celery— y hay que mirarlo
ahí. La fila además queda con `last_error_redacted =
'TopeDeEntregasAlcanzado: delivery failed'`, que es la marca durable de que
el reenvío se detuvo por el techo y no por SMTP.

## El límite que queda

El techo compra una cota a cambio de un caso extremo: si el worker muere
**ocho veces seguidas antes de llegar a `sendmail`** para la misma fila, esa
fila termina `AGOTADO` sin que el correo haya salido nunca. No es silencioso
—lo dicen los dos mensajes de arriba más el `AGOTADO` que ya existía desde el
issue #764—, pero es real, y es el precio de que el reenvío termine. Un
worker que muere ocho veces entregando una fila necesita atención de todas
formas.

## Lo que este diseño NO afirma

- **No** hay entrega exactly-once. No la hay ni puede haberla mientras SMTP y
  Postgres no compartan transacción.
- **No** hay desduplicación en el proveedor. El club no tiene ninguna
  garantía escrita de ninguno de sus proveedores sobre eso.
- **No** hay transaccionalidad entre el envío y la base.
- Las columnas de auditoría **no previenen** el duplicado: lo acotan y lo
  hacen diagnosticable.

## Dónde vive esto en el código

- `backend/app/infraestructura/repositorios/outbox_auditoria_entrega.py` — el
  mecanismo y el techo.
- `backend/app/infraestructura/tareas/outbox_despacho.py` — la secuencia de
  entrega.
- `backend/app/dominio/modelos.py` — las dos tablas.
- `backend/tests/test_outbox_entrega_al_menos_una_vez.py` — el contrato,
  medido con inyección de fallas.
- `backend/alembic/versions/a839entrega_auditoria_de_entrega_outbox.py` — la
  migración.

La tercera cola del club, `enrollment_notificacion_outbox`, queda fuera de
todo esto a propósito: no habla SMTP y ya tiene su propia guarda de
idempotencia.
