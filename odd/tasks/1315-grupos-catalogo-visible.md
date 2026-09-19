# 1315 — `/groups` must not lie on a fresh install

Issue: https://github.com/AlejandroTatum/cata_club/issues/1315
Branch: `fix/1315-horarios-empty-state` (worktree `cata_club-worktrees/gentleman-1315`, cut from `origin/main` @ 29a2437)
Delivery strategy: single standard PR to `main` (squash auto-merge), one writer.
TDD: **on** (strict). Runner: `cd frontend && pnpm vitest run <path>`.
RDD: on (global). Candidate = the work-unit commit(s) on this branch.

## Objective

Stop the Horarios admin screen from lying on a fresh install: the seeded
categoría catalog is visible and reachable even when there are no
`horario_entrenamiento` rows yet, and a duplicate-label refusal points the admin
at the categoría that already exists instead of dead-ending.

## Problem

Migration `a4e7c2f9b1d8` (+`d4c7e1b09a35`) seeds 5 `categoria_horario` rows with
their `categoria_horario_dia` days and **zero** `horario_entrenamiento` rows (the
catalog / schedules split, #1248). `frontend/src/app/groups/page.tsx` gates its
empty state on `horarios.length === 0` and titles it "No hay categorías
configuradas" with a "Crear primera categoría" button — but `cargarCategorias()`
already fetched the catalog successfully in `loadData` and only uses it for
labelling. So the 5 seeded categorías are invisible and the screen claims none
exist.

The trap: the admin follows the button and creates "Infantil", the backend
rejects with `400 Ya existe una categoría llamada "Infantil"` (unique label), the
form shows a dead-end error, and there is no visible way to reach the categoría
that caused the refusal. Verified exit on staging: a NEW label `POST`s fine
(201, categoría + sesiones atomic) and renders.

## Scope

- `frontend/src/app/groups/page.tsx`: when the catalog is non-empty and there are
  no schedules, render each catalog categoría as a card in the existing
  card/table language (label, franja, días permitidos, "sin horarios de
  entrenamiento todavía"), with an action that opens the existing v6 edit flow
  (`PUT /asistencias/categorias/{codigo}` via `actualizarCategoria`).
- The "No hay categorías configuradas" empty state renders **only** when the
  catalog itself is empty (`categorias` has no entries).
- On a create-form duplicate-label `400`, surface an actionable message that
  opens the existing categoría's v6 edit flow instead of a dead-end error.
- `frontend/src/app/groups/groups-page-utils.ts`: pure helpers for the above.
- Tests: `frontend/src/app/groups/__tests__/groups-page-utils.test.ts` and
  `frontend/src/app/groups/__tests__/GroupsPage.test.tsx`.

## Out of scope

- Any backend change — `actualizar_categoria` already re-derives horarios
  atomically and the create path already exists.
- The unrelated "error grave / WhatsApp" report.
- e2e / QA stack runs.

## Constraints

- UI copy in Spanish; code and comments in English (repo convention).
- Respect existing patterns: AppShell, `ui` components (EmptyState, ErrorState,
  Button, WeekStrip, Badge), `useToast`, a11y attributes and error ids.
- Keep the diff minimal and cohesive; do not refactor unrelated sections.
- Conventional Commits, no AI attribution, no `Co-Authored-By`. Do not push.

## Tasks

- [x] T1. RED: pure-helper tests (`buildCatalogoSinHorarios`,
  `findCategoriaDuplicada`, `findCodigoPorLabel`) and page tests — fresh install
  renders the catalog cards with a "Definir horarios" action; the empty state
  appears only with an empty catalog; a duplicate-label 400 offers an action that
  opens the existing categoría's edit flow. Observe the failures.
- [x] T2. GREEN: implement the helpers and the page rendering/action; observe the
  focused tests pass.
- [ ] T3. Lint + type-check (`pnpm lint`, `pnpm type-check`) and full frontend
  unit suite. `make pre-pr LANE=frontend` is run by the orchestrator after this
  handoff, not here.
- [ ] T4. Work-unit commit(s) on the branch; report for orchestrator RDD review
  and delivery.

## Acceptance criteria

- On a fresh install (catalog non-empty, no schedules), the 5 seeded categorías
  are visible as cards marked "sin horarios de entrenamiento todavía", each with
  an action that opens the existing edit form pre-filled from the catalog.
- "No hay categorías configuradas" renders iff the catalog is empty.
- A duplicate-label 400 on create offers a control that opens that categoría's
  edit flow; the generic server-error banner behavior is unchanged for messages
  without a quoted name.
- Focused tests green; lint and type-check clean.

## Evidence

- Environment note: this worktree had no `frontend/node_modules`, so the
  authorized test runner could not start. Ran `pnpm install --frozen-lockfile`
  exactly once (non-destructive, respects `frontend/pnpm-lock.yaml`, installs
  nothing outside `node_modules/`).
- T1 RED:
  - `cd frontend && pnpm vitest run src/app/groups/__tests__/groups-page-utils.test.ts`
    → `9 failed | 32 passed (41)`. All 9 failures were the new tests, each for
    the right reason (`TypeError: buildCatalogoSinHorarios is not a function`,
    `findCategoriaDuplicada is not a function`, `findCodigoPorLabel is not a
    function`).
  - `cd frontend && pnpm vitest run src/app/groups/__tests__/GroupsPage.test.tsx`
    → `5 failed | 88 passed (93)`. The failures were the five new page
    behaviors: catalog cards not rendered, no "Definir horarios" action, the
    empty state still shown over a non-empty catalog, and no duplicate-label
    exit. The sixth new test (empty catalog → empty state) already passed on the
    old code and is kept as the other half of the condition.
- T2 GREEN:
  - `cd frontend && pnpm vitest run src/app/groups/__tests__/groups-page-utils.test.ts src/app/groups/__tests__/GroupsPage.test.tsx`
    → `Test Files 2 passed (2)`, `Tests 134 passed (134)`.
- T3 (partial; `make pre-pr LANE=frontend` deliberately left to the
  orchestrator):
  - `cd frontend && pnpm lint` → no errors; one pre-existing warning in
    `src/app/sponsors/page.tsx` (`<img>` vs `next/image`), untouched by this
    change.
  - `cd frontend && pnpm type-check` → clean (`tsc --noEmit`).
  - `cd frontend && pnpm test` (full frontend unit suite) → `Test Files 300
    passed (300)`, `Tests 5123 passed (5123)`.
- Not run: `make pre-pr LANE=frontend` (orchestrator's step after handoff).
- Commits: recorded in the branch (see `git log fix/1315-horarios-empty-state`).
