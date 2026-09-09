# Cata Club — OpenSpec Project Context

> Durable SDD initialization artifact for `represented-person-account-flow`.
> Approved feature: #1137. Complementary issues: #1132, #1133, #1134, #1135,
> and #1138. This phase initializes context only; it does not implement feature code.

## Project

Cata Club Admin is a UNL table-tennis club administration system covering people,
representatives, students, memberships, payments, attendance, medical records,
notifications, enrollment, and administration.

## Confirmed technical context

- Backend: Python 3.13, FastAPI, Pydantic v2, SQLAlchemy 2, Alembic,
  PostgreSQL 16, Celery, Redis, and uv.
- Frontend: Next.js 14 App Router, React 18, strict TypeScript, Tailwind CSS,
  Vitest, Playwright, and pnpm 10.
- Backend follows clean layered architecture: domain, infrastructure,
  business services, security, presentation, and cross-cutting support.
- Frontend uses a same-origin Next.js BFF. Route Handlers call FastAPI;
  HttpOnly cookies carry tokens; backend authorization is authoritative.
- Runtime and tests are container-aware and use Docker Compose. Backend tests
  require real PostgreSQL, not SQLite.

## Feature boundary

The approved change concerns the represented-person account flow and its related
identity, relationship, activation, authorization, and account-management behavior.
The exact acceptance behavior remains to be specified from issues #1137, #1132,
#1133, #1134, #1135, and #1138 before implementation. Product, provider,
deployment, ownership, and policy decisions remain in `cata_club-docs`.

Non-goals for initialization:

- No backend or frontend feature implementation.
- No migrations, seed changes, production configuration, commits, pushes, or PRs.
- No duplication of product decisions from the linked documentation repository.

## Validation context

Canonical local validation is selected by change surface:
`make pre-pr LANE=backend`, `frontend`, `integration`, or `full`; this feature is
expected to be cross-cutting, so `full` is the default. CI additionally validates
secret tracking, empty-to-head migrations, production image boot, and gates not
fully reproduced by local lanes. Backend tests use the single-tenant `db-test`
service on port 5436 locally; do not run concurrent backend suites.

Strict TDD is enabled from the first implementation change. Work is planned as a
feature-branch chain with a 400 changed-line review budget; each child work unit
must include its tests and remain independently reviewable where possible.

## SDD conventions

- Artifact store: `openspec` (`openspec/config.yaml`).
- Execution mode: auto.
- Delivery strategy: auto-chain.
- Chain strategy: feature-branch-chain.
- Review budget: 400 changed lines.
- Required artifacts follow the OpenSpec flow: proposal, specs, design, tasks,
  apply evidence, verification, and archive notes as later phases require.

## Repository state at initialization

- Worktree: `/home/alejo/devwork/apps/cata_club-worktrees/pi-1137`.
- Branch: `fix/represented-person-account-flow`, based on `origin/main`.
- No feature code was changed by this initialization.
- Skill registry is available at `.atl/skill-registry.md` and is preserved in
  this worktree for delegation/indexing purposes.
