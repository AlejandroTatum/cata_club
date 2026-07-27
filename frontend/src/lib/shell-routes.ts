/**
 * Which chrome a route gets — the single source of truth shared by `Header`
 * (which hides itself) and by the pages that mount `AppShell`.
 *
 * Why this exists: the rule used to be an exact-match `Set` inside
 * `Header.tsx`, so chrome flipped in the middle of a flow. `/student` got
 * the light sidebar while `/student/add-dependent` — reached by a button on
 * `/student` — got the dark top nav. Matching is prefix-based here so a
 * whole flow keeps one shell.
 *
 * Pure module (no React, no browser APIs) so the routing contract can be
 * unit-tested without mounting anything.
 */

export type ShellKind =
  /** Sidebar shell (`AppShell`): authenticated club sections. */
  | "app"
  /** Split-screen auth shell (`AuthShell`): it carries its own identity panel. */
  | "auth"
  /** The page draws its own full-screen composition and wants no app chrome. */
  | "standalone"
  /** Public site chrome: the institutional/top navigation from `Header`. */
  | "public";

/**
 * Public auth screens render their own full-bleed split-screen shell (see
 * `AuthShell`) with a dark brand panel that already carries identity plus a
 * "volver al sitio" link.
 */
const AUTH_SHELL_PREFIXES = [
  "/login",
  "/forgot-password",
  // `/reset-password` was missing here, so it was the one credential screen
  // that got the public top header stacked on top of its own composition —
  // the "hoy rompe el layout" flag on `docs/ux/prototipos/04-restablecer-
  // contrasenia.html`. It renders `AuthShell` now, so it must claim the auth
  // chrome like its three siblings.
  "/reset-password",
] as const;

/**
 * Screens that own their entire composition.
 *
 * `/unauthorized` is deliberately here: prototype `26-sin-rol.html` states
 * the decision in the note — *"Va sin sidebar — una cuenta sin rol no [tiene
 * a dónde navegar]"*. A dark top nav whose only link is "Inicio" was the
 * worst of both worlds.
 */
const STANDALONE_PREFIXES = [
  "/unauthorized",
  /*
   * `/student/enroll` is the public enrollment funnel — the landing links
   * straight to it and `middleware-utils.ts` lists it in `PUBLIC_EXCEPTIONS`
   * — so it must never inherit the `/student` AppShell below. It used to be
   * routed to "public" for that reason, but that bought it the institutional
   * top `Header`, stacked over a wizard that already draws its own progress
   * header and stepper: two horizontal bars competing on the same screen.
   *
   * Standalone expresses the actual intent. It still wins over `/student`
   * (checked first, same as before) and still implies no session, while
   * matching prototype `05-inscripcion.html`, which draws the funnel
   * shell-less (`.app plain`).
   */
  "/student/enroll",
] as const;

/**
 * Sections that render `AppShell`. Prefix-based: every descendant of a
 * section keeps the section's chrome unless it is listed as a public
 * exception above.
 */
const APP_SHELL_PREFIXES = [
  "/dashboard",
  "/members",
  "/ranking",
  "/groups",
  "/payments",
  "/attendance",
  "/trainer",
  "/reports",
  "/student",
  "/profile",
  // `/admin/crear-cuenta` (admin account CRUD) renders `AppShell` itself.
  "/admin",
  // `/ayuda` renders `AppShell` and is deliberately reachable without a
  // session: the two questions asked most often — when does my child train,
  // and how do I sign in — come from people who are not signed in yet.
  "/ayuda",
] as const;

/** `/trainer` matches `/trainer` and `/trainer/attendance`, never `/trainers`. */
function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function matchesAny(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => matchesPrefix(pathname, prefix));
}

/**
 * Resolve the chrome a pathname gets. Order matters: the auth and standalone
 * prefixes are checked before the app-shell prefixes they may live under, so
 * `/student/enroll` never inherits `/student`'s shell.
 */
export function resolveShellKind(pathname: string): ShellKind {
  if (matchesAny(pathname, AUTH_SHELL_PREFIXES)) return "auth";
  if (matchesAny(pathname, STANDALONE_PREFIXES)) return "standalone";
  if (matchesAny(pathname, APP_SHELL_PREFIXES)) return "app";
  return "public";
}

/** True when `Header` must render nothing because the route owns its chrome. */
export function hidesTopHeader(pathname: string): boolean {
  return resolveShellKind(pathname) !== "public";
}
