# Remove chatbot everywhere

## Objective
Remove the chatbot from every product, API, operational, test, configuration, and documentation surface while preserving the standalone Help/FAQ experience.

## Problem
The chatbot is mounted across public and authenticated frontend surfaces, exposed through a frontend BFF and backend API, and coupled to deployment checks, environment configuration, dependencies, tests, and documentation. Removing only the visible widget would leave dead and misleading infrastructure behind.

## Why
The owner explicitly requested that the chatbot be removed from the application everywhere.

## Scope
- Remove all chatbot UI launchers, dock/widget components, client APIs, BFF route, contracts, and chatbot-specific tests.
- Keep `/ayuda` and its static FAQ/knowledge content, but remove its assistant trigger.
- Remove the backend chatbot endpoint, service, schemas, diagnostics, verification script, provider dependency, and dedicated tests.
- Remove chatbot-only environment, Compose, deployment, Makefile, resilience, release-control, contract, and documentation references.
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

### RC-2 — Remove backend chatbot capability (`pending`)
Route: delegated writer; triggers: preparation across 4+ files and multi-file write.

- [ ] Remove chatbot router registration, router, schemas, service, diagnostics, verification script, and chatbot-only tests.
- [ ] Remove provider-specific settings, circuit-breaker constants/state, public-route allowances, and the unused OpenAI dependency/lock entries.
- [ ] Preserve the static club-knowledge source used by Help/FAQ and remove only prompt/chatbot-specific generation.
- [ ] Run focused backend/root tests and the canonical full pre-PR lane.
- [ ] Commit and record native review evidence.

### RC-3 — Remove operational and documentation residue (`pending`)
Route: delegated writer; triggers: preparation across 4+ files and multi-file write.

- [ ] Remove chatbot environment examples, Compose variables, deploy health checks, Make targets, and release-control assertions.
- [ ] Remove or rewrite chatbot references in operational and contract documentation without deleting valid Help/FAQ documentation.
- [ ] Search the final repository for remaining chatbot/provider references and classify any intentional historical references.
- [ ] Run focused root tests and the canonical full pre-PR lane.
- [ ] Commit and record native review evidence.

## Progress
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

## Next step
Deliver RC-1C as an independent PR, then remove the backend chatbot capability (RC-2).
