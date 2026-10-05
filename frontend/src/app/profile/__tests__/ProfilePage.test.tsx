/**
 * Component tests for ProfilePage (issue #36) — the unified "Mi cuenta"
 * screen (header + hero card + 3-column grid + banner) whose content swaps
 * by role.
 *
 * Mirrors the mocking pattern established by StudentPage.test.tsx /
 * ProtectedRoute.test.tsx (ProtectedRoute passthrough, next/navigation,
 * AuthContext, @/services/api all stubbed).
 *
 * Some display values (full name, correo, "cuenta creada el" date) intentionally
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
import type { MembershipSummary, PagoPersona, StudentProfileSummary } from "@/services/api";
import { ToastProvider } from "@/contexts/ToastContext";
import { buildUstedRegisterRegex } from "@/lib/__tests__/usted-register-lock";
import { clubToday } from "@/lib/club-date";
import { formatDate } from "@/lib/format-utils";

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
const mockFetchPagosDePersona = vi.fn();
const mockSubirFotoPerfil = vi.fn();
const mockFetchNotificaciones = vi.fn().mockResolvedValue({ items: [], total: 0, skip: 0, limit: 20 });
const mockMarcarNotificacionLeida = vi.fn().mockResolvedValue(undefined);
const mockInvalidarOtrasSesiones = vi.fn();
const mockFetchMisSesiones = vi.fn().mockResolvedValue([]);

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
  fetchPagosDePersona: (personaId: string) => mockFetchPagosDePersona(personaId),
  subirFotoPerfil: (archivo: File) => mockSubirFotoPerfil(archivo),
  fetchNotificaciones: () => mockFetchNotificaciones(),
  marcarNotificacionLeida: (id: number) => mockMarcarNotificacionLeida(id),
  invalidarOtrasSesiones: () => mockInvalidarOtrasSesiones(),
  // La columna de identidad monta `SessionsCard`, que llama a esto al montar.
  // Su propio comportamiento se prueba en SessionsCard.test.tsx; acá alcanza
  // con que exista y no devuelva nada, para que la tarjeta no se dibuje y no
  // interfiera con las aserciones de esta pantalla.
  fetchMisSesiones: (opciones?: unknown) => mockFetchMisSesiones(opciones),
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
  sessionExpired: false,
  periodicOutage: false,
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

/**
 * The same payload shape `/auth/me` returns for a student account. It is the
 * only place teléfono, fecha de creación and foto come from on that branch
 * (see `ProfileContent`), which is why the student teléfono edit seeds from it.
 */
const PERFIL_ESTUDIANTE: PerfilPropio = {
  correo: "sofia.alumna@cataclub.com",
  personaId: 1,
  nombres: "Sofía",
  apellidos: "Alumna",
  roles: ["ALUMNO"],
  telefono: "099111222",
  fechaCreacion: "2025-05-01T10:00:00",
};

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
  ADMIN_SESSION.refreshSession.mockReset();
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
  // Same treatment for the student branch's payments call: no approved payment
  // by default, so an absent coverage end is the shipped case unless a test
  // seeds one. Both are supplementary — see ProfileContent.
  mockFetchPagosDePersona.mockReset();
  mockFetchPagosDePersona.mockResolvedValue([]);
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
    mockFetchStudentPortal.mockRejectedValueOnce(new Error("No se pudo cargar tu cuenta."));

    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo cargar tu cuenta.");
    expect(screen.getByRole("button", { name: /reintentar/i })).toBeInTheDocument();
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
      within(dependants).getByText(/todavía no hay jugadores representados/i),
    ).toBeInTheDocument();
    // The way to fix that state stays reachable even while it's empty.
    expect(within(dependants).getByRole("link", { name: /agregar/i })).toBeInTheDocument();
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
    mockFetchMiPerfil.mockRejectedValueOnce(new Error("No se pudo cargar tu perfil."));

    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo cargar tu perfil.");
    const retryButton = screen.getByRole("button", { name: /reintentar/i });

    mockFetchMiPerfil.mockResolvedValueOnce(PERFIL_ADMIN);
    fireEvent.click(retryButton);

    await waitForStaffProfile();
    expect(within(screen.getByRole("main")).getAllByText("Ana Admin")).toHaveLength(1);
    expect(mockFetchMiPerfil).toHaveBeenCalledTimes(2);
  });
});

describe("ProfilePage — inline teléfono edit (correo is read-only)", () => {
  it("saves a new teléfono and displays the updated value", async () => {
    mockUseAuth.mockReturnValue(sessionForRole("admin"));
    mockFetchMiPerfil.mockResolvedValueOnce(PERFIL_ADMIN);
    mockActualizarMiPerfil.mockResolvedValueOnce({
      ...PERFIL_ADMIN,
      telefono: "0991234567",
    });

    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );
    await waitForStaffProfile();

    fireEvent.click(screen.getByRole("button", { name: /editar datos/i }));

    const telefonoInput = screen.getByLabelText(/teléfono/i);
    fireEvent.change(telefonoInput, { target: { value: "0991234567" } });

    fireEvent.click(screen.getByRole("button", { name: /^guardar/i }));

    await waitFor(() => {
      expect(mockActualizarMiPerfil).toHaveBeenCalledWith({ telefono: "0991234567" });
    });
    expect(await screen.findByText("0991234567")).toBeInTheDocument();
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
    expect(screen.getAllByText("ana.admin@cataclub.com").length).toBe(1);
  });

  it("shows ONE phone message under the field, without a request, and lets an empty phone through (FAM-05)", async () => {
    mockUseAuth.mockReturnValue(sessionForRole("admin"));
    mockFetchMiPerfil.mockResolvedValueOnce(PERFIL_ADMIN);
    mockActualizarMiPerfil.mockResolvedValueOnce({ ...PERFIL_ADMIN, telefono: null });

    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );
    await waitForStaffProfile();

    fireEvent.click(screen.getByRole("button", { name: /editar datos/i }));
    const telefonoInput = screen.getByLabelText(/teléfono/i);
    fireEvent.change(telefonoInput, { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: /^guardar/i }));

    expect(await screen.findByText(/Escribe tu celular de 9 dígitos/)).toBeInTheDocument();
    expect(screen.queryByText(/obligatorio/)).not.toBeInTheDocument();
    expect(mockActualizarMiPerfil).not.toHaveBeenCalled();

    fireEvent.change(telefonoInput, { target: { value: "" } });
    expect(screen.queryByText(/Escribe tu celular de 9 dígitos/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^guardar/i }));
    await waitFor(() => expect(mockActualizarMiPerfil).toHaveBeenCalledWith({ telefono: "" }));
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
    fireEvent.change(telefonoInput, { target: { value: "0991234567" } });
    fireEvent.click(screen.getByRole("button", { name: /^guardar/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo guardar los cambios.");
    expect(screen.getByText("099111222")).toBeInTheDocument();
    expect(screen.queryByText("0991234567")).not.toBeInTheDocument();
  });

  /**
   * The same self-service endpoint staff use, on the student branch.
   *
   * `PATCH /auth/me` resolves the person from the JWT `sub` and checks no role
   * at all (`auth_router.actualizar_perfil_propio` → `AuthServicio.
   * actualizar_perfil_propio`, whose only gate is `usuario.activo`), so an
   * estudiante can edit their own teléfono. `startEditing` refused to run for
   * anything but `kind === "staff"`, so the screen showed a teléfono the
   * account holder could not correct from the one screen that owns it.
   */
  it("lets an jugador edit their own teléfono through the same self-service PATCH as staff", async () => {
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
    });
    mockFetchMiPerfil.mockResolvedValueOnce(PERFIL_ESTUDIANTE);
    mockActualizarMiPerfil.mockResolvedValueOnce({
      ...PERFIL_ESTUDIANTE,
      telefono: "0991234567",
    });

    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );
    await screen.findAllByText("Sofía Alumna");

    fireEvent.click(screen.getByRole("button", { name: /editar datos/i }));

    // Seeded from `/auth/me`'s teléfono — an edit that opened on an empty
    // field would make the reader re-type a number the page is holding.
    // Issue #1296: the field shows the local digits without the trunk 0.
    const telefonoInput = screen.getByLabelText<HTMLInputElement>(/teléfono/i);
    expect(telefonoInput.value).toBe("99111222");

    fireEvent.change(telefonoInput, { target: { value: "0991234567" } });
    fireEvent.click(screen.getByRole("button", { name: /^guardar/i }));

    await waitFor(() => {
      expect(mockActualizarMiPerfil).toHaveBeenCalledWith({ telefono: "0991234567" });
    });
    expect(await screen.findByText("0991234567")).toBeInTheDocument();
  });

  /**
   * Triangulation: the student branch's teléfono lives in the SUPPLEMENTARY
   * `/auth/me` call, which is allowed to fail without taking the page down
   * (the row then shows "—"). With no profile there is no number to seed and
   * no place for the response to land, so the trigger is not offered at all —
   * a button that opens a blank field and PATCHes it is worse than its absence.
   */
  it("offers no edit trigger on the student branch while that profile never arrived", async () => {
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
    });
    mockFetchMiPerfil.mockRejectedValueOnce(new Error("No se pudo cargar tu perfil."));

    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );
    await screen.findAllByText("Sofía Alumna");

    expect(screen.queryByRole("button", { name: /editar datos/i })).not.toBeInTheDocument();
  });
});

/**
 * Issue #667's phone-field parity gap: `/profile`'s staff teléfono field had
 * `type="tel" inputMode="tel"` but no mask. Issue #1296 replaces that fix (a
 * shared `numericMode="phone"` mask, kept the WIDER local-with-0 shape) with
 * the same `PhoneField` every other phone field on the app now shares:
 * cleaning runs on every `onChange` — not only a pasted chunk, and not a
 * separate keydown-level block.
 */
describe("ProfilePage — teléfono shared PhoneField (#667, #1296)", () => {
  it("cleans letters and typing separators to digits on every change, not only a pasted chunk", async () => {
    mockUseAuth.mockReturnValue(sessionForRole("admin"));
    mockFetchMiPerfil.mockResolvedValueOnce(PERFIL_ADMIN);

    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );
    await waitForStaffProfile();
    fireEvent.click(screen.getByRole("button", { name: /editar datos/i }));

    const input = screen.getByLabelText<HTMLInputElement>(/teléfono/i);
    fireEvent.change(input, { target: { value: "099abc-123-4567" } });

    expect(input.value).toBe("991234567");
  });

  it("caps at nine digits, silently, instead of the old ten-digit warning", async () => {
    mockUseAuth.mockReturnValue(sessionForRole("admin"));
    mockFetchMiPerfil.mockResolvedValueOnce(PERFIL_ADMIN);

    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );
    await waitForStaffProfile();
    fireEvent.click(screen.getByRole("button", { name: /editar datos/i }));

    const input = screen.getByLabelText<HTMLInputElement>(/teléfono/i);
    fireEvent.change(input, { target: { value: "1234567890" } });

    expect(input.value).toBe("123456789");
    expect(screen.queryByText(/alcanzó el máximo/i)).not.toBeInTheDocument();
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

    fireEvent.click(screen.getByRole("button", { name: /restablecer contraseña/i }));

    await waitFor(() => {
      expect(mockSolicitarRecuperacion).toHaveBeenCalledWith("ana.admin@cataclub.com");
    });
    expect(
      await screen.findByText(
        "Te enviamos un enlace a ana.admin@cataclub.com para cambiar tu contraseña. Es válido por 30 minutos.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Si el correo está registrado, recibirá un enlace de recuperación."),
    ).not.toBeInTheDocument();
  });

  it("offers «Reenviar enlace» only after the 2-minute cooldown (GAP-06)", async () => {
    mockUseAuth.mockReturnValue(sessionForRole("admin"));
    mockFetchMiPerfil.mockResolvedValueOnce(PERFIL_ADMIN);
    mockSolicitarRecuperacion.mockResolvedValue({ mensaje: "ok" });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(
        <ToastProvider>
          <ProfilePage />
        </ToastProvider>,
      );
      await waitForStaffProfile();

      fireEvent.click(screen.getByRole("button", { name: /restablecer contraseña/i }));
      const resend = await screen.findByRole("button", { name: "Reenviar enlace" });
      expect(resend).toBeDisabled();
      expect(screen.getByText(/podrás reenviarlo en 2:00/i)).toBeInTheDocument();

      // One act() per second: each tick schedules the next one after React commits.
      const elapse = async (seconds: number) => {
        for (let i = 0; i < seconds; i += 1) {
          await act(async () => {
            await vi.advanceTimersByTimeAsync(1_000);
          });
        }
      };
      await elapse(119);
      expect(resend).toBeDisabled();
      await elapse(1);
      expect(resend).toBeEnabled();

      fireEvent.click(resend);
      await waitFor(() => expect(mockSolicitarRecuperacion).toHaveBeenCalledTimes(2));
      expect(await screen.findByRole("button", { name: "Reenviar enlace" })).toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
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

    fireEvent.click(screen.getByRole("button", { name: /restablecer contraseña/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      /Tuvimos un problema de nuestro lado y no pudimos completar esto\. Escr[ií]benos por WhatsApp y te ayudamos: WhatsApp/,
    );
    expect(within(alert).getByRole("link", { name: "WhatsApp" })).toHaveAttribute(
      "href",
      "https://wa.me/593994219619",
    );
  });
});

describe("ProfilePage — unified layout structure", () => {
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

  // --- Issue #662 ------------------------------------------------------------
  // `POST /auth/me/foto` is always self-service (the caller's OWN photo).
  // AppShell's sidebar avatar reads `session.user.fotoUrl` from AuthContext —
  // a state slice completely separate from the local `perfil` this page owns
  // — so it stayed on the previous photo after a successful upload unless the
  // session gets explicitly refreshed. This never reruns on upload FAILURE:
  // the previous photo is still the correct one to show.
  it("refreshes the session after a successful upload so AppShell's avatar picks up the new photo", async () => {
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
      expect(ADMIN_SESSION.refreshSession).toHaveBeenCalledTimes(1);
    });
  });

  it("does NOT refresh the session when the upload fails", async () => {
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

    await screen.findByRole("alert");
    expect(ADMIN_SESSION.refreshSession).not.toHaveBeenCalled();
  });

});

describe("ProfilePage — profile photo upload (student/representante branch, own hero avatar)", () => {
  it("offers the photo-upload trigger for an jugador session too", async () => {
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

  // Issue #662 — see the equivalent test in the staff branch describe block
  // above for the full rationale.
  it("refreshes the session after a successful upload for a representante session", async () => {
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
      expect(ADMIN_SESSION.refreshSession).toHaveBeenCalledTimes(1);
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

  it("does not repeat a back link the shell's own sidebar already provides", async () => {
    await renderAdmin();

    // `docs/archive/prototypes/prototipos/25-perfil.html` draws no back link: the sidebar is
    // the way back, and the extra row only cost vertical space above the fold.
    expect(screen.queryByRole("link", { name: /volver al panel/i })).not.toBeInTheDocument();
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

  /**
   * The inverse of what this test used to assert, and the reason is a rule
   * rather than a taste: *"La celda de identidad ... nunca nombra una
   * ausencia"* (`DESIGN.md`, Identity cell). "Cuenta creada el —" is an absence
   * given a line of its own, a label, and a dash to stare at.
   *
   * The old assertion was defending against something real — an `undefined`
   * leaking into the panel as literal text — so that half stays: what must
   * never appear is a line that says nothing. It just gets there by drawing
   * no line at all instead of by drawing a dash.
   */
  it("says nothing at all when fechaCreacion is falsy, rather than naming the absence", async () => {
    mockUseAuth.mockReturnValue(sessionForRole("admin"));
    mockFetchMiPerfil.mockResolvedValueOnce({ ...PERFIL_ADMIN, fechaCreacion: "" });

    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );
    await waitForStaffProfile();

    const hero = screen.getByTestId("profile-hero");
    expect(within(hero).queryByText(/Cuenta creada el/)).not.toBeInTheDocument();
    expect(hero.textContent).not.toContain("undefined");
  });

  it("never shows a cédula row — no endpoint the account itself can call returns one", async () => {
    await renderAdmin();

    expect(screen.queryByText(/cédula/i)).not.toBeInTheDocument();
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
      mensaje: "Se cerraron tus otras sesiones. Este dispositivo sigue conectado.",
    });
    await renderAdmin();

    fireEvent.click(screen.getByRole("button", { name: /cerrar otras sesiones/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^cerrar otras sesiones$/i }));

    await waitFor(() => {
      expect(mockInvalidarOtrasSesiones).toHaveBeenCalledTimes(1);
    });
    expect(
      await screen.findByText("Se cerraron tus otras sesiones. Este dispositivo sigue conectado."),
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

  /**
   * The button survives; the sentence about it does not.
   *
   * "Foto de perfil: Sin foto cargada" was the prototype's own string, and it
   * is still the identity cell naming an absence — the one thing `DESIGN.md`
   * says that cell never does. It also said it twice over: the avatar right
   * beside it was already showing initials instead of a photograph, which is
   * what "no photo" LOOKS like. The trigger below it is the only part that
   * ever gave the reader something to do, and "Cambiar foto" reads the same
   * whether or not one is loaded.
   */
  it("offers the labelled 'Cambiar foto' trigger without a line naming the missing photo", async () => {
    await renderAdmin();

    const hero = screen.getByTestId("profile-hero");
    expect(within(hero).getByRole("button", { name: /cambiar foto/i })).toBeInTheDocument();
    expect(within(hero).queryByText(/Sin foto cargada/)).not.toBeInTheDocument();
    expect(within(hero).queryByText(/Foto de perfil:/)).not.toBeInTheDocument();
  });

  it("shows the photograph itself once fotoUrl is set, still with no state sentence", async () => {
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
    // The photo IS the state. `fotoUrl` is still read, and still only read.
    expect(within(hero).getByAltText("Foto de perfil")).toHaveAttribute(
      "src",
      "https://res.cloudinary.com/test/image/upload/perfil-ana.jpg",
    );
    expect(within(hero).queryByText(/Foto cargada/)).not.toBeInTheDocument();
  });

  it("triggers the same hidden file input from the 'Cambiar foto' rail button", async () => {
    await renderAdmin();

    const hero = screen.getByTestId("profile-hero");
    const input = screen.getByTestId("foto-perfil-input") as HTMLInputElement;
    const clickSpy = vi.spyOn(input, "click");

    fireEvent.click(within(hero).getByRole("button", { name: /cambiar foto/i }));

    expect(clickSpy).toHaveBeenCalled();
  });

});

/**
 * The faro pass (`docs/ux/comparaciones/perfil-login.html`).
 *
 * The owner's word for this screen was "perfil genérico", and the diagnosis
 * behind these tests is that the club was missing from it — not for want of
 * data, but because the page fetched the data and threw it away.
 * `fetchStudentPortal()` has been called here since #36 and its payload
 * carries `membership.categoria`, `.modalidad`, `.fechaActivacion`,
 * `.fechaFin` and `recentSessions`; the screen read `estado` and
 * `fechaNacimiento` and dropped the rest.
 *
 * Every assertion below therefore reads a field that ALREADY arrives — with
 * ONE exception, and it is the one date the payload cannot carry:
 * `MembershipSummary.fechaFin` is declared on the client type but no adapter
 * populates it (see `buildMembershipView`), so the membership card's
 * "Vigente hasta" reads the persona's APPROVED payments through
 * `resolveCoverageEnd` — the same reading `/student/payments` prints, from the
 * same endpoint, and not a second interpretation of the field.
 */
describe("ProfilePage — the club on the screen (faro: perfil y login)", () => {
  // Typed against the real payload shape, so the fixture cannot drift from
  // what `/api/student` actually returns — including `representanteId`, which
  // the older inline fixtures in this file omit.
  // The exact membership row `/api/student` returns for a seeded player: an
  // activation date, no `fechaFin`, and a plan whose name already contains its
  // modalidad. Copied from the QA response, not invented.
  const STUDENT_MEMBERSHIP: MembershipSummary = {
    id: 4,
    estado: "ACTIVA",
    personaId: 8,
    montoAplicado: "25.00",
    categoria: "Mensual Infantil",
    modalidad: "MENSUAL",
    fechaActivacion: "2026-08-13T23:25:09.290557Z",
    fechaFin: null,
  };

  const STUDENT_SELF: StudentProfileSummary = {
    personaId: "1",
    nombres: "Ana",
    apellidos: "Garcia",
    fechaNacimiento: "2010-08-13",
    recentSessions: [],
    membership: STUDENT_MEMBERSHIP,
    representante: null,
    representanteId: null,
  };

  async function renderStudent(
    overrides: Partial<StudentProfileSummary> = {},
    pagos: PagoPersona[] = [],
  ): Promise<HTMLElement> {
    mockUseAuth.mockReturnValue(sessionForRole("estudiante"));
    mockFetchStudentPortal.mockResolvedValueOnce({
      self: { ...STUDENT_SELF, ...overrides },
      representados: [],
      membershipPlans: [],
    });
    mockFetchPagosDePersona.mockResolvedValue(pagos);
    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );
    return screen.findByTestId("profile-hero");
  }

  /** An APPROVED payment covering one period — the only rows that define coverage. */
  function makePago(overrides: Partial<PagoPersona> = {}): PagoPersona {
    return {
      id: 1,
      monto: "25.00",
      motivoRechazo: null,
      estadoPago: "APROBADO",
      tipoPago: "TRANSFERENCIA",
      fechaRegistro: "2026-08-01T10:00:00",
      fechaValidacion: "2026-08-02T10:00:00",
      fechaInicio: "2026-08-01",
      fechaFin: "2026-08-31",
      personaId: 1,
      membresiaId: 4,
      voucherUrl: null,
      voucherFormato: null,
      descuentoValorAplicado: null,
      descuentoPorcentajeAplicado: null,
      ...overrides,
    };
  }

  /**
   * A `YYYY-MM-DD` calendar date `days` away from today, negative for the past.
   *
   * The badge's coverage reading is relative to the real clock
   * (`readCoverageStanding` compares against `new Date()`), so a test that
   * wants a lapsed or a live date cannot hardcode one — it would flip with the
   * calendar. This keeps the fixtures relative and the assertions absolute.
   */
  function isoDaysFromToday(days: number): string {
    // Anchor to the club's calendar day, the same "today" the page reads:
    // the runner's local date differs from Guayaquil's for five hours a day.
    const date = clubToday();
    date.setDate(date.getDate() + days);
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
  }

  it("states the plan and the joining date the portal payload already carried", async () => {
    await renderStudent();

    const membership = await screen.findByTestId("profile-membership");
    expect(within(membership).getByText("Plan")).toBeInTheDocument();
    expect(within(membership).getByText("Mensual Infantil")).toBeInTheDocument();
    expect(within(membership).getByText("Jugador desde")).toBeInTheDocument();
    expect(within(membership).getByText("13/08/2026")).toBeInTheDocument();
  });

  it("keeps the plan label and value apart even when flex collapses the whitespace", async () => {
    await renderStudent();

    const membership = await screen.findByTestId("profile-membership");
    const label = within(membership).getByText("Plan");
    // The label+value pair is an inline-flex with a gap, not a bare text space.
    expect(label).toHaveClass("inline-flex", "gap-1");
    expect(label).toContainElement(within(membership).getByText("Mensual Infantil"));
  });

  it("asks for nothing new about the membership — plan, modalidad and joining date are all in the payload", async () => {
    // D14: this pass changes how the screen looks, not what it does. If the
    // club facts had needed a second request, they would not have been in
    // scope at all. Coverage is the ONE fact the payload cannot carry (see
    // this describe's header), so it is the only extra call.
    await renderStudent();
    await screen.findByTestId("profile-membership");

    expect(mockFetchStudentPortal).toHaveBeenCalledTimes(1);
    expect(mockFetchStudentPortal).toHaveBeenCalledWith("1");
    expect(mockFetchPagosDePersona).toHaveBeenCalledTimes(1);
    expect(mockFetchPagosDePersona).toHaveBeenCalledWith("1");
  });

  it("ignores the membership's own fechaFin, which no adapter populates", async () => {
    // Every membership row in the QA dataset comes back without `fechaFin`,
    // and `buildMembershipView` has no line that could ever fill it. A
    // membership carrying one anyway must still not be believed: that field
    // is the shape a reader would trust hardest and the one this product
    // cannot produce. Nothing approved means no coverage row at all — an
    // absent end date is not "Vigente hasta —".
    await renderStudent({ membership: { ...STUDENT_MEMBERSHIP, fechaFin: "2099-12-31" } });

    const membership = await screen.findByTestId("profile-membership");
    expect(within(membership).queryByText(/Vigente hasta/)).not.toBeInTheDocument();
    expect(within(membership).queryByText("31/12/2099")).not.toBeInTheDocument();
    expect(membership.textContent).not.toContain("—");
  });

  it("leaves the coverage row out, without erroring the page, when the payments call fails (triangulation)", async () => {
    // Supplementary, exactly like the `/auth/me` call beside it: the card is
    // one fact on a screen that answers a different question, so a failed
    // lookup drops a row instead of replacing the account with an error.
    mockFetchPagosDePersona.mockRejectedValueOnce(new Error("No se pudo cargar los pagos."));

    await renderStudent();

    const membership = await screen.findByTestId("profile-membership");
    expect(within(membership).getByText("Mensual Infantil")).toBeInTheDocument();
    expect(within(membership).queryByText(/Vigente hasta/)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows an empty meter and how long ago coverage lapsed", async () => {
    await renderStudent({}, [makePago({ fechaFin: isoDaysFromToday(-3) })]);

    const membership = await screen.findByTestId("profile-membership");
    expect(within(membership).getByText("Venció hace 3 días")).toBeInTheDocument();
    expect(within(membership).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });

  /**
   * `categoria` is the plan's name and `modalidad` is how it is charged, and
   * for every plan the club actually sells the first already contains the
   * second: "Mensual Infantil"/"MENSUAL", "Mensual Adultos"/"MENSUAL". Printing
   * both is the same word twice under two labels — the defect this screen is
   * being fixed for, on a smaller scale.
   *
   * It is dropped conditionally rather than deleted because the field can say
   * something the plan name does not: `MembershipPlanSummary.modalidad` also
   * admits "PERSONALIZADA", and a plan named "Escuela de verano" charged that
   * way is a fact worth a row.
   */
  it("drops the modalidad when the plan name already says it", async () => {
    await renderStudent();

    const membership = await screen.findByTestId("profile-membership");
    expect(within(membership).queryByText("Modalidad")).not.toBeInTheDocument();
  });

  it("keeps the modalidad when it adds something the plan name does not", async () => {
    await renderStudent({
      membership: {
        ...STUDENT_MEMBERSHIP,
        categoria: "Escuela de verano",
        modalidad: "PERSONALIZADA",
      },
    });

    const membership = await screen.findByTestId("profile-membership");
    expect(within(membership).getByText("Modalidad")).toBeInTheDocument();
    expect(within(membership).getByText("Personalizada")).toBeInTheDocument();
  });

  it("draws no membership card at all when the account has no membership", async () => {
    // A representante with no alumno role of their own. The honest "No
    // disponible" note in "Información de su rol" already states this once;
    // an empty card would state it a second time, as a shape.
    await renderStudent({ membership: null });

    expect(screen.queryByTestId("profile-membership")).not.toBeInTheDocument();
  });

  it("never prints the amount — money has its own screen and a bare figure decides nothing", async () => {
    // `montoAplicado` ("25.00") is in the payload and is deliberately left
    // out: on its own it does not say whether it is owed, paid or overdue,
    // and "Mis pagos" answers exactly that. See the comparison's "Lo que
    // falta".
    await renderStudent();
    const membership = await screen.findByTestId("profile-membership");

    expect(membership.textContent).not.toContain("25");
    expect(membership.textContent).not.toContain("$");
  });
});

describe("ProfilePage — the type and colour rules the screen was breaking", () => {
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

  /**
   * The rule of the single red: *"nunca hay dos botones rojos en una
   * pantalla"*. Staff editing their teléfono had two — "Guardar" in the header
   * and "Cambiar foto" on the identity panel — which is the moment the red
   * stops meaning "this is the action" and starts meaning "this is a button".
   *
   * "Guardar" is the one that keeps it: it commits the edit the whole screen
   * is in, and the header is where `DESIGN.md` puts the primary action.
   */
  it("leaves exactly one red button on the screen while staff are editing", async () => {
    await renderAdmin();

    fireEvent.click(screen.getByRole("button", { name: /editar datos/i }));

    // The whole document minus the shell's own chrome. The header action sits
    // in `PageHeader`, which is a sibling of `<main>` rather than inside it, so
    // scoping to `main` would measure a budget the primary action is not in.
    // The one exclusion is the skip link: a red `<a>` parked at `top:-100px`
    // until it takes focus, which nobody sees while deciding what to press.
    const red = [...document.querySelectorAll("button, a")].filter(
      (el) =>
        el.className.toString().includes("bg-cata-red") &&
        !el.className.toString().includes("top-[-100px]"),
    );
    expect(red).toHaveLength(1);
    expect(red[0]).toHaveTextContent(/guardar/i);
  });

  it("keeps 'Cambiar foto' as a secondary action on its own card", async () => {
    await renderAdmin();

    const photo = within(screen.getByTestId("profile-hero")).getByRole("button", {
      name: /cambiar foto/i,
    });
    expect(photo.className).not.toContain("bg-cata-red");
  });
});

// ---------------------------------------------------------------------------
// Profile v2 — identity card, the block of the role, Seguridad
// ---------------------------------------------------------------------------

describe("ProfilePage — v2: identity card", () => {
  async function renderAdmin(perfil: PerfilPropio = PERFIL_ADMIN): Promise<HTMLElement> {
    mockUseAuth.mockReturnValue(sessionForRole("admin"));
    mockFetchMiPerfil.mockResolvedValueOnce(perfil);
    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );
    return waitForStaffProfile();
  }

  it("names the account once, with the role as the card's first word and the ball as its full stop", async () => {
    const hero = await renderAdmin();

    expect(hero).toHaveAccessibleName(/ana admin/i);
    expect(within(hero).getByRole("heading", { level: 2, name: "Ana Admin" })).toBeInTheDocument();
    expect(within(screen.getByRole("main")).getAllByText("Ana Admin")).toHaveLength(1);
    const role = within(hero).getByTestId("profile-shoulder");
    expect(role).toHaveTextContent("Administrador");
    // The yellow ball is decorative and sits inside the role's own line.
    const ball = role.querySelector("span.bg-ball");
    expect(ball).not.toBeNull();
    expect(ball).toHaveAttribute("aria-hidden", "true");
  });

  it("draws the asymmetric red field and the coal avatar that bridges into the white body", async () => {
    const hero = await renderAdmin();

    const field = hero.querySelector<HTMLElement>("span.bg-cata-red");
    expect(field).not.toBeNull();
    expect(field?.style.clipPath).toContain("polygon");
    expect(hero.className).toContain("bg-paper");
    expect(hero.querySelector("div.bg-coal")).toHaveTextContent("AA");
  });

  it("states the correo on a full row of its own, and says the club manages it", async () => {
    const hero = await renderAdmin();

    const correo = within(hero).getByTestId("profile-correo");
    expect(correo).toHaveTextContent("ana.admin@cataclub.com");
    expect(correo.parentElement?.className).toContain("sm:col-span-2");
    expect(within(hero).getByText(/lo gestiona el club/i)).toBeInTheDocument();
    expect(screen.getAllByText("ana.admin@cataclub.com")).toHaveLength(1);
    expect(screen.queryByLabelText(/correo electrónico/i)).not.toBeInTheDocument();
  });

  it("keeps teléfono, the edit trigger, the photo trigger and the creation date inside the card", async () => {
    const hero = await renderAdmin();

    expect(within(hero).getByText("099111222")).toBeInTheDocument();
    expect(within(hero).getByRole("button", { name: /editar datos/i })).toBeInTheDocument();
    expect(within(hero).getByRole("button", { name: /cambiar foto/i })).toBeInTheDocument();
    expect(within(hero).getByText("Cuenta creada")).toBeInTheDocument();
    expect(within(hero).getByText("10/03/2024")).toBeInTheDocument();
  });

  it("says nothing about the creation date when the account carries none", async () => {
    const hero = await renderAdmin({ ...PERFIL_ADMIN, fechaCreacion: "" });

    expect(within(hero).queryByText(/Cuenta creada/)).not.toBeInTheDocument();
    expect(hero.textContent).not.toContain("undefined");
  });

  it("wraps a long name and correo instead of truncating them", async () => {
    const hero = await renderAdmin({
      ...PERFIL_ADMIN,
      nombres: "Jefferson Alejandro Maximiliano",
      apellidos: "Delgado Rivadeneira Fernández-Villalobos",
      correo: "jefferson.alejandro.maximiliano.delgado.rivadeneira@administracion.cataclub.com",
    });

    expect(within(hero).getByRole("heading", { level: 2 }).className).toContain("break-words");
    expect(within(hero).getByTestId("profile-correo").className).toContain("[overflow-wrap:anywhere]");
  });

  it("marks the account active for staff, and lists every role only when there is more than one", async () => {
    const hero = await renderAdmin();
    expect(within(hero).getByText("Cuenta activa")).toBeInTheDocument();
    expect(within(hero).queryByText(/rol activo en esta sesión/i)).not.toBeInTheDocument();
  });

  it("lists every assigned role as a chip and marks the one in use, without relying on colour", async () => {
    const hero = await renderAdmin({
      ...PERFIL_ADMIN,
      roles: ["ADMINISTRADOR", "ENTRENADOR", "ALUMNO", "REPRESENTANTE"],
    });

    for (const label of ["Administrador", "Entrenador", "Jugador", "Representante"]) {
      expect(within(hero).getAllByText(new RegExp(label)).length).toBeGreaterThan(0);
    }
    expect(within(hero).getByText(/rol activo en esta sesión/i)).toBeInTheDocument();
  });

  it("removes what the prototype cut: shortcuts, the long guides, the rail and the profile's own logout", async () => {
    await renderAdmin();

    const main = within(screen.getByRole("main"));
    expect(screen.queryByTestId("profile-shortcuts")).not.toBeInTheDocument();
    expect(main.queryByText(/atajos de tu rol/i)).not.toBeInTheDocument();
    expect(main.queryByText(/cómo proteger tu cuenta/i)).not.toBeInTheDocument();
    expect(main.queryByText(/qué hacer si necesita ayuda/i)).not.toBeInTheDocument();
    expect(main.queryByText(/datos personales/i)).not.toBeInTheDocument();
    expect(main.queryByRole("button", { name: /cerrar sesión/i })).not.toBeInTheDocument();
    expect(main.queryByText(/no disponible — consulta con administración/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /ver portal completo/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/cédula/i)).not.toBeInTheDocument();
  });

  it("adds no request beyond the ones the page already made", async () => {
    await renderAdmin();

    expect(mockFetchMiPerfil).toHaveBeenCalledTimes(1);
    expect(mockFetchStudentPortal).not.toHaveBeenCalled();
    expect(mockFetchPagosDePersona).not.toHaveBeenCalled();
  });
});

describe("ProfilePage — v2: the block of each role", () => {
  const MEMBERSHIP: MembershipSummary = {
    id: 4,
    estado: "ACTIVA",
    personaId: 8,
    montoAplicado: "25.00",
    categoria: "Mensual Adultos",
    modalidad: "MENSUAL",
    fechaActivacion: "2026-08-13T23:25:09.290557Z",
    fechaFin: null,
  };
  const SELF: StudentProfileSummary = {
    personaId: "1",
    nombres: "Pedro",
    apellidos: "Salgado",
    fechaNacimiento: "1999-10-04",
    recentSessions: [],
    membership: MEMBERSHIP,
    representante: null,
    representanteId: null,
  };
  const DEPENDANTS: StudentProfileSummary[] = [
    {
      personaId: "20",
      nombres: "Martin",
      apellidos: "Vera",
      fechaNacimiento: "2014-02-01",
      recentSessions: [],
      membership: { ...MEMBERSHIP, id: 20, estado: "ACTIVA" },
      representante: null,
      representanteId: null,
    },
    {
      personaId: "21",
      nombres: "Sofia",
      apellidos: "Vera",
      fechaNacimiento: "2016-08-15",
      recentSessions: [],
      membership: { ...MEMBERSHIP, id: 21, estado: "SUSPENDIDA" },
      representante: null,
      representanteId: null,
    },
    {
      personaId: "22",
      nombres: "Lucas",
      apellidos: "Vera",
      fechaNacimiento: "2018-01-01",
      recentSessions: [],
      membership: null,
      representante: null,
      representanteId: null,
    },
  ];

  function daysFromToday(days: number): string {
    const date = clubToday();
    date.setDate(date.getDate() + days);
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
  }

  function pago(fechaFin: string): PagoPersona {
    return {
      id: 1,
      monto: "25.00",
      motivoRechazo: null,
      estadoPago: "APROBADO",
      tipoPago: "TRANSFERENCIA",
      fechaRegistro: "2026-08-01T10:00:00",
      fechaValidacion: "2026-08-02T10:00:00",
      fechaInicio: "2026-08-01",
      fechaFin,
      personaId: 1,
      membresiaId: 4,
      voucherUrl: null,
      voucherFormato: null,
      descuentoValorAplicado: null,
      descuentoPorcentajeAplicado: null,
    };
  }

  async function renderStudent(
    self: StudentProfileSummary | null,
    opts: { role?: "estudiante" | "representante"; representados?: StudentProfileSummary[]; pagos?: PagoPersona[] } = {},
  ): Promise<HTMLElement> {
    mockUseAuth.mockReturnValue(sessionForRole(opts.role ?? "estudiante"));
    mockFetchStudentPortal.mockResolvedValueOnce({
      self,
      representados: opts.representados ?? [],
      membershipPlans: [],
    });
    mockFetchMiPerfil.mockResolvedValue(PERFIL_ESTUDIANTE);
    mockFetchPagosDePersona.mockResolvedValue(opts.pagos ?? []);
    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );
    return screen.findByTestId("profile-hero");
  }

  // ---- jugador ----------------------------------------------------------

  it("jugador: the ticket counts the days left and draws a 30-day strip", async () => {
    await renderStudent(SELF, { pagos: [pago(daysFromToday(24))] });

    const ticket = await screen.findByTestId("profile-membership");
    expect(within(ticket).getByTestId("profile-coverage")).toHaveTextContent("24");
    expect(within(ticket).getByText("días restantes")).toBeInTheDocument();
    expect(within(ticket).getByText(/Al día · hasta/)).toBeInTheDocument();
    const strip = within(ticket).getByRole("progressbar", { name: /cobertura restante/i });
    expect(strip).toHaveAttribute("aria-valuenow", "24");
    expect(strip.children).toHaveLength(30);
    expect(strip.querySelectorAll("i.bg-state-ok")).toHaveLength(24);
    expect(strip.querySelectorAll("i.bg-state-ok\\/25")).toHaveLength(6);
    expect(within(ticket).getByText("Mensual Adultos")).toBeInTheDocument();
    expect(within(ticket).getByText("Jugador desde")).toBeInTheDocument();
    expect(within(ticket).getByText("13/08/2026")).toBeInTheDocument();
  });

  it("jugador: the ticket warns in the last week and shows lapsed coverage as such", async () => {
    await renderStudent(SELF, { pagos: [pago(daysFromToday(5))] });
    const warn = await screen.findByTestId("profile-membership");
    expect(warn.className).toContain("border-t-state-warn");
    expect(within(warn).getByText(/Vence pronto/)).toBeInTheDocument();
  });

  it("jugador: lapsed coverage turns the ticket red and says how long ago", async () => {
    const hero = await renderStudent(SELF, { pagos: [pago(daysFromToday(-3))] });

    const ticket = await screen.findByTestId("profile-membership");
    expect(ticket.className).toContain("border-t-state-bad");
    expect(within(ticket).getByText("Venció hace 3 días")).toBeInTheDocument();
    expect(within(ticket).getByText(/Venció · hasta/)).toBeInTheDocument();
    expect(within(hero).getByText("Cobertura vencida")).toBeInTheDocument();
  });

  it("jugador: with no payment date the ticket keeps the plan and drops the day count", async () => {
    const hero = await renderStudent(SELF);

    const ticket = await screen.findByTestId("profile-membership");
    expect(within(ticket).queryByTestId("profile-coverage")).not.toBeInTheDocument();
    expect(within(ticket).queryByRole("progressbar")).not.toBeInTheDocument();
    expect(within(ticket).getByText("Mensual Adultos")).toBeInTheDocument();
    expect(within(hero).getByText("Sin pagos aprobados")).toBeInTheDocument();
    expect(ticket.className).toContain("border-t-state-warn");
  });

  it("jugador: with no membership there is no ticket, no board and no filler sentence", async () => {
    const hero = await renderStudent({ ...SELF, membership: null });

    expect(within(hero).getByText("Jugador")).toBeInTheDocument();
    expect(screen.queryByTestId("profile-membership")).not.toBeInTheDocument();
    expect(screen.queryByTestId("profile-role-board")).not.toBeInTheDocument();
    expect(screen.queryByTestId("profile-dependants")).not.toBeInTheDocument();
    expect(screen.queryByText(/no disponible — consulta/i)).not.toBeInTheDocument();
  });

  it("jugador: the card carries the birth date and the representante the portal already provides", async () => {
    const hero = await renderStudent({ ...SELF, representante: { nombres: "Laura", apellidos: "Vera" } as never });

    expect(within(hero).getByText("Nacimiento")).toBeInTheDocument();
    expect(within(hero).getByText("04/10/1999")).toBeInTheDocument();
    expect(within(hero).getByText("Tu representante")).toBeInTheDocument();
    expect(within(hero).getByText("Laura Vera")).toBeInTheDocument();
  });

  it("jugador: no recent-attendance card — that history has its own screen", async () => {
    await renderStudent({
      ...SELF,
      recentSessions: [{ fecha: "2026-08-10", horario: "Lunes 16:00 - 17:30", estado: "present" }],
    });
    await screen.findByTestId("profile-membership");

    expect(screen.queryByTestId("profile-activity")).not.toBeInTheDocument();
    expect(screen.queryByText("Lunes 16:00 - 17:30")).not.toBeInTheDocument();
  });

  it("jugador: asks only for what the page always asked for", async () => {
    await renderStudent(SELF);
    await screen.findByTestId("profile-membership");

    expect(mockFetchStudentPortal).toHaveBeenCalledTimes(1);
    expect(mockFetchPagosDePersona).toHaveBeenCalledTimes(1);
  });

  // ---- representante ----------------------------------------------------

  it("representante: «A tu cargo» lists each player with a status chip and a count", async () => {
    const hero = await renderStudent(null, { role: "representante", representados: DEPENDANTS });

    const card = await screen.findByTestId("profile-dependants");
    expect(within(card).getByRole("heading", { name: "A tu cargo" })).toBeInTheDocument();
    expect(within(card).getByText("3 jugadores")).toBeInTheDocument();
    expect(within(hero).getByText("3 jugadores a cargo")).toBeInTheDocument();
    const rows = within(card).getAllByTestId("profile-dependant");
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText("Martin Vera")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Activa")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Suspendida")).toBeInTheDocument();
    // Null is ambiguous (no membership OR a refused lookup), so it never says «sin membresía».
    expect(within(rows[2]).getByText("Sin membresía visible")).toBeInTheDocument();
    expect(screen.queryByText(/no disponible — consulta/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("profile-membership")).not.toBeInTheDocument();
  });

  it("representante: «+ Agregar jugador (menor de edad)» links to the existing add-dependent route", async () => {
    await renderStudent(null, { role: "representante", representados: DEPENDANTS });

    const card = await screen.findByTestId("profile-dependants");
    expect(within(card).getByRole("link", { name: /agregar jugador \(menor de edad\)/i })).toHaveAttribute(
      "href",
      "/student/add-dependent",
    );
  });

  it("representante with nobody to look after: an empty state, and the way to add one", async () => {
    await renderStudent(null, { role: "representante" });

    const card = await screen.findByTestId("profile-dependants");
    expect(within(card).getByText(/todavía no hay jugadores representados/i)).toBeInTheDocument();
    expect(within(card).queryByText(/\d+ jugadores?$/)).not.toBeInTheDocument();
    expect(within(card).getByRole("link", { name: /agregar jugador/i })).toHaveAttribute(
      "href",
      "/student/add-dependent",
    );
  });

  it("representante who also holds a membership gets «A tu cargo» first and their own ticket after", async () => {
    await renderStudent(SELF, {
      role: "representante",
      representados: DEPENDANTS,
      pagos: [pago(daysFromToday(20))],
    });

    const card = await screen.findByTestId("profile-dependants");
    const ticket = await screen.findByTestId("profile-membership");
    expect(card.compareDocumentPosition(ticket) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // ---- entrenador / administrador ----------------------------------------

  it("entrenador: the coal board draws a table-tennis table with a brand-yellow ball", async () => {
    mockUseAuth.mockReturnValue(sessionForRole("trainer"));
    mockFetchMiPerfil.mockResolvedValueOnce({ ...PERFIL_ADMIN, roles: ["ENTRENADOR"] });
    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );
    await waitForStaffProfile();

    const board = screen.getByTestId("profile-role-board");
    expect(board.className).toContain("bg-coal");
    expect(within(board).getByRole("heading", { name: "Entrenador" })).toBeInTheDocument();
    expect(within(board).getByText(/Mi día y Pasar lista/)).toBeInTheDocument();
    const svg = board.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    // border + centre line + net band, and a ball in the brand yellow
    expect(svg?.querySelectorAll("rect")).toHaveLength(2);
    expect(svg?.querySelectorAll("path")).toHaveLength(1);
    expect(svg?.querySelector("circle")).toHaveAttribute("fill", "#FFD600");
  });

  it("administrador: the coal board draws a dotted trajectory that ends on the yellow ball, top right", async () => {
    mockUseAuth.mockReturnValue(sessionForRole("admin"));
    mockFetchMiPerfil.mockResolvedValueOnce(PERFIL_ADMIN);
    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );
    await waitForStaffProfile();

    const board = screen.getByTestId("profile-role-board");
    expect(within(board).getByRole("heading", { name: "Administración" })).toBeInTheDocument();
    expect(within(board).getByText(/se gestionan desde Miembros/)).toBeInTheDocument();
    const svg = board.querySelector("svg");
    expect(svg?.querySelector("path[stroke-dasharray]")).not.toBeNull();
    const ball = svg?.querySelector("circle[fill='#FFD600']");
    expect(ball).not.toBeNull();
    // The ball sits in the right half and the top half of its viewBox…
    expect(Number(ball?.getAttribute("cx"))).toBeGreaterThan(100);
    expect(Number(ball?.getAttribute("cy"))).toBeLessThan(60);
    // …and the motif's box is pinned to the board's top-right corner.
    const motif = svg?.parentElement as HTMLElement;
    expect(motif.className).toContain("right-4");
    expect(motif.className).toContain("top-4");
    expect(motif.className).toContain("pointer-events-none");
  });

  it("the staff roles show no membership ticket and no dependants", async () => {
    mockUseAuth.mockReturnValue(sessionForRole("admin"));
    mockFetchMiPerfil.mockResolvedValueOnce(PERFIL_ADMIN);
    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );
    await waitForStaffProfile();

    expect(screen.queryByTestId("profile-membership")).not.toBeInTheDocument();
    expect(screen.queryByTestId("profile-dependants")).not.toBeInTheDocument();
  });

  it("an unrecognised role still gets a block, so the column is never empty", async () => {
    mockUseAuth.mockReturnValue({
      ...ADMIN_SESSION,
      session: { ...ADMIN_SESSION.session, user: { ...ADMIN_SESSION.session.user, role: "unsupported" as const } },
    } as never);
    mockFetchMiPerfil.mockResolvedValueOnce({ ...PERFIL_ADMIN, roles: [] });
    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );
    await waitForStaffProfile();

    expect(within(screen.getByTestId("profile-role-board")).getByText(/no tiene un rol reconocido/i)).toBeInTheDocument();
  });
});

describe("ProfilePage — v2: Seguridad", () => {
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

  it("keeps the password change folded until «Cambiar» is pressed, then folds it again", async () => {
    await renderAdmin();

    const security = within(screen.getByTestId("profile-column-status"));
    expect(security.getByRole("heading", { name: "Seguridad" })).toBeInTheDocument();
    expect(screen.queryByTestId("profile-change-password")).not.toBeInTheDocument();
    const toggle = security.getByRole("button", { name: "Cambiar" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);
    expect(screen.getByTestId("profile-change-password")).toBeInTheDocument();
    expect(screen.getByLabelText("Contraseña actual")).toBeInTheDocument();
    expect(security.getByRole("button", { name: "Cerrar" })).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(security.getByRole("button", { name: "Cerrar" }));
    expect(screen.queryByTestId("profile-change-password")).not.toBeInTheDocument();
  });

  it("reuses the sessions card inside Seguridad when the account has a history", async () => {
    mockFetchMisSesiones.mockResolvedValueOnce([
      { id: 1, dispositivo: "Linux · Chrome", iniciadaEn: "2026-10-04T10:00:00Z", actual: true, vigente: true },
      { id: 2, dispositivo: "Android · Chrome", iniciadaEn: "2026-10-03T10:00:00Z", actual: false, vigente: true },
    ]);
    await renderAdmin();

    const sessions = await screen.findByTestId("profile-sessions");
    expect(screen.getByTestId("profile-column-status").contains(sessions)).toBe(true);
    expect(within(sessions).getByText("Este equipo")).toBeInTheDocument();
    expect(sessions.className).not.toContain("card");
  });

  it("closes the other sessions from its own row, behind the confirmation", async () => {
    mockInvalidarOtrasSesiones.mockReset();
    await renderAdmin();

    const security = within(screen.getByTestId("profile-column-status"));
    fireEvent.click(security.getByRole("button", { name: "Cerrar otras sesiones" }));
    expect(mockInvalidarOtrasSesiones).not.toHaveBeenCalled();
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("offers the reset-by-email link and the FAQ as one line at the foot", async () => {
    await renderAdmin();

    const security = within(screen.getByTestId("profile-column-status"));
    expect(security.getByRole("button", { name: "Restablecer contraseña" })).toBeInTheDocument();
    expect(security.getByRole("link", { name: "Preguntas frecuentes" })).toHaveAttribute("href", "/ayuda");
    expect(security.getByText(/escribe a administración/i)).toBeInTheDocument();
  });
});

describe("ProfilePage — v2: the page title", () => {
  it.each([
    ["admin", "Administra tus datos de cuenta."],
    ["trainer", "Administra tus datos de cuenta."],
  ] as const)("says the %s lede in tú", async (role, lede) => {
    mockUseAuth.mockReturnValue(sessionForRole(role));
    mockFetchMiPerfil.mockResolvedValueOnce(PERFIL_ADMIN);
    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );
    await waitForStaffProfile();

    expect(screen.getByRole("heading", { level: 1, name: "Perfil" })).toBeInTheDocument();
    expect(screen.getByText(lede)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Register — issue #340, flipped by QA4 S6. A word-shape lock, not a fixed
// string: it fails on voseo imperatives, "vos" and "usted" forms wherever they
// appear in the rendered screen, for any of the four role variants.
// ---------------------------------------------------------------------------

describe("ProfilePage — tú register (issue #340)", () => {
  async function renderRole(
    role: "admin" | "trainer" | "estudiante" | "representante",
  ): Promise<void> {
    mockUseAuth.mockReturnValue(sessionForRole(role));
    if (role === "admin" || role === "trainer") {
      mockFetchMiPerfil.mockResolvedValueOnce({
        ...PERFIL_ADMIN,
        roles: role === "admin" ? ["ADMINISTRADOR"] : ["ENTRENADOR"],
      });
    } else if (role === "estudiante") {
      mockFetchStudentPortal.mockResolvedValueOnce({
        self: {
          personaId: "1",
          nombres: "Sofía",
          apellidos: "Alumna",
          fechaNacimiento: "2012-05-10",
          recentSessions: [],
          membership: null,
        },
        representados: [],
        membershipPlans: [],
      });
    } else {
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
        ],
        membershipPlans: [],
      });
    }

    render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );
    await screen.findByTestId("profile-column-status");
  }

  it.each(["admin", "trainer", "estudiante", "representante"] as const)(
    "keeps the %s view entirely in tú — no voseo/usted shape in the rendered screen",
    async (role) => {
      await renderRole(role);

      const main = screen.getByRole("main");
      const offenders = [...(main.textContent ?? "").matchAll(buildUstedRegisterRegex())].map(
        (m) => m[0],
      );
      expect(offenders).toEqual([]);
    },
  );
});
