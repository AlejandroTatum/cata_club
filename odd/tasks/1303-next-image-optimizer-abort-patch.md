# 1303 — Backport the Next image optimizer aborted-request fix

Issue: https://github.com/AlejandroTatum/cata_club/issues/1303
Branch: `fix/next-image-optimizer-abort-patch` (worktree `cata_club-worktrees/fix-1303`, base `aaca138`)

## Objective
Self-hosted `next start` must survive the FIRST requester of a cold `/_next/image` key disconnecting mid-transfer, for every optimized image, without depending on the hero warm-up.

## Problem / why
`fetchInternalImage` in `next/dist/server/image-optimizer.js:953` builds the mocked internal response with `socket: _req.socket`; `send` watches that socket via `on-finished` and tears the stream down when the requester aborts, so `mocked.res.hasStreamed` never settles and the coalesced `ResponseCache` key hangs until restart. Upstream fix vercel/next.js#98168 (commit `dcbfff778`) is only in `16.4.0-canary.27+`; installed is `15.5.25`.

## Scope
- `frontend/patches/next@15.5.25.patch` (pnpm patch, only the `fetchInternalImage` hunk, header cites `dcbfff778`)
- `frontend/package.json` (`pnpm.patchedDependencies`), `frontend/pnpm-lock.yaml`
- `frontend/Dockerfile` (copy `patches/` before `pnpm install --frozen-lockfile`)
- `frontend/tests/e2e/hero-image-optimizer-abort.spec.ts` and whatever makes it independent of the warm-up (`tests/e2e/global-setup.ts`, `src/instrumentation.ts`)
- The warm-up stays as defense in depth (decision: keep; smaller diff, no behavior removed).

## Constraints
- TDD: on (strict TDD mode, session config). Runner: `pnpm exec playwright test` for the e2e spec; `pnpm test` (Vitest) for unit tests.
- Delivery: single PR, squash auto-merge, `Closes #1303`.
- Pre-PR lane: `make pre-pr LANE=frontend`.
- No AI attribution trailers in commits or PR body.

## Tasks
- [x] T1 — Patch `next` with `pnpm patch`: `MockedRequest({url, method, headers: {}, socket: _req.socket})` + `MockedResponse({maximumResponseBody})`; `pnpm install --frozen-lockfile` applies it; Dockerfile copies `patches/`; `.next/standalone` contains the patched file. Evidence: RED (warm-up disabled, no patch) → GREEN (warm-up disabled, patch) for `hero-image-optimizer-abort.spec.ts`.
- [x] T2 — Make `hero-image-optimizer-abort.spec.ts` independent of the warm-up (no reliance on global-setup warm state), run `make pre-pr LANE=frontend`, open PR `Closes #1303` with auto-merge squash.
- [x] T3 — Correction (native review WARNING, PR #1304): the `q=91` decoupling from T2 was NOT sufficient — under the config CI actually runs (shared server, full warm-up ENABLED), the spec passed vacuously on both patched and unpatched `next`. Made the spec boot its own isolated, cold copy of the standalone build instead of sharing the suite's server; rewrote the doc comment to state only what was measured; tightened the `HERO_WARMUP_DISABLED` guard to an opaque token so a stray value can't disable it in a real deployment.

## Acceptance criteria
1. Patch limited to the `fetchInternalImage` hunk, upstream commit cited in the patch header. ✅
2. Spec RED without patch and warm-up, GREEN with patch and without warm-up (both observed and recorded below). ✅
3. `pnpm install --frozen-lockfile` and the Docker build apply the patch. ✅

## Delivery
Strategy: `ask-on-risk`. Forecast: ~150 authored changed lines (patch file + package.json + Dockerfile + spec/setup). RDD: on (global) — candidate is the work-unit commit, assessed after commit.

## Progress / evidence

### Investigation: the race is much narrower than expected
Empirically, `fetchInternalImage`'s abort race is highly sensitive to how
"warmed" the `/_next/image` route already is (JIT tiering, OS page-cache
for the source file), not only to whether the exact `(url,w,q)` cache key
was pre-populated. A handful of manual trials against an unpatched
`node .next/standalone/server.js`:
- Zero prior requests to the server: never hung (5/5 clean).
- After the suite's full hero warm-up (~27 requests): never hung, even on
  a cache key the warm-up never touches (`q=91` instead of `q=90`).
- After exactly one small unrelated priming request (e.g. the suite's own
  `/api/auth/session` probe) and an immediate abort (0–8 ms): hung
  reliably in repeated trials.

This means the spec needs two independent, complementary changes to stay
meaningful: (a) target a cache key the warm-up never populates (`q=91`,
avoids a vacuous cache-hit pass), and (b) a `HERO_WARMUP_DISABLED=1`
switch (`global-setup.ts`, `instrumentation.ts`) to reproduce the race
for verification — the *full* warm-up makes the route too "hot" to hit
the same race reliably. The warm-up itself is untouched and still runs
in every real deployment and in every other e2e spec.

### T1 evidence
- RED: unpatched `next`, standalone server started as
  `HERO_WARMUP_DISABLED=1 PORT=3450 HOSTNAME=127.0.0.1 node .next/standalone/server.js`,
  spec run as `HERO_WARMUP_DISABLED=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:3450 pnpm exec playwright test tests/e2e/hero-image-optimizer-abort.spec.ts --project=chromium`
  → 1 failed, `the #1300 hang reproduced` assertion fired.
- Patch created: `pnpm patch next@15.5.25` → edited
  `dist/server/image-optimizer.js` → `pnpm patch-commit` →
  `frontend/patches/next@15.5.25.patch`, `pnpm.patchedDependencies` in
  `package.json`, `pnpm-lock.yaml` updated.
- `pnpm install --frozen-lockfile` → succeeds, `node_modules/next/dist/server/image-optimizer.js`
  contains `new _mockrequest.MockedResponse`.
- GREEN: same reproduction steps as RED, patched `next`, port 3460/3470/3480
  → all passed (3 repeat trials at different abort delays, 0/2/5 ms).
- Docker: `docker build --network host -t cata_club-frontend-patchcheck:test .`
  (same args as `docker-compose.override.yml`) → succeeds; `docker run --rm
  --entrypoint sh cata_club-frontend-patchcheck:test -c 'grep -c "new
  _mockrequest.MockedResponse" /app/node_modules/next/dist/server/image-optimizer.js'`
  → `1`. Test image removed after verification.

### T2 evidence
- Spec rewritten: `q=91` (outside the warm-up's `q=90`), `ABORT_AFTER_MS = 2`
  restored to the original evidenced value, doc comment rewritten to explain
  why the test no longer depends on cache state.
- Full suite the way CI runs it: `CI=true pnpm exec playwright test` (patch
  present, warm-up ENABLED, default/no env switch) → 218 passed, including
  this spec — confirms the merged, real-world configuration is unaffected.
- `pnpm test` (Vitest, unrelated to this change — no source file under
  `src/**/*.test.ts(x)` imports `instrumentation.ts` or the e2e spec) →
  5107/5107 passed (300/300 files), 331.51s with coverage.
- `make pre-pr LANE=frontend` from the worktree root → `pnpm audit` (1
  pre-existing moderate, non-blocking at `--audit-level=high`),
  `pnpm type-check` clean, `pnpm lint` clean (1 pre-existing unrelated
  warning on `src/app/sponsors/page.tsx`), `pnpm run test:coverage`
  5107/5107 passed (statements 90.06%, branches 85.95%, functions
  90.98%, lines 91.97% — all above the configured thresholds),
  `pnpm build` succeeded, `pnpm exec playwright test` 218/218 passed
  (3.2m, local single-worker mode, patch present, warm-up ENABLED —
  default configuration). Exit code 0.
- Commits, PR URL, and final check outcomes: see the writer's final report.

### T3 evidence — correction (native review WARNING)

**Finding**: the native reviewer approved PR #1304 but flagged that, in the
configuration CI actually runs (`HERO_WARMUP_DISABLED` unset, shared server,
full hero warm-up ENABLED), `hero-image-optimizer-abort.spec.ts` did not
discriminate a patched `next` from an unpatched one — it passed vacuously
either way. The spec's own doc comment claimed it "fails the same way with
the warm-up left fully enabled", which the T2 evidence above already
contradicted (`CI=true pnpm exec playwright test` passed 218/218 on the
UNPATCHED-then-repatched sequence was never actually run under T2 — only
patched — so the gap went unnoticed until the reviewer's own assessment and
a fresh unpatched trial confirmed it).

**Fix**: the spec now boots its OWN isolated, cold copy of the exact
`.next/standalone` build the suite already produced — `cp -al` (hardlinks,
instant) into a scratch dir NEXT TO `.next/standalone` (same filesystem,
required for hardlinks to work; the OS tmpdir is frequently a different
mount and fails with "cross-device link"), `.next/cache` deleted from the
copy only, then `node server.js` on a free port with `HERO_WARMUP_DISABLED`
set to an opaque token. One priming request (`GET /api/auth/session`) before
the abort+identical-request sequence, matching the exact condition measured
necessary. `global-setup.ts`'s `HERO_WARMUP_DISABLED` guard (T2, now
unnecessary — nothing needs to disable the SHARED server's warm-up anymore)
was reverted. `instrumentation.ts`'s guard is kept (the isolated child is
still a full standalone build that runs its own `register()` hook) but now
requires the exact token `only-for-hero-image-optimizer-abort-spec` instead
of a generic `"1"`, addressing the reviewer's SUGGESTION that a stray value
in a real deployment's env could otherwise disable it.

**RED/GREEN, plain command, no manual env vars** (`CI=true` only, matching
what GitHub Actions itself sets):
- GREEN (patch present): `CI=true pnpm exec playwright test tests/e2e/hero-image-optimizer-abort.spec.ts` → 1 passed, 4 repeat trials (3.4s–8.9s each).
- RED (patch manually reverted in both `node_modules/next` and
  `.next/standalone/node_modules/next` — restored afterward via
  `pnpm install --frozen-lockfile --force` + `pnpm build`, `git status`
  confirmed clean except the 3 intended tracked files throughout): same
  command → 1 failed both trials, each failing its initial attempt AND
  CI's own retry (4/4 individual attempts hung, 2/2 full trials red).
- Full suite: `CI=true pnpm exec playwright test` (patch present) → 218
  passed (1.7m, 4 workers).
- `make pre-pr LANE=frontend`: audit (1 pre-existing moderate, non-blocking),
  type-check clean, lint clean (1 pre-existing unrelated warning), coverage
  5107/5107 passed (thresholds met), build succeeded, `pnpm exec playwright
  test` 218/218 passed (3.5m, local single-worker mode). Exit code 0.

**Not done**: guarding `instrumentation.ts`'s switch against `NODE_ENV`
instead of a token — a production standalone build (including this spec's
own isolated child) does not reliably carry a non-"production" `NODE_ENV`
at runtime, so that guard would have blocked the spec's own reproduction
too. The opaque-token guard achieves the same practical protection (no
plausible accidental deployment value collides with it) without that risk.

## Next step
Done — see final report for PR URL and delivery state.
