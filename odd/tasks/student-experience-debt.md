# Student experience debt round

Source: close-out debt list of the follow-up round (PRs #1283/#1284/#1285,
issue #1281). Owner approved attacking all remaining debt on 2026-09-16, with
one product decision: session reminders are BELL-ONLY (no email — free Resend
plan budget stays untouched).

Delivery: sequential PRs to `main` (auto-merge squash), single writer, focused
lane per PR. Worktree:
`/home/alejo/devwork/.projects/apps/cata_club-worktrees/debt-student-experience`.

- [ ] G1. PR D (backend, LANE=backend) `feat/email-cap-housekeeping`:
  - [x] G1a. Retention for `contador_correo_diario`: nightly task deleting
    rows older than a sensible window (constant is fine, e.g. 90 days);
    registered in the Celery beat alongside the existing nightly jobs.
  - [x] G1b. Cap-skip visibility: when the daily SMTP cap skips a send, admins
    get a daily-deduped in-app notification summarizing skipped sends (reuse
    the RESUMEN-style dedup pattern). Add a new TipoNotificacion label only if
    no existing tipo fits — then handle the Postgres enum drift properly
    (migration + drift tests).
- [x] G2. PR D verify (`make pre-pr LANE=backend`) + delivery (push, PR,
  auto-merge squash, CI monitor, post-merge main green).
- [x] G3. PR E (frontend, LANE=frontend) `fix/landing-hero-preload`: real fix
  for the #1281 flake — make hero slide-1 delivery deterministic (preload /
  fetchPriority direction instead of promoting a deferred invisible img), keep
  the #705 contract (never reveal an unfetched slide) and the landing perf/LCP
  budget. PR body links `Closes #1281`.
- [x] G4. PR E verify (`make pre-pr LANE=frontend`) + delivery + post-merge
  main green.
- [x] G5. PR F (bell-only session reminder, lane per final scope): daily task
  creating in-app "entrenas manana" notifications for students with a session
  the next day; NO email. New tipo + migration + beat schedule if needed;
  minimal frontend bell mapping only if the bell requires it.
- [x] G6. PR F verify + delivery + post-merge main green.
- [x] G7. Close-out: housekeeping (branches, worktree, prune, db-test down),
  memory update, tiny docs PR committing this file's final state, final report.

## Constraints on record

- Zero new email volume this round (bell-only reminder; cap-skip notice is
  in-app; retention deletes rows).
- Bug-fix PR E must link issue #1281 (repo rule).
