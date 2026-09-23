# Remove chatbot everywhere

## Objective
Remove the chatbot capability and its active product, API, deployment, test, and documentation integrations while preserving the standalone Help/FAQ experience. The owner explicitly chose to retain three tracked environment-example templates; this is not a claim that every textual reference is gone.

## Problem
The chatbot is mounted across public and authenticated frontend surfaces, exposed through a frontend BFF and backend API, and coupled to deployment checks, environment configuration, dependencies, tests, and documentation. Removing only the visible widget would leave dead and misleading infrastructure behind.

## Why
The owner explicitly requested that the chatbot be removed from the application everywhere.

## Scope
- Remove all chatbot UI launchers, dock/widget components, client APIs, BFF route, contracts, and chatbot-specific tests.
- Keep `/ayuda` and its static FAQ/knowledge content, but remove its assistant trigger.
- Remove the backend chatbot endpoint, service, schemas, diagnostics, verification script, provider dependency, and dedicated tests.
- Remove chatbot-only Compose, deployment, Makefile, resilience, release-control, contract, and documentation references, excluding the three owner-retained environment-example templates.
- Preserve unrelated landing-page work and the static knowledge synchronization needed by Help/FAQ.

## Constraints
- Work only in dedicated worktrees and branches.
- Preserve the unrelated untracked `odd/tasks/1362-catalogo-vacio-instalacion-nueva.md` in the main checkout.
- Use one writer at a time.
- Backend tests require the single-tenant `db-test` service on port 5436.
- Run the smallest focused checks first and `make pre-pr LANE=full` before each cross-cutting PR delivery.
- Do not deploy or modify production configuration.
- Technical artifacts remain in English; existing Spanish UI copy remains Spanish where retained.

## Delivery strategy
- Strategy: `auto-chain`.
- Chain strategy: `stacked-to-main` (owner selected 2026-09-21).
- Each PR targets `main` and must remain independently functional.
- The first combined frontend candidate `ea77878` contained 30 files and 5,563 changed lines. Native review stopped before creating authority with `lens_context_budget_exceeded`.
- Revised honest slices: frontend entrypoints; dead UI implementation/tests; frontend BFF/client contract; backend capability; operational/configuration/documentation cleanup.
- Large single-file deletions may still require a documented `size:exception`; do not compress or omit required removal.

## TDD and routing
- TDD mode: disabled; no repository/session instruction enables strict RED/GREEN/REFACTOR for this organic change.
- Test runner: repository Makefile commands and existing Vitest/Pytest suites.
- Every implementation task uses `gentle-ai-worker` because it touches multiple non-trivial files.
- RDD is clone-locally disabled with owner authorization; work uses ordinary repository validation and reports `disabled/unmanaged` without claiming review approval.

## Tasks

### RC-1A — Remove frontend chatbot entrypoints (`done`)
Route: delegated writer; triggers: preparation across 4+ files and multi-file write.

- [x] Remove root, shell, auth, landing, enrollment, unauthorized, and Help-page chatbot mounts/triggers while keeping `/ayuda` and static FAQ content.
- [x] Remove or update only E2E/unit expectations tied to visible launcher/dialog behavior.
- [x] Keep the dead implementation, BFF route, and client contract temporarily so this independently functional slice stays small.
- [x] Run focused frontend tests and the canonical full pre-PR lane.
- [x] Commit one coherent Conventional Commit work unit.
- [x] Record native outcome, changed-line count, rollback boundary, and PR slice.

Implementation applied from the superseded combined candidate `ea77878`'s
diff, restricted to the entrypoint slice; every edited file byte-matches the
reference candidate's version of that file. Commit:
`refactor(frontend): remove chatbot entrypoints` (this commit).

Acceptance:
- No user-visible launcher, widget, dock, assistant CTA, or automatic chatbot mount remains.
- `/ayuda` continues to serve static Help/FAQ content.
- Frontend checks pass.

### RC-1B — Delete dead chatbot UI implementation and tests (`done`)
Route: delegated writer; triggers: preparation across 4+ files and multi-file write.

- [x] Delete dead chatbot components, store/helpers, and their unit tests.
- [x] Remove dead touch-target/AppShell test coupling.
- [x] Validate and commit in reviewable candidates; preserve any required size-exception evidence.

Deleted the entire `frontend/src/components/chatbot/` directory (six
implementation files, four unit-test suites) and the dead `HelpChatDock`
roster entry in `touch-target-usage.test.ts`; every deleted file
byte-matches the superseded reference candidate `ea77878`. Commit:
`refactor(frontend): delete dead chatbot UI` (this commit).

Acceptance:
- No active code imports `@/components/chatbot` or `components/chatbot`;
  remaining mentions are deferred to RC-1C (BFF route, contract, service
  methods) and RC-3 (config/docs comments).
- `/ayuda` and all RC-1A behavior are untouched; the BFF route and client
  contract remain so RC-1B stays independently functional.
- Frontend and full pre-PR lanes pass.

### RC-1C — Remove frontend chatbot BFF and client contract (`done`)
Route: delegated writer; triggers: preparation across 4+ files and multi-file write.

- [x] Delete the chatbot BFF route, chatbot contract, service API methods/types, and dedicated tests.
- [x] Update root BFF contract assertions without weakening unrelated route coverage.
- [x] Validate and commit.

Deleted `frontend/src/app/api/chatbot/` (`route.ts` + its suite),
`lib/chatbot-contract.ts` + its suite, the `consultarChatbot`/`ChatbotTurno`/
`ChatbotRespuesta` block and `CHATBOT_TIMEOUT_MS` from `services/api.ts`, and
the chatbot timeout test + import + live-tense references from
`services/__tests__/api.test.ts`. Root gate: dropped the
`/chatbot/consultar` `Campo` row and lowered the `bff:url-cruda` floor 3→2
(the deleted route was the third hand-built raw-URL call site); no unrelated
route coverage weakened. The two `ranking/notificaciones` raw-URL sites and
all other surfaces keep their coverage. `docs/operations/bff-contract.md`
updated for the same two facts. Deleted files and `tests/test_bff_contract.py`
byte-match the superseded reference candidate `ea77878`; `api.ts`/`api.test.ts`
match it byte-for-byte in every chatbot-adjacent region (remaining differences
are pre-existing drift from other merged features). Commit:
`refactor(frontend): remove chatbot BFF and client contract` (this commit).

Acceptance:
- No frontend chatbot BFF route, contract, client method, or type remains; a
  bounded scan finds zero references to `consultarChatbot`,
  `chatbot-contract`, `api/chatbot`, or `isBackendChatbotResponse`.
- Remaining `chatbot` mentions are past-tense comments and Help/FAQ content,
  deferred to RC-3 (config/docs/comment sweep).
- `/ayuda` and all RC-1A/1B behavior are untouched.
- Frontend and full pre-PR lanes pass.

### RC-2 — Remove backend chatbot capability (`done`)
Route: delegated writer; triggers: preparation across 4+ files and multi-file write.

- [x] Remove chatbot router registration, router, schemas, service, diagnostics, verification script, and chatbot-only tests.
- [x] Remove provider-specific settings, circuit-breaker constants/state, public-route allowances, and the unused OpenAI dependency/lock entries.
- [x] Preserve the static club-knowledge source used by Help/FAQ and remove only prompt/chatbot-specific generation.
- [x] Run focused backend/root tests and the canonical full pre-PR lane.
- [x] Commit and record native review evidence.

Deleted the chatbot router, schemas, service, diagnostics module,
`verificar_chatbot.py`, and their three dedicated suites (8 files, 2,352
lines). Removed the `/chatbot/consultar` registration from `backend/main.py`
(the FastAPI entrypoint is `backend/main.py`, not `backend/app/main.py` as
first delegated; the orchestrator corrected the surface), the four
OpenCode/chatbot settings fields + `chatbot_modelos` property + their
production-exclusion rationale entries, both `CIRCUITO_CHATBOT_*`
constants, the chatbot entry from the public-route guard, the chatbot
circuit/client reset from `conftest.py`, the chatbot blocking-primitive and
wrapped-call-site entries from the event-loop lock (floors re-measured 5→4
primitives, 11→10 wrapped sites), and the `openai` dependency
(`uv remove openai`; −101 lock lines incl. transitive deps).
Knowledge preserved per owner decision: `conocimiento_club.json` is
byte-identical (the sync script rewrote it and both frontend mirrors with
zero diff); `prompt_sistema.txt` was regenerated to knowledge-only bytes
(7,619 → 5,312 chars, assistant-persona instructions dropped) and
`sincronizar_conocimiento.py` now derives it from
texto_para_prompt(CONOCIMIENTO); the /ayuda and landing divergence guards
and the root glossary gate keep consuming those bytes unchanged. Removed
the chatbot-only knowledge helpers (`respuestas_por_pregunta`,
`respuesta_de_contacto`) and reworked `test_conocimiento_club.py` (snapshot
now locked to the knowledge serialization; model-token-budget class and
local-fallback class retired). `tests/test_bff_contract.py`: replaced the
hand-built-URL parser example that cited the deleted `/chatbot/consultar`
route with the surviving `/notificaciones` raw URL and dropped `chatbot`
from the two DTO-package listing comments; the past-tense
`bff:url-cruda` floor note stays. Commit:
`refactor(backend): remove chatbot capability` (this commit).

### RC-3A — Accessible operational and documentation residue (`done`)
RC-3A covers the active operational and documentation surfaces. The owner later chose to close the scoped removal without editing the three `.env` example templates; their retained content is an explicit exception, not completed cleanup.
Route: delegated writer; triggers: preparation across 4+ files and multi-file write.

- [x] Remove chatbot Compose variables, deploy health checks, Make targets, and release-control assertions (`.env` templates excluded — RC-3B).
- [x] Remove or rewrite chatbot references in operational and contract documentation without deleting valid Help/FAQ documentation.
- [x] Sweep frontend comment-only chatbot/`ChatWidget`/deleted-file references in-surface while preserving `/ayuda` and intentional history.
- [x] Search the final repository for remaining chatbot/provider references and classify any intentional historical references.
- [x] Run focused root tests and the canonical full pre-PR lane.
- [x] Commit and record native review evidence.

### Retained environment examples — explicitly out of scope
The owner chose not to remove the chatbot-related placeholders from `backend/.env.example`, root `.env.example`, or root `.env.production.example`. These files remain untouched and are not represented as cleaned. The harness safety policy blocks reading `.env*` paths; no bypass or claim about their exact current contents is made. The prior RC-3 mapping found no test or script cross-references to the root templates. Any future cleanup requires a new owner decision and a policy-permitted editing method.

## Progress
- 2026-09-22: RC-3A implemented in this worktree per the owner's partial-RC-3 decision (29 files: 28 code/config/docs + this task document; +81/−371). Deleted: compose `&backend_env` chatbot block, `qa-chatbot-check` Make target, `check_chatbot_config` + its `do_checks` call + the `CHATBOT_REQUERIDO` machinery in `deploy.sh`, the `*verificar_chatbot.py*` docker-stub case and the six-issue-#766 chatbot deploy tests in `test_release_controls.py`, the four `OPENCODE_*`/`CHATBOT_*` entries in `test_docker_compose_config.py`'s critical-variables dict (their sentinel cases vanish with the parametrization), the whole chatbot section of `provisioning.md` (generic staging caveat preserved under its own `## Límite conocido: staging` heading). Rewritten: `diagnostico_horarios.py` static-surface reader ("la instantánea de conocimiento"; test retuned), the SMTP-comment cross-reference and the secret-literal docstring in `test_docker_compose_config.py`, the `post-checks.sh`/`rollback-release.sh` comment analogies, `diagnostico-horarios.md` (chatbot reader dropped, regression-detector rationale kept), `glossary-contract.md` (`entradas_sha256` recompute corrected to Python-only reality; gate assertions on hashes/terms untouched), and 16 frontend comment-only sites (`tailwind.config.ts`, `globals.css`, `components/README.md`, `ToastContainer`, `LoadingState`, `ayuda/page.tsx`, `faq-content.test.ts`, `useVisualViewport.ts`, `LegalReviewDialog.tsx`, `useNativeDialog.ts`, `MembersPage.test.tsx`, `usted-register.test.ts`, `error-message.test.ts` 429 PRODUCERS row keeps only the live password-recovery producer, `error-message-usage`, `color-contrast`, `field-font-size-usage`). All three `.env` example templates untouched (RC-3B). The idle sibling `gentleman-1372-db-test-1` fixture on port 5436 was verified idle (0 client sessions) and stopped under the single-tenant rule before this slice's runs. Final classification: intentional history kept — `api.ts:240`/`api.test.ts:317` (#708 past tense), `conocimiento_club.py` docstring/snapshot history, `sincronizar_conocimiento.py:24`, `test_bloqueo_del_event_loop.py` (#834 narrative), `test_conocimiento_club.py:5,15`, `test_bff_contract.py:89`, and the new past-tense line in `diagnostico-horarios.md`; out-of-surface follow-ups NOT edited — `verificar_entrega_pdf.py:35,46` + `test_verificar_entrega_pdf.py:22` (deleted-file analogy comments) and `landing-config-no-schedule-list.test.ts:13` (cites the retired backend test name `test_el_modulo_del_chatbot_ya_no_guarda_una_copia_del_conocimiento`, confirmed gone). No missing in-scope surfaces found; the only pending surfaces are RC-3B's three `.env` templates.
- 2026-09-22: RC-3 mapping completed in `refactor/remove-chatbot-ops`; NO source written yet; two surface blockers escalated to the orchestrator before the first write: (1) `backend/.env.example` (tracked) still carries the live chatbot env block (lines 62-66: `OPENCODE_API_KEY=` + comments citing the RC-2-deleted `verificar_chatbot.py` and the provisioning section RC-3 deletes) — required by the RC-3 bullet "Remove chatbot environment examples" but NOT in the delegated surface; (2) root `.env.example` (chatbot block lines 73-95) and `.env.production.example` (lines 79-94) ARE in the surface but the harness safety policy blocks reading any `.env*` path, so exact edit anchors cannot be constructed safely (no test or script cross-references either file, so the cleanup is inert to validation). Complete in-surface plan ready to execute: compose `&backend_env` chatbot block (lines 129-139); `Makefile` `qa-chatbot-check` (372-379, no other caller); `deploy.sh` `check_chatbot_config` function + `do_checks` call (184, 225-268); `post-checks.sh:199` comment analogy; `rollback-release.sh:78` comment mention; `diagnostico_horarios.py` `_SUPERFICIES_ESTATICAS[0]` (162-164, rewrite to "la instantánea de conocimiento") + `test_diagnostico_horarios.py:518` assertion; `test_docker_compose_config.py` four chatbot dict entries + comments (188-219), SMTP-comment cross-reference to `OPENCODE_API_KEY`, secret-name docstring citation (372); `test_release_controls.py` docker-stub `*verificar_chatbot.py*` case (534-538) + six chatbot deploy tests with banner (2002-2101); `docs/operations/provisioning.md` whole chatbot section (467-572; staging-runbook gate only needs the untouched line-105 SSH heading; the section's final generic "Límite conocido: staging" caveat is valid non-chatbot docs — preserve by relocating under a small standalone heading); `docs/operations/diagnostico-horarios.md` static-surface text (114-121, drop the chatbot reader, keep the regression-detector rationale); `docs/operations/glossary-contract.md:31` Node-side recompute reference points to the RC-1C-deleted `chatbot-contract.test.ts` (today only Python `test_glossary_contract.py` recomputes `entradas_sha256`; frontend consumes byte-mirrors) — correct the doc to current reality; frontend comment-only sweep in-surface: `tailwind.config.ts:16` + `globals.css:285` (`chat-focus-ring.ts` origin), `components/README.md:20` (`chatbot/` table row), `ToastContainer.tsx:42`, `LoadingState.tsx:7`, `ayuda/page.tsx:39`, `faq-content.test.ts:5-9`, `useVisualViewport.ts` (31-33, 51, 111-122 `ChatWidget` provenance), `LegalReviewDialog.tsx:142`, `useNativeDialog.ts` (29, 31, 51, 111, 121-122), `MembersPage.test.tsx` (3786-3789, 3904-3906, 3935), `usted-register.test.ts:8`, `error-message.test.ts:361` (429 PRODUCERS row keeps the live password-recovery producer, drops the dead `chatbot_servicio.py:162` path), `error-message-usage.test.ts:44`, `color-contrast.test.ts:439`, `field-font-size-usage.test.ts:8`. Out-of-surface residues to classify, not edit: `backend/app/servicios_negocio/conocimiento_club.py` docstring history (intentional), `backend/scripts/sincronizar_conocimiento.py:24` provenance (intentional), `backend/tests/test_bloqueo_del_event_loop.py` #834 narrative (intentional), `backend/tests/test_conocimiento_club.py:5,15` provenance (intentional), `backend/scripts/verificar_entrega_pdf.py:35,46` + `backend/tests/test_verificar_entrega_pdf.py:22` deleted-file analogy comments (follow-up), `frontend/src/services/api.ts:240` + `services/__tests__/api.test.ts:317` past-tense #708 comments (intentional history), `frontend/src/app/landing/__tests__/landing-config-no-schedule-list.test.ts:13` cites a backend test name that no longer exists (stale follow-up), `.claude/skills/impeccable/scripts/pin.mjs` tooling (out of scope). `docs/operations/bff-contract.md` verified clean (0 chatbot mentions).
- 2026-09-22: RC-2 implemented in this worktree (25 files: 8 deleted, 17 edited; +97/−2,802). The prior attempt's `db-test` fixture (`gentleman-remove-chatbot-bff-db-test-1`, port 5436) was found idle (0 active client sessions, only `cataclub_test`) and stopped under the single-tenant rule before this slice's backend runs; nothing else outside this worktree was touched. Focused tests: `test_conocimiento_club.py + test_configuracion.py + test_main.py` 140 passed; `test_bloqueo_del_event_loop.py + test_guardia_autorizacion_rutas.py + test_vocabulario_en_mensajes_de_usuario.py + test_circuito_breaker.py` 62 passed; root `test_bff_contract.py` 139 passed / 1 skipped; `sincronizar_conocimiento.py --verificar` synchronized; `lint-imports` 3 kept / 0 broken. `make pre-pr LANE=full` completed the backend lane (ruff clean, pip-audit, backend suite via db-test, root tests 636 passed / 1 skipped) and aborted only at the frontend entry guard: missing `node_modules` (environmental, this worktree had never run `pnpm install`). Classified transient/environmental, installed deps with the documented prerequisite `pnpm install --frozen-lockfile`, and reran only `make pre-pr LANE=frontend`: audit, type-check, lint, coverage, Next build, Playwright 202 passed (3.5m). Root-test total 638 → 636 vs RC-1C is explained by main moving between measurements (#1387 merged), not by this slice: RC-2 removes zero root tests. Local lane did not reproduce CI's `migraciones-desde-cero` and `docker-images` jobs.
- 2026-09-22: RC-2 mapping completed in `refactor/remove-chatbot-backend` @ `28715b3`; no source written yet. Reference candidate `ea77878` contains NO backend slice (its own message defers backend to later slices), so RC-2 is original implementation. Two surface issues block the first write, escalated to the orchestrator: (1) the delegated surface `backend/app/main.py` does not exist — the FastAPI entrypoint is `backend/main.py` (chatbot import line 38, include_router line 395); (2) fully removing prompt/chatbot-specific generation per the RC-2 bullet requires regenerating `backend/app/servicios_negocio/prompt_sistema.txt` (knowledge-only bytes, currently 7,619 incl. assistant-persona instructions) and reworking its only generator `backend/scripts/sincronizar_conocimiento.py` (imports `conocimiento_club.SYSTEM_PROMPT`); neither is in the allowed surface list. That snapshot is load-bearing for Help/FAQ parity: consumed by `frontend/src/app/ayuda/__tests__/knowledge-parity.test.tsx`, `frontend/src/app/landing/__tests__/landing-knowledge-parity.test.tsx`, and root `tests/test_glossary_contract.py` (all read-only consumers; their assertions target knowledge-block shapes, so a knowledge-only snapshot should keep them green — verified by the full lane). Out-of-surface findings recorded: `backend/scripts/verificar_entrega_pdf.py` + its test mention `verificar_chatbot.py` comment-only (RC-3); `Makefile` `qa-chatbot-check` and deploy-script `verificar_chatbot.py` calls break only on manual/RC-3 surfaces (RC-3); `tests/test_release_controls.py` and `tests/test_docker_compose_config.py` assert on untouched deploy/compose text so they stay green; `scripts/diagnostico_horarios.py:163` message text mentions the chatbot prompt (static residue, RC-3); `Settings.extra="ignore"` keeps the backend booting while compose still passes `OPENCODE_*`/`CHATBOT_*` until RC-3.
- 2026-09-21: Read-only repository mapping completed.
- 2026-09-21: Owner selected stacked PRs targeting `main`.
- 2026-09-21: Combined RC-1 candidate `ea77878` passed local checks but native review refused it before authority creation because its immutable evidence exceeded the lens context budget.
- 2026-09-21: Preserved the original candidate branch and created `refactor/remove-chatbot-entrypoints` from `7e84ecf` for the smaller RC-1A slice.
- 2026-09-21: RC-1A implemented in this worktree from the `ea77878` reference diff (11 files: +30/−1,143 before the task document update). `/ayuda` keeps its static FAQ and plain navigation; the sidebar help row no longer opens chat. No replacement floating action, assistant, or ghost button was added. The idle sibling `gentleman-remove-chatbot-ui` `db-test` fixture on port 5436 was stopped (single-tenant rule) before this worktree's backend lane; nothing else outside this worktree was touched.
- 2026-09-22: Owner authorized clone-local RDD disable after the terminal provider failure and approved a `size:exception` for RC-1A (1,288 changed lines) because the remaining overage is cohesive deletion of retired launcher E2E coverage. Native outcome is `disabled/unmanaged`; no review approval is claimed.
- 2026-09-22: RC-1A delivered as PR #1377 and squash commit `a5eb731`; PR checks and the full post-merge `main` matrix passed. The local branch/worktree were removed after an exact content-equivalence check, and RC-1B started from fresh `main`.
- 2026-09-22: RC-1B implemented in this worktree: deleted all 10 files under `frontend/src/components/chatbot/` (3,722 lines) plus the 2-line dead roster entry, byte-matching the `ea77878` reference. `make test-frontend` 301 files / 5,062 tests passed — exactly −4 files / −126 tests vs RC-1A, the deleted chatbot suites. `make pre-pr LANE=full` green with Playwright 202 passed. The sibling `gentleman-pr3-schedule-visibility` `db-test` fixture on port 5436 was verified idle (0 active sessions, 0 established connections) before being stopped under the single-tenant rule; nothing else outside this worktree was touched.
- 2026-09-22: RC-1C implemented in this worktree from the `ea77878` reference diff restricted to the BFF/contract slice (9 files: 4 deleted, 5 edited including this task document and the BFF contract doc). The sibling `gentleman-remove-chatbot-ui-dead` `db-test` fixture on port 5436 was verified idle (0 active sessions, 0 established connections) before being stopped under the single-tenant rule; nothing else outside this worktree was touched.

## Verification evidence
- Superseded combined candidate `ea77878`: writer reported Impeccable detector `[]`; frontend 299 files / 5,040 tests passed; backend 2,891 passed / 3 skipped; root 636 passed / 1 skipped; Next 46/46 pages; Playwright 202 passed; `git diff --check` clean. Native review: not started (`lens_context_budget_exceeded`).
- RC-1A slice (observed in this worktree):
  - Commit: `a3a7518612df16c8a04a28fabfabb5358c5a8541` (`refactor(frontend): remove chatbot entrypoints`), 12 files, 145 insertions, 1,143 deletions.
  - Impeccable `detect --json` on the seven edited UI files: `[]`.
  - Writer `make test-frontend`: 305 files / 5,188 tests passed.
  - Writer `make pre-pr LANE=full`: completed green (backend ruff, lint-imports, pip-audit, backend tests via `db-test`, root tests, Next build, and Playwright `202 passed`).
  - Independent verifier: `make test-frontend` 305 files / 5,188 tests passed; `make test-root` 638 passed / 1 skipped; range `git diff --check` clean; structural entrypoint search passed.
  - Bounded search: no active frontend mount/launcher/dialog entrypoint remains. Dead implementation/API references are deferred to RC-1B/RC-1C.
  - Rollback boundary: revert `a3a7518`; it only removes entrypoints and their direct test expectations, so the untouched dead implementation keeps the app building and green.
  - Native review lineage `review-553a02e0d2bb3efd`: three reviewer artifacts were submitted, then capture became partial/unknown. Reconciled STATUS was terminal `native_stop_required`, authority state `escalated`, cause `unknown_causality`, finding `R3-RemovedHelpExport`. No approval was acknowledged.
  - Owner-authorized disposition: RDD disabled clone-locally; current delivery status is `disabled/unmanaged`. Upstream occurrence recorded on Gentle AI #4553 and session-scope request opened as #4879.
  - Review workload: owner-approved `size:exception` for 1,288 changed lines after one honest slicing pass; the overage is primarily cohesive deletion of obsolete chatbot E2E coverage.
- RC-1B slice (observed in this worktree):
  - Commit: `refactor(frontend): delete dead chatbot UI` (this commit), 11 code files: 0 insertions, 3,724 deletions (10 files / 3,722 lines under `frontend/src/components/chatbot/`; 2 roster lines in `touch-target-usage.test.ts`), plus this task-document evidence in the same commit.
  - Bounded search: no `@/components/chatbot` / `components/chatbot` import or active reference remains anywhere under `frontend/`. Deferred mentions: `frontend/tailwind.config.ts:16` comment (config comment, RC-3); `app/api/chatbot/` BFF route + tests, `lib/chatbot-contract.ts`, `services/api.ts` `consultarChatbot` method and comments (RC-1C); comment-only `ChatWidget` mentions in members/lib sources and tests (RC-3).
  - Writer `make test-frontend`: 301 files / 5,062 tests passed (vs RC-1A 305 files / 5,188 tests: exactly −4 files / −126 tests, the deleted chatbot suites).
  - Writer `make pre-pr LANE=full`: completed green; make sequencing proves every earlier stage passed before the final stage — backend ruff, lint-imports, pip-audit, backend tests via `db-test`, root tests, frontend audit/type-check/lint/coverage, Next build, Playwright `202 passed (3.0m)`.
  - `git diff --check`: clean.
  - Rollback boundary: revert this commit; it only deletes the dead directory and one roster entry, so the entrypoint-free app from RC-1A stays building and green and no unrelated behavior is touched.
  - Independent verifier: `make test-frontend` 301 files / 5,062 tests passed; `make test-root` 638 passed / 1 skipped; range `git diff --check` clean; deleted-directory/import search passed.
  - Native review: `disabled/unmanaged` (RDD clone-locally disabled by owner); no review approval claimed or implied.
  - Review workload: owner-approved `size:exception` for 3,761 changed lines (31 additions, 3,730 deletions). This is a cohesive pure-deletion slice; further file-by-file PRs would not create independent functional units.
- RC-1C slice (observed in this worktree):
  - Commit: `refactor(frontend): remove chatbot BFF and client contract` (this commit), 9 files: 4 deleted (`app/api/chatbot/route.ts` 137 lines, `app/api/chatbot/__tests__/route.test.ts` 140, `lib/chatbot-contract.ts` 47, `lib/__tests__/chatbot-contract.test.ts` 134 — 458 lines), plus `services/api.ts`, `services/__tests__/api.test.ts`, `tests/test_bff_contract.py`, `docs/operations/bff-contract.md`, and this task document.
  - Focused: `uv run pytest ../tests/test_bff_contract.py` 139 passed / 1 skipped; `vitest run src/services/__tests__/api.test.ts` 78 passed (−1 chatbot timeout test vs before the slice; −2 files / −18 tests attributable to this slice overall: 8 route + 9 contract + 1 timeout).
  - `make test-frontend`: 301 files / 5,069 tests passed. Absolute totals are not comparable to RC-1B's 5,062: newer `main` added suites (#1381/#1384/#1385) between the measurements; the slice's own delta is −2 files / −18 tests.
  - Writer `make pre-pr LANE=full`: completed green; make sequencing proves every earlier stage passed before the final stage — backend ruff, lint-imports, pip-audit, backend tests via `db-test`, root tests, frontend audit/type-check/lint/coverage, Next build, Playwright `202 passed (3.6m)`.
  - `git diff --check`: clean.
  - Byte-match: `tests/test_bff_contract.py` and all 4 deleted files match `ea77878` exactly; `api.ts`/`api.test.ts` match every chatbot-adjacent region (residual diffs are pre-existing drift from other merged features, zero chatbot lines).
  - Deferred mentions (RC-3): past-tense comments in `services/api.ts` (#708 Retry-After provenance) and `api.test.ts`, `tailwind.config.ts:16`, `ChatWidget` comment mentions in members/lib sources and tests, `components/README.md`, `ToastContainer.tsx`, `LoadingState.tsx`, `globals.css`, Help/FAQ content mentions, and operational/docs references.
  - Rollback boundary: revert this commit; it only removes the BFF route, contract, client method, and their tests (and retunes the root gate's floor 3→2), so the entrypoint-free, UI-free app from RC-1A/1B stays building and green; no unrelated route coverage changes.
  - Native review: `disabled/unmanaged` (RDD clone-locally disabled by owner); no review approval claimed or implied.

- RC-2 slice (observed in this worktree):
  - Commit: `refactor(backend): remove chatbot capability` (this commit), 25 files: 8 deleted (router 56, schemas 27, service 508, diagnostics 177, verificar script 89, test_chatbot 1033, test_diagnostico 153, test_verificar 318 — 2,352 lines), 17 edited; totals +97/−2,802 including this task document.
  - Focused: backend 140 passed (conocimiento/configuracion/main) + 62 passed (event-loop/guardia/vocabulario/circuito); root BFF contract 139 passed / 1 skipped; sync `--verificar` synchronized; `lint-imports` 3 kept / 0 broken.
  - `make pre-pr LANE=full`: backend lane green through root tests (636 passed / 1 skipped); frontend stage stopped at its dependency guard (missing `node_modules` — environmental). After the documented `pnpm install --frozen-lockfile`, `make pre-pr LANE=frontend` completed green: audit, type-check, lint, coverage, Next build, Playwright `202 passed (3.5m)`.
  - Knowledge contract: `conocimiento_club.json` byte-identical; frontend mirrors byte-identical; `prompt_sistema.txt` knowledge-only (5,312 chars) and locked by `test_la_instantanea_de_conocimiento_esta_al_dia`; /ayuda, landing, and glossary gates read it unchanged.
  - Deferred mentions (RC-3): past-tense history in `conocimiento_club.py` docstring/snapshot comment, `sincronizar_conocimiento.py` provenance note, event-loop docstring issue #834 narrative, `verificar_entrega_pdf.py` + its test comments, `Makefile` `qa-chatbot-check` + deploy-script `verificar_chatbot.py` calls, `tests/test_release_controls.py` / `test_docker_compose_config.py` deploy/compose-text assertions, `scripts/diagnostico_horarios.py` message text, compose `OPENCODE_*`/`CHATBOT_*` variables (backend boots despite them via `Settings.extra="ignore"` until RC-3).
  - Rollback boundary: revert this commit; it only removes the chatbot capability and its direct test coupling, so the entrypoint-free, UI-free, BFF-free app from RC-1A/1B/1C stays building and green; `/ayuda` keeps its static knowledge via the unchanged canonical JSON.
  - Native review: `disabled/unmanaged` (RDD clone-locally disabled by owner); no review approval claimed or implied.

- RC-3A slice (observed in this worktree):
  - Commit: `refactor(ops): remove chatbot operational and documentation residue` (this commit), 13 files: 12 ops/config/test/doc surfaces + this task document; +49/−317 (cohesive deletion/rewrite; no behavior beyond the retired chatbot checks).
  - Commit: `chore(frontend): sweep chatbot comment residue across frontend surfaces` (this commit), 17 files: 16 comment-only frontend sites + this task document line; +48/−59.
  - Focused: root `test_docker_compose_config.py + test_release_controls.py + test_diagnostico_horarios.py + test_staging_runbook_contract.py + test_glossary_contract.py + test_bff_contract.py` 401 passed / 1 skipped; frontend vitest on the 7 touched suites 341 passed (7 files).
  - `make pre-pr LANE=full`: completed green end-to-end — backend ruff, lint-imports, pip-audit, backend tests via `db-test`, root tests, frontend audit/type-check/lint/coverage, Next build, Playwright `202 passed (3.2m)`. `db-test` was single-tenant: the idle sibling `gentleman-1372-db-test-1` fixture (0 client sessions) was stopped before the runs.
  - Bounded final search: remaining `chatbot`/`OpenCode` mentions are all classified — intentional history (api.ts/api.test.ts #708 past tense, `conocimiento_club.py`, `sincronizar_conocimiento.py:24`, event-loop #834 narrative, `test_conocimiento_club.py:5,15`, `test_bff_contract.py:89`, `diagnostico-horarios.md` past-tense line) or out-of-surface follow-ups (`verificar_entrega_pdf.py:35,46`, `test_verificar_entrega_pdf.py:22`, stale `test_el_modulo_del_chatbot_ya_no_guarda_una_copia_del_conocimiento` citation in `landing-config-no-schedule-list.test.ts:13` — test name confirmed absent from backend).
  - `.env` templates: all three untouched; subsequently excluded by the owner rather than counted as completed cleanup.
  - Rollback boundary: revert this commit; it only removes chatbot deploy/compose/QA checks and comment/docs residue, so the app from RC-1A–RC-2 stays building and green; `/ayuda` and its parity gates are untouched.
  - Native review: `disabled/unmanaged` (RDD clone-locally disabled by owner); no review approval claimed or implied.

## Closure
- RC-1C: PR #1387 merged; post-merge `main` CI green.
- RC-2: PR #1388 merged with an owner-approved `size:exception`; post-merge `main` CI green.
- RC-3A: PR #1389 and PR #1390 merged; post-merge `main` CI green after one failed-job rerun for a diagnosed transient BuildKit connection timeout on #1390.
- Scope decision: the three environment-example templates are intentionally retained, not cleaned. The chatbot capability and the agreed accessible integration surfaces are removed; literal repository-wide absence is not asserted.
- No further implementation is planned under this scoped feature. Revisit the retained templates only on a new request with a policy-permitted method.
