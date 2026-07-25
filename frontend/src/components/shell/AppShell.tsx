/**
 * AppShell — shared sidebar layout for the admin and trainer screens,
 * matching `design/admin-panel-mockup-v1.html` and its siblings (members,
 * groups, payments, attendance, trainer, trainer/attendance all share this
 * same shell in the mockups).
 *
 * Replaces the top `Header` nav for these routes only — `Header` still
 * hides itself on them (see AUTH_SHELL_ROUTES-style handling there).
 * Navigation links come from the same `getNavLinksForRole` used by
 * `Header`, so role-based visibility stays centralized in one place.
 *
 * Also used by `/student` (see `src/app/student/page.tsx`) — the old
 * student exception that kept it off this shell is obsolete.
 */

"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { Menu, X, Search, User, ChevronLeft, ChevronRight } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { getNavLinksForRole, getRoleLabel, getUserInitials, type NavLinkDef } from "@/lib/auth-utils";
import { normalizeText } from "@/app/members/members-utils";
import { useNotificaciones } from "@/lib/useNotificaciones";
import { NAV_ICON_MAP } from "@/components/Header";
import NotificationBell from "@/components/NotificationBell";
import UserMenuDropdown from "@/components/UserMenuDropdown";

export interface AppShellProps {
  /** Small uppercase label above the page title (defaults to "Panel de gestión"). */
  eyebrow?: string;
  /** Main page heading, shown in the topbar. */
  title: string;
  /** Optional supporting line below the title. */
  subtitle?: string;
  /** Page content, rendered in the main content area below the topbar. */
  children: React.ReactNode;
}

const SIDEBAR_COLLAPSED_KEY = "cata_sidebar_collapsed";

/** Tailwind's `lg` breakpoint — where the sidebar stops being a mobile drawer. */
const DESKTOP_MEDIA_QUERY = "(min-width: 1024px)";

/**
 * Track whether the viewport is at/above `lg`.
 *
 * Needed because the same `<aside>` is a dismissible drawer below `lg` and a
 * permanently visible rail at/above it (`lg:sticky lg:translate-x-0`) — while
 * `sidebarOpen` stays false in both cases. Hiding the drawer purely on
 * `!sidebarOpen` would therefore remove the desktop navigation from the tab
 * order entirely.
 *
 * Defaults to `true` (desktop) so a missing/late `matchMedia` can never hide
 * a sidebar the user can see; the effect corrects it on mobile immediately.
 */
function useIsDesktopViewport(): boolean {
  const [isDesktop, setIsDesktop] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(DESKTOP_MEDIA_QUERY);
    const sync = (): void => setIsDesktop(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  return isDesktop;
}

// `localStorage` can be unavailable (SSR, private browsing, some test
// environments without a full jsdom storage polyfill) — guard both reads and
// writes so the collapse preference degrades to "not persisted" instead of
// crashing the shell.
function readCollapsedPreference(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage?.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

function persistCollapsedPreference(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.setItem(SIDEBAR_COLLAPSED_KEY, String(value));
  } catch {
    // Ignore — persistence is a nice-to-have, not required for the shell to work.
  }
}

export default function AppShell({
  eyebrow = "Panel de gestión",
  title,
  subtitle,
  children,
}: AppShellProps): React.ReactElement {
  const pathname = usePathname();
  const router = useRouter();
  const { session, logout } = useAuth();
  const { notificaciones, loadError, markRead } = useNotificaciones(!!session);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isDesktopViewport = useIsDesktopViewport();
  // Desktop-only collapse state, independent from the mobile drawer
  // (`sidebarOpen` above). Initialized from localStorage so the preference
  // survives navigation/reload; scoped entirely via `lg:` classes so it has
  // no effect on the mobile drawer's own open/close behavior.
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsedPreference);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const paletteInputRef = useRef<HTMLInputElement>(null);
  const paletteDialogRef = useRef<HTMLDivElement>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const role = session?.user.role ?? null;
  const navLinks = useMemo<NavLinkDef[]>(
    () => getNavLinksForRole(role).filter((link) => link.href !== "/"),
    [role],
  );

  const paletteResults = useMemo<NavLinkDef[]>(() => {
    const term = normalizeText(query);
    if (!term) return navLinks;
    return navLinks.filter((link) => normalizeText(link.label).includes(term));
  }, [navLinks, query]);

  // Ctrl+K / Cmd+K opens the "go to" command palette from anywhere in the shell.
  useEffect((): (() => void) => {
    function handleKeyDown(e: globalThis.KeyboardEvent): void {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      }
      if (e.key === "Escape") {
        setPaletteOpen(false);
      }
      // Focus trap: while the command palette is open, Tab/Shift+Tab must
      // cycle only among its own focusable elements — otherwise focus can
      // escape to the page behind the backdrop.
      if (e.key === "Tab" && paletteOpen && paletteDialogRef.current) {
        const focusable = Array.from(
          paletteDialogRef.current.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        const isInsideDialog = active instanceof Node && paletteDialogRef.current.contains(active);
        if (e.shiftKey) {
          if (!isInsideDialog || active === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (!isInsideDialog || active === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return (): void => window.removeEventListener("keydown", handleKeyDown);
  }, [paletteOpen]);

  useEffect((): void => {
    if (paletteOpen) {
      setQuery("");
      setActiveIndex(0);
      paletteInputRef.current?.focus();
    }
  }, [paletteOpen]);

  function toggleCollapsed(): void {
    setCollapsed((prev): boolean => {
      const next = !prev;
      persistCollapsedPreference(next);
      return next;
    });
  }

  function goTo(href: string): void {
    setPaletteOpen(false);
    setSidebarOpen(false);
    router.push(href);
  }

  function handlePaletteKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, paletteResults.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = paletteResults[activeIndex];
      if (target) goTo(target.href);
    }
  }

  // Only the mobile drawer is ever hidden — at `lg` the aside is on screen
  // regardless of `sidebarOpen`.
  const drawerHidden = !isDesktopViewport && !sidebarOpen;

  return (
    <div className="app-shell flex min-h-screen bg-cata-bg">
      {/*
       * Sidebar. When closed on a mobile viewport it is hidden outright, not
       * merely translated offscreen: a `-translate-x-full` drawer keeps every
       * descendant focusable, so Tab used to walk keyboard users into 11
       * controls sitting at x=-256 with no visible focus ring.
       *
       * React 18.3 (see package.json) has no `inert` prop, so this uses the
       * `aria-hidden` + `visibility: hidden` fallback — `visibility: hidden`
       * is what removes the subtree from the tab order, `aria-hidden` removes
       * it from the accessibility tree. `visibility` is transitioned together
       * with `transform` so the closing slide-out still renders.
       */}
      <aside
        aria-hidden={drawerHidden || undefined}
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-cata-black text-white transition-[transform,visibility] duration-200 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${
          collapsed ? "lg:w-[76px]" : ""
        } ${sidebarOpen ? "translate-x-0" : "-translate-x-full"} ${
          drawerHidden ? "invisible" : ""
        }`}
      >
        <div className="flex items-center gap-3 border-b border-white/10 px-5 py-5">
          <Link href="/" className="flex min-w-0 flex-1 items-center gap-3">
            <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-lg">
              <Image src="/brand/cata-club-logo.jpeg" alt="Cata Club" fill className="object-cover" sizes="36px" />
            </div>
            <div className={`min-w-0 leading-tight ${collapsed ? "lg:hidden" : ""}`}>
              <p className="truncate text-sm font-bold">Cata Club</p>
              <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-white/45">
                Panel de gestión
              </p>
            </div>
          </Link>
          <button
            type="button"
            onClick={(): void => setSidebarOpen(false)}
            className="rounded-lg p-1.5 text-white/55 hover:bg-white/10 hover:text-white lg:hidden"
            aria-label="Cerrar menú"
          >
            <X size={18} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>

        {/*
         * Collapse toggle — anchored directly to the sidebar edge instead of
         * living inside the header row above. When collapsed to 76px, the
         * header row's padding (40px) plus the 36px logo already fills the
         * available width, leaving no room for a button in that row — it
         * used to get squeezed out entirely with no way to re-expand. This
         * handle sits outside that row's flex layout, so it stays reachable
         * in both collapsed and expanded states.
         */}
        <button
          type="button"
          onClick={toggleCollapsed}
          className="absolute -right-3 top-6 z-10 hidden h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-cata-black text-white/60 shadow-md transition-colors hover:bg-white/10 hover:text-white lg:flex"
          aria-label={collapsed ? "Expandir menú" : "Colapsar menú"}
        >
          {collapsed ? (
            <ChevronRight size={14} strokeWidth={1.5} aria-hidden="true" />
          ) : (
            <ChevronLeft size={14} strokeWidth={1.5} aria-hidden="true" />
          )}
        </button>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4" aria-label="Navegación principal">
          {navLinks.map((link): React.ReactElement => {
            const isActive = pathname === link.href;
            const Icon = NAV_ICON_MAP[link.href] ?? User;
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={(): void => setSidebarOpen(false)}
                aria-current={isActive ? "page" : undefined}
                title={link.label}
                className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive ? "bg-cata-red/20 text-white" : "text-white/65 hover:bg-white/[0.08] hover:text-white"
                }`}
              >
                <Icon size={17} strokeWidth={1.5} aria-hidden="true" />
                <span className={collapsed ? "lg:hidden" : undefined}>{link.label}</span>
              </Link>
            );
          })}
        </nav>

        {session && (
          <div className="border-t border-white/10 p-4">
            <div className="relative">
              <button
                type="button"
                onClick={(): void => setUserMenuOpen((open) => !open)}
                aria-haspopup="true"
                aria-expanded={userMenuOpen}
                aria-label={`Menú de cuenta de ${session.user.name}`}
                className={`flex w-full items-center gap-2.5 rounded-xl bg-white/[0.06] px-3 py-2.5 text-left transition-colors hover:bg-white/[0.1] ${
                  collapsed ? "lg:justify-center lg:px-0" : ""
                }`}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cata-red/25 text-xs font-bold">
                  {getUserInitials(session.user.name)}
                </div>
                <div className={`min-w-0 flex-1 leading-tight ${collapsed ? "lg:hidden" : ""}`}>
                  <p className="truncate text-sm font-semibold">{session.user.name}</p>
                  <p className="truncate text-xs text-white/45">{getRoleLabel(session.user.role)}</p>
                </div>
              </button>
              {userMenuOpen && (
                <UserMenuDropdown
                  onLogout={logout}
                  onNavigate={(): void => setUserMenuOpen(false)}
                  className={`absolute bottom-full mb-1.5 ${collapsed ? "left-0 lg:w-56" : "left-0 w-full"}`}
                />
              )}
            </div>
          </div>
        )}
      </aside>

      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={(): void => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/*
         * Slim utility strip — navigation is handled entirely by the
         * sidebar now, so no visible page title/subtitle here. `eyebrow`/
         * `title`/`subtitle` are still accepted (every AppShell caller
         * passes them) and rendered as an sr-only heading for page
         * semantics/accessibility, just not shown visually. The mobile menu
         * toggle stays — it's the only way to open the sidebar drawer on
         * small screens where it's hidden by default.
         */}
        <div className="flex items-center justify-end gap-2 bg-cata-bg px-5 py-3 shadow-soft sm:px-8">
          <p className="sr-only">{eyebrow}</p>
          <h1 className="sr-only">{title}</h1>
          {subtitle && <p className="sr-only">{subtitle}</p>}
          <button
            type="button"
            onClick={(): void => setSidebarOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-cata-border px-3 py-2.5 text-sm font-medium text-cata-text/65 hover:bg-cata-bg lg:hidden"
            aria-label="Abrir menú principal"
          >
            <Menu size={18} strokeWidth={1.5} aria-hidden="true" />
            <span>Menú</span>
          </button>
          {session && (
            <NotificationBell
              notificaciones={notificaciones}
              loadError={loadError}
              onMarkRead={markRead}
              variant="light"
            />
          )}
          <button
            type="button"
            onClick={(): void => setPaletteOpen(true)}
            aria-label="Buscar secciones"
            className="flex items-center gap-2 rounded-xl border border-cata-border bg-cata-bg px-3.5 py-2.5 text-sm text-cata-text/50 transition-colors hover:border-cata-text/20"
          >
            <Search size={15} strokeWidth={1.5} aria-hidden="true" />
            <span className="hidden sm:inline">Buscar una sección…</span>
            <kbd className="ml-1 hidden rounded-md border border-cata-border bg-cata-surface px-1.5 py-0.5 text-[10px] font-semibold text-cata-text/45 sm:inline">
              Ctrl K
            </kbd>
          </button>
        </div>

        <main className="flex-1 px-5 py-8 sm:px-8">{children}</main>
      </div>

      {/* Command palette — "go to" navigation search, role-aware */}
      {paletteOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-4 pt-24"
          onClick={(): void => setPaletteOpen(false)}
        >
          <div
            ref={paletteDialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Buscador de secciones"
            onClick={(e): void => e.stopPropagation()}
            className="w-full max-w-md overflow-hidden rounded-2xl bg-cata-surface shadow-elevated"
          >
            <div className="flex items-center gap-2.5 border-b border-cata-border px-4 py-3.5">
              <Search size={16} strokeWidth={1.5} className="shrink-0 text-cata-text/45" aria-hidden="true" />
              <input
                ref={paletteInputRef}
                type="text"
                value={query}
                onChange={(e): void => {
                  setQuery(e.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={handlePaletteKeyDown}
                placeholder="Ir a una sección…"
                aria-label="Ir a una sección"
                className="flex-1 border-none bg-transparent text-sm text-cata-text outline-none placeholder:text-cata-text/35"
              />
              <button
                type="button"
                onClick={(): void => setPaletteOpen(false)}
                className="shrink-0 rounded-md border border-cata-border px-1.5 py-0.5 text-[10px] font-semibold text-cata-text/45"
              >
                ESC
              </button>
            </div>
            <div className="max-h-72 overflow-y-auto py-2">
              {paletteResults.length === 0 && (
                <p className="px-4 py-3 text-sm text-cata-text/45">No se encontraron secciones.</p>
              )}
              {paletteResults.map((link, index): React.ReactElement => {
                const Icon = NAV_ICON_MAP[link.href] ?? User;
                return (
                  <button
                    key={link.href}
                    type="button"
                    onClick={(): void => goTo(link.href)}
                    onMouseEnter={(): void => setActiveIndex(index)}
                    className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm ${
                      index === activeIndex ? "bg-cata-red/10 text-cata-red" : "text-cata-text hover:bg-cata-bg"
                    }`}
                  >
                    <Icon size={15} strokeWidth={1.5} aria-hidden="true" />
                    {link.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
