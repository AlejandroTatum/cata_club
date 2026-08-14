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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
const mockInvalidarOtrasSesiones = vi.fn();

/**
 * The exact shape a failing call reaches a screen as. Every failure route in
 * `services/api.ts` throws `ApiClientError(message, status)`, so an error
 * carrying a message and no status is a shape the client cannot produce.
 */
class MockApiClientError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
  }
}

vi.mock("@/services/api", () => ({
  fetchMiPerfil: () => mockFetchMiPerfil(),
  actualizarMiPerfil: (data: unknown) => mockActualizarMiPerfil(data),
  solicitarRecuperacion: (correo: string) => mockSolicitarRecuperacion(correo),
  fetchStudentPortal: (personaId: string) => mockFetchStudentPortal(personaId),
  subirFotoPerfil: (archivo: File) => mockSubirFotoPerfil(archivo),
  fetchNotificaciones: () => mockFetchNotificaciones(),
  marcarNotificacionLeida: (id: number) => mockMarcarNotificacionLeida(id),
  invalidarOtrasSesiones: () => mockInvalidarOtrasSesiones(),
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
  hydrationOutage: false,
  retryHydration: vi.fn(),
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
// Waits
// ---------------------------------------------------------------------------

/**
 * Waits until the STAFF branch has actually finished loading.
 *
 * Do NOT replace this with `await screen.findAllByText("Ana Admin")`. That name
 * is the SESSION's (`sessionForRole(...)`), and AppShell's sidebar account menu
 * paints it on the very first render — while `staffState` is still
 * `{ status: "loading" }` and nothing from `fetchMiPerfil()` exists yet. So that
 * wait resolves against shell chrome and proves nothing about the fetch: under
 * CI load the assertions that follow ran against the loading state (flaky
 * failures), and every `queryBy*(...).not.toBeInTheDocument()` after it passed
 * VACUOUSLY — a permanent false green.
 *
 * `profile-hero` only exists in the settled ("ready") layout — the loading and
 * error states render `ProfileShell` without it — so awaiting it is a signal
 * only the resolved fetch can produce.
 */
async function waitForStaffProfile(): Promise<HTMLElement> {
  return screen.findByTestId("profile-hero");
}

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

    // Full name appears twice by design (member card + "Datos personales"
    // column) — assert both occurrences exist. Scoped to <main> since the
    // session name ("Ana Admin") also appears once more in the AppShell
    // sidebar footer, which is unrelated shell chrome.
    //
    // Correo appears TWICE by design (issue #204's own requirement, reversed
    // from the first #204 pass): once on the identity panel ("Correo de
    // acceso") and once as the "Correo de cuenta" row in "Datos personales".
    await waitForStaffProfile();
    const main = screen.getByRole("main");
    expect(within(main).getAllByText("Ana Admin").length).toBe(2);
    expect(screen.getAllByText("ana.admin@cataclub.com").length).toBe(2);
    expect(screen.getByText("099111222")).toBeInTheDocument();
    // The role reads as Spanish prose on the identity card, not as the raw
    // backend enum ("ADMINISTRADOR") the old status column printed.
    const hero = screen.getByTestId("profile-hero");
    expect(within(hero).getByText("Administrador")).toBeInTheDocument();
    expect(within(main).queryByText("ADMINISTRADOR")).not.toBeInTheDocument();
    // "Miembro desde" now lives on the member card's own fact, as one string
    // — not a separate label/value pair, and not duplicated by a
    // "Fecha de registro" row saying the same thing.
    expect(screen.getByText(/miembro desde/i)).toBeInTheDocument();
    expect(screen.queryByText(/fecha de registro/i)).not.toBeInTheDocument();
    expect(screen.getAllByText("Miembro desde 10/03/2024").length).toBe(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("shows EVERY assigned role, not just the one the session resolved to", async () => {
    // `mapBackendRoleToUserRole` collapses these four to "admin". If the rail
    // renders only that, the other three exist nowhere in the product.
    mockUseAuth.mockReturnValue(sessionForRole("admin"));
    mockFetchMiPerfil.mockResolvedValueOnce({
      ...PERFIL_ADMIN,
      roles: ["ADMINISTRADOR", "ENTRENADOR", "ALUMNO", "REPRESENTANTE"],
    });

    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );

    await waitForStaffProfile();
    const main = within(screen.getByRole("main"));
    expect(main.getByText("Roles asignados")).toBeInTheDocument();
    // Scoped to the "Roles asignados" row itself — "Administrador" alone
    // also appears in "Datos personales" (Rol) and in "Información de tu
    // rol" (Rol principal), both real per-account facts this same page now
    // states beside the multi-role breakdown.
    const rolesRow = within(main.getByText("Roles asignados").closest("div") as HTMLElement);
    for (const label of ["Administrador", "Entrenador", "Alumno", "Representante"]) {
      expect(rolesRow.getByText(new RegExp(`^${label}`))).toBeInTheDocument();
    }
    // Which one is in use right now is still legible without colour alone.
    expect(rolesRow.getByText(/rol activo en esta sesión/i)).toBeInTheDocument();
  });

  it("keeps the singular label for a single-role account", async () => {
    mockUseAuth.mockReturnValue(sessionForRole("admin"));
    mockFetchMiPerfil.mockResolvedValueOnce(PERFIL_ADMIN);

    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );

    await waitForStaffProfile();
    const main = within(screen.getByRole("main"));
    // A single role reads on the member card ("Administrador" is not
    // ambiguous by itself). No "Roles asignados" breakdown row exists for
    // it — that rail only earns its place when there is more than one role
    // to disambiguate (see the multi-role test above).
    const hero = screen.getByTestId("profile-hero");
    expect(within(hero).getByText("Administrador")).toBeInTheDocument();
    expect(main.queryByText("Roles asignados")).not.toBeInTheDocument();
    expect(main.queryByText(/rol activo en esta sesión/i)).not.toBeInTheDocument();
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
    // Correo appears twice by design — see the dedicated dedupe-reversal test.
    expect(screen.getAllByText("carla.entrenadora@cataclub.com").length).toBe(2);
    expect(within(screen.getByTestId("profile-hero")).getByText("Entrenador")).toBeInTheDocument();
    // Different fechaCreacion than the admin fixture — proves the date is
    // computed from `perfil.fechaCreacion`, not hardcoded.
    expect(screen.getAllByText("Miembro desde 02/11/2025").length).toBe(1);
  });

  it("does not render nombres/apellidos/roles as editable inputs", async () => {
    mockUseAuth.mockReturnValue(sessionForRole("admin"));
    mockFetchMiPerfil.mockResolvedValueOnce(PERFIL_ADMIN);

    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );

    await waitForStaffProfile();
    expect(screen.queryByDisplayValue("Ana")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("Admin")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("ADMINISTRADOR")).not.toBeInTheDocument();
  });
});

describe("ProfilePage — student/representante summary view", () => {
  it("renders the estudiante's own name and membership state on the identity card", async () => {
    mockUseAuth.mockReturnValue(sessionForRole("estudiante"));
    mockFetchStudentPortal.mockResolvedValueOnce({
      self: {
        personaId: "1",
        nombres: "Sofía",
        apellidos: "Alumna",
        fechaNacimiento: "2012-05-10",
        recentSessions: [],
        membership: { id: 1, estado: "ACTIVA", personaId: 1, montoAplicado: "85.00", categoria: "Mensual", modalidad: "MENSUAL" },
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
    // Membership state is ONE badge on the compact identity panel's quick
    // block — issue #204's own "estado" fact, not a separate labelled row.
    const hero = screen.getByTestId("profile-hero");
    expect(screen.getAllByText("Activa").length).toBe(1);
    expect(within(hero).getByText("Activa")).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("shows the honest 'no disponible' note when self has no matching membership row", async () => {
    mockUseAuth.mockReturnValue(sessionForRole("estudiante"));
    mockFetchStudentPortal.mockResolvedValueOnce({
      self: {
        personaId: "1",
        nombres: "Sofía",
        apellidos: "Alumna",
        fechaNacimiento: "2012-05-10",
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
    // No membership row exists to badge on the compact panel, so the honest
    // "no disponible" note lives in "Información de tu rol" instead — a fact
    // is stated exactly once, never both as an absent badge AND text.
    const roleInfo = screen.getByTestId("profile-role-info");
    expect(within(roleInfo).getByText("Membresía")).toBeInTheDocument();
    expect(within(roleInfo).getByText("No disponible — consulte con administración")).toBeInTheDocument();
  });

  it("renders one row per representado for a representante session, always showing the honest 'no disponible' note for their membership (the backend never scopes /membresias/mias to a dependent, only to the caller) (triangulation)", async () => {
    mockUseAuth.mockReturnValue(sessionForRole("representante"));
    mockFetchStudentPortal.mockResolvedValueOnce({
      self: null,
      representados: [
        {
          personaId: "20",
          nombres: "Juan",
          apellidos: "Hijo",
          fechaNacimiento: "2014-02-01",
          recentSessions: [],
          membership: null,
        },
        {
          personaId: "21",
          nombres: "Ana",
          apellidos: "Hija",
          fechaNacimiento: "2016-08-15",
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
    // (there is no personal status to report). The fallback text now appears
    // 3 times: the 2 representado rows, PLUS "Información de tu rol"'s own
    // "Membresía propia" fact (self === null is a definite "not enrolled as
    // a student", not the ambiguous case — see the module docstring).
    expect(screen.getAllByText("No disponible — consulte con administración")).toHaveLength(3);
    const roleInfo = screen.getByTestId("profile-role-info");
    expect(within(roleInfo).getByText("Membresía propia")).toBeInTheDocument();
    expect(screen.queryByText("Vencida")).not.toBeInTheDocument();
    // A `self: null` account has no personal membership to report, so the
    // identity card claims nothing about one — it does not say "no disponible"
    // either, which would wrongly imply an unreported status.
    expect(screen.queryByText(/^Membresía:/)).not.toBeInTheDocument();
  });

  it("shows the real membership status for self alongside representados who correctly get the 'no disponible' fallback (owner-scoping regression test)", async () => {
    mockUseAuth.mockReturnValue(sessionForRole("representante"));
    mockFetchStudentPortal.mockResolvedValueOnce({
      self: {
        personaId: "1",
        nombres: "Rosa",
        apellidos: "Representante",
        fechaNacimiento: "1985-03-01",
          recentSessions: [],
          membership: { id: 9, estado: "ACTIVA", personaId: 1, montoAplicado: "85.00", categoria: "Mensual", modalidad: "MENSUAL" },
        },
        representados: [
          {
            personaId: "20",
            nombres: "Juan",
            apellidos: "Hijo",
            fechaNacimiento: "2014-02-01",
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
    // "Activa" for self is one badge on the identity card; the fallback note
    // appears once, on Juan's row.
    expect(screen.getAllByText("Activa").length).toBe(1);
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

    await waitForStaffProfile();
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

describe("ProfilePage — issue #204 redesign: four role variants share one architecture", () => {
  it("shows the Administrador variant's role on the identity panel, plus 'Cuenta administrativa' with Rol principal/Estado in Información de tu rol", async () => {
    mockUseAuth.mockReturnValue(sessionForRole("admin"));
    mockFetchMiPerfil.mockResolvedValueOnce(PERFIL_ADMIN);

    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );

    const hero = await waitForStaffProfile();
    expect(within(hero).getByText("Administrador")).toBeInTheDocument();
    // "Cuenta activa" is not membership status — it is a logically-guaranteed
    // fact from reaching this page at all (see the module docstring).
    expect(within(hero).getByText("Cuenta activa")).toBeInTheDocument();
    // "Información de tu rol" is now ALWAYS rendered — single-role staff
    // accounts used to get nothing here at all.
    const roleInfo = screen.getByTestId("profile-role-info");
    expect(within(roleInfo).getByText("Cuenta administrativa")).toBeInTheDocument();
    expect(within(roleInfo).getByText(/Los datos de miembros se gestionan/)).toBeInTheDocument();
    expect(within(roleInfo).getByText("Rol principal")).toBeInTheDocument();
    expect(within(roleInfo).getByText("Estado")).toBeInTheDocument();
    expect(within(roleInfo).getByText("Activo")).toBeInTheDocument();
  });

  it("shows the Entrenador variant's role on the identity panel, plus 'Perfil de entrenador' with Rol principal/Estado in Información de tu rol", async () => {
    mockUseAuth.mockReturnValue(sessionForRole("trainer"));
    mockFetchMiPerfil.mockResolvedValueOnce({ ...PERFIL_ADMIN, roles: ["ENTRENADOR"] });

    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );

    const hero = await waitForStaffProfile();
    expect(within(hero).getByText("Entrenador")).toBeInTheDocument();
    expect(within(hero).getByText("Cuenta activa")).toBeInTheDocument();
    const roleInfo = screen.getByTestId("profile-role-info");
    expect(within(roleInfo).getByText("Perfil de entrenador")).toBeInTheDocument();
    expect(within(roleInfo).getByText("Rol principal")).toBeInTheDocument();
    expect(within(roleInfo).getByText("Activo")).toBeInTheDocument();
  });

  it("shows the Estudiante variant's role and real fecha de nacimiento in 'Información de tu rol'", async () => {
    mockUseAuth.mockReturnValue(sessionForRole("estudiante"));
    mockFetchStudentPortal.mockResolvedValueOnce({
      self: {
        personaId: "1",
        nombres: "Sofía",
        apellidos: "Alumna",
        fechaNacimiento: "2012-05-10",
        recentSessions: [],
        membership: null,
        representante: { nombres: "Laura", apellidos: "Vera" },
      },
      representados: [],
      membershipPlans: [],
    });

    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );

    const hero = await screen.findByTestId("profile-hero");
    expect(within(hero).getByText("Estudiante")).toBeInTheDocument();
    expect(within(hero).getByText("Cuenta activa")).toBeInTheDocument();
    const roleInfo = screen.getByTestId("profile-role-info");
    expect(within(roleInfo).getByText("Perfil estudiantil")).toBeInTheDocument();
    // `self.fechaNacimiento` and `self.representante` are real fields on
    // `StudentProfileSummary` that the old layout fetched but never rendered
    // for the account holder — this is the redesign putting them to use, not
    // inventing new data.
    expect(within(roleInfo).getByText("10/05/2012")).toBeInTheDocument();
    expect(within(roleInfo).getByText("Laura Vera")).toBeInTheDocument();
  });

  it("shows the Representante variant's role, 'Cuenta representante', 'Personas representadas' count, and the honest 'Membresía propia' fact when there is no self profile", async () => {
    mockUseAuth.mockReturnValue(sessionForRole("representante"));
    mockFetchStudentPortal.mockResolvedValueOnce({
      self: null,
      representados: [
        { personaId: "20", nombres: "Juan", apellidos: "Hijo", fechaNacimiento: "2014-02-01", recentSessions: [], membership: null },
      ],
      membershipPlans: [],
    });

    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );

    const hero = await screen.findByTestId("profile-hero");
    expect(within(hero).getByText("Representante")).toBeInTheDocument();
    expect(within(hero).getByText("Cuenta activa")).toBeInTheDocument();
    const roleInfo = screen.getByTestId("profile-role-info");
    expect(within(roleInfo).getByText("Cuenta representante")).toBeInTheDocument();
    expect(within(roleInfo).getByText("Personas representadas")).toBeInTheDocument();
    expect(within(roleInfo).getByText("1")).toBeInTheDocument();
    // `self` is null (this account has no alumno role of its own) — a
    // definite fact, honestly stated, not the invented "2 dispositivos"
    // this same pass deliberately did NOT add elsewhere.
    expect(within(roleInfo).getByText("Membresía propia")).toBeInTheDocument();
    expect(
      within(roleInfo).getByText("No disponible — consulte con administración"),
    ).toBeInTheDocument();
  });

  it("lists WHICH roles a multi-role representante holds, not just how many", async () => {
    mockUseAuth.mockReturnValue(sessionForRole("representante"));
    // A representante who is also an alumno — an ordinary account, and the
    // reason the breakdown cannot be gated on the staff branch: `roles` comes
    // from `GET /auth/me`, which the student branch fetches too.
    mockFetchMiPerfil.mockResolvedValue({
      ...PERFIL_ADMIN,
      roles: ["REPRESENTANTE", "ALUMNO"],
    });
    mockFetchStudentPortal.mockResolvedValueOnce({
      self: null,
      representados: [],
      membershipPlans: [],
    });

    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );

    // The panel says "2 roles asignados" instead of naming one of them...
    const hero = await screen.findByTestId("profile-hero");
    expect(within(hero).getByText("2 roles asignados")).toBeInTheDocument();
    // ...so the page owes the reader WHICH two. Gated on the staff branch,
    // that label dangled with nothing anywhere on the page to resolve it.
    // Scoped to the "Roles asignados" row itself — "Representante" alone
    // also appears in this role's own explanatory sentence just above.
    const roleInfo = await screen.findByTestId("profile-role-info");
    expect(within(roleInfo).getByText("Roles asignados")).toBeInTheDocument();
    const rolesRow = within(
      within(roleInfo).getByText("Roles asignados").closest("div") as HTMLElement,
    );
    expect(rolesRow.getByText(/Representante/)).toBeInTheDocument();
    expect(rolesRow.getByText(/Alumno/)).toBeInTheDocument();
  });
});

describe("ProfilePage — issue #204 redesign: representante with no representados", () => {
  it("shows an explicit empty state instead of silently omitting the section", async () => {
    mockUseAuth.mockReturnValue(sessionForRole("representante"));
    mockFetchStudentPortal.mockResolvedValueOnce({
      self: null,
      representados: [],
      membershipPlans: [],
    });

    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );

    const dependants = await screen.findByTestId("profile-dependants");
    expect(
      within(dependants).getByText(/todavía no hay estudiantes representados/i),
    ).toBeInTheDocument();
    // The way to fix that state stays reachable even while it's empty.
    expect(within(dependants).getByRole("link", { name: /agregar/i })).toBeInTheDocument();
  });

  it("still shows the role-specific 'Personas representadas: 0' fact for a representante with none", async () => {
    mockUseAuth.mockReturnValue(sessionForRole("representante"));
    mockFetchStudentPortal.mockResolvedValueOnce({
      self: null,
      representados: [],
      membershipPlans: [],
    });

    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );

    const roleInfo = await screen.findByTestId("profile-role-info");
    expect(within(roleInfo).getByText("Personas representadas")).toBeInTheDocument();
    expect(within(roleInfo).getByText("0")).toBeInTheDocument();
  });
});

describe("ProfilePage — issue #204 redesign: long content wraps, never truncates", () => {
  const LONG_NAME_PERFIL: PerfilPropio = {
    ...PERFIL_ADMIN,
    nombres: "Jefferson Alejandro Maximiliano",
    apellidos: "Delgado Rivadeneira Fernández-Villalobos",
    correo: "jefferson.alejandro.maximiliano.delgado.rivadeneira@administracion.cataclub.com",
  };

  // `window.innerWidth` is a shared global: left at 375 it would follow every
  // test declared after this one in the file, which is how a suite acquires an
  // order-dependent failure that nobody can reproduce in isolation.
  const originalInnerWidth = window.innerWidth;
  afterEach(() => {
    window.innerWidth = originalInnerWidth;
  });

  it("renders the full nombre and correo text with no truncation class", async () => {
    mockUseAuth.mockReturnValue(sessionForRole("admin"));
    mockFetchMiPerfil.mockResolvedValueOnce(LONG_NAME_PERFIL);
    // Narrowest supported viewport. jsdom evaluates no media queries, so this
    // does not itself prove the narrow case — the assertions below prove the
    // stronger, width-independent property: no truncation class exists to
    // clip anything at ANY width.
    window.innerWidth = 375;

    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );

    const hero = await waitForStaffProfile();
    const fullName = `${LONG_NAME_PERFIL.nombres} ${LONG_NAME_PERFIL.apellidos}`;

    const nameHeading = within(hero).getByRole("heading", { level: 2, name: fullName });
    // The heading wraps safely (`break-words`) — it never carries `truncate`
    // or any class that would clip or ellipsize the text.
    expect(nameHeading.className).not.toMatch(/\btruncate\b/);
    expect(nameHeading).toHaveTextContent(fullName);

    const correoNode = within(hero).getByText(LONG_NAME_PERFIL.correo);
    expect(correoNode.className).not.toMatch(/\btruncate\b/);
    expect(correoNode).toHaveTextContent(LONG_NAME_PERFIL.correo);

    // Nowhere in the /profile content does ANY element carry a truncation
    // class — the issue's hard rule covers this screen's own content, not
    // the shared `AppShell` chrome (e.g. the sidebar's own account footer)
    // that sits outside this redesign's scope.
    const main = screen.getByRole("main");
    for (const node of main.querySelectorAll("[class]")) {
      // `getAttribute`, not `.className` — an SVG element's `className` is an
      // `SVGAnimatedString`, not a plain string.
      expect(node.getAttribute("class")).not.toMatch(/\btruncate\b/);
    }
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

    await waitForStaffProfile();
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
    await waitForStaffProfile();

    fireEvent.click(screen.getByRole("button", { name: /editar datos/i }));

    const telefonoInput = screen.getByLabelText(/teléfono/i);
    fireEvent.change(telefonoInput, { target: { value: "099999000" } });

    fireEvent.click(screen.getByRole("button", { name: /^guardar/i }));

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
    await waitForStaffProfile();

    fireEvent.click(screen.getByRole("button", { name: /editar datos/i }));

    expect(screen.queryByLabelText(/correo electrónico/i)).not.toBeInTheDocument();
    // Correo appears twice (identity panel + "Correo de cuenta" row) but is
    // never an editable field in EITHER spot.
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
    await waitForStaffProfile();

    fireEvent.click(screen.getByRole("button", { name: /editar datos/i }));
    const telefonoInput = screen.getByLabelText(/teléfono/i);
    fireEvent.change(telefonoInput, { target: { value: "099999000" } });
    fireEvent.click(screen.getByRole("button", { name: /^guardar/i }));

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
    expect(screen.queryByRole("button", { name: /editar datos/i })).not.toBeInTheDocument();
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
    await waitForStaffProfile();

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
    // The mail leg of /auth/recuperar-contrasenia failed on the server. A 5xx
    // `detail` describes the server's failure, not the address on file, so the
    // alert carries the product's sentence about the server rather than the
    // body of the 500.
    mockSolicitarRecuperacion.mockRejectedValueOnce(
      new MockApiClientError("No se pudo enviar el correo.", 500),
    );

    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );
    await waitForStaffProfile();

    fireEvent.click(screen.getByRole("button", { name: /cambiar contraseña/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "El servidor no pudo completar la operación. Intente nuevamente en unos minutos.",
    );
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

    await waitForStaffProfile();
    expect(screen.getByRole("heading", { level: 1, name: "Perfil" })).toBeInTheDocument();
    // The generic subtitle ("Gestione su información y consulte su estado en
    // el club.") was filler — it restated what being on a profile page
    // already says, and a screen only gets the one line of prose if it earns
    // it. The member card now carries the identity, so the header stays to
    // just the title.
    expect(
      screen.queryByText("Gestione su información y consulte su estado en el club."),
    ).not.toBeInTheDocument();
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

    await waitForStaffProfile();
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

    await waitForStaffProfile();
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

    await waitForStaffProfile();
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

    await waitForStaffProfile();
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
    await waitForStaffProfile();

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
    await waitForStaffProfile();

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
    // That wait only proves the PORTAL fetch resolved. The supplementary
    // fotoUrl fetch fails SILENTLY — it paints nothing — so no DOM signal marks
    // its arrival and the negative assertions below would pass vacuously while
    // it is still pending. Await the rejection itself inside `act`, which also
    // flushes the microtask running the component's own `.catch`.
    await act(async () => {
      await (mockFetchMiPerfil.mock.results[0]?.value as Promise<unknown>).catch(() => {});
    });
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

describe("ProfilePage — the redesigned account layout", () => {
  async function renderAdmin(): Promise<void> {
    mockUseAuth.mockReturnValue(sessionForRole("admin"));
    mockFetchMiPerfil.mockResolvedValueOnce(PERFIL_ADMIN);
    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );
    await waitForStaffProfile();
  }

  it("puts the page action in the page header row, not floating above the content", async () => {
    await renderAdmin();

    const button = screen.getByRole("button", { name: /editar datos/i });
    // It belongs to the SAME header row as the page title — it used to sit on
    // a line of its own between the header and the identity card, which is
    // what pushed the first real content ~40% down the viewport.
    const header = button.closest("header");
    expect(header).not.toBeNull();
    expect(within(header as HTMLElement).getByRole("heading", { name: "Perfil" })).toBeInTheDocument();
    expect(screen.getByTestId("profile-column-info").contains(button)).toBe(false);
  });

  it("does not repeat a back link the shell's own sidebar already provides", async () => {
    await renderAdmin();

    // `docs/archive/prototypes/prototipos/25-perfil.html` draws no back link: the sidebar is
    // the way back, and the extra row only cost vertical space above the fold.
    expect(screen.queryByRole("link", { name: /volver al panel/i })).not.toBeInTheDocument();
  });

  it("reads identity as a compact panel, not a header with facts beside it", async () => {
    await renderAdmin();

    const hero = screen.getByTestId("profile-hero");
    // The identity object: name, correo (once — see the dedicated dedupe
    // test below), role and "member since" all live on the panel, aria-
    // labelled by the account holder's own name (issue #204's contract).
    expect(hero).toHaveAccessibleName(/ana admin/i);
    expect(within(hero).getByRole("heading", { level: 2, name: "Ana Admin" })).toBeInTheDocument();
    expect(within(hero).getByText("Ana Admin")).toBeInTheDocument();
    expect(within(hero).getByText("ana.admin@cataclub.com")).toBeInTheDocument();
    expect(within(hero).getByText("Administrador")).toBeInTheDocument();
    expect(within(hero).getByText("Miembro desde 10/03/2024")).toBeInTheDocument();
    // Contact data still belongs to the rows below, not to the card.
    expect(within(hero).queryByText("099111222")).not.toBeInTheDocument();
  });

  it("keeps the identity text off the red field, which it is not legible on", async () => {
    await renderAdmin();

    const hero = screen.getByTestId("profile-hero");
    const heading = within(hero).getByRole("heading", { level: 2, name: "Ana Admin" });
    const identityRow = heading.parentElement?.parentElement;

    // `text-ink` (#17181C) on `cata-red` (#D92128) is 3.6:1 — under AA — and
    // the grey "Miembro desde" beside it is ~1.1:1. The red field is 100px
    // tall and its polygon's deepest vertex reaches exactly 100px, so the row
    // holding the name, the badges and that line has to start below it. This
    // used to be `pt-8`, which put all three of them on the red.
    expect(identityRow).toHaveClass("pt-[112px]");
    // And aligned to the TOP: the text column is taller than the avatar, so
    // `items-end` pinned the text back up under the field.
    expect(identityRow).toHaveClass("items-start");
    expect(identityRow).not.toHaveClass("items-end");
  });

  it("shows the correo twice by design — the identity panel AND the 'Datos personales' row (issue #204's own requirement)", async () => {
    // The first #204 pass read "if the prototype shows a field the product
    // doesn't compute, drop it" as "when in doubt, cut it" and removed this
    // exact row. The prototype repeats correo in both places on purpose —
    // this test locks that reversal in.
    await renderAdmin();

    expect(screen.getAllByText("ana.admin@cataclub.com")).toHaveLength(2);
    const hero = screen.getByTestId("profile-hero");
    expect(within(hero).getByText(/lo gestiona el club/i)).toBeInTheDocument();
    const info = screen.getByTestId("profile-column-info");
    expect(within(info).getByText("Correo de cuenta")).toBeInTheDocument();
    expect(within(info).getByText("ana.admin@cataclub.com")).toBeInTheDocument();
  });

  it("wraps the teléfono value in a DataBox instead of leaving it as loose text", async () => {
    await renderAdmin();

    const info = screen.getByTestId("profile-column-info");
    const value = within(info).getByText("099111222");
    // DataBox's own signature: sunken fill, line border, 3px corner.
    expect(value.closest("span")).toHaveClass("bg-sunken", "border-line", "rounded-[3px]");
  });

  it("lays personal data out as one datum per row, never as a data grid", async () => {
    await renderAdmin();

    const info = screen.getByTestId("profile-column-info");
    // "Correo de cuenta" and "Rol" are deliberately repeated from the member
    // card here (issue #204's own requirement) — see the dedicated dedupe-
    // reversal test above.
    for (const label of ["Nombres", "Correo de cuenta", "Teléfono", "Rol"]) {
      expect(within(info).getByText(label)).toBeInTheDocument();
    }
    // "Miembro desde" is account metadata, not personal data: it lives on the
    // member card and must NOT also be repeated as a row.
    expect(within(info).queryByText("Miembro desde")).not.toBeInTheDocument();
  });

  it("keeps row labels legible without shouting — no bold uppercase caps competing with the value", async () => {
    await renderAdmin();

    const info = screen.getByTestId("profile-column-info");
    const label = within(info).getByText("Nombres");
    expect(label).not.toHaveClass("uppercase");
    expect(label).not.toHaveClass("font-bold");
    expect(label).toHaveClass("text-ink-3");
    // The value is still what carries the weight.
    const value = within(info).getByText("Ana Admin");
    expect(value.closest("span")).toHaveClass("font-semibold", "text-ink");
  });

  it("lowers the row height instead of the old fixed 56px (min-h-drow) floor", async () => {
    await renderAdmin();

    const info = screen.getByTestId("profile-column-info");
    const row = within(info).getByText("Nombres").closest("div");
    expect(row).not.toHaveClass("min-h-drow");
    // Not just the absence of the old floor — the actual replacement padding
    // that lets the row size to its own content.
    expect(row).toHaveClass("py-2");
  });

  it("falls back to the plain role label when the account has zero assigned roles (edge case: `roles: []`)", async () => {
    // `assignedRoles.length === 0` used to render `<Badge>{roleLabel}</Badge>`
    // explicitly. That branch is gone now — the member card's own `role` prop
    // (plain text, not a Badge) is what a zero-role account falls through to.
    // This proves that's a deliberate, non-regressive choice, not a silent
    // gap: no "Roles asignados" rail, and the role label still reads plainly.
    mockUseAuth.mockReturnValue(sessionForRole("admin"));
    mockFetchMiPerfil.mockResolvedValueOnce({ ...PERFIL_ADMIN, roles: [] });

    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );
    await waitForStaffProfile();

    const hero = screen.getByTestId("profile-hero");
    expect(within(hero).getByText("Administrador")).toBeInTheDocument();
    expect(within(hero).queryByText("Roles asignados")).not.toBeInTheDocument();
  });

  it("falls back to 'Miembro desde —' when fechaCreacion is falsy", async () => {
    // `IdentityPanel.memberSince` is a required string — there is no way to
    // simply omit the fact the way the old `{fechaCreacion && (...)}`
    // conditional did. This proves the fallback text renders instead of an
    // empty/undefined string reaching the panel.
    mockUseAuth.mockReturnValue(sessionForRole("admin"));
    mockFetchMiPerfil.mockResolvedValueOnce({ ...PERFIL_ADMIN, fechaCreacion: "" });

    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );
    await waitForStaffProfile();

    const hero = screen.getByTestId("profile-hero");
    expect(within(hero).getByText("Miembro desde —")).toBeInTheDocument();
  });

  it("never shows a cédula row — no endpoint the account itself can call returns one", async () => {
    await renderAdmin();

    expect(screen.queryByText(/cédula/i)).not.toBeInTheDocument();
  });

  it("offers the security actions as rows, including closing other sessions", async () => {
    await renderAdmin();

    const security = screen.getByTestId("profile-column-status");
    expect(within(security).getByText("Contraseña")).toBeInTheDocument();
    expect(within(security).getByRole("button", { name: /cambiar contraseña/i })).toBeInTheDocument();
    expect(within(security).getByText(/cerrar sesión en este equipo/i)).toBeInTheDocument();
    expect(within(security).getByRole("button", { name: /^salir$/i })).toBeInTheDocument();
    // POST /auth/sesiones/invalidar now exists (slice B4) — the third row.
    // Exact match on the row LABEL: a substring regex also matches the
    // button's own text ("Cerrar otras sesiones"), which is a second,
    // unrelated element.
    expect(within(security).getByText("Otras sesiones")).toBeInTheDocument();
    expect(
      within(security).getByRole("button", { name: /cerrar otras sesiones/i }),
    ).toBeInTheDocument();
  });

  it("puts every Seguridad action in the same column so the three rows line up", async () => {
    /*
     * These three rows are the only `DetailRow`s that pass a SENTENCE as the
     * value AND an action. With the action merely `ml-auto`, the width left for
     * each sentence depended on its own button's width, so the rows wrapped at
     * different points and the buttons landed at different heights — the
     * "misaligned" report. A shared action column makes the three value columns
     * identical, so they wrap identically.
     */
    await renderAdmin();

    const security = screen.getByTestId("profile-column-status");
    const buttons = [
      within(security).getByRole("button", { name: /cambiar contraseña/i }),
      within(security).getByRole("button", { name: /^salir$/i }),
      within(security).getByRole("button", { name: /cerrar otras sesiones/i }),
    ];

    const wrappers = buttons.map((button) => button.parentElement);
    for (const wrapper of wrappers) {
      expect(wrapper).not.toBeNull();
      // Its own line on a phone, a fixed right-hand column from `sm` up.
      expect(wrapper?.className).toMatch(/\bw-full\b/);
      expect(wrapper?.className).toMatch(/\bjustify-end\b/);
      expect(wrapper?.className).toMatch(/\bsm:w-\[210px\](\s|$)/);
    }
    // Identical, not merely similar: one column, not three near-misses.
    expect(new Set(wrappers.map((wrapper) => wrapper?.className)).size).toBe(1);
  });

  it("closes the session from the security row", async () => {
    const auth = sessionForRole("admin");
    mockUseAuth.mockReturnValue(auth);
    mockFetchMiPerfil.mockResolvedValueOnce(PERFIL_ADMIN);
    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );
    await waitForStaffProfile();

    fireEvent.click(screen.getByRole("button", { name: /^salir$/i }));

    expect(auth.logout).toHaveBeenCalled();
  });
});

describe("ProfilePage — close other sessions (E01, slice B4)", () => {
  beforeEach(() => {
    mockInvalidarOtrasSesiones.mockReset();
  });

  async function renderAdmin(): Promise<void> {
    mockUseAuth.mockReturnValue(sessionForRole("admin"));
    mockFetchMiPerfil.mockResolvedValueOnce(PERFIL_ADMIN);
    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );
    await waitForStaffProfile();
  }

  it("does not call the endpoint until the confirmation dialog is accepted", async () => {
    await renderAdmin();

    fireEvent.click(screen.getByRole("button", { name: /cerrar otras sesiones/i }));

    // The confirmation dialog gates the call — clicking the row's own button
    // only OPENS it, it must never call the API directly.
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(mockInvalidarOtrasSesiones).not.toHaveBeenCalled();
  });

  it("cancelling the dialog leaves the session untouched", async () => {
    await renderAdmin();

    fireEvent.click(screen.getByRole("button", { name: /cerrar otras sesiones/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /cancelar/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockInvalidarOtrasSesiones).not.toHaveBeenCalled();
  });

  it("confirming the dialog calls the endpoint and surfaces the success message", async () => {
    mockInvalidarOtrasSesiones.mockResolvedValueOnce({
      mensaje: "Se cerraron sus otras sesiones. Este dispositivo sigue conectado.",
    });
    await renderAdmin();

    fireEvent.click(screen.getByRole("button", { name: /cerrar otras sesiones/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^cerrar otras sesiones$/i }));

    await waitFor(() => {
      expect(mockInvalidarOtrasSesiones).toHaveBeenCalledTimes(1);
    });
    expect(
      await screen.findByText("Se cerraron sus otras sesiones. Este dispositivo sigue conectado."),
    ).toBeInTheDocument();
    // The caller's own screen is untouched — no redirect, no crash, no 401 loop.
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("surfaces an error message when the endpoint call fails", async () => {
    mockInvalidarOtrasSesiones.mockRejectedValueOnce(
      new Error("No se pudieron cerrar las otras sesiones."),
    );
    await renderAdmin();

    fireEvent.click(screen.getByRole("button", { name: /cerrar otras sesiones/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^cerrar otras sesiones$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudieron cerrar las otras sesiones.",
    );
  });
});

describe("ProfilePage — issue #204 redesign: prototype elements the first pass silently dropped", () => {
  async function renderAdmin(): Promise<void> {
    mockUseAuth.mockReturnValue(sessionForRole("admin"));
    mockFetchMiPerfil.mockResolvedValueOnce(PERFIL_ADMIN);
    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );
    await waitForStaffProfile();
  }

  it("shows the 'Sin foto cargada' state and a labelled 'Cambiar foto' button, reading straight off fotoUrl", async () => {
    await renderAdmin();

    const hero = screen.getByTestId("profile-hero");
    expect(within(hero).getByText(/Foto de perfil: Sin foto cargada/)).toBeInTheDocument();
    expect(within(hero).getByRole("button", { name: /cambiar foto/i })).toBeInTheDocument();
  });

  it("shows 'Foto de perfil: Foto cargada' once fotoUrl is set", async () => {
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

    const hero = await waitForStaffProfile();
    expect(within(hero).getByText(/Foto de perfil: Foto cargada/)).toBeInTheDocument();
  });

  it("triggers the same hidden file input from the 'Cambiar foto' rail button", async () => {
    await renderAdmin();

    const hero = screen.getByTestId("profile-hero");
    const input = screen.getByTestId("foto-perfil-input") as HTMLInputElement;
    const clickSpy = vi.spyOn(input, "click");

    fireEvent.click(within(hero).getByRole("button", { name: /cambiar foto/i }));

    expect(clickSpy).toHaveBeenCalled();
  });

  it("offers a 'Cerrar sesión' button inside the identity panel itself, distinct from the Seguridad row's 'Salir'", async () => {
    const auth = sessionForRole("admin");
    mockUseAuth.mockReturnValue(auth);
    mockFetchMiPerfil.mockResolvedValueOnce(PERFIL_ADMIN);
    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );
    await waitForStaffProfile();

    const hero = screen.getByTestId("profile-hero");
    const panelLogout = within(hero).getByRole("button", { name: /cerrar sesión/i });
    fireEvent.click(panelLogout);

    expect(auth.logout).toHaveBeenCalled();
    // Seguridad's own "Sesión" row keeps its separate "Salir" trigger — the
    // panel button is an addition, not a replacement.
    expect(
      within(screen.getByTestId("profile-column-status")).getByRole("button", { name: /^salir$/i }),
    ).toBeInTheDocument();
  });

  it("labels each section with the prototype's own subtitle copy", async () => {
    await renderAdmin();

    expect(within(screen.getByTestId("profile-column-info")).getByText("Información de tu cuenta")).toBeInTheDocument();
    expect(within(screen.getByTestId("profile-role-info")).getByText("Rol asignado a esta cuenta")).toBeInTheDocument();
    expect(within(screen.getByTestId("profile-column-status")).getByText("Acciones de acceso")).toBeInTheDocument();
  });

  it("shows the role-specific 'bajada' under the page title", async () => {
    await renderAdmin();

    expect(screen.getByText("Revisá tus datos y mantené segura tu cuenta.")).toBeInTheDocument();
  });

  it("shows a decorative icon on each of the three Seguridad rows", async () => {
    await renderAdmin();

    const security = screen.getByTestId("profile-column-status");
    // Icons are `aria-hidden`; the descriptive text already carries the
    // meaning for assistive tech — this only checks the icon itself renders.
    expect(security.querySelectorAll("svg[aria-hidden='true']").length).toBeGreaterThanOrEqual(3);
  });
});
