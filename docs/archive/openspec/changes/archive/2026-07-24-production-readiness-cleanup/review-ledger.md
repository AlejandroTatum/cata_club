# Review Ledger — production-readiness-cleanup (judgment-day on design)

Review type: judgment-day (two blind judges, convergence model — no refuter fan-out).
Target: `design.md` (post-sdd-phase: design). Round 1.

| id | lens | location | severity | status | evidence |
|---|---|---|---|---|---|
| JA-001 | judgment-day | design.md File Changes (`backend/.env.example \| Create`); explore.md:15; proposal.md:12 | CRITICAL | verified | `backend/.env.example` already exists and is git-tracked (since commit `87b6bfe`, survives to HEAD; confirmed by orchestrator via `git ls-files`). It covers DATABASE_URL, JWT_*, CORS_ORIGENES, REDIS_URL, CLOUDINARY_*, SEED_VOUCHER_BASE_URL, CELERY_HORA_AUTOMATIZACIONES but misses AMBIENTE, APP_NOMBRE, APP_VERSION, SMTP_*, FRONTEND_URL, OPENCODE_API_KEY, CLOUDINARY_CARPETA_FOTOS_PERFIL, CELERY_RESULT_EXPIRA_SEGUNDOS. Design action must be "reconcile/expand tracked file" not "Create"; blind create risks clobbering curated comments. Root cause of the wrong premise: exploration Glob did not match dotfiles. |
| JA-002 | judgment-day | design.md:74-77 (`frontend/.env.example \| Create`) | CRITICAL | verified | `frontend/.env.local.example` already exists and is git-tracked, documenting BACKEND_API_URL, NEXT_PUBLIC_API_URL (uncommented, described as live production var), NEXT_PUBLIC_APP_NAME, NEXT_PUBLIC_USE_MOCKS. Design's plan to create `frontend/.env.example` with NEXT_PUBLIC_API_URL "commented, legacy/build-arg" would leave three contradictory statements about the same variable (existing .env.local.example + frontend/src/app/README.md:16 vs new file vs Dockerfile ARG). `rg process.env.NEXT_PUBLIC_API_URL src` → zero matches (dead in code) — the fix is to reconcile the EXISTING .env.local.example and README wording, not add a parallel file. |
| JB-001 | judgment-day | design.md:80-93 (README decision) | WARNING | info | README staleness is broader than PR #113 residue: `modelos.py` has 21 ORM entities, README lists 18 (missing NivelRanking, AlumnoHorario, Ranking, Notificacion — never documented); routers dir has 11 files, README documents 6 groups (missing geografia, ranking, dashboard, chatbot, enrollment). Literal execution of the design's row-by-row table still leaves an incomplete README. Advisory for tasks/apply: README rewrite should enumerate from the actual code, not patch the diff of #113. |
| JB-002 | judgment-day | design.md:37-49 (coverage decision) | WARNING | info | `@vitest/coverage-v8` must be version-locked to installed vitest (`^2.1.9`); an unpinned `pnpm add -D` would resolve a newer major and fail at runtime with a version-mismatch error. Advisory for tasks/apply: add `@vitest/coverage-v8@^2.1.9`. Self-correcting at CI (loud failure), hence WARNING. |
| JB-003 | judgment-day | design.md:13-24, :125 (lockfile decision) | SUGGESTION | info | Add an explicit "diff-review uv.lock before commit" step. Empirically the regeneration is purely additive in current repo state (JB reproduced: only openai, pytest-cov, coverage, distro, jiter, sniffio, tqdm added; zero version shifts), but the review step is free insurance. |

## Verified-sound claims (both judges, no findings)
- `uv sync` / `uv sync --frozen` installs `[dependency-groups] dev` by default; no CI/Dockerfile flag changes needed (empirically reproduced by both judges independently).
- openai genuinely absent from committed uv.lock; `uv lock --check` fails (also confirmed by orchestrator).
- Backend Settings enumeration in design matches `configuracion.py` exactly; JWT placeholder convention matches `_PLACEHOLDERS_SECRETO`.
- Vitest 2.1.9 / coverage-v8 2.x compatible; coverage artifacts already gitignored; Makefile test path unaffected.
- docs/ux/ safe to commit (no secrets; 5KB/10KB/293KB); spec requirements map 1:1 to design decisions; sequencing and 400-line budget strategy sound.

## Fix round 1 scope (design)
Fix JA-001 and JA-002 in `design.md` only (severity floor: WARNING/SUGGESTION recorded as info, forwarded as advisory context to sdd-tasks, no fix round for them). → Both fixed and verified via scoped re-review.

---

# Round 2 — judgment-day on apply diff (post-sdd-phase: apply)

Target: `git diff main..chore/production-readiness-cleanup` (6 commits). Two blind judges; both converged independently on the two findings below.

| id | lens | location | severity | status | evidence |
|---|---|---|---|---|---|
| JA-101 | judgment-day | `frontend/package.json:14` (`test:coverage`), `.github/workflows/ci.yml:73-74` | CRITICAL | verified | `pnpm run test:coverage` crashes with unhandled `ENOENT: coverage/.tmp/coverage-N.json` and exit 1 — Judge A reproduced on 4 of 5 clean-state runs (incl. pristine checkout); Judge B reproduced once (its JB-101, rated WARNING assuming ephemeral runners). CI step has no `continue-on-error`, so a coverage-tool crash can fail the frontend job — contradicts spec ("Coverage MUST be reported as informational output and MUST NOT fail the build"). Convergent → confirmed. Fix applied: `continue-on-error: true` added to the frontend coverage CI step (`.github/workflows/ci.yml`); `test:coverage` script made self-cleaning (`rm -rf coverage && vitest run --coverage`, `frontend/package.json:14`). Empirically verified: 3 consecutive local runs (absent coverage dir, then stale coverage dir present, then back-to-back) all exited 0, printed the full coverage table, zero ENOENT occurrences. Commit `aed1c87`. |
| JA-102 | judgment-day | `backend/README.md` (Endpoints disponibles, Geografía row) | WARNING | verified | Both judges independently recounted: `geografia_router.py` has 9 route decorators (README says 8); total across 10 routers is 80 (README says 79). Convergent factual error in a doc-accuracy change; trivially fixable in the same round (documented severity-floor exception: two-judge convergence = confirmed verdict synthesis). Fix applied: recounted all 10 routers with `rg -c '^\s*@router\.(get\|post\|put\|patch\|delete)'` (Auth 9, Personas 18, Membresías y Pagos 17, Asistencias 12, Ranking 9, Geografía 9, Ficha Médica 3, Enrollment 1, Dashboard 1, Chatbot 1 = 80, matching all other README figures); corrected Geografía row 8→9 and total 79→80 in `backend/README.md`. Commit `cafdff0`. |
| JB-105 | judgment-day | `backend/.env.example`, `frontend/.env.local.example`, `docs/ux/*` | — | info | INCIDENT AUDIT (python3-append workaround) verdict from both judges: sound — placeholders only, curated entries byte-identical, all 27 Settings fields covered, no corruption, no secrets/PII in docs/ux (293KB HTML included). |

## Verified-sound (round 2, both judges)
Lock purely additive + `uv lock --check`/`uv sync --frozen` pass; Dockerfile/uv 0.8.3 schema unaffected; `@vitest/coverage-v8@^2.1.9` correctly pinned (resolves 2.1.9); README entity(21)/router(10)/test(218) counts exact; zero PR #113 residue; `NEXT_PUBLIC_API_URL` story consistent everywhere; `.gitignore` `coverage/` shadows no tracked file; behavior freeze holds (nothing under backend/app or frontend/src changed except a README); commit hygiene clean; backend 218 passed / frontend 1135 passed, 3 skipped.

## Fix round 1 scope (apply diff)
Fix JA-101 (CI step + script reliability) and JA-102 (README counts). Max 2 fix rounds; scoped re-review on the fix diff only.
