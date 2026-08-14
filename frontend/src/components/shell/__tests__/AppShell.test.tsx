/**
 * Component tests for AppShell.
 *
 * Covers role-derived nav rendering, the mobile sidebar toggle, and the
 * command palette (open/close, filtering, Enter-to-navigate) — the new
 * interactive behavior introduced by this component.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import AppShell, { MAIN_CONTENT_ID, resolveActiveHref } from "@/components/shell/AppShell";

interface MockLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  children: React.ReactNode;
  href: string;
}

interface MockImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  fill?: boolean;
  priority?: boolean;
}

// jsdom in this environment doesn't ship a working `localStorage` (Node's
// experimental global shadows it — see `enrollment-session.test.ts`'s
// pre-existing failure). Stub a real in-memory implementation so the
// collapse-persistence tests exercise the actual get/set contract instead
// of skipping storage assertions altogether.
function createMemoryStorage(): Storage {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string): string | null => (key in store ? store[key] : null),
    setItem: (key: string, value: string): void => {
      store[key] = String(value);
    },
    removeItem: (key: string): void => {
      delete store[key];
    },
    clear: (): void => {
      store = {};
    },
    key: (index: number): string | null => Object.keys(store)[index] ?? null,
    get length(): number {
      return Object.keys(store).length;
    },
  } as Storage;
}

const mockPush = vi.fn();

vi.mock("next/navigation", (): { usePathname: () => string; useRouter: () => { push: typeof mockPush } } => ({
  usePathname: (): string => "/dashboard",
  useRouter: (): { push: typeof mockPush } => ({ push: mockPush }),
}));

vi.mock("next/link", (): { __esModule: boolean; default: (props: MockLinkProps) => React.ReactElement } => ({
  __esModule: true,
  default: ({ children, href, ...props }: MockLinkProps): React.ReactElement => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/image", (): { __esModule: boolean; default: (props: MockImageProps) => React.ReactElement } => ({
  __esModule: true,
  default: (props: MockImageProps): React.ReactElement => {
    const { fill, priority, sizes, ...rest } = props;
    void fill;
    void priority;
    void sizes;
    // eslint-disable-next-line @next/next/no-img-element
    return <img alt="" {...rest} />;
  },
}));

vi.mock("@/contexts/AuthContext", (): { useAuth: typeof useAuth } => ({
  useAuth: vi.fn<typeof useAuth>(),
}));

// useNotificaciones (rendered via NotificationBell in the topbar) fetches on
// mount — stub it out so AppShell's tests don't depend on network/timer
// behavior unrelated to shell/nav rendering.
const mockFetchNotificaciones = vi.fn().mockResolvedValue([]);
const mockMarcarNotificacionLeida = vi.fn().mockResolvedValue(undefined);
vi.mock("@/services/api", () => ({
  fetchNotificaciones: () => mockFetchNotificaciones(),
  marcarNotificacionLeida: (id: number) => mockMarcarNotificacionLeida(id),
}));

import { useAuth } from "@/contexts/AuthContext";
import { getNavGroupsForRoles } from "@/lib/auth-utils";
import { createAuthenticatedAuth, createMultiRoleAuth } from "@/components/__tests__/test-utils";
import {
  OPEN_HELP_CHAT_EVENT,
  resetHelpChatForTests,
} from "@/components/chatbot/help-chat-store";

/**
 * The control that opens the mobile drawer for the role these suites render
 * (admin). Since `27-movil.html`, an admin reaches the drawer through the tab
 * bar's "Más" instead of a hamburger — the drawer itself, and every guarantee
 * asserted about it below, is unchanged.
 */
const MOBILE_NAV_TRIGGER = "Más secciones";

const mockUseAuth = vi.mocked(useAuth);

describe("AppShell", (): void => {
  beforeEach((): void => {
    mockPush.mockReset();
    mockUseAuth.mockReset();
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("admin", "Admin Cata Club"));
    mockFetchNotificaciones.mockClear();
    mockFetchNotificaciones.mockResolvedValue([]);
    mockMarcarNotificacionLeida.mockClear();
    mockMarcarNotificacionLeida.mockResolvedValue(undefined);
    vi.stubGlobal("localStorage", createMemoryStorage());
  });

  it("renders the title and subtitle", (): void => {
    render(
      <AppShell title="Dashboard" subtitle="Resumen diario">
        <p>contenido</p>
      </AppShell>,
    );

    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByText("Resumen diario")).toBeInTheDocument();
  });

  // --- Skip link ---
  //
  // Every authenticated page opened its tab order in the chrome: the brand
  // link, then 10+ sidebar rows, then the topbar, before the screen's own
  // content. The landing has had a working skip link since its first release;
  // the app shell had none.

  it("puts a skip link first in the DOM, ahead of all shell chrome", (): void => {
    const { container } = render(
      <AppShell title="Dashboard">
        <p>contenido</p>
      </AppShell>,
    );

    const skip = screen.getByRole("link", { name: "Saltar al contenido" });
    // First in the DOM is what makes it first in the tab order — nothing in
    // the shell sets a positive tabindex, so document order is the sequence.
    const focusable = container.querySelectorAll("a[href], button");
    expect(focusable[0]).toBe(skip);
  });

  it("points the skip link at the main landmark, which is focusable as a target", (): void => {
    render(
      <AppShell title="Dashboard">
        <p>contenido</p>
      </AppShell>,
    );

    const skip = screen.getByRole("link", { name: "Saltar al contenido" });
    const main = screen.getByRole("main");

    expect(skip).toHaveAttribute("href", `#${MAIN_CONTENT_ID}`);
    expect(main).toHaveAttribute("id", MAIN_CONTENT_ID);
    // Without this a fragment jump only scrolls: `<main>` is not focusable by
    // default, so focus stays in the chrome and the next Tab undoes the skip.
    expect(main).toHaveAttribute("tabindex", "-1");
    expect(main).toContainElement(screen.getByText("contenido"));
  });

  it("renders page content as children", (): void => {
    render(
      <AppShell title="Dashboard">
        <p>contenido de la página</p>
      </AppShell>,
    );

    expect(screen.getByText("contenido de la página")).toBeInTheDocument();
  });

  it("never wraps an icon in a box smaller than the icon", (): void => {
    // Two sidebar icons declared 18 and RENDERED 17, measured in the browser:
    // `h-[17px] w-[17px] shrink-0` around an `ICON.base` glyph. The box does not
    // yield, so the icon is what gets cut.
    //
    // The arbitrary-value lock could not see it and should not be asked to: it
    // watches `size={…}`, and every call site here says `ICON.base`, which is
    // exactly right. What set the real size was the CONTAINER. An icon can fall
    // off the scale without its `size` being wrong — this is the guard for that.
    //
    // Written against the box rather than against those two rows: whichever
    // icon someone wraps next, the failure mode is the same one.
    const { container } = render(<AppShell title="Dashboard">{null}</AppShell>);

    const clipped: string[] = [];
    container.querySelectorAll("svg").forEach((svg): void => {
      const declared = Number(svg.getAttribute("width"));
      if (!declared) return;

      for (let el = svg.parentElement; el && el !== container; el = el.parentElement) {
        const box = /\bh-\[(\d+(?:\.\d+)?)px\]/.exec(el.className?.toString() ?? "");
        if (box && Number(box[1]) < declared) {
          clipped.push(`${svg.getAttribute("class")}: ${declared}px inside ${box[1]}px`);
          break;
        }
      }
    });

    expect(clipped).toEqual([]);
  });

  it("caps the content measure, and puts the utility row on the same one", (): void => {
    // The authenticated app had NO content max-width, and not by omission: the
    // root layout declared one and `globals.css:7-12` cancelled it for every
    // route with a shell. Measured effective width was 1152px at a 1440
    // viewport, 1632px at 1920 and 2272px at 2560 — a row of four stat tiles
    // stretching past 400px each to hold a 32px number.
    //
    // The cap wraps the utility row TOO, not just the page content. Those two
    // columns share one 26px edge on purpose (see the note above the topbar):
    // capping only the content would hang the search box and the bell outside
    // the right edge of every card below them, which is the exact defect that
    // note records being fixed.
    const { container } = render(
      <AppShell title="Dashboard">
        <p>contenido</p>
      </AppShell>,
    );

    const measure = container.querySelector(".max-w-8xl");
    expect(measure).not.toBeNull();

    const main = container.querySelector("main") as HTMLElement;
    const search = screen.getByRole("button", { name: "Buscar secciones" });
    expect(measure).toContainElement(main);
    expect(measure).toContainElement(search);

    // One measure, not two: a second cap somewhere inside would be a second
    // answer to the same question.
    expect(container.querySelectorAll(".max-w-8xl")).toHaveLength(1);
  });

  it("swaps that measure for the short one, on the same element", (): void => {
    // #85's answer for the two screens whose content cannot grow to fill the
    // 1408px measure. What matters here is not the number but WHERE it lands:
    // on the one element that already carries the measure, so the utility row,
    // the page header and the cards stay on a single edge. A narrower cap
    // written inside `<main>` would move the cards away from the header action
    // that adds rows to them — see `CONTENT_MEASURE`.
    const { container } = render(
      <AppShell title="Descuentos" measure="short">
        <p>contenido</p>
      </AppShell>,
    );

    const measure = container.querySelector(".max-w-5xl");
    expect(measure).not.toBeNull();
    expect(container.querySelector(".max-w-8xl")).toBeNull();

    const main = container.querySelector("main") as HTMLElement;
    expect(measure).toContainElement(main);
    expect(measure).toContainElement(screen.getByRole("button", { name: "Buscar secciones" }));

    expect(container.querySelectorAll(".max-w-5xl")).toHaveLength(1);
  });

  it("derives nav links from the admin role and excludes Inicio", (): void => {
    render(<AppShell title="Dashboard">{null}</AppShell>);

    // Scoped to the sidebar: an admin now also gets a bottom tab bar whose
    // "Miembros" tab points at the same route, so an unscoped query matches
    // two links by design.
    const sidebarNav = within(screen.getByRole("navigation", { name: "Navegación principal" }));
    expect(sidebarNav.getByRole("link", { name: /Miembros/i })).toBeInTheDocument();
    expect(sidebarNav.getByRole("link", { name: "Horarios" })).toBeInTheDocument();
    // "Inicio" is represented by the brand logo link, not a separate nav row.
    expect(screen.queryByRole("link", { name: /^Inicio$/i })).not.toBeInTheDocument();
  });

  it("shows only trainer links for the trainer role", (): void => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("trainer", "Carlos Entrenador"));

    render(<AppShell title="Panel">{null}</AppShell>);

    expect(screen.getByRole("link", { name: "Mi día" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pasar lista" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Miembros/i })).not.toBeInTheDocument();
  });

  it("shows the signed-in user's name, role label, and initials", (): void => {
    render(<AppShell title="Dashboard">{null}</AppShell>);

    expect(screen.getByText("Admin Cata Club")).toBeInTheDocument();
    expect(screen.getByText("Administrador")).toBeInTheDocument();
    expect(screen.getByText("AC")).toBeInTheDocument();
  });

  // --- Notification bell ---

  it("renders the notification bell in the topbar when a session is present", (): void => {
    render(<AppShell title="Dashboard">{null}</AppShell>);

    expect(screen.getByRole("button", { name: /notificaciones/i })).toBeInTheDocument();
  });

  it("does not show the account menu items until the user block is clicked", (): void => {
    render(<AppShell title="Dashboard">{null}</AppShell>);

    expect(screen.queryByRole("link", { name: /Perfil/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cerrar Sesión/i })).not.toBeInTheDocument();
  });

  it("opens the account menu with Perfil and Cerrar Sesión when the user block is clicked", (): void => {
    render(<AppShell title="Dashboard">{null}</AppShell>);

    fireEvent.click(screen.getByRole("button", { name: /Menú de cuenta/i }));

    expect(screen.getByRole("link", { name: /Perfil/i })).toHaveAttribute("href", "/profile");
    expect(screen.getByRole("button", { name: /Cerrar Sesión/i })).toBeInTheDocument();
  });

  it("calls logout when Cerrar Sesión is clicked from the account menu", (): void => {
    const mockLogout = vi.fn();
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("admin", "Admin", { logout: mockLogout }));

    render(<AppShell title="Dashboard">{null}</AppShell>);

    fireEvent.click(screen.getByRole("button", { name: /Menú de cuenta/i }));
    fireEvent.click(screen.getByRole("button", { name: /Cerrar Sesión/i }));

    expect(mockLogout).toHaveBeenCalledTimes(1);
    // Menu closes itself after the click
    expect(screen.queryByRole("button", { name: /Cerrar Sesión/i })).not.toBeInTheDocument();
  });

  it("opens and closes the mobile sidebar", (): void => {
    render(<AppShell title="Dashboard">{null}</AppShell>);

    fireEvent.click(screen.getByRole("button", { name: MOBILE_NAV_TRIGGER }));
    fireEvent.click(screen.getByRole("button", { name: /Cerrar menú/i }));
    // No assertion needed beyond "didn't throw" — the sidebar's open state
    // only affects a translate-x CSS class, not conditional rendering.
    expect(screen.getByRole("button", { name: MOBILE_NAV_TRIGGER })).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Mobile navigation entry point. It differs by role on purpose: admin gets
  // the bottom tab bar from `docs/archive/prototypes/prototipos/27-movil.html` (four
  // destinations at thumb height, the rest behind "Más"); every other role
  // keeps the hamburger, because a 4-up bar with two empty slots is worse
  // than a menu.
  // -------------------------------------------------------------------------

  it("gives an admin a bottom tab bar with the four prototype destinations", (): void => {
    render(<AppShell title="Dashboard">{null}</AppShell>);

    const tabBar = within(screen.getByRole("navigation", { name: /móvil/i }));
    expect(tabBar.getByRole("link", { name: "Panel" })).toHaveAttribute("href", "/dashboard");
    expect(tabBar.getByRole("link", { name: "Miembros" })).toHaveAttribute("href", "/members");
    expect(tabBar.getByRole("link", { name: "Pagos" })).toHaveAttribute("href", "/payments");
    expect(tabBar.getByRole("button", { name: "Más secciones" })).toBeInTheDocument();
  });

  it("replaces the admin hamburger with the tab bar's Más entry", (): void => {
    render(<AppShell title="Dashboard">{null}</AppShell>);

    expect(screen.queryByRole("button", { name: "Abrir menú principal" })).not.toBeInTheDocument();
    // "Más" opens the SAME drawer, so nothing became unreachable.
    fireEvent.click(screen.getByRole("button", { name: "Más secciones" }));
    expect(screen.getByRole("button", { name: /Cerrar menú/i })).toBeInTheDocument();
  });

  it("gives every touch target in the tab bar at least 44px", (): void => {
    render(<AppShell title="Dashboard">{null}</AppShell>);

    const tabBar = screen.getByRole("navigation", { name: /móvil/i });
    const targets = [
      ...within(tabBar).getAllByRole("link"),
      ...within(tabBar).getAllByRole("button"),
    ];
    expect(targets).toHaveLength(4);
    for (const target of targets) {
      expect(target).toHaveClass("min-h-[44px]");
    }
  });

  it("keeps the hamburger — and renders no tab bar — for a non-admin role", (): void => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("trainer", "Carlos Entrenador"));

    render(<AppShell title="Panel">{null}</AppShell>);

    expect(screen.getByRole("button", { name: "Abrir menú principal" })).toHaveTextContent("Menú");
    expect(screen.queryByRole("navigation", { name: /móvil/i })).not.toBeInTheDocument();
  });

  // --- Command palette ---

  it("opens the command palette from the search trigger button", (): void => {
    render(<AppShell title="Dashboard">{null}</AppShell>);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Buscar secciones" }));

    expect(screen.getByRole("dialog", { name: /Buscador de secciones/i })).toBeInTheDocument();
  });

  it("opens the command palette with Ctrl+K", (): void => {
    render(<AppShell title="Dashboard">{null}</AppShell>);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes the command palette with Escape", (): void => {
    render(<AppShell title="Dashboard">{null}</AppShell>);

    fireEvent.click(screen.getByRole("button", { name: "Buscar secciones" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("filters palette results by the typed query", (): void => {
    render(<AppShell title="Dashboard">{null}</AppShell>);

    fireEvent.click(screen.getByRole("button", { name: "Buscar secciones" }));
    const input = screen.getByPlaceholderText("Ir a una sección…");

    fireEvent.change(input, { target: { value: "pagos" } });

    expect(screen.getByRole("option", { name: /Membresías y Pagos/i })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /^Horarios$/i })).not.toBeInTheDocument();
  });

  it("shows an empty-results message when nothing matches", (): void => {
    render(<AppShell title="Dashboard">{null}</AppShell>);

    fireEvent.click(screen.getByRole("button", { name: "Buscar secciones" }));
    fireEvent.change(screen.getByPlaceholderText("Ir a una sección…"), {
      target: { value: "zzz-no-existe" },
    });

    expect(screen.getByText(/No se encontraron secciones/i)).toBeInTheDocument();
  });

  it("navigates and closes the palette when a result is clicked", (): void => {
    render(<AppShell title="Dashboard">{null}</AppShell>);

    fireEvent.click(screen.getByRole("button", { name: "Buscar secciones" }));
    fireEvent.click(screen.getByRole("option", { name: "Horarios" }));

    expect(mockPush).toHaveBeenCalledWith("/groups");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("navigates to the highlighted result on Enter", (): void => {
    render(<AppShell title="Dashboard">{null}</AppShell>);

    fireEvent.click(screen.getByRole("button", { name: "Buscar secciones" }));
    const input = screen.getByPlaceholderText("Ir a una sección…");
    fireEvent.change(input, { target: { value: "asistencia" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(mockPush).toHaveBeenCalledWith("/attendance");
  });

  // --- Desktop sidebar collapse ---

  it("collapses the sidebar: compact aside width, hidden nav labels, icon tooltips", (): void => {
    const { container } = render(<AppShell title="Dashboard">{null}</AppShell>);

    fireEvent.click(screen.getByRole("button", { name: /Colapsar menú/i }));

    expect(container.querySelector("aside")).toHaveClass("lg:w-[76px]");
    const groupsLink = screen.getByRole("link", { name: "Horarios" });
    expect(groupsLink).toHaveAttribute("title", "Horarios");
    // The visible label is hidden at `lg`, so the accessible name must not
    // depend on it — a native `title` tooltip is not a substitute.
    expect(groupsLink).toHaveAttribute("aria-label", "Horarios");
    expect(groupsLink.querySelector("span:not([aria-hidden])")).toHaveClass("lg:hidden");
    expect(screen.getByRole("button", { name: /Expandir menú/i })).toBeInTheDocument();
  });

  it("initializes as collapsed when localStorage has a persisted collapsed flag", (): void => {
    localStorage.setItem("cata_sidebar_collapsed", "true");

    const { container } = render(<AppShell title="Dashboard">{null}</AppShell>);

    expect(screen.getByRole("button", { name: /Expandir menú/i })).toBeInTheDocument();
    expect(container.querySelector("aside")).toHaveClass("lg:w-[76px]");
  });

  it("persists the collapsed flag to localStorage when toggled", (): void => {
    render(<AppShell title="Dashboard">{null}</AppShell>);

    fireEvent.click(screen.getByRole("button", { name: /Colapsar menú/i }));
    expect(localStorage.getItem("cata_sidebar_collapsed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: /Expandir menú/i }));
    expect(localStorage.getItem("cata_sidebar_collapsed")).toBe("false");
  });

  it("keeps the mobile drawer independent of the desktop collapse state", (): void => {
    render(<AppShell title="Dashboard">{null}</AppShell>);

    fireEvent.click(screen.getByRole("button", { name: /Colapsar menú/i }));
    fireEvent.click(screen.getByRole("button", { name: MOBILE_NAV_TRIGGER }));
    fireEvent.click(screen.getByRole("button", { name: /Cerrar menú/i }));

    // Mobile open/close still works after collapsing the desktop sidebar —
    // the two toggles remain functionally independent.
    expect(screen.getByRole("button", { name: MOBILE_NAV_TRIGGER })).toBeInTheDocument();
  });

  // --- Regression: collapse toggle must stay reachable in both states ---
  // Bug: the toggle previously lived inside the same flex row as the 36px
  // logo. At the collapsed 76px width, px-5 padding (40px) + the logo (36px)
  // + the toggle button left zero room, squeezing the toggle out of the
  // sidebar with no way to re-expand. Fix: the toggle is now anchored
  // directly to the `<aside>`, outside that header row, so it is never
  // subject to the row's width constraints.

  it("keeps the collapse toggle outside the logo header row so it can't be squeezed out when collapsed", (): void => {
    const { container } = render(<AppShell title="Dashboard">{null}</AppShell>);

    const headerRow = container.querySelector("aside > div.border-b");
    expect(headerRow).not.toBeNull();
    expect(
      within(headerRow as HTMLElement).queryByRole("button", { name: /Colapsar menú/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Colapsar menú/i })).toBeInTheDocument();
  });

  it("keeps the collapse toggle clickable across repeated collapse/expand cycles", (): void => {
    render(<AppShell title="Dashboard">{null}</AppShell>);

    for (let i = 0; i < 3; i += 1) {
      fireEvent.click(screen.getByRole("button", { name: /Colapsar menú/i }));
      expect(screen.getByRole("button", { name: /Expandir menú/i })).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /Expandir menú/i }));
      expect(screen.getByRole("button", { name: /Colapsar menú/i })).toBeInTheDocument();
    }
  });

  // --- Regression: sidebar must stay pinned to the viewport, not page height ---
  // Bug: `.app-shell` is `flex min-h-screen` and `<aside>` was `lg:static`, so
  // as a flex item it stretched (default `align-items: stretch`) to match the
  // main content's height. On long pages the bottom user/logout block ended
  // up thousands of pixels down. Fix: pin the aside to the viewport at `lg:`.

  it("pins the sidebar to the viewport instead of stretching with page content", (): void => {
    const { container } = render(<AppShell title="Dashboard">{null}</AppShell>);

    const aside = container.querySelector("aside");
    expect(aside).toHaveClass("lg:sticky", "lg:top-0", "lg:h-screen");
    expect(aside).not.toHaveClass("lg:static");
  });

  // --- Notification bell theming in AppShell's light topbar ---

  it("renders the notification bell with the light variant matching AppShell's light topbar", (): void => {
    render(<AppShell title="Dashboard">{null}</AppShell>);

    const bell = screen.getByRole("button", { name: /notificaciones/i });
    expect(bell).toHaveClass("text-cata-text/65");
    expect(bell).not.toHaveClass("text-white/65");
  });
});

// ---------------------------------------------------------------------------
// Closed mobile drawer keeps focusable controls in the tab order (P1).
//
// The open/closed toggle changed only `translate-x`, so a closed drawer sat
// offscreen at x=-256 with `visibility: visible` and 11 focusable descendants
// still reachable by Tab — keyboard focus simply vanished offscreen.
//
// React here is 18.3 (see package.json), which does not support the `inert`
// prop, so this uses the `aria-hidden` + `visibility: hidden` fallback.
// `visibility: hidden` is what removes the subtree from the tab order;
// `aria-hidden` removes it from the accessibility tree.
//
// The hiding MUST be viewport-aware: at `lg` the same <aside> is permanently
// visible (`lg:sticky lg:translate-x-0`) while `sidebarOpen` stays false, so
// hiding purely on `!sidebarOpen` would black-hole desktop keyboard nav.
// ---------------------------------------------------------------------------

/** Stub `matchMedia` (absent in jsdom) to report a given viewport width class. */
function stubViewport(isDesktop: boolean): void {
  const listeners = new Set<() => void>();
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: isDesktop,
      media: query,
      onchange: null,
      addEventListener: (_: string, cb: () => void): void => void listeners.add(cb),
      removeEventListener: (_: string, cb: () => void): void => void listeners.delete(cb),
      addListener: (cb: () => void): void => void listeners.add(cb),
      removeListener: (cb: () => void): void => void listeners.delete(cb),
      dispatchEvent: (): boolean => true,
    })),
  );
}

describe("AppShell — closed mobile drawer leaves the tab order", (): void => {
  beforeEach((): void => {
    vi.unstubAllGlobals();
    Object.defineProperty(window, "localStorage", { value: createMemoryStorage(), writable: true });
  });

  it("hides the closed drawer from keyboard and screen readers on a mobile viewport", (): void => {
    stubViewport(false);

    const { container } = render(<AppShell title="Dashboard">{null}</AppShell>);
    const aside = container.querySelector("aside") as HTMLElement;

    expect(aside).toHaveClass("-translate-x-full");
    // `invisible` is Tailwind's `visibility: hidden` — the part that actually
    // pulls the 11 focusable descendants out of the tab order.
    expect(aside).toHaveClass("invisible");
    expect(aside).toHaveAttribute("aria-hidden", "true");
  });

  it("returns the drawer to the tab order as soon as it is opened", (): void => {
    stubViewport(false);

    const { container } = render(<AppShell title="Dashboard">{null}</AppShell>);
    fireEvent.click(screen.getByRole("button", { name: MOBILE_NAV_TRIGGER }));

    const aside = container.querySelector("aside") as HTMLElement;
    expect(aside).toHaveClass("translate-x-0");
    expect(aside).not.toHaveClass("invisible");
    expect(aside).not.toHaveAttribute("aria-hidden");
  });

  it("never hides the sidebar on a desktop viewport, where it is permanently visible", (): void => {
    stubViewport(true);

    const { container } = render(<AppShell title="Dashboard">{null}</AppShell>);
    const aside = container.querySelector("aside") as HTMLElement;

    // `sidebarOpen` is false here, but at `lg` the aside is on screen via
    // `lg:translate-x-0` — hiding it would black-hole desktop keyboard nav.
    expect(aside).not.toHaveClass("invisible");
    expect(aside).not.toHaveAttribute("aria-hidden");
  });

  it("defers the visibility flip so the closing slide-out animation still renders", (): void => {
    stubViewport(false);

    const { container } = render(<AppShell title="Dashboard">{null}</AppShell>);
    const aside = container.querySelector("aside") as HTMLElement;

    // Transitioning `visibility` alongside `transform` keeps the drawer
    // painted for the duration of the slide-out instead of blinking away.
    expect(aside).toHaveClass("transition-[transform,visibility]");
  });
});

// ---------------------------------------------------------------------------
// Phase 3a — the shell must show the screen its own name.
//
// `AppShell` used to render `title`/`subtitle` as `sr-only`. Every
// caller passed a title and none of them rendered, so below `lg` — where the
// sidebar is a closed drawer — a trainer on a phone had Menú, a bell and a
// search box, and no way to know which screen they were on.
// ---------------------------------------------------------------------------

describe("AppShell — the page header row", (): void => {
  beforeEach((): void => {
    stubViewport(true);
    mockPush.mockReset();
    mockUseAuth.mockReset();
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("admin", "Admin Cata Club"));
    vi.stubGlobal("localStorage", createMemoryStorage());
  });

  it("renders the page title as a VISIBLE h1, not a screen-reader-only one", (): void => {
    render(
      <AppShell title="Miembros" subtitle="Todo el club">
        {null}
      </AppShell>,
    );

    const heading = screen.getByRole("heading", { level: 1, name: "Miembros" });
    expect(heading).toBeInTheDocument();
    expect(heading).not.toHaveClass("sr-only");
    expect(screen.getByText("Todo el club")).not.toHaveClass("sr-only");
    // No eyebrow/kicker above the title — the h1 opens its block.
    expect(heading.parentElement?.firstElementChild).toBe(heading);
  });

  it("draws exactly one main landmark", (): void => {
    // Every authenticated route used to ship two, nested: the root layout wrapped
    // `{children}` in a `<main>` that carried only a max-width and padding, and
    // this shell drew its own inside it. Two regions called "principal" is one
    // guess for anyone navigating by landmark — and the skip link pointed at the
    // inner one, so the first region found was not the one the jump used.
    // `lib/__tests__/main-landmark.test.ts` holds the other half of this rule.
    const { container } = render(
      <AppShell title="Miembros">
        <p>contenido</p>
      </AppShell>,
    );

    expect(container.querySelectorAll("main")).toHaveLength(1);
  });

  it("places the header row above <main>, so the heading precedes the content", (): void => {
    const { container } = render(
      <AppShell title="Miembros">
        <p>contenido</p>
      </AppShell>,
    );

    const heading = screen.getByRole("heading", { level: 1, name: "Miembros" });
    const main = container.querySelector("main") as HTMLElement;
    expect(main.contains(heading)).toBe(false);
    expect(heading.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("owns the page rhythm, so no screen declares its own", (): void => {
    // `.canvas` (`_sistema.css:152`) is one flex column at 20px holding the
    // page title AND every first-level block. The shell already spaced the
    // header row against `<main>`; carrying the same step INSIDE `<main>`
    // finishes that column, and is why a migrated screen has no rhythm
    // wrapper of its own. See `docs/ux/ritmo-vertical.md`.
    const { container } = render(
      <AppShell title="Miembros">
        <p>contenido</p>
      </AppShell>,
    );

    const main = container.querySelector("main") as HTMLElement;
    expect(main).toHaveClass("flex", "flex-col", "gap-page");
    // Flex `gap` and not a `space-y-*` margin. Several screens render a modal
    // as a sibling of their content, and a margin lands on a `fixed inset-0`
    // overlay — measured at 20px of offset and 20px of lost height. A gap
    // never applies to an out-of-flow child.
    expect(main.className).not.toMatch(/\bspace-y-/);
    expect(main.parentElement).toHaveClass("gap-page");
  });

  it("renders trailing header actions next to the title", (): void => {
    render(
      <AppShell title="Asistencias" actions={<button type="button">Tomar asistencia</button>}>
        {null}
      </AppShell>,
    );

    expect(screen.getByRole("button", { name: "Tomar asistencia" })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Active nav row: longest matching prefix wins, so a descendant route does not
// light up its parent section as well.
// ---------------------------------------------------------------------------

describe("resolveActiveHref", (): void => {
  const trainerLinks = [
    { href: "/trainer", label: "Mi día" },
    { href: "/trainer/attendance", label: "Pasar lista" },
  ];

  it("marks the exact route", (): void => {
    expect(resolveActiveHref(trainerLinks, "/trainer")).toBe("/trainer");
  });

  it("prefers the most specific match over its parent section", (): void => {
    expect(resolveActiveHref(trainerLinks, "/trainer/attendance")).toBe("/trainer/attendance");
  });

  it("keeps a descendant route inside its own section", (): void => {
    expect(resolveActiveHref(trainerLinks, "/trainer/attendance/history")).toBe(
      "/trainer/attendance",
    );
  });

  it("returns null when nothing matches", (): void => {
    expect(resolveActiveHref(trainerLinks, "/members")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The same resolver, fed the REAL trainer navigation instead of a local
// fixture. The block above describes the rule; this one describes what the
// sidebar actually highlights for an entrenador — if the "Historial" entry
// disappears from `getNavGroupsForRoles`, the first case here goes red even
// though the resolver never changed.
// ---------------------------------------------------------------------------

describe("resolveActiveHref — real trainer navigation", (): void => {
  // Flattened the way the rail flattens it: `resolveActiveHref` answers about
  // the whole rail, not about one group of it.
  const trainerNav = getNavGroupsForRoles(["trainer"]).flatMap((group) => group.links);

  it("marks Historial, not Pasar lista, on the history screen", (): void => {
    expect(resolveActiveHref(trainerNav, "/trainer/attendance/history")).toBe(
      "/trainer/attendance/history",
    );
  });

  it("still marks Pasar lista on the attendance screen", (): void => {
    expect(resolveActiveHref(trainerNav, "/trainer/attendance")).toBe("/trainer/attendance");
  });

  it("still marks Mi día on the trainer panel", (): void => {
    expect(resolveActiveHref(trainerNav, "/trainer")).toBe("/trainer");
  });
});

// ---------------------------------------------------------------------------
// Help chat: the sidebar row is a TRIGGER for the one panel `HelpChatDock`
// mounts in the root layout — not a second, competing assistant.
// ---------------------------------------------------------------------------

describe("AppShell — Ayuda y soporte", (): void => {
  beforeEach((): void => {
    // The sidebar is `aria-hidden` while the mobile drawer is closed, and an
    // earlier block leaves `matchMedia` reporting mobile.
    stubViewport(true);
    mockUseAuth.mockReset();
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("admin", "Admin Cata Club"));
    vi.stubGlobal("localStorage", createMemoryStorage());
    resetHelpChatForTests();
  });

  it("keeps the sidebar entry, and mounts no assistant of its own", (): void => {
    render(<AppShell title="Panel de Control">{null}</AppShell>);

    expect(screen.getByRole("button", { name: "Ayuda y soporte" })).toBeInTheDocument();
    // The launcher and the panel both belong to the dock. A shell that also
    // rendered one would put two panels on the same screen.
    expect(screen.queryByRole("button", { name: /abrir cata-bot/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: /cata-bot/i })).not.toBeInTheDocument();
  });

  it("opens the shared assistant from that entry", (): void => {
    const listener = vi.fn();
    window.addEventListener(OPEN_HELP_CHAT_EVENT, listener);
    render(<AppShell title="Panel de Control">{null}</AppShell>);

    const entry = screen.getByRole("button", { name: "Ayuda y soporte" });
    expect(entry).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(entry);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(entry).toHaveAttribute("aria-expanded", "true");
    window.removeEventListener(OPEN_HELP_CHAT_EVENT, listener);
  });

  it("closes the drawer as it opens the assistant, so the panel is not behind it", (): void => {
    render(<AppShell title="Panel de Control">{null}</AppShell>);

    // Admin's phone navigation is the tab bar, so "Más" is what opens the drawer.
    fireEvent.click(screen.getByRole("button", { name: "Más secciones" }));
    fireEvent.click(screen.getByRole("button", { name: "Ayuda y soporte" }));

    expect(screen.getByRole("navigation", { name: "Navegación principal" }).closest("aside"))
      .toHaveClass("-translate-x-full");
  });
});

// ---------------------------------------------------------------------------
// Popup dismissal — the user menu had no Escape, no outside click, and
// declared `aria-haspopup="true"` (an alias for "menu") on a non-menu popup.
// ---------------------------------------------------------------------------

describe("AppShell — user menu dismissal", (): void => {
  beforeEach((): void => {
    stubViewport(true);
    mockUseAuth.mockReset();
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("admin", "Admin Cata Club"));
    vi.stubGlobal("localStorage", createMemoryStorage());
  });

  function openUserMenu(): HTMLElement {
    const trigger = screen.getByRole("button", { name: /Menú de cuenta/i });
    fireEvent.click(trigger);
    return trigger;
  }

  it("describes the popup truthfully and wires it to the trigger", (): void => {
    render(<AppShell title="Panel de Control">{null}</AppShell>);
    const trigger = openUserMenu();

    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const panel = screen.getByRole("dialog", { name: "Menú de cuenta" });
    expect(trigger.getAttribute("aria-controls")).toBe(panel.id);
  });

  it("closes on Escape and returns focus to the trigger", (): void => {
    render(<AppShell title="Panel de Control">{null}</AppShell>);
    const trigger = openUserMenu();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "Menú de cuenta" })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes when the pointer goes down outside the panel", (): void => {
    render(<AppShell title="Panel de Control">{null}</AppShell>);
    openUserMenu();

    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole("dialog", { name: "Menú de cuenta" })).not.toBeInTheDocument();
  });

  it("stays open when the click lands inside the panel", (): void => {
    render(<AppShell title="Panel de Control">{null}</AppShell>);
    openUserMenu();

    fireEvent.mouseDown(screen.getByRole("link", { name: /Perfil/i }));

    expect(screen.getByRole("dialog", { name: "Menú de cuenta" })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Command palette ARIA: arrow keys move a visual highlight, which used to be
// invisible to assistive technology.
// ---------------------------------------------------------------------------

describe("AppShell — command palette selection is announced", (): void => {
  beforeEach((): void => {
    stubViewport(true);
    mockPush.mockReset();
    mockUseAuth.mockReset();
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("admin", "Admin Cata Club"));
    vi.stubGlobal("localStorage", createMemoryStorage());
  });

  it("points aria-activedescendant at the highlighted option and moves it with the arrow keys", (): void => {
    render(<AppShell title="Panel de Control">{null}</AppShell>);
    fireEvent.click(screen.getByRole("button", { name: "Buscar secciones" }));

    const input = screen.getByRole("combobox", { name: "Ir a una sección" });
    const options = screen.getAllByRole("option");

    expect(input).toHaveAttribute("aria-controls", screen.getByRole("listbox").id);
    expect(input).toHaveAttribute("aria-activedescendant", options[0].id);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(options[1]).toHaveAttribute("aria-selected", "false");

    fireEvent.keyDown(input, { key: "ArrowDown" });

    expect(input).toHaveAttribute("aria-activedescendant", options[1].id);
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
  });

  it("drops aria-activedescendant when nothing matches", (): void => {
    render(<AppShell title="Panel de Control">{null}</AppShell>);
    fireEvent.click(screen.getByRole("button", { name: "Buscar secciones" }));

    fireEvent.change(screen.getByRole("combobox", { name: "Ir a una sección" }), {
      target: { value: "zzz-no-existe" },
    });

    expect(screen.getByRole("combobox", { name: "Ir a una sección" })).not.toHaveAttribute(
      "aria-activedescendant",
    );
  });
});

// ---------------------------------------------------------------------------
// More than one role — D12d.
//
// The rail is the UNION of the person's sections, one titled group per role,
// and there is no selector: a selector would turn her roles into modes. The
// session still collapses to a single `user.role` for guards and redirects
// (`pickPrimaryRole`, untouched) — what changes here is only what gets drawn.
// ---------------------------------------------------------------------------

describe("AppShell — the rail of a person with several roles", (): void => {
  beforeEach((): void => {
    stubViewport(true);
    mockPush.mockReset();
    mockUseAuth.mockReset();
    vi.stubGlobal("localStorage", createMemoryStorage());
  });

  /**
   * The rail itself, never the tab bar or the palette. The return type is
   * inferred: `within`'s queries are generic in a way `ReturnType` flattens
   * into `any`, which would silently un-type every assertion below it.
   */
  const rail = () => within(screen.getByRole("navigation", { name: "Navegación principal" }));

  it("draws no heading when the person holds a single role", (): void => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("trainer", "Carlos Entrenador"));

    render(<AppShell title="Mi día">{null}</AppShell>);

    // One group names the whole rail, and the brand block right above it
    // already does that ("Panel de gestión" / "Mi cuenta", `getAreaLabel`).
    expect(rail().queryAllByRole("group")).toHaveLength(0);
    expect(rail().queryByText("Entrenar")).not.toBeInTheDocument();
    expect(rail().getByRole("link", { name: "Mi día" })).toBeInTheDocument();
  });

  it("keeps the 18 alumno+representante accounts on one Mi cuenta, unnamed", (): void => {
    mockUseAuth.mockReturnValue(
      createMultiRoleAuth(["REPRESENTANTE", "ALUMNO"], "representante", "Marta Vera"),
    );

    render(<AppShell title="Mi cuenta">{null}</AppShell>);

    // Both roles name the same section, so there is still ONE group — and a
    // lone group draws no heading. Asserted on the group wrapper rather than
    // on the words: "Mi cuenta" is ALSO the registered name of `/student`
    // (`lib/destinations.ts`), so a text query cannot tell a rótulo that is
    // absent from the row that is present.
    expect(rail().queryAllByRole("group")).toHaveLength(0);
    expect(rail().getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "/student",
      "/student/payments",
      "/student/attendance",
      "/student/medical-record",
    ]);
  });

  it("gives a trainer who also plays both sections, each under its own heading", (): void => {
    mockUseAuth.mockReturnValue(
      createMultiRoleAuth(["ENTRENADOR", "ALUMNO"], "trainer", "Carlos Entrenador"),
    );

    render(<AppShell title="Mi día">{null}</AppShell>);

    // The case the product could not express: his own fees and his own
    // attendance did not exist for him.
    expect(rail().getByText("Entrenar")).toBeInTheDocument();
    // The rótulo, not the row: `/student` is registered as "Mi cuenta" too, so
    // the heading and the destination under it say the same two words. The
    // registry owns the row's name (D12b) and D12d chose the heading — the
    // group holds a guardian who does not play, so "Jugar" would be a lie for
    // the 18 accounts that share it.
    expect(rail().getByText("Mi cuenta", { selector: "p" })).toBeInTheDocument();
    expect(rail().getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "/trainer",
      "/trainer/attendance",
      "/trainer/attendance/history",
      "/student",
      "/student/payments",
      "/student/attendance",
    ]);
  });

  /*
   * The brand block's second line names the AREA the rail covers. It used to
   * read the COLLAPSED role, which is a single value picked by precedence, so
   * a trainer who also plays was told he was in the "Panel de gestión" while
   * the rail under it drew a "Mi cuenta" group — the shell contradicting
   * itself two rows apart. It reads the same role ARRAY the rail does now, and
   * when the person spans both areas it names neither: the group rótulos are
   * already there, saying it properly, and one label cannot be honest about
   * two areas.
   */
  it("names the area from the same roles the rail is drawn from", (): void => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("trainer", "Carlos Entrenador"));
    const { unmount } = render(<AppShell title="Mi día">{null}</AppShell>);
    expect(screen.getByText("Panel de gestión")).toBeInTheDocument();
    unmount();

    mockUseAuth.mockReturnValue(
      createMultiRoleAuth(["REPRESENTANTE", "ALUMNO"], "representante", "Marta Vera"),
    );
    const family = render(<AppShell title="Mi cuenta">{null}</AppShell>);
    // The area line, not the `/student` row: the destination registry names
    // that row "Mi cuenta" too, so the words alone cannot tell them apart.
    expect(screen.getByText("Mi cuenta", { selector: ".text-2xs" })).toBeInTheDocument();
    expect(screen.queryByText("Panel de gestión")).not.toBeInTheDocument();
    family.unmount();
  });

  it("claims no single area for the person who holds both, and lets the rótulos say it", (): void => {
    mockUseAuth.mockReturnValue(
      createMultiRoleAuth(["ENTRENADOR", "ALUMNO"], "trainer", "Carlos Entrenador"),
    );

    render(<AppShell title="Mi día">{null}</AppShell>);

    expect(screen.queryByText("Panel de gestión")).not.toBeInTheDocument();
    // The two rótulos still name both areas, which is the honest version of
    // the same statement.
    expect(rail().getByText("Entrenar")).toBeInTheDocument();
    expect(rail().getByText("Mi cuenta", { selector: "p" })).toBeInTheDocument();
  });

  it("names each group for the assistive technology that cannot see the rótulo", (): void => {
    mockUseAuth.mockReturnValue(
      createMultiRoleAuth(["ENTRENADOR", "ALUMNO"], "trainer", "Carlos Entrenador"),
    );

    render(<AppShell title="Mi día">{null}</AppShell>);

    const groups = rail().getAllByRole("group");
    expect(groups.map((group) => group.getAttribute("aria-label"))).toEqual([
      "Entrenar",
      "Mi cuenta",
    ]);
    expect(within(groups[1]).getByRole("link", { name: "Pagos" })).toBeInTheDocument();
  });

  // The tab bar is a fixed four slots — three destinations plus "Más" — and it
  // is admin-only. It is deliberately NOT re-picked per role combination: see
  // the comment on `MOBILE_TABS`. What must hold is that it never becomes the
  // only way out, so everything the tab bar leaves behind stays in the drawer.
  it("leaves every section of a multi-role admin reachable from the drawer", (): void => {
    mockUseAuth.mockReturnValue(
      createMultiRoleAuth(["ADMINISTRADOR", "ENTRENADOR"], "admin", "Ana Admin"),
    );

    render(<AppShell title="Panel de Control">{null}</AppShell>);

    const tabBar = within(screen.getByRole("navigation", { name: /móvil/i }));
    expect(tabBar.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "/dashboard",
      "/members",
      "/payments",
    ]);
    expect(tabBar.getByRole("button", { name: "Más secciones" })).toBeInTheDocument();
    // "Más" opens this same rail, and the trainer section it does not fit is in it.
    expect(rail().getByRole("link", { name: "Mi día" })).toBeInTheDocument();
    expect(rail().getByText("Administrar")).toBeInTheDocument();
  });

  it("highlights the current row whichever group it belongs to", (): void => {
    mockUseAuth.mockReturnValue(
      createMultiRoleAuth(["ENTRENADOR", "ALUMNO"], "trainer", "Carlos Entrenador"),
    );

    render(<AppShell title="Panel de Control">{null}</AppShell>);

    // `usePathname` is mocked to /dashboard for this file, so no row matches —
    // what this pins is that grouping did not break `resolveActiveHref`, which
    // now reads a flattened rail instead of a flat one.
    expect(rail().queryByRole("link", { current: "page" })).not.toBeInTheDocument();
  });

  it("searches across every group from the command palette", (): void => {
    mockUseAuth.mockReturnValue(
      createMultiRoleAuth(["ENTRENADOR", "ALUMNO"], "trainer", "Carlos Entrenador"),
    );

    render(<AppShell title="Mi día">{null}</AppShell>);
    fireEvent.click(screen.getByRole("button", { name: "Buscar secciones" }));

    // "Asistencias" is a row of the account group; "Pasar lista" is the
    // trainer's. Both must be findable, or the palette would search only the
    // section the person happens to be standing in.
    expect(screen.getByRole("option", { name: "Asistencias" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Pasar lista" })).toBeInTheDocument();
  });
});
