# Staff who also play: the player side of an admin/trainer account

An ADMINISTRADOR or ENTRENADOR who also plays does **not** get a second role or a second account. One role per
account stays (`rol_unico.py`, the `trg_usuario_rol_unico_por_usuario` trigger, the single-select role UI). What makes
someone a player is an **own membership that allows training** (ACTIVA or VENCIDA), the same rule the horario player
search and attendance already use (`MembresiaRepositorio.puede_entrenar`, `frontend/.../members-utils.ts#isPlayerAccount`).

## How it fits together

| Piece | Where | What it does |
|---|---|---|
| Give staff a membership | `frontend/src/app/members/members-utils.ts#isRepresentativePersonaRow` | An ADMINISTRADOR/ENTRENADOR row keeps **Ficha médica** and **Pagos**, so the admin can create their membership from Miembros. A representative-only row (no staff role) still hides them. |
| The fact | `GET /auth/me` → `puedeEntrenar` (`GestorAutenticacion.puede_entrenar`) | True when the account's own Persona has an ACTIVA or VENCIDA membership. Computed per request; the role never decides it. |
| The session flag | `frontend/src/lib/server/auth.ts#buildSession` → `session.isStaffPlayer` | `puedeEntrenar` **and** role admin/trainer. Always false for any other role or a backend that predates the field. |
| Navigation | `frontend/src/lib/auth-utils.ts#getNavGroupsForRoles(roles, studentIsAdult, isStaffPlayer)` | Adds the *Mi cuenta* (and, for adults, *Salud y familia*) groups **after** the staff groups. Staff home and staff nav do not change. |
| First-payment fact | `GET /auth/me` → `esperaPrimerPago` (`GestorAutenticacion.espera_primer_pago`) | True when the account's own Persona has an INACTIVA membership (created, never approved). Own Persona only; it never enables training. |
| First-payment flag | `buildSession` → `session.staffAwaitsFirstPayment` | `esperaPrimerPago`, role admin/trainer **and** not already a staff player. Navigation then adds only the *Pagos* row (`getNavGroupsForRoles(..., staffAwaitsFirstPayment)`), and `ProtectedRoute allowStaffFirstPayment` admits `/student/payments` and nothing else. |
| Route guard | `frontend/src/components/ProtectedRoute.tsx` `allowStaffPlayer` | Set on `/student`, `/student/payments`, `/student/attendance`, `/student/medical-record`. Staff without the flag are still redirected to their own home. `/student/add-dependent` does not opt in. |

## First payment of an INACTIVA membership

A membership an admin has just created is INACTIVA until its first payment is approved, so the owner is not yet a
player. An administrator can record their own first payment in person from their Miembros row (approved at once, with
themselves recorded as the approver), or the staff member opens **only** `/student/payments` and submits the payment
like any member (`POST /membresias/pagos`, authorized by owner). It lands as pending validation. Any administrator approves it
from the normal queue, including the payment's owner, and the membership becomes ACTIVA, which unlocks the rest of
*Mi cuenta*.

An administrator may approve or reject their own payment (owner decision: the club has a few trusted admins). The
reviewer is still recorded in `validado_por_persona_id`. Payments of other people are reviewed exactly as before.
`backend/tests/test_staff_jugador_primer_pago.py` pins all of it through the API.

## What the backend already guaranteed

The endpoints the `/student*` views use for the caller's **own** data do not authorize by role. They authorize through
`PoliticaAccesoPersona` (owner branch) or by token only, so a staff member who owns a membership already reads and pays
their own data. `backend/tests/test_staff_jugador_portal.py` pins that through the HTTP API, together with its limits:

- an ENTRENADOR cannot read or pay another person's data (403, nothing written);
- an ADMINISTRADOR can, as always: that is the admin's job in Miembros, not a player capability;
- `POST /membresias/propia` (self-enrolment) stays closed to staff (403, no membership created): the admin creates
  staff memberships in Miembros;
- `POST /personas/me/representados`, `POST /membresias/representado/pago` and the co-guardian endpoints stay
  representative/player-only.

## Local check

1. Seeded accounts (`make seed`, dev only): `admin@cataclub.com` / `admin12345`, `entrenador@cataclub.com` / `trainer12345`.
2. Log in as the admin, open **Miembros**, set the role filter to *Todos*, find the trainer (or the admin) row.
   It now offers **Ficha médica** and **Pagos**.
3. **Pagos** on that row → create the membership. It stays INACTIVA until its first payment is approved. An admin cannot
   record an in-person payment for their own membership (that refusal stays); the owner pays it themselves instead.
4. Log in as the owner (INACTIVA): the rail shows the staff sections plus only **Pagos** under *Mi cuenta*; `/student`
   and the other player pages redirect to their home. Submit the first payment there.
5. Log in as a **different** admin and approve it from the payments queue. The owner cannot approve or reject it (400).
6. Once the membership is ACTIVA or VENCIDA, log in as that account. The rail shows its staff sections plus **Mi cuenta** (panel, Pagos, Asistencias, Ficha médica).
   `/student/payments` opens their own payments.
7. Log in as an admin/trainer **without** a membership: no *Mi cuenta* section, and `/student` redirects to their home.
