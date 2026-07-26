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
import {
  Menu,
  X,
  Search,
  User,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  MoreHorizontal,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { getNavLinksForRole, getRoleLabel, getUserInitials, type NavLinkDef } from "@/lib/auth-utils";
import { normalizeText } from "@/app/members/members-utils";
import { useNotificaciones } from "@/lib/useNotificaciones";
import { usePendingPaymentsCount } from "@/lib/usePendingPayments";
import { useDismissablePopup } from "@/lib/useDismissablePopup";
import { NAV_ICON_MAP } from "@/components/Header";
import NotificationBell from "@/components/NotificationBell";
import UserMenuDropdown from "@/components/UserMenuDropdown";
import { openHelpChat, useHelpChatOpen } from "@/components/chatbot/help-chat-store";
import { PageHeader } from "@/components/ui";

/**
 * The assistant's open-state contract moved to `components/chatbot`, where the
 * single panel now lives (`HelpChatDock`, mounted once in the root layout).
 * Re-exported here because screens inside the shell — the trainer's "Avisar al
 * club" — have always imported it from the shell, and that is still the right
 * place for a screen to reach for it.
 */
export {
  OPEN_HELP_CHAT_EVENT,
  openHelpChat,
  type OpenHelpChatDetail,
} from "@/components/chatbot/help-chat-store";

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

/** Target of the skip link — the `<main>` element every screen renders into. */
export const MAIN_CONTENT_ID = "contenido-principal";

/** The one nav entry that carries a count badge (prototype `_nav-admin.html`). */
const COUNT_BADGE_HREF = "/payments";

/** Tailwind's `lg` breakpoint — where the sidebar stops being a mobile drawer. */
const DESKTOP_MEDIA_QUERY = "(min-width: 1024px)";

/**
 * The bottom tab bar for admin on a phone (`docs/ux/prototipos/27-movil.html`).
 *
 * Four destinations within thumb reach; everything else lives behind "Más",
 * which opens the SAME drawer the hamburger used to open — this is a layer
 * over the existing shell, not a replacement for it, so the drawer's
 * `aria-hidden`/`visibility` handling is untouched.
 *
 * The labels are deliberately shorter than the sidebar's ("Panel", not "Panel
 * de Control"): a 4-up tab bar at 390px has ~90px per label.
 */
const MOBILE_TABS: { href: string; label: string }[] = [
  { href: "/dashboard", label: "Panel" },
  { href: "/members", label: "Miembros" },
  { href: "/payments", label: "Pagos" },
];

/** `.phone .tabs2 a` — 10px label under a 19px icon, ≥44px of touch target. */
const TAB_CLASSES =
  "flex min-h-[44px] flex-1 flex-col items-center justify-center gap-[3px] rounded-lg " +
  "text-[10px] font-semibold transition-colors";

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
  // Seeded with `matches[0]` rather than relying on `reduce`'s no-initial-value
  // form: the guard above already makes an empty array impossible, but an
  // unseeded reduce throws on one, and the guard and the reduce can drift apart.
  return matches.reduce(
    (longest, link) => (link.href.length > longest.href.length ? link : longest),
    matches[0],
  ).href;
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
  // The panel itself is `HelpChatDock`'s, mounted once in the root layout —
  // the shell only triggers it and reports its state.
  const chatOpen = useHelpChatOpen();

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

  /**
   * The tab bar is the admin's phone navigation. Other roles keep the
   * hamburger: a trainer has two destinations, and a 4-up bar with two empty
   * slots is worse than a menu.
   */
  const showMobileTabs = role === "admin";
  const activeTab = MOBILE_TABS.find(
    (tab) => pathname === tab.href || pathname.startsWith(`${tab.href}/`),
  );

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
       * Skip link — the first thing in the tab order, because everything after
       * it is chrome: an authenticated page opened Tab into the sidebar's
       * brand link and then walked 10+ navigation rows before reaching the
       * screen's own content, on every page, every time.
       *
       * Same behaviour as the landing's (`landing.css:63-64`): parked off the
       * top edge, slid to 16px on `:focus-visible` only — a mouse user never
       * sees it — at the 48px the landing uses.
       */}
      <a
        href={`#${MAIN_CONTENT_ID}`}
        className="fixed left-4 top-[-100px] z-50 inline-flex min-h-[48px] items-center rounded-ctl bg-cata-red px-5 text-sm font-bold text-white transition-[top] duration-150 focus-visible:top-4"
      >
        Saltar al contenido
      </a>
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
              {/* 50%, not the spec's 42%: white at 0.42 over `coal` composites
                  to 4.10:1, under AA. At 0.50 it measures 5.36:1 and still
                  reads as the quieter second line under the club name. */}
              <span className="mt-px block truncate text-[9.5px] font-bold uppercase tracking-[0.12em] text-white/50">
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
              openHelpChat();
              setSidebarOpen(false);
            }}
            title="Ayuda y soporte"
            aria-label="Ayuda y soporte"
            aria-expanded={chatOpen}
            className={`${NAV_ITEM_CLASSES} ${NAV_ITEM_IDLE_CLASSES} w-full text-left`}
          >
            {/*
              * `CircleHelp`, not a speech bubble: the row asks a question,
              * and a chat glyph named the mechanism rather than the errand.
              * `LifeBuoy` is the other conventional support mark and it was
              * tried first — at this size its six inner strokes collapse into
              * a smudge on the dark rail, while a question mark stays a
              * question mark. Legibility at 17-20px wins.
              *
              * The glyph is drawn at 18px inside a 17px box. Every nav icon
              * above is a 17px square-ish outline; a ring at the same nominal
              * size reads visibly smaller because a circle only fills ~79% of
              * its box, so it gets one point back optically while the box —
              * and therefore the label column, measured at x=49 on both —
              * stays on the nav grid. The lighter stroke compensates for the
              * extra point of size.
              */}
            <span
              className="flex h-[17px] w-[17px] shrink-0 items-center justify-center"
              aria-hidden="true"
            >
              <CircleHelp size={18} strokeWidth={1.75} />
            </span>
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
                  {/* Same correction as the brand's area label: the user card
                      sits on `bg-white/[0.06]` over `coal` (#212124), where
                      white at 0.45 is 4.35:1. At 0.50 it measures 5.04:1. */}
                  <span className="block truncate text-[11px] text-white/50">
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
        {/*
         * `.topbar` — utility strip only; navigation lives in the sidebar.
         *
         * Two things the prototype got wrong and this row now fixes:
         *
         * 1. It carried a `border-b`. The strip and the page beneath it are
         *    THE SAME COLOUR (both `canvas`), so the rule separated nothing —
         *    it just drew a horizontal line under the search field and pushed
         *    the page title away into a second slab. The row is not sticky
         *    either, so there is no scroll case where content slides under it
         *    and needs an edge. It is gone; the utility controls and the page
         *    title now read as one band on one surface.
         *
         * 2. Its horizontal padding was 22px against the content column's
         *    26px, so the search box and the bell hung 4px outside the right
         *    edge of every card and every page action below them. Both
         *    columns are now 26px (16px on phones) and share one edge.
         */}
        <div className="flex h-14 flex-none items-center gap-2.5 bg-canvas px-4 sm:px-[26px]">
          {/* The hamburger is the phone navigation for every role EXCEPT
              admin, whose destinations moved to the bottom tab bar below
              (prototype `27-movil.html`: "una tab bar inferior que sustituye
              al drawer con hamburguesa solo en pantalla chica"). */}
          {!showMobileTabs && (
            <button
              type="button"
              onClick={(): void => setSidebarOpen(true)}
              className="inline-flex h-ctl items-center gap-1.5 rounded-ctl border border-line-2 bg-paper px-3 text-[12.5px] font-medium text-ink-2 hover:bg-sunken lg:hidden"
              aria-label="Abrir menú principal"
            >
              <Menu size={17} strokeWidth={2} aria-hidden="true" />
              <span>Menú</span>
            </button>
          )}
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

        {/* `.canvas` — the page header row belongs to the shell, above `<main>`.
            The extra bottom padding clears the fixed tab bar; without it the
            last row of every admin list sits under it.

            `pt-3`, was `pt-6`: with the divider removed the title no longer
            opens a second slab, so it only needs to clear the utility row —
            12px under a control that already carries 8px of its own bottom
            margin. Measured at 1440×900: the eyebrow now starts 20px below
            the search box (it was 32.5px below the box and 24px below the
            rule), and the h1 rises from y=98.8 to y=86.8. */}
        <div
          className={`flex flex-1 flex-col gap-5 px-4 pt-3 sm:px-[26px] ${
            showMobileTabs ? "pb-[78px] lg:pb-8" : "pb-8"
          }`}
        >
          <PageHeader eyebrow={eyebrow} title={title} subtitle={subtitle} actions={actions} />
          {/* `tabIndex={-1}` so the skip link actually MOVES focus here rather
              than only scrolling: a `<main>` is not focusable by default, and
              a fragment jump to a non-focusable target leaves the caret where
              it was, so the next Tab returns to the chrome. -1 keeps it out of
              the sequential tab order (and out of the system focus ring's
              selector, so no box is drawn around the whole page). */}
          <main id={MAIN_CONTENT_ID} tabIndex={-1} className="min-w-0 flex-1 outline-none">
            {children}
          </main>
        </div>

        {/* `.phone .tabs2` — 62px, paper, hairline on top. Phone only. */}
        {showMobileTabs && (
          <nav
            aria-label="Navegación principal (móvil)"
            className="fixed inset-x-0 bottom-0 z-30 flex h-[62px] items-stretch gap-1 border-t border-line bg-paper px-2 pb-2.5 pt-1.5 lg:hidden"
          >
            {MOBILE_TABS.map((tab): React.ReactElement => {
              const Icon = NAV_ICON_MAP[tab.href] ?? User;
              const isActive = activeTab?.href === tab.href;
              const badge = (tab.href === COUNT_BADGE_HREF ? pendingPayments : null) ?? 0;
              const showBadge = badge > 0;
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  aria-current={isActive ? "page" : undefined}
                  aria-label={showBadge ? `${tab.label} — ${badge} pendientes` : tab.label}
                  className={`${TAB_CLASSES} ${isActive ? "text-ink" : "text-ink-3"}`}
                >
                  <span className="relative">
                    <Icon
                      size={19}
                      strokeWidth={2}
                      className={isActive ? "text-cata-red" : ""}
                      aria-hidden="true"
                    />
                    {showBadge && (
                      <span
                        className="absolute -right-2 -top-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-cata-red px-1 text-[9px] font-bold text-white"
                        aria-hidden="true"
                      >
                        {badge}
                      </span>
                    )}
                  </span>
                  {tab.label}
                </Link>
              );
            })}
            {/* "Más" opens the drawer that already exists — every other
                destination stays reachable, and the drawer's focus/inert
                handling is unchanged. */}
            <button
              type="button"
              onClick={(): void => setSidebarOpen(true)}
              aria-label="Más secciones"
              aria-expanded={sidebarOpen}
              className={`${TAB_CLASSES} ${activeTab ? "text-ink-3" : "text-ink"}`}
            >
              <MoreHorizontal
                size={19}
                strokeWidth={2}
                className={activeTab ? "" : "text-cata-red"}
                aria-hidden="true"
              />
              Más
            </button>
          </nav>
        )}
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
       * No ChatWidget here. "Ayuda y soporte" above opens the ONE panel that
       * `HelpChatDock` mounts in the root layout, which is also what the
       * floating launcher opens — one assistant, one conversation, one set of
       * role-scoped quick replies, whichever way the user reached it.
       */}
    </div>
  );
}
