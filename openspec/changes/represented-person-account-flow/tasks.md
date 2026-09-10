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

Decision needed before apply: Yes — one product decision blocks Phase 4 (see
there). Phases 0–3 need none.

## Phase 0 — Put the house in order (no code)

- [ ] Edit the bodies of #1165, #1169, #1170, #1171, #1172, #1173, #1175, #1176: `Closes #1137` → `Refs #1137`.
- [ ] Retarget #1165 from `fix/represented-person-account-flow` to `main`.
- [ ] Mark #1175 and #1176 as draft, retitle with a `[#1133]` prefix, and note in their bodies that they wait for #1133.
- [ ] Discard the uncommitted diff in worktree `pi-1137` (`fix/represented-person-independence`) and remove the worktree and branch.
- [ ] Commit the uncommitted diffs of `pi-1137-pr4c2` and `pi-1137-pr4c2a` onto their own branches as `wip(personas): park #1133 safe-stop linking`, push them, and remove the worktrees. Do not open PRs.
- [ ] Verify with `git worktree list` and `gh pr list --state open` that only the intended units remain.

## Phase 1 — Land what is already built

Merge in this exact order: #1165, #1169, #1170, #1171, #1172, #1173.

Per PR, the ritual is:

1. Retarget the **child** PR to `main` (before merging the parent; merging a parent with branch auto-delete closes an un-retargeted child).
2. Squash-merge the parent: `gh pr merge <n> --squash --delete-branch`.
3. Rebase the child onto the new `main`: `git rebase --onto main <parent-head-sha> <child-branch>` and `git push --force-with-lease`.
4. Wait for the child's required CI to go green before the next iteration.

Acceptance: `main` contains the administrator desk exit (`POST /personas/{id}/independizar`, admin-only, token-free response, `Idempotency-Key`) and the `i1141relinteg` trigger that rejects an adult link. Run `make pre-pr LANE=backend` on `main` after the sixth merge.

- [ ] #1165 merged
- [ ] #1169 merged
- [ ] #1170 merged
- [ ] #1171 merged
- [ ] #1172 merged
- [ ] #1173 merged
- [ ] `make pre-pr LANE=backend` green on `main`

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

## Phase 4 — The people already inside (tramo 3)

**Blocking product decision (owner):** what happens to the existing accounts of represented minors and to the legal consents recorded against them? The migration must not choose. Options to put to the owner: (a) detect and report only, remediation later by hand; (b) detect, deactivate the `usuario` row, keep consents as history. Until answered, this phase does not start.

One PR, `fix/represented-person-legacy-accounts`, following `e762rolunico_un_solo_rol_activo_por_cuenta.py`:
- Alembic migration that finds `persona` rows with `representante_id IS NOT NULL` that have a `usuario` row, writes them to a detection table (`cuenta_representada_detectada`: `persona_id`, `usuario_id`, `representante_id`, `detectado_en`), logs the count in the deploy output, and never aborts.
- Applies only what the owner decided in the blocking question above; nothing else.

**TDD evidence:** RED migration test against PostgreSQL with seeded legacy rows and exact before/after counts; RED for the from-scratch, single-head, drift, and root-guard migration checks; GREEN.
**Focused validation:** `cd backend && uv run pytest tests/test_migraciones*.py -q` plus the migration validation targets in the Makefile.
**Runtime:** `make qa-up` against a QA database seeded with linked minors that hold accounts; read the detection table.

- [ ] Detection table populated with exact counts; migration never aborts, never deletes.
- [ ] Owner's decision applied, and only that.
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
