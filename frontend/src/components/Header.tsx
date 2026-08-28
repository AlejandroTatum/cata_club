/**
 * Header — Top navigation bar for Cata Club Admin
 *
 * Navigation links use the canonical getNavGroupsForRoles() helper
 * so the nav contract is always consistent across the app. This bar draws
 * them flat: the rótulos of D12d are the sidebar rail’s answer to more than
 * one role, and a horizontal strip has nowhere to put one.
 *
 *  - Unauthenticated: only Inicio and Iniciar Sesión.
 *  - Admin: Admin + Members + Payments.
 *  - Trainer: Trainer panel.
 *  - Responsible payer / account owner: Account portal.
 *
 * The public site's own bar (`InstitutionalHeader`, drawn on the landing and
 * on the three legal documents) is a different composition, but it answers the
 * same session question: see `InstitutionalAccount`.
 */

"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import type { LucideProps } from "lucide-react";
import {
  LayoutGrid,
  CreditCard,
  ClipboardCheck,
  LogIn,
  Menu,
  Percent,
  Tag,
  Handshake,
  X,
  House,
  User,
  Users,
  Calendar,
  FileText,
  History,
  Stethoscope,
  BookOpen,
  BookUser,
} from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { useAuth } from "@/contexts/AuthContext";
import {
  getNavGroupsForRoles,
  userRolesFromBackendRoles,
  type NavLinkDef,
} from "@/lib/auth-utils";
import { isMinor } from "@/app/student/student-utils";
import { hidesTopHeader } from "@/lib/shell-routes";
import { SITE_NAV_SECTIONS, siteSectionHref } from "@/lib/site-navigation";
import { useNotificaciones } from "@/lib/useNotificaciones";
import NotificationBell from "@/components/NotificationBell";
import { AccountMenu, AccountMobileItems } from "@/components/AccountControls";

interface NavLink {
  href: string;
  label: string;
  icon: React.ForwardRefExoticComponent<
    Omit<LucideProps, "ref"> & React.RefAttributes<SVGSVGElement>
  >;
}

/**
 * Map canonical href → lucide icon component.
 * Single source of truth for icon assignment — maps what getNavGroupsForRoles
 * returns to the UI layer.
 *
 * The set is the one named in the plan (Fase 1, item 4): layout-grid, users,
 * trophy, calendar, credit-card, clipboard-check, file-text. It replaces a map
 * where `Users` stood for BOTH "/members" and "/groups" and `Calendar` for
 * BOTH "/attendance" and "/trainer/attendance" — an icon language that could
 * not tell the club's own sections apart. Every icon within a single role's
 * nav is now distinct; the reuse that remains ("/dashboard" and "/trainer"
 * both `LayoutGrid`) is across roles that never see each other's nav, and it
 * is deliberate: both are that role's home.
 */
export const NAV_ICON_MAP: Record<string, React.ForwardRefExoticComponent<
  Omit<LucideProps, "ref"> & React.RefAttributes<SVGSVGElement>
>> = {
  "/": House,
  "/login": LogIn,
  "/dashboard": LayoutGrid,
  "/members": Users,
  "/groups": Calendar,
  "/payments": CreditCard,
  "/discounts": Percent,
  "/sponsors": Handshake,
  "/tarifas": Tag,
  "/attendance": ClipboardCheck,
  "/trainer": LayoutGrid,
  "/trainer/attendance": ClipboardCheck,
  // `History` (a clock turned back), not `Clock`: within this same map
  // time-shaped glyphs already mean scheduling — `Calendar` is "/groups"
  // (Horarios) — and a bare clock would read as "hours", not "what was
  // already taken". It also stays distinct from its two nav neighbours.
  "/trainer/attendance/history": History,
  // `BookUser` — un padrón, que es literalmente lo que la pantalla es: la
  // nómina del club, no una sesión. Glifo propio y no `Users`: ese ya es
  // "/members" del administrador, y una cuenta puede tener los dos roles a la
  // vez, con lo cual el rail dibujaría dos filas distintas con el mismo icono.
  "/trainer/students": BookUser,
  "/reports": FileText,
  "/student": User,
  "/student/payments": CreditCard,
  // Same glyph as the admin's "/attendance": one is the club's attendance
  // record, the other is the family's own slice of it. The roles never see
  // each other's nav, and within the family portal it collides with nothing.
  "/student/attendance": ClipboardCheck,
  "/student/medical-record": Stethoscope,
  // Reachable by every authenticated role (issue #316 hallazgo #53), not just
  // the family portal — same glyph the sidebar's own "Preguntas frecuentes"
  // row already wears. "/profile" has no entry of its own: it falls back to
  // `User` below, the same glyph "/student" already carries, and nothing in
  // this map disambiguates two rows that are never both drawn in the sidebar.
  "/ayuda": BookOpen,
};

/**
 * Build the navigation links from the canonical helper + icon map.
 */
function useNavLinks(): NavLink[] {
  const { isAuthenticated, session } = useAuth();

  return useMemo<NavLink[]>((): NavLink[] => {
    // The account's role, read from the same array the sidebar reads so the
    // two bars cannot offer different things. It carries at most one
    // recognized role since #762 — an account holding two gets no session —
    // so this is the same grant `session.user.role` names, in list form.
    const roles = isAuthenticated && session ? userRolesFromBackendRoles(session.roles) : null;
    // Only an "estudiante" session carries `fechaNacimiento` (see
    // UsuarioEstudiante in src/types/domain.ts) — `getNavGroupsForRoles` itself
    // ignores this flag for every other role, so computing it unconditionally
    // here is safe.
    const studentIsAdult =
      session?.user.role === "estudiante" ? !isMinor(session.user.fechaNacimiento) : false;
    // Flattened: this bar is one horizontal strip on the public routes, with
    // no second line to hang a rótulo on and no vertical room to make one
    // worth the space. The GROUPING is the sidebar's answer to more than one
    // role; the destinations are the same either way, which is what the helper
    // guarantees and what a flat strip needs from it.
    const defs: NavLinkDef[] = getNavGroupsForRoles(roles, studentIsAdult).flatMap(
      (group) => group.links,
    );
    return defs.map((def): NavLink => ({
      href: def.href,
      label: def.label,
      icon: NAV_ICON_MAP[def.href] ?? House,
    }));
  }, [isAuthenticated, session]);
}

/**
 * The public site's menu, from the definition the landing's own navbar reads —
 * see `lib/site-navigation.ts`. This list used to be a second literal right
 * here, and it had drifted: `#proposito` named an id no page has, and
 * Competencias, Galería and Contacto all pointed back at `#inicio`, so four of
 * six links went nowhere or somewhere else (issue #771).
 *
 * `siteSectionHref` and not the landing's bare fragment: this header is drawn
 * on `/terminos`, `/privacidad` and `/permiso-imagen-fetm`, and a bare
 * `#horarios` there names a section of the LEGAL page, which has none — the
 * click would do nothing. `/#horarios` navigates to the landing and then to the
 * section.
 */
const INSTITUTIONAL_LINKS = SITE_NAV_SECTIONS.map((section): { href: string; label: string } => ({
  href: siteSectionHref(section),
  label: section.label,
}));

/**
 * The session slot of the institutional bar — issue #782.
 *
 * This bar is drawn on the three public legal routes, which are precisely the
 * pages a user opens FROM INSIDE the product: accepting a consent, re-reading
 * what they signed. It used to hold a bare "Iniciar sesión" for everyone, so a
 * signed-in reader was told his session did not exist, and a click took him to
 * a login screen he did not need.
 *
 * Three states, and the loading one is not a nicety. The session lives behind
 * an `HttpOnly` cookie that only the BFF can read (see `AuthContext`), so the
 * server-rendered markup — which is also React's first client render — cannot
 * know the answer. Naming either answer there is a guaranteed flash for half
 * the visitors and a swap of one wrong header for a flicker; the slot holds a
 * neutral placeholder of roughly the resolved width instead, so the sections
 * beside it do not shift when the answer lands.
 *
 * What it does NOT do is swap the whole bar for the product's nav. The
 * document's own navigation belongs to the page and not to the visitor, and a
 * bar that changed shape on hydration is the reflow this placeholder exists to
 * avoid.
 */
function InstitutionalAccount(): React.ReactElement {
  const { isAuthenticated, session, isLoading, logout } = useAuth();

  if (isLoading) {
    return <div className="h-9 w-36 animate-pulse rounded-xl bg-white/10" aria-hidden="true" />;
  }

  if (isAuthenticated && session) {
    return <AccountMenu userName={session.user.name} onLogout={logout} />;
  }

  // Also the answer after a hydration outage (`AuthContext` leaves the session
  // null there): with no verdict, the visitor still needs the one door that
  // works for a stranger, and a signed-in user reaching it only sees a login
  // screen he can leave.
  return (
    <Link
      href="/login"
      className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white/65 transition-all duration-200 hover:text-white"
    >
      <User size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
      Iniciar sesión
    </Link>
  );
}

/**
 * The same slot inside the mobile panel. Nothing while the session is still
 * hydrating: the panel only exists after a tap, by which time the answer has
 * landed, and an empty slot cannot claim the wrong one.
 */
function InstitutionalAccountMobile({ onNavigate }: { onNavigate: () => void }): React.ReactElement | null {
  const { isAuthenticated, session, isLoading, logout } = useAuth();

  if (isLoading) {
    return null;
  }

  if (isAuthenticated && session) {
    return (
      <li className="border-t border-white/10 pt-3 mt-3">
        <div className="flex items-center gap-2 px-3.5 py-2 text-xs text-white/65">
          <User size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
          <span className="truncate">{session.user.name}</span>
        </div>
        <AccountMobileItems onNavigate={onNavigate} onLogout={logout} />
      </li>
    );
  }

  return (
    <li className="border-t border-white/10 pt-3 mt-3">
      <Link
        href="/login"
        onClick={onNavigate}
        className="flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-white/65 transition-colors hover:bg-white/[0.08] hover:text-white"
      >
        <LogIn size={ICON.base} strokeWidth={1.5} aria-hidden="true" />
        Iniciar sesión
      </Link>
    </li>
  );
}

function InstitutionalHeader(): React.ReactElement {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback((): void => setMenuOpen(false), []);

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-cata-dark/95 backdrop-blur-md">
      <nav
        aria-label="Navegación principal"
        className="mx-auto flex max-w-8xl items-center justify-between px-4 py-3 sm:px-8 lg:px-12"
      >
        {/* Brand — real logo as identity anchor */}
        <Link href="/" className="flex items-center gap-3">
          <div className="relative h-10 w-10 overflow-hidden rounded-lg">
            <Image
              src="/brand/cata-club-logo.jpeg"
              alt=""
              fill
              className="object-cover"
              sizes="40px"
              priority
            />
          </div>
          <div className="flex flex-col">
            <span className="text-lg font-bold leading-tight tracking-tight text-white">
              Cata Club
            </span>
            <span className="text-2xs font-bold uppercase tracking-caps-wide text-cata-red">
              Tenis de Mesa
            </span>
          </div>
        </Link>

        {/* Desktop nav — institutional links centered */}
        {/* No `aria-current` here: every one of these links leads OFF this page,
            to a section of the landing, so none of them is the current one. The
            comparison that used to sit here weighed `pathname` against `#inicio`
            and could not be true on any route. */}
        <ul className="hidden items-center gap-1 md:flex">
          {INSTITUTIONAL_LINKS.map((link): React.ReactElement => (
            <li key={link.label}>
              <Link
                href={link.href}
                className="rounded-xl px-3.5 py-2 text-sm font-semibold text-white/65 transition-all duration-200 hover:text-white"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>

        {/* Session slot — see `InstitutionalAccount` */}
        <div className="hidden md:flex items-center gap-3">
          <InstitutionalAccount />
        </div>

        {/* Mobile menu button */}
        <button
          type="button"
          onClick={() => setMenuOpen(!menuOpen)}
          className="rounded-xl p-2.5 text-white/65 hover:bg-white/[0.08] hover:text-cata-fuchsia md:hidden"
          aria-label={menuOpen ? "Cerrar menú" : "Abrir menú"}
        >
          {menuOpen ? <X size={ICON.base} strokeWidth={1.5} /> : <Menu size={ICON.base} strokeWidth={1.5} />}
        </button>
      </nav>

      {/* Mobile nav panel */}
      {menuOpen && (
        <div className="border-t border-white/10 bg-cata-dark md:hidden shadow-soft">
          <ul className="space-y-0.5 px-4 py-4">
            {INSTITUTIONAL_LINKS.map((link) => (
              <li key={link.label}>
                <Link
                  href={link.href}
                  onClick={closeMenu}
                  className="flex items-center rounded-xl px-3.5 py-2.5 text-sm font-semibold text-white/65 transition-all duration-200 hover:bg-white/[0.08] hover:text-white"
                >
                  {link.label}
                </Link>
              </li>
            ))}
            <InstitutionalAccountMobile onNavigate={closeMenu} />
          </ul>
        </div>
      )}
    </header>
  );
}

interface HeaderProps {
  hideOnLanding?: boolean;
}

export default function Header({ hideOnLanding = false }: HeaderProps): React.ReactElement | null {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const { isAuthenticated, session, logout, isLoading } = useAuth();
  const links = useNavLinks();
  const { notificaciones, loadError, markRead } = useNotificaciones(isAuthenticated && !!session);

  const closeMenu = useCallback((): void => setMenuOpen(false), []);

  if (hideOnLanding && pathname === "/") {
    return null;
  }

  // The legal documents keep the institutional bar whoever is reading them:
  // the sections it names belong to the PAGE, not to the visitor. What used to
  // be wrong is that this branch also decided the session question — it is
  // taken before any auth check, so every reader was offered "Iniciar sesión",
  // including the administrator who had just clicked through from inside the
  // product (issue #782). That answer now lives in the bar's own session slot,
  // where it can be given per visitor instead of per route.
  const isPublicLegalRoute = ["/terminos", "/privacidad", "/permiso-imagen-fetm"].includes(pathname);
  if (isPublicLegalRoute) {
    return <InstitutionalHeader />;
  }

  // Which routes own their chrome lives in `lib/shell-routes.ts` and is
  // PREFIX-based. It used to be an exact-match Set right here, so chrome
  // flipped mid-flow: `/student` had the sidebar while `/student/add-dependent`,
  // reached by a button on `/student`, fell back to this dark top nav.
  if (hidesTopHeader(pathname)) {
    return null;
  }

  // Landing page gets the institutional header
  if (pathname === "/") {
    return <InstitutionalHeader />;
  }

  // FOUC prevention: show minimal skeleton during session hydration
  if (isLoading) {
    return (
      <header className="sticky top-0 z-50 border-b border-white/10 bg-cata-dark/95 backdrop-blur-md">
        <nav className="mx-auto flex max-w-8xl items-center justify-between px-4 py-3 sm:px-8 lg:px-12">
          <div className="flex items-center gap-3 text-lg font-semibold tracking-tight text-white">
            <div className="h-8 w-8 animate-pulse rounded-lg bg-white/10" />
            <span className="hidden sm:inline">Cata Club</span>
          </div>
        </nav>
      </header>
    );
  }

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-cata-dark/95 backdrop-blur-md">
      <nav className="mx-auto flex max-w-8xl items-center justify-between px-4 py-3 sm:px-8 lg:px-12">
        {/* Brand — real logo as identity anchor */}
        {/*
         * The wordmark beside the logo is `hidden` below `sm`, i.e. removed
         * from the accessibility tree — so on a phone this link had NO
         * accessible name at all: a 32px image with `alt=""` inside an anchor,
         * announced as "link" and nothing else. `aria-label` names the link on
         * every viewport, which lets the image stay decorative (it repeats the
         * wordmark on desktop and would otherwise double it).
         *
         * The label is the wordmark verbatim, not "Ir al inicio": the header
         * already carries a separate "Inicio" nav row, and a second link
         * announcing the same words is two identical destinations by name.
         */}
        <Link
          href="/"
          aria-label="Cata Club"
          className="flex items-center gap-3 text-lg font-semibold tracking-tight text-white"
        >
          <div className="relative h-8 w-8 overflow-hidden rounded-lg">
            <Image
              src="/brand/cata-club-logo.jpeg"
              alt=""
              fill
              className="object-cover"
              sizes="32px"
              priority
            />
          </div>
          <span className="hidden sm:inline">Cata Club</span>
        </Link>

        {/* Desktop nav */}
        <ul className="hidden items-center gap-0.5 md:flex md:flex-wrap">
          {links.map((link): React.ReactElement => {
            const isActive = pathname === link.href;
            return (
              <li key={link.href}>
                <Link
                  href={link.href}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition-all duration-200 ${
                    isActive
                      ? "bg-cata-red/15 text-white"
                      : "text-white/65 hover:bg-white/[0.08] hover:text-white"
                  }`}
                >
                  <link.icon size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
                  {link.label}
                </Link>
              </li>
            );
          })}

          {/* User menu — shown when authenticated */}
          {isAuthenticated && session && (
            <li className="ml-2 flex items-center gap-2 border-l border-white/10 pl-3">
              <NotificationBell notificaciones={notificaciones} loadError={loadError} onMarkRead={markRead} />
              <AccountMenu userName={session.user.name} onLogout={logout} />
            </li>
          )}
        </ul>

        {/* Mobile menu button */}
        <button
          type="button"
          onClick={(): void => setMenuOpen(!menuOpen)}
          className="rounded-xl p-2.5 text-white/65 hover:bg-white/[0.08] hover:text-cata-fuchsia md:hidden"
          aria-label={menuOpen ? "Cerrar menú" : "Abrir menú"}
          aria-expanded={menuOpen}
        >
          {menuOpen ? <X size={ICON.base} strokeWidth={1.5} /> : <Menu size={ICON.base} strokeWidth={1.5} />}
        </button>
      </nav>

      {/* Mobile nav panel */}
      {menuOpen && (
        <div className="border-t border-white/10 bg-cata-dark md:hidden shadow-soft">
          <ul className="space-y-0.5 px-4 py-4">
            {links.map((link): React.ReactElement => {
              const isActive = pathname === link.href;
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    aria-current={isActive ? "page" : undefined}
                    onClick={(): void => setMenuOpen(false)}
                    className={`flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-all duration-200 ${
                      isActive
                        ? "bg-cata-red/15 text-white"
                        : "text-white/65 hover:bg-white/[0.08] hover:text-white"
                    }`}
                  >
                    <link.icon size={ICON.base} strokeWidth={1.5} aria-hidden="true" />
                    {link.label}
                  </Link>
                </li>
              );
            })}

            {/* User section in mobile menu */}
            {isAuthenticated && session && (
              <li className="border-t border-white/10 pt-3 mt-3">
                <div className="flex items-center justify-between gap-2 px-3.5 py-2 text-xs text-white/65">
                  <span className="flex items-center gap-2 truncate">
                    <User size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
                    <span className="truncate">{session.user.name}</span>
                  </span>
                  <NotificationBell notificaciones={notificaciones} loadError={loadError} onMarkRead={markRead} />
                </div>
                <AccountMobileItems onNavigate={closeMenu} onLogout={logout} />
              </li>
            )}
          </ul>
        </div>
      )}
    </header>
  );
}
