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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, fireEvent } from "@testing-library/react";
import Header, { NAV_ICON_MAP } from "@/components/Header";
import type { UserRole } from "@/types/domain";

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
    getNavGroupsForRoles: vi.fn(actual.getNavGroupsForRoles),
  };
});

// useNotificaciones (consumed once by Header, fed into every rendered
// NotificationBell) fetches on mount — stub it out so Header's tests don't
// depend on network/timer behavior unrelated to nav/auth rendering.
const mockFetchNotificaciones = vi.fn().mockResolvedValue({ items: [], total: 0, skip: 0, limit: 20 });
const mockMarcarNotificacionLeida = vi.fn().mockResolvedValue(undefined);
vi.mock("@/services/api", () => ({
  fetchNotificaciones: () => mockFetchNotificaciones(),
  marcarNotificacionLeida: (id: number) => mockMarcarNotificacionLeida(id),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { useAuth } from "@/contexts/AuthContext";
import { getNavGroupsForRoles } from "@/lib/auth-utils";
import {
  createUnauthenticatedAuth,
  createAuthenticatedAuth,
  createLoadingAuth,
  createMultiRoleAuth,
} from "./test-utils";

const mockUseAuth = vi.mocked(useAuth);
const mockGetNavGroupsForRoles = vi.mocked(getNavGroupsForRoles);

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
    mockFetchNotificaciones.mockResolvedValue({ items: [], total: 0, skip: 0, limit: 20 });
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
    "/groups",
    "/payments",
    "/attendance",
    "/trainer",
    "/trainer/attendance",
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

    // Institutional navigation \u2014 the landing's own sections, since issue #771.
    // "Nosotros" and "Formaci\u00f3n" used to be asserted here: they belonged to a
    // second, drifted menu whose links pointed at `#proposito` (an id no page
    // has) and back at `#inicio`. The full list, its order and the href form
    // are locked in `site-navigation-parity.test.tsx`; this only checks that
    // the institutional bar is the one being drawn.
    expect(screen.getByRole("link", { name: "Inicio" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Horarios" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Logros" })).toBeInTheDocument();

    // Login button for unauthenticated users
    expect(
      screen.getByRole("link", { name: /Iniciar sesi\u00f3n/i }),
    ).toBeInTheDocument();

    // No app-specific elements
    expect(screen.queryByText("Demo")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cerrar Sesi\u00f3n/i })).not.toBeInTheDocument();
  });

  // The wordmark is `text-2xs` — 10.5px, i.e. NORMAL text for WCAG 1.4.3 — on
  // the bar's `bg-cata-dark/95`, where `cata-red` measures 3.63:1 and the
  // palette's on-dark companion measures 4.88:1 (`color-contrast.test.ts`).
  // The assertion reads the exact class TOKEN rather than a substring, because
  // `text-cata-red-light` CONTAINS `text-cata-red`: a `toContain` check on the
  // className string would pass on the failing class too.
  it("prints the wordmark in the on-dark red, not in the CTA fill", (): void => {
    mockPathname.mockReturnValue("/");
    render(<Header />);

    const classes = screen.getByText("Tenis de Mesa").className.split(/\s+/);

    expect(classes).toContain("text-cata-red-light");
    expect(classes).not.toContain("text-cata-red");
  });

  it("shows institutional mobile menu on landing", () => {
    mockPathname.mockReturnValue("/");
    render(<Header />);

    fireEvent.click(screen.getByRole("button", { name: /Abrir men\u00fa/i }));

    // Mobile menu has institutional links
    expect(screen.getAllByRole("link", { name: /Inicio/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /Iniciar sesi\u00f3n/i }).length).toBeGreaterThan(0);
  });

  // --- Public legal routes (issue #782) ---
  //
  // `/terminos`, `/privacidad` and `/permiso-imagen-fetm` are the pages a user
  // opens FROM INSIDE the product — accepting a consent, re-reading what they
  // signed — so the header there has to answer the session question the same
  // way the rest of the product does. The legal branch used to be taken before
  // any auth check, so it always drew the anonymous bar: an administrator with
  // a live session was told to "Iniciar sesión", and clicking it landed him on
  // a login screen he did not need.

  const LEGAL_ROUTES = ["/terminos", "/privacidad", "/permiso-imagen-fetm"];

  it.each(LEGAL_ROUTES)("offers Iniciar sesión on %s to an anonymous visitor", (route): void => {
    mockPathname.mockReturnValue(route);

    render(<Header />);

    expect(screen.getByRole("link", { name: /Iniciar sesión/i })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(screen.queryByRole("button", { name: /Menú de cuenta/i })).not.toBeInTheDocument();
  });

  it.each(LEGAL_ROUTES)("offers the account, not a login link, on %s with a live session", (route): void => {
    mockPathname.mockReturnValue(route);
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("admin", "Admin Cata Club"));

    render(<Header />);

    expect(screen.queryByRole("link", { name: /Iniciar sesión/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Menú de cuenta/i })).toBeInTheDocument();
    expect(screen.getByText("Admin Cata Club")).toBeInTheDocument();
  });

  // The document's own navigation belongs to the PAGE, not to the visitor: a
  // signed-in reader of the terms must still be able to reach the club's
  // sections from here, and the six links are locked by
  // `site-navigation-parity.test.tsx`.
  it("keeps the institutional sections on a legal route for a signed-in user", (): void => {
    mockPathname.mockReturnValue("/terminos");
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("admin", "Admin Cata Club"));

    render(<Header />);

    expect(screen.getByRole("link", { name: "Horarios" })).toHaveAttribute("href", "/#horarios");
    expect(screen.getByRole("link", { name: "Contacto" })).toBeInTheDocument();
  });

  it("opens Perfil and Cerrar Sesión from the account menu on a legal route", (): void => {
    mockPathname.mockReturnValue("/privacidad");
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("admin", "Admin Cata Club"));

    render(<Header />);

    fireEvent.click(screen.getByRole("button", { name: /Menú de cuenta/i }));

    expect(screen.getByRole("link", { name: /Perfil/i })).toHaveAttribute("href", "/profile");
    expect(screen.getByRole("button", { name: /Cerrar Sesión/i })).toBeInTheDocument();
  });

  // Hydration. The session lives behind an HttpOnly cookie that only the BFF
  // can read, so the server-rendered markup — which is also the first client
  // render — cannot know the answer. Committing to either one there is a
  // guaranteed flash for half the users; the slot stays neutral until the
  // answer arrives, and only then names it.
  it("commits to neither session answer on a legal route until hydration resolves", (): void => {
    mockPathname.mockReturnValue("/terminos");
    mockUseAuth.mockReturnValue(createLoadingAuth());

    const { rerender } = render(<Header />);

    expect(screen.queryByRole("link", { name: /Iniciar sesión/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Menú de cuenta/i })).not.toBeInTheDocument();
    // The part that depends on no session is already drawn, so the bar does
    // not arrive in two pieces either.
    expect(screen.getByRole("link", { name: "Horarios" })).toBeInTheDocument();

    mockUseAuth.mockReturnValue(createAuthenticatedAuth("admin", "Admin Cata Club"));
    rerender(<Header />);

    expect(screen.getByRole("button", { name: /Menú de cuenta/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Iniciar sesión/i })).not.toBeInTheDocument();
  });

  it("resolves to the login link on a legal route when the visitor is anonymous", (): void => {
    mockPathname.mockReturnValue("/terminos");
    mockUseAuth.mockReturnValue(createLoadingAuth());

    const { rerender } = render(<Header />);

    expect(screen.queryByRole("link", { name: /Iniciar sesión/i })).not.toBeInTheDocument();

    mockUseAuth.mockReturnValue(createUnauthenticatedAuth(false));
    rerender(<Header />);

    expect(screen.getByRole("link", { name: /Iniciar sesión/i })).toBeInTheDocument();
  });

  it("replaces the legal mobile menu's login item with the account items", (): void => {
    mockPathname.mockReturnValue("/permiso-imagen-fetm");
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("representante", "Carlos Martinez"));

    render(<Header />);

    fireEvent.click(screen.getByRole("button", { name: /Abrir menú/i }));

    expect(screen.queryByRole("link", { name: /Iniciar sesión/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Perfil/i })).toHaveAttribute("href", "/profile");
    expect(screen.getByRole("button", { name: /Cerrar Sesión/i })).toBeInTheDocument();
    expect(screen.getAllByText("Carlos Martinez").length).toBeGreaterThan(0);
  });

  it("calls logout from the legal mobile menu", (): void => {
    const mockLogout = vi.fn();
    mockPathname.mockReturnValue("/terminos");
    mockUseAuth.mockReturnValue(
      createAuthenticatedAuth("admin", "Admin", { logout: mockLogout }),
    );

    render(<Header />);

    fireEvent.click(screen.getByRole("button", { name: /Abrir menú/i }));
    fireEvent.click(screen.getByRole("button", { name: /Cerrar Sesión/i }));

    expect(mockLogout).toHaveBeenCalledTimes(1);
  });

  // The other half of issue #782: fixing the legal routes must not push the
  // institutional bar one route further, into the shell that draws its own.
  it.each(["/dashboard", "/student", "/trainer/attendance"])(
    "draws nothing at all on the %s app-shell route for a signed-in user",
    (route): void => {
      mockPathname.mockReturnValue(route);
      mockUseAuth.mockReturnValue(createAuthenticatedAuth("admin", "Admin Cata Club"));

      const { container } = render(<Header />);

      expect(container).toBeEmptyDOMElement();
    },
  );

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

    // Trainer gets Inicio + Mi día + Pasar lista.
    expect(screen.getByRole("link", { name: /Inicio/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Mi día" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pasar lista" })).toBeInTheDocument();

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

  // --- Authenticated — more than one role ---

  // The top bar is a horizontal strip on the public routes, so it draws the
  // rótulos of D12d nowhere — but it must still offer the same DESTINATIONS
  // the rail does. A trainer who also plays reaching `/ayuda` cannot be shown
  // a narrower product than the one he has inside the shell.
  it("shows every section of an account that holds more than one role", (): void => {
    mockUseAuth.mockReturnValue(
      createMultiRoleAuth(["ENTRENADOR", "ALUMNO"], "trainer", "Carlos Entrenador"),
    );

    render(<Header />);

    expect(screen.getByRole("link", { name: "Mi día" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pasar lista" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pagos" })).toBeInTheDocument();
    // "Mi cuenta" is the name of `/student`; there is no group heading up here
    // to collide with it.
    expect(screen.getByRole("link", { name: "Mi cuenta" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Panel de Control" })).not.toBeInTheDocument();
  });

  // --- Active link highlighting ---

  // Every admin/trainer/student nav destination is now an app-shell route
  // (hidden header, see the describe block above), so no real business
  // route keeps a multi-link nav on the top Header. These tests decouple
  // the aria-current logic from the route table by stubbing
  // `getNavGroupsForRoles` with a synthetic one-group list on a neutral route.
  it("marks the active link with aria-current=\"page\"", (): void => {
    mockGetNavGroupsForRoles.mockReturnValueOnce([
      {
        heading: null,
        links: [
          { href: "/contacto", label: "Inicio" },
          { href: "/somewhere-else", label: "Otro" },
        ],
      },
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
    mockGetNavGroupsForRoles.mockReturnValueOnce([
      {
        heading: null,
        links: [
          { href: "/contacto", label: "Inicio" },
          { href: "/somewhere-else", label: "Otro" },
        ],
      },
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
    mockFetchNotificaciones.mockResolvedValue({
      items: [
        {
          id: 7,
          tipo: "MIEMBRESIA_VENCIMIENTO_PROXIMO",
          mensaje: "Tu membresía vence pronto.",
          leida: false,
          fechaCreacion: "2026-07-19T10:00:00Z",
          entidadRelacionadaId: 5,
        },
      ],
      total: 1,
      skip: 0,
      limit: 20,
    });
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

// ---------------------------------------------------------------------------
// Icon coverage.
//
// Adding a navigation entry is TWO edits — the link in `getNavGroupsForRoles`
// and its glyph in `NAV_ICON_MAP` — and forgetting the second one is silent:
// every call site falls back instead of failing (`House` here at Header.tsx,
// `User` in the sidebar and the mobile tab bar at AppShell.tsx). The item just
// ships wearing someone else's icon. This locks the two halves together for
// every role at once, so the next entry cannot be added half-way.
// ---------------------------------------------------------------------------

describe("NAV_ICON_MAP", (): void => {
  it("has an icon for every href getNavGroupsForRoles can return, for every role", async (): Promise<void> => {
    // The real helper, not the `vi.fn` wrapper installed above: this asserts
    // the icon map against the navigation the app actually ships.
    const { getNavGroupsForRoles: realGetNavGroupsForRoles } =
      await vi.importActual<typeof import("@/lib/auth-utils")>("@/lib/auth-utils");

    const roleSets: (UserRole[] | null)[] = [
      null,
      ["admin"],
      ["trainer"],
      ["representante"],
      ["estudiante"],
      ["unsupported"],
      // The combination too: a group merged out of two roles must not be able
      // to surface a destination whose glyph nobody added.
      ["trainer", "estudiante"],
      ["representante", "estudiante"],
    ];
    const hrefs = new Set<string>();
    for (const roles of roleSets) {
      // Both sides of the age gate — an adult "estudiante" reaches one route a
      // minor never sees, and it needs an icon too.
      for (const studentIsAdult of [false, true]) {
        for (const group of realGetNavGroupsForRoles(roles, studentIsAdult)) {
          for (const link of group.links) {
            hrefs.add(link.href);
          }
        }
      }
    }

    const withoutIcon = [...hrefs].filter((href) => !(href in NAV_ICON_MAP));
    expect(withoutIcon).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Chrome separation.
//
// `AppShell` draws the authenticated shell and borrows exactly ONE thing from
// this module: the icon map. It has never imported the component, and the
// render assertions above only prove that today's routes behave — a future
// `<Header />` mounted inside the shell would put the institutional bar on top
// of the sidebar's own. The import is the thing that would have to change
// first, so that is what this locks (issue #782, criterion 3).
// ---------------------------------------------------------------------------

describe("AppShell chrome separation", (): void => {
  it("imports only the icon map from Header, never the component", (): void => {
    const source = readFileSync(join(__dirname, "..", "shell", "AppShell.tsx"), "utf8");

    const imports = [...source.matchAll(/import\s+([^;]*?)\s+from\s+"@\/components\/Header"/g)];

    expect(imports).toHaveLength(1);
    expect(imports[0][1]).toBe("{ NAV_ICON_MAP }");
  });
});
