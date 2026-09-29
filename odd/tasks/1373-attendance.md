# #1373 attendance — responsive six-state selector row

User visual feedback on the #1373 preview (3396): with sick/competition added, the
roster's state picker is `grid-cols-3` at every width, so desktop shows a 2×3 block
and rows read as too tall. Wanted: all SIX state selectors in ONE horizontal row on
desktop; narrower devices keep a fully visible ergonomic layout (3×2). Do not
reintroduce the old `sm:h-12` clipping; keep 44px touch targets, meaningful labels,
keyboard radiogroup behavior, and student-name visibility. Local preview correction
only — no commit/push/PR.

## Tasks

- [x] RED — focused regression: radiogroup carries base `grid-cols-3` + `lg:grid-cols-6`,
      no intermediate `sm|md:grid-cols-*` rewrap, six named radios present.
- [x] GREEN — `AttendanceRosterRow` radiogroup: `grid-cols-3 lg:grid-cols-6`; comments updated.
- [x] Focused checks — AttendanceRosterRow tests, touch-target guard, TrainerAttendancePage
      tests, `tsc --noEmit`.
- [x] Production build + verified 3396 restart (stop → build → same command line; verify
      serving; 3395/8000/5436 untouched).
- [x] Batched Playwright geometry (isolated session, all API mocked, writes blocked):
      1920/1280 six radios share one row band inside row bounds, no horizontal overflow,
      first+sixth clicks work; 390/320 keep a fully visible layout, no overflow.
- [x] Close: tracker + Engram updated. No commit (explicitly out of scope).

## Evidence

- 2026-09-23: Tracker created before first source write. Incumbent confirmed in this
  worktree: six states (`Enfermo`, `Competencia`), radiogroup `grid-cols-3` always → 2×3
  desktop block; `sm:h-12` already removed by the earlier #1373 clipping fix and must stay
  gone. Existing focused suite: `__tests__/AttendanceRosterRow.test.tsx` (3 tests, green).
- 2026-09-23: RED observed — new test failed with `expected 'grid w-full grid-cols-3 …' to
  contain 'lg:grid-cols-6'`; the three incumbent tests stayed green.
- 2026-09-23: GREEN observed — one-class change (`lg:grid-cols-6` appended) + comment
  updates; focused file now 4/4 (never-clips guard still bans fixed heights; radiogroup
  contract untouched).
- 2026-09-23: Focused checks — `AttendanceRosterRow.test.tsx` 4 passed;
  `touch-target-usage.test.ts` 7 passed (roster-row @touch-target entry intact);
  `TrainerAttendancePage.test.tsx` 129 passed; `tsc --noEmit --incremental false` exit 0.
- 2026-09-23: Preview 3396 rebuilt and restarted: old process (pid 1343779, cwd this
  worktree's frontend) stopped with TERM, `pnpm build` ok, restarted with the same
  `next start -H 127.0.0.1 -p 3396` line and env; BUILD_ID `gbZz79daqnV009QCMkQa8` →
  `kXzlUJv27P0bX0i7SIRmv`; `/login` 200, `/trainer/attendance` 307 (expected
  unauthenticated bounce). 3395, 8000, 5436 never touched. Server log:
  `frontend/.next/preview-3396.log`.
- 2026-09-23: Batched Playwright geometry (isolated contexts, every API route mocked,
  non-GET blocked and counted → 0 writes; screenshots in `frontend/.next/preview-3396-shots/`):
  - 1920 & 1280: `bandCount 1` — present/absent/late/justified/sick/competition all in ONE
    row, each 73×44px, all six text labels visible, row width 714 inside the `max-w-3xl`
    card, `scrollWidth == innerWidth` (no horizontal overflow).
  - 1024 (lg boundary, bonus): identical single row of six, labels visible.
  - 390: 3×2 wrap (bands of 3), cells ≈100.7×44, no overflow. 320: 3×2, cells 77.3×44,
    no overflow. Below lg labels stay sr-only by design (title + accessible name intact).
  - First (Presente) and sixth (Competencia) clicks applied state on Ana López's row in
    every viewport; zero non-GET requests reached the API layer (no DB submission).

## E2E verification — isolated stack (sick/competition, real backend)

Parent-authorized end-to-end verification of #1373 ENFERMO/COMPETENCIA through the real UI,
using only disposable isolated resources. No production, no shared db-test (5436), no 8000,
no 3395/3396 previews. No source edits; no commit/push/PR.

- [x] Isolated disposable Postgres 16 on 127.0.0.1:5437 + disposable Redis on 6397 (fresh
      random creds; ownership-checked ports first; IDs tracked in /tmp/cata1373-e2e/).
- [x] Isolated backend (this worktree) on 127.0.0.1:8001: fresh random JWT_SECRET_KEY,
      AMBIENTE=development, Alembic upgrade head → r1373asis, documented seed_dev_base
      (trainer + students + schedules + alumno_horario assignments).
- [x] Isolated frontend production build from a disposable /tmp copy of this worktree's
      frontend (node_modules symlinked read-only; `.env*` excluded; NEXT_PUBLIC_USE_MOCKS=false,
      BACKEND_API_URL=http://127.0.0.1:8001/api/v1) served on 127.0.0.1:3397. 3396 untouched
      (it is `next start` pid 1410077 serving this worktree's .next — no in-place build).
- [x] Playwright real login (entrenador@cataclub.com) on 3397 → open schedule → real UI:
      student A = Enfermo, student B = Competencia, rest Presente → Revisar y confirmar →
      Confirmar asistencia → receipt.
- [x] Assert persistence: backend API (persona history + ultimas-listas), isolated DB rows,
      and UI after reload (closed-slot state, history page). No API mocking.
- [x] Evidence recorded here; stack left running if healthy; cleanup commands documented.

### Evidence (2026-09-28, club TZ)

- Ports ownership-checked free before start: 5437, 6397, 8001, 3397. Forbidden services
  re-verified healthy/untouched after the run: 3396 (200), 3395 (200), 8000 (200), db-test
  5436 container `cata_club-db-test-1` running. No tracked file mutated (only this tracker;
  frontend build happened in a disposable /tmp copy, not in `frontend/.next`).
- Isolated resources: pg container `cata1373-e2e-pg` (005fc040254d…, 127.0.0.1:5437), redis
  container `cata1373-e2e-redis` (9971bca015a3…, 127.0.0.1:6397); backend uvicorn pid
  1521802 (wrapper 1521796) on 127.0.0.1:8001, `/health/ready` 200; frontend next-server pid
  1527144 on 127.0.0.1:3397, BUILD_ID `Orpw5W2T1OUoLynCHbmpr` (3396 keeps
  `kXzlUJv27P0bX0i7SIRmv`). Secrets: random, never printed, in /tmp/cata1373-e2e (chmod 600).
- Migration E2E: `alembic upgrade head` → `r1373asis (head)` (down: r1372galeria) on the
  isolated DB; documented seed `scripts/seed_dev_base.py`: trainer + 26 horarios + 75
  asignaciones alumno_horario.
- Real UI run (Playwright chromium, viewport 1440×900, zero route mocks): login form →
  /trainer/attendance → Monday accordion → slot 15:00 — 16:00 (FORMATIVO, id 1, 4 alumnos:
  Ana Garcia, Luis Lopez, Diego Mendoza, Sofia Vera) → radios: Ana=Enfermo, Luis=Competencia,
  Diego/Sofia=Presente (each `aria-checked=true` observed) → Revisar y confirmar →
  Confirmar asistencia → receipt mentions Enfermo/Competencia.
- Persistence asserted in 3 layers: (1) API — GET /asistencias/persona/8 → 2026-09-28
  ENFERMO; persona/9 → COMPETENCIA; GET /asistencias/ultimas-listas → horarioId 1, presentes
  2, justificados 2, ausentes 0, total 4. (2) DB — isolated psql rows: persona 4/7 PRESENTE,
  8 ENFERMO, 9 COMPETENCIA (fecha 2026-09-28, horario 1). (3) UI after reload — taken slot
  correctly `disabled` ("lista cerrada"), /trainer/attendance/history shows "28/09/2026
  Lunes 15:00 — 16:00 … 2 presentes, 0 tardanzas, 0 justificados, 1 enfermo, 1 competencia,
  0 ausentes", dashboard shows period aggregates (asistencia del mes 50%, 1 lista tomada).
- Artifacts (disposable): /tmp/cata1373-e2e/shots/01…08*.png, receipt.txt, history.txt,
  dashboard.txt, e2e.cjs, e2e-post.cjs.
- Stack left RUNNING for user review: http://127.0.0.1:3397 (entrenador@cataclub.com /
  trainer12345). Cleanup when done:
  `kill $(cat /tmp/cata1373-e2e/frontend.pid) $(cat /tmp/cata1373-e2e/backend.pid) 1521802 2>/dev/null; docker stop cata1373-e2e-pg cata1373-e2e-redis; docker rm cata1373-e2e-pg cata1373-e2e-redis; rm -rf /tmp/cata1373-e2e`

## Skipped gates (local-only correction, no delivery)

- `make pre-pr` lanes and CI: not run — user-approved local preview correction only; delivery
  explicitly out of scope for this task.
- E2E verification session: no lanes/CI run (verification-only task; no delivery).

## Pre-PR full-lane validation (delivery gate for #1373 commit/push/PR)

Command: `make pre-pr LANE=full` (exactly one candidate run + one corrected run after a
harness-only failure). Isolation: ephemeral Compose overlay OUTSIDE the repo
(`/tmp/gentleman-1373-attendance-compose-override.yml`, since removed) binding ONLY
db-test to `127.0.0.1:5456:5432`; `COMPOSE_FILE` = base + overlay (dev override with
5436/3000/8000 ports deliberately omitted); `TEST_DATABASE_URL` =
`postgresql+psycopg://usuario:password@127.0.0.1:5456/cataclub_test` (matches rendered
config); project name `gentleman-1373-attendance` (worktree basename derivation).
Rendered-config proof before run: single host binding db-test 5456; no shared named
volumes (db-test is tmpfs; project-prefixed volumes otherwise).

- Run 1 (env leaked `COMPOSE_PROJECT_NAME` into root contract tests): FAILED only
  `tests/test_docker_compose_config.py::test_el_entorno_de_qa_usa_su_propio_nombre_de_proyecto`
  — my env var outranked `name: cataclub-qa` in docker-compose.qa.yml (Compose precedence
  env > file `name:`). Classified: deterministic, harness-induced, NOT candidate-caused
  (candidate touches no compose/Makefile/qa files). Backend suite had already passed.
- Run 2 (corrected: no `COMPOSE_PROJECT_NAME`; derived name identical): **GREEN,
  MAKE_EXIT=0**. guard-secrets ✓; ruff ✓; lint-imports ✓; pip-audit ✓; age ✓; preflight
  (db-test Started→Healthy on 5456) ✓; backend pytest **2827 passed, 3 skipped**;
  root tests **618 passed, 1 skipped**; frontend vitest **302 files / 5082 tests passed**;
  frontend build ✓; Playwright E2E **202 passed** (incl. trainer-attendance-selector/
  correction/overlap specs). Full logs: /tmp/gentleman-1373-full-lane-run{1,2}.log.
- Side-effect audit: `git status --porcelain` byte-identical before/after; docker diff shows
  only owned `gentleman-1373-attendance-db-test-1` (Created→healthy→removed after run) + its
  project network; 5436 (`cata_club`), 5437 (`cata1373-e2e-pg`), 6397, 8000, 3000 untouched
  and still healthy; 5456 released after cleanup; E2E managed server port 3390 released.
- CI gates not reproduced locally (per Makefile echoes vs .github/workflows/ci.yml):
  `migraciones-desde-cero` (empty-DB alembic job) and `docker-images` (production image
  build/boot/diagnostics + GHCR publish); `cambios` path-filter job is CI orchestration.
  Full lane locally DID reproduce guard-secretos, backend job checks, root-level tests,
  frontend job checks (audit/type-check/lint/coverage/build/E2E).
