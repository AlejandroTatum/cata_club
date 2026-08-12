/**
 * Auth utility functions — pure, testable, no React dependencies.
 *
 * These helpers centralise role-checking, routing, and navigation logic so
 * it can be unit-tested without mounting React components or mocking
 * browser APIs.
 */

import type { BackendTipoRol, UserRole } from "@/types/domain";

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
 * Role-aware navigation links for the main app header.
 *
 * Pure function — no React, no browser APIs. Returns the list of nav links
 * that should be visible for a given role (or unauthenticated state).
 *
 * @param role — The current user's role, or null if unauthenticated.
 * @param studentIsAdult — Only meaningful for `"estudiante"`: true when that
 * self-managed student is 18+. Ignored for every other role — in particular
 * a `"representante"` account gets no Ficha médica entry from this flag,
 * because that access (a guardian correcting a DEPENDENT's record) is a
 * separate, role-only grant unrelated to the caller's own age.
 */
export function getNavLinksForRole(
  role: UserRole | null,
  studentIsAdult = false,
): NavLinkDef[] {
  if (!role) {
    return [
      { href: "/", label: "Inicio" },
      { href: "/login", label: "Iniciar Sesión" },
    ];
  }

  const links: NavLinkDef[] = [{ href: "/", label: "Inicio" }];

  switch (role) {
    // Every label below is the destination's own page title, so the nav
    // never promises a name the screen does not use. The admin set is
    // transcribed from `docs/ux/prototipos/_nav-admin.html`.
    case "admin":
      links.push(
        { href: "/dashboard", label: "Panel de Control" },
        { href: "/members", label: "Miembros" },
        { href: "/groups", label: "Horarios" },
        { href: "/payments", label: "Membresías y Pagos" },
        { href: "/discounts", label: "Descuentos" },
        { href: "/attendance", label: "Asistencias" },
        { href: "/reports", label: "Reportes" },
      );
      break;
    case "trainer":
      links.push(
        { href: "/trainer", label: "Mi día" },
        // Named after the action, not "Asistencia": the admin section called
        // "Asistencias" is the record list, this one is the act of taking it.
        // One word apart, they used to read as the same destination.
        { href: "/trainer/attendance", label: "Pasar lista" },
        // Its own section, not a detail of "Pasar lista": without this entry
        // the only way into /trainer/attendance/history was a secondary button
        // on the panel, and `resolveActiveHref` attributed the screen to
        // "Pasar lista" (longest-prefix wins, and this href is the longer one
        // as soon as it exists).
        { href: "/trainer/attendance/history", label: "Historial" },
      );
      break;
    case "representante":
      links.push(
        { href: "/student", label: "Mi cuenta" },
        { href: "/student/payments", label: "Pagos" },
        // The two things a student actually opens the portal to do. Without
        // this entry /student/attendance is reachable only from a panel on the
        // home screen.
        { href: "/student/attendance", label: "Asistencias" },
        // Only a representante manages a representado's medical record — the
        // backend's `incluir_titular=False` on `/fichas-medicas/*` still
        // excludes the titular's own, so "estudiante" (below) never gets this
        // entry: it would point a self-managed student at a screen that 403s.
        { href: "/student/medical-record", label: "Ficha médica" },
      );
      break;
    case "estudiante":
      links.push(
        { href: "/student", label: "Mi cuenta" },
        { href: "/student/payments", label: "Pagos" },
        { href: "/student/attendance", label: "Asistencias" },
      );
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
        links.push({ href: "/student/medical-record", label: "Ficha médica" });
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
 * Human-readable label for a role, in Spanish (matching existing UI).
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
      return "Estudiante";
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
    case "ALUMNO":
      return "Alumno";
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
