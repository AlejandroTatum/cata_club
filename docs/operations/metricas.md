# Métricas internas de Prometheus

`GET /metrics` en el backend expone métricas internas en formato de
exposición de Prometheus (issue #1309). Cierra el hallazgo **A-1** de la
matriz de production readiness: la única señal interna que tenía el backend
era la correlación por `X-Request-ID`, que dice que un request ocurrió pero
no si la app está lenta, devolviendo 5xx, o quedándose atrás en una cola de
fondo.

Todavía no hay ningún scraper instalado. Prometheus, Grafana o cualquier otro
consumidor queda explícitamente fuera de alcance del issue #1309 -- este
documento cubre solo lo que expone el endpoint y cómo alcanzarlo a mano.
Cablear un scraper real es una decisión separada, posterior.

## Alcance

`/metrics` es alcanzable **solo desde adentro de la red de Compose**, igual
que `/health` y `/health/ready` son internos por defecto. A diferencia de
`/health/ready`, que Caddy proxea al borde público a propósito (ver
`docs/operations/monitoring.md`), `/metrics` nunca se enruta ahí:
`tests/test_docker_compose_config.py::test_metrics_no_es_alcanzable_desde_el_borde_publico`
bloquea las dos mitades de eso -- ningún matcher `handle` de Caddy menciona
`/metrics`, y el BFF de Next.js (`frontend/src/app/api/`) no tiene ninguna
ruta que lo reenvíe.

Desde el host, con el stack levantado:

```bash
docker compose exec backend curl -s localhost:8000/metrics
```

Desde otro servicio de la misma red de Compose (por ejemplo, para cablear un
futuro scraper):

```
http://backend:8000/metrics
```

El endpoint no exige autenticación -- no está expuesto públicamente, así que
sigue la misma postura anónima-pero-interna que `/health` y `/health/ready`.
No aparece en `/openapi.json` (`include_in_schema=False`) y no cuelga de
`/api/v1`.

## Qué expone

### Métricas HTTP (`prometheus-fastapi-instrumentator`)

Instrumentación estándar de requests, un conjunto de series por
ruta/método/status (nombres reales, verificados contra un scrape de
`/metrics` -- no los defaults documentados de la librería, que no
coinciden):

- `http_request_duration_seconds_*` (`_bucket`, `_sum`, `_count`, `_created`)
  -- histograma de latencia.
- `http_requests_total` -- conteo de requests por handler y status.
- `http_requests_inprogress` -- requests siendo atendidos en este momento.
  El gauge de in-flight es opt-in en la librería
  (`should_instrument_requests_inprogress=True` en `backend/main.py`); sin
  eso, la serie ni siquiera aparece en el scrape.

### Profundidad de las colas outbox (colector propio)

`app/infraestructura/metricas.py::ColectorOutbox` calcula, al momento del
scrape, un par de consultas acotadas (`COUNT` + `MIN(created_at)`) por tabla
outbox, ambas cubiertas por el índice `..._pending_next` que ya existe --el
mismo que usan los workers de despacho--, así que el scrape no agrega
presión de lectura nueva:

| Métrica | Etiquetas | Significado |
| --- | --- | --- |
| `cata_outbox_pendientes` | `tabla` | Filas en estado `PENDIENTE` en esa tabla outbox. |
| `cata_outbox_pendiente_mas_antiguo_segundos` | `tabla` | Edad en segundos de la fila `PENDIENTE` más antigua de esa tabla; `0` cuando no hay ninguna. |
| `cata_outbox_scrape_ok` | -- | `1` si la última consulta a las tablas outbox tuvo éxito, `0` si falló. |

`tabla` es el nombre real de la tabla, no un alias, así que coincide con lo
que un operador ve consultando la base directamente:

- `enrollment_notificacion_outbox`
- `recuperacion_outbox`
- `verificacion_correo_outbox`

Una falla de base de datos durante el scrape nunca convierte a `/metrics` en
un 500: el colector captura la excepción, la loguea, y reporta
`cata_outbox_scrape_ok 0` mientras las series HTTP de arriba se siguen
sirviendo con normalidad (ver `backend/tests/test_metricas.py`).

`cata_outbox_scrape_ok 0` tiene DOS causas distintas, no una sola:

1. Una falla real de conexión (Postgres inalcanzable).
2. Que alguna de las tres consultas haya excedido el `statement_timeout`
   propio del scrape -- `TIMEOUT_SCRAPE_SENTENCIA_MS = 2000` ms
   (`backend/app/infraestructura/metricas.py`), fijado con `SET LOCAL` para
   que un Postgres colgado no retenga indefinidamente una conexión del pool
   ni el hilo del threadpool que atiende `/metrics`.

Un Postgres alcanzable pero lento da el mismo `0` que uno caído: no asumir
"la base está abajo" solo por ese valor. Cruzar contra `/health/ready` para
distinguir -- si también falla, es más probable una caída real; si responde
bien, es más probable una consulta lenta específica de las tablas outbox.

## Lectura sugerida (una vez que exista un scraper)

- Un crecimiento sostenido de `cata_outbox_pendiente_mas_antiguo_segundos` en
  cualquier tabla significa que el worker de despacho de esa cola (Celery)
  dejó de dar abasto -- el mismo síntoma que el heartbeat externo detecta
  cuando Celery está completamente caído, pero acá antes y por cola.
- `cata_outbox_scrape_ok 0` significa que el endpoint de métricas pudo
  alcanzar la app, pero el colector de outbox no pudo completar sus
  consultas -- por una falla real de conexión O porque alguna consulta
  superó el `statement_timeout` de 2000 ms del scrape (ver la sección
  anterior). No es solo "la base está abajo"; cruzar contra `/health/ready`
  para distinguir cuál de las dos causas es.
