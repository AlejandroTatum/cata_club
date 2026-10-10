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
| Route guard | `frontend/src/components/ProtectedRoute.tsx` `allowStaffPlayer` | Set on `/student`, `/student/payments`, `/student/attendance`, `/student/medical-record`. Staff without the flag are still redirected to their own home. `/student/add-dependent` does not opt in. |

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
3. **Pagos** on that row → create the membership, then register the first payment in the club (cash, approved on the
   spot) so the membership is ACTIVA.
4. Log in as that account. The rail shows its staff sections plus **Mi cuenta** (panel, Pagos, Asistencias, Ficha médica).
   `/student/payments` opens their own payments.
5. Log in as an admin/trainer **without** a membership: no *Mi cuenta* section, and `/student` redirects to their home.
