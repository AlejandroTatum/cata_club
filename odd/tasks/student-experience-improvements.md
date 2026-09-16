# Student experience improvements

Source: delegated read-only audit of the student role flow (worktree
`cata_club-worktrees/audit-student-role-ux`, branch base `main` @ 55fe082).
Owner decisions on record: club is intentionally flexible — no penalties, no
escalation, student does NOT see own debt, day-15+ silence stands, admin daily
`RESUMEN_MORA_ADMIN` digest is sufficient. Email budget: Resend free plan
(100/day, 3,000/month) — event-driven emails only this round.

Delivery: two independent standard PRs to `main` (auto-merge squash), single
writer, one `make pre-pr` lane each. Worktree:
`/home/alejo/devwork/.projects/apps/cata_club-worktrees/audit-student-role-ux`.

## PR 1 — feat/student-email-notifications (LANE=backend)

- [x] T1. Email on payment APPROVED. New method in
  `backend/app/infraestructura/notificaciones_servicio.py` (follow existing
  template/addressing patterns) + hook where the in-app PAGO_APROBADO
  notification is created in `backend/app/servicios_negocio/membresia_pago_servicio.py`
  (~:2093). Content: plan, covered month, "vigente hasta". Unit test using the
  existing fake-SMTP harness (`backend/tests/smtp_falso.py`).
- [x] T2. Email on payment REJECTED. Hook at the PAGO_RECHAZADO creation site
  (~:2266). Content: rejection reason + retry steps (same procedure as the
  "ver ayuda" how-to-pay). Unit test.
- [x] T3. Welcome email post-enrollment to the student in
  `backend/app/infraestructura/tareas/enrollment_notificacion_tareas.py`
  (today only admin is notified). Content: welcome + next steps (first payment
  in person, activation). Unit test.
- [x] T4. Focused tests green, then `make pre-pr LANE=backend` (via
  gentle-ai-verify). Record skipped CI gates.
- [x] T5. Delivery: work-unit commits (one per email + chore if needed), push,
  PR with conventional title, auto-merge squash, CI monitor, post-merge main
  green check.

## PR 2 — fix/student-portal-polish (LANE=frontend)

Branch from fresh `main` after PR 1 lands.

- [x] T6. Enable telefono edit on the student profile branch
  (`frontend/src/app/profile/page.tsx` `startEditing` un-gate). Verify
  `PATCH /auth/me` accepts telefono for the student role; adjust backend only
  if genuinely blocked (report first).
- [x] T7. Align attendance window: `RECENT_SESSIONS_LIMIT` (5) vs
  `PORTAL_SESSION_WINDOW` (30) in `frontend/src/app/student/attendance/page.tsx`
  + `student-adapter.ts`. Decide during implementation: raise adapter limit if
  the BFF returns more, else fix the copy. Screen text and data must agree.
- [x] T8. MembershipCard on /profile: use `resolveCoverageEnd`-based coverage
  end (as payments screen does) instead of the `membership.fechaFin` the
  adapter does not populate on some paths.
- [x] T9. "Ver ayuda" tweaks: give the how-to-pay procedure more prominence
  when the student's state is expired/never-paid; clarify that the
  ManagedStudentPicker note also applies to payments.
- [x] T10. Focused frontend tests green, then `make pre-pr LANE=frontend` (via
  gentle-ai-verify). Record skipped CI gates.
- [x] T11. Delivery: work-unit commits, push, PR, auto-merge squash, CI
  monitor, post-merge housekeeping (switch main, pull, delete branch/worktree
  as applicable, `git worktree prune`).

## Backlog (explicitly out of scope this round)

- Unify carnet vs profile photo upload paths.
- Vigencia/vencimiento field on the carnet.
- SMTP daily-send cap guard (Resend free 100/day).
- Session reminder notifications (only if moving to a paid Resend plan).
