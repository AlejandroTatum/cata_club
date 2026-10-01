# Pruebas de carga con k6 — QA local (`#1314`)

Harness reproducible para responder, con evidencia: ¿aguanta el backend **100
usuarios concurrentes (VUs)** dentro de los SLOs provisorios y, si no, ¿dónde
se rompe? Es el requisito previo de la observabilidad (#1314,
Prometheus/Grafana): primero medir, después construir paneles sobre lo medido.

Tracker de la feature: `odd/tasks/100-user-load-test.md` (umbrales,
vocabulario y decisiones de calibración viven ahí primero).

## Prohibición de staging y producción

**Este harness es SOLO para el stack local de QA.** Correr carga contra
staging o producción está **prohibido** sin una autorización explícita y
separada del owner — no hay excepción preautorizada en el tracker. El
fail-closed tiene tres capas que rechazan cualquier `LOAD_BASE_URL` que no
sea `localhost` / `127.0.0.1` / `[::1]`:

1. El default del Makefile (`LOAD_BASE_URL ?= http://localhost:3000`).
2. El runner `scripts/load/run_load_test.sh` (rechaza y nombra la prohibición).
3. `load/k6/common.js` (lanza en el init-context de k6, antes de la primera
   request; la política vive en el módulo puro `load/k6/local_guard.js`, que
   los contratos ejecutan con node).

Las autoridades con **userinfo** — `http://127.0.0.1:9@staging.example.com`
conecta realmente a `staging.example.com` — se rechazan SIEMPRE, en el shell
(y en k6, por construcción de la regex). Solo pasan `localhost`,
`127.0.0.0/8` y `[::1]`, con puerto numérico opcional.

## Prerrequisitos

- Docker (no hace falta instalar k6: el runner usa la imagen oficial
  **pinned** `grafana/k6:1.0.0`; el primer run hace pull).
- El stack de QA levantado y sembrado: `make qa-up` (frontend `:3000`,
  backend `:8000`, Postgres `:5433`, dataset grande incluido).
- `db-test` en `localhost:5436` para el preflight del repo
  (`make test-backend-preflight` lo levanta si falta).
- Credenciales del seed de QA por entorno — **nunca versionadas**:
  - Pool acotado: `LOAD_CREDENTIALS_JSON='[{"email":"...","password":"..."}]'`
  - O una sola credencial: `LOAD_EMAIL=... LOAD_PASSWORD=...`
  - Convención del seed (`backend/scripts/seed_dev_bulk.py`): desde la
    decisión del owner (100-user-load-test) el seed masivo crea **110
    alumnos auto-gestionados** — suficiente para un pool 1:1 de ≥ 100
    identidades. Los literales exactos no viven en este árbol por contrato
    (`tests/test_load_testing_config.py` lo candá).
- **Pool recomendado para el steady** (evita compartir identidades y sus
    techos por usuario): construyelo en runtime desde la BD de QA:

  ```bash
  QA_SEED_PASSWORD='...' make load-pool      # → load/results/credentials-pool.json (0600, git-ignorado)
  LOAD_CREDENTIALS_FILE=load/results/credentials-pool.json make load-steady
  ```

  El helper no imprime ni versiona el password: entra por `QA_SEED_PASSWORD`
  y solo se escribe en el archivo local git-ignorado. Si el pool ofreciera
  menos identidades que las pedidas, corta con error (nunca un pool chico).

## Vocabulario vinculante: VU vs. sesiones

- **VU** = usuario concurrente **en un instante** (un usuario k6 con su
  sesión HTTP en vuelo). El steady de 100 VUs significa **100 usuarios
  simultáneos en el pico**, no 100 en total.
- **Sesiones** = journeys totales ejecutados en toda la corrida (k6
  `iterations`). Una corrida de 100 VUs × 10 min completa cientos o miles de
  sesiones. `summary.json` reporta ambos números por separado
  (`sessions.vus_max` y `sessions.sessions_completed`) para que nunca se
  confundan.

**Honestidad sobre identidades**: el pool de credenciales es **acotado y se
reutiliza** entre VUs (el VU `i` usa `pool[(i-1) % pool.length]`). 100 VUs
NO significan 100 identidades distintas: el backend ve a lo sumo
`pool.length` identidades concurrentes autenticadas. Es una limitación
conocida y aceptada del harness local (sembrar 100 cuentas dedicadas y su
ciclo de vida es otro problema); documéntalo en cualquier evidencia que
compartas.

## Cookies de auth en QA (http:// + Secure)

El build de producción del frontend setea las cookies de autenticación con el
atributo **Secure** (nombres reales: `access_token` y `refresh_token`), y el
jar de cookies de k6 rechaza cookies Secure sobre `http://` — sin esto, todo
el viaje iría anónimo (dashboard 401) aunque el login respondiera 200. El
harness NO debilita la seguridad de cookies de la aplicación: extrae de la
respuesta de login únicamente los VALORES de esos dos nombres esperados y los
manda como header `Cookie` explícito en cada paso BFF. Los valores provienen
de la propia respuesta de login de cada VU (aislamiento por VU intacto), y
jamás se loguean ni se escriben en los artefactos de resultados.

## El viaje medido

Cada iteración recorre el mismo camino que un usuario real por el borde
público de QA (el frontend Next.js como BFF — no `/health`):

1. `POST /api/auth/login` — JSON `{email, password}`; el BFF setea cookies
   HttpOnly y devuelve la sesión sin tokens (`user.id` = personaId,
   `user.role`). **Cada VUloguea UNA sola vez** (caché por VU): el backend
   limita login a **60/minuto por IP** (`auth_router.py:43`) y todos los VUs
   salen de una sola IP.
2. `GET /api/auth/session` — la hidratación que toda página hace al montar.
3. Una lectura agregada según el rol: `GET /api/dashboard` (admin) o
   `GET /api/student?personaId=...` (resto).

Con think-time de 1–3 s entre iteraciones.

## Cómo correr

```bash
make load-preflight   # salud del stack local: db-test :5436, QA :3000/:8000
make load-baseline    # 1 VU, 3m (LOAD_BASELINE_DURATION) — calibración
make load-ramp        # rampa escalonada hasta 100 VUs (LOAD_RAMP_MAX_VUS)
make load-steady      # 100 VUs constantes, 10m (LOAD_STEADY_DURATION)
```

Las credenciales viajan por entorno (el make target no las toca):

```bash
LOAD_EMAIL='...' LOAD_PASSWORD='...' make load-baseline
LOAD_CREDENTIALS_JSON='[{"email":"...","password":"..."}]' make load-steady
```

Orden recomendado: **baseline primero**; solo si el baseline es sano corre
el steady. El ramp es diagnóstico: ubica la rodilla antes de comprometerse a
10 minutos de steady.

## Cómo leer los resultados

Cada corrida deja un directorio `load/results/<UTC ts>-<escenario>/`
(git-ignorado):

| Archivo | Qué es |
| --- | --- |
| `summary.json` | Resumen k6 completo legible por máquina + bloque `sessions` (`vus_max` vs `sessions_completed`). |
| `resources.jsonl` | Una muestra JSON por intervalo: CPU/memoria de backend y db (solo observación), conexiones vs `max_connections`, antigüedad del outbox `PENDIENTE` más viejo, salud del contenedor backend. |
| `run.json` | Metadatos: escenario, imagen k6, código de salida y su significado, artefactos presentes, si abortó el monitor. |
| `abort.txt` | Presente SOLO si el monitor de host abortó: motivo + timestamp. |
| `k6-stdout.log` | El resumen humano de k6 (texto). |
| `k6-raw.json` | Stream por request de k6, solo con `LOAD_K6_JSON=1` (útil para el análisis fino de la rodilla en el ramp). |

Números clave de `summary.json`:

- `metrics.http_req_failed.values.rate` — fracción de requests fallidas.
- `metrics.http_req_duration.values['p(95)']` — p95 en ms.
- `metrics.iterations.values.count` — sesiones completadas.
- `metrics.journey_failure_rate.values.rate` — iteraciones con algún paso
  fallido (salud a nivel viaje, no request).
- `journey_*_duration` — tendencias por paso (login / session / lectura).

## Techos de tasa del backend que el harness respeta

- **Login: 60/minuto por IP** (`@limiter.limit("60/minute")` en
  `auth_router.py`). Por eso el ramp y el warm-up del steady tardan **3
  minutos** en llegar a 100 VUs (~33 logins nuevos/min < 60) y cada VUloguea
  una sola vez. Corridas más largas que ~55 min necesitarían re-login (el
  access token vive 60 min): fuera de alcance actual, documentado.
- **Portal: 30/minuto por USUARIO** sobre
  `/personas/{id}/representados` — una ruta que el BFF pide en CADA lectura
  del portal (`student/route.ts:86`). Con el think time default (2–4 s) cada
  VU hace ~17–20 lecturas/min: la regla es **≥ 1 identidad por VU**
  (pool ≥ VUs, asignación 1:1 por `pool[(vu-1) % pool.length]`). Si el pool
  es menor, alargá el think time: `lecturas/min por identidad ≈ 60 /
  (think_promedio + ~0,3 s) × VUs_por_identidad < 30`, knobs
  `LOAD_THINK_TIME_MIN`/`LOAD_THINK_TIME_MAX`.
- El pool debe usar roles CALIBRADOS (ALUMNO o ADMINISTRADOR): otros roles
  (p. ej. ENTRENADOR) hacen lecturas que chocan con otros límites por
  usuario y no son evidencia válida de capacidad.
- **Pool suficiente, fail-closed**: el steady exige ≥ 100 identidades (1 por
  VU) y el ramp ≥ tantas como su tope (`LOAD_RAMP_MAX_VUS`); con menos, la
  corrida ni arranca. El baseline admite una credencial.

## Warm-up vs plato

El **warm-up/ramp** (3 min, 0→100 VUs) existe para respetar el techo de
login: NO es evidencia de capacidad. El **plato** es la ventana de
`LOAD_STEADY_DURATION` (default 10 m) con los 100 VUs sostenidos. Cada
request lleva la etiqueta `phase` (warmup/plateau/rampdown, calculada con el
reloj del escenario) y los umbrales de **aceptación** del steady
(<1 %, p95 < 800 ms) se ligan SOLO a las sub-métricas
`{phase:plateau}` — el warm-up y la bajada no diluyen el veredicto. Los
**abortos** de seguridad (5 % / 3 s) quedan globales y cubren TODA la
corrida. `summary.json` separa
explícitamente `vus_observed_peak` (máximo del gauge `vus` de k6:
concurrencia realmente observada) de `vus_configured_capacity` (la métrica
`vus_max` de k6, que reporta capacidad CONFIGURADA, no observada). Las
estadísticas de tendencia incluyen p99 además de p95.

## Umbrales provisorios y su calibración

Aceptación del steady (provisorios, fijados en el tracker):

- Requests fallidas **< 1%** (`rate<0.01`).
- p95 **< 800 ms** (`p(95)<800`).

Calibración: **el baseline de 1 VU manda**. Corré el baseline, mirá el p95 y
la tasa de error de UN usuario sin contención; si ese piso muestra margen
materialmente distinto al asumido, revisá los números en
`odd/tasks/100-user-load-test.md` ANTES de interpretar el steady (primero el
documento, después el código — los tests candan los valores).

Abortos (cortar la corrida, no iterar hacia el daño):

| Señal | Quién la aplica | Semántica exacta |
| --- | --- | --- |
| Tasa de error ≥ 5% | k6 (`rate<0.05`, `abortOnFail`, primera evaluación tras 10 s) | k6 evalúa umbrales sobre el **agregado acumulado** de la corrida, NO sobre ventanas deslizantes: corta en la primera evaluación que cruza el límite. No es "5% en una ventana". |
| p95 ≥ 3 s | k6 (`p(95)<3000`, `abortOnFail`, primera evaluación tras 30 s) | Mismo agregado acumulado, no "30 s sostenidos". El retardo solo posterga la PRIMERA evaluación. |
| Reinicio / OOM / caída del contenedor backend | Monitor de host, inmediato | `docker inspect`: `RestartCount` sube, `OOMKilled=true` o `Running=false`. |
| Agotamiento del pool de conexiones | Monitor de host | `pg_stat_activity` ≥ 90% de `max_connections` en 3 muestras consecutivas (≈30 s). |
| Outbox creciendo sin límite | Monitor de host | Edad del `PENDIENTE` más viejo > 300 s en 6 muestras consecutivas (proxy de "sin límite"; ajustable con `LOAD_OUTBOX_ABORT_SECONDS`/`_SAMPLES`). |

CPU y memoria de contenedores son **solo observación**: son evidencia, no
entrada de aborto. Un aborto del monitor escribe `abort.txt`, corta k6 con
SIGTERM y deja `run.json` con `monitor_aborted: true`. **Todo aborto se
registra como hallazgo, no como failure por ocultar.** Códigos de salida de
k6: `0` umbrales cumplidos, `99` umbral incumplido, `105` interrumpido
(aborto del monitor o Ctrl-C).

## Correlación con métricas del backend

El backend ya expone `GET /metrics` (latencia/conteo HTTP y profundidad de
las colas outbox, interno a Compose — ver
[`metricas.md`](metricas.md)). Durante una corrida podés muestrearlo desde la
red de Compose para correlacionar la vista del borde (k6) con la vista del
proceso; el scraper de Prometheus/Grafana es exactamente el alcance de #1314
y NO forma parte de este harness.
