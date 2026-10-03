# Prod cutover: reconvert the staging droplet into production

Decision (2026-10-02): single VPS. The existing staging droplet
(104.248.115.57, /opt/cata-club) becomes production. Persistent staging is
retired; QA runs locally (`make qa-up`) or on on-demand droplets.

Branch: `feat/prod-cutover` (worktree `cata_club-worktrees/prod-cutover`).

## Tasks

- [x] PC-1 Pre-deploy `.env` validator script (fails closed on missing
      `DOMINIO_INDEXABLE`, placeholder secrets, staging leftovers) + tests.
- [ ] PC-2 Worker liveness signal for external monitoring without coupling
      the backend container healthcheck/autoheal to Celery + tests.
- [ ] PC-3 Single staging-to-production cutover runbook; refresh stale
      staging/prod docs.
- [x] PC-4 Canonical host (`cataclub.com`) + `www` redirect in Caddyfile + tests.

## Evidence

(commit ids recorded per task)

- PC-1: 47b4cf97, 47097aec; native review review-63fcf25fa6385080
  approved + acknowledged (`scripts/ops/check-prod-env.sh`, opt-in wiring via
  `PREFLIGHT_REQUIRE_PRODUCTION_ENV=1`; tests: 141 passed in
  test_prod_env_check.py + test_release_controls.py).
- PC-4: 86664ad4 (`DOMINIO_ALIAS_WWW`, default `www.localhost` = no ACME;
  validator requires `www.$DOMINIO`; 246 passed in the three root test files).
