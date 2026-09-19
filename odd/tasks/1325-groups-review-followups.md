# 1325 — Groups page: stale duplicate banner, unnamed delete-zone guard, raw-string catalog sort

Issue: https://github.com/AlejandroTatum/cata_club/issues/1325
Branch: `chore/1325-groups-review-followups` (worktree `cata_club-worktrees/gentleman-1325`, cut from `origin/main` @ eab88c1)
Delivery strategy: single PR, squash auto-merge (forecast well under 400 changed lines: 3 small fixes + tests)
TDD: **on** (strict, session config). Runner: `cd frontend && pnpm vitest run <file>`.
RDD: decided by the orchestrator after this writer's report (not run by this writer).

## Objective

Close the three ADVISORY findings from the native review of #1324, each applied with its own test (no item discarded).

## Findings (from the issue)

- **F1** — `frontend/src/app/groups/page.tsx` (`handleSubmit`) — the duplicate-categoría banner (`formError` + `duplicateCategoriaCodigo`) could go stale: a client-side validation error (e.g. unticking every día) returned early without clearing the banner from a PREVIOUS failed submit, so the old "Editar «X»" CTA kept showing next to an unrelated new problem.
- **F2** — `frontend/src/app/groups/page.tsx` (~1158) — `editingGroup !== null && editingGroup.rows.length > 0` gating the "Eliminar esta categoría" zone was an inline semantic guard with no name.
- **F3** — `frontend/src/app/groups/groups-page-utils.ts` (`buildCatalogoSinHorarios`, ~331-333) — the catalog-card sort compared labels with plain `localeCompare()` (no locale/options), which can rank an accented/differently-cased label away from its plain counterpart instead of treating them as the same word.

## Scope (authorized)

- Edit: `frontend/src/app/groups/page.tsx`, `frontend/src/app/groups/groups-page-utils.ts`.
- Edit tests: `frontend/src/app/groups/__tests__/GroupsPage.test.tsx`, `frontend/src/app/groups/__tests__/groups-page-utils.test.ts`.
- No dependency, schema, or unrelated-file changes.
- Code/tests/comments in English (matching the surrounding English JSDoc-style comments in these two files); UI copy stays Spanish as already in the app.

## Tasks

- [x] T1 (F1): test pinning that a later submit's error state (client validation) clears a stale duplicate-categoría banner from a previous attempt; fix `handleSubmit`/`submitCategoria` to clear `formError` + `duplicateCategoriaCodigo` at the start of every submit attempt, not only inside the success/catch path.
- [x] T2 (F2): extract `puedeEliminarCategoria(editingGroup)` to `groups-page-utils.ts` with unit tests documenting the "no rows yet" vs "has rows" vs "no group" cases; wire it into the JSX guard.
- [x] T3 (F3): unit test with an accented/differently-cased label showing the plain-`localeCompare()` reorder bug; fix the sort to `localeCompare(b.label, "es", { sensitivity: "base" })`.
- [x] T4: verification — focused files, then `make pre-pr LANE=frontend`; report to orchestrator (no push/PR/review from this writer).

## Acceptance criteria

- Each of F1/F2/F3 applied with an observed RED→GREEN test; none discarded.
- `groups-page-utils.test.ts` + `GroupsPage.test.tsx` green.
- `make pre-pr LANE=frontend` result reported honestly (pass, or classified failure with evidence).
- No AI attribution in commits (`git log --format=%B origin/main..HEAD | rg -c 'Claude|Generated'` → 0).

## Evidence

### T1 (F1) — stale duplicate banner

- **RED** — `pnpm vitest run src/app/groups/__tests__/GroupsPage.test.tsx -t "clears the stale duplicate-label banner"`:
  `AssertionError: expect(element).not.toBeInTheDocument() — expected document not to contain element, found <div class="alert-error" role="alert">Ya existe una categoría llamada "Formativo".</div>`
  (the stale banner from the first failed submit was still showing after the second submit failed client-side validation instead).
- **Fix**: `handleSubmit` now clears `formError`/`duplicateCategoriaCodigo` unconditionally at the top, before the client validation short-circuit (`return` on field errors). `submitCategoria` also clears `duplicateCategoriaCodigo` at its own top (it already cleared `formError`), for the direct-call path from `handleConfirmPendingDeletions`.
- **GREEN** — same command → test passes; full file `pnpm vitest run src/app/groups/__tests__/GroupsPage.test.tsx` → 96/96 passed.

### T2 (F2) — named delete-zone guard

- **RED** — `pnpm vitest run src/app/groups/__tests__/groups-page-utils.test.ts`: `TypeError: puedeEliminarCategoria is not a function` (3 new tests: hides for catalog-only `rows: []`, shows once a día row exists, hides when `editingGroup` is `null`).
- **Fix**: added `puedeEliminarCategoria(editingGroup: HorarioGroup | null): editingGroup is HorarioGroup` — a TS type-predicate, not a plain `boolean` — to `groups-page-utils.ts`, JSDoc explaining the catalog-only (#1315) rationale; `page.tsx` JSX guard now reads `{puedeEliminarCategoria(editingGroup) && (...)}`.
- **GREEN** — same command → 3/3 new tests pass, 45/45 in the file.
- Gotcha caught by `pnpm type-check` (not by vitest): a plain `boolean` return type lost the inline `editingGroup !== null && …` narrowing that `editingGroup.categoria`/`editingGroup.rows` inside the JSX relied on (`TS18047: 'editingGroup' is possibly 'null'`). The type-predicate return form (`editingGroup is HorarioGroup`) restores narrowing while keeping the guard named and unit-testable.

### T3 (F3) — accent/case-insensitive catalog sort

- **RED** — `pnpm vitest run src/app/groups/__tests__/groups-page-utils.test.ts`: new test inserts catalog entries `{Único}` then `{unico}` (same `horaInicio`); with plain `localeCompare()`, `"Único".localeCompare("unico")` returns `1`, flipping them to `["UNICO_PLANO", "UNICO_ACENTO"]` instead of preserving insertion order — `AssertionError: expected [ 'UNICO_PLANO', 'UNICO_ACENTO' ] to deeply equal [ 'UNICO_ACENTO', 'UNICO_PLANO' ]`.
- **Fix**: `buildCatalogoSinHorarios`'s sort now uses `a.label.localeCompare(b.label, "es", { sensitivity: "base" })` for the label tiebreaker (start-time comparison left as plain `localeCompare` — both are `"HH:MM"` strings, no locale sensitivity needed there).
- **GREEN** — same command → test passes; verified with `node -e` that `"Único".localeCompare("unico", "es", {sensitivity:"base"})` returns `0` (stable sort keeps insertion order), matching the fix.

### T4 — Verification

- `pnpm vitest run src/app/groups/__tests__/groups-page-utils.test.ts src/app/groups/__tests__/GroupsPage.test.tsx` → 141/141 passed.
- `make pre-pr LANE=frontend` (exit 0): `pnpm audit --audit-level=high` → 1 moderate (non-blocking, pre-existing); `pnpm type-check` → clean (after the type-predicate fix above); `pnpm lint` → clean (pre-existing `no-img-element` warning on `sponsors/page.tsx`, unrelated); `pnpm run test:coverage` → 301 files / 5160 tests passed; `pnpm build` → compiled successfully; `pnpm exec playwright test` → 218/218 passed.
