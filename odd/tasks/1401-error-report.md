# Issue #1401 — implementation ledger

Decision: D10 (2026-09-29); PostgreSQL bytea, authenticated reporters, admin-only review, explicit screenshot selection + consent (also enforced by backend/BFF), 90-day daily retention, suppression deletes the reporter's reports. No external provider or automatic capture. Frontend forwards X-Request-ID when exposed by a failed request.

Commits (no push):
- 8299c81 — 304 insertions, 1 deletion: backend create, admin endpoints, notification, migration, retention, suppression, tests. Backend work units 1–2 combined to keep the implementation usable at each commit.
- a94418a — 44 insertions: notification privacy and periodic purge tests.
- 79cd2ce — 224 insertions: BFF, opt-in dialog, authenticated shell/error entry, notification parity.
- e1566ef — 92 insertions: admin inbox, navigation, tests.
- 1da7ac8 — 102 insertions, 14 deletions: backend/BFF consent, request-ID propagation, no-store and refreshed-cookie handling, suppression test.
- 0a3b541 — 1 insertion, 1 deletion: disambiguate the existing Reportes link test.

Observed RED: missing service module; consent-with-screenshot test returned 201 before enforcement; full Vitest identified ambiguous Header link (1 failed of 5186), then fixed.
Observed GREEN: private PostgreSQL :5470 focused backend tests 44 passed (reports, beat, suppression, auth/rate inventories, migration drift); root BFF/single-head 140 passed, 1 skipped; Ruff clean; lint-imports 3 contracts kept; Alembic single head r1401reporte. Frontend type-check passed, lint passed with two pre-existing img warnings; focused dialog/BFF/admin/API client tests passed; full detached Vitest 307 files, 5186 tests passed (exit 0) after Header test correction.

Not run: make pre-pr and Playwright per authorization. Runtime 429 not proven: AMBIENTE=test uses a no-op limiter; exact 5/minute source inventory is covered. Review screenshot consent, notification content, suppression, admin authorization, request-ID forwarding, and browser behavior. Private test container must be stopped before handoff. Never push.
