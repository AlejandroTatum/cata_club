#!/usr/bin/env bash
# Flujo de rama de integración para features grandes (issue #1505, CLAUDE.md
# regla 5): `feat/<feature>` sale de `main` fresco, los slices salen de ella y
# sus PRs la apuntan; al final un único PR `feat/<feature>` -> `main`.
#
# Nunca se usa rebase ni force-push: la rama de integración se mantiene al día
# mergeando `main` en ella. Los PRs de slice no llevan auto-merge.
#
# Uso: feature_flow.sh <subcomando> <feature> [args]
#   feature-start <feature>
#   slice-start   <feature> <slice>
#   slice-pr      <feature>
#   slice-merge   <feature> <pr-number>
#   feature-sync  <feature>
#   feature-pr    <feature>
# Variables: REMOTE (default origin).
set -euo pipefail

REMOTE="${REMOTE:-origin}"

usage() {
  echo "usage: ${0##*/} {feature-start|slice-start|slice-pr|slice-merge|feature-sync|feature-pr} <feature> [slice|pr-number]" >&2
  exit 2
}

die() {
  echo "Error: $*" >&2
  exit 1
}

check_name() {
  [[ "$1" =~ ^[a-z0-9][a-z0-9-]*$ ]] || die "invalid name '$1' (use lowercase letters, digits and dashes)"
}

local_branch_exists() { git show-ref --verify --quiet "refs/heads/$1"; }
remote_branch_exists() { git ls-remote --exit-code --heads "$REMOTE" "$1" >/dev/null 2>&1; }

require_remote_branch() {
  remote_branch_exists "$1" || die "$REMOTE/$1 does not exist (run feature-start first)"
}

require_clean_tree() {
  git diff --quiet HEAD -- || die "uncommitted tracked changes; commit or stash them first"
}

[[ $# -ge 2 ]] || usage
cmd="$1"
feature="$2"
check_name "$feature"
integration="feat/$feature"

case "$cmd" in
  feature-start)
    git fetch "$REMOTE"
    if local_branch_exists "$integration" || remote_branch_exists "$integration"; then
      die "$integration already exists (locally or on $REMOTE)"
    fi
    git switch -c "$integration" --no-track "$REMOTE/main"
    git push -u "$REMOTE" "$integration"
    ;;

  slice-start)
    [[ $# -eq 3 ]] || usage
    slice="$3"
    check_name "$slice"
    branch="$integration-$slice"
    require_clean_tree
    git fetch "$REMOTE"
    require_remote_branch "$integration"
    if local_branch_exists "$branch" || remote_branch_exists "$branch"; then
      die "$branch already exists (locally or on $REMOTE)"
    fi
    git switch -c "$branch" --no-track "$REMOTE/$integration"
    ;;

  slice-pr)
    branch="$(git branch --show-current)"
    [[ "$branch" == "$integration-"* ]] || die "current branch '$branch' is not a slice of $integration (expected $integration-<slice>)"
    git push -u "$REMOTE" "$branch"
    # Sin auto-merge: el slice se mergea con `slice-merge` cuando sus checks pasan.
    gh pr create --base "$integration" --fill
    ;;

  slice-merge)
    [[ $# -eq 3 ]] || usage
    pr="$3"
    [[ "$pr" =~ ^[0-9]+$ ]] || die "PR number must be numeric, got '$pr'"
    base="$(gh pr view "$pr" --json baseRefName --jq .baseRefName)"
    [[ "$base" == "$integration" ]] || die "PR #$pr targets '$base', not $integration; refusing to merge"
    # Sin `--required`: las ramas feat/* no tienen protección, así que no hay
    # checks requeridos y gh fallaría siempre. Se exigen TODOS los checks.
    gh pr checks "$pr" || die "checks on PR #$pr are failing or pending; refusing to merge"
    gh pr merge "$pr" --squash --delete-branch
    ;;

  feature-sync)
    [[ "$(git branch --show-current)" == "$integration" ]] || die "current branch must be $integration"
    require_clean_tree
    git fetch "$REMOTE"
    # Primero alcanza la rama remota (slices mergeados desde GitHub); si no,
    # el push final sería rechazado por no ser fast-forward.
    git merge --ff-only "$REMOTE/$integration" ||
      die "$integration has diverged from $REMOTE/$integration; reconcile it manually"
    git merge --no-edit "$REMOTE/main" ||
      die "merge conflict with $REMOTE/main: resolve it, commit, then run 'git push'"
    git push "$REMOTE" "$integration"
    ;;

  feature-pr)
    git fetch "$REMOTE"
    require_remote_branch "$integration"
    gh pr create --base main --head "$integration" --fill
    gh pr merge --auto --squash "$integration"
    ;;

  *) usage ;;
esac
