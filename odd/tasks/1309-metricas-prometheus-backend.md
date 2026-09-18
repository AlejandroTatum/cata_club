# 1309 — Internal Prometheus metrics for the backend and outbox queues

Issue: https://github.com/AlejandroTatum/cata_club/issues/1309
Branch: `feat/1309-metricas-prometheus` (worktree `cata_club-worktrees/gentleman-1309`, cut from `origin/main` @ 17d8af6)
Delivery strategy: `ask-on-risk` (forecast ~350 authored changed lines, single PR, squash auto-merge)
TDD: **on** (strict, session config). Runner: `cd backend && uv run pytest <file>` (db-test on `localhost:5436`, never two backend suites at once); root locks: `uv run pytest tests/<file>` from repo root.
RDD: on (global). Candidate = the work-unit commit, reviewed with `--base-ref origin/main --committed-only` before push.

## Objective

Close readiness finding **A-1** (the only `Blocked` row left in `cata_club-docs/operations/production-readiness.md`): give the backend internal metrics so slowness, 5xx and a growing outbox queue are observable, not only "alive/dead".

## Problem

`rg -c -iE 'prometheus|opentelemetry|statsd' backend/app frontend/src` → nothing. The only internal signal is `X-Request-ID` correlation. The external heartbeat covers liveness and the cron jobs, not latency, error rate or queue depth.

## Scope (authorized)

- `GET /metrics` on the FastAPI app, at the root (NOT under `/api/v1`), via `prometheus-fastapi-instrumentator`: request latency histogram, count by handler/status, in-flight gauge. `include_in_schema=False`.
- Custom gauges over the three outbox tables (`enrollment_notificacion_outbox`, `recuperacion_outbox`, `verificacion_correo_outbox`): pending rows (`status == "PENDIENTE"`) per table, and age in seconds of the oldest pending row (`created_at`), computed at scrape time with bounded queries. A DB failure at scrape must not turn `/metrics` into a 500: expose a `..._scrape_ok` gauge (0/1) and keep the HTTP metrics.
- Edge stays closed: do NOT touch `Caddyfile` (it already proxies only `/health/ready` to the backend; `tests/test_docker_compose_config.py:1015` locks that). Add a lock test asserting `/metrics` never appears as a Caddy `handle` matcher and no `frontend/src/app/api/metrics` route exists.
- Dependency added with `uv add` so `backend/uv.lock` stays in sync (`Dockerfile` uses `uv sync --frozen`).
- Short operator note in `docs/operations/` (how to scrape from inside the Compose network, metric names).

Out of scope: Prometheus/Grafana on the host, OpenTelemetry/traces, alert rules, changes to `Caddyfile` or compose port publishing.

## Constraints

- Conventional Commits, no AI attribution trailers, no `Co-Authored-By`.
- Preserve unrelated tracked/untracked files. One writer, this worktree only.
- `run_in_threadpool` for any sync DB work inside an async route (lock in `tests/test_bloqueo_del_event_loop.py`).
- Tests seed via `db_session` + ORM factories, not through client fixtures with overrides.

## Tasks

- [x] T1. RED: behaviour tests — `backend/tests/test_metricas.py`: `/metrics` returns 200 with the Prometheus exposition content type and HTTP series after one request; outbox gauges reflect seeded pending rows per table and oldest-pending age; scrape survives a DB error (`scrape_ok 0`, HTTP series still present); `/api/v1/metrics` is 404. Root lock in `tests/test_docker_compose_config.py`: `/metrics` is never a Caddy matcher and no BFF route exists.
- [x] T2. GREEN: add `prometheus-fastapi-instrumentator` via `uv add`; instrument the app in `backend/main.py`; outbox collector in `backend/app/infraestructura/metricas.py` (or equivalent under `infraestructura/`).
- [x] T3. REFACTOR + docs: operator note in `docs/operations/metricas.md`; README pointer if `docs/operations` is indexed there.
- [x] T4. Verification: focused tests, then `make pre-pr LANE=backend` (sandbox off), record results here; one work-unit commit.
- [ ] T5. Native review (RDD) on the commit, push, PR with `--squash --auto`, post-merge main green, housekeeping. **Not this writer's task — orchestrator/next agent.**
- [ ] T6. `cata_club-docs`: A-1 row `Blocked` → `Needs evidence` (deployed to staging pending owner); becomes `Ready (staging)` once the owner deploys and scrapes. **Not this writer's task.**

## Acceptance criteria

- `curl backend:8000/metrics` inside the Compose network returns `http_request_duration_seconds_*`, `http_requests_total`, `http_requests_inflight`, `cata_outbox_pendientes{tabla=...}`, `cata_outbox_pendiente_mas_antiguo_segundos{tabla=...}`, `cata_outbox_scrape_ok`.
- Public domain `/metrics` never reaches the backend (Caddy catch-all → Next → 404), locked by test.
- Backend lane green; Docker build unaffected (`uv.lock` in sync).

## Evidence

- T1 RED: reverted `backend/main.py` to `origin/main` and moved `metricas.py` out
  of the tree, then `cd backend && TEST_DATABASE_URL=... uv run pytest
  tests/test_metricas.py -q` → `ImportError: No module named
  'app.infraestructura.metricas'` (collection error, the correct RED reason for
  a module that doesn't exist yet — no fixture/DB noise). Root lock
  (`uv run pytest ../tests/test_docker_compose_config.py -q -k metrics`) passed
  immediately as a static guard (Caddyfile/BFF already have no `/metrics`
  route); it doesn't need a RED phase.
- T2 GREEN: restored the implementation, `cd backend && TEST_DATABASE_URL=...
  uv run pytest tests/test_metricas.py -v` → `6 passed`. One assertion in the
  DB-failure test was too strict on first GREEN attempt (checked for the
  metric name substring, which the HELP/TYPE header always emits even with
  zero samples) — fixed to check for the absence of a data line instead;
  documented inline in the test.
- Discovered along the way: adding `Instrumentator().instrument(app)` broke two
  pre-existing structural locks that assert exact frozen sets —
  `test_main.py::test_orden_de_la_pila_de_middleware_es_el_declarado` (the
  instrumentator's own middleware joined the stack) and
  `test_guardia_autorizacion_rutas.py::test_cada_ruta_declara_la_autorizacion_esperada`
  (`GET /metrics` has no auth dependency and wasn't in the frozen
  `RUTAS_PUBLICAS` set). Both fixed: `instrument(app)` moved to run before
  CORS/Correlación/Cabeceras so it lands as the innermost middleware (closest
  to the router), and `("GET", "/metrics")` added to `RUTAS_PUBLICAS` with a
  justification comment (network-level protection via Caddy/BFF, not
  credentials — same class as `/health`).
- T4 verification:
  - `cd backend && uv run ruff check .` → `All checks passed!`
  - `cd backend && uv lock --check` → in sync (`Resolved 101 packages`)
  - `cd backend && TEST_DATABASE_URL=... uv run pytest tests/ -q` → `2784
    passed, 3 skipped, 90 warnings` (full backend suite, ~9 min)
  - `cd backend && uv run pytest ../tests/ -q` → `633 passed, 1 skipped`
    (root-level suite, incl. the new Caddy/BFF lock)
  - `make pre-pr LANE=backend`: `ruff check`, `lint-imports` (3 contracts
    kept), `pip-audit` (no known vulnerabilities) all passed; the
    `test-backend-preflight` step's `docker compose ... up -d
    --force-recreate db-test` failed with `port is already allocated` —
    another checkout's `cata_club-db-test-1` (a *different* Compose project,
    same shared single-tenant Postgres on host port 5436, per this repo's
    "never run concurrent backend suites against it" constraint) already
    held port 5436 and was healthy throughout. Ran the lane's two remaining
    steps directly against that already-running container instead of
    recreating it: `make test-backend` → `2784 passed, 3 skipped`; `make
    test-root` → `633 passed, 1 skipped`. Net effect: every check the lane
    performs ran and passed; only the container **recreation** step itself
    was skipped, for the stated environmental reason.
  - Not run: `docker compose -f docker-compose.yml -f
    docker-compose.prod.yml config -q` standalone — needs `IMAGE_TAG`,
    `ACME_EMAIL`, `DOMINIO`, `POSTGRES_*`, `CORS_ORIGENES` that
    `tests/test_docker_compose_config.py` already supplies and asserts
    against (633 passed above covers this rendering path); not worth
    re-deriving by hand.
  - Sandbox note: the default Bash sandbox blocks TCP to `127.0.0.1:5436`
    (evidenced by a raw socket connect failing sandboxed and succeeding with
    `dangerouslyDisableSandbox`); every DB-touching command above ran with
    the sandbox disabled for that reason.

Commit: (recorded after commit, see PR).

- Review correction (native RDD, approved/non-blocking, 3 findings — all
  fixed before freezing the candidate, TDD RED-first via a temporary
  `git stash` of the two production files):
  1. **In-flight gauge documented but not enabled.** The instrumentator's
     in-progress gauge is opt-in; printing a real scrape confirmed no
     `http_requests_inprogress` series existed. Fixed by passing
     `Instrumentator(should_instrument_requests_inprogress=True)` in
     `backend/main.py`, with the comment corrected to say so explicitly.
     `docs/operations/metricas.md` rewritten to list the REAL series names
     (`http_request_duration_seconds` w/ its real suffixes,
     `http_requests_total`, `http_requests_inprogress`), verified against an
     actual scrape, not the library's own doc defaults (which don't match
     for the pinned version). `test_metrics_incluye_las_series_http_del_instrumentator`
     now asserts all three names.
  2. **Outbox happy path never asserted over HTTP.** Added
     `test_metrics_via_http_refleja_las_filas_sembradas_y_scrape_ok`: seeds
     via `db_session`, injects a `_SesionSinCierre(db_session)` wrapper as
     `main.colector_outbox.sesion_factory` (delegates everything, no-ops
     `close()` so the fixture's own teardown still works), hits `/metrics`
     over real HTTP, and asserts `cata_outbox_scrape_ok 1.0` plus each
     table's `cata_outbox_pendientes{tabla=...}` value **relative to a
     baseline read before seeding** — not an absolute count, since the test
     DB is shared across pytest sessions and an empty-DB assumption was
     exactly the gap flagged.
  3. **Scrape had no latency bound of its own.** A hung Postgres would hold
     a pool connection and a threadpool thread indefinitely. Added
     `TIMEOUT_SCRAPE_SENTENCIA_MS = 2000` and `SET LOCAL statement_timeout`
     (scoped to the scrape's own transaction, discarded on `db.close()`) in
     `backend/app/infraestructura/metricas.py`. Covered two ways: a real,
     unmocked `pg_sleep(3)` test that lets Postgres cancel the query for
     real (`test_scrape_con_una_consulta_que_excede_el_timeout_da_scrape_ok_0`
     — cheaply testable, ~2s), plus a cheap unit test confirming the
     `SET LOCAL` actually took effect
     (`test_scrape_aplica_un_statement_timeout_acotado_a_su_sesion`, reading
     `pg_settings.setting` rather than `SHOW`, which normalizes `2000ms` to
     `'2s'` and would have made the assertion fragile).
  - RED: `git stash push -- backend/main.py backend/app/infraestructura/metricas.py`
    (test file kept as the new version), then `TEST_DATABASE_URL=... uv run
    pytest tests/test_metricas.py -v` → `3 failed, 6 passed` — the 3 failures
    were exactly the three corrections above, each failing for the right
    reason (`http_requests_inprogress` absent; `pg_sleep(3)` completing
    normally without a timeout so `scrape_ok` stayed `1`;
    `AttributeError: module ... has no attribute 'TIMEOUT_SCRAPE_SENTENCIA_MS'`).
  - GREEN: `git stash pop`, same command → `9 passed` (one assertion needed
    a follow-up fix: `SHOW statement_timeout` returns `'2s'`, not `'2000ms'`
    — switched to `pg_settings.setting`, which is unformatted).
  - `cd backend && uv run ruff check .` → `All checks passed!`
  - `cd backend && TEST_DATABASE_URL=... uv run pytest tests/ -q` → `2787
    passed, 3 skipped, 90 warnings` (full backend suite, 3 more tests than
    before the correction).
  - `cd backend && uv run pytest ../tests/ -q` → `633 passed, 1 skipped`
    (root-level suite, unchanged).

- Second review correction (native RDD, approved; 3 WARNINGs, one a real
  startup defect — TDD RED-first for the one with a production-code fix):
  1. **Import-time DB side effect (real defect).** `prometheus_client`'s
     default `REGISTRY` is built with `auto_describe=True`
     (`registry.py::REGISTRY`); `CollectorRegistry.register()` calls
     `collect()` right there when a collector has no `describe()`, to learn
     the names it declares. `REGISTRY.register(colector_outbox)` runs at
     module scope in `main.py`, so importing `main` opened a DB session and
     ran the three outbox queries before uvicorn served a single request —
     with Postgres not yet accepting connections (Compose start order, a DB
     restart), the import hung on the TCP connect, which
     `TIMEOUT_SCRAPE_SENTENCIA_MS` does not bound (that timeout is a
     `SET LOCAL` inside an already-open transaction; it never runs if the
     connection itself never opens). Fixed: `ColectorOutbox.describe()`
     returns the three EMPTY `GaugeMetricFamily` instances (same
     names/labels/help as `collect()`, via a shared `_familias_vacias()`
     helper), so registration is side-effect free. The `main.py` comment
     that claimed registering-in-`main.py`-not-`metricas.py` was enough to
     avoid an import-time DB effect was corrected — that only avoids
     registering on a bare `import metricas`; it says nothing about what
     `register()` itself does.
     - RED: `TEST_DATABASE_URL=... uv run pytest
       tests/test_metricas.py::test_registrar_el_colector_no_abre_ninguna_sesion_de_bd -v`
       against the pre-fix `metricas.py` → 1 failed (the injected
       `sesion_factory` WAS called during `CollectorRegistry(auto_describe=True).register(...)`,
       confirming the defect; `collect()`'s own `except Exception` swallowed
       the raised error, so the test failed on the recorded-calls assertion,
       not a crash).
     - GREEN: same command after adding `describe()` → `1 passed`.
  2. **Absolute-count test inconsistent with the file's own baseline
     rationale.** `test_gauge_de_pendientes_cuenta_solo_las_filas_pendientes_por_tabla`
     asserted `== 1`/`== 1`/`== 0` against the shared test DB while the
     HTTP happy-path test right below it explicitly reads a baseline first
     for the same reason. Fixed via the isolation option the review
     offered as an alternative: `_vaciar_tablas_outbox(db_session)` deletes
     all three outbox tables' rows inside the test's own transaction (which
     `db_session` rolls back at teardown, so it never touches the shared
     DB) before seeding, so the absolute assertions — including the
     `edad == 0.0` exact-zero check, which a baseline-relative rewrite
     would have had to weaken to `>= 0` — stay valid regardless of
     pre-existing rows. Both outbox-seeding tests now encode the same
     invariant (never assume the shared DB starts empty), through two
     different mechanisms documented side by side in the module docstring.
     No production-code change; no RED phase (test-only correctness fix).
  3. **`scrape_ok 0` cause not fully documented.** `docs/operations/metricas.md`
     said `0` meant the DB was unreachable; it is also `0` when any outbox
     query exceeds `TIMEOUT_SCRAPE_SENTENCIA_MS` (2000 ms) — a reachable but
     slow Postgres gives the same value. Both causes and the timeout figure
     are now documented in two places (the metric table's prose and the
     "Lectura sugerida" section), with the `/health/ready` cross-check
     advice for telling them apart.
  - `cd backend && TEST_DATABASE_URL=... uv run pytest tests/test_metricas.py -v`
    → `10 passed` (up from 9: the new registration test).
  - `cd backend && uv run ruff check .` → `All checks passed!`
  - `cd backend && TEST_DATABASE_URL=... uv run pytest tests/ -q` → `2788
    passed, 3 skipped, 90 warnings` (full backend suite, 1 more than before).
  - `cd backend && uv run pytest ../tests/ -q` → `633 passed, 1 skipped`
    (root-level suite, unchanged).
  - Follow-up (advisory, not done) — remaining SUGGESTION ids from this
    review, not addressed, so they are not lost:
    - R1-001 (`backend/main.py:424-425`)
    - R2-002 (`backend/tests/test_metricas.py:24-25`)
    - R2-005 (`docs/operations/metricas.md:63-64`)
    - R2-006 (`backend/app/infraestructura/metricas.py:75`)

## Next step

T5/T6 — not this writer's scope (native review, push, PR, and the
`cata_club-docs` A-1 row update are separate steps per the task brief).
