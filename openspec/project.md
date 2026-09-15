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

Strict TDD is enabled from the first implementation change. Work is delivered as
a feature-branch chain of 7 implementation PRs executed automatically, slice by
slice, without routine workflow questions; each implementation PR targets
600–900 changed lines with a hard stop at 1,000, carries its own tests, and
remains independently reviewable.

## SDD conventions

- Artifact store: `openspec` (`openspec/config.yaml`).
- Execution mode: auto (slice-by-slice; stop only for genuine product ambiguity,
  destructive production action, a failed required gate, a severe review finding,
  conflict/drift, or a slice over 1,000 changed lines).
- Delivery strategy: auto-chain.
- Chain strategy: feature-branch-chain.
- Review budget: 600–900 changed lines per implementation PR; hard stop at 1,000.
  No routine size exceptions.
- Required artifacts follow the OpenSpec flow: proposal, specs, design, tasks,
  apply evidence, verification, and archive notes as later phases require.

## Repository state at initialization

- Worktree: `/home/alejo/devwork/apps/cata_club-worktrees/pi-1137`.
- Branch: `fix/represented-person-account-flow`, based on `origin/main`.
- No feature code was changed by this initialization.
- Skill registry is available at `.atl/skill-registry.md` and is preserved in
  this worktree for delegation/indexing purposes.

## Delivery state after the replan

The original 14-child-PR/400-line delivery plan is superseded by a compact,
automatic plan of 7 implementation PRs (600–900 target changed lines per PR,
hard stop 1,000). The draft/no-merge tracker is PR #1164 and implementation
PR 1 is open as #1165 (`fix/represented-person-audit-foundation`). The earlier
monolithic independence slice on `fix/represented-person-independence` is local
WIP only: it is not publishable whole, its size exception is superseded, and it
must be salvaged into smaller slices (PR 2 first) without discarding it.
