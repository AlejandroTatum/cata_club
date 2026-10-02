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
  Los buckets por ruta (`handler`, `method`) son once, en segundos:
  `0.025, 0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2.5, 5, 10` (+ `+Inf`),
  `BUCKETS_LATENCIA_POR_RUTA` en `backend/app/infraestructura/metricas.py`
  (issue #1314). El default de la librería eran tres (`0.1, 0.5, 1`), con los
  que el p95 de casi cualquier ruta caía entre dos bordes. Costo: por cada par
  (ruta, método) con tráfico, de 7 a 15 series (`_bucket` x12, `_sum`,
  `_count`, `_created`); con las 138 operaciones del OpenAPI el techo teórico
  pasa de 966 a 2070 series, y en la práctica solo cuentan las rutas que
  recibieron una petición. La serie agregada `http_request_duration_highr_seconds`
  no cambia.
- `http_requests_total` -- conteo de requests por handler y status.
- `http_requests_inprogress` -- requests siendo atendidos en este momento.
  El gauge de in-flight es opt-in en la librería
  (`should_instrument_requests_inprogress=True` en `backend/main.py`); sin
  eso, la serie ni siquiera aparece en el scrape.

### Logins (contador propio)

`cata_login_total{resultado="ok"|"fallido"}` cuenta los logins resueltos por
`AuthServicio.login`. La única etiqueta es el resultado: nunca un correo, un
usuario ni una IP. Las dos series existen desde el arranque, en 0. El colector
de "Actividad del club" (abajo) guarda su delta por minuto.

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

La conexión en sí también está acotada: el engine fija `connect_timeout`
(`TIMEOUT_CONEXION_SEGUNDOS`, `backend/app/infraestructura/db.py`), así que un
Postgres que acepta el TCP pero nunca responde tampoco puede retener el hilo
del scrape indefinidamente -- el `SET LOCAL` corre después del connect y no
cubre ese caso.

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

## Actividad del club: colector, endpoints y retención (issue #1314)

La pantalla de administración «Actividad del club» tiene dos vistas, y las dos
leen de la base -- nunca de `/metrics` en vivo ni de Docker:

- **Resumen** (`GET /api/v1/actividad/resumen?rango=24h|7d|30d`): personas que
  ingresaron por rol, asistencias, pagos, inscripciones y el estado del sistema.
- **Métricas avanzadas** (`GET /api/v1/actividad/avanzadas?rango=1h|24h|7d`):
  servicio (req/min, % de 5xx y 4xx, p50/p95/p99, endpoints más lentos), host,
  runtime (memoria por contenedor, conexiones de Postgres, Redis, colas) y
  usuarios (conectados ahora, logins, sesiones por rol).

Ambos son **solo ADMINISTRADOR**, exigido en el backend con `GestorPermisos`
(sin sesión 401, otro rol 403); cualquier administrador ve la vista avanzada.
Solo agregados: ni correos, ni ids, ni IPs, ni hostnames, ni versiones. Las
rutas son plantillas (`/api/v1/personas/{persona_id}`), nunca URLs concretas.
`/metrics` sigue sin ruta en Caddy ni en el BFF.

### De dónde sale cada cifra

| Cifra | Fuente |
| --- | --- |
| Personas que ingresaron | `actividad_usuario` (usuario, día del club, franja de 2 h), escrita en login, refresh y la primera petición autenticada de cada franja. Una persona cuenta una vez por columna; el KPI cuenta personas distintas. El administrador no entra en la gráfica. |
| Asistencias | `asistencia` con estado `PRESENTE`/`ATRASADO`, por `fecha_registro` (cuándo se anotó; `fecha_entrenamiento` es solo un día). |
| Pagos | `pago` de cualquier estado, por `fecha_registro` (comprobantes recibidos). |
| Inscripciones nuevas | altas de `persona`, por `fecha_registro`. |
| Estado del sistema | última `metrica_instantanea` y la ventana de los últimos 15 min, con los umbrales de `activity-utils.ts`. Sin instantáneas: `unknown`. Instantánea de más de 5 min: `app` en `bad`, el resto `unknown`. |
| Conectados ahora | sorted set de Redis (`presencia:*`, score = último instante visto, ventana de 5 min). |

Día y franja son del club (`America/Guayaquil`), no de UTC.

### Conectados ahora: por qué Redis

La dependencia de autenticación corre en cada petición. Escribir "visto por
última vez" en la base sería una escritura caliente sobre `usuario` en el
camino de todo; Redis ya está en el stack y `ZCOUNT` responde en O(log n). Una
memoria local por proceso lo reduce a una ida y vuelta (un pipeline) por
usuario y minuto; el resto de las peticiones es una consulta a un dict. El mismo
pipeline decide con `SET NX` si es la primera petición del usuario en la franja,
y solo entonces se escribe `actividad_usuario` (como mucho 12 filas por usuario
y día, `ON CONFLICT DO NOTHING`). Si Redis no responde, nada falla: la puerta de
franja cae a la memoria local y "conectados" queda sin dato.

### Colector (celery-beat, cada minuto)

`app.infraestructura.tareas.metricas_tareas.capturar_metricas` corre en el
`celery-worker`: un scrape HTTP de `http://backend:8000/metrics` por la red de
Compose y un insert en `metrica_instantanea`, más `pg_stat_activity`, `INFO
memory` y `LLEN celery` de Redis y la presencia. Guarda DELTAS contra el scrape
anterior (que recuerda en Redis, clave `metricas:estado_previo`); un reinicio del
backend se detecta porque un acumulado baja. Sin lectura previa las columnas de
delta quedan en NULL, no en 0. Si el scrape falla no se inserta nada: la
ausencia de filas es lo que el resumen lee como «sin datos recientes».

La consulta a Postgres usa el mismo `statement_timeout` de 2000 ms que los
gauges de outbox (#1309/#1313). Las sondas (`/health`, `/health/ready`,
`/metrics`, `/`) no cuentan como peticiones. El p50/p95/p99 sale de sumar los
buckets por ruta de todas las instantáneas del rango (no de promediar
percentiles); el p95 que cae en el bucket `+Inf` se acota a 10 s.

Una fila pesa ~2 KB: columnas escalares más tres JSONB pequeños (buckets de
latencia, las 15 rutas con más tráfico del minuto, memoria por contenedor).

### Retención

`purgar_metricas_y_actividad` (03:20 del club, diario): instantáneas de más de
7 días y `actividad_usuario` de más de 35 días (el rango de 30 días del Resumen
más el día en curso).

### Snapshot del host

Los contenedores no ven el host y el socket de Docker no se monta en ninguno
(solo `autoheal`, ver `docker-compose.prod.yml`). En su lugar un cron del HOST
escribe un JSON cada minuto (`scripts/metrics/host-snapshot.sh`: CPU %, RAM,
swap, disco %, memoria por contenedor contra su `mem_limit`, con el nombre del
servicio de Compose) en `/var/lib/cata-club/metricas/host.json`, que
`celery-worker` monta de solo lectura en `/host-metricas`. Si el archivo falta,
está corrupto o tiene más de 3 minutos, el colector guarda el host como no
disponible (columnas NULL) y el endpoint devuelve `host: null`. Instalación y
verificación: [`monitoring.md`](monitoring.md#snapshot-del-host-para-actividad-del-club-issue-1314).
