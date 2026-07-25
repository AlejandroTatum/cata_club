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
import AppShell from "@/components/shell/AppShell";

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
import { createAuthenticatedAuth } from "@/components/__tests__/test-utils";

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

  it("renders the title, subtitle, and eyebrow", (): void => {
    render(
      <AppShell title="Dashboard" subtitle="Resumen diario" eyebrow="Área administrativa">
        <p>contenido</p>
      </AppShell>,
    );

    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByText("Resumen diario")).toBeInTheDocument();
    expect(screen.getByText("Área administrativa")).toBeInTheDocument();
  });

  it("renders page content as children", (): void => {
    render(
      <AppShell title="Dashboard">
        <p>contenido de la página</p>
      </AppShell>,
    );

    expect(screen.getByText("contenido de la página")).toBeInTheDocument();
  });

  it("derives nav links from the admin role and excludes Inicio", (): void => {
    render(<AppShell title="Dashboard">{null}</AppShell>);

    expect(screen.getByRole("link", { name: /Miembros/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Gestión de Horarios/i })).toBeInTheDocument();
    // "Inicio" is represented by the brand logo link, not a separate nav row.
    expect(screen.queryByRole("link", { name: /^Inicio$/i })).not.toBeInTheDocument();
  });

  it("shows only trainer links for the trainer role", (): void => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("trainer", "Carlos Entrenador"));

    render(<AppShell title="Panel">{null}</AppShell>);

    expect(screen.getByRole("link", { name: /Dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Asistencia" })).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole("button", { name: /Abrir menú/i }));
    fireEvent.click(screen.getByRole("button", { name: /Cerrar menú/i }));
    // No assertion needed beyond "didn't throw" — the sidebar's open state
    // only affects a translate-x CSS class, not conditional rendering.
    expect(screen.getByRole("button", { name: /Abrir menú/i })).toBeInTheDocument();
  });

  it("makes the mobile navigation entry point visibly discoverable", (): void => {
    render(<AppShell title="Dashboard">{null}</AppShell>);

    expect(screen.getByRole("button", { name: "Abrir menú principal" })).toHaveTextContent("Menú");
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

    expect(screen.getByRole("button", { name: /Membresías y Pagos/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Grupos$/i })).not.toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: /Gestión de Horarios/i }));

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
    const groupsLink = screen.getByRole("link", { name: /Gestión de Horarios/i });
    expect(groupsLink).toHaveAttribute("title", "Gestión de Horarios");
    expect(groupsLink.querySelector("span")).toHaveClass("lg:hidden");
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
    fireEvent.click(screen.getByRole("button", { name: /Abrir menú/i }));
    fireEvent.click(screen.getByRole("button", { name: /Cerrar menú/i }));

    // Mobile open/close still works after collapsing the desktop sidebar —
    // the two toggles remain functionally independent.
    expect(screen.getByRole("button", { name: /Abrir menú/i })).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: /Abrir menú/i }));

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
