# Issue #1370 — Representative registration and payment notifications

Branch: `fix/1370-representative-notifications` at `dd23956d45ed909b73c4cd477c1bc845e50fdf73`.

## Tasks

- [x] Test-first registration outbox fan-out to representative, preserving existing admin recipients and the welcome-email leader. Implement durable, idempotent delivery.
- [x] Test-first pending and approved/rejected child-payment notifications, preserving existing administrator behavior and email routing.
- [x] Prove representative merged feed contains each event once, including pagination/count and repeated delivery; check enum/API/frontend parity if new types are introduced.
- [x] Run focused PostgreSQL tests, root BFF and migration-head tests, Ruff and import lint; record observed results.
- [x] Record reviewable conventional work-unit commits with line counts and validation evidence.

## Evidence and decisions

- `gh issue view 1370` confirms registration, payment outcomes, administrator regression and dedup acceptance criteria.
- Registration enqueues one `EnrollmentNotificacionOutbox` per admin in `EnrollmentServicio._notificar_nueva_inscripcion`; current early return when there are no admins must not prevent representative delivery.
- `entregar_inscripcion_notificacion` uses `enrollment_outbox_id` to avoid duplicate in-app delivery; the lowest outbox ID per student alone sends the welcome email. Representative rows must not change that leader behavior.
- `NotificacionServicio.listar_para_persona_y_hijos` currently reads both representative and active dependents' rows and prefixes dependent text. Explicit child-event rows addressed to the representative must be deduplicated in that merged query before pagination/count, not after slicing.
- `Persona.representante_id` represents the child's current adult. No change to implementation or tests has been made yet; no behavior or validation has been claimed.

## Commits

- `980e8b3` — `feat(notifications): notify representative on child registration (#1370)`; 35 additions, 5 deletions. RED: focused representative enrollment test had 0 outbox rows, expected 1. GREEN: 21 passed across focused enrollment case and both outbox/welcome test files. Design: reuse NUEVA_INSCRIPCION and existing outbox recipient field; enqueue admins first and representative once by person ID. The admin is email leader when present; child has no account, so no welcome email for represented child. Simultaneous admin-plus-representative delivery was subsequently locked by the third commit.
- `1ae2198` — `feat(notifications): notify representative of child payment outcomes (#1370)`; 104 additions, 23 deletions. RED: payment test missing PAGO_REGISTRADO; feed dedup test counted 3 instead of 2. GREEN: focused tests passed; 180 backend tests passed in final run, 140 root tests passed (1 skipped), frontend type-check and 20 focused Vitest tests passed, Ruff and lint-imports passed. Design: payment events remain single child-addressed rows visible in representative merged feed; pending event gets distinct PAGO_REGISTRADO type only for represented child. Feed prefers representative-addressed row for matching type/entity event before count/offset/limit. Migration head s1370pagoreg, based on r1372galeria. Pending notification is best-effort after payment commit, mirroring payment outcome delivery; no new payment email. Admin payment behavior is unchanged.
- `56b51e0` — `test(notifications): lock admin recipients and no-duplicate feed (#1370)`; 35 additions, 0 deletions. GREEN: focused test passed after correcting test-session detachment by caching event and recipient IDs before worker closes its SessionLocal. The test verifies admin and representative rows even when delivered in reverse order; leader/welcome behavior remains covered by `test_enrollment_bienvenida_correo.py`. No source change.
