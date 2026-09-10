# Handoff — represented-person account flow

Startup point for the next session. Phases, acceptance, and commands live in `tasks.md`; this file only says where we are and what comes next.

## Shape

```text
main
  ├─ Phase 1: #1165 → #1169 → #1170 → #1171 → #1172 → #1173   (merge in order, retarget child before each merge)
  ├─ Phase 2: fix/represented-person-desk-exit-ui              (new, after Phase 1)
  ├─ Phase 3: fix/represented-person-no-credentials            (new, after Phase 2)
  ├─ Phase 4: fix/represented-person-legacy-accounts           (new, after owner decision)
  └─ docs:    #1164 fix/represented-person-account-flow        (this replan)

Parked under #1133: #1175, #1176, wip branches from pi-1137-pr4c2 / pi-1137-pr4c2a
```

## Read state before acting

```bash
gh pr list --state open --json number,baseRefName,headRefName,isDraft,title \
  --jq '.[] | "\(.number)\t\(.baseRefName) <- \(.headRefName)\tdraft=\(.isDraft)\t\(.title)"'
git worktree list
git log --oneline origin/main -5
```

The first unchecked box in `tasks.md` whose phase predecessors are all checked is the next action. Do not trust checkboxes over `gh`: if a PR shows as merged but its box is unchecked, check the box, not the other way round.

## Stop conditions

- Phase 4 needs the owner's decision on legacy accounts and consents; do not start it without an answer recorded in #1137.
- A merge in Phase 1 whose child was not retargeted first: stop, the child is closed and cannot be reopened; open a new PR from the same branch.
- Any new PR that would be "inert" (no runtime change, no deletion): stop and fold it into the phase PR.

## Non-goals

- No reassignment, safe-stop linking, notifications, active-player predicate, or empty representative dashboard here (#1133, #1132, #1134).
- No production remediation execution.
- No force-push except the `--force-with-lease` rebase step of Phase 1.
