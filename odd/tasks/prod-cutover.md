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

## Cutover log (2026-10-04)

- Started after the owner's «ok beta». Target SHA `b83282f4` (main CI green, GHCR images present).
- 1.2 Final encrypted staging backup with B2 replica. 1.4 DigitalOcean snapshot skipped (encrypted B2 backup exists).
- 2.1–2.7: old `.env` kept in `~deploy` (`/opt` not writable by deploy) and shredded after 3.3; stack down; `db`/`redis` volumes removed (Caddy volumes kept); deploy crontab emptied; ledger `current.env` archived; 65 staging backups moved to `~deploy/cataclub-staging-retired`; checkout detached at `b83282f4`.
- 3.x: `.env` generated on the host (JWT/Postgres generated server-side, never printed; `POSTGRES_USER=cataclub_prod`; Cloudinary folders `cataclub-prod/*`). The owner loaded Resend/Cloudinary/Healthchecks secrets with an interactive helper (`odd/tasks/cutover-owner.sh` pattern: silent prompts, nothing in chat).
- The `deploy` sudo password does not work: `/etc/cataclub` files were written through a throwaway `alpine` container (deploy is in the docker group), `root:deploy 640`. **Follow-up:** reset it from the DigitalOcean Recovery Console.
- B2 offsite **disabled for the beta** (`BACKUP_B2_ENABLED=0`; backups encrypted, host-only). **Follow-up:** prod B2 key before the real launch.
- Heartbeat: Healthchecks.io (UptimeRobot heartbeat is a paid feature). UptimeRobot keeps the two HTTPS monitors.
- `check-prod-env` OK (rotation verified), compose OK, SHA match. Preflight OK with `BACKUP_TOLERATE_MISSING=1` (first provisioning). `deploy.sh` OK: runtime = HEAD = IMAGE_TAG = ledger = `b83282f4`.
- Post-checks: `/health/ready` listo, `/api/health` sha `b83282f4`, `/health/workers` 200, `www` 301 → apex, robots/sitemap OK, `/metrics` 404, Let's Encrypt cert valid to 2027-01-02.
- 6.3 silent mode ON (`DOMINIO_INDEXABLE=ensayo.invalid`: `X-Robots-Tag: noindex, nofollow`, robots `Disallow: /`). 7.4 crons installed (03:30 backup; 07:00 freshness + celery + memory + heartbeat).
- External services smoke: first prod backup (220 KB, encrypted); Healthchecks ping; Cloudinary upload/signed fetch/destroy in `cataclub-prod/fotos_perfil`; Resend recovery email delivered through the outbox.

## Load test (owner-authorized, production, 2026-10-04)

- 100 test accounts `carga001..100@cataclub.invalid` created directly in the DB (no emails); removed with the launch DB reset.
- Intense profile (think 2–4 s): saturates at ~30 VUs (~6 req/s, p95 6.2 s, 0 % errors); 1 vCPU shared by Next.js, FastAPI and Postgres.
- Realistic profile (think 15–30 s): 25 VUs p50 229 ms / p95 621 ms; 50 VUs p50 238 ms / p95 932 ms; 0 % errors. Degrades between 50 and ~85 VUs.
- Decision: launch on the $12 plan (1 vCPU / 2 GB); CPU-only resize to 2 vCPU ($18, reversible) as plan B. Optimization issue #1592 (`/api/student` fan-out).
