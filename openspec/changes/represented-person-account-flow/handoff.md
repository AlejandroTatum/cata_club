# Handoff — represented-person account flow delivery

This change is delivered as a compact, automatic chain of **7 implementation PRs** (600–900 target changed lines each, hard stop 1,000). The tracker is #1164; PR 1 is open as #1165. This document is the next session's startup point; slice boundaries and validation commands live in `tasks.md`.

## Quick path

1. Create the PR 2 worktree/branch from PR 1's head (`501119d` on `fix/represented-person-audit-foundation`), named per `CLAUDE.md` convention (e.g. `fix/represented-person-credential-capability`), in a dedicated worktree under the repository worktree directory (e.g. `pi-1137-pr2`).
2. Salvage only the existing-person credential + `REPRESENTANTE` capability hunks from the local WIP (see warning below) into that branch; leave the rest of the WIP untouched for PR 3.
3. Run the automatic loop per slice (below). PR boundaries, acceptance, TDD evidence, focused/runtime validation, and rollback per slice are in `tasks.md`.

## Delivery state

| Unit | Branch | State |
|---|---|---|
| Tracker #1164 | — | Draft/no-merge: https://github.com/AlejandroTatum/cata_club/pull/1164 |
| PR 1 — audit/idempotency foundation | `fix/represented-person-audit-foundation` | Open for review: https://github.com/AlejandroTatum/cata_club/pull/1165 |
| PR 2 — credential + capability primitives | new branch off PR 1 head | Not started; salvage source exists |
| PR 3 — independence vertical cutover | after PR 2 | Not started; remaining WIP hunks feed it |
| PR 4–7 | after predecessor | Not started |
| Replan artifacts (this change) | `fix/represented-person-account-flow`, worktree `pi-1137-plan` | Replanned `config.yaml`, `project.md`, `proposal.md`, `design.md`, `tasks.md`; new `handoff.md` |

## Local WIP salvage warning

- Worktree `/home/alejo/devwork/apps/cata_club-worktrees/pi-1137`, branch `fix/represented-person-independence`, based exactly on PR 1's head (`501119d`); all PR 2/3 work is uncommitted (13 files, ≈+1,279/−101 per `git diff --stat`).
- This slice is monolithic and **NOT publishable whole**. The earlier size exception for it is superseded by this replan; never open or push it as one PR.
- Salvage by work unit: PR 2 takes the auth/role credential+capability hunks (`backend/app/servicios_negocio/auth_servicio.py`, `rol_servicio.py` and their tests); PR 3 takes the independence cutover (`relacion_representacion_servicio.py`, `personas_router.py`, `dtos/persona_schemas.py`, `persona_servicio.py`, `test_independencia_representada.py`, removal of `test_independizar.py`).
- Do not reset, discard, or stage the WIP wholesale. Do not carry its stale `openspec/.../tasks.md` and `apply-progress.md` edits into PRs 2–3; this replan supersedes them, and reconciliation belongs to parent housekeeping.
- One writer per worktree; do not run parallel writers against `pi-1137` and the new PR 2 worktree simultaneously.

## Automatic loop (per slice)

implement/TDD → focused validation → independent verification → native review when applicable → commit/push/open chained PR. No routine workflow questions between slices.

Stop only for:

- genuine product ambiguity,
- destructive production action,
- a failed required gate,
- a severe review finding,
- conflict/drift with `main` or the chain parent,
- a slice that would exceed 1,000 changed lines.

## Commands and status checks (no tokens, no provider state)

```bash
# Worktree/branch state
git worktree list
git -C /home/alejo/devwork/apps/cata_club-worktrees/pi-1137-plan status && \
  git -C /home/alejo/devwork/apps/cata_club-worktrees/pi-1137-plan log --oneline -5
git -C /home/alejo/devwork/apps/cata_club-worktrees/pi-1137 status && \
  git -C /home/alejo/devwork/apps/cata_club-worktrees/pi-1137 diff --stat

# Salvage inspection (read-only)
git -C /home/alejo/devwork/apps/cata_club-worktrees/pi-1137 diff -- \
  backend/app/servicios_negocio/auth_servicio.py \
  backend/app/servicios_negocio/rol_servicio.py

# Backend test database (single tenant, port 5436; isolate before parallel runs)
make test-backend-preflight

# Focused validation examples (per-slice commands in tasks.md)
cd backend && uv run pytest tests/test_auth.py tests/test_roles.py -q

# One pre-PR lane per child before pushing
make pre-pr LANE=backend   # or frontend|integration|full per surface

# PR state (ambient gh auth; or open the URLs in a browser)
gh pr view 1164 --json state,isDraft,mergeable
gh pr view 1165 --json state,mergeable,reviewDecision
```

## Non-goals for the next session

- No production remediation execution (PR 7 builds the gate only).
- No #1135 work; no production configuration changes; no force-pushes.
- No edits to `specs/**` from this replan; product scope is unchanged.
