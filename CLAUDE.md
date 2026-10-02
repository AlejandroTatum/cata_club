# Cata Club — Project Instructions

## Git Workflow

Repository of record: `origin` → https://github.com/AlejandroTatum/cata_club. All branches, PRs, and merges happen there. There is no other remote.

1. Never commit directly to `main`. Every change — even one line — goes through a branch and a PR.
2. Branch from a fresh `main`, named `type/short-description` (e.g. `fix/niveles-pagination`). Valid types are the Conventional Commit types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`, `perf`, `build`, `style`, `revert`.
3. Commits follow Conventional Commits (`type(scope): description`): one logical change per commit, imperative mood, subject ≤72 chars, no AI attribution trailers.
4. PR titles use the same conventional format. For a standard PR targeting `main`, enable GitHub auto-merge with **squash** after opening it. Branch protection must require all checks green and the branch current with `main`; never bypass it or merge manually while checks are pending or red. The remote branch is auto-deleted on merge (repo setting).
5. Large features — more than ~400 changed lines or more than one reviewable slice, decided **before** starting — use a **feature integration branch** instead of a serial chain into `main`:
   - Create `feat/<feature>` from a fresh `main` and push it. Slice branches are cut from it and their PRs target it.
   - Each slice keeps the full methodology (focused tests, `make pre-pr`, review) and stays within the `chained-pr` review budget.
   - Merge a slice into the integration branch with `gh pr merge --squash` once its own PR checks are green. Do not enable auto-merge on slice PRs and do not wait for other slices or for `main`.
   - Keep the integration branch current by merging `main` into it (never rebase or force-push it).
   - When every slice has landed, open one PR from the integration branch to `main` and enable auto-merge with **squash**. That PR is the only one that waits on `main`.
6. Bug fixes require a linked GitHub issue documenting the root cause (`Closes #N` in the PR body). Features, refactors, and docs do not require an issue.
7. Do not block the next PR on post-merge `main` CI. With branch protection requiring a current branch, the merged PR already passed CI on the exact tree that landed. As soon as a PR merges, update the next queued PR with `main` (`gh pr update-branch`) and re-enable its auto-merge. Monitor post-merge `main` CI in the background; if it turns red, stop all merges to `main` until it is classified and fixed. Once it is green, run the housekeeping workflow: `git switch main && git pull`, delete the merged local branch and its worktree, and run `git worktree prune`.

## Implementation and verification workflow

`README.md` and `Makefile` are authoritative for local commands;
`.github/workflows/ci.yml` is the final CI reference. Use the same delivery
methodology regardless of the agent interface:

1. Work in one dedicated branch and worktree with a single implementation
   writer. Preserve unrelated tracked and untracked files.
2. Run the smallest focused test that exercises the changed behavior before
   broad validation.
3. Before pushing or opening a PR, run exactly one applicable
   `make pre-pr LANE=<backend|frontend|integration|full>` lane. Select the
   smallest lane that covers the change and use `full` for cross-cutting work.
4. Treat local verification and remote CI monitoring as separate tasks. Local
   verification must finish and report before delivery. When operating through
   Claude Code, use its monitoring capability in the background after push;
   other agent interfaces use their equivalent dedicated monitor. Never occupy
   the implementation task while waiting for GitHub Actions.
5. Never blindly rerun a failed test or CI check. First classify it as
   **deterministic**, **transient**, or **inherited stacked**, record the
   supporting evidence, and then choose the next action.
6. Record every CI gate skipped locally and why. The pre-PR lanes are predictive
   checks, not a claim of complete GitHub Actions parity.
7. Backend tests use the single-tenant PostgreSQL `db-test` service on port
   `5436`; do not run concurrent backend suites against it.

If a small scoped issue has not reached verified PR readiness within roughly one
hour, stop and report the concrete blocker instead of continuing with retries or
unbounded exploration.
