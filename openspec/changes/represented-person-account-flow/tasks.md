# Implementation Tasks — Represented-person account flow

> Replan (2026-09-10). This supersedes the 7-PR chain plan, which itself
> superseded a 14-PR plan. Scope returns to what issue #1137 decided: three
> tramos (the exit, the door, the people already inside), one PR per tramo,
> preferring deletion. Work that belongs to #1132, #1133, #1134, and #1138
> leaves this change. Size exceptions per tramo are already granted by the
> issue text ("uno por tramo"); no slicing by line count.

## Why the replan

- Eight chained PRs (#1165 → #1176) added +5,422/−567 lines in 40 hours with
  nothing merged, while `main` moved on. The issue asked for less code than
  before.
- Invariant (B) — a represented person never has a `usuario` row — is not
  implemented at the chain tip: `_crear_usuario_alumno` still runs
  (`backend/app/servicios_negocio/enrollment_servicio.py:286`) and both
  wizards still ask for the minor's password.
- #1171 retired self-service independence in the backend, but the student
  portal still renders the "Independizarse del representante" button, the
  `AgeUpConfirmation` modal and the BFF route: that button is broken at the
  chain tip, and no administrator screen exists for the desk action.
- PR2, PR3a, and PR4b were "inert by construction" (no production caller):
  the 1,000-line stop had become the slicing criterion instead of the work
  unit.

## What is kept, parked, or discarded

| Unit | Decision | Reason |
|---|---|---|
| #1165 audit foundation | **Keep, merge** | `independizar_presencial` records into the ledger |
| #1169 credential + capability cores | **Keep, merge** | Consumed by #1170/#1171 |
| #1170 independence service | **Keep, merge** | Tramo 1 backend |
| #1171 administrator cutover | **Keep, merge** | Tramo 1 backend |
| #1172 fixture compatibility | **Keep, merge** | Required by #1173 |
| #1173 relationship trigger migration | **Keep, merge** | Invariant (A) at the database |
| #1175 shared link validator | **Park under #1133** | No caller without safe-stop; not in #1137 |
| #1176 atomic reassignment | **Park under #1133** | Reassignment is not in #1137 |
| WIP `pi-1137` (1,279 lines, uncommitted) | **Discard** | Already salvaged into #1170/#1171 |
| WIP `pi-1137-pr4c2`, `pi-1137-pr4c2a` | **Park on a #1133 branch, remove worktrees** | Safe-stop linking is #1133 scope |
| Tracker #1164 | **Becomes the docs PR for this replan** | No longer a chain base |

## Delivery strategy

Stacked PRs to `main`, one per phase, squash-merged in order. No tracker as a
base branch. Each PR body says `Refs #1137`; only the Phase 4 PR says
`Closes #1137`.

Decision needed before apply: No — the Phase 4 product question was answered on 2026-09-11 (no legacy accounts in production).

## Phase 0 — Put the house in order (no code)

- [x] Edit the bodies of #1165, #1169, #1170, #1171, #1172, #1173, #1175, #1176: `Closes #1137` → `Refs #1137`.
- [x] Retarget #1165 from `fix/represented-person-account-flow` to `main`.
- [x] Mark #1175 and #1176 as draft, retitle with a `[#1133]` prefix, and note in their bodies that they wait for #1133.
- [x] Discard the uncommitted diff in worktree `pi-1137` (`fix/represented-person-independence`) and remove the worktree and branch.
- [x] Commit the uncommitted diffs of `pi-1137-pr4c2` and `pi-1137-pr4c2a` onto their own branches as `chore(...)` parking commits (also `pi-1137-pr5-red` → `test/represented-person-pr5-contracts` for #1134), push them, and remove the worktrees. Do not open PRs.
- [x] Verify with `git worktree list` and `gh pr list --state open` that only the intended units remain.

## Phase 1 — Land what is already built

Merge in this exact order: #1165, #1169, #1170, #1171, #1172, #1173.

Per PR, the ritual is:

1. Retarget the **child** PR to `main` (before merging the parent; merging a parent with branch auto-delete closes an un-retargeted child).
2. Squash-merge the parent: `gh pr merge <n> --squash --delete-branch`.
3. Rebase the child onto the new `main`: `git rebase --onto main <parent-head-sha> <child-branch>` and `git push --force-with-lease`.
4. Wait for the child's required CI to go green before the next iteration.

Acceptance: `main` contains the administrator desk exit (`POST /personas/{id}/independizar`, admin-only, token-free response, `Idempotency-Key`) and the `i1141relinteg` trigger that rejects an adult link. The `make pre-pr` lane cited by the previous handoff does not exist in this repository; the acceptance is the CI run on `main` after the sixth merge.

- [x] #1165 merged
- [x] #1169 merged
- [x] #1170 merged
- [x] #1171 merged
- [x] #1172 merged
- [x] #1173 merged
- [ ] CI run on `main` green after the #1173 merge (`34dfb58`)

## Phase 2 — Close tramo 1 in the frontend

One PR, `fix/represented-person-desk-exit-ui`. Net change expected negative or near zero.

Remove the self-service path:
- `frontend/src/app/student/page.tsx`: the "Independizarse del representante" button (≈1439), the `onIndependizar` prop plumbing (≈1010–1018, 1532), the `showAgeUpModal` state and handler (≈1493), and the `AgeUpConfirmation` mount (≈1537).
- `frontend/src/components/AgeUpConfirmation.tsx` and its tests.
- The `independizarPersona` client helper and `frontend/src/app/api/personas/[id]/independizar/route.ts` as a student-callable route.

Add the desk action:
- On the administrator person detail page, an "Independizar" action for an adult with `representante_id`: fields `correo`, initial `contrasenia`, `evidencia_identidad`; sends `Idempotency-Key`; BFF route restricted to the administrator session; shows the backend message on error.

**TDD evidence:** RED Vitest for the student page without the button/modal and for the admin action (happy path, minor rejected, backend message passthrough); RED Playwright for the admin flow; GREEN; REFACTOR.
**Focused validation:** `cd frontend && pnpm vitest run src/app/student src/app/admin src/app/api/personas && pnpm exec playwright test`.
**Runtime:** `make qa-up`; as admin, independize a linked adult and log in with the new credentials; as a linked minor, confirm no independence control exists.

- [ ] Student portal offers no independence path.
- [ ] Administrator can run the desk exit from the UI.
- [ ] `pnpm exec playwright test` green locally (the Frontend CI job runs it too).

## Phase 3 — The door (tramo 2)

One PR, `fix/represented-person-no-credentials`. Mostly deletion.

Backend:
- `enrollment_servicio.py`: `_crear_usuario_alumno` is never called when the enrollment carries `representante_id`; delete the branch, do not guard it.
- `dtos/enrollment_schemas.py`: the represented-minor enrollment DTO has no `correo`/`contrasenia` fields; a `model_validator` rejects `representante_id` on an adult `fecha_nacimiento` (invariant A at the DTO, matching the #1173 trigger).
- `dtos/persona_schemas.py`: the same validator on every write DTO that accepts `representante_id`.
- `backend/scripts/seed_dev_base.py`: seeded children get no `Usuario`; representatives keep theirs.

Frontend:
- `frontend/src/app/student/enroll/enroll-utils.ts` and `frontend/src/app/student/add-dependent/add-dependent-utils.ts`: remove the represented-minor `correo`/`contrasenia` fields, rules, and the wizard step that renders them; adjust the Playwright specs that fill them.

**TDD evidence:** RED backend tests — enrollment with `representante_id` creates no `usuario` row (assert by count), adult with `representante_id` rejected by DTO on every write path, seed creates no child account; RED Vitest/Playwright for the wizards; GREEN; invert each new predicate and confirm the lock goes red.
**Focused validation:** `cd backend && uv run pytest tests/test_enrollment*.py tests/test_personas.py -q && cd ../frontend && pnpm vitest run src/app/student && pnpm exec playwright test`.
**Runtime:** `make qa-up`; enroll a minor publicly and from a logged-in representative; confirm neither asks for the minor's credentials and that the minor cannot log in.

- [ ] No write path creates `usuario` for a person with `representante_id`.
- [ ] Invariant (A) enforced at DTO level on every write path.
- [ ] Both wizards neither show nor send represented-minor credentials.

## Phase 4 — Lock invariant (B) in the database (tramo 3)

**Product fact (owner, 2026-09-11):** production has no represented person with an account. There is nothing to migrate, so the legacy-remediation slice is replaced by a database lock, mirroring what #1173 did for invariant (A).

One PR, `fix/represented-person-account-db-lock`, one additive Alembic migration:
- **Guard:** at upgrade time, count `persona` rows with `representante_id IS NOT NULL` that have a `usuario` row. If the count is not zero, abort the migration with a message listing the count and the first ids. It never deletes, deactivates or chooses; it stops. (Production is expected to pass with zero; a QA/staging database seeded with old data stops the deploy instead of silently carrying the violation.)
- **Trigger on `usuario`:** `BEFORE INSERT OR UPDATE OF persona_id` rejects a row whose persona has `representante_id IS NOT NULL`.
- **Trigger on `persona`:** `BEFORE UPDATE OF representante_id` rejects setting a non-null `representante_id` on a persona that has a `usuario` row. (Insert is covered by construction: a new persona has no account yet.)
- `downgrade` removes both triggers and their functions.

**TDD evidence:** RED direct-SQL tests against PostgreSQL — inserting a `usuario` for a represented persona is rejected; re-pointing an account to a represented persona is rejected; linking a persona that already has an account is rejected; a normal adult account and a normal minor link still work; the guard aborts on a seeded legacy pair and passes on a clean database; `downgrade → upgrade` round-trip. GREEN; invert each predicate once and confirm red.
**Focused validation:** `cd backend && uv run pytest tests/test_representacion_triggers.py tests/test_cuenta_representada_triggers.py -q` plus the existing migration checks (single head, from-empty, drift, root guards) found under `backend/tests/` and `.github/workflows`.
**Runtime:** `make qa-up` on a fresh seed; confirm the migration applies, then attempt to create an account for a seeded child through `POST /auth/registro` and see the DTO/service rejection (the trigger is the last line, not the first).

- [ ] Guard aborts on legacy rows, passes on a clean database, never mutates.
- [ ] Both triggers installed and proven at the SQL boundary; round-trip clean.
- [ ] PR body says `Closes #1137`.

## Phase 5 — Close

- [ ] Reduce this OpenSpec change to the delivered scope: `proposal.md` and `design.md` keep the tramo 1–3 decisions; sections owned by #1132, #1133, #1134, #1138 move to those issues as comments; `specs/player-eligibility`, `specs/representation-lifecycle`, `specs/representative-capability`, `specs/minor-contact` are removed from this change.
- [ ] Merge #1164 as the docs PR of this replan.
- [ ] Verify #1137 closed by the Phase 4 merge with `gh issue view 1137`.
- [ ] Archive the change.

## Guardrails

- Strict TDD per phase: RED observed before touching code.
- Backend tests against the real PostgreSQL `db-test` (port 5436); no concurrent backend suites.
- Status of PRs and branches is read from `gh pr list` and `git worktree list`, never from this document.
- No new "inert" PRs: every PR changes runtime behavior or is pure deletion.
