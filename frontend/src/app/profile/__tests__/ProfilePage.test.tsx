/**
 * Component tests for ProfilePage (issue #36) — the unified "Mi cuenta"
 * screen (header + hero card + 3-column grid + banner) whose content swaps
 * by role.
 *
 * Mirrors the mocking pattern established by StudentPage.test.tsx /
 * ProtectedRoute.test.tsx (ProtectedRoute passthrough, next/navigation,
 * AuthContext, @/services/api all stubbed).
 *
 * Some display values (full name, correo, "miembro desde" date) intentionally
 * appear in more than one place in the new layout (hero card AND the
 * "Información personal" column) — tests scope those queries with `within`
 * or assert exact counts via `getAllByText` rather than assuming a single
 * match.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import ProfilePage from "@/app/profile/page";
import type { PerfilPropio } from "@/types/domain";
import { ToastProvider } from "@/contexts/ToastContext";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/components/ProtectedRoute", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const mockReplace = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/profile",
  useRouter: () => ({ replace: mockReplace, push: vi.fn() }),
}));

vi.mock("next/image", () => ({
  __esModule: true,
  // eslint-disable-next-line @next/next/no-img-element
  default: (props: Record<string, unknown>) => <img alt="" {...props} />,
}));

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: vi.fn(),
}));

const mockFetchMiPerfil = vi.fn();
const mockActualizarMiPerfil = vi.fn();
const mockSolicitarRecuperacion = vi.fn();
const mockFetchStudentPortal = vi.fn();
const mockSubirFotoPerfil = vi.fn();
const mockFetchNotificaciones = vi.fn().mockResolvedValue([]);
const mockMarcarNotificacionLeida = vi.fn().mockResolvedValue(undefined);

vi.mock("@/services/api", () => ({
  fetchMiPerfil: () => mockFetchMiPerfil(),
  actualizarMiPerfil: (data: unknown) => mockActualizarMiPerfil(data),
  solicitarRecuperacion: (correo: string) => mockSolicitarRecuperacion(correo),
  fetchStudentPortal: (personaId: string) => mockFetchStudentPortal(personaId),
  subirFotoPerfil: (archivo: File) => mockSubirFotoPerfil(archivo),
  fetchNotificaciones: () => mockFetchNotificaciones(),
  marcarNotificacionLeida: (id: number) => mockMarcarNotificacionLeida(id),
  ApiClientError: class ApiClientError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = "ApiClientError";
      this.status = status;
    }
  },
}));

import { useAuth } from "@/contexts/AuthContext";
const mockUseAuth = vi.mocked(useAuth);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ADMIN_SESSION = {
  session: {
    user: {
      id: "1",
      name: "Ana Admin",
      email: "ana.admin@cataclub.com",
      role: "admin" as const,
      representanteId: null,
    },
    roles: ["ADMINISTRADOR"],
    loggedInAt: "2026-07-01T12:00:00Z",
  },
  isAuthenticated: true,
  isLoading: false,
  login: vi.fn(),
  logout: vi.fn(),
  refreshSession: vi.fn(),
};

function sessionForRole(role: "admin" | "trainer" | "representante" | "estudiante") {
  const user =
    role === "estudiante"
      ? { ...ADMIN_SESSION.session.user, role, grupoId: null, activo: true }
      : { ...ADMIN_SESSION.session.user, role };

  return {
    ...ADMIN_SESSION,
    session: { ...ADMIN_SESSION.session, user },
  };
}

const PERFIL_ADMIN: PerfilPropio = {
  correo: "ana.admin@cataclub.com",
  personaId: 1,
  nombres: "Ana",
  apellidos: "Admin",
  roles: ["ADMINISTRADOR"],
  telefono: "099111222",
  fechaCreacion: "2024-03-10T14:22:05.123456",
};

beforeEach(() => {
  mockReplace.mockReset();
  mockFetchMiPerfil.mockReset();
  mockActualizarMiPerfil.mockReset();
  mockSolicitarRecuperacion.mockReset();
  mockFetchStudentPortal.mockReset();
  mockSubirFotoPerfil.mockReset();
  mockUseAuth.mockReset();
  // Default so the student/representante branch's supplementary
  // fetchMiPerfil() call (fetched only to read `fotoUrl` for the hero
  // avatar — see ProfileContent) doesn't crash tests that don't care about
  // it. Staff-branch tests override this per-call via mockResolvedValueOnce.
  mockFetchMiPerfil.mockResolvedValue({
    correo: "sin-foto@cataclub.com",
    personaId: 0,
    nombres: "",
    apellidos: "",
    roles: [],
    telefono: "",
    fechaCreacion: "2024-01-01T00:00:00",
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ProfilePage — staff view (ADMINISTRADOR/ENTRENADOR)", () => {
  it("renders the authenticated staff user's own identity fields", async () => {
    mockUseAuth.mockReturnValue(sessionForRole("admin"));
    mockFetchMiPerfil.mockResolvedValueOnce(PERFIL_ADMIN);

    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );

    // Full name and correo appear twice by design (hero card + "Información
    // personal" column) — assert both occurrences exist. Scoped to <main>
    // since the session name ("Ana Admin") also appears once more in the
    // AppShell sidebar footer, which is unrelated shell chrome.
    await screen.findAllByText("Ana Admin");
    const main = screen.getByRole("main");
    expect(within(main).getAllByText("Ana Admin").length).toBe(2);
    expect(screen.getAllByText("ana.admin@cataclub.com").length).toBe(2);
    expect(screen.getByText("099111222")).toBeInTheDocument();
    expect(screen.getByText("ADMINISTRADOR")).toBeInTheDocument();
    expect(screen.getByText(/miembro desde/i)).toBeInTheDocument();
    expect(screen.getByText(/fecha de registro/i)).toBeInTheDocument();
    // Formatted fechaCreacion also appears twice (hero "Miembro desde" +
    // column 1 "Fecha de registro").
    expect(screen.getAllByText("10/03/2024").length).toBe(2);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("renders the same staff fields for an ENTRENADOR session (triangulation)", async () => {
    mockUseAuth.mockReturnValue(sessionForRole("trainer"));
    mockFetchMiPerfil.mockResolvedValueOnce({
      ...PERFIL_ADMIN,
      correo: "carla.entrenadora@cataclub.com",
      nombres: "Carla",
      apellidos: "Entrenadora",
      roles: ["ENTRENADOR"],
      telefono: "099333444",
      fechaCreacion: "2025-11-02T08:00:00",
    });

    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );

    expect((await screen.findAllByText("Carla Entrenadora")).length).toBe(2);
    expect(screen.getAllByText("carla.entrenadora@cataclub.com").length).toBe(2);
    expect(screen.getByText("ENTRENADOR")).toBeInTheDocument();
    // Different fechaCreacion than the admin fixture — proves the date is
    // computed from `perfil.fechaCreacion`, not hardcoded.
    expect(screen.getAllByText("02/11/2025").length).toBe(2);
  });

  it("does not render nombres/apellidos/roles as editable inputs", async () => {
    mockUseAuth.mockReturnValue(sessionForRole("admin"));
    mockFetchMiPerfil.mockResolvedValueOnce(PERFIL_ADMIN);

    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );

    await screen.findAllByText("Ana Admin");
    expect(screen.queryByDisplayValue("Ana")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("Admin")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("ADMINISTRADOR")).not.toBeInTheDocument();
  });
});

describe("ProfilePage — student/representante summary view", () => {
  it("renders the estudiante's own profile in the hero card with ranking and membership status", async () => {
    mockUseAuth.mockReturnValue(sessionForRole("estudiante"));
    mockFetchStudentPortal.mockResolvedValueOnce({
      self: {
        personaId: "1",
        nombres: "Sofía",
        apellidos: "Alumna",
        fechaNacimiento: "2012-05-10",
        ranking: {
          status: "available",
          nivelNombre: "Nivel 3",
          estaEnRanking: true,
        },
        recentSessions: [],
        membership: { id: 1, estado: "ACTIVA", personaId: 1, montoAplicado: "85.00", categoria: "Mensual", modalidad: "MENSUAL", franjaHoraria: "Tarde" },
      },
      representados: [],
      membershipPlans: [],
    });

    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );

    // Full name appears twice by design (hero card + "Información personal"
    // column, same as the staff branch).
    expect((await screen.findAllByText("Sofía Alumna")).length).toBe(2);
    expect(screen.getByText("Nivel 3")).toBeInTheDocument();
    // "Activa" appears three times by design: the hero's left status badge,
    // the hero's "Suscripción / Membresía" info block, and the "Estado de
    // cuenta" column's highlighted box.
    expect(screen.getAllByText("Activa").length).toBe(3);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("shows the honest 'no disponible' fallback (hero + status column) when self has no matching membership row", async () => {
    mockUseAuth.mockReturnValue(sessionForRole("estudiante"));
    mockFetchStudentPortal.mockResolvedValueOnce({
      self: {
        personaId: "1",
        nombres: "Sofía",
        apellidos: "Alumna",
        fechaNacimiento: "2012-05-10",
        ranking: { status: "unavailable", reason: "error" },
        recentSessions: [],
      },
      representados: [],
      membershipPlans: [],
      memberships: [],
    });

    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );

    expect((await screen.findAllByText("Sofía Alumna")).length).toBe(2);
    expect(screen.getAllByText("No disponible — consulte con administración").length).toBe(2);
  });

  it("renders one summary card per representado for a representante session, always showing the honest 'no disponible' fallback for their membership (the backend never scopes /membresias/mias to a dependent, only to the caller) (triangulation)", async () => {
    mockUseAuth.mockReturnValue(sessionForRole("representante"));
    mockFetchStudentPortal.mockResolvedValueOnce({
      self: null,
      representados: [
        {
          personaId: "20",
          nombres: "Juan",
          apellidos: "Hijo",
          fechaNacimiento: "2014-02-01",
          ranking: { status: "unavailable", reason: "forbidden" },
          recentSessions: [],
          membership: null,
        },
        {
          personaId: "21",
          nombres: "Ana",
          apellidos: "Hija",
          fechaNacimiento: "2016-08-15",
          ranking: { status: "unavailable", reason: "forbidden" },
          recentSessions: [],
          membership: null,
        },
      ],
      membershipPlans: [],
    });

    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );

    expect(await screen.findByText("Juan Hijo")).toBeInTheDocument();
    expect(screen.getByText("Ana Hija")).toBeInTheDocument();
    // No `self` profile here — the hero shows no membership badge at all
    // (there is no personal status to report), so only the 2 representado
    // cards contribute the fallback text.
    expect(screen.getAllByText("No disponible — consulte con administración")).toHaveLength(2);
    expect(screen.queryByText("Vencida")).not.toBeInTheDocument();
    // Hero center blocks (Ranking / Membresía) use "No aplica" for a
    // self:null account — distinct from "No disponible", which would
    // wrongly imply the account itself has an unreported status.
    expect(screen.getAllByText("No aplica")).toHaveLength(2);
  });

  it("shows the real membership status for self alongside representados who correctly get the 'no disponible' fallback (owner-scoping regression test)", async () => {
    mockUseAuth.mockReturnValue(sessionForRole("representante"));
    mockFetchStudentPortal.mockResolvedValueOnce({
      self: {
        personaId: "1",
        nombres: "Rosa",
        apellidos: "Representante",
        fechaNacimiento: "1985-03-01",
          ranking: { status: "unavailable", reason: "forbidden" },
          recentSessions: [],
          membership: { id: 9, estado: "ACTIVA", personaId: 1, montoAplicado: "85.00", categoria: "Mensual", modalidad: "MENSUAL", franjaHoraria: null },
        },
        representados: [
          {
            personaId: "20",
            nombres: "Juan",
            apellidos: "Hijo",
            fechaNacimiento: "2014-02-01",
            ranking: { status: "unavailable", reason: "forbidden" },
            recentSessions: [],
            membership: null,
          },
        ],
        membershipPlans: [],
      });

    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );

    expect((await screen.findAllByText("Rosa Representante")).length).toBe(2);
    expect(screen.getByText("Juan Hijo")).toBeInTheDocument();
    // "Activa" for self appears three times (hero badge, hero info block,
    // status column); the fallback appears once (Juan's representado card
    // only).
    expect(screen.getAllByText("Activa").length).toBe(3);
    expect(screen.getByText("No disponible — consulte con administración")).toBeInTheDocument();
  });

  it("includes a link to the full /student portal for detail", async () => {
    mockUseAuth.mockReturnValue(sessionForRole("estudiante"));
    mockFetchStudentPortal.mockResolvedValueOnce({
      self: {
        personaId: "1",
        nombres: "Sofía",
        apellidos: "Alumna",
        fechaNacimiento: "2012-05-10",
        ranking: { status: "unavailable", reason: "error" },
        recentSessions: [],
      },
      representados: [],
      membershipPlans: [],
      memberships: [],
    });

    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );

    await screen.findAllByText("Sofía Alumna");
    const link = screen.getByRole("link", { name: /ver portal completo/i });
    expect(link).toHaveAttribute("href", "/student");
  });

  it("does not render the 'Ver portal completo' header link for staff roles", async () => {
    mockUseAuth.mockReturnValue(sessionForRole("admin"));
    mockFetchMiPerfil.mockResolvedValueOnce(PERFIL_ADMIN);

    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );

    await screen.findAllByText("Ana Admin");
    expect(screen.queryByRole("link", { name: /ver portal completo/i })).not.toBeInTheDocument();
  });

  it("shows a loading state and then an error with retry when the portal fetch fails", async () => {
    mockUseAuth.mockReturnValue(sessionForRole("estudiante"));
    mockFetchStudentPortal.mockRejectedValueOnce(new Error("No se pudo cargar su cuenta."));

    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo cargar su cuenta.");
    expect(screen.getByRole("button", { name: /reintentar/i })).toBeInTheDocument();
  });
});

describe("ProfilePage — staff view loading/error (structurally distinct from the student branch)", () => {
  it("shows an error with retry when fetchMiPerfil fails, and refetches on retry", async () => {
    mockUseAuth.mockReturnValue(sessionForRole("admin"));
    mockFetchMiPerfil.mockRejectedValueOnce(new Error("No se pudo cargar su perfil."));

    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo cargar su perfil.");
    const retryButton = screen.getByRole("button", { name: /reintentar/i });

    mockFetchMiPerfil.mockResolvedValueOnce(PERFIL_ADMIN);
    fireEvent.click(retryButton);

    await screen.findAllByText("Ana Admin");
    expect(within(screen.getByRole("main")).getAllByText("Ana Admin")).toHaveLength(2);
    expect(mockFetchMiPerfil).toHaveBeenCalledTimes(2);
  });
});

describe("ProfilePage — inline teléfono edit (correo is read-only)", () => {
  it("saves a new teléfono and displays the updated value", async () => {
    mockUseAuth.mockReturnValue(sessionForRole("admin"));
    mockFetchMiPerfil.mockResolvedValueOnce(PERFIL_ADMIN);
    mockActualizarMiPerfil.mockResolvedValueOnce({
      ...PERFIL_ADMIN,
      telefono: "099999000",
    });

    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );
    await screen.findAllByText("Ana Admin");

    fireEvent.click(screen.getByRole("button", { name: /editar información/i }));

    const telefonoInput = screen.getByLabelText(/teléfono/i);
    fireEvent.change(telefonoInput, { target: { value: "099999000" } });

    fireEvent.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => {
      expect(mockActualizarMiPerfil).toHaveBeenCalledWith({ telefono: "099999000" });
    });
    expect(await screen.findByText("099999000")).toBeInTheDocument();
  });

  it("never renders an editable correo field, even while editing", async () => {
    mockUseAuth.mockReturnValue(sessionForRole("admin"));
    mockFetchMiPerfil.mockResolvedValueOnce(PERFIL_ADMIN);

    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );
    await screen.findAllByText("Ana Admin");

    fireEvent.click(screen.getByRole("button", { name: /editar información/i }));

    expect(screen.queryByLabelText(/correo electrónico/i)).not.toBeInTheDocument();
    expect(screen.getAllByText("ana.admin@cataclub.com").length).toBe(2);
  });

  it("surfaces an error and reverts the teléfono when the save fails", async () => {
    mockUseAuth.mockReturnValue(sessionForRole("admin"));
    mockFetchMiPerfil.mockResolvedValueOnce(PERFIL_ADMIN);
    mockActualizarMiPerfil.mockRejectedValueOnce(new Error("No se pudo guardar los cambios."));

    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );
    await screen.findAllByText("Ana Admin");

    fireEvent.click(screen.getByRole("button", { name: /editar información/i }));
    const telefonoInput = screen.getByLabelText(/teléfono/i);
    fireEvent.change(telefonoInput, { target: { value: "099999000" } });
    fireEvent.click(screen.getByRole("button", { name: /guardar/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo guardar los cambios.");
    expect(screen.getByText("099111222")).toBeInTheDocument();
    expect(screen.queryByText("099999000")).not.toBeInTheDocument();
  });

  it("does not offer an edit trigger for the student/representante branch", async () => {
    mockUseAuth.mockReturnValue(sessionForRole("estudiante"));
    mockFetchStudentPortal.mockResolvedValueOnce({
      self: {
        personaId: "1",
        nombres: "Sofía",
        apellidos: "Alumna",
        fechaNacimiento: "2012-05-10",
        ranking: { status: "unavailable", reason: "error" },
        recentSessions: [],
      },
      representados: [],
      membershipPlans: [],
      memberships: [],
    });

    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );

    await screen.findAllByText("Sofía Alumna");
    expect(screen.queryByRole("button", { name: /editar información/i })).not.toBeInTheDocument();
    const infoColumn = screen.getByTestId("profile-column-info");
    expect(within(infoColumn).getByText(/esta información no se puede editar/i)).toBeInTheDocument();
  });
});

describe("ProfilePage — change password", () => {
  it("triggers the recovery-email flow for the logged-in user's own correo", async () => {
    mockUseAuth.mockReturnValue(sessionForRole("admin"));
    mockFetchMiPerfil.mockResolvedValueOnce(PERFIL_ADMIN);
    mockSolicitarRecuperacion.mockResolvedValueOnce({
      mensaje: "Si el correo está registrado, recibirá un enlace de recuperación.",
    });

    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );
    await screen.findAllByText("Ana Admin");

    fireEvent.click(screen.getByRole("button", { name: /cambiar contraseña/i }));

    await waitFor(() => {
      expect(mockSolicitarRecuperacion).toHaveBeenCalledWith("ana.admin@cataclub.com");
    });
    expect(
      await screen.findByText("Si el correo está registrado, recibirá un enlace de recuperación."),
    ).toBeInTheDocument();
  });

  it("surfaces an error message when the recovery-email request fails (triangulation)", async () => {
    mockUseAuth.mockReturnValue(sessionForRole("admin"));
    mockFetchMiPerfil.mockResolvedValueOnce(PERFIL_ADMIN);
    mockSolicitarRecuperacion.mockRejectedValueOnce(new Error("No se pudo enviar el correo."));

    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );
    await screen.findAllByText("Ana Admin");

    fireEvent.click(screen.getByRole("button", { name: /cambiar contraseña/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo enviar el correo.");
  });
});

describe("ProfilePage — unified layout structure", () => {
  it("renders the header, hero card, and both grid columns for a staff session", async () => {
    mockUseAuth.mockReturnValue(sessionForRole("admin"));
    mockFetchMiPerfil.mockResolvedValueOnce(PERFIL_ADMIN);

    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );

    await screen.findAllByText("Ana Admin");
    expect(screen.getByRole("heading", { level: 1, name: "Perfil" })).toBeInTheDocument();
    expect(
      screen.getByText("Gestiona tu información y consulta tu estado en el sistema."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("profile-hero")).toBeInTheDocument();
    expect(screen.getByTestId("profile-column-info")).toBeInTheDocument();
    expect(screen.getByTestId("profile-column-status")).toBeInTheDocument();
  });

  it("does not render a quick-access links column — redundant with AppShell's own sidebar nav", async () => {
    mockUseAuth.mockReturnValue(sessionForRole("admin"));
    mockFetchMiPerfil.mockResolvedValueOnce(PERFIL_ADMIN);

    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );

    await screen.findAllByText("Ana Admin");
    expect(screen.queryByTestId("profile-column-links")).not.toBeInTheDocument();
    expect(screen.queryByText("Accesos rápidos")).not.toBeInTheDocument();
  });
});

describe("ProfilePage — profile photo upload (staff branch, own hero avatar)", () => {
  it("shows the generic icon (no <img>) when the staff profile has no fotoUrl yet", async () => {
    mockUseAuth.mockReturnValue(sessionForRole("admin"));
    mockFetchMiPerfil.mockResolvedValueOnce(PERFIL_ADMIN);

    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );

    await screen.findAllByText("Ana Admin");
    const hero = screen.getByTestId("profile-hero");
    expect(within(hero).queryByRole("img", { name: /foto de perfil/i })).not.toBeInTheDocument();
  });

  it("renders the actual photo in the hero avatar when fotoUrl is present", async () => {
    mockUseAuth.mockReturnValue(sessionForRole("admin"));
    mockFetchMiPerfil.mockResolvedValueOnce({
      ...PERFIL_ADMIN,
      fotoUrl: "https://res.cloudinary.com/test/image/upload/perfil-ana.jpg",
    });

    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );

    await screen.findAllByText("Ana Admin");
    const hero = screen.getByTestId("profile-hero");
    const img = within(hero).getByRole("img", { name: /foto de perfil/i });
    expect(img).toHaveAttribute("src", "https://res.cloudinary.com/test/image/upload/perfil-ana.jpg");
  });

  it("only accepts image files via the hidden file input", async () => {
    mockUseAuth.mockReturnValue(sessionForRole("admin"));
    mockFetchMiPerfil.mockResolvedValueOnce(PERFIL_ADMIN);

    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );

    await screen.findAllByText("Ana Admin");
    expect(screen.getByTestId("foto-perfil-input")).toHaveAttribute("accept", "image/jpeg,image/png");
  });

  it("uploads the selected file and updates the displayed avatar on success", async () => {
    mockUseAuth.mockReturnValue(sessionForRole("admin"));
    mockFetchMiPerfil.mockResolvedValueOnce(PERFIL_ADMIN);
    mockSubirFotoPerfil.mockResolvedValueOnce({
      ...PERFIL_ADMIN,
      fotoUrl: "https://res.cloudinary.com/test/image/upload/perfil-ana.jpg",
    });

    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );
    await screen.findAllByText("Ana Admin");

    const input = screen.getByTestId("foto-perfil-input");
    const archivo = new File(["contenido"], "foto.jpg", { type: "image/jpeg" });
    fireEvent.change(input, { target: { files: [archivo] } });

    await waitFor(() => {
      expect(mockSubirFotoPerfil).toHaveBeenCalledWith(archivo);
    });

    const hero = await screen.findByTestId("profile-hero");
    await waitFor(() => {
      expect(within(hero).getByRole("img", { name: /foto de perfil/i })).toHaveAttribute(
        "src",
        "https://res.cloudinary.com/test/image/upload/perfil-ana.jpg",
      );
    });
  });

  it("shows an error message when the upload fails", async () => {
    mockUseAuth.mockReturnValue(sessionForRole("admin"));
    mockFetchMiPerfil.mockResolvedValueOnce(PERFIL_ADMIN);
    mockSubirFotoPerfil.mockRejectedValueOnce(new Error("No se pudo actualizar la foto de perfil."));

    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );
    await screen.findAllByText("Ana Admin");

    const input = screen.getByTestId("foto-perfil-input");
    const archivo = new File(["contenido"], "foto.jpg", { type: "image/jpeg" });
    fireEvent.change(input, { target: { files: [archivo] } });

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo actualizar la foto de perfil.");
  });

});

describe("ProfilePage — profile photo upload (student/representante branch, own hero avatar)", () => {
  it("offers the photo-upload trigger for an estudiante session too", async () => {
    mockUseAuth.mockReturnValue(sessionForRole("estudiante"));
    mockFetchStudentPortal.mockResolvedValueOnce({
      self: {
        personaId: "1",
        nombres: "Sofía",
        apellidos: "Alumna",
        fechaNacimiento: "2012-05-10",
        ranking: { status: "unavailable", reason: "error" },
        recentSessions: [],
      },
      representados: [],
      membershipPlans: [],
      memberships: [],
    });

    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );

    await screen.findAllByText("Sofía Alumna");
    expect(screen.getByTestId("foto-perfil-input")).toHaveAttribute("accept", "image/jpeg,image/png");
  });

  it("renders normally (no error surfaced) when the supplementary fotoUrl fetch fails", async () => {
    mockUseAuth.mockReturnValue(sessionForRole("estudiante"));
    mockFetchStudentPortal.mockResolvedValueOnce({
      self: {
        personaId: "1",
        nombres: "Sofía",
        apellidos: "Alumna",
        fechaNacimiento: "2012-05-10",
        ranking: { status: "unavailable", reason: "error" },
        recentSessions: [],
      },
      representados: [],
      membershipPlans: [],
      memberships: [],
    });
    // Overrides the beforeEach default: the supplementary fetchMiPerfil()
    // call (used only to read fotoUrl for the hero avatar) rejects, while
    // the primary fetchStudentPortal data still resolves.
    mockFetchMiPerfil.mockReset();
    mockFetchMiPerfil.mockRejectedValueOnce(new Error("network error"));

    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );

    await screen.findAllByText("Sofía Alumna");
    // No alert/error surfaced — the failure is cosmetic-only (silent), and
    // the avatar just falls back to the generic icon.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    const hero = screen.getByTestId("profile-hero");
    expect(within(hero).queryByRole("img", { name: /foto de perfil/i })).not.toBeInTheDocument();
  });

  it("uploads the selected file and updates the hero avatar for a representante session (triangulation)", async () => {
    mockUseAuth.mockReturnValue(sessionForRole("representante"));
    mockFetchStudentPortal.mockResolvedValueOnce({
      self: {
        personaId: "1",
        nombres: "Rosa",
        apellidos: "Representante",
        fechaNacimiento: "1985-03-01",
        ranking: { status: "unavailable", reason: "forbidden" },
        recentSessions: [],
      },
      representados: [],
      membershipPlans: [],
      memberships: [],
    });
    mockSubirFotoPerfil.mockResolvedValueOnce({
      correo: "rosa@cataclub.com",
      personaId: 1,
      nombres: "Rosa",
      apellidos: "Representante",
      roles: ["ESTUDIANTE"],
      telefono: "",
      fechaCreacion: "2024-01-01T00:00:00",
      fotoUrl: "https://res.cloudinary.com/test/image/upload/perfil-rosa.jpg",
    });

    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );
    await screen.findAllByText("Rosa Representante");

    const input = screen.getByTestId("foto-perfil-input");
    const archivo = new File(["contenido"], "foto.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [archivo] } });

    await waitFor(() => {
      expect(mockSubirFotoPerfil).toHaveBeenCalledWith(archivo);
    });

    const hero = await screen.findByTestId("profile-hero");
    await waitFor(() => {
      expect(within(hero).getByRole("img", { name: /foto de perfil/i })).toHaveAttribute(
        "src",
        "https://res.cloudinary.com/test/image/upload/perfil-rosa.jpg",
      );
    });
  });

  it("shows an error message when the upload fails for a student session", async () => {
    mockUseAuth.mockReturnValue(sessionForRole("estudiante"));
    mockFetchStudentPortal.mockResolvedValueOnce({
      self: {
        personaId: "1",
        nombres: "Sofía",
        apellidos: "Alumna",
        fechaNacimiento: "2012-05-10",
        ranking: { status: "unavailable", reason: "error" },
        recentSessions: [],
      },
      representados: [],
      membershipPlans: [],
      memberships: [],
    });
    mockSubirFotoPerfil.mockRejectedValueOnce(new Error("No se pudo actualizar la foto de perfil."));

    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );
    await screen.findAllByText("Sofía Alumna");

    const input = screen.getByTestId("foto-perfil-input");
    const archivo = new File(["contenido"], "foto.jpg", { type: "image/jpeg" });
    fireEvent.change(input, { target: { files: [archivo] } });

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo actualizar la foto de perfil.");
  });
});
