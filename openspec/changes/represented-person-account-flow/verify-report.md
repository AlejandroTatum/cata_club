# Independent verification — PR 2 credential/capability slice (corrective rerun)

## Result Contract

**PR 2 verdict: PASS.** This corrective evidence supersedes the prior port-5436 validation block for the PR 2 slice only. The complete OpenSpec change remains **BLOCKED for archive** because later implementation and lifecycle tasks remain unchecked.

- Change/status: `represented-person-account-flow`; `artifactStore: openspec`; native verify state `ready`.
- Action context: `repo-local`; authoritative workspace and allowed edit root are this `pi-1137-pr2` worktree.
- Scope: base `4a60ca25312f0fa4a3074507e40b20be951651a7`, branch `fix/represented-person-credentials`, PR 2 only. No implementation file was modified during this verification.
- PostgreSQL: the old `pi-1137-db-test-1` was already stopped by the parent; this run created and used only `pi-1137-pr2-db-test-1` on exclusive port 5436. Stopping that old service did not discard or modify `pi-1137` WIP.

## Exact corrective validation

| Gate | Exact command | Result |
|---|---|---|
| Focused PostgreSQL GREEN | `cd backend && TEST_DATABASE_URL=postgresql+psycopg://usuario:password@localhost:5436/cataclub_test uv run pytest tests/test_auth.py tests/test_roles.py -q` | PASS — `20 passed, 1 warning in 6.47s` |
| Declared safety net | `cd backend && TEST_DATABASE_URL=postgresql+psycopg://usuario:password@localhost:5436/cataclub_test uv run pytest tests/test_rol_unico_por_cuenta.py tests/test_auth_registro_refresh.py tests/test_autenticacion_endpoints.py tests/test_admin_cuenta_servicio.py tests/test_auth.py tests/test_roles.py -q` | PASS — `92 passed, 1 warning in 15.27s` |
| Focused Ruff | `cd backend && uv run ruff check app/servicios_negocio/auth_servicio.py app/servicios_negocio/rol_servicio.py tests/test_auth.py tests/test_roles.py` | PASS — `All checks passed!` |
| Diff whitespace | `git diff --check 4a60ca25312f0fa4a3074507e40b20be951651a7` | PASS — no output / exit 0 |
| Canonical backend lane | `JWT_SECRET_KEY=verify-read-only TEST_DATABASE_URL=postgresql+psycopg://usuario:password@localhost:5436/cataclub_test make pre-pr LANE=backend` | PASS — Ruff clean; import-linter `3 kept, 0 broken`; pip-audit `No known vulnerabilities found`; backend `2482 passed, 3 skipped, 328 warnings in 969.90s`; root `582 passed, 1 skipped in 25.73s` |

Skipped locally: CI job `migraciones-desde-cero` against its isolated empty PostgreSQL service, as reported by the canonical lane. No frontend lane applies to this backend-only PR 2 boundary.

## PR 2 behavior, boundary, and workload

- Credential core uses the supplied existing `Persona`, creates or updates exactly one `Usuario`, normalizes/rejects a foreign email, verifies the email, and has no token or `Persona` creation path.
- Capability core grants absent `REPRESENTANTE`, reuses the sole capability, explicitly replaces one legal role, rejects legacy multi-role state, and never grants `ALUMNO`.
- CodeGraph and zero-context production-diff review found no added `AdminCuentaServicio`, relationship-column assignment, `.commit()`, token emission, endpoint decorator, session epoch mutation, or revocation call. The added persistence is `Usuario`, role association, and `flush()` only.
- Implementation count is **637 additions + 1 deletion = 638 changed lines**: production `109 + 1` and two new test files `528 + 0`; this is within the 600–900 target and below the 1,000 hard stop. SDD bookkeeping is excluded.
- Boundary/rollback: revert the two core methods and two new tests against immediate parent PR 1; no migration, router, relationship, endpoint, or session behavior is included. Runtime is N/A because this slice has no endpoint/UI surface.

## Spec and design coverage

The PR 2 primitive boundary coheres with the design's existing-person credential and persisted `REPRESENTANTE` capability decisions. It deliberately does not claim PR 3 independence atomicity, relationship lifecycle, enrollment, player, contact, or remediation scenarios. The PR 2 tests cover the primitive obligations needed by the later adult-independence design: same `persona_id`, verified credential update/create, normalized-email conflict, rollback/commit ownership, role grant/reuse/replacement, legacy multi-role rejection, and no `ALUMNO`/relationship write.

## Strict TDD compliance

| Check | Result | Details |
|---|---|---|
| TDD Cycle Evidence table | PASS | Present in `apply-progress.md` with RED, GREEN, TRIANGULATE, and REFACTOR evidence for both PR 2 cores. |
| Test files and GREEN | PASS | `backend/tests/test_auth.py` and `backend/tests/test_roles.py` exist; current focused PostgreSQL execution is 20 passing cases. |
| Triangulation and safety net | PASS | Foreign normalized-email, rollback/commit, epoch, role replacement/reuse, catalog, and association identity cases are present; the declared six-file safety net passes 92 cases. |
| Assertion quality | PASS | No tautologies, ghost loops, type-only-only assertions, smoke-only tests, or CSS/implementation-detail assertions were found. Assertions call real service/ORM code and inspect durable behavior. |
| Test layers | PASS | 20 PostgreSQL service/ORM integration tests across 2 files; no UI/E2E layer is applicable to the core-only slice. |

Coverage was not separately run; it is informational and not required by the declared PR 2 validation contract.

## Task completion and archive status

`tasks.md:78-80` is complete for PR 2. The third PR 2 boundary/budget checkbox is now supported by the passing corrective gates and is marked complete. No other task checkbox is changed by this verification.

The following unchecked implementation/lifecycle scope remains and is a **CRITICAL archive blocker**, not a defect in this completed partial slice:

- [ ] Merge and required CI on #1165 (pending; not claimable from this document).
- [ ] Vertical cutover commits credentials, capability, link removal, audit, and session epochs in one transaction.
- [ ] Self-service independence path, tests, and guards are removed, not left dual-writable.
- [ ] Changed lines within 600–900 and ≤1,000 (hard stop).
- [ ] Shared validator owns self/cycle/age/phone/reachability invariants with database defense.
- [ ] Atomic reassignment with documented lock order, stale conflict, audit, epoch revocation, and post-commit notification.
- [ ] Non-disclosing safe stop replaces self-service linking.
- [ ] Account-first adult account with exactly one persisted `REPRESENTANTE`, legal consents, and verification outbox; empty capability state without membership/link.
- [ ] Session-derived child enrollment with idempotency, non-disclosing safe stop, and atomic conservation.
- [ ] #1138 prohibited write fields rejected before any mutation.
- [ ] Backend `ACTIVA` predicate across members/schedule/attendance; representative-as-player without `ALUMNO`.
- [ ] Empty representative dashboard from server capability; BFF rejects browser-selected subjects.
- [ ] Derived emergency-contact display; minor prohibited form inputs removed; legacy values never shown operationally.
- [ ] Remediation gate with conservation proof; no production execution in this change.
- [ ] Full cross-flow E2E across all seven slices' behaviors.
- [ ] #1135 remains explicitly work-free.
- [ ] Maintain the draft/no-merge tracker #1164; chain each child to its immediate predecessor with the dependency diagram marking the current PR `📍`; keep each child diff limited to its stated work unit.
- [ ] Preserve `proposal.md`, `design.md`, and all `specs/**/spec.md`; update only SDD evidence/status artifacts when implementation results require it. This replan (7 PRs; 600–900 target; 1,000 hard stop) supersedes the earlier 14-PR/400-line plan and the monolithic-slice size exception.
- [ ] Before each PR delivery, verify the exact focused command, runtime scenario, additions+deletions (600–900 target, 1,000 stop), rollback boundary, and skipped CI gates; run one applicable `make pre-pr LANE=backend|frontend|full` lane.
- [ ] After the chain completes, compare implementation against every Given/When/Then scenario and authorization invariant, then record verification evidence before archive.
- [ ] Keep #1135 explicitly superseded with no runtime, migration, relationship, or closure work; close #1132, #1133, #1134, #1138, and #1137 only against their stated completion conditions.
- [ ] Archive the completed OpenSpec change only after all child PRs, migration checks, QA/live scenarios, conservation evidence, and post-merge lifecycle gates pass; do not claim production remediation execution.

## Severe findings

No PR 2 severe implementation or validation finding remains. Archive remains blocked solely by the explicitly listed out-of-scope unchecked work and required PR 1 merge/CI lifecycle gate.

---

## Independent verification — PR3a inert independence-service core

### Result Contract

**PR3a verdict: PASS (inert core slice only).** The overall OpenSpec change remains **BLOCKED for archive**: all PR 3 implementation checkboxes intentionally remain unchecked pending PR3b and later chain/lifecycle work.

- Status/action context: `represented-person-account-flow`, native verify `ready`; `repo-local` worktree is the allowed root.
- Boundary: exactly the new relationship service, its new service-level test file, and PR3a apply-progress evidence changed from base `8c77c5f6eb8e958ba4cfb76cbb1bd9c075f7063b`.
- Inertness: no runtime importer exists outside the candidate test; no router, DTO, `PersonaServicio`, guard, or legacy-route file changed. The administrator router/DTO guard remains explicitly PR3b scope.
- Tests use local `_ComandoIndependencia` dataclass and contain no router/DTO/TestClient/client-fixture import.

### Exact validation

| Gate | Exact command | Result |
|---|---|---|
| Focused PostgreSQL | `cd backend && TEST_DATABASE_URL=postgresql+psycopg://usuario:password@localhost:5436/cataclub_test uv run pytest tests/test_independencia_representada.py -q` | PASS — `25 passed, 1 warning in 7.99s` |
| Legacy + guards | `cd backend && TEST_DATABASE_URL=… uv run pytest tests/test_independizar.py tests/test_bloqueo_del_event_loop.py tests/test_guardia_autorizacion_rutas.py -q` | PASS — `27 passed, 1 warning in 9.48s` |
| Combined | `cd backend && TEST_DATABASE_URL=… uv run pytest tests/test_independencia_representada.py tests/test_independizar.py tests/test_bloqueo_del_event_loop.py tests/test_guardia_autorizacion_rutas.py -q` | PASS — `52 passed, 1 warning in 16.74s` |
| Focused quality | `cd backend && uv run ruff check app/servicios_negocio/relacion_representacion_servicio.py tests/test_independencia_representada.py` | PASS — `All checks passed!` |
| Imports/whitespace/diff | AST import-boundary probe; `git diff --check 8c77c5f6…`; two `git diff --no-index --check /dev/null <new-file>` probes | PASS — clean; service imports without presentation/`PersonaServicio`/`AdminCuentaServicio` and tests without presentation/TestClient |
| Canonical lane | `JWT_SECRET_KEY=… TEST_DATABASE_URL=postgresql+psycopg://usuario:password@localhost:5436/cataclub_test make pre-pr LANE=backend` | PASS — Ruff; import-linter `3 kept, 0 broken`; pip-audit clean; backend `2507 passed, 3 skipped, 85 warnings in 961.55s`; root `582 passed, 1 skipped in 23.86s` |

Skipped locally: CI `migraciones-desde-cero` isolated-empty-PostgreSQL job, as the canonical lane reports. No endpoint/runtime scenario applies because this service is unreferenced.

### Strict TDD and assertion quality

`apply-progress.md` contains PR3a RED/GREEN/TRIANGULATE/REFACTOR evidence. The RED module-absence evidence, final 25-test file, and current GREEN execution were cross-checked. All 25 tests are PostgreSQL service/ORM integration tests; the direct-SQL minor trigger, locks, rollback, replay, audit, epochs, and post-commit notification cases provide triangulation. No tautology, ghost loop, type-only-only, smoke-only, CSS-detail, or client-fixture assertion was found.

### Inventory, workload, and rollback

- `backend/app/servicios_negocio/relacion_representacion_servicio.py` — NEW, 270 additions, SHA-256 `63c693dc40f4463fbe14c874675324b58955867349264356115e050492eb04c7`.
- `backend/tests/test_independencia_representada.py` — NEW, 627 additions, SHA-256 `4c23f7610ce41e82950d4b2ac63aaca54bc60b0af68e105888d32c2eecd286b2`.
- `openspec/changes/represented-person-account-flow/apply-progress.md` — modified, 37 additions; this report section is verification evidence only.
- Native candidate accounting after this section: **983 additions, 0 deletions**, within the PR 3 hard stop of 1,000 (service + tests + SDD evidence).
- PR 3 task state is unchanged: `Vertical cutover…`, `Self-service independence…`, and `Changed lines within 600–900 and ≤1,000…` remain unchecked. This is a CRITICAL archive blocker for the overall change, not a failure of this approved partial slice.
- Rollback: delete only the two NEW PR3a files against PR 2; no router, DTO, legacy route, migration, or production behavior is engaged.

### Severe findings

None for the authorized inert PR3a boundary. Do not archive or mark PR 3 tasks complete until PR3b completes the routed/guarded cutover and the remaining chain gates pass.

---

## Independent verification — PR3b vertical cutover (complete-PR3, second/final attempt)

### Result Contract

**PR3b / complete-PR3 verdict: PASS (focused required checks).** The overall OpenSpec change remains **BLOCKED for archive**: PR 4–7 and parent/lifecycle tasks remain unchecked, and `#1165` merge/CI is pending. This is the second/final attempt; the prior attempt **timed out** because canonical `make pre-pr LANE=backend` exceeds the ~10-minute agent budget (previous run ~961s). Per parent instruction, pre-pr was **not** rerun; full canonical CI gates remain pending and are claimable only after PR publication.

- Change/status: `represented-person-account-flow`; native verify `ready`; `repo-local` worktree is the authoritative allowed root.
- Boundary: exact native diff vs base `87518b2be111b664a6ac68c357d33b8d6ec1af04`; oracle `pi-1137-pr3` read-only; every touched file byte-identical to oracle (evidence SHAs in apply-progress).

### Exact validation

| Gate | Exact command | Result |
|---|---|---|
| 33-test independence matrix | `cd backend && TEST_DATABASE_URL=postgresql+psycopg://usuario:password@localhost:5436/cataclub_test uv run pytest tests/test_independencia_representada.py -q` | PASS — `33 passed, 1 warning in 9.47s` |
| Combined + two guards | `… uv run pytest tests/test_independencia_representada.py tests/test_guardia_autorizacion_rutas.py tests/test_bloqueo_del_event_loop.py -q` | PASS — `43 passed, 1 warning in 10.05s` |
| PR2/audit/link safety net | `… uv run pytest tests/test_auth.py tests/test_roles.py tests/test_rol_unico_por_cuenta.py tests/test_auth_registro_refresh.py tests/test_autenticacion_endpoints.py tests/test_admin_cuenta_servicio.py tests/test_vinculacion_representante.py tests/test_migracion_representante_auditoria.py tests/test_vincular_representado.py -q` | PASS — `127 passed, 3 warnings in 21.99s` |
| Touched-file Ruff | `cd backend && uv run ruff check app/presentacion/routers/personas_router.py app/servicios_negocio/dtos/persona_schemas.py app/servicios_negocio/persona_servicio.py tests/test_independencia_representada.py tests/test_guardia_autorizacion_rutas.py tests/test_bloqueo_del_event_loop.py` | PASS — `All checks passed!` |
| Whitespace | `git diff --check 87518b2` | PASS — clean, exit 0 |
| Canonical lane | `make pre-pr LANE=backend` | **SKIPPED** — prior attempt timed out at ~961s (>10-min budget); full CI pending after PR publication |

### Runtime proof (actual FastAPI TestClient)

`tests/test_independencia_representada.py` exercises the real runtime: `test_runtime_el_adulto_puede_loguearse_con_las_credenciales_establecidas` (admin independence → represented login/session, L623), `test_endpoint_admin_completa_sin_token_en_la_respuesta` (admin success, L673), `test_endpoint_exige_rol_administrador` (unauthorized 403 via `client_sin_permisos`, L658), `test_endpoint_menor_rechazado_y_vinculo_intacto` (minor rejection, L708), plus 404/400 idempotency negatives. Route introspection: `POST /personas/{persona_id}/independizar` → `response_model=IndependenciaResponseDTO`, deps = `GestorPermisos` roles `['ADMINISTRADOR']` only. `PersonaServicio.independizar` retired (`hasattr` → False); legacy `tests/test_independizar.py` deleted (415 lines).

### Budget, import/diff, and scope

- Native changed lines: **190 additions + 516 deletions = 706** (inside 600–900; ≤1,000 hard stop). SDD bookkeeping excluded.
- `AdminCuentaServicio` references in production/test diff: **0** (the single `grep -ci` hit is the apply-progress.md documentation row, not code).
- No PR4 scope: `RelacionRepresentacionServicio` exposes only `independizar_presencial` (+ private helpers); no shared validator, reassignment, or enrollment method added.
- PR3 tasks exactly `[x]` (3/3 checked); PR4–7 and parent-owned lines remain unchecked — correct out-of-scope archive blockers, not PR3b defects.

### Strict TDD compliance

| Check | Result | Details |
|---|---|---|
| TDD Cycle Evidence table | PASS | Present in apply-progress PR3b section (RED 4-fail → GREEN 33-pass → TRIANGULATE 129+127 → REFACTOR). |
| Test files + GREEN | PASS | 33-test file exists and currently passes (`33 passed, 9.47s`). |
| Assertion quality | PASS | 82 assertions, real value assertions on service/ORM/endpoint responses; `is True` checks assert real boolean fields. No tautologies, ghost loops, type-only-only, smoke-only, or CSS-detail assertions. |
| Layers | PASS | 33 PostgreSQL service/ORM + TestClient endpoint/runtime tests; frontend N/A for this backend-only slice. |

### QA guard confirmation (no rebuild)

Confirmed `make qa-up` is **invalid on this feature branch** without executing it: the target runs `git fetch origin main`, builds with `BUILD_SHA=$(git rev-parse HEAD)`, then `scripts/qa_verify_build_sha.py` compares the served SHA against `origin/main`. Feature HEAD `87518b2` is not on `origin/main`, so the guard fails. QA was **not** rebuilt; existing `cataclub-qa-*` containers (14h) were left untouched.

### Severe findings

None for the authorized PR3b boundary. Archive remains blocked solely by the explicitly out-of-scope unchecked PR4–7 + parent/lifecycle tasks and the pending `#1165` merge/CI gate. Full canonical CI is unproven locally and must be satisfied post-publication.

---

## Independent verification — PR4a0 test-only fixture compatibility

### Result contract

**PASS — PR4a0 only.** The candidate is limited to twelve test files plus SDD bookkeeping; it is not a completion claim for PR4 or the OpenSpec change. No production, migration, router, service, DTO, spec, design, proposal, task-checkbox, commit, push, or PR edit occurred during verification.

- Native status/action context: `represented-person-account-flow`, verify `ready`, `repo-local`; this worktree is the allowed root.
- Native `HEAD` is `d63e10d81a85992a49c3ce8b2d28722f906e2699` (PR3b predecessor `87518b2...`); changed inventory is exactly 12 `backend/tests/` files and `apply-progress.md`.
- Test-only authored diff is **+107/−28 = 135 lines**, below the 1,000 hard stop. `git diff --check` is clean.

### Scope and structural evidence

- `git diff --name-status` found exactly the twelve named modified test files and one SDD file; no other path is changed before this report.
- Python AST comparison confirms test/class definitions and every `assert` AST are unchanged in all 12 files. Zero-context diff finds no changed `assert`, `status_code`, or `json()` expectation.
- The only executable fixture change is seed order: a linked legacy person is inserted as a 2015 minor, then its birth date is updated to the original adult date. Where an adult-linked legacy state is required, final persisted values remain adult birth date, same `representante_id`, `activo=True`, and the original phone.
- CodeGraph review of the PR4 oracle trigger confirms its `BEFORE INSERT OR UPDATE OF representante_id` age guard short-circuits an age-only update; therefore the recipe represents an adult who aged in place rather than weakening any assertion or status expectation.

### Exact validation

| Gate | Command | Result |
|---|---|---|
| Native predecessor suite | `cd backend && AMBIENTE=test TEST_DATABASE_URL=postgresql+psycopg://usuario:password@localhost:5436/cataclub_test DATABASE_URL=postgresql+psycopg://usuario:password@localhost:5436/cataclub_test JWT_SECRET_KEY=verify-read-only uv run pytest tests/test_alertas_mora.py tests/test_alertas_vencimiento.py tests/test_baja_logica_persona.py tests/test_beneficio_autoservicio.py tests/test_independencia_representada.py tests/test_inventario_anomalias_membresias.py tests/test_membresia_repositorio.py tests/test_migracion_representados_alcanzables.py tests/test_notificaciones_marcar_todas.py tests/test_notificaciones_paginacion.py tests/test_representante_no_deja_menores_huerfanos.py tests/test_roles.py -q -p no:randomly` | PASS — 167 passed, 7 warnings, 32.47s |
| Trigger-installed corrected suite | Same command with `PYTHONPATH=/tmp -p pr4a0_trigger_plugin -p no:randomly` | PASS — 167 passed, 7 warnings, 32.98s; cleanup restored only `trg_persona_representante_alcanzable` |
| Trigger simulation | Rollback-bounded PostgreSQL probe importing the read-only PR4 oracle migration | PASS — old adult-link `INSERT` rejected with `CheckViolation`; corrected minor-link then age update persisted `(1990-01-01, same representative, True, 0991112222)`; triggers and row count restored |
| Changed-file lint | `cd backend && uv run ruff check tests/test_alertas_mora.py tests/test_alertas_vencimiento.py tests/test_baja_logica_persona.py tests/test_beneficio_autoservicio.py tests/test_independencia_representada.py tests/test_inventario_anomalias_membresias.py tests/test_membresia_repositorio.py tests/test_migracion_representados_alcanzables.py tests/test_notificaciones_marcar_todas.py tests/test_notificaciones_paginacion.py tests/test_representante_no_deja_menores_huerfanos.py tests/test_roles.py` | PASS — All checks passed |

A pre-existing `/tmp/pr4a0_state_probe.py` also proved the old rejection and corrected state, but exited 1 during redundant trigger restoration (`DuplicateObject`); its transaction rollback left the head trigger intact. The independent rollback-bounded probe above passed and is the authoritative simulation result. `make pre-pr LANE=backend` was not run: its earlier attempt was interrupted, and no interrupted lane is claimed.

### Strict TDD, specs, and workload

| Check | Result | Evidence |
|---|---|---|
| TDD evidence | PASS | `apply-progress.md` has PR4a0 RED/GREEN/TRIANGULATE/REFACTOR evidence. |
| GREEN cross-check | PASS | All 12 reported PostgreSQL/TestClient fixture files exist and pass both native and trigger-installed runs (167 cases). |
| Assertion quality | PASS | No test/assertion/status expectation changed; therefore no new tautology, ghost loop, type-only, smoke-only, or implementation-detail assertion was introduced. |
| Layer coverage | PASS | 12 PostgreSQL integration/TestClient files; no frontend/E2E surface belongs to this fixture-only slice. |
| Spec/design coherence | PASS, bounded | Supports `representation-lifecycle`'s adult-aged-in-place scenario only; PR4 validation/reassignment/safe-stop requirements remain unimplemented and unclaimed. |
| Review boundary | PASS | Test fixtures + SDD only; 135 lines, below 1,000; rollback is reverting the 12 test files and this evidence only. |

Coverage was not run because this diff introduces no production branch or assertion; full backend lane and remote CI remain unproven.

### Task completion and archive blockers

The 19 unchecked implementation/lifecycle lines remain **CRITICAL archive blockers**; this approved preparatory slice leaves them untouched:

```text
- [ ] Merge and required CI on #1165 (pending; not claimable from this document).
- [ ] Shared validator owns self/cycle/age/phone/reachability invariants with database defense.
- [ ] Atomic reassignment with documented lock order, stale conflict, audit, epoch revocation, and post-commit notification.
- [ ] Non-disclosing safe stop replaces self-service linking.
- [ ] Account-first adult account with exactly one persisted `REPRESENTANTE`, legal consents, and verification outbox; empty capability state without membership/link.
- [ ] Session-derived child enrollment with idempotency, non-disclosing safe stop, and atomic conservation.
- [ ] #1138 prohibited write fields rejected before any mutation.
- [ ] Backend `ACTIVA` predicate across members/schedule/attendance; representative-as-player without `ALUMNO`.
- [ ] Empty representative dashboard from server capability; BFF rejects browser-selected subjects.
- [ ] Derived emergency-contact display; minor prohibited form inputs removed; legacy values never shown operationally.
- [ ] Remediation gate with conservation proof; no production execution in this change.
- [ ] Full cross-flow E2E across all seven slices' behaviors.
- [ ] #1135 remains explicitly work-free.
- [ ] Maintain the draft/no-merge tracker #1164; chain each child to its immediate predecessor with the dependency diagram marking the current PR `📍`; keep each child diff limited to its stated work unit.
- [ ] Preserve `proposal.md`, `design.md`, and all `specs/**/spec.md`; update only SDD evidence/status artifacts when implementation results require it. This replan (7 PRs; 600–900 target; 1,000 hard stop) supersedes the earlier 14-PR/400-line plan and the monolithic-slice size exception.
- [ ] Before each PR delivery, verify the exact focused command, runtime scenario, additions+deletions (600–900 target, 1,000 stop), rollback boundary, and skipped CI gates; run one applicable `make pre-pr LANE=backend|frontend|full` lane.
- [ ] After the chain completes, compare implementation against every Given/When/Then scenario and authorization invariant, then record verification evidence before archive.
- [ ] Keep #1135 explicitly superseded with no runtime, migration, relationship, or closure work; close #1132, #1133, #1134, #1138, and #1137 only against their stated completion conditions.
- [ ] Archive the completed OpenSpec change only after all child PRs, migration checks, QA/live scenarios, conservation evidence, and post-merge lifecycle gates pass; do not claim production remediation execution.
```

**Rollback:** discard only the 12 fixture edits and this SDD evidence against `d63e10d`; no runtime or schema rollback exists. **Next:** parent delivery/review for the approved PR4a0 boundary; archive remains blocked.
## Independent verification — PR4a1
**PASS — bounded database-defense slice only; native `ready`/`repo-local` scope is the migration, two new PostgreSQL tests, and 63-line apply evidence from `32358b7`; archive remains BLOCKED by the exact 19 unchecked lines above.**
- DB: no competing pytest/Alembic process; sole `5436` listener was `pi-1137-pr4a-db-test-1` (`pi-1137-pr4a`/`db-test`).
- Focused: `cd backend && export AMBIENTE=test TEST_DATABASE_URL='postgresql+psycopg://usuario:password@localhost:5436/cataclub_test' DATABASE_URL='postgresql+psycopg://usuario:password@localhost:5436/cataclub_test' JWT_SECRET_KEY='verify-pr4a1-4ed413b9e71fc4ea6d6b71b5e9e103aa' && uv run pytest tests/test_representacion_triggers.py tests/test_representados_alcanzables.py tests/test_migracion_representados_alcanzables.py -q -p no:randomly` => **35 passed, 1 warning**; an earlier concurrent verifier invocation failed during schema reset (`alembic_version` absent), then exclusive rerun passed.
- Alembic: `uv run alembic heads` and `current` => sole `i1141relinteg (head)`; the 35 include actual `head → h1140rep_auditoria → head` downgrade/upgrade proof.
- Adjacent/root/quality: inherited PR4a0 fixture suite => **167 passed, 4 warnings**; `make test-root` => **582 passed, 1 skipped**; changed-file Ruff and whitespace passed.
- Strict TDD: PR4a table exists; both new integration files execute GREEN; direct SQL covers INSERT/UPDATE adult links, self/cycles, age/phone/reachability, mutex, and assertion audit found no CRITICAL issue (one redundant local-constant truthiness assertion is non-blocking).
- Workload/scope: exact inventory is migration + two tests + apply-progress; **+992/−0 = 992**, over the 900 target but within the 1,000 hard stop (8-line report headroom consumed); no service/router/DTO/spec/design/task edit; candidate evidence hash is recorded at settle.

---

## Independent verification — PR4b inert shared validator

**Result: candidate PASS; overall change/archive BLOCKED.** Native status is `ready`, action context is `repo-local`, and the declared base is confirmed as `bb7999246cfad140908725aec279f42338b207af`. No implementation, test, task, apply-progress, commit, push, PR, or native token was changed by verification.

- **Scope/budget:** exact candidate is `+499/-4 = 503` changed lines: domain `+44/-4`, service `+85/-0`, new focused test `+284`, apply evidence `+86`. This is below the 600 candidate cap and the 1,000 hard stop. Only the expected three implementation/test paths plus apply evidence changed from the base; this report is verification evidence.
- **Invariant order:** `validar_enlace` executes no-change → self → represented-person age → destination active → destination adult → account reachability → canonical phone → cycle. The order test exercises the first three conflicts; individual PostgreSQL service cases cover inactive/minor/inactive-account/invalid-phone/cycle rejections.
- **`i1141relinteg` parity:** the live database was at `i1141relinteg` with both relationship and phone triggers. The helper delegates to `es_telefono_valido`, whose ASCII/local-phone behavior matches `^(09[0-9]{8}|0[0-9]{8})$`; both valid branches (`0991234567`, `022345678`), invalid values, and a nested direct-SQL cycle rejection were exercised. The validator is the service error path; the committed trigger remains the bypass defense.
- **Inertness/transactions:** no caller of `validar_enlace` exists outside its defining service and the new test. The pre-existing router import calls only `independizar_presencial`; no router, DTO, `persona_servicio`, or cutover hunk changed. AST inspection found no `add`, `delete`, `flush`, `commit`, `rollback`, or `actualizar` call in `validar_enlace`.

| Validation | Exact command | Result |
|---|---|---|
| Focused real PostgreSQL | `cd backend && export AMBIENTE=test TEST_DATABASE_URL='postgresql+psycopg://usuario:password@localhost:5436/cataclub_test' DATABASE_URL='postgresql+psycopg://usuario:password@localhost:5436/cataclub_test' JWT_SECRET_KEY='verify-pr4b-independent' && uv run pytest tests/test_relacion_representacion_servicio.py -q -p no:randomly` | PASS — 17 passed, 1 warning in 2.49s |
| Adjacent real PostgreSQL | `cd backend && export AMBIENTE=test TEST_DATABASE_URL='postgresql+psycopg://usuario:password@localhost:5436/cataclub_test' DATABASE_URL='postgresql+psycopg://usuario:password@localhost:5436/cataclub_test' JWT_SECRET_KEY='verify-pr4b-independent' && uv run pytest tests/test_relacion_representacion_servicio.py tests/test_representacion_triggers.py tests/test_representados_alcanzables.py tests/test_migracion_representados_alcanzables.py tests/test_representante_no_deja_menores_huerfanos.py tests/test_vinculacion_representante.py tests/test_migracion_representante_auditoria.py tests/test_independencia_representada.py tests/test_vincular_representado.py tests/test_personas.py -q -p no:randomly` | PASS — 179 passed, 18 warnings in 47.71s |
| Changed-file quality | `cd backend && uv run ruff check app/dominio/representados_alcanzables.py app/servicios_negocio/relacion_representacion_servicio.py tests/test_relacion_representacion_servicio.py` | PASS — All checks passed |
| Whitespace | `git diff --check bb7999246cfad140908725aec279f42338b207af` | PASS — clean |

DB tenancy was exclusive: the one healthy `pi-1137-pr4a-db-test-1` listener on port 5436 had zero external `cataclub_test` connections before and after; no pytest/Alembic process remained. `make pre-pr` and QA runtime were intentionally not run (candidate is inert and the user prohibited the long lane). The only warnings were existing FastAPI/TestClient and test JWT-length deprecations.

### Strict TDD and assertion quality

`apply-progress.md` has the required PR4b RED/GREEN/TRIANGULATE/REFACTOR table. The reported new file exists and current GREEN is confirmed by the focused real-PostgreSQL run. It contains five durable assertions and two `pytest.raises` behavioral checks, no loops, no tautologies, type-only-only checks, smoke-only checks, or CSS assertions. The direct-SQL savepoint cycle test confirms the database defense remains GREEN.

### Evidence hash for settle

- `backend/app/dominio/representados_alcanzables.py`: `sha256:c66d08b280f5bd876e8e4c7ca8bcfb57bc8437f017987f036042858cc5a11a5f`
- `backend/app/servicios_negocio/relacion_representacion_servicio.py`: `sha256:b8f5fc254911c46437f4fb68bce9550f5fb215fe918a7b3f6d9374fa4274b354`
- `backend/tests/test_relacion_representacion_servicio.py`: `sha256:daced554c988c691a26000e039b7989867eb0a764867ad59379d658b56f03604`
- Canonical sorted `path + space + SHA-256 + LF` manifest: **`sha256:1aa6cdf6035e7810a723cf0f45279300b5631e73f7792c728cc1beb93b49fa57`**.

### Critical completeness blockers

The candidate is an approved partial PR4b boundary, not a completion of the OpenSpec change. These exact unchecked implementation/lifecycle lines remain archive blockers:

```text
- [ ] Merge and required CI on #1165 (pending; not claimable from this document).
- [ ] Shared validator owns self/cycle/age/phone/reachability invariants with database defense.
- [ ] Atomic reassignment with documented lock order, stale conflict, audit, epoch revocation, and post-commit notification.
- [ ] Non-disclosing safe stop replaces self-service linking.
- [ ] Account-first adult account with exactly one persisted `REPRESENTANTE`, legal consents, and verification outbox; empty capability state without membership/link.
- [ ] Session-derived child enrollment with idempotency, non-disclosing safe stop, and atomic conservation.
- [ ] #1138 prohibited write fields rejected before any mutation.
- [ ] Backend `ACTIVA` predicate across members/schedule/attendance; representative-as-player without `ALUMNO`.
- [ ] Empty representative dashboard from server capability; BFF rejects browser-selected subjects.
- [ ] Derived emergency-contact display; minor prohibited form inputs removed; legacy values never shown operationally.
- [ ] Remediation gate with conservation proof; no production execution in this change.
- [ ] Full cross-flow E2E across all seven slices' behaviors.
- [ ] #1135 remains explicitly work-free.
- [ ] Maintain the draft/no-merge tracker #1164; chain each child to its immediate predecessor with the dependency diagram marking the current PR `📍`; keep each child diff limited to its stated work unit.
- [ ] Preserve `proposal.md`, `design.md`, and all `specs/**/spec.md`; update only SDD evidence/status artifacts when implementation results require it. This replan (7 PRs; 600–900 target; 1,000 hard stop) supersedes the earlier 14-PR/400-line plan and the monolithic-slice size exception.
- [ ] Before each PR delivery, verify the exact focused command, runtime scenario, additions+deletions (600–900 target, 1,000 stop), rollback boundary, and skipped CI gates; run one applicable `make pre-pr LANE=backend|frontend|full` lane.
- [ ] After the chain completes, compare implementation against every Given/When/Then scenario and authorization invariant, then record verification evidence before archive.
- [ ] Keep #1135 explicitly superseded with no runtime, migration, relationship, or closure work; close #1132, #1133, #1134, #1138, and #1137 only against their stated completion conditions.
- [ ] Archive the completed OpenSpec change only after all child PRs, migration checks, QA/live scenarios, conservation evidence, and post-merge lifecycle gates pass; do not claim production remediation execution.
```

---

## Independent verification — PR4c1 atomic reassignment

**Slice verdict: PASS. Change/archive status: BLOCKED.** Native status is `ready`; action context is `repo-local` and this worktree is the allowed root. No implementation, tests, tasks, or apply-progress artifact was modified during verification.

- **OpenSpec coverage:** the admin-only route derives the actor from the token, requires `ADMINISTRADOR`, requires an idempotency key, delegates to PR4b `validar_enlace`, locks target/old/new people and relevant users in ascending ID order, rejects stale observed state, records `REASIGNACION`/`ADMIN_PRESENCIAL` audit evidence and a SHA-256 fingerprint, increments only the former representative epoch, and notifies only after the main commit. Notification failure rolls back its separate transaction and preserves the committed reassignment. No safe-stop or legacy self-service linking removal is claimed; those remain PR4c2 scope.
- **Exact validation (exclusive PostgreSQL):** port 5436 had only healthy `pi-1137-pr4a-db-test-1`; no other pytest/Alembic process ran. Focused suite: `cd backend && AMBIENTE=test TEST_DATABASE_URL=postgresql+psycopg://usuario:password@localhost:5436/cataclub_test DATABASE_URL=postgresql+psycopg://usuario:password@localhost:5436/cataclub_test JWT_SECRET_KEY=verify-pr4c1-independent uv run pytest tests/test_reasignacion_representacion.py tests/test_notificaciones_relacion.py tests/test_guardia_autorizacion_rutas.py tests/test_personas.py -q -p no:randomly` → **71 passed, 13 warnings**. The 13-suite relationship safety net → **200 passed, 18 warnings**. `make test-root` → **582 passed, 1 skipped**. Changed-file Ruff and `git diff --check` passed. No long `make pre-pr` lane was run, per the bounded-verification request.
- **Strict TDD:** the PR4c1 `TDD Cycle Evidence` table exists; the two named new PostgreSQL integration/TestClient files exist and are GREEN in the focused execution. Assertion audit found no tautologies, ghost loops, type-only-only, smoke-only, or CSS-detail assertions. Test layer: 26 PostgreSQL service/ORM/TestClient integration tests across 2 new files; no browser E2E surface belongs to this backend slice.
- **Review workload:** exact production/test diff is **272 additions + 7 deletions + 580 new-test additions = 859 changed lines**, below the requested `<950` bound. SDD evidence is excluded under the forecast convention. Rollback is the six tracked code/test hunks plus the two new test files; no migration/model/frontend change exists.
- **Evidence hash:** canonical sorted `path + space + sha256 + LF` manifest of the eight implementation/test files is `sha256:539b7951ef02c8d1508a74812b63ce5fc67a8fd4ed1610e8b6019efc1317d4a3`.

The exact 19 unchecked implementation/lifecycle lines immediately above remain CRITICAL archive blockers, including the three PR4 lines. This partial slice is not ready for archive.
