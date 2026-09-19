# 1335 — Comprobantes review follow-ups: honest overwrite comment, real-SDK overwrite test, hash invariant

Issue: https://github.com/AlejandroTatum/cata_club/issues/1335
Branch: `chore/1335-comprobantes-review-followups` (worktree `cata_club-worktrees/gentleman-1335`, cut from `origin/main` @ eab88c1)
Delivery strategy: single PR, squash auto-merge (forecast ~150 changed lines, comments + docstring + tests only, no production behavior change)
TDD: **on** (strict, session config). Runner: `cd backend && TEST_DATABASE_URL=postgresql+psycopg://usuario:password@localhost:5436/cataclub_test uv run pytest <file>` (db-test on `localhost:5436`, single-tenant; never two backend suites at once). This session's sandbox blocks the loopback DB port; every pytest invocation ran with the sandbox disabled for that one command.
RDD: on (global). Candidate = the work-unit commit; the orchestrator runs native review after this report.

## Objective

Close the three advisory findings (R3-001, R3-002, R3-003) from the native review of the PR that closed #1327. All three are advisory/documentation/test-coverage items; none requires a production behavior change.

## Findings (from the issue)

- **R3-001** (`comprobante_tareas.py:148-156`) — the comment above `subir_pdf_membresia(pdf_bytes, public_id, sobreescribir=True)` promises a visible WARNING via `existing=true` on a foreign collision, but Cloudinary only reports `existing` when `overwrite=False`; with `overwrite=True` that detection can never fire.
- **R3-002** (`test_pago_comprobante_atomico.py:541-543`) — no test drives `overwrite=True` to the real Cloudinary SDK call; the only assertion is on the kwarg of a mocked `subir_pdf_membresia`.
- **R3-003** (`comprobante_tareas.py:84-86`) — `fecha_validacion.isoformat()` goes straight into the hash; safe today only because the id is computed once from the loaded row and persisted, never recomputed — that invariant was not documented.

## Design decisions (orchestrator, already taken before delegation)

- **R3-001, option (b)**: keep `overwrite=True`, fix the comment — do NOT switch to `overwrite=False` + hard-error on `existing`. Reason (verified in code): `generar_comprobante_pdf_tarea` has `autoretry_for=(Exception,)`, `retry_backoff=True`, `max_retries=5`; `reconciliar_comprobantes_faltantes` also re-fires it via `.delay()`. A retry after "upload succeeded but the `ComprobantePago` commit failed" re-uploads the SAME deterministic `public_id`. With `overwrite=False` that retry would die with a hard SDK error on `existing=true`, turning every such retry into a permanent failure for that payment — worse than the current silent-overwrite residual risk, which is already bounded by `fecha_validacion` being part of the hash.
- **R3-003, option (i)**: document the invariant in `public_id_comprobante`'s docstring and add a test that pins "persisted `archivo_url` == `public_id_comprobante(pago)`, not recomputed on a second run" — not option (ii) (normalizing the hash input to UTC without microseconds). (i) is the smaller change and carries zero risk of changing `public_id`s already persisted in staging/prod; (ii) would require proving nothing persisted depends on the current hash, which is unnecessary work for a residual risk that (i) already documents and pins.
- `reconciliar_comprobantes_faltantes`'s docstring was checked line by line (issue asked to fix it "if it still implies detection"): it does not claim collision detection — it only says a redispatch overwrites instead of duplicating, which is accurate. No change made there.

## Scope (authorized)

- Edit: `backend/app/infraestructura/tareas/comprobante_tareas.py` (comment + docstring only, no logic change), `backend/tests/test_cloudinary_cliente.py`, `backend/tests/test_pago_comprobante_atomico.py`.
- No production behavior change anywhere; no new dependencies; comments/docstrings in Spanish, matching the existing files; new tests in English identifiers per repo convention (existing test files use Spanish function names — matched existing file style instead, see Evidence T2/T3).
- `odd/tasks/1335-comprobantes-review-followups.md` (this file).

## Tasks

- [x] T1 (R3-001): rewrite the comment above `subir_pdf_membresia(..., sobreescribir=True)` to state honestly that this call site has no collision detection with `overwrite=True`, and why (b) was chosen over (a). Verified `reconciliar_comprobantes_faltantes`'s docstring needs no change.
- [x] T2 (R3-002): two new tests in `test_cloudinary_cliente.py` — `sobreescribir=True` → `overwrite=True` reaches the real-SDK-shaped call (`cloudinary.uploader.upload` mocked at the SDK boundary, same pattern as the rest of the file); default `sobreescribir=False` → `overwrite=False`.
- [x] T3 (R3-003): documented the "computed once, persisted, never recomputed" invariant in `public_id_comprobante`'s docstring; added `test_public_id_comprobante_persistido_no_se_recalcula_en_segunda_corrida` in `test_pago_comprobante_atomico.py`, which spies on `public_id_comprobante` to prove it is not called again on a second run (the deterministic hash would otherwise mask a "recomputed but happens to match" bug).
- [x] T4: verification — focused files green, then `make pre-pr LANE=backend`; one work-unit commit for the whole follow-up (comment+docstring+tests form a single logical change closing the three advisory findings).
- [ ] T5 (orchestrator, not this writer): native review on the commit, push, PR `Closes #1335` with squash auto-merge, post-merge main green, housekeeping.

## Acceptance criteria

- A real collision no longer has a comment overpromising detection; the comment states the actual behavior and the (b) reasoning.
- A test drives `overwrite` from `subir_pdf_membresia` to the real SDK call boundary for both `True` and the `False` default.
- `public_id_comprobante`'s "computed once, persisted" invariant is documented and pinned by a test that fails under mutation.
- `backend/tests/test_cloudinary_cliente.py` + `backend/tests/test_pago_comprobante_atomico.py` green against db-test; backend lane green.
- No behavior change to any persisted `public_id` or to the Cloudinary upload call shape.

## Evidence

### T1 (R3-001)

- Comment-only change: no RED/GREEN cycle applies (per brief, the check is a readback). Readback quoted below (current `comprobante_tareas.py:161-186`):

  > `# Decisión (issue #1335, R3-001): se mantiene overwrite=True en vez de pasar a False + tratar existing=true como colisión real. Con autoretry_for=(Exception,), un reintento tras "la subida terminó pero el commit del ComprobantePago falló" vuelve a subir el MISMO public_id -- con overwrite=False esa subida moriría con un error duro del SDK y convertiría cada reintento legítimo en un fallo permanente para ese pago.`
  >
  > `# Este overwrite=True significa que, a diferencia de otros callers de subir_pdf_membresia, ACÁ NO hay detección de colisión: el SDK solo informa existing=true -- y por lo tanto el WARNING que deja subir_pdf_membresia (ver su docstring en cloudinary_cliente.py) -- cuando overwrite=False.`

  `reconciliar_comprobantes_faltantes`'s docstring (`comprobante_tareas.py:231-248`) was re-read; it claims only "overwrites instead of duplicating", never detection — left unchanged.

### T2 (R3-002)

- **RED**: not applicable in the classic sense — the production kwarg (`"overwrite": sobreescribir` in `subir_pdf_membresia`, `cloudinary_cliente.py:354`) was already correct; this finding is a test-coverage gap, not a bug. To prove the new tests are real guards (not tautologies), the kwarg was mutated to `"overwrite": False` (hardcoded) and the suite re-run:
  `TEST_DATABASE_URL=... uv run pytest tests/test_cloudinary_cliente.py -q -k "overwrite_true_al_sdk or overwrite_false_al_sdk_por_default"` → `1 failed, 1 passed` (`test_pdf_con_sobreescribir_true_pasa_overwrite_true_al_sdk` failed as expected; the default-False test still passed, correctly, since the mutation happened to match the default). Reverted immediately.
- **GREEN** (real code): same command → `2 passed, 94 deselected`.
- New tests: `test_pdf_con_sobreescribir_true_pasa_overwrite_true_al_sdk`, `test_pdf_sin_sobreescribir_pasa_overwrite_false_al_sdk_por_default` in `backend/tests/test_cloudinary_cliente.py`, both calling the real `cc.subir_pdf_membresia` with `cloudinary.uploader.upload` mocked at the SDK boundary (same `_parchear_upload()` pattern as the rest of the file).

### T3 (R3-003)

- **RED**: mutation test — temporarily changed the early-return branch of `generar_comprobante_pdf_tarea` (`pago.comprobante` already set) to return `public_id_comprobante(pago)` (recomputed) instead of the persisted `pago.comprobante.archivo_url`. Ran:
  `TEST_DATABASE_URL=... uv run pytest tests/test_pago_comprobante_atomico.py -q -k "persistido_no_se_recalcula"` → `1 failed` (`AssertionError` on `len(llamadas) == 1`, spy saw 2 calls). Reverted immediately.
- **GREEN** (real code): same command → `1 passed, 13 deselected`.
- Docstring of `public_id_comprobante` (`comprobante_tareas.py:78-90`) now states the invariant explicitly: computed once from the loaded row inside `generar_comprobante_pdf_tarea`, persisted as `ComprobantePago.archivo_url`, never recomputed — a second run for the same pago takes the `pago.comprobante` early-return branch and reuses the persisted value.
- New test `test_public_id_comprobante_persistido_no_se_recalcula_en_segunda_corrida` in `backend/tests/test_pago_comprobante_atomico.py`: spies on `ct.public_id_comprobante` (module-level monkeypatch, effective because the task calls it unqualified — same-module global lookup), runs the task twice for the same pago, asserts the spy was called exactly once and the persisted `archivo_url` matches.

### T4 — Focused suite + `make pre-pr LANE=backend`

- Focused: `TEST_DATABASE_URL=... uv run pytest tests/test_cloudinary_cliente.py tests/test_pago_comprobante_atomico.py -q` → `110 passed, 1 warning`.
- `make pre-pr LANE=backend`: see command output quoted in the final report to the orchestrator.

### T5 — Native review (RDD)

- Not run by this writer. Deferred to the orchestrator per the brief ("Do NOT ... run any `gentle-ai review` command").
