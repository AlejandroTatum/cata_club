# Review follow-ups: #1345 + #1351 (trivial advisory notes)

## Issues

- #1345 — https://github.com/AlejandroTatum/cata_club/issues/1345
- #1351 — https://github.com/AlejandroTatum/cata_club/issues/1351

## Branch

`chore/1345-1351-trivial-review-notes` (worktree
`cata_club-worktrees/gentleman-1345`, off `origin/main`).

## TDD

- Mode: strict (repo default, `CLAUDE.md`).
- Backend runner (#1345, comment-only change): `uv run pytest` via `TEST_DATABASE_URL`
  pointed at the local `db-test` compose service on port 5436 (value not
  pasted here; see `README.md`).
- Frontend runner (#1351): `pnpm vitest run src/app/student/add-dependent`.

## RDD

`gentle-ai review mode status` → on (decided by global). No `gentle-ai review`
command run from this branch per task scope; native review stays with the
orchestrator/PR flow.

## Tasks

### 1. #1345 — reword the SDK-attributed hard-error comment

`backend/app/infraestructura/tareas/comprobante_tareas.py` (~173-176): the
comment wrongly said a retry with `overwrite=False` "moriría con un error
duro del SDK". Cloudinary does not raise on an existing `public_id` with
`overwrite=False` — it returns the existing resource with `existing=true`.
Reworded to state the SDK behavior accurately and attribute the hypothetical
hard error to the application-level treatment of `existing=true` as a
collision (the discarded option (a)).

Evidence:
- `uv run ruff check app/infraestructura/tareas/comprobante_tareas.py` → All checks passed!
- `uv run pytest tests/test_pago_comprobante_atomico.py tests/test_cloudinary_cliente.py -q`
  → 110 passed.

### 2. #1351 — make the "no create error reported" assertion real

`frontend/src/app/student/add-dependent/__tests__/add-dependent-refresh-session.test.tsx`
(~121): the second case only asserted `queryByRole("alert")` is absent, which
passes vacuously (nothing in the wizard renders form errors with
`role="alert"`, and the `showError` toast double was an uncaptured
`vi.fn()`). Captured `showError` and asserted it was not called, plus
asserted the concrete `getAddDependentErrorMessage` text is absent from the
screen.

Evidence (two independent RED proofs, one per new assertion, each reverted
before the next):
- RED 1 — temporarily called `showError(...)` from the `refreshSession`
  catch (kept `router.push` reachable): `shows no submit error for a
  rejected refreshSession` failed at
  `expect(showErrorMock).not.toHaveBeenCalled()` ("expected vi.fn() to not
  be called at all, but actually been called 1 times"); the other case still
  passed. Reverted with `git checkout -- .../page.tsx`.
- RED 2 — temporarily called `setFormErrors([getAddDependentErrorMessage(error)])`
  from the same catch (still let `router.push` run): the same test failed at
  `expect(screen.queryByText(...)).not.toBeInTheDocument()`, with the exact
  fallback copy ("No se pudo agregar el dependiente. Revise los datos
  ingresados e intente nuevamente.") found in the document. Reverted.
- GREEN: `pnpm vitest run src/app/student/add-dependent` → 4 files, 56 tests
  passed, against the real (unmutated) `page.tsx`.

Note: an earlier, coarser mutation (moving `refreshSession()` back inside the
create `try`, reproducing the pre-#1340 bug wholesale) was tried first and
discarded — it fails at the pre-existing `waitFor(pushMock...)` assertion
before reaching either new assertion, so it doesn't isolate what the new
assertions themselves catch.
