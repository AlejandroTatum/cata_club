# Delta for Production Readiness Cleanup

## Purpose

This change touches tooling, configuration, and documentation only.
`openspec/specs/` has no matching capability domain and none is created or
modified by this change (per the proposal's Capabilities section). The
requirements below are change-scoped acceptance criteria, verified once and
retired at archive — they are NOT merged into `openspec/specs/`.

## Requirements

### Requirement: Backend Lockfile Consistency

The committed `backend/uv.lock` MUST be consistent with `backend/pyproject.toml`
so that `uv lock --check` exits 0, and `uv sync --frozen` MUST succeed without
re-resolving.

#### Scenario: Lockfile check passes

- GIVEN `backend/pyproject.toml` and `backend/uv.lock` as committed
- WHEN `uv lock --check` runs in `backend/`
- THEN the command exits 0 with no drift reported

#### Scenario: Frozen sync succeeds in CI and Docker

- GIVEN the committed lockfile
- WHEN `uv sync --frozen` runs (CI backend job, `backend/Dockerfile` build)
- THEN dependency install succeeds and the job/build proceeds past install

### Requirement: uv Dependency-Groups Migration

`backend/pyproject.toml` MUST declare dev dependencies under
`[dependency-groups]` and MUST NOT use the deprecated `[tool.uv] dev-dependencies`
key.

#### Scenario: No deprecation warning

- GIVEN the migrated `pyproject.toml`
- WHEN any `uv` command (`uv sync`, `uv lock`) runs in `backend/`
- THEN no `dev-dependencies` deprecation warning is emitted

### Requirement: README Reflects Current Reality

`backend/README.md` MUST NOT reference entities removed by PR #113
(`clases_extra`, `SolicitudClaseExtra`, `ClaseExtraServicio`), and any stated
test count or test-suite description MUST match the actual `pytest` output at
time of merge.

#### Scenario: No removed-entity references

- GIVEN `backend/README.md` as rewritten
- WHEN the file is searched for `clases_extra`, `SolicitudClaseExtra`, or
  `ClaseExtraServicio`
- THEN zero matches are found

#### Scenario: Test count matches reality

- GIVEN `backend/README.md`'s stated test count/description
- WHEN `pytest` is run against `backend/`
- THEN the reported test count matches the README's stated count

### Requirement: Environment Variable Examples

`backend/.env.example` MUST exist and list every variable read by
`Settings` in `backend/app/soporte_transversal/configuracion.py`, using
placeholder values only (no real secrets). `frontend/.env.example` MUST exist
and list every `NEXT_PUBLIC_*` (and other runtime) variable read under
`frontend/src/` (e.g. `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_USE_MOCKS`,
`NEXT_PUBLIC_APP_NAME`), since the frontend does read runtime env vars.

#### Scenario: Backend example covers every setting

- GIVEN the `Settings` class fields in `configuracion.py`
- WHEN each field is cross-checked against `backend/.env.example`
- THEN every field has a corresponding placeholder entry

#### Scenario: Frontend example covers every runtime var

- GIVEN every `process.env.NEXT_PUBLIC_*` (or equivalent) read under
  `frontend/src/`
- WHEN cross-checked against `frontend/.env.example`
- THEN every read variable has a corresponding placeholder entry

#### Scenario: No real secrets committed

- GIVEN both `.env.example` files
- WHEN reviewed before commit
- THEN all values are placeholders (no live API keys, tokens, or credentials)

### Requirement: Coverage Reporting, Not Gating

Backend `pytest` runs MUST report coverage via `pytest-cov` in CI, and the
frontend MUST have a coverage script. Coverage MUST be reported as informational
output and MUST NOT fail the build (`coverage_threshold: 0`).

#### Scenario: Backend CI reports coverage

- GIVEN the CI backend job with `--cov` added
- WHEN the job runs
- THEN a coverage summary is emitted and the job's pass/fail is unaffected by
  the coverage percentage

#### Scenario: Frontend coverage script exists

- GIVEN `frontend/package.json`
- WHEN a coverage script (e.g. `npm run test:coverage`) is invoked
- THEN a coverage report is produced

### Requirement: UX Redesign Docs Tracked

The `docs/ux/` directory MUST be committed to version control.

#### Scenario: Directory is tracked

- GIVEN the repository working tree after this change
- WHEN `git status` and `git ls-files docs/ux/` are checked
- THEN `docs/ux/` shows as tracked with no untracked files remaining under it

## Out of Scope (explicitly not specified here)

- No behavior change to any existing `openspec/specs/` capability.
- Oversized-component refactors, dashboard/attendance N+1 stash triage,
  `RankingResponseDTO` dead-field removal, and the palette redesign are
  deferred to future changes per the proposal.
