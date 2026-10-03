# Category schedule form — redesign and single 24 h time format

Branch: `fix/category-schedule-form` (worktree `cata_club-worktrees/gentleman-category-form`, base `origin/main` 7742aefa)

## Objective
The admin "Nueva categoría / Editar categoría" form on `/groups` must use one unambiguous time format (24 h `HH:MM`) for input and display, follow the current admin style, and leave no dead space in the layout.

## Problem / why
- Hora de inicio/fin use native `<input type="time">`, which renders 12 h or 24 h by browser locale (`--:--`, AM/PM), so the admin cannot tell which format applies. The "Formato 24 h (ej. 17:00 = 5:00 p. m.)" helper adds a second format instead of removing the ambiguity.
- The 4-column grid leaves the right half of the time row empty.

## Overlap check (2026-10-02)
- No open PR or branch touches `frontend/src/app/groups/` or `services/categorias.ts` against origin/main 7742aefa; `fix/qa2-admin-ux` content is already in main (#1504).
- QA3 stack touches only `backend/.../asistencia_schemas.py`; this change does not need the backend.

## Scope
- `frontend/src/app/groups/page.tsx` (form layout, time fields, days, summary)
- New `frontend/src/components/ui/TimePicker24.tsx` (24 h hour/minute control emitting `HH:MM`) + test
- `frontend/src/app/groups/__tests__/GroupsPage.test.tsx`
- Payload stays `"HH:MM"`; no backend change.

## Constraints
- Human visual gate: show the design before delivery; deliver only after the owner's OK.
- Test-first for TimeField behavior; pre-PR lane `make pre-pr LANE=frontend`.

## Tasks
- [x] 1. Visual prototype approved by owner 2026-10-02 (v3: two-column grid, segmented day bar, 24 h popover picker with hour 06–22 and 5-minute grids, duration chip, no 7th-day disable). Applies to create AND edit. Prototype kept untracked in `.preview/`.
- [x] 2. TimePicker24 component (24 h, 06:00–22:00, 5-minute steps) with tests — 3a2a00d2
- [x] 3. Redesign form layout in `groups/page.tsx` using TimePicker24 and day toggle bar; update tests — 88803f72
- [ ] 4. Validation lane, commit, PR (after owner OK)
