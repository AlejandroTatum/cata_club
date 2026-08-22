/**
 * Auth utility functions — pure, testable, no React dependencies.
 *
 * These helpers centralise role-checking, routing, and navigation logic so
 * it can be unit-tested without mounting React components or mocking
 * browser APIs.
 */

import type { BackendTipoRol, UserRole } from "@/types/domain";
import { destinationLabel } from "@/lib/destinations";

// ---------------------------------------------------------------------------
// Pure navigation link data (no icon components — use at UI layer)
// ---------------------------------------------------------------------------

/**
 * Minimal navigation link descriptor — href + label only.
 * UI layers (Header, sidebar) add icon components from lucide-react.
 */
export interface NavLinkDef {
  href: string;
  label: string;
}

/**
 * A rail row, named by the registry rather than here.
 *
 * The labels used to be written out beside each href in the lists below, which
 * is how `/trainer` came to be "Mi día" in this file and "Panel del Entrenador"
 * on the back control of the screen it points at. `lib/destinations.ts` owns
 * every destination's name now, so the rail and the back control cannot drift
 * apart — see D12b of `docs/ux/rediseno-visual-2026-08.md`.
 *
 * What stays here is the only question this file was ever the right place for:
 * WHICH destinations a given role is offered.
 */
function row(href: string): NavLinkDef {
  return { href, label: destinationLabel(href) };
}

/**
 * A titled block of rail rows — one section of the product, named.
 *
 * The rail draws one of these per role the person holds, because a role is a
 * SECTION and not a mode: see `getNavGroupsForRoles` below.
 */
export interface NavGroup {
  /**
   * The rótulo above the block — "Entrenar", "Mi cuenta", "Administrar".
   *
   * `null` for the rows that name no section of the product (Inicio, and
   * Iniciar sesión while signed out). They are not a group with a heading
   * nobody wrote; a heading invented for them would start being drawn the
   * moment a second group appeared beside it.
   */
  heading: string | null;
  links: NavLinkDef[];
}

/**
 * The rail's groups, in render order — and the same order is the tie-break
 * when two roles grant the same destination.
 *
 * ## Why the account comes last
 *
 * A trainer who also plays opens the app to train; his own fees are the
 * monthly errand, not the daily one. So the sections he is here to WORK in
 * come first and the section that is his own comes last, which is also where
 * the rail already keeps everything personal — the user card sits at its foot.
 *
 * This deliberately does NOT reuse `ROLE_PRECEDENCE` (src/lib/server/auth.ts),
 * which orders representante above trainer: that list answers "which single
 * role does the session collapse to", a question this file no longer asks.
 * Nor does it reuse `IdentityCell`'s `ROLE_ORDER`, which runs the other way
 * round on purpose — it NAMES a person, from what they are on the field to
 * what they are in the system, and the first line of a name is the one that
 * gets read.
 *
 * ## Why representante and estudiante share one group
 *
 * They are not two sections; they are the same section reached by two grants.
 * 18 accounts hold ALUMNO and REPRESENTANTE at once, and drawing "Mi cuenta"
 * twice for them would be exactly the kind of duplicate the union is supposed
 * to remove. Within the group the roles are listed in dedup precedence:
 * representante's rows are the superset.
 */
const RAIL_GROUPS: readonly { heading: string; roles: readonly UserRole[] }[] = [
  { heading: "Administrar", roles: ["admin"] },
  { heading: "Entrenar", roles: ["trainer"] },
  { heading: "Mi cuenta", roles: ["representante", "estudiante"] },
];

/**
 * The destinations ONE role grants, in the order the rail draws them.
 *
 * Not exported: a caller holding a single role is exactly the collapse D12d
 * removed, so the only supported question is the one `getNavGroupsForRoles`
 * asks — what does this PERSON, with all her roles, get.
 */
function sectionsForRole(role: UserRole, studentIsAdult: boolean): NavLinkDef[] {
  const links: NavLinkDef[] = [];

  switch (role) {
    // Every name the rows below carry is the destination's own, read off
    // `lib/destinations.ts`, so the nav never promises a name the screen does
    // not use — and neither does anything else that points at these hrefs. The
    // admin set is transcribed from
    // `docs/archive/prototypes/prototipos/_nav-admin.html`.
    case "admin":
      links.push(
        row("/dashboard"),
        row("/members"),
        row("/groups"),
        row("/payments"),
        row("/discounts"),
        row("/sponsors"),
        row("/tarifas"),
        row("/attendance"),
        row("/reports"),
      );
      break;
    case "trainer":
      links.push(
        row("/trainer"),
        // Named after the action, not "Asistencia": the admin section called
        // "Asistencias" is the record list, this one is the act of taking it.
        // One word apart, they used to read as the same destination.
        row("/trainer/attendance"),
        // Its own section, not a detail of "Pasar lista": without this entry
        // the only way into /trainer/attendance/history was a secondary button
        // on the panel, and `resolveActiveHref` attributed the screen to
        // "Pasar lista" (longest-prefix wins, and this href is the longer one
        // as soon as it exists).
        row("/trainer/attendance/history"),
        // Última, y no por menos importante: las tres de arriba son la
        // secuencia de una sesión —mirar el día, pasar lista, revisar lo
        // pasado— y el padrón es consulta, no trabajo del día. Existe porque
        // la ficha de emergencia vivía SOLO dentro del paso 2 del asistente:
        // para ver a quién llamar había que entrar a un horario y ponerse a
        // tomar asistencia.
        row("/trainer/students"),
      );
      break;
    case "representante":
      links.push(
        row("/student"),
        row("/student/payments"),
        // The two things a student actually opens the portal to do. Without
        // this entry /student/attendance is reachable only from a panel on the
        // home screen.
        row("/student/attendance"),
        // Only a representante manages a representado's medical record — the
        // backend's `incluir_titular=False` on `/fichas-medicas/*` still
        // excludes the titular's own, so "estudiante" (below) never gets this
        // entry: it would point a self-managed student at a screen that 403s.
        row("/student/medical-record"),
      );
      break;
    case "estudiante":
      links.push(row("/student"), row("/student/payments"), row("/student/attendance"));
      // Ficha médica, ESTUDIANTE-only and age-gated: the backend's
      // `incluir_titular` on GET/PATCH /fichas-medicas/persona/{id} only
      // admits the titular when they're 18+
      // (ficha_medica_router.py::_es_titular_mayor_de_edad) — a minor with
      // their own account still gets no nav entry, or it would point them at
      // a screen that 403s.
      //
      // `representante` gets no entry here at all — a guardian's access to a
      // REPRESENTADO's record is a separate, role-only grant with its own
      // route (see feat/ficha-medica-representante, not yet merged as of this
      // branch). Once merged, this `case` needs both entries pushed under
      // their own conditions instead of one shared block.
      if (role === "estudiante" && studentIsAdult) {
        links.push(row("/student/medical-record"));
      }
      break;
    case "unsupported":
      // No role-specific links — this account has no recognized backend
      // role. /unauthorized (their only reachable protected page) doesn't
      // need a nav entry; Inicio is enough to navigate away.
      break;
  }

  return links;
}

/**
 * The rail a PERSON gets: the union of the sections her roles grant, grouped
 * and titled, with no destination offered twice.
 *
 * ## Why the whole array, and why no selector
 *
 * The backend has always authorised against the complete role array of the
 * token (`backend/app/seguridad/gestor_permisos.py`), and `RolServicio` can
 * assign any combination — alumno + entrenador is creatable today. The
 * frontend was the half that never finished: the session collapses the array
 * to one role by precedence (`pickPrimaryRole`, still untouched — it is what
 * route guards and redirects gate on), and the rail drew only that one. A
 * trainer who also plays therefore had no fees and no attendance of his own.
 *
 * The rail is the UNION, not a mode. There is no role selector on purpose: a
 * selector turns roles into modes and makes the person remember which one she
 * is standing in, when what she actually wants is one more section in the same
 * list. D12d of `docs/ux/rediseno-visual-2026-08.md` is the approved decision,
 * and it is about the SHAPE only — nothing here changes what any screen or
 * guard will let anybody do.
 *
 * ## What the caller draws
 *
 * A person with one role gets one group; `AppShell` draws no heading in that
 * case, because a single heading names the whole rail — which the brand block
 * right above it already does (`getAreaLabel`). Two or more groups is what
 * makes the rótulos worth their vertical space.
 *
 * @param roles — Every role the person holds, in any order. `null` means
 * unauthenticated (Inicio + Iniciar sesión); an empty array means an
 * authenticated account whose roles the frontend does not recognise, which
 * gets Inicio and nothing else — the same rail `"unsupported"` has always had.
 * @param studentIsAdult — Only meaningful for `"estudiante"`: true when that
 * self-managed student is 18+. Ignored for every other role — in particular a
 * `"representante"` gets no Ficha médica row from this flag, because that
 * access (a guardian correcting a DEPENDENT's record) is a separate, role-only
 * grant unrelated to the caller's own age.
 */
export function getNavGroupsForRoles(
  roles: readonly UserRole[] | null,
  studentIsAdult = false,
): NavGroup[] {
  if (roles === null) {
    return [{ heading: null, links: [row("/"), row("/login")] }];
  }

  const held = new Set(roles);
  const groups: NavGroup[] = [{ heading: null, links: [row("/")] }];
  // Every href already placed. This is what makes the rail a union rather than
  // a concatenation: two roles that grant the same destination spend one row on
  // it, in the earlier group of the two.
  const placed = new Set<string>();

  for (const group of RAIL_GROUPS) {
    const links: NavLinkDef[] = [];
    for (const role of group.roles) {
      if (!held.has(role)) continue;
      for (const link of sectionsForRole(role, studentIsAdult)) {
        if (placed.has(link.href)) continue;
        placed.add(link.href);
        links.push(link);
      }
    }
    // A group with no rows is not drawn empty — it is not drawn at all, which
    // is also what keeps a single-role person at exactly one group.
    if (links.length > 0) groups.push({ heading: group.heading, links });
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Role checking
// ---------------------------------------------------------------------------

/**
 * Check whether a user role is permitted for a given set of allowed roles.
 *
 * @param role — The current user's role (null if unauthenticated).
 * @param allowedRoles — Roles that are allowed to access a resource.
 * @returns true if the role is in the allowed list and is not null.
 */
export function canAccess(
  role: UserRole | null,
  allowedRoles: UserRole[],
): boolean {
  if (!role) return false;
  return allowedRoles.includes(role);
}

// ---------------------------------------------------------------------------
// Routing & Labels
// ---------------------------------------------------------------------------

/**
 * Get the default route for a given role after login.
 *
 * @param role — The authenticated user's role.
 * @returns The path to redirect to.
 */
export function getDefaultRoute(role: UserRole): string {
  switch (role) {
    case "admin":
      return "/dashboard";
    case "trainer":
      return "/trainer";
    case "representante":
    case "estudiante":
      return "/student";
    case "unsupported":
      return "/unauthorized";
  }
}

/**
 * Where a BACK control goes for a given role — the caller's own home, or the
 * public site when there is nobody (or nobody with a home to return to).
 *
 * Vive acá, y no duplicada en cada pantalla, porque ya se escribió dos veces:
 * `/ayuda` y el asistente público de inscripción son ambos rutas PÚBLICAS a
 * las que se entra desde adentro del producto, y las dos tenían que responder
 * la misma pregunta. La segunda copia se escribió mal (#295).
 *
 * `unsupported` cae al sitio público a propósito, no a su home. Ese home es
 * `/unauthorized`, que no es un lugar al que nadie VUELVA y que
 * `lib/destinations.ts` no nombra — `BackLink` haría throw en vez de
 * renderizar.
 */
export function backHrefForRole(role: UserRole | null | undefined): string {
  if (!role || role === "unsupported") return "/";
  return getDefaultRoute(role);
}

/**
 * Human-readable label for a role, in Spanish.
 *
 * "estudiante" reads **Jugador**, and that is D9's vocabulary ruling rather
 * than a preference: the product had three words for the same person —
 * *Jugador* on the enrolment form, *alumno* in the members table, *estudiante*
 * in the role — and `/profile` printed two of them within 60px of each other,
 * this label on the identity panel and `getBackendRoleLabel`'s "Alumno" in the
 * rows below. `IdentityCell.MEMBER_ROLE_LABELS` already picked the winner
 * ("Jugador", the word the person read the day they walked into the club);
 * these two functions were the last visible holdouts, and now all three agree.
 *
 * Only the WORD moves. The `UserRole` union still says `"estudiante"`, the
 * route is still `/student`, and the backend enum is still `"ALUMNO"` — a
 * route table and a database enum are not vocabulary, and renaming them would
 * be a behaviour change wearing a copy edit's clothes.
 */
export function getRoleLabel(role: UserRole): string {
  switch (role) {
    case "admin":
      return "Administrador";
    case "trainer":
      return "Entrenador";
    case "representante":
      return "Representante";
    case "estudiante":
      return "Jugador";
    case "unsupported":
      return "Rol no soportado";
  }
}

/**
 * Human-readable label for a BACKEND role name, as it arrives on
 * `PerfilPropio.roles` / `RolesResponse.roles`.
 *
 * Distinct from `getRoleLabel`, which names the ONE `UserRole` the session
 * resolved to. An account can hold several backend roles at once, and
 * `mapBackendRoleToUserRole` collapses them to the highest-privilege one — so
 * anywhere the full set must stay visible (see `/profile`'s identity rail),
 * this is the label to use.
 */
export function getBackendRoleLabel(rol: BackendTipoRol): string {
  switch (rol) {
    case "ADMINISTRADOR":
      return "Administrador";
    case "ENTRENADOR":
      return "Entrenador";
    case "REPRESENTANTE":
      return "Representante";
    // "Jugador", not "Alumno" — same ruling, same word as `getRoleLabel`
    // above. These two labels appear on `/profile` at the same time.
    case "ALUMNO":
      return "Jugador";
  }
}

/**
 * The backend role a given `UserRole` was derived from — the inverse of
 * `mapBackendRoleToUserRole` (src/lib/server/auth.ts). `null` for
 * `"unsupported"`, which by definition maps from no known role.
 */
export function backendRoleForUserRole(role: UserRole): BackendTipoRol | null {
  switch (role) {
    case "admin":
      return "ADMINISTRADOR";
    case "trainer":
      return "ENTRENADOR";
    case "representante":
      return "REPRESENTANTE";
    case "estudiante":
      return "ALUMNO";
    case "unsupported":
      return null;
  }
}

/**
 * Read a session's backend role array into the frontend's own vocabulary.
 *
 * The inverse of `backendRoleForUserRole` above, and the client-side half of
 * what `mapBackendRoleToUserRole` (src/lib/server/auth.ts) does on the server
 * — with the collapse left out. That module is server-only by construction
 * (it reads `BACKEND_API_URL` and handles raw tokens, and says so at the top),
 * so nothing in it may be imported from a client component; this table is the
 * same four rows, in the module a component may import.
 *
 * `AuthSession.roles` is typed `string[]`, not `BackendTipoRol[]`, because it
 * is whatever `/auth/me` sent. A role the backend adds tomorrow arrives here
 * as an unrecognised string and is dropped: an unknown role grants no section,
 * which is the same answer `mapBackendRoleToUserRole` gives it.
 */
const USER_ROLE_BY_BACKEND_ROLE: Record<BackendTipoRol, UserRole> = {
  ADMINISTRADOR: "admin",
  ENTRENADOR: "trainer",
  REPRESENTANTE: "representante",
  ALUMNO: "estudiante",
};

export function userRolesFromBackendRoles(roles: readonly string[]): UserRole[] {
  return roles
    .map((rol) => USER_ROLE_BY_BACKEND_ROLE[rol as BackendTipoRol])
    .filter((role): role is UserRole => role !== undefined);
}

/**
 * Derive a 1-2 letter avatar initials string from a display name.
 *
 * Uses the first letter of the first two whitespace-separated words.
 * Falls back to "?" for an empty/blank name so callers never render an
 * empty avatar badge.
 */
export function getUserInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const initials = words.slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "");
  return initials.join("");
}
