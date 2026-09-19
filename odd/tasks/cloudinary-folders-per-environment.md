# Feature: Cloudinary folders overridable per environment

Chore, no linked issue. Branch `chore/cloudinary-folders-per-environment`, worktree
`cata_club-worktrees/gentleman-cloudinary-folders`, base `main` @ 981cc07.

## Problem

`docker-compose.yml` hardcoded `CLOUDINARY_CARPETA_COMPROBANTES`,
`CLOUDINARY_CARPETA_VOUCHERS` and `CLOUDINARY_CARPETA_FOTOS_PERFIL` as
literals (`cataclub/comprobantes`, `cataclub/vouchers`,
`cataclub/fotos_perfil`). Every environment that shares the Cloudinary
account (local dev and staging both do, same `cloud_name`) wrote into the
same three folders — no override was possible.

## Decision (owner, 2026-09-19)

Staging gets its own folders (`cataclub-staging/*`) instead of purging the
shared `cataclub/*` ones. The already-accumulated `cataclub/*` orphans from
before this change are accepted, not a pending cleanup.

## Scope

- Make the three compose vars interpolated (`${VAR:-default}`), default
  unchanged.
- Lock the behavior with two tests in
  `tests/test_docker_compose_config.py`: no-override keeps the default,
  override reaches the three Python services.
- Document the override and the accepted `cataclub/*` orphans in
  `docs/operations/staging-redeploy.md`.
- List the three vars (commented, with defaults) in the root `.env.example`
  and `.env.production.example`.

## Tasks

- [x] 1. `docker-compose.yml:112-114` — interpolate the three vars, same
      default values.
- [x] 2. `tests/test_docker_compose_config.py` — TDD: wrote
      `test_las_carpetas_de_cloudinary_se_pueden_sobrescribir_por_ambiente`
      first (RED against the literal compose, confirmed with
      `uv run pytest ../tests/test_docker_compose_config.py -k cloudinary -q`),
      then `docker-compose.yml` change → GREEN. Added
      `test_las_carpetas_de_cloudinary_defaultean_al_valor_compartido_sin_override`
      alongside it (passed from the start, since the default value itself
      never changed).
- [x] 3. `docs/operations/staging-redeploy.md` §"Reprovisionar la base sin
      vaciar Cloudinary" — added a paragraph on the override and the
      accepted `cataclub/*` orphans from the 2026-09-19 reprovisioning.
- [x] 4. `.env.example` and `.env.production.example` — added the three
      vars (commented, with the `cataclub/*` defaults).
      `backend/.env.example` already listed them (unrelated to Compose);
      left untouched.

## Verification

- `cd backend && uv run pytest ../tests/test_docker_compose_config.py -q` →
  108 passed.
- `make pre-pr LANE=integration` → see final report in the PR/session
  handoff.

## TDD

Enabled, source: project convention (see root CLAUDE.md, "Strict TDD Mode:
enabled"). Runner: `uv run pytest` against
`tests/test_docker_compose_config.py` (root suite, no DB needed).
