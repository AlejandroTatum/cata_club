# 1311 — Harden the /metrics tests: bounded outbox age, transaction-scoped statement_timeout, bounded connects

Issue: https://github.com/AlejandroTatum/cata_club/issues/1311
Branch: `test/1311-acotar-metricas` (worktree `cata_club-worktrees/gentleman-1311`, cut from `origin/main` @ 35a92f0)
Delivery strategy: single PR, squash auto-merge (forecast ~350 changed lines, tests+docs+small infra change)
TDD: **on** (strict, session config). Runner: `cd backend && TEST_DATABASE_URL=postgresql+psycopg://usuario:password@localhost:5436/cataclub_test uv run pytest <file>` (db-test on `localhost:5436`, single-tenant; never two backend suites at once).
RDD: on (global). Candidate = the work-unit commit, reviewed with `--base-ref origin/main --committed-only` before push.

## Objective

Close the five WARNING findings of the native review follow-up on the #1310 metrics delivery. None changes delivered behavior except W3 (a new engine-level connect bound); the rest harden tests and make comments/docstrings stop lying or stop repeating.

## Findings (from the issue)

- **W1** — oldest-pending age never numerically bounded (`test_metricas.py:224` asserts `> 0`; a multi-hour timezone bug or a milliseconds value stays green). The HTTP test (`:285-295`) never reads `cata_outbox_pendiente_mas_antiguo_segundos`, and the naive-`created_at` fallback (`metricas.py:73-76`) has no test.
- **W2** — the `SET LOCAL` test proves the timeout was set, not that it is transaction-scoped (`:351-356`); a regression to plain `SET` would still pass.
- **W3** — the scrape connection is unbounded before auth: `db.py` sets `pool_timeout` but no `connect_timeout`, so a TCP-accepting-but-hung Postgres retains handler thread + pool slot indefinitely. Pre-existing for every DB route; fix at engine level.
- **W4** — `test_scrape_con_una_consulta_que_excede_el_timeout_da_scrape_ok_0` docstring claims "Contra Postgres REAL, sin mockear nada" but monkeypatches `calcular_pendientes_por_tabla` with `pg_sleep(3)`; module docstring line ~53 repeats the claim.
- **W5** — the `describe()` rationale is triplicated almost verbatim: `main.py:425-433`, `metricas.py:119-135`, `test_metricas.py:115-137`. Keep once, reference elsewhere.

## Design decisions (parent, verified before delegation)

- **W2 discriminator is COMMIT, not rollback.** Verified empirically against db-test with libpq/psycopg:
  `SET LOCAL` + COMMIT → reverts; `SET` + COMMIT → persists; but `ROLLBACK TO SAVEPOINT` reverts BOTH. The issue's literal closure (`rollback()` + re-read) cannot distinguish `SET` from `SET LOCAL` inside the savepoint fixture — C and D in the probe below. The test therefore uses a dedicated `motor_test` connection (NullPool, safe to commit: only SELECTs + the SET run), wraps it so `collect()`'s `db.close()` is a no-op, asserts `statement_timeout == 2000` inside the transaction, commits, and asserts the setting returned to the pre-scrape default. With a plain-`SET` regression the post-commit read stays `2000` → red.
- **W1 bounds.** Pure test: seed is exactly 1 h old → assert `3500 <= edad <= 3700`. HTTP test: age after seeding must equal `max(base_edad, 3600) + δ` for enrollment (seeded 1 h ago), `base_edad + δ'` bounded for verificacion/recuperacion (seeded rows are newer or none), with generous seconds-level slack. Naive-fallback: stub session whose `.execute(...).one()` returns a naive datetime — past → bounded ~3600, future → `0.0` (the `max(0.0, ...)` clamp). No DB needed.
- **W3 value: 5 s**, same class and number as `TIMEOUT_POOL_SEGUNDOS` (how long an HTTP request may wait on the DB before failing loudly); readiness keeps its tighter 2 s because probes must be snappier than requests. Wiring: `connect_args={"connect_timeout": ...}` on the `db.py` engine via a small `crear_engine(database_url, timeout_conexion=...)` factory so a behavioral test can bound it cheaply. Behavioral test: a localhost socket that accepts TCP but never speaks (kernel completes the handshake; psycopg then waits forever for the startup reply) → `engine.connect()` must raise `OperationalError` within the bound instead of hanging.

## Scope (authorized)

- Edit: `backend/tests/test_metricas.py`, `backend/app/infraestructura/metricas.py` (comments only unless a test demands otherwise), `backend/main.py` (comment trim), `backend/app/infraestructura/db.py`, `docs/operations/metricas.md` (timeout wording), new `backend/tests/test_db.py`.
- No new dependencies; no changes to `Caddyfile`, compose, root `tests/` locks.
- Comments and docstrings in Spanish, matching the existing files.

## Tasks

- [x] T1 (W1): bounded age assertions + HTTP read of the age series + naive-fallback unit test.
- [x] T2 (W2): transaction-scope proof via dedicated connection + commit discriminator.
- [x] T3 (W4+W5): honest docstrings + single canonical `describe()` rationale with references.
- [x] T4 (W3): `connect_timeout` at engine level + behavioral hanging-socket test (+ doc sentence).
- [x] T5: verification — focused files, then `make pre-pr LANE=backend`; work-unit commits per task.
- [x] T6: native review on the commits, push, PR `Closes #1311` with squash auto-merge, post-merge main green, housekeeping.

## Acceptance criteria

- Every WARNING of the issue has a visible closure in the diff; W2's deviation from the literal suggestion (COMMIT instead of rollback) is documented in the test and the PR body with the empirical reason.
- Full `backend/tests/test_metricas.py` + new `backend/tests/test_db.py` green against db-test; backend lane green.
- No behavior change on `/metrics` responses except the engine connect bound.

## Evidence

### T1 (W1)

- **RED** — mutación temporal: se borró la rama `if mas_antigua.tzinfo is None:
  mas_antigua = mas_antigua.replace(tzinfo=timezone.utc)` en `metricas.py`. El test
  nuevo `test_la_edad_interpreta_un_created_at_naive_como_utc` falla con
  `TypeError: can't subtract offset-naive and offset-aware datetimes`
  (`app/infraestructura/metricas.py:73`). Revertido.
- **GREEN** — `cd backend && TEST_DATABASE_URL=postgresql+psycopg://usuario:password@localhost:5436/cataclub_test uv run pytest tests/test_metricas.py -q` → 12 passed (eran 10; +2 nuevos: el de naive-UTC y el del clamp a 0).
- Cambios: acotado `3500 <= edad_enrollment <= 3700` y `0 <= edad_recuperacion <= 120` en la prueba pura; la prueba HTTP ahora captura `base_edad_<tabla>` y lee `cata_outbox_pendiente_mas_antiguo_segundos` con la ventana `max(base_edad, 3600) ± slack`; dos tests unitarios nuevos con una sesión doble que devuelve `(1, created_at)` por tabla.

### T2 (W2)

- **RED** — mutación temporal: `SET LOCAL statement_timeout` → `SET
  statement_timeout` en `ColectorOutbox.collect()`. El test renombrado
  `test_scrape_fija_el_statement_timeout_y_no_escapa_de_su_transaccion` falla en
  la lectura post-commit: `AssertionError: assert '2000' == '0'` (el `SET`
  sobrevive al commit). Revertido. Esto valida empíricamente que COMMIT es el
  discriminador y que un savepoint-rollback no lo sería.
- **GREEN** — misma corrida focal: 12 passed.
- Desviación documentada del literal del issue: el sondeo del parent mostró que
  `ROLLBACK TO SAVEPOINT` revierte TANTO `SET LOCAL` como `SET`, así que la
  prueba usa una conexión dedicada de `motor_test` y COMMIT; queda escrito en el
  docstring del test y va al cuerpo del PR.
- Cambios: test renombrado a `test_scrape_fija_el_statement_timeout_y_no_escapa_de_su_transaccion`,
  `_SesionSinCierre` generalizado (envuelve sesión de savepoint o `Connection`
  cruda), comentario del `SET LOCAL` en `metricas.py` con puntero al test.

### T3 (W4+W5)

- **RED** — no aplica: son docstrings/comentarios. `GREEN` = la suite del archivo sigue verde y ningún comentario miente.
- **GREEN** — `uv run pytest tests/test_metricas.py -q` → 12 passed (y `tests/test_main.py` al cierre).
- W4: docstring de `test_scrape_con_una_consulta_que_excede_el_timeout_da_scrape_ok_0` y la línea del docstring de módulo ahora dicen que la consulta lenta SÍ se stubbea (`pg_sleep(3)`) pero el timeout es real (Postgres cancela con `QueryCanceled`).
- W5: la historia de `describe()` queda una sola vez en `metricas.py::ColectorOutbox.describe()`; `main.py` bajó a 4 líneas con puntero, y el docstring del test de registro y el párrafo del módulo conservan solo lo específico (registry propio, factory que anota y lanza, por qué la excepción no rompe `collect()`).

### T4 (W3)

- **RED** — script de una línea envuelto en `timeout 8` (sin tocar pytest):
  `create_engine(url)` plano contra un socket local que acepta TCP y nunca
  responde. El proceso fue **matado por `timeout`** (`exit_code=124`), es decir
  el connect quedó colgado más allá de los 8 s -- la prueba de que `pool_timeout`
  solo no acota el handshake. No se comiteó ninguna mutación.
- **GREEN** — `cd backend && TEST_DATABASE_URL=postgresql+psycopg://usuario:password@localhost:5436/cataclub_test uv run pytest tests/test_metricas.py tests/test_db.py -q` → 14 passed (12 + 2 nuevos de `test_db.py`).
- Cambios: `db.py` suma `TIMEOUT_CONEXION_SEGUNDOS = 5` con rationale y la
  fábrica `crear_engine(database_url, timeout_conexion=...)` (mismos kwargs que
  antes + `connect_args`); nuevo `tests/test_db.py` con el doble de socket
  colgado y el guard de alineación `TIMEOUT_CONEXION_SEGUNDOS ==
  TIMEOUT_POOL_SEGUNDOS`; una frase nueva en `docs/operations/metricas.md`.

### T5 — Verificación del parent (`make pre-pr LANE=backend`)

- Primer intento **bloqueado por ambiente** (no por el candidato): el
  preflight del worktree publica 127.0.0.1:5436, ya ocupado por el
  `cata_club-db-test-1` del checkout principal (regla single-tenant de
  `AGENTS.md`). Resolución: `docker compose --profile test stop db-test` en
  el checkout principal, limpieza del residuo `gentleman-1311-db-test-1`
  (Created, nunca iniciado) + su red, y relanzamiento del lane.
- Segundo intento **exit 0**: secrets/ruff/lint-imports/pip-audit PASS;
  preflight PASS (`gentleman-1311-db-test-1` healthy); suite backend
  `2792 passed, 3 skipped, 90 warnings` (11:07); root `633 passed, 1
  skipped`. Skips y warnings preexistentes, nada de métricas.
- Gate de CI **no reproducido localmente**: `migraciones-desde-cero` contra
  su PostgreSQL service aislado (el propio lane lo declara). El lane local
  es check predictivo, no paridad total de CI.

### T6 — Review nativo (RDD)

- Lineage `review-8673249be2f1562e`, tier **medium**, lente
  `review-reliability`, 7 archivos / 495 líneas, base-diff contra
  `origin/main` committed-only. Forecast: 1 corrida de modelo.
- Cierre terminal: **approved** en el último evento admitido;
  acknowledgement ejecutado y authority quemada
  (`gentle-ai.review-acknowledged/v1`).
- Hallazgos **advisory no bloqueantes** (trabajo futuro, no de este
  candidato; mismo criterio que este issue aplicó sobre #1310):
  `R3-CONNECT-TEST-CAN-HANG` (WARNING, `tests/test_db.py:65-69`) y
  `R3-ENGINE-CONNECT-ARGS-DRIVER-COUPLED` (SUGGESTION, `db.py:54`).
