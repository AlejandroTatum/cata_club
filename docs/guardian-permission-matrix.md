# Second guardian (#1666): permission matrix

Source of truth for who may do what on a minor's data. Keep in sync with `backend/tests/test_segundo_guardian_permisos.py`, which exercises every row of the first table through the public API.


Every row goes through `PoliticaAccesoPersona` (single "is guardian of" helper,
`backend/app/servicios_negocio/politica_acceso.py`). Scope `GENERAL` = primary
**and** second guardian; scope `FIRMA_LEGAL` = primary only. P = primary, S = second
guardian, X = unrelated adult (no link), A = admin. "403" also covers a non-existent
target (anti-enumeration, issue #457). BFF (`frontend/src/app/api/**`) routes are
transparent proxies that forward the caller's token; none contains ownership logic, so
they inherit the backend row (listed at the end).

### Ownership-checked backend endpoints (guardian-aware)

| # | Endpoint | P | S | X | A | Helper scope |
|---|----------|---|---|---|---|--------------|
| 1 | GET /personas/{id} | 200 | 200 | 403 | 200 | GENERAL (+inverse link, primary only) |
| 2 | GET /personas/{id}/beneficio | 200 | 200 | 403 | 200 | GENERAL |
| 3 | POST /personas/{id}/foto | 200 | 200 | 403 | 200 | GENERAL (general-data edit) |
| 4 | GET /personas/{id}/antecedentes-club | 200 | 200 | 403 | 200 | GENERAL |
| 5 | GET /asistencias/persona/{id} | 200 | 200 | 403 | 200 (+trainer) | GENERAL |
| 6 | GET /asistencias/alumnos/{id}/horarios | 200 | 200 | 403 | 200 (+trainer) | GENERAL |
| 7 | GET /fichas-medicas/persona/{id} | 200 | **200 (view)** | 403 | 200 | GENERAL |
| 8 | PATCH /fichas-medicas/persona/{id} | 200 | **403 (view only)** | 403 | 200 | FIRMA_LEGAL |
| 9 | GET /membresias/mias?persona_id= | 200 | 200 | 403 | 200 | GENERAL |
| 10 | GET /membresias/persona/{id} | 200 | 200 | 403 | 200 | GENERAL |
| 11 | GET /membresias/{id} | 200 | 200 | 403 | 200 | GENERAL |
| 12 | POST /membresias/pagos | 201 | 201 | 403 | 201 | GENERAL (pay) |
| 13 | GET /membresias/pagos/{id} | 200 | 200 | 403 | 200 | GENERAL |
| 14 | GET /membresias/pagos/persona/{id} | 200 | 200 | 403 | 200 | GENERAL |
| 15 | GET /membresias/coberturas/persona/{id} | 200 | 200 | 403 | 200 | GENERAL |
| 16 | GET /membresias/coberturas/{id}/comprobante | 200 | 200 | 403 | 200 | GENERAL (receipt) |
| 17 | POST /membresias/pagos/{id}/voucher | 201 | 201 | 403 | 201 | GENERAL (upload voucher) |
| 18 | POST /membresias/representado/pago | 201 | 201 | 403 | n/a (REPRESENTANTE role only, as today) | GENERAL (was inline `representante_id ==`) |
| 19 | POST /membresias/{id}/aplicar-beneficio | 200 | 200 | 403 | 403 (as today: owner/guardian only) | GENERAL (was inline `representante_id ==`) |
| 20 | GET /portal/alumno/{id} | 200 | 200 | 403 | 200 | titular-or-admin on the caller's own id; payload lists dependents of **both** links |
| 21 | GET /personas/{id}/representados | 200 | 200 | 403 | 200 | titular-or-admin on own id; lists dependents of both links |
| 22 | GET /ranking/notificaciones/mias | 200 | 200 | own only | own | feed of own + dependents of both links |
| 23 | PATCH /ranking/notificaciones/leer-todas | ok | ok | own only | own | same scope as the feed |
| 24 | GET /auth/me (`alta_presencial_completada` gate) | ok | ok | n/a | n/a | gate satisfied by dependents of both links |

### Primary-only / titular-only exceptions (intentional, by the owner decision)

| Endpoint / rule | P | S | X | A | Why |
|-----------------|---|---|---|---|-----|
| PATCH /fichas-medicas/persona/{id} (#8) | yes | **no** | no | yes | S2: medical record is view-only for the second guardian |
| Legal consents (`/auth/consentimiento-legal*`, enrollment acceptance) | own account | own account only; no consent is ever written for the minor | own | own | consents are scoped to the signing account (`ConsentimientoLegal.cuenta_id` from the token); S has none for the minor and cannot create one |
| POST /personas/{id}/representados, /vincular-representado, /me/representados | titular | titular | titular | yes | act on the caller's own account (`exigir_acceso_directo`), unchanged |
| POST /personas/{id}/independizar, /reasignar-representante | no | no | no | yes | admin-only, unchanged; they also clear a stale second-guardian link |
| Emergency contact of a minor (#1138), family-gratuity count (`contar_membresias_activas_familia`) | primary | primary | - | - | derived from `Persona.representante_id` by design; unchanged |
| POST /co-representantes/persona/{id}/invitaciones | yes | **no** | no | yes | S2: primary invites, admin too |
| DELETE /co-representantes/persona/{id} | yes | **no** | no | yes | S2: primary removes, admin too |
| POST /co-representantes/persona/{id} (direct add) | no | no | no | yes | admin only |
| GET /co-representantes/persona/{id} | yes | yes | no | yes | read the guardians of a minor |
| POST /co-representantes/invitaciones/aceptar | - | the invited account (token + matching e-mail) | token bound to e-mail | - | accept = explicit consent of the invitee |

### Admin/staff-only endpoints (no guardian branch, unchanged)
`/personas` admin CRUD, `/membresias` admin CRUD/validation, `/fichas-medicas/` POST + `/existe`,
`/fichas-medicas/persona/{id}/emergencia` (admin/trainer), attendance management, discounts,
`/supresion-datos/*`, dashboard, actividad: none checks a guardian link.

### BFF routes inheriting the rows above (no code change needed)
`/api/student` (#20), `/api/personas/[id]`, `/[id]/beneficio`, `/[id]/foto`, `/[id]/representados`,
`/api/asistencias/alumnos/[id]/horarios`, `/api/fichas-medicas/persona/[id]` (#7/#8),
`/api/membresias/{mias,persona/[id],pagos,pagos/[pagoId],pagos/persona/[id],pagos/[pagoId]/voucher,representado/pago,[id]/aplicar-beneficio,coberturas/*}`,
`/api/ranking/notificaciones/*`, `/api/auth/me`. New BFF routes: `/api/co-representantes/**`.

