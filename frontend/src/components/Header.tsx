/**
 * Header — Top navigation bar for Cata Club Admin
 *
 * Navigation links use the canonical getNavLinksForRole() helper
 * so the nav contract is always consistent across the app.
 *
 *  - Unauthenticated: only Inicio and Iniciar Sesión.
 *  - Admin: Admin + Members + Payments.
 *  - Trainer: Trainer panel.
 *  - Responsible payer / account owner: Account portal.
 */

"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import type { LucideProps } from "lucide-react";
import {
  LayoutDashboard,
  ShieldCheck,
  LogIn,
  LogOut,
  Menu,
  X,
  House,
  GraduationCap,
  User,
  Users,
  Calendar,
  Trophy,
  FileText,
  CreditCard,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { getNavLinksForRole, type NavLinkDef } from "@/lib/auth-utils";
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
 * Single source of truth for icon assignment — maps what getNavLinksForRole
 * returns to the UI layer.
 */
export const NAV_ICON_MAP: Record<string, React.ForwardRefExoticComponent<
  Omit<LucideProps, "ref"> & React.RefAttributes<SVGSVGElement>
>> = {
  "/": House,
  "/login": LogIn,
  "/dashboard": LayoutDashboard,
  "/members": Users,
  "/ranking": Trophy,
  "/groups": Users,
  "/payments": ShieldCheck,
  "/attendance": Calendar,
  "/trainer": GraduationCap,
  "/trainer/attendance": Calendar,
  "/trainer/nivel": Trophy,
  "/reports": FileText,
  "/student": GraduationCap,
  "/student/payments": CreditCard,
};

/**
 * Build the navigation links from the canonical helper + icon map.
 */
function useNavLinks(): NavLink[] {
  const { isAuthenticated, session } = useAuth();

  return useMemo<NavLink[]>((): NavLink[] => {
    const role = isAuthenticated && session ? session.user.role : null;
    const defs: NavLinkDef[] = getNavLinksForRole(role);
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
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-cata-red">
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
                  className="rounded-xl px-3.5 py-2 text-sm font-medium text-white/65 transition-all duration-200 hover:text-white"
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
            className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-white/65 transition-all duration-200 hover:text-white"
          >
            <User size={15} strokeWidth={1.5} aria-hidden="true" />
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
          {menuOpen ? <X size={20} strokeWidth={1.5} /> : <Menu size={20} strokeWidth={1.5} />}
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
                  className="flex items-center rounded-xl px-3.5 py-2.5 text-sm font-medium text-white/65 transition-all duration-200 hover:bg-white/[0.08] hover:text-white"
                >
                  {link.label}
                </Link>
              </li>
            ))}
            <li className="border-t border-white/10 pt-3 mt-3">
              <Link
                href="/login"
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium text-white/65 transition-colors hover:bg-white/[0.08] hover:text-white"
              >
                <LogIn size={17} strokeWidth={1.5} aria-hidden="true" />
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

/**
 * Public auth screens (login, register, forgot-password) render their own
 * full-bleed split-screen shell (see `AuthShell`) with a dark brand panel
 * that already carries identity + a "volver al sitio" link — the app
 * header would duplicate that and break the full-height layout.
 */
const AUTH_SHELL_ROUTES = new Set(["/login", "/forgot-password"]);

/**
 * Routes that render their own sidebar shell (see `AppShell`), which
 * already carries identity, navigation, and a logout control — the top
 * header would duplicate that. `/student/enroll` keeps the top-nav
 * header since its wizard is out of scope for the AppShell migration.
 */
const APP_SHELL_ROUTES = new Set([
  "/dashboard",
  "/members",
  "/ranking",
  "/groups",
  "/payments",
  "/attendance",
  "/trainer",
  "/trainer/attendance",
  "/trainer/nivel",
  "/reports",
  "/student",
  "/student/payments",
  "/student/enroll",
  "/student/add-dependent",
  "/profile",
]);

export default function Header({ hideOnLanding = false }: HeaderProps): React.ReactElement | null {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const { isAuthenticated, session, logout, isLoading } = useAuth();
  const links = useNavLinks();
  const { notificaciones, loadError, markRead } = useNotificaciones(isAuthenticated && !!session);

  if (hideOnLanding && pathname === "/") {
    return null;
  }

  if (AUTH_SHELL_ROUTES.has(pathname) || APP_SHELL_ROUTES.has(pathname)) {
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
        <Link
          href="/"
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
                  className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition-all duration-200 ${
                    isActive
                      ? "bg-cata-red/15 text-white"
                      : "text-white/65 hover:bg-white/[0.08] hover:text-white"
                  }`}
                >
                  <link.icon size={15} strokeWidth={1.5} aria-hidden="true" />
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
                type="button"
                onClick={(): void => setUserMenuOpen((open) => !open)}
                aria-haspopup="true"
                aria-expanded={userMenuOpen}
                aria-label={`Menú de cuenta de ${session.user.name}`}
                className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-medium text-white/65 transition-colors hover:bg-white/[0.08] hover:text-white"
              >
                <User size={13} strokeWidth={1.5} aria-hidden="true" />
                <span className="max-w-[120px] truncate">{session.user.name}</span>
              </button>
              {userMenuOpen && (
                <UserMenuDropdown
                  onLogout={logout}
                  onNavigate={(): void => setUserMenuOpen(false)}
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
          {menuOpen ? <X size={20} strokeWidth={1.5} /> : <Menu size={20} strokeWidth={1.5} />}
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
                    className={`flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-all duration-200 ${
                      isActive
                        ? "bg-cata-red/15 text-white"
                        : "text-white/65 hover:bg-white/[0.08] hover:text-white"
                    }`}
                  >
                    <link.icon size={17} strokeWidth={1.5} aria-hidden="true" />
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
                    <User size={14} strokeWidth={1.5} aria-hidden="true" />
                    <span className="truncate">{session.user.name}</span>
                  </span>
                  <NotificationBell notificaciones={notificaciones} loadError={loadError} onMarkRead={markRead} />
                </div>
                <Link
                  href="/profile"
                  onClick={(): void => setMenuOpen(false)}
                  className="flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium text-white/65 transition-colors hover:bg-white/[0.08] hover:text-white"
                >
                  <User size={17} strokeWidth={1.5} aria-hidden="true" />
                  Perfil
                </Link>
                <button
                  type="button"
                  onClick={(): void => {
                    logout();
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium text-white/65 transition-colors hover:bg-white/[0.08] hover:text-cata-red"
                >
                  <LogOut size={17} strokeWidth={1.5} aria-hidden="true" />
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
