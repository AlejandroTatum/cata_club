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
 */
export function getNavLinksForRole(role: UserRole | null): NavLinkDef[] {
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
        { href: "/ranking", label: "Niveles" },
        { href: "/groups", label: "Horarios" },
        { href: "/payments", label: "Membresías y Pagos" },
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
        // The prototype `docs/ux/prototipos/19-entrenador.html` dropped this
        // row on the premise that trainers do not assign levels. They do:
        // `/trainer/nivel` is a live screen and the backend grants ENTRENADOR
        // both `asignar-nivel-inicial` and `mover-de-nivel`. The 403 that
        // prompted the removal came from the roster endpoint, and is fixed —
        // the screen now reads `GET /ranking/alumnos-con-nivel`.
        //
        // "Niveles", not "Nivel": `/trainer/nivel` renders the very same
        // `NivelLadderScreen` the admin's `/ranking` renders, under the same
        // title. One screen, one name, whoever is reading the sidebar.
        { href: "/trainer/nivel", label: "Niveles" },
      );
      break;
    case "representante":
    case "estudiante":
      links.push(
        { href: "/student", label: "Mi cuenta" },
        { href: "/student/payments", label: "Pagos" },
        // The two things a student actually opens the portal to do. Without
        // this entry /student/attendance is reachable only from a panel on the
        // home screen.
        { href: "/student/attendance", label: "Asistencias" },
      );
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
