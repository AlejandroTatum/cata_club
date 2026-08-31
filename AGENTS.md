# Agent guidance

Pi is the primary development environment for this repository. Use Pi as the
first agent interface, and keep agent work scoped to the requested branch and
worktree.

## Authority and scope

- `CLAUDE.md` is authoritative for branches, commits, and pull requests.
- `README.md` and `Makefile` are authoritative for repository orientation and
  canonical local commands; `.github/workflows/ci.yml` is the CI reference.
- Product, provider, deployment, and ownership decisions remain in the linked
  `cata_club-docs` repository. Do not duplicate or override them here.
- Preserve unrelated tracked or untracked work, especially landing-page work.

## Worktrees and concurrency

- Work only in a dedicated Git worktree and branch; never edit another agent's
  checkout.
- Do not run concurrent work against the same worktree or shared test services.
- `db-test` is single-tenant and publishes PostgreSQL on port `5436`; stop or
  isolate it before another backend test run.
- Never commit, push, publish, or change production configuration from an agent
  task without the repository workflow and explicit authorization.

## Pi delivery standing authorization

For user-authorized implementation work in Pi, that authorization covers the
end-to-end delivery workflow in `CLAUDE.md`: use an isolated worktree and branch
with one writer/integrator, run applicable focused and canonical validation,
commit conventionally, push, and open a PR. Squash-merge only when all required
CI is green, the PR is mergeable against fresh `main`, and post-merge `main` CI
is green; then delete the local branch and worktree and prune worktrees.

This standing authorization never permits force-pushes, red or pending CI
merges, direct `main` commits, production deployment or configuration changes,
destructive actions, scope expansion, or bypassing human or product decisions.
If validation or CI fails, stop safely and report it rather than delivering.

## Validation

- `make test` runs backend, frontend, and selected integration gates. It does
  **not** include every root-level check in `tests/`.
- `make test-root` runs all root-level `tests/` checks, including Compose
  layering, the single Alembic head check, and the QA build-SHA guard.
- `make ci-backend` is an explicitly partial local analogue: backend lint,
  backend preflight/tests, and Compose validation. It is not the full CI job.
- Backend tests require real PostgreSQL via `db-test`, not SQLite. Use
  `make test-backend-preflight` to start it safely when `.env` is absent.
