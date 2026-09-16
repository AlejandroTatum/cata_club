# Student experience follow-ups

Source: close-out follow-up list of the completed student-experience round
(see odd/tasks/student-experience-improvements.md, PRs #1280 and #1282).
Owner approved all five follow-ups on 2026-09-16. Session reminder emails stay
deferred until the club moves to a paid Resend plan (free = 100/day, 3k/month).

Delivery: three PRs to `main` (auto-merge squash), single writer, one
`make pre-pr` lane each, plus one GitHub issue. Worktree:
`/home/alejo/devwork/.projects/apps/cata_club-worktrees/followups-student-experience`.

- [x] F1. GitHub issue documenting the landing-image-delivery flake: evidence
  (main run 35131809599 and PR #1282 run 35138501720, identical bytes, slide-1
  request created but never dispatched), root fragility (lazy->eager attribute
  flip of an invisible slide in HeroCarousel.tsx, IDLE_SLIDE_REACH), and the
  suggested fix direction (real preload / fetchPriority instead of attribute
  flip). No code change in this round.
- [ ] F2. PR B (backend, LANE=backend) `feat/notificaciones-followups`:
  - [x] F2a. Centralize the three inline email subjects (pago aprobado /
    rechazado, bienvenida) into asuntos_correo.py (declared single source).
  - [x] F2b. Representative fallback: when a payment's persona has no Usuario
    (minor representado), send the validation email to the titular
    representative's account instead of skipping. Tests for both paths.
  - [x] F2c. SMTP daily send cap guard: DB-backed, process-safe counter;
    configurable via settings (default 100/day, Resend free); on cap, skip +
    log (never fail the operation). Minimal migration if unavoidable.
- [x] F3. PR B verify (`make pre-pr LANE=backend`) + delivery (push, PR,
  auto-merge squash, CI monitor, post-merge main green).
- [ ] F4. PR A (frontend, LANE=frontend) `fix/student-portal-followups`:
  - [x] F4a. /profile identity badge: use describeMembershipState(estado,
    coverageEnd) so an ACTIVA badge never sits above a lapsed "Vigente hasta"
    (same class as #815, one-line fix flagged in PR #1282 review).
  - [x] F4b. Carnet vigencia: show the real coverage end ("Valido hasta" from
    approved payments) on the /student carnet alongside "Socio desde".
  - [x] F4c. Unify the two photo upload paths (carnet subirFotoPersona vs
    profile subirFotoPerfil) behind one shared helper; no behavior change.
- [x] F5. PR A verify (`make pre-pr LANE=frontend`) + delivery + post-merge
  main green.
- [x] F6. PR C (docs) `docs/odd-task-records`: commit BOTH odd task files
  (student-experience-improvements.md final state + this file final state);
  repo precedent tracks odd/tasks/*.md.
- [x] F7. Close-out: housekeeping (branches, worktree, prune), memory update,
  final report.

## Explicitly deferred

- Session reminder emails (until a paid Resend plan exists).
