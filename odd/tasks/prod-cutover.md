# Prod cutover: reconvert the staging droplet into production

Decision (2026-10-02): single VPS. The existing staging droplet
(see cata_club-docs operations/deployment.md) becomes production. Persistent staging is
retired; QA runs locally (`make qa-up`) or on on-demand droplets.

Branch: `feat/prod-cutover` (worktree `cata_club-worktrees/prod-cutover`).

## Tasks

- [x] PC-1 Pre-deploy `.env` validator script (fails closed on missing
      `DOMINIO_INDEXABLE`, placeholder secrets, staging leftovers) + tests.
- [x] PC-2 Worker liveness signal for external monitoring without coupling
      the backend container healthcheck/autoheal to Celery + tests.
- [x] PC-3 Single staging-to-production cutover runbook; refresh stale
      staging/prod docs.
- [x] PC-4 Canonical host (`cataclub.com`) + `www` redirect in Caddyfile + tests.
- [x] PC-5 Google-ready SEO: square crest favicons, manifest, OG card,
      runtime robots/sitemap/noindex, SportsClub JSON-LD + tests.

## Evidence

(commit ids recorded per task)

- PC-1: 47b4cf97, 47097aec; native review review-63fcf25fa6385080
  approved + acknowledged (`scripts/ops/check-prod-env.sh`, opt-in wiring via
  `PREFLIGHT_REQUIRE_PRODUCTION_ENV=1`; tests: 141 passed in
  test_prod_env_check.py + test_release_controls.py).
- PC-4: 86664ad4 (`DOMINIO_ALIAS_WWW`, default `www.localhost` = no ACME;
  validator requires `www.$DOMINIO`; 246 passed in the three root test files).
- PC-5: a2652482 (icons, manifest, OG), 5ac9932f (robots, sitemap,
  X-Robots-Tag, `DOMINIO_INDEXABLE` to the frontend), 523e5dc6 (JSON-LD);
  runtime var `DOMINIO_INDEXABLE`; vitest, lint and `next build` green.
- PC-2: 32c6bd40 (`/health/workers` GET+HEAD, bare 200/503, beat task
  `registrar_latido` every 60 s writes a Redis key with 180 s TTL; Caddy exact
  route; no healthcheck/autoheal references it; UptimeRobot 5 min monitor in
  docs/operations/monitoring.md). Follow-ups from the PC-1 review: 4a98e9da
  (`export KEY=` + unparseable-line report by number, production env check
  auto-runs when `DOMINIO == DOMINIO_INDEXABLE` with
  `PREFLIGHT_REQUIRE_PRODUCTION_ENV=1|0` override, staging test isolated,
  marker drift test against the backend list). Tests: 61 backend focused,
  253 root passed.
- PC-3: bc8d9aa3 (`docs/operations/production-cutover.md`; provisioning.md, staging-redeploy.md
  and README refreshed; 89 root tests passed: staging runbook contract, CI paths,
  prod env check).
