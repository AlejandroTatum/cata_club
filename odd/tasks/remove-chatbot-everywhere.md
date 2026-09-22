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
- Verification is writer-recorded while RDD is on, followed by native risk assessment/review routing and a bounded parent spot check.

## Tasks

### RC-1A — Remove frontend chatbot entrypoints (`in_progress`)
Route: delegated writer; triggers: preparation across 4+ files and multi-file write.

- [x] Remove root, shell, auth, landing, enrollment, unauthorized, and Help-page chatbot mounts/triggers while keeping `/ayuda` and static FAQ content.
- [x] Remove or update only E2E/unit expectations tied to visible launcher/dialog behavior.
- [x] Keep the dead implementation, BFF route, and client contract temporarily so this independently functional slice stays small.
- [x] Run focused frontend tests and the canonical full pre-PR lane.
- [x] Commit one coherent Conventional Commit work unit.
- [ ] Record native assessment/review outcome, changed-line count, rollback boundary, and PR slice.

Implementation applied from the superseded combined candidate `ea77878`'s
diff, restricted to the entrypoint slice; every edited file byte-matches the
reference candidate's version of that file. Commit:
`refactor(frontend): remove chatbot entrypoints` (this commit).

Acceptance:
- No user-visible launcher, widget, dock, assistant CTA, or automatic chatbot mount remains.
- `/ayuda` continues to serve static Help/FAQ content.
- Frontend checks pass.

### RC-1B — Delete dead chatbot UI implementation and tests (`pending`)
Route: delegated writer; triggers: preparation across 4+ files and multi-file write.

- [ ] Delete dead chatbot components, store/helpers, and their unit tests.
- [ ] Remove dead touch-target/AppShell test coupling.
- [ ] Validate and commit in reviewable candidates; preserve any required size-exception evidence.

### RC-1C — Remove frontend chatbot BFF and client contract (`pending`)
Route: delegated writer; triggers: preparation across 4+ files and multi-file write.

- [ ] Delete the chatbot BFF route, chatbot contract, service API methods/types, and dedicated tests.
- [ ] Update root BFF contract assertions without weakening unrelated route coverage.
- [ ] Validate and commit.

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

## Verification evidence
- Superseded combined candidate `ea77878`: writer reported Impeccable detector `[]`; frontend 299 files / 5,040 tests passed; backend 2,891 passed / 3 skipped; root 636 passed / 1 skipped; Next 46/46 pages; Playwright 202 passed; `git diff --check` clean. Native review: not started (`lens_context_budget_exceeded`).
- RC-1A slice (observed in this worktree):
  - Impeccable `detect --json` on the seven edited UI files: `[]`.
  - `make test-frontend`: 305 files / 5,188 tests passed.
  - `make pre-pr LANE=full`: completed green (backend ruff, lint-imports, pip-audit, backend tests via `db-test`, root tests, then frontend lane ending in Playwright `202 passed (2.7m)`; backend step counts scrolled past capture, green by make fail-fast order).
  - `git diff --check`: clean.
  - Bounded search: no active frontend mount/launcher/dialog entrypoint remains. The only remaining in-slice references are the AppShell test's intentional not-in-document guards and comments; dead references are classified for later slices below.
  - Deferred references: `components/chatbot/**` + `touch-target-usage.test.ts` roster line → RC-1B; `app/api/chatbot/**`, `lib/chatbot-contract.ts`, `services/api.ts` `consultarChatbot` (+ its test) → RC-1C; `error-message.test.ts` backend module fixture → RC-2; chatbot mentions in comments/docs (`LandingMotion.tsx`, `ToastContainer.tsx`, `LoadingState.tsx`, `smooth-scroll.ts` + tests, landing/ayuda test comments) → RC-3.
  - Rollback boundary: revert this single commit; it only removes entrypoints and their direct test expectations, so the untouched dead implementation keeps the app building and green.

## Next step
Run native assessment/review on the RC-1A commit, record its outcome above, then delegate RC-1B (delete the dead UI implementation and its tests).
