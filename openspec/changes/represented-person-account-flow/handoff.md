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

## Roadmap after #1137 — the rest of the representative relationship

Each phase below becomes its own OpenSpec change when it starts (one change per issue; never fold them into this one). Order matters: 6 and 7 need no decision and touch files this change just touched, so they go first while the context is warm; 8 is a decision that gates 9.

| Phase | Issue | Decision state | Shape | Inputs already built |
|---|---|---|---|---|
| 6 | #1138 emergency contact derived from the representative | Decided in the issue | One PR, mostly deletion: represented path of `EnrollmentFichaMedicaDTO`/`FichaMedicaCreateDTO` stops requiring `contacto_emergencia`/`telefono_emergencia`; both wizards drop the two fields on the child path; the two validators from #860/#643 stay for adults only; the trainer's emergency card already reads the representative | none needed |
| 7 | #1132 "player" is an active membership, not a role | Decided (2026-09-07): keep #762, retire the gate | One PR backend (`crear_membresia` stops calling `exigir_que_pueda_ser_alumno` for REPRESENTANTE; one `es_jugador(persona)` predicate = `Membresia.estado == ACTIVA` used by membership, schedule assignment and attendance) + one PR frontend (`members-adapter` stops fabricating `estudiantes: [persona]` for every root account; `isOperationalStudent` reads the membership) | `test/represented-person-pr5-contracts` RED tests (parked) may seed the backend suite |
| 8 | #1134 does the REPRESENTANTE role survive? | **Decided 2026-09-11: B, the role stays and is the source of truth** (issue closed) | Read-only evidence package, no code: two aggregate SQL counts (role without represented, represented without role), a sweep of what `politica_acceso.py` and the frontend role routing authorize by REPRESENTANTE and could not derive from the relationship; then the owner writes the decision in the issue | #1169 already persists an explicit capability for the desk exit; if the answer is "retire", that becomes a follow-up |
| 9a | #1133 one owner for the relationship rule + a complete ledger | Decided: rule = account with REPRESENTANTE role | One PR: wire the parked `validar_enlace` (#1175) into enrollment, `crear_representado` and `vincular_representado`; every `representante_id` mutation writes `vinculacion_representante` (enrollment and creation still do not) | PR #1175 (draft, parked) |
| 9b | #1133 administrator reassignment and self-service linking safe stop | Decided: reassignment yes (admin at the desk); self-service linking retired | One PR: `reasignar_presencial` (#1176) plus the non-disclosing safe stop for legacy self-service linking | PR #1176 (draft), branches `fix/represented-person-linking-safe-stop*`, `fix/represented-person-relationship-integrity` |

Rules carried over from this change: one PR per work unit, no inert PRs, no line-count slicing, status read from `gh`, and each PR names the issue bullets it closes.

## Non-goals

- No reassignment, safe-stop linking, notifications, active-player predicate, or empty representative dashboard here (#1133, #1132, #1134).
- No production remediation execution.
- No force-push except the `--force-with-lease` rebase step of Phase 1.
