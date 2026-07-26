/**
 * Component tests for Header.
 *
 * Covers loading, unauthenticated, and authenticated states for every user
 * role. Validates nav link visibility, active-link highlighting, and the
 * mobile menu toggle.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Header from "@/components/Header";

interface MockLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  children: React.ReactNode;
  href: string;
}

interface MockImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  fill?: boolean;
  priority?: boolean;
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPathname = vi.fn<() => string>();

vi.mock("next/navigation", (): { usePathname: () => string } => ({
  usePathname: (): string => mockPathname(),
}));

vi.mock("next/link", (): { __esModule: boolean; default: (props: MockLinkProps) => React.ReactElement } => ({
  __esModule: true,
  default: ({
    children,
    href,
    ...props
  }: MockLinkProps): React.ReactElement => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/image", (): { __esModule: boolean; default: (props: MockImageProps) => React.ReactElement } => ({
  __esModule: true,
  default: (props: MockImageProps): React.ReactElement => {
    // Strip Next.js-specific props, keep standard img attrs
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

// Wraps the real implementation by default (every other test relies on real
// role-based nav links) — only the active-link tests below override it with
// a synthetic, route-table-independent link list via `mockReturnValueOnce`.
vi.mock("@/lib/auth-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-utils")>();
  return {
    ...actual,
    getNavLinksForRole: vi.fn(actual.getNavLinksForRole),
  };
});

// useNotificaciones (consumed once by Header, fed into every rendered
// NotificationBell) fetches on mount — stub it out so Header's tests don't
// depend on network/timer behavior unrelated to nav/auth rendering.
const mockFetchNotificaciones = vi.fn().mockResolvedValue([]);
const mockMarcarNotificacionLeida = vi.fn().mockResolvedValue(undefined);
vi.mock("@/services/api", () => ({
  fetchNotificaciones: () => mockFetchNotificaciones(),
  marcarNotificacionLeida: (id: number) => mockMarcarNotificacionLeida(id),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { useAuth } from "@/contexts/AuthContext";
import { getNavLinksForRole } from "@/lib/auth-utils";
import {
  createUnauthenticatedAuth,
  createAuthenticatedAuth,
  createLoadingAuth,
} from "./test-utils";

const mockUseAuth = vi.mocked(useAuth);
const mockGetNavLinksForRole = vi.mocked(getNavLinksForRole);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Header", (): void => {
  beforeEach((): void => {
    // A neutral route that isn't landing, an auth-shell route, an app-shell
    // route, or a standalone screen (those all hide the header entirely — see
    // the dedicated describe blocks below).
    mockPathname.mockReturnValue("/contacto");
    mockUseAuth.mockReset();
    // Default: not loading, not authenticated
    mockUseAuth.mockReturnValue(createUnauthenticatedAuth(false));
    mockFetchNotificaciones.mockClear();
    mockFetchNotificaciones.mockResolvedValue([]);
    mockMarcarNotificacionLeida.mockClear();
    mockMarcarNotificacionLeida.mockResolvedValue(undefined);
  });

  it("hides the header on the landing route when requested", (): void => {
    mockPathname.mockReturnValue("/");
    render(<Header hideOnLanding />);

    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
  });

  it("shows the header on a non-landing route when landing hiding is requested", (): void => {
    mockPathname.mockReturnValue("/contacto");

    render(<Header hideOnLanding />);

    expect(screen.getByRole("banner")).toBeInTheDocument();
  });

  // --- Auth shell routes (login, register, forgot-password) ---

  it.each(["/login", "/forgot-password", "/reset-password"])(
    "hides the header on the %s auth-shell route",
    (route): void => {
      mockPathname.mockReturnValue(route);

      render(<Header />);

      expect(screen.queryByRole("banner")).not.toBeInTheDocument();
    },
  );

  it.each([
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
    "/profile",
    "/admin/crear-cuenta",
    // Prefix-matched descendants: a flow must not change chrome halfway.
    "/student/payments",
    "/student/add-dependent",
    "/trainer/attendance/history",
  ])("hides the header on the %s app-shell route", (route): void => {
    mockPathname.mockReturnValue(route);
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("admin", "Admin"));

    render(<Header />);

    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
  });

  // --- Loading skeleton ---

  it("shows skeleton while session is hydrating", (): void => {
    mockUseAuth.mockReturnValue(createLoadingAuth());

    render(<Header />);

    // Brand visible but as plain text, not a link
    expect(screen.getByText("Cata Club")).toBeInTheDocument();

    // No nav links rendered
    expect(screen.queryByRole("link", { name: /Inicio/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Iniciar Sesi\u00f3n/i })).not.toBeInTheDocument();
  });

  // --- Institutional Header (landing page) ---

  it("shows institutional links on landing page", () => {
    mockPathname.mockReturnValue("/");
    render(<Header />);

    // Brand shows "Cata Club" + "Tenis de Mesa"
    expect(screen.getByText("Cata Club")).toBeInTheDocument();
    expect(screen.getByText("Tenis de Mesa")).toBeInTheDocument();

    // Institutional navigation
    expect(screen.getByRole("link", { name: /Inicio/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Nosotros/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Formaci\u00f3n/i })).toBeInTheDocument();

    // Login button for unauthenticated users
    expect(
      screen.getByRole("link", { name: /Iniciar sesi\u00f3n/i }),
    ).toBeInTheDocument();

    // No app-specific elements
    expect(screen.queryByText("Demo")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cerrar Sesi\u00f3n/i })).not.toBeInTheDocument();
  });

  it("shows institutional mobile menu on landing", () => {
    mockPathname.mockReturnValue("/");
    render(<Header />);

    fireEvent.click(screen.getByRole("button", { name: /Abrir men\u00fa/i }));

    // Mobile menu has institutional links
    expect(screen.getAllByRole("link", { name: /Inicio/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /Iniciar sesi\u00f3n/i }).length).toBeGreaterThan(0);
  });

  // --- Unauthenticated ---

  it("shows Inicio and Iniciar Sesión when not authenticated", (): void => {
    render(<Header />);

    expect(screen.getByRole("link", { name: /Inicio/i })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Iniciar Sesión/i }),
    ).toBeInTheDocument();

    // Authenticated-only elements are absent
    expect(screen.queryByText("Panel de Control")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Menú de cuenta/i })).not.toBeInTheDocument();
  });

  // --- Authenticated — admin ---

  it("shows admin nav links, user name, and account menu trigger", (): void => {
    mockUseAuth.mockReturnValue(
      createAuthenticatedAuth("admin", "Admin Cata Club"),
    );

    render(<Header />);

    // Admin-specific links
    expect(screen.getByRole("link", { name: /Inicio/i })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Panel de Control/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Miembros/i })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /^Horarios$/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Membresías/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Asistencias/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Reportes/i }),
    ).toBeInTheDocument();

    // User info
    expect(screen.getByText("Admin Cata Club")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Menú de cuenta/i }),
    ).toBeInTheDocument();
  });

  it("opens the account menu with Perfil and Cerrar Sesión when the desktop trigger is clicked", (): void => {
    mockUseAuth.mockReturnValue(
      createAuthenticatedAuth("admin", "Admin Cata Club"),
    );

    render(<Header />);

    fireEvent.click(screen.getByRole("button", { name: /Menú de cuenta/i }));

    expect(screen.getByRole("link", { name: /Perfil/i })).toHaveAttribute("href", "/profile");
    expect(screen.getByRole("button", { name: /Cerrar Sesión/i })).toBeInTheDocument();
  });

  // --- Authenticated — trainer ---

  it("shows trainer nav links", (): void => {
    mockUseAuth.mockReturnValue(
      createAuthenticatedAuth("trainer", "Carlos Entrenador"),
    );

    render(<Header />);

    // Trainer gets Inicio + Mi día + Pasar lista + Niveles. Level assignment
    // is NOT an admin-only action — the backend grants ENTRENADOR both
    // `asignar-nivel-inicial` and `mover-de-nivel` — and `/trainer/nivel`
    // renders the same ladder screen `/ranking` does, under the same label.
    expect(screen.getByRole("link", { name: /Inicio/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Mi día" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pasar lista" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Niveles" })).toHaveAttribute(
      "href",
      "/trainer/nivel",
    );

    // The nav must not carry an English label — see auth-utils.
    expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();

    // Other roles not visible
    expect(
      screen.queryByText("Panel de Control"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Mi cuenta")).not.toBeInTheDocument();

    // User info
    expect(screen.getByText("Carlos Entrenador")).toBeInTheDocument();
  });

  // --- Authenticated — representante ---

  it("shows representante nav link", (): void => {
    mockUseAuth.mockReturnValue(
      createAuthenticatedAuth("representante", "Carlos Martinez"),
    );

    render(<Header />);

    expect(screen.getByRole("link", { name: /Inicio/i })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Mi cuenta/i }),
    ).toBeInTheDocument();

    // Other roles not visible
    expect(
      screen.queryByText("Panel de Control"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Mi día")).not.toBeInTheDocument();

    expect(screen.getByText("Carlos Martinez")).toBeInTheDocument();
  });

  // --- Active link highlighting ---

  // Every admin/trainer/student nav destination is now an app-shell route
  // (hidden header, see the describe block above), so no real business
  // route keeps a multi-link nav on the top Header. These tests decouple
  // the aria-current logic from the route table by stubbing
  // `getNavLinksForRole` with a synthetic link list on a neutral route.
  it("marks the active link with aria-current=\"page\"", (): void => {
    mockGetNavLinksForRole.mockReturnValueOnce([
      { href: "/contacto", label: "Inicio" },
      { href: "/somewhere-else", label: "Otro" },
    ]);
    mockPathname.mockReturnValue("/contacto");
    mockUseAuth.mockReturnValue(
      createAuthenticatedAuth("trainer", "Carlos Entrenador"),
    );

    render(<Header />);

    const activeLink = screen.getByRole("link", { name: /Inicio/i });
    expect(activeLink).toHaveAttribute("aria-current", "page");
  });

  it("does not apply aria-current to non-current route links", (): void => {
    mockGetNavLinksForRole.mockReturnValueOnce([
      { href: "/contacto", label: "Inicio" },
      { href: "/somewhere-else", label: "Otro" },
    ]);
    mockPathname.mockReturnValue("/contacto");
    mockUseAuth.mockReturnValue(
      createAuthenticatedAuth("trainer", "Carlos Entrenador"),
    );

    render(<Header />);

    const otherLink = screen.getByRole("link", { name: /Otro/i });
    expect(otherLink).not.toHaveAttribute("aria-current");
  });

  // --- Mobile menu ---

  it("toggles mobile menu open and closed", (): void => {
    render(<Header />);

    const menuButton = screen.getByRole("button", { name: /Abrir menú/i });
    expect(menuButton).toBeInTheDocument();
    expect(menuButton).toHaveAttribute("aria-expanded", "false");

    // Mobile menu is closed initially — nav not visible on mobile
    // (the desktop nav is rendered but hidden via CSS, the mobile panel is not rendered)
    expect(screen.queryByText("Cerrar Sesión")).not.toBeInTheDocument();

    // Open mobile menu
    fireEvent.click(menuButton);

    // Now the mobile menu button label changes to "Cerrar menú"
    expect(screen.queryByRole("button", { name: /Abrir menú/i })).not.toBeInTheDocument();
    const closeMenuButton = screen.getByRole("button", { name: /Cerrar menú/i });
    expect(closeMenuButton).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(closeMenuButton);

    expect(screen.getByRole("button", { name: /Abrir menú/i })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("renders mobile nav panel with admin links when authenticated", (): void => {
    mockUseAuth.mockReturnValue(
      createAuthenticatedAuth("admin", "Admin"),
    );

    render(<Header />);

    // Open mobile menu
    fireEvent.click(screen.getByRole("button", { name: /Abrir menú/i }));

    // Logout button should appear in mobile panel
    const logoutButtons = screen.getAllByRole("button", { name: /Cerrar Sesión/i });
    // At least one is visible (mobile logout)
    expect(logoutButtons.length).toBeGreaterThan(0);

    // User name visible
    expect(screen.getAllByText("Admin").length).toBeGreaterThan(0);
  });

  // --- Notifications (single shared poll across desktop + mobile bells) ---

  it("fetches notifications only once even with both desktop and mobile bells mounted", (): void => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("admin", "Admin"));

    render(<Header />);
    // Open the mobile menu — desktop bell (CSS-hidden, still mounted) and
    // mobile bell are now both in the DOM at once.
    fireEvent.click(screen.getByRole("button", { name: /Abrir menú/i }));

    expect(screen.getAllByRole("button", { name: /notificaciones/i }).length).toBe(2);
    // One Header-level hook call feeds both — not one fetch per bell.
    expect(mockFetchNotificaciones).toHaveBeenCalledTimes(1);
  });

  it("restores the previous read state when marking a notification as read fails", async (): Promise<void> => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("admin", "Admin"));
    mockFetchNotificaciones.mockResolvedValue([
      {
        id: 7,
        tipo: "MIEMBRESIA_VENCIMIENTO_PROXIMO",
        mensaje: "Tu membresía vence pronto.",
        leida: false,
        fechaCreacion: "2026-07-19T10:00:00Z",
        entidadRelacionadaId: 5,
      },
    ]);
    mockMarcarNotificacionLeida.mockRejectedValue(new Error("network down"));

    render(<Header />);

    const bellButton = await screen.findByRole("button", { name: /1 sin leer/i });
    fireEvent.click(bellButton);

    const notificationItem = await screen.findByText(/vence pronto/i);
    fireEvent.click(notificationItem);

    // Optimistic update applies immediately: unread badge clears.
    expect(screen.queryByRole("button", { name: /1 sin leer/i })).not.toBeInTheDocument();

    // Once the failed call settles, the snapshot is restored explicitly —
    // not by relying on a reload (which could itself fail during an outage).
    await screen.findByRole("button", { name: /1 sin leer/i });
  });

  // --- Logout ---

  it("calls logout when Cerrar Sesión is clicked from the desktop account menu", (): void => {
    const mockLogout = vi.fn();
    mockUseAuth.mockReturnValue(
      createAuthenticatedAuth("admin", "Admin", { logout: mockLogout }),
    );

    render(<Header />);

    fireEvent.click(screen.getByRole("button", { name: /Menú de cuenta/i }));
    fireEvent.click(screen.getByRole("button", { name: /Cerrar Sesión/i }));

    expect(mockLogout).toHaveBeenCalledTimes(1);
  });

  it("calls logout when mobile logout button is clicked", (): void => {
    const mockLogout = vi.fn();
    mockUseAuth.mockReturnValue(
      createAuthenticatedAuth("admin", "Admin", { logout: mockLogout }),
    );

    render(<Header />);

    // Open mobile menu
    fireEvent.click(screen.getByRole("button", { name: /Abrir menú/i }));

    // Click the mobile logout button (there are two: desktop and mobile)
    const logoutButtons = screen.getAllByRole("button", { name: /Cerrar Sesión/i });
    // The last button in DOM is the mobile one
    fireEvent.click(logoutButtons[logoutButtons.length - 1]);

    expect(mockLogout).toHaveBeenCalledTimes(1);
  });
});
