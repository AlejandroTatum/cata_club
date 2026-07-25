/**
 * AppShell — the single authenticated shell: coal sidebar + utility topbar +
 * a real, visible page header.
 *
 * Transcribed from `docs/ux/prototipos/_sistema.css` (`.side` 236px, `.disc`
 * 36px white logo disc, `.nav-i` 40px rows with the active red left bar and
 * the yellow ball dot, `.cnt` count badge, `.topbar` 56px, `.canvas`) and
 * from `docs/ux/prototipos/_nav-admin.html` (brand → nav → foot-nav with
 * "Ayuda y soporte" above the user card).
 *
 * Which routes get this shell is decided in ONE place — `lib/shell-routes.ts`
 * — and `Header` hides itself for exactly those routes.
 *
 * The page title used to be `sr-only` here, so no authenticated screen showed
 * its own name: below `lg` the sidebar is a closed drawer, which left a
 * trainer on a phone with nothing but Menú/bell/search to locate themselves.
 * It is now rendered through the `PageHeader` primitive, above `<main>`.
 */

"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { Menu, X, Search, User, ChevronLeft, ChevronRight, MessageCircle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { getNavLinksForRole, getRoleLabel, getUserInitials, type NavLinkDef } from "@/lib/auth-utils";
import { normalizeText } from "@/app/members/members-utils";
import { useNotificaciones } from "@/lib/useNotificaciones";
import { usePendingPaymentsCount } from "@/lib/usePendingPayments";
import { useDismissablePopup } from "@/lib/useDismissablePopup";
import { NAV_ICON_MAP } from "@/components/Header";
import NotificationBell from "@/components/NotificationBell";
import UserMenuDropdown from "@/components/UserMenuDropdown";
import ChatWidget from "@/components/chatbot/ChatWidget";
import { PageHeader } from "@/components/ui";

export interface AppShellProps {
  /** Small uppercase label above the page title (defaults to "Panel de gestión"). */
  eyebrow?: string;
  /** Main page heading — rendered as the visible `<h1>` of the screen. */
  title: string;
  /** Optional supporting line below the title. */
  subtitle?: string;
  /** Optional trailing controls for the page header row. */
  actions?: React.ReactNode;
  /** Page content, rendered in the main content area below the header. */
  children: React.ReactNode;
}

const SIDEBAR_COLLAPSED_KEY = "cata_sidebar_collapsed";

/** The one nav entry that carries a count badge (prototype `_nav-admin.html`). */
const COUNT_BADGE_HREF = "/payments";

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

/**
 * The nav row the current URL belongs to — longest matching prefix wins, so
 * `/trainer/attendance` highlights "Pasar lista" and not "Mi día".
 */
export function resolveActiveHref(navLinks: NavLinkDef[], pathname: string): string | null {
  const matches = navLinks.filter(
    (link) => pathname === link.href || pathname.startsWith(`${link.href}/`),
  );
  if (matches.length === 0) return null;
  return matches.reduce((longest, link) => (link.href.length > longest.href.length ? link : longest))
    .href;
}

/**
 * The brand block's second line. Prototype `_nav-admin.html` uses a fixed
 * per-area label ("Panel de gestión" for staff, "Mi cuenta" for the family
 * portal) — it names the AREA, so it must not be confused with the page's own
 * eyebrow.
 */
function getAreaLabel(role: string | null): string {
  return role === "representante" || role === "estudiante" ? "Mi cuenta" : "Panel de gestión";
}

/** `.nav-i` — 40px row, 10px radius, 13.5px medium label. */
const NAV_ITEM_CLASSES =
  "relative flex h-ctl items-center gap-2.5 rounded-ctl px-3 text-[13.5px] font-medium transition-colors";
const NAV_ITEM_IDLE_CLASSES = "text-white/[0.62] hover:bg-white/[0.07] hover:text-white";
/** `.nav-i.on` — coal highlight, never a red fill: red is reserved for CTA and destructive. */
const NAV_ITEM_ACTIVE_CLASSES = "bg-white/[0.08] font-semibold text-white";

export default function AppShell({
  eyebrow = "Panel de gestión",
  title,
  subtitle,
  actions,
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
  const paletteListId = useId();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const userMenuPanelRef = useRef<HTMLDivElement>(null);
  const userMenuId = useId();
  const [chatOpen, setChatOpen] = useState(false);

  const role = session?.user.role ?? null;
  const navLinks = useMemo<NavLinkDef[]>(
    () => getNavLinksForRole(role).filter((link) => link.href !== "/"),
    [role],
  );
  const activeHref = useMemo(
    (): string | null => resolveActiveHref(navLinks, pathname),
    [navLinks, pathname],
  );
  const pendingPayments = usePendingPaymentsCount(role === "admin");

  const closeUserMenu = useCallback((): void => setUserMenuOpen(false), []);
  useDismissablePopup({
    open: userMenuOpen,
    onClose: closeUserMenu,
    panelRef: userMenuPanelRef,
    triggerRef: userMenuTriggerRef,
  });

  const paletteResults = useMemo<NavLinkDef[]>(() => {
    const term = normalizeText(query);
    if (!term) return navLinks;
    return navLinks.filter((link) => normalizeText(link.label).includes(term));
  }, [navLinks, query]);

  const paletteOptionId = (index: number): string => `${paletteListId}-option-${index}`;

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
    <div className="app-shell flex min-h-screen bg-canvas">
      {/*
       * Sidebar. When closed on a mobile viewport it is hidden outright, not
       * merely translated offscreen: a `-translate-x-full` drawer keeps every
       * descendant focusable, so Tab used to walk keyboard users into 11
       * controls sitting offscreen with no visible focus ring.
       *
       * React 18.3 (see package.json) has no `inert` prop, so this uses the
       * `aria-hidden` + `visibility: hidden` fallback — `visibility: hidden`
       * is what removes the subtree from the tab order, `aria-hidden` removes
       * it from the accessibility tree. `visibility` is transitioned together
       * with `transform` so the closing slide-out still renders.
       */}
      <aside
        aria-hidden={drawerHidden || undefined}
        className={`fixed inset-y-0 left-0 z-40 flex w-[236px] flex-col bg-coal text-white transition-[transform,visibility] duration-200 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${
          collapsed ? "lg:w-[76px]" : ""
        } ${sidebarOpen ? "translate-x-0" : "-translate-x-full"} ${
          drawerHidden ? "invisible" : ""
        }`}
      >
        {/* `.side .brand` — logo on a white disc, club name, area label. */}
        <div className="flex items-center gap-[11px] border-b border-white/[0.08] px-[18px] pb-4 pt-[18px]">
          <Link href="/" className="flex min-w-0 flex-1 items-center gap-[11px]">
            <span className="relative block h-9 w-9 shrink-0 overflow-hidden rounded-full bg-white">
              <Image
                src="/brand/cata-club-logo.jpeg"
                alt="Cata Club"
                fill
                className="object-cover"
                sizes="36px"
              />
            </span>
            <span className={`min-w-0 leading-tight ${collapsed ? "lg:hidden" : ""}`}>
              <span className="block truncate text-[13.5px] font-bold tracking-[-0.01em]">
                Cata Club
              </span>
              <span className="mt-px block truncate text-[9.5px] font-bold uppercase tracking-[0.12em] text-white/[0.42]">
                {getAreaLabel(role)}
              </span>
            </span>
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
         * header row's padding plus the 36px logo already fills the available
         * width, leaving no room for a button in that row — it used to get
         * squeezed out entirely with no way to re-expand. This handle sits
         * outside that row's flex layout, so it stays reachable in both
         * collapsed and expanded states.
         */}
        <button
          type="button"
          onClick={toggleCollapsed}
          className="absolute -right-3 top-6 z-10 hidden h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-coal text-white/60 shadow-md transition-colors hover:bg-white/10 hover:text-white lg:flex"
          aria-label={collapsed ? "Expandir menú" : "Colapsar menú"}
        >
          {collapsed ? (
            <ChevronRight size={14} strokeWidth={1.5} aria-hidden="true" />
          ) : (
            <ChevronLeft size={14} strokeWidth={1.5} aria-hidden="true" />
          )}
        </button>

        <nav
          className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 py-3"
          aria-label="Navegación principal"
        >
          {navLinks.map((link): React.ReactElement => {
            const isActive = link.href === activeHref;
            const Icon = NAV_ICON_MAP[link.href] ?? User;
            const badge = link.href === COUNT_BADGE_HREF ? pendingPayments : null;
            const showBadge = badge !== null && badge > 0;
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={(): void => setSidebarOpen(false)}
                aria-current={isActive ? "page" : undefined}
                title={link.label}
                // The label span is hidden at `lg` while collapsed, and a
                // native `title` tooltip is not reliably exposed to assistive
                // technology — the accessible name has to survive on its own.
                aria-label={showBadge ? `${link.label} — ${badge} pendientes` : link.label}
                className={`${NAV_ITEM_CLASSES} ${
                  isActive ? NAV_ITEM_ACTIVE_CLASSES : NAV_ITEM_IDLE_CLASSES
                }`}
              >
                {isActive && (
                  // `.nav-i.on::before` — 3px red bar pinned to the row's left edge.
                  <span
                    className="absolute inset-y-[9px] left-0 w-[3px] rounded-r-[3px] bg-cata-red"
                    aria-hidden="true"
                  />
                )}
                <Icon size={17} strokeWidth={2} className="shrink-0" aria-hidden="true" />
                <span className={`truncate ${collapsed ? "lg:hidden" : ""}`}>{link.label}</span>
                {showBadge && (
                  // `.nav-i .cnt` — count is already in the accessible name above.
                  <span
                    className="ml-auto inline-flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-cata-red px-1.5 text-[10.5px] font-bold text-white"
                    aria-hidden="true"
                  >
                    {badge}
                  </span>
                )}
                {isActive && !showBadge && (
                  // `.nav-i.on::after` — the yellow ball marks the current row.
                  <span
                    className={`ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-ball ${
                      collapsed ? "lg:hidden" : ""
                    }`}
                    aria-hidden="true"
                  />
                )}
              </Link>
            );
          })}
        </nav>

        {/* `.side .foot-nav` — support entry point, then the user card. */}
        <div className="flex flex-col gap-2 border-t border-white/[0.08] p-2.5">
          <button
            type="button"
            onClick={(): void => {
              setChatOpen(true);
              setSidebarOpen(false);
            }}
            title="Ayuda y soporte"
            aria-label="Ayuda y soporte"
            aria-expanded={chatOpen}
            className={`${NAV_ITEM_CLASSES} ${NAV_ITEM_IDLE_CLASSES} w-full text-left`}
          >
            <MessageCircle size={17} strokeWidth={2} className="shrink-0" aria-hidden="true" />
            <span className={`truncate ${collapsed ? "lg:hidden" : ""}`}>Ayuda y soporte</span>
          </button>

          {session && (
            <div className="relative">
              <button
                ref={userMenuTriggerRef}
                type="button"
                onClick={(): void => setUserMenuOpen((open) => !open)}
                // Not `aria-haspopup="true"` — that is an alias for "menu",
                // and this popup implements none of the menu keyboard contract.
                aria-haspopup="dialog"
                aria-controls={userMenuId}
                aria-expanded={userMenuOpen}
                aria-label={`Menú de cuenta de ${session.user.name}`}
                className={`flex w-full items-center gap-2.5 rounded-ctl bg-white/[0.06] px-2.5 py-2 text-left transition-colors hover:bg-white/[0.1] ${
                  collapsed ? "lg:justify-center lg:px-0" : ""
                }`}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cata-red/[0.28] text-[11px] font-bold">
                  {getUserInitials(session.user.name)}
                </span>
                <span className={`min-w-0 flex-1 leading-tight ${collapsed ? "lg:hidden" : ""}`}>
                  <span className="block truncate text-[12.5px] font-semibold">
                    {session.user.name}
                  </span>
                  <span className="block truncate text-[11px] text-white/45">
                    {getRoleLabel(session.user.role)}
                  </span>
                </span>
              </button>
              {userMenuOpen && (
                <UserMenuDropdown
                  ref={userMenuPanelRef}
                  id={userMenuId}
                  onLogout={logout}
                  onNavigate={closeUserMenu}
                  className={`absolute bottom-full mb-1.5 ${
                    collapsed ? "left-0 lg:w-56" : "left-0 w-full"
                  }`}
                />
              )}
            </div>
          )}
        </div>
      </aside>

      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={(): void => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* `.main` */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* `.topbar` — utility strip only; navigation lives in the sidebar. */}
        <div className="flex h-14 flex-none items-center gap-2.5 border-b border-line bg-canvas px-4 sm:px-[22px]">
          <button
            type="button"
            onClick={(): void => setSidebarOpen(true)}
            className="inline-flex h-ctl items-center gap-1.5 rounded-ctl border border-line-2 bg-paper px-3 text-[12.5px] font-medium text-ink-2 hover:bg-canvas lg:hidden"
            aria-label="Abrir menú principal"
          >
            <Menu size={17} strokeWidth={2} aria-hidden="true" />
            <span>Menú</span>
          </button>
          <span className="flex-1" />
          <button
            type="button"
            onClick={(): void => setPaletteOpen(true)}
            aria-label="Buscar secciones"
            className="flex h-ctl items-center gap-2 rounded-ctl border border-line-2 bg-paper px-3 text-[12.5px] text-ink-3 transition-colors hover:border-ink-3"
          >
            <Search size={15} strokeWidth={2} aria-hidden="true" />
            <span className="hidden sm:inline">Buscar una sección…</span>
            <kbd className="ml-1 hidden rounded-[5px] border border-line-2 px-[5px] py-0.5 text-[10px] font-bold text-ink-3 sm:inline">
              Ctrl K
            </kbd>
          </button>
          {session && (
            <NotificationBell
              notificaciones={notificaciones}
              loadError={loadError}
              onMarkRead={markRead}
              variant="light"
            />
          )}
        </div>

        {/* `.canvas` — the page header row belongs to the shell, above `<main>`. */}
        <div className="flex flex-1 flex-col gap-5 px-4 pb-8 pt-6 sm:px-[26px]">
          <PageHeader eyebrow={eyebrow} title={title} subtitle={subtitle} actions={actions} />
          <main className="min-w-0 flex-1">{children}</main>
        </div>
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
            className="w-full max-w-md overflow-hidden rounded-card bg-paper shadow-elevated"
          >
            <div className="flex items-center gap-2.5 border-b border-line px-4 py-3.5">
              <Search size={16} strokeWidth={2} className="shrink-0 text-ink-3" aria-hidden="true" />
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
                // Arrow keys move a purely visual highlight through the list.
                // Without the combobox/listbox wiring below, that selection is
                // invisible to a screen reader.
                role="combobox"
                aria-expanded
                aria-autocomplete="list"
                aria-controls={paletteListId}
                aria-activedescendant={
                  paletteResults.length > 0 ? paletteOptionId(activeIndex) : undefined
                }
                className="flex-1 border-none bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
              />
              <button
                type="button"
                onClick={(): void => setPaletteOpen(false)}
                className="shrink-0 rounded-md border border-line-2 px-1.5 py-0.5 text-[10px] font-bold text-ink-3"
              >
                ESC
              </button>
            </div>
            <div
              id={paletteListId}
              role="listbox"
              aria-label="Secciones"
              className="max-h-72 overflow-y-auto py-2"
            >
              {paletteResults.length === 0 && (
                <p className="px-4 py-3 text-sm text-ink-3">No se encontraron secciones.</p>
              )}
              {paletteResults.map((link, index): React.ReactElement => {
                const Icon = NAV_ICON_MAP[link.href] ?? User;
                const isHighlighted = index === activeIndex;
                return (
                  <button
                    key={link.href}
                    id={paletteOptionId(index)}
                    role="option"
                    aria-selected={isHighlighted}
                    type="button"
                    onClick={(): void => goTo(link.href)}
                    onMouseEnter={(): void => setActiveIndex(index)}
                    className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm ${
                      isHighlighted ? "bg-coal text-white" : "text-ink hover:bg-canvas"
                    }`}
                  >
                    <Icon size={15} strokeWidth={2} aria-hidden="true" />
                    {link.label}
                    {isHighlighted && (
                      <span
                        className="ml-auto h-1.5 w-1.5 rounded-full bg-ball"
                        aria-hidden="true"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/*
       * Help chat — opened from "Ayuda y soporte" above, never from a floating
       * action button, and never mounted on a public route.
       */}
      {session && <ChatWidget open={chatOpen} onClose={(): void => setChatOpen(false)} />}
    </div>
  );
}
