# Cata Club — Project Instructions

## Git Workflow

Repository of record: `origin` → https://github.com/AlejandroTatum/cata_club. All branches, PRs, and merges happen there. There is no other remote.

1. Never commit directly to `main`. Every change — even one line — goes through a branch and a PR.
2. Branch from a fresh `main`, named `type/short-description` (e.g. `fix/niveles-pagination`). Valid types are the Conventional Commit types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`, `perf`, `build`, `style`, `revert`.
3. Commits follow Conventional Commits (`type(scope): description`): one logical change per commit, imperative mood, subject ≤72 chars, no AI attribution trailers.
4. PR titles use the same conventional format. Merge with **squash**. The remote branch is auto-deleted on merge (repo setting); delete the local branch and its worktree immediately after.
5. Chained/stacked PRs are the exception, used only when a change will exceed ~400 changed lines — decided **before** starting, following the `chained-pr` skill.
6. Bug fixes require a linked GitHub issue documenting the root cause (`Closes #N` in the PR body). Features, refactors, and docs do not require an issue.
7. Housekeeping after every merge: `git switch main && git pull`, delete the merged local branch, run `git worktree prune`.
