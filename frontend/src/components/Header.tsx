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
 */

"use client";

import { useCallback, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import type { LucideProps } from "lucide-react";
import {
  LayoutGrid,
  CreditCard,
  ClipboardCheck,
  LogIn,
  LogOut,
  Menu,
  Percent,
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
import { useDismissablePopup } from "@/lib/useDismissablePopup";
import { useNotificaciones } from "@/lib/useNotificaciones";
import NotificationBell from "@/components/NotificationBell";
import UserMenuDropdown from "@/components/UserMenuDropdown";

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
    // Every role the account holds, not the one it collapses to: an account
    // that is both trainer and player has to reach both from here as well.
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

const INSTITUTIONAL_LINKS = [
  { href: "#inicio", label: "Inicio" },
  { href: "#proposito", label: "Nosotros" },
  { href: "#valores", label: "Formación" },
  { href: "#inicio", label: "Competencias" },
  { href: "#inicio", label: "Galería" },
  { href: "#inicio", label: "Contacto" },
];

interface InstitutionalHeaderProps {
  pathname: string;
}

function InstitutionalHeader({ pathname }: InstitutionalHeaderProps): React.ReactElement {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-cata-dark/95 backdrop-blur-md">
      <nav className="mx-auto flex max-w-8xl items-center justify-between px-4 py-3 sm:px-8 lg:px-12">
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
        <ul className="hidden items-center gap-1 md:flex">
          {INSTITUTIONAL_LINKS.map((link) => {
            const isActive = pathname === link.href;
            return (
              <li key={link.label}>
                <Link
                  href={link.href}
                  aria-current={isActive ? "page" : undefined}
                  className="rounded-xl px-3.5 py-2 text-sm font-semibold text-white/65 transition-all duration-200 hover:text-white"
                >
                  {link.label}
                </Link>
              </li>
            );
          })}
        </ul>

        {/* Login button */}
        <div className="hidden md:flex items-center gap-3">
          <Link
            href="/login"
            className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white/65 transition-all duration-200 hover:text-white"
          >
            <User size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
            Iniciar sesión
          </Link>
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
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center rounded-xl px-3.5 py-2.5 text-sm font-semibold text-white/65 transition-all duration-200 hover:bg-white/[0.08] hover:text-white"
                >
                  {link.label}
                </Link>
              </li>
            ))}
            <li className="border-t border-white/10 pt-3 mt-3">
              <Link
                href="/login"
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-white/65 transition-colors hover:bg-white/[0.08] hover:text-white"
              >
                <LogIn size={ICON.base} strokeWidth={1.5} aria-hidden="true" />
                Iniciar sesión
              </Link>
            </li>
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
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const userMenuPanelRef = useRef<HTMLDivElement>(null);
  const userMenuId = useId();
  const { isAuthenticated, session, logout, isLoading } = useAuth();
  const links = useNavLinks();
  const { notificaciones, loadError, markRead } = useNotificaciones(isAuthenticated && !!session);

  const closeUserMenu = useCallback((): void => setUserMenuOpen(false), []);
  useDismissablePopup({
    open: userMenuOpen,
    onClose: closeUserMenu,
    panelRef: userMenuPanelRef,
    triggerRef: userMenuTriggerRef,
  });

  if (hideOnLanding && pathname === "/") {
    return null;
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
    return <InstitutionalHeader pathname={pathname} />;
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
            <li className="relative ml-2 flex items-center gap-2 border-l border-white/10 pl-3">
              <NotificationBell notificaciones={notificaciones} loadError={loadError} onMarkRead={markRead} />
              <button
                ref={userMenuTriggerRef}
                type="button"
                onClick={(): void => setUserMenuOpen((open) => !open)}
                // `aria-haspopup="true"` is an alias for "menu"; this popup is
                // a labelled panel, not a menu.
                aria-haspopup="dialog"
                aria-controls={userMenuId}
                aria-expanded={userMenuOpen}
                aria-label={`Menú de cuenta de ${session.user.name}`}
                className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-white/65 transition-colors hover:bg-white/[0.08] hover:text-white"
              >
                <User size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
                <span className="max-w-[120px] truncate">{session.user.name}</span>
              </button>
              {userMenuOpen && (
                <UserMenuDropdown
                  ref={userMenuPanelRef}
                  id={userMenuId}
                  onLogout={logout}
                  onNavigate={closeUserMenu}
                  className="absolute right-0 top-full mt-1.5 w-40"
                />
              )}
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
                <Link
                  href="/profile"
                  onClick={(): void => setMenuOpen(false)}
                  className="flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-white/65 transition-colors hover:bg-white/[0.08] hover:text-white"
                >
                  <User size={ICON.base} strokeWidth={1.5} aria-hidden="true" />
                  Perfil
                </Link>
                <button
                  type="button"
                  onClick={(): void => {
                    logout();
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-white/65 transition-colors hover:bg-white/[0.08] hover:text-cata-red"
                >
                  <LogOut size={ICON.base} strokeWidth={1.5} aria-hidden="true" />
                  Cerrar Sesión
                </button>
              </li>
            )}
          </ul>
        </div>
      )}
    </header>
  );
}
