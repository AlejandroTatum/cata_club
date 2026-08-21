/**
 * Component tests for MembersPage — Editar member modal replacing the inline
 * Roles popover + activo/inactivo toggle button in each account row.
 * Covers: a single "Editar" trigger per row opens a floating modal dialog
 * (role="dialog") with the same role checkboxes and activo toggle, closeable
 * via the X button, backdrop click, and Escape; only one modal can be open
 * at a time; and the same asignarRol/quitarRol/cambiarEstadoCuenta calls and
 * "ya tiene el rol" reconciliation the old inline popover fired.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import MembersPage from "@/app/members/page";
import type { MemberAccount, MemberStudentSummary } from "@/app/members/members-utils";
import type { DescuentoCatalogo } from "@/services/api";
import { ToastProvider } from "@/contexts/ToastContext";

vi.mock("@/components/ProtectedRoute", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// AppShell renders NotificationBell + needs next/navigation, next/link,
// next/image, AuthContext — same minimal mock pattern as GroupsPage.test.tsx.
vi.mock("next/navigation", () => ({
  usePathname: () => "/members",
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/image", () => ({
  __esModule: true,
  default: (props: React.ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean; priority?: boolean }) => {
    const { fill, priority, sizes, ...rest } = props;
    void fill;
    void priority;
    void sizes;
    // eslint-disable-next-line @next/next/no-img-element
    return <img alt="" {...rest} />;
  },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from "@/contexts/AuthContext";
const mockUseAuth = vi.mocked(useAuth);

type AuthState = ReturnType<typeof useAuth>;

/** Auth state for a fully hydrated session with the given role. */
function resolvedAuth(role: string): AuthState {
  return {
    session: {
      user: { id: "u1", name: "Admin Test", email: "admin@cataclub.com", role, representanteId: null },
      roles: ["ADMINISTRADOR"],
      loggedInAt: "2026-07-01T12:00:00Z",
    },
    isAuthenticated: true,
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
    revalidate: vi.fn(),
  } as unknown as AuthState;
}

/** Auth state while the session is still hydrating from the BFF. */
function hydratingAuth(): AuthState {
  return {
    session: null,
    isAuthenticated: false,
    isLoading: true,
    login: vi.fn(),
    logout: vi.fn(),
    revalidate: vi.fn(),
  } as unknown as AuthState;
}

// Every existing suite assumes a resolved admin session; the role-gate suite
// below overrides this per test.
beforeEach(() => {
  mockUseAuth.mockReturnValue(resolvedAuth("admin"));
  // `BeneficioSection` (issue #398) mounts unconditionally inside every
  // student edit panel, so every test that opens the edit modal fetches a
  // benefit whether it cares about one or not. Defaulting to "no beneficio"
  // here keeps every pre-existing test that never mentions beneficios green
  // without having to know this component exists.
  mockFetchBeneficio.mockReset().mockResolvedValue(null);
  mockAsignarBeneficio.mockReset();
  mockRetirarBeneficio.mockReset();
  mockSuspenderMembresia.mockReset().mockResolvedValue({ id: 42, estado: "SUSPENDIDA" });
  mockReactivarMembresia.mockReset().mockResolvedValue({ id: 42, estado: "ACTIVA" });
  mockCambiarPlanMembresia.mockReset().mockResolvedValue({ id: 42, estado: "ACTIVA", tipoMembresiaId: 7 });
});

vi.mock("@/contexts/ToastContext", () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useToast: () => ({
    showToast: vi.fn(),
    showError: vi.fn(),
    showSuccess: vi.fn(),
    showInfo: vi.fn(),
    showWarning: vi.fn(),
  }),
}));

const mockFetchMembers = vi.fn();
const mockObtenerRolesDePersona = vi.fn();
const mockAsignarRol = vi.fn();
const mockQuitarRol = vi.fn();
const mockCambiarEstadoCuenta = vi.fn();
const mockActualizarPersona = vi.fn();
const mockFetchFichaMedica = vi.fn();
const mockActualizarFichaMedica = vi.fn();
const mockFetchTiposMembresia = vi.fn().mockResolvedValue([]);
const mockCrearMembresia = vi.fn();
const mockRegistrarPago = vi.fn();
const mockSubirVoucherPago = vi.fn().mockResolvedValue({ voucherUrl: "https://example.test/voucher.pdf" });
const mockFetchDescuentos = vi.fn().mockResolvedValue([]);
const mockFetchBeneficio = vi.fn().mockResolvedValue(null);
const mockAsignarBeneficio = vi.fn();
const mockRetirarBeneficio = vi.fn();
const mockFetchNotificaciones = vi.fn().mockResolvedValue({ items: [], total: 0, skip: 0, limit: 20 });
const mockMarcarNotificacionLeida = vi.fn().mockResolvedValue(undefined);
const mockFetchMembresiaDeuda = vi.fn().mockResolvedValue({
  mesesAdeudados: 4,
  ultimaCoberturaFin: "2026-03-31",
  montoMensual: 85,
});
const mockRegularizarDeuda = vi.fn().mockResolvedValue({
  id: 99,
  estadoPago: "APROBADO",
  tipoPago: "REGULARIZACION",
  fechaInicio: "2026-04-01",
  fechaFin: "2026-04-30",
});
const mockSuspenderMembresia = vi.fn().mockResolvedValue({ id: 42, estado: "SUSPENDIDA" });
const mockReactivarMembresia = vi.fn().mockResolvedValue({ id: 42, estado: "ACTIVA" });
const mockCambiarPlanMembresia = vi.fn().mockResolvedValue({ id: 42, estado: "ACTIVA", tipoMembresiaId: 7 });
const mockSearchStudents = vi.fn().mockResolvedValue([]);
const mockVincularRepresentado = vi.fn();

vi.mock("@/services/api", () => {
  class MockApiClientError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = "ApiClientError";
      this.status = status;
    }
  }
  return {
    fetchMembers: () => mockFetchMembers(),
    obtenerRolesDePersona: (personaId: number) => mockObtenerRolesDePersona(personaId),
    asignarRol: (personaId: number, tipoRol: string) => mockAsignarRol(personaId, tipoRol),
    quitarRol: (personaId: number, tipoRol: string) => mockQuitarRol(personaId, tipoRol),
    cambiarEstadoCuenta: (personaId: number, activo: boolean) => mockCambiarEstadoCuenta(personaId, activo),
    actualizarPersona: (personaId: number, data: unknown) => mockActualizarPersona(personaId, data),
    fetchFichaMedica: (personaId: number) => mockFetchFichaMedica(personaId),
    actualizarFichaMedica: (personaId: number, data: unknown) => mockActualizarFichaMedica(personaId, data),
    fetchTiposMembresia: () => mockFetchTiposMembresia(),
    crearMembresia: (data: unknown) => mockCrearMembresia(data),
    registrarPago: (data: unknown) => mockRegistrarPago(data),
    subirVoucherPago: (pagoId: number, archivo: File) => mockSubirVoucherPago(pagoId, archivo),
    fetchDescuentos: () => mockFetchDescuentos(),
    fetchBeneficio: (personaId: number) => mockFetchBeneficio(personaId),
    asignarBeneficio: (personaId: number, descuentoId: number) => mockAsignarBeneficio(personaId, descuentoId),
    retirarBeneficio: (personaId: number) => mockRetirarBeneficio(personaId),
    fetchNotificaciones: () => mockFetchNotificaciones(),
    marcarNotificacionLeida: (id: number) => mockMarcarNotificacionLeida(id),
    fetchMembresiaDeuda: () => mockFetchMembresiaDeuda(),
    regularizarDeuda: (membresiaId: number, data: unknown) => mockRegularizarDeuda(membresiaId, data),
    suspenderMembresia: (membresiaId: number, data: unknown) => mockSuspenderMembresia(membresiaId, data),
    reactivarMembresia: (membresiaId: number, data: unknown) => mockReactivarMembresia(membresiaId, data),
    cambiarPlanMembresia: (membresiaId: number, nuevoTipoMembresiaId: number) =>
      mockCambiarPlanMembresia(membresiaId, nuevoTipoMembresiaId),
    searchStudents: (query: string, opts?: unknown) => mockSearchStudents(query, opts),
    vincularRepresentado: (personaId: number, cedula: string) => mockVincularRepresentado(personaId, cedula),
    ApiClientError: MockApiClientError,
  };
});

const ACCOUNT: MemberAccount = {
  id: "1",
  role: "representante",
  nombres: "María",
  apellidos: "González",
  telefono: "0999999999",
  estudiantes: [
    {
      id: "10",
      nombres: "Sofía",
      apellidos: "González",
      activo: true,
      membresia: null,
      ultimoPago: null,
    },
  ],
};

function createAccounts(count: number): MemberAccount[] {
  return Array.from({ length: count }, (_, index) => ({
    ...ACCOUNT,
    id: String(index + 1),
    nombres: `Responsable ${index + 1}`,
  }));
}

/**
 * The account's table row (`sm` and up). Below `sm` the same account is
 * rendered again as a card — the five-column table cannot fit on a phone, and
 * the previous fix of hiding four of its five columns left a one-column list
 * with a duplicated edit button crammed under the name. jsdom applies no real
 * CSS, so both renderings are in the document here; this helper picks the row.
 */
async function findAccountRow(): Promise<HTMLElement> {
  const matches = await screen.findAllByText("María González");
  const row = matches.map((el) => el.closest("tr")).find(Boolean);
  return row as HTMLElement;
}

/** The account's card rendering (below `sm`). */
async function findAccountCard(): Promise<HTMLElement> {
  const matches = await screen.findAllByText("María González");
  const card = matches.map((el) => el.closest("li")).find(Boolean);
  return card as HTMLElement;
}

/** Each rendering carries exactly one "Editar <name>" trigger. */
function getEditButton(container: HTMLElement): HTMLElement {
  return within(container).getAllByRole("button", { name: /^editar/i })[0];
}

describe("MembersPage — Editar member modal", () => {
  beforeEach(() => {
    mockFetchMembers.mockReset();
    mockObtenerRolesDePersona.mockReset();
    mockAsignarRol.mockReset();
    mockQuitarRol.mockReset();
    mockCambiarEstadoCuenta.mockReset();
    mockFetchFichaMedica.mockReset();
    mockActualizarFichaMedica.mockReset();
    mockFetchTiposMembresia.mockReset().mockResolvedValue([]);
    mockCrearMembresia.mockReset();
    mockFetchMembers.mockResolvedValue({ accounts: [ACCOUNT] });
    // Default: persona has no roles yet and is active — matches the old
    // hardcoded placeholder so existing tests below don't need to change,
    // while the real fetch-on-open behavior is exercised explicitly by the
    // "seeds roles/activo from the real backend state" tests further down.
    mockObtenerRolesDePersona.mockResolvedValue({ roles: [], activo: true });
    mockAsignarRol.mockResolvedValue({ roles: ["ADMINISTRADOR"] });
    mockQuitarRol.mockResolvedValue({ roles: [] });
    mockCambiarEstadoCuenta.mockResolvedValue({ activo: false });
    mockActualizarPersona.mockReset();
    mockActualizarPersona.mockResolvedValue({ id: 1, nombres: "María", apellidos: "González", telefono: "0999999999" });
  });

  /** Opens the row's modal and waits for the roles/estado fetch to settle
   * (checkboxes and the estado toggle are disabled until then), returning
   * the dialog element ready for interaction. */
  async function openModalAndWaitForRoles(row: HTMLElement): Promise<HTMLElement> {
    fireEvent.click(getEditButton(row));
    const dialog = screen.getByRole("dialog");
    await waitFor(() => {
      expect(within(dialog).getByRole("checkbox", { name: /admin/i })).not.toBeDisabled();
    });
    return dialog;
  }

  it("gives each rendering exactly one Editar trigger, and no inline role/status controls", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();
    const card = await findAccountCard();

    // One in the row, one in the phone card — not two stacked in the same
    // cell, which is what the audit found.
    expect(within(row).getAllByRole("button", { name: /^editar/i })).toHaveLength(1);
    expect(within(card).getAllByRole("button", { name: /^editar/i })).toHaveLength(1);
    expect(within(row).queryByRole("button", { name: /^roles$/i })).not.toBeInTheDocument();
    expect(within(row).queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows contact and membership on the phone card instead of hiding them", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const card = await findAccountCard();

    // The audit's finding: below `sm` these were all `hidden sm:table-cell`.
    expect(within(card).getByText(ACCOUNT.telefono)).toBeInTheDocument();
    expect(within(card).getByText(/activo|sin membresía|vencida|pendiente/i)).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Visual system: table column set/alignment, DataRow/DataBox adoption.
  // -------------------------------------------------------------------------

  it("drops the Contacto column and keeps Miembro / Representado por / Membresía / Editar", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();
    const table = row.closest("table") as HTMLElement;
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((header) => header.textContent?.trim());

    expect(headers).not.toContain("Contacto");
    // Issue #388 made the person the row's unit, not the paying root — a
    // represented person's row is THEIR identity, not their representative's,
    // so "Responsable de pago" is no longer an accurate header for every row.
    expect(headers[0]).toBe("Miembro");
    expect(headers).not.toContain("Responsable de pago");
    // Issue #388 also replaced the old "Estudiantes" count column — always 1
    // once every row is a single person — with who (if anyone) represents them.
    expect(headers).toContain("Representado por");
    expect(headers).not.toContain("Estudiantes");
  });

  it("aligns Membresía left and Editar right, matching header to body — never centered", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();
    const table = row.closest("table") as HTMLElement;

    const membresiaHeader = within(table).getByRole("columnheader", { name: "Membresía" });
    expect(membresiaHeader.className).toContain("text-left");

    const columnheaders = within(table).getAllByRole("columnheader");
    const editarHeader = columnheaders[columnheaders.length - 1];
    expect(editarHeader.className).toContain("text-right");
  });

  it("renders the mobile account list through the DataRow primitive, not a hand-rolled <li>", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const card = await findAccountCard();
    // `DataRow`'s own dense layout: identity in semibold, boxed metadata,
    // status, actions — instead of a bespoke flex/dl card.
    expect(card.className).toContain("items-center");
    const list = card.closest("ul") as HTMLElement;
    expect(list.className).toContain("divide-y");
  });

  it("boxes a student's age instead of leaving it as bare running text", async () => {
    mockFetchMembers.mockResolvedValue({
      accounts: [
        {
          ...ACCOUNT,
          estudiantes: [{ ...ACCOUNT.estudiantes[0], fechaNacimiento: "2010-01-01" }],
        },
      ],
    });
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();
    fireEvent.click(getEditButton(row));
    const dialog = screen.getByRole("dialog");

    const ageText = within(dialog).getByText(/\d+ años/);
    // `DataBox`'s own shape: a sunken fill and a hairline border, not a bare <p>.
    expect(ageText.closest("span")?.className).toContain("bg-sunken");
  });

  it("computes the boxed age from the club's calendar day, not a UTC-shifted one", async () => {
    // Birthday is tomorrow (club calendar), so the correct age is 17, one
    // year short of 18. A private `calculateAge` used to live in this file
    // and read the birth date via `new Date(fechaNacimiento)` — UTC midnight,
    // which lands on 2008-07-14 local under Ecuador's UTC-5 offset. That
    // shifted-back birth date makes the birthday look like it already
    // happened, and the old function reported 18 for this exact case.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 6, 14));
    try {
      mockFetchMembers.mockResolvedValue({
        accounts: [
          {
            ...ACCOUNT,
            estudiantes: [{ ...ACCOUNT.estudiantes[0], fechaNacimiento: "2008-07-15" }],
          },
        ],
      });
      render(
        <ToastProvider>
          <MembersPage />
        </ToastProvider>,
      );
      const row = await findAccountRow();
      fireEvent.click(getEditButton(row));
      const dialog = screen.getByRole("dialog");

      expect(within(dialog).getByText("17 años")).toBeInTheDocument();
      expect(within(dialog).queryByText("18 años")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens exactly one dialog, however many renderings of the account exist", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const card = await findAccountCard();
    fireEvent.click(getEditButton(card));

    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("never renders a row expand/collapse control — the table no longer expands", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();

    expect(within(row).queryByRole("button", { name: /^expandir$/i })).not.toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: /^contraer$/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Sofía González")).not.toBeInTheDocument();

    fireEvent.click(getEditButton(row));
    // The student only becomes visible once the modal is open — never via row interaction.
    expect(screen.getByRole("dialog")).toHaveTextContent("Sofía González");
  });

  it("shows each student's editable ficha médica action inside the modal", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();

    fireEvent.click(getEditButton(row));
    const dialog = screen.getByRole("dialog");

    expect(within(dialog).getByText("Estudiantes a cargo")).toBeInTheDocument();
    expect(within(dialog).getByText("Sofía González")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /ficha médica/i })).toBeInTheDocument();
  });

  it("renders one edit panel per student when an account manages multiple students", async () => {
    mockFetchMembers.mockResolvedValue({
      accounts: [
        {
          ...ACCOUNT,
          estudiantes: [
            { ...ACCOUNT.estudiantes[0], id: "10", nombres: "Sofía", apellidos: "González" },
            { ...ACCOUNT.estudiantes[0], id: "11", nombres: "Mateo", apellidos: "González" },
          ],
        },
      ],
    });
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();

    fireEvent.click(getEditButton(row));
    const dialog = screen.getByRole("dialog");

    expect(within(dialog).getByText("Sofía González")).toBeInTheDocument();
    expect(within(dialog).getByText("Mateo González")).toBeInTheDocument();
    expect(within(dialog).getAllByRole("button", { name: /ficha médica/i })).toHaveLength(2);
  });

  it("opens a floating modal dialog with 4 checkable role rows when Editar is clicked", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();

    fireEvent.click(getEditButton(row));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByRole("checkbox", { name: /admin/i })).toBeInTheDocument();
    expect(within(dialog).getByRole("checkbox", { name: /entrenador/i })).toBeInTheDocument();
    expect(within(dialog).getByRole("checkbox", { name: /representante/i })).toBeInTheDocument();
    expect(within(dialog).getByRole("checkbox", { name: /alumno/i })).toBeInTheDocument();
  });

  it("shows the member's read-only name and telefono inside the modal", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();

    fireEvent.click(getEditButton(row));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("María González");
    expect(dialog).toHaveTextContent("0999999999");
  });

  it("Nombres/Apellidos/Teléfono are genuinely editable inputs (not read-only text), matching what the Editar trigger promises", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();

    fireEvent.click(getEditButton(row));
    const dialog = screen.getByRole("dialog");

    const nombresInput = within(dialog).getByLabelText("Nombres") as HTMLInputElement;
    const apellidosInput = within(dialog).getByLabelText("Apellidos") as HTMLInputElement;
    const telefonoInput = within(dialog).getByLabelText("Teléfono") as HTMLInputElement;
    expect(nombresInput.value).toBe("María");
    expect(apellidosInput.value).toBe("González");
    expect(telefonoInput.value).toBe("0999999999");

    fireEvent.change(nombresInput, { target: { value: "María José" } });
    fireEvent.change(telefonoInput, { target: { value: "0988888888" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /guardar nombre, apellido y teléfono/i }));

    await waitFor(() => {
      expect(mockActualizarPersona).toHaveBeenCalledWith(1, {
        nombres: "María José",
        apellidos: "González",
        telefono: "0988888888",
      });
    });
    expect(await within(dialog).findByRole("status")).toHaveTextContent("Guardado");
  });

  it("shows a clear error when saving Nombre/Teléfono fails", async () => {
    // PATCH /personas/{id} failed server-side. Nothing the user typed into
    // Nombre or Teléfono caused it, so the 500's own `detail` has nothing to
    // add and the modal reports the server instead.
    const { ApiClientError } = await import("@/services/api");
    mockActualizarPersona.mockRejectedValueOnce(new ApiClientError("No se pudo actualizar", 500));
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();

    fireEvent.click(getEditButton(row));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /guardar nombre, apellido y teléfono/i }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Tuvimos un problema de nuestro lado y no pudimos completar esto. Escríbanos por WhatsApp y lo ayudamos: https://wa.me/593994219619",
    );
  });

  // Issue #314 (K6 hallazgo #16): clicking the Admin checkbox used to fire
  // asignarRol/quitarRol on the very first click, no confirmation, no naming
  // of what granting or revoking total club control does. `confirmAdmin`
  // clicks the "Admin" checkbox and then the confirmation's own "Confirmar"
  // button — the two-step path the fix now requires. Every other role stays
  // one click (reversible), so those keep firing directly.
  function confirmAdmin(dialog: HTMLElement): void {
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /admin/i }));
    fireEvent.click(screen.getByRole("button", { name: /^confirmar$/i }));
  }

  it("clicking Admin opens a confirmation naming the account and the effect, without mutating yet", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();

    const dialog = await openModalAndWaitForRoles(row);
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /admin/i }));

    const confirmDialogs = screen.getAllByRole("dialog");
    const confirmDialog = confirmDialogs[confirmDialogs.length - 1];
    expect(within(confirmDialog).getByText(/maría gonzález/i)).toBeInTheDocument();
    expect(within(confirmDialog).getByText(/control total del club/i)).toBeInTheDocument();
    expect(mockAsignarRol).not.toHaveBeenCalled();
  });

  it("leaves the role unchanged when the Admin confirmation is canceled", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();

    const dialog = await openModalAndWaitForRoles(row);
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /admin/i }));
    fireEvent.click(screen.getByRole("button", { name: /^cancelar$/i }));

    expect(mockAsignarRol).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("checkbox", { name: /admin/i })).not.toBeChecked();
  });

  it("selecting a role in the modal fires asignarRol only after the Admin confirmation is accepted", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();

    const dialog = await openModalAndWaitForRoles(row);
    confirmAdmin(dialog);

    await waitFor(() => {
      expect(mockAsignarRol).toHaveBeenCalledWith(1, "ADMINISTRADOR");
    });
  });

  it("deselecting an already-selected Admin role fires quitarRol, also gated behind confirmation", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();

    const dialog = await openModalAndWaitForRoles(row);
    confirmAdmin(dialog);
    await waitFor(() => expect(mockAsignarRol).toHaveBeenCalledWith(1, "ADMINISTRADOR"));

    confirmAdmin(dialog);
    await waitFor(() => {
      expect(mockQuitarRol).toHaveBeenCalledWith(1, "ADMINISTRADOR");
    });
  });

  it("a non-Admin role still toggles on a single click, with no confirmation step", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();

    const dialog = await openModalAndWaitForRoles(row);
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /entrenador/i }));

    expect(screen.queryByText(/control total del club/i)).not.toBeInTheDocument();
    await waitFor(() => {
      expect(mockAsignarRol).toHaveBeenCalledWith(1, "ENTRENADOR");
    });
  });

  it('reconciles local state when the backend reports "ya tiene el rol" on assign', async () => {
    // `rol_servicio.asignar_rol` raises OperacionInvalida, which backend/main.py
    // maps to 400 — the status that means "about what you sent". The sentence
    // is hand-authored and names no implementation, so it survives both gates
    // and reaches the branch in page.tsx that reconciles the checkbox.
    const { ApiClientError } = await import("@/services/api");
    mockAsignarRol.mockRejectedValueOnce(
      new ApiClientError("Esta persona ya tiene el rol ADMINISTRADOR", 400),
    );
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();

    const dialog = await openModalAndWaitForRoles(row);
    confirmAdmin(dialog);

    await waitFor(() => {
      expect(within(dialog).getByRole("checkbox", { name: /admin/i })).toBeChecked();
    });
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
  });

  it('reconciles local state when the backend reports "no tiene el rol" on unassign', async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();

    const dialog = await openModalAndWaitForRoles(row);
    const adminCheckbox = within(dialog).getByRole("checkbox", { name: /admin/i });

    // First round-trip assigns (default mockAsignarRol success) so the
    // checkbox is checked before we exercise the removal-reconciliation branch.
    confirmAdmin(dialog);
    await waitFor(() => expect(adminCheckbox).toBeChecked());

    // `rol_servicio.quitar_rol` raises OperacionInvalida → 400. It used to
    // raise EntidadNoEncontrada → 404, and a 404 `detail` is one the frontend
    // does not trust: the sentence never reached the branch in page.tsx that
    // reconciles the checkbox. The persona exists — what is invalid is
    // removing a role that was never assigned.
    const { ApiClientError } = await import("@/services/api");
    mockQuitarRol.mockRejectedValueOnce(
      new ApiClientError("Esta persona no tiene el rol ADMINISTRADOR", 400),
    );
    confirmAdmin(dialog);

    await waitFor(() => {
      expect(adminCheckbox).not.toBeChecked();
    });
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("surfaces the last-admin refusal and leaves the role checkbox checked", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();

    const dialog = await openModalAndWaitForRoles(row);
    const adminCheckbox = within(dialog).getByRole("checkbox", { name: /admin/i });

    confirmAdmin(dialog);
    await waitFor(() => expect(adminCheckbox).toBeChecked());

    // Verbatim from rol_servicio._asegurar_que_queda_otro_administrador, not
    // the truncated version this test used to carry: the real sentence is 196
    // characters and it is the reason MAX_DETAIL_LENGTH is 200 rather than the
    // 120 an incomplete survey put it at. OperacionInvalida → 400.
    const refusal =
      "No se puede quitar el rol ADMINISTRADOR: es el último administrador activo del " +
      "sistema y quedaría sin acceso de administración. Asigne el rol " +
      "ADMINISTRADOR a otra cuenta activa antes de continuar.";
    const { ApiClientError } = await import("@/services/api");
    mockQuitarRol.mockRejectedValueOnce(new ApiClientError(refusal, 400));
    confirmAdmin(dialog);

    await waitFor(() => {
      expect(within(dialog).getByRole("alert")).toHaveTextContent(/último administrador activo/i);
    });
    // The role was NOT removed on the backend, so the toggle must stay checked.
    expect(adminCheckbox).toBeChecked();
  });

  it("toggling the account activo/inactivo state inside the modal calls cambiarEstadoCuenta", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();

    const dialog = await openModalAndWaitForRoles(row);
    fireEvent.click(within(dialog).getByRole("button", { name: /^activa$/i }));

    await waitFor(() => {
      expect(mockCambiarEstadoCuenta).toHaveBeenCalledWith(1, false);
    });
  });

  it("seeds the role checkboxes from the persona's real current roles when the modal opens (not all unchecked)", async () => {
    mockObtenerRolesDePersona.mockResolvedValue({ roles: ["ENTRENADOR", "ADMINISTRADOR"], activo: true });
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();

    fireEvent.click(getEditButton(row));
    const dialog = screen.getByRole("dialog");

    await waitFor(() => {
      expect(mockObtenerRolesDePersona).toHaveBeenCalledWith(1);
    });
    await waitFor(() => {
      expect(within(dialog).getByRole("checkbox", { name: /admin/i })).toBeChecked();
    });
    expect(within(dialog).getByRole("checkbox", { name: /entrenador/i })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: /representante/i })).not.toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: /alumno/i })).not.toBeChecked();
  });

  it("reflects the persona's real activo:false state when the modal opens, instead of the true placeholder", async () => {
    mockObtenerRolesDePersona.mockResolvedValue({ roles: [], activo: false });
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();

    fireEvent.click(getEditButton(row));
    const dialog = screen.getByRole("dialog");

    await waitFor(() => {
      expect(within(dialog).getByRole("button", { name: /^inactiva$/i })).toBeInTheDocument();
    });
  });

  it("disables the role checkboxes and shows an error instead of silently keeping stale data when the roles fetch fails", async () => {
    // fetch itself rejected — the modal opened with the backend unreachable.
    // Every failure route in services/api.ts throws ApiClientError(message,
    // status), so this is the one status-less shape a call site can see.
    mockObtenerRolesDePersona.mockRejectedValue(new TypeError("Failed to fetch"));
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();

    fireEvent.click(getEditButton(row));
    const dialog = screen.getByRole("dialog");

    // The fetch failure is surfaced in both the Estado and Roles sections
    // (both controls are disabled by it), so two identical alerts is the
    // expected — not accidental — result.
    const alerts = await within(dialog).findAllByRole("alert");
    expect(alerts.length).toBeGreaterThan(0);
    for (const alert of alerts) {
      expect(alert).toHaveTextContent(
        "No pudimos conectar. Revise su conexión a internet e intente nuevamente.",
      );
    }
    expect(within(dialog).getByRole("checkbox", { name: /admin/i })).toBeDisabled();
  });

  it("closes the modal when the close (X) button is clicked", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();

    fireEvent.click(getEditButton(row));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cerrar ventana" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("returns focus to the Editar button when the modal closes", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();

    const editButton = getEditButton(row);
    fireEvent.click(editButton);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar ventana" }));

    expect(document.activeElement).toBe(editButton);
  });

  it("does not carry a stale error into a freshly reopened modal", async () => {
    // A real network drop while assigning: fetch rejects with a TypeError and
    // never reaches the client's ApiClientError paths. What the assertion is
    // really about is that the alert does not survive a modal reopen.
    mockAsignarRol.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();

    fireEvent.click(getEditButton(row));
    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: /admin/i })).not.toBeDisabled();
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /admin/i }));
    fireEvent.click(screen.getByRole("button", { name: /^confirmar$/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No pudimos conectar. Revise su conexión a internet e intente nuevamente.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Cerrar ventana" }));
    fireEvent.click(getEditButton(row));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("closes the modal when clicking the backdrop", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();

    fireEvent.click(getEditButton(row));
    fireEvent.click(screen.getByRole("dialog"));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes the modal on Escape", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();

    fireEvent.click(getEditButton(row));
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opening a second row's modal closes any previously open modal (only one at a time)", async () => {
    mockFetchMembers.mockResolvedValue({ accounts: createAccounts(2) });
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );

    const rowOf = (name: string): HTMLElement =>
      screen
        .getAllByText(name)
        .map((el) => el.closest("tr"))
        .find(Boolean) as HTMLElement;

    await screen.findAllByText("Responsable 1 González");
    const row1 = rowOf("Responsable 1 González");
    const row2 = rowOf("Responsable 2 González");

    fireEvent.click(getEditButton(row1));
    expect(screen.getByRole("dialog")).toHaveTextContent("Responsable 1");

    fireEvent.click(getEditButton(row2));
    const dialogs = screen.getAllByRole("dialog");
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0]).toHaveTextContent("Responsable 2");
  });
});

describe("MembersPage — Crear membresía inline form", () => {
  beforeEach(() => {
    mockFetchMembers.mockReset();
    mockFetchMembers.mockResolvedValue({ accounts: [ACCOUNT] });
    mockFetchTiposMembresia.mockReset().mockResolvedValue([]);
  });

  it("opens the create-membership form (type select + Crear/Cancelar) inside the student's card", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();

    // Membership creation lives inside the student's edit-panel card, only
    // reachable via the account's edit modal — no more row expansion. The
    // card is fixed-width (no dynamic grid-column-span hack needed anymore,
    // unlike the old cramped 4-column row layout).
    fireEvent.click(getEditButton(row));
    const dialog = screen.getByRole("dialog");

    const crearButton = await within(dialog).findByRole("button", { name: /crear membresía/i });
    fireEvent.click(crearButton);

    const combobox = await within(dialog).findByRole("combobox");
    // Scoped to the create-membership form itself: the modal footer also has
    // its own "Cancelar" button, so a dialog-wide query would be ambiguous.
    const form = combobox.parentElement as HTMLElement;
    expect(within(form).getByRole("button", { name: /^crear$/i })).toBeInTheDocument();
    expect(within(form).getByRole("button", { name: /^cancelar$/i })).toBeInTheDocument();
  });
});

describe("MembersPage — Registrar pago inline form", () => {
  beforeEach(() => {
    mockFetchMembers.mockReset();
    mockFetchTiposMembresia.mockReset().mockResolvedValue([]);
    mockRegistrarPago.mockReset();
    mockSubirVoucherPago.mockReset().mockResolvedValue({ voucherUrl: "https://example.test/voucher.pdf" });
    mockFetchDescuentos.mockReset().mockResolvedValue([]);
  });

  type Membresia = NonNullable<MemberStudentSummary["membresia"]>;

  /** The membership most tests below render against: vencida, $85/month, a
   *  June period gone by — due for a renewal. */
  const MEMBRESIA_VENCIDA: Membresia = {
    tipo: "Mensual (Tarde)",
    estado: "vencida",
    fechaInicio: "2026-06-01",
    fechaFin: "2026-06-30",
    monto: 85,
    id: 42,
  };

  /**
   * Given a member whose student carries `membresia` and a discount catalog
   * of `descuentos` (and, when the backend is meant to reject the payment,
   * `registrarPagoRejects`): renders MembersPage, opens the account's edit
   * modal and returns its dialog. Every test below starts from "the modal is
   * open" and picks its own when/then from there.
   */
  async function openMemberDialog(
    options: {
      membresia?: Membresia;
      ultimoPago?: MemberStudentSummary["ultimoPago"];
      descuentos?: DescuentoCatalogo[];
      registrarPagoRejects?: Error;
    } = {},
  ): Promise<HTMLElement> {
    const cuentaConMembresia: MemberAccount = {
      ...ACCOUNT,
      estudiantes: [
        {
          ...ACCOUNT.estudiantes[0],
          membresia: options.membresia ?? MEMBRESIA_VENCIDA,
          ...(options.ultimoPago !== undefined ? { ultimoPago: options.ultimoPago } : {}),
        },
      ],
    };
    mockFetchMembers.mockResolvedValue({ accounts: [cuentaConMembresia] });
    mockFetchDescuentos.mockResolvedValue(options.descuentos ?? []);
    if (options.registrarPagoRejects) {
      mockRegistrarPago.mockRejectedValueOnce(options.registrarPagoRejects);
    } else {
      mockRegistrarPago.mockResolvedValueOnce({ id: 99, estadoPago: "PENDIENTE_VALIDACION" });
    }

    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();
    fireEvent.click(getEditButton(row));
    return screen.getByRole("dialog");
  }

  /** When: the admin clicks "Registrar pago" inside an already-open edit
   *  dialog — the step every test past the button-presence check takes right
   *  after `openMemberDialog`. */
  async function openPaymentForm(dialog: HTMLElement): Promise<void> {
    fireEvent.click(await within(dialog).findByRole("button", { name: /registrar pago/i }));
  }

  /** When: the admin attaches a voucher and submits. TRANSFERENCIA is the
   *  only payment method this form offers — the admin can no longer declare
   *  a cash payment on someone else's behalf (see
   *  `test_efectivo_solo_por_socio.py`), so every submission here needs a
   *  voucher. The shared last step before every test asserts on what
   *  reached `registrarPago`. */
  function submitPaymentWithVoucher(dialog: HTMLElement): void {
    const fileInput = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: { files: [new File(["x"], "comprobante.pdf", { type: "application/pdf" })] },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /registrar pago/i }));
  }

  it("renders a 'Registrar pago' button inside the student card when the student has a membership", async () => {
    const dialog = await openMemberDialog({
      membresia: {
        tipo: "Mensual (Tarde)",
        estado: "activa",
        fechaInicio: "2026-07-01",
        fechaFin: "2026-07-31",
        monto: 85,
        id: 42,
      },
    });

    const registrarBtn = await within(dialog).findByRole("button", { name: /registrar pago/i });
    expect(registrarBtn).toBeInTheDocument();
  });

  // Issue #313 (K5 hallazgo #67): "1 meses de vigencia" — concordancia de
  // número rota, igual que "1 resultados mostrados" en el listado.
  it("says '1 mes de vigencia' in singular when the monto covers exactly one month", async () => {
    const dialog = await openMemberDialog({
      membresia: {
        tipo: "Mensual (Tarde)",
        estado: "activa",
        fechaInicio: "2026-07-01",
        fechaFin: "2026-07-31",
        monto: 85,
        id: 42,
      },
    });
    await openPaymentForm(dialog);

    // El monto se prellena con el precio mensual (85/85 = 1 mes).
    expect(
      await within(dialog).findByText(/1 mes de vigencia \(precio mensual: \$85\)/i),
    ).toBeInTheDocument();
  });

  /**
   * Business rule: cash payments are declared only by the payer or their
   * representative (see `test_efectivo_solo_por_socio.py`), never by an
   * administrator on someone else's behalf. This form is exactly that
   * "administrator on someone else's behalf" path, so it must not offer
   * EFECTIVO as a choice at all — TRANSFERENCIA is the only method.
   */
  it("does not offer EFECTIVO as a payment method", async () => {
    const dialog = await openMemberDialog();
    await openPaymentForm(dialog);

    expect(within(dialog).queryByText(/efectivo/i)).not.toBeInTheDocument();
    expect(within(dialog).getByText("Transferencia")).toBeInTheDocument();
  });

  it("opens the payment form with monto/tipo/fechas, calls registrarPago on submit, shows success", async () => {
    const dialog = await openMemberDialog();
    await openPaymentForm(dialog);

    const montoInput = await within(dialog).findByDisplayValue("85");
    expect(montoInput).toBeInTheDocument();
    expect(await within(dialog).findByText(/Inicio:/)).toBeInTheDocument();
    expect(await within(dialog).findByText(/Fin:/)).toBeInTheDocument();

    submitPaymentWithVoucher(dialog);

    await waitFor(() => {
      expect(mockRegistrarPago).toHaveBeenCalledTimes(1);
    });
    expect(mockRegistrarPago.mock.calls[0][0]).toMatchObject({
      personaId: 10,
      membresiaId: 42,
      meses: 1,
      tipoPago: "TRANSFERENCIA",
    });
    await waitFor(() => {
      expect(within(dialog).getByText(/pago registrado/i)).toBeInTheDocument();
    });
  });

  /**
   * Issue #398: this form used to fetch the discount catalog and render a
   * radio picker (see the git history of this test) so the admin chose a
   * discount per payment. Since the backend now resolves a payment's
   * discount from the persona's ASSIGNED benefit — see the "Beneficio del
   * club" describe below — and ignores that choice entirely, this form
   * offers no discount UI at all anymore, and never even asks the catalog
   * for one.
   */
  it("renders no discount picker inside the payment form", async () => {
    const dialog = await openMemberDialog({
      descuentos: [{ id: 1, nombre: "Media beca", porcentaje: "50", monto: null, activo: true }],
    });
    await openPaymentForm(dialog);
    await within(dialog).findByDisplayValue("85");

    expect(within(dialog).queryByRole("radio")).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/descuento/i)).not.toBeInTheDocument();
    expect(mockFetchDescuentos).not.toHaveBeenCalled();
  });

  it("never sends descuentoIds in the payment payload", async () => {
    const dialog = await openMemberDialog();
    await openPaymentForm(dialog);

    submitPaymentWithVoucher(dialog);

    await waitFor(() => {
      expect(mockRegistrarPago).toHaveBeenCalledTimes(1);
    });
    // The whole key set, not `objectContaining` — that would still pass even
    // if `descuentoIds` came back on the payload.
    expect(Object.keys(mockRegistrarPago.mock.calls[0][0] as Record<string, unknown>).sort()).toEqual(
      ["membresiaId", "meses", "personaId", "tipoPago"].sort(),
    );
  });

  /**
   * "El monto no coincide con la cuota mensual" used to be the example
   * here, but that backend rule is GONE (issue #400/4b: `PagoCreateDTO`
   * takes `meses`, an integer -- there is no monto left to validate
   * against the cuota). The protection this test guards -- an arbitrary
   * backend 400 surfaces verbatim as a form error, not swallowed or
   * replaced with a generic message -- still needs a message this exact
   * flow can actually produce: registering a payment while the membership
   * already has one PENDIENTE_VALIDACION.
   */
  it("surfaces an arbitrary backend 400 message as a normal form error", async () => {
    const { ApiClientError } = await import("@/services/api");
    const dialog = await openMemberDialog({
      registrarPagoRejects: new ApiClientError(
        "Esta membresía ya tiene un pago pendiente de validación. Espere a que sea validado antes de registrar uno nuevo.",
        400,
      ),
    });
    await openPaymentForm(dialog);

    submitPaymentWithVoucher(dialog);

    expect(
      await within(dialog).findByText(
        "Esta membresía ya tiene un pago pendiente de validación. Espere a que sea validado antes de registrar uno nuevo.",
      ),
    ).toBeInTheDocument();
  });

  it("offers 'Regularizar deuda' for a membership, shows the derived debt and submits the motivo", async () => {
    mockFetchMembresiaDeuda.mockResolvedValue({
      mesesAdeudados: 4,
      ultimaCoberturaFin: "2026-03-31",
      montoMensual: 85,
    });
    const dialog = await openMemberDialog({
      membresia: {
        tipo: "Mensual (Tarde)",
        estado: "vencida",
        fechaInicio: "2026-03-01",
        fechaFin: "2026-03-31",
        monto: 85,
        id: 42,
      },
    });

    // The debt is derived and admin-only: opening the tool fetches it and
    // shows the owed months before anything is written.
    fireEvent.click(within(dialog).getByRole("button", { name: /regularizar deuda/i }));
    expect(await within(dialog).findByText(/4 meses adeudados/i)).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText(/fecha inicio/i), { target: { value: "2026-04-01" } });
    fireEvent.change(within(dialog).getByLabelText(/fecha fin/i), { target: { value: "2026-04-30" } });
    fireEvent.change(within(dialog).getByLabelText(/^motivo/i), { target: { value: "Demora del club" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^regularizar$/i }));

    expect(mockRegularizarDeuda).toHaveBeenCalledWith(42, {
      monto: 85,
      fechaInicio: "2026-04-01",
      fechaFin: "2026-04-30",
      motivo: "Demora del club",
    });
  });

  // Issue #400 (slice 4c-b): a gratuitous membership's real, nonzero
  // `monto` ($85) is exactly what this form used to prefill as the amount
  // to "catch up on" — the backend's `RegularizacionDeudaDTO.monto`
  // requires `> 0` regardless, so there is no honest amount this admin
  // could submit for a member who does not pay.
  it("does NOT offer 'Regularizar deuda' for a gratuitous membership, and explains why", async () => {
    const dialog = await openMemberDialog({
      membresia: { ...MEMBRESIA_VENCIDA, esGratuidadFamiliar: true },
    });

    expect(
      await within(dialog).findByText(/no hay ningún monto que regularizar/i),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: /regularizar deuda/i }),
    ).not.toBeInTheDocument();
  });

  // Issue #313 (K5 hallazgo #15): "Membresía: Vencida" y "0 meses adeudados"
  // a la vez, en el mismo recuadro. Las dos cifras son individualmente
  // correctas — el estado se vence apenas vence la cobertura, la deuda
  // solo cuenta MESES CALENDARIO COMPLETOS — pero un admin lee "0" como
  // "no debe nada" al lado de "Vencida" y son lecturas opuestas. Cuando
  // faltan menos de 30 días para completar el primer mes, el formulario
  // ahora reporta la fecha de vencimiento real en vez del "0" que se leía
  // como un cierre.
  it("no dice '0 meses adeudados' cuando la membresía está vencida pero aún no completa un mes: dice desde cuándo", async () => {
    mockFetchMembresiaDeuda.mockResolvedValue({
      mesesAdeudados: 0,
      ultimaCoberturaFin: "2026-07-20",
      montoMensual: 85,
    });
    const dialog = await openMemberDialog({
      membresia: {
        tipo: "Mensual (Tarde)",
        estado: "vencida",
        fechaInicio: "2026-06-20",
        fechaFin: "2026-07-20",
        monto: 85,
        id: 42,
      },
    });

    fireEvent.click(within(dialog).getByRole("button", { name: /regularizar deuda/i }));

    expect(await within(dialog).findByText(/vencida desde el 20\/07\/2026/i)).toBeInTheDocument();
    expect(within(dialog).queryByText(/0 meses adeudados/i)).not.toBeInTheDocument();
  });

  // Issue #313 (K5 hallazgo #44): la ficha mostraba seis datos sueltos sin
  // rótulo, con el período repetido dos veces en formatos distintos
  // (dd/mm/aaaa y aaaa-mm-dd) y el importe repetido tres veces — porque
  // `membresia.monto` Y `ultimoPago.periodo` duplicaban, con otro nombre y
  // otro formato, datos que ya estaban en pantalla. El fix borra la
  // duplicación (el período ya no se imprime dos veces) y rotula lo que
  // queda: precio del plan, monto del último pago y vigencia son tres
  // hechos distintos y ahora se leen como tres hechos distintos.
  it("labels the plan price, the last payment's amount and the period separately, and prints the period only once", async () => {
    const dialog = await openMemberDialog({
      membresia: {
        tipo: "Mensual Infantil",
        estado: "activa",
        fechaInicio: "2026-08-01",
        fechaFin: "2026-09-05",
        monto: 25,
        id: 42,
      },
      ultimoPago: {
        estado: "rechazado",
        fechaPago: "2026-08-01",
        monto: 50,
        periodo: "2026-08-01 — 2026-09-05",
      },
    });

    expect(within(dialog).getByText("Precio del plan")).toBeInTheDocument();
    expect(within(dialog).getByText("$25,00")).toBeInTheDocument();
    expect(within(dialog).getByText("Monto del último pago")).toBeInTheDocument();
    expect(within(dialog).getByText("$50,00")).toBeInTheDocument();
    expect(within(dialog).getByText("Vigencia")).toBeInTheDocument();

    // El período aparece UNA sola vez — nunca la forma cruda "aaaa-mm-dd".
    expect(within(dialog).queryByText(/2026-08-01 — 2026-09-05/)).not.toBeInTheDocument();
  });

  // Issue #400 (slice 4c-b): E04-RF002 stopped zeroing `monto_aplicado`, so
  // a gratuitous membership now carries a real, nonzero `monto` ($85 here,
  // same as `MEMBRESIA_VENCIDA`) — exactly the combination that would let
  // an admin register a real charge against a member who does not pay.
  it("does NOT render a 'Registrar pago' button for a gratuitous membership, and explains why", async () => {
    const dialog = await openMemberDialog({
      membresia: { ...MEMBRESIA_VENCIDA, esGratuidadFamiliar: true },
    });

    // `RegisterPaymentForm` AND `RegularizarDeudaForm` both block on this
    // same flag, each with its own explanatory sentence — both contain
    // "gratuidad familiar", so this asserts the one specific to the
    // register-payment form rather than a plain `findByText` (which would
    // throw on the two matches).
    expect(
      await within(dialog).findByText(/no hay ningún pago que registrar/i),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: /^registrar pago$/i }),
    ).not.toBeInTheDocument();
  });

  it("does NOT render a 'Registrar pago' button when the student has no membership", async () => {
    mockFetchMembers.mockResolvedValue({ accounts: [ACCOUNT] });

    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();
    fireEvent.click(getEditButton(row));

    const dialog = screen.getByRole("dialog");
    await within(dialog).findByRole("button", { name: /crear membresía/i });
    expect(within(dialog).queryByRole("button", { name: /^registrar pago$/i })).not.toBeInTheDocument();
  });

  // --- Issue #400, criterio 3: suspensión / reactivación -------------------

  it("offers 'Suspender' for an ACTIVA membership and submits the motivo", async () => {
    const dialog = await openMemberDialog({
      membresia: { ...MEMBRESIA_VENCIDA, estado: "activa" },
    });

    fireEvent.click(within(dialog).getByRole("button", { name: /suspender membresía/i }));
    fireEvent.change(within(dialog).getByLabelText(/^motivo/i), {
      target: { value: "Ausencia prolongada" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /^suspender$/i }));

    await waitFor(() =>
      expect(mockSuspenderMembresia).toHaveBeenCalledWith(42, { motivo: "Ausencia prolongada" }),
    );
  });

  it("offers 'Reactivar' for a SUSPENDIDA membership and submits the motivo", async () => {
    const dialog = await openMemberDialog({
      membresia: { ...MEMBRESIA_VENCIDA, estado: "suspendida" },
    });

    fireEvent.click(within(dialog).getByRole("button", { name: /reactivar membresía/i }));
    fireEvent.change(within(dialog).getByLabelText(/^motivo/i), {
      target: { value: "Regresó al club" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /^reactivar$/i }));

    await waitFor(() =>
      expect(mockReactivarMembresia).toHaveBeenCalledWith(42, { motivo: "Regresó al club" }),
    );
  });

  it("does NOT offer 'Suspender' nor 'Reactivar' for a VENCIDA membership", async () => {
    const dialog = await openMemberDialog({ membresia: MEMBRESIA_VENCIDA });

    expect(within(dialog).queryByRole("button", { name: /suspender membresía/i })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /reactivar membresía/i })).not.toBeInTheDocument();
  });

  // --- Issue #400, criterio 1: cambio de plan -------------------------------

  it("offers 'Cambiar plan', lists the catalog and submits the selected tipo", async () => {
    mockFetchTiposMembresia.mockResolvedValue([
      { id: 5, categoria: "Adultos", precio: "30.00", modalidad: "MENSUAL" },
      { id: 7, categoria: "Juveniles", precio: "45.00", modalidad: "MENSUAL" },
    ]);
    const dialog = await openMemberDialog({ membresia: MEMBRESIA_VENCIDA });

    fireEvent.click(within(dialog).getByRole("button", { name: /cambiar plan/i }));
    const combobox = await within(dialog).findAllByRole("combobox");
    // The last combobox on screen is this form's own — the create-membership
    // form's combobox is not rendered here (the student already has a
    // membership), but scoping defensively keeps this test honest if that
    // ever changes.
    const select = combobox[combobox.length - 1];
    fireEvent.change(select, { target: { value: "7" } });

    const form = select.parentElement as HTMLElement;
    fireEvent.click(within(form).getByRole("button", { name: /^cambiar$/i }));

    await waitFor(() => expect(mockCambiarPlanMembresia).toHaveBeenCalledWith(42, 7));
  });
});

describe("MembersPage — Beneficio del club", () => {
  beforeEach(() => {
    mockFetchMembers.mockReset();
    mockFetchMembers.mockResolvedValue({ accounts: [ACCOUNT] });
    mockFetchDescuentos.mockReset().mockResolvedValue([]);
  });

  const BENEFICIO_ACTIVO = {
    id: 7,
    personaId: 10,
    descuento: { id: 1, nombre: "Media beca", porcentaje: "50", monto: null, activo: true },
    asignadoPorPersonaId: 3,
    asignadoEn: "2026-08-01T10:00:00Z",
    retiradoPorPersonaId: null,
    retiradoEn: null,
  };

  async function openEditModal(): Promise<HTMLElement> {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();
    fireEvent.click(getEditButton(row));
    return screen.getByRole("dialog");
  }

  it("renders the active benefit, including who granted it", async () => {
    mockFetchBeneficio.mockResolvedValue(BENEFICIO_ACTIVO);
    const dialog = await openEditModal();

    expect(await within(dialog).findByText("Media beca")).toBeInTheDocument();
    expect(within(dialog).getByText("50%")).toBeInTheDocument();
    // The whole point of an auditable assignment: who granted it.
    expect(within(dialog).getByText(/asignado por persona #3/i)).toBeInTheDocument();
  });

  it('shows "Sin beneficio" when the persona has none', async () => {
    mockFetchBeneficio.mockResolvedValue(null);
    const dialog = await openEditModal();

    expect(await within(dialog).findByText(/sin beneficio/i)).toBeInTheDocument();
  });

  it("only offers active catalog discounts when assigning", async () => {
    mockFetchBeneficio.mockResolvedValue(null);
    mockFetchDescuentos.mockResolvedValue([
      { id: 1, nombre: "Media beca", porcentaje: "50", monto: null, activo: true },
      { id: 2, nombre: "Beca vieja", porcentaje: "100", monto: null, activo: false },
    ]);
    const dialog = await openEditModal();

    fireEvent.click(await within(dialog).findByRole("button", { name: /asignar beneficio/i }));
    const select = await within(dialog).findByRole("combobox");

    expect(within(select).getByText(/media beca/i)).toBeInTheDocument();
    expect(within(select).queryByText(/beca vieja/i)).not.toBeInTheDocument();
  });

  it("assigning calls the API and refreshes the block with the new benefit", async () => {
    mockFetchBeneficio.mockResolvedValue(null);
    mockFetchDescuentos.mockResolvedValue([
      { id: 1, nombre: "Media beca", porcentaje: "50", monto: null, activo: true },
    ]);
    mockAsignarBeneficio.mockResolvedValue(BENEFICIO_ACTIVO);
    const dialog = await openEditModal();
    await within(dialog).findByText(/sin beneficio/i);

    fireEvent.click(within(dialog).getByRole("button", { name: /asignar beneficio/i }));
    const select = await within(dialog).findByRole("combobox");
    fireEvent.change(select, { target: { value: "1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^asignar$/i }));

    await waitFor(() => {
      expect(mockAsignarBeneficio).toHaveBeenCalledWith(10, 1);
    });
    expect(await within(dialog).findByText("Media beca")).toBeInTheDocument();
    expect(within(dialog).queryByText(/sin beneficio/i)).not.toBeInTheDocument();
  });

  it("retiring asks for confirmation naming the benefit and history, and cancelling does not call the API", async () => {
    mockFetchBeneficio.mockResolvedValue(BENEFICIO_ACTIVO);
    const dialog = await openEditModal();

    fireEvent.click(await within(dialog).findByRole("button", { name: /retirar beneficio/i }));

    const confirm = within(dialog).getByRole("dialog");
    expect(confirm).toHaveTextContent(/media beca/i);
    expect(confirm).toHaveTextContent(/los pagos históricos no cambian/i);

    fireEvent.click(within(confirm).getByRole("button", { name: /^cancelar$/i }));

    expect(mockRetirarBeneficio).not.toHaveBeenCalled();
    // Cancelling did not retire it — the benefit is still shown.
    expect(within(dialog).getByText("Media beca")).toBeInTheDocument();
  });

  it("confirming the retirement calls the API and clears the benefit", async () => {
    mockFetchBeneficio.mockResolvedValue(BENEFICIO_ACTIVO);
    mockRetirarBeneficio.mockResolvedValue({ ...BENEFICIO_ACTIVO, retiradoEn: "2026-08-18T00:00:00Z" });
    const dialog = await openEditModal();

    fireEvent.click(await within(dialog).findByRole("button", { name: /retirar beneficio/i }));
    fireEvent.click(within(within(dialog).getByRole("dialog")).getByRole("button", { name: /^retirar$/i }));

    await waitFor(() => {
      expect(mockRetirarBeneficio).toHaveBeenCalledWith(10);
    });
    expect(await within(dialog).findByText(/sin beneficio/i)).toBeInTheDocument();
  });

  /**
   * A 5xx is never shown verbatim (see `toUserMessage`'s own doc comment:
   * "the detail describes the SERVER's failure, never the user's" — every
   * 5xx collapses to the app's one generic `SERVER_FAILURE` sentence,
   * regardless of what the backend's `detail` said). The first version of
   * this test asserted the raw detail string would render, which no screen
   * in this app actually does for a 5xx — fixed to assert the real,
   * documented contract instead of a message `toUserMessage` deliberately
   * discards.
   */
  it("surfaces a failure message when the initial fetch fails", async () => {
    const { ApiClientError } = await import("@/services/api");
    mockFetchBeneficio.mockRejectedValue(new ApiClientError("boom", 500));
    const dialog = await openEditModal();

    expect(
      await within(dialog).findByText(/tuvimos un problema de nuestro lado/i),
    ).toBeInTheDocument();
  });

  it("surfaces a backend failure message when assigning fails", async () => {
    const { ApiClientError } = await import("@/services/api");
    mockFetchBeneficio.mockResolvedValue(null);
    mockFetchDescuentos.mockResolvedValue([
      { id: 1, nombre: "Media beca", porcentaje: "50", monto: null, activo: true },
    ]);
    mockAsignarBeneficio.mockRejectedValue(
      new ApiClientError("La persona ya tiene un beneficio vigente", 400),
    );
    const dialog = await openEditModal();

    fireEvent.click(await within(dialog).findByRole("button", { name: /asignar beneficio/i }));
    const select = await within(dialog).findByRole("combobox");
    fireEvent.change(select, { target: { value: "1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^asignar$/i }));

    expect(
      await within(dialog).findByText("La persona ya tiene un beneficio vigente"),
    ).toBeInTheDocument();
  });
});

describe("MembersPage — capped results help", () => {
  it("opens named help that truthfully describes the known 200-result cap", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    await findAccountRow();

    fireEvent.click(screen.getByRole("button", { name: "Cómo funciona el listado" }));

    const help = screen.getByRole("region", { name: "Cómo funciona el listado" });
    expect(help).toHaveTextContent("hasta 200 registros");
    expect(help).toHaveTextContent("no confirma que se hayan cargado todos los miembros");
  });
});

// ---------------------------------------------------------------------------
// Issue #326: overdue amount + months on the members list for VENCIDA rows.
// Sourced from `MemberStudentSummary.membresia.mesesAdeudados`/
// `montoAdeudado` (built server-side by the adapter from the bulk debt
// endpoint) — MembersPage only renders what it's given, no fetch here.
// ---------------------------------------------------------------------------

describe("MembersPage — deuda en la fila (issue #326)", () => {
  it("shows overdue amount and months on a VENCIDA membership row and card", async () => {
    const cuentaConDeuda: MemberAccount = {
      ...ACCOUNT,
      estudiantes: [
        {
          ...ACCOUNT.estudiantes[0],
          membresia: {
            tipo: "Mensual (Tarde)",
            estado: "vencida",
            fechaInicio: "2026-05-01",
            fechaFin: "2026-05-31",
            monto: 30,
            id: 42,
            mesesAdeudados: 3,
            montoAdeudado: 90,
          },
        },
      ],
    };
    mockFetchMembers.mockResolvedValue({ accounts: [cuentaConDeuda] });

    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );

    const row = await findAccountRow();
    expect(within(row).getByText(/90/)).toBeInTheDocument();
    expect(within(row).getByText(/3\s*meses/i)).toBeInTheDocument();

    const card = await findAccountCard();
    expect(within(card).getByText(/90/)).toBeInTheDocument();
    expect(within(card).getByText(/3\s*meses/i)).toBeInTheDocument();
  });

  it("uses singular 'mes' for exactly one overdue month", async () => {
    const cuentaConUnMes: MemberAccount = {
      ...ACCOUNT,
      estudiantes: [
        {
          ...ACCOUNT.estudiantes[0],
          membresia: {
            tipo: "Mensual (Tarde)",
            estado: "vencida",
            fechaInicio: "2026-07-01",
            fechaFin: "2026-07-31",
            monto: 30,
            id: 42,
            mesesAdeudados: 1,
            montoAdeudado: 30,
          },
        },
      ],
    };
    mockFetchMembers.mockResolvedValue({ accounts: [cuentaConUnMes] });

    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );

    const row = await findAccountRow();
    expect(within(row).getByText(/1\s*mes\b/i)).toBeInTheDocument();
    expect(within(row).queryByText(/1\s*meses/i)).not.toBeInTheDocument();
  });

  it("shows nothing extra when a VENCIDA membership has no resolved debt data (bulk lookup degraded)", async () => {
    const cuentaSinDeudaResuelta: MemberAccount = {
      ...ACCOUNT,
      estudiantes: [
        {
          ...ACCOUNT.estudiantes[0],
          membresia: {
            tipo: "Mensual (Tarde)",
            estado: "vencida",
            fechaInicio: "2026-05-01",
            fechaFin: "2026-05-31",
            monto: 30,
            id: 42,
          },
        },
      ],
    };
    mockFetchMembers.mockResolvedValue({ accounts: [cuentaSinDeudaResuelta] });

    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );

    const row = await findAccountRow();
    expect(within(row).queryByText(/adeudad/i)).not.toBeInTheDocument();
  });

  it("does not show debt info for an ACTIVA membership even if debt fields were somehow present", async () => {
    const cuentaActiva: MemberAccount = {
      ...ACCOUNT,
      estudiantes: [
        {
          ...ACCOUNT.estudiantes[0],
          membresia: {
            tipo: "Mensual (Tarde)",
            estado: "activa",
            fechaInicio: "2026-08-01",
            fechaFin: "2026-09-01",
            monto: 30,
            id: 42,
          },
        },
      ],
    };
    mockFetchMembers.mockResolvedValue({ accounts: [cuentaActiva] });

    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );

    const row = await findAccountRow();
    expect(within(row).queryByText(/adeudad/i)).not.toBeInTheDocument();
  });
});

describe("MembersPage — honest aggregate coverage", () => {
  it("shows the incomplete-coverage notice when the upstream persona cap is reached after accounts collapse", async () => {
    mockFetchMembers.mockResolvedValue({ accounts: [ACCOUNT], personasCapped: true });

    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );

    // Issue #313 (K5 hallazgo #67): "1 resultados mostrados" — concordancia
    // de número rota. Con un solo resultado el contador debe leer singular.
    expect(await screen.findByRole("status", { name: "Resultados mostrados" })).toHaveTextContent(
      "1 resultado mostrado",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "puede estar incompleto",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("200 registros");
    expect(screen.queryByRole("navigation", { name: /paginación/i })).not.toBeInTheDocument();
  });

  it("hides the incomplete-coverage notice below the cap without adding pagination controls", async () => {
    mockFetchMembers.mockResolvedValue({ accounts: createAccounts(199), personasCapped: false });

    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );

    expect(await screen.findByRole("status", { name: "Resultados mostrados" })).toHaveTextContent(
      "199 resultados mostrados",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: /paginación/i })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// The stats row doesn't print the same count twice.
//
// "Estudiantes" and "Con membresía activa" sit side by side in the same tile
// row. The total student count was the tile's own value AND, verbatim, the
// number inside the neighboring tile's hint ("de N estudiantes") — the same
// figure spelled out twice a few centimeters apart.
// ---------------------------------------------------------------------------

describe("MembersPage — the stats row doesn't repeat the student count", () => {
  it("doesn't echo the total student count inside the neighboring tile's hint", async () => {
    const active = (id: string): MemberAccount => ({
      ...ACCOUNT,
      id,
      estudiantes: [
        {
          ...ACCOUNT.estudiantes[0],
          id: `${id}-e`,
          membresia: {
            tipo: "Mensual",
            estado: "activa",
            fechaInicio: "2026-07-01",
            fechaFin: "2026-07-31",
            monto: 50,
            id: Number(id),
          },
        },
      ],
    });
    // 2 accounts with an active membership + 1 without → 3 students total,
    // 2 with an active membership: two distinct, unambiguous figures.
    mockFetchMembers.mockReset().mockResolvedValue({
      accounts: [active("1"), active("2"), { ...ACCOUNT, id: "3" }],
    });

    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );

    const label = await screen.findByText("Estudiantes");
    const tile = label.closest("div") as HTMLElement;
    // The total (3) is the "Estudiantes" tile's own value...
    expect(within(tile).getByText("3")).toBeInTheDocument();
    // ...and the old bug repeated it, verbatim, inside the tile beside it.
    expect(screen.queryByText("de 3 estudiantes")).not.toBeInTheDocument();
    // The neighboring tile still names the population it measures against —
    // it just does not spell out the figure a second time.
    const activeTile = screen.getByText("Con membresía activa").closest("div") as HTMLElement;
    expect(within(activeTile).getByText("de los estudiantes")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Modal footer honesty (P0).
//
// The footer's red primary read "Guardar cambios" but its handler was
// `onToggleEditModal` — identical to the "Cancelar" button beside it. It saved
// nothing. Everything in the modal already persists per action, and the
// identity fields have their own save button, so the footer must not promise
// a save it never performs.
// ---------------------------------------------------------------------------

describe("MembersPage — edit modal footer does not fake a save", () => {
  beforeEach(() => {
    mockFetchMembers.mockReset().mockResolvedValue({ accounts: [ACCOUNT] });
    mockObtenerRolesDePersona.mockReset().mockResolvedValue({ roles: [], activo: true });
    mockFetchTiposMembresia.mockReset().mockResolvedValue([]);
    mockCrearMembresia.mockReset();
    mockActualizarPersona.mockReset();
  });

  it("offers no 'Guardar cambios' button, because nothing in the footer saves", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();
    fireEvent.click(getEditButton(row));
    const dialog = screen.getByRole("dialog");

    expect(within(dialog).queryByRole("button", { name: /guardar cambios/i })).not.toBeInTheDocument();
    // The paired "Cancelar" is gone too — with no save to cancel, offering
    // "Cancelar" implies discardable changes that were already persisted.
    expect(within(dialog).queryByRole("button", { name: /^cancelar$/i })).not.toBeInTheDocument();
  });

  it("closes the modal from a single secondary 'Cerrar' action in the footer", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();
    fireEvent.click(getEditButton(row));
    const dialog = screen.getByRole("dialog");

    // Exactly one control is named plain "Cerrar" — the footer's secondary.
    // The header's icon-only dismiss is "Cerrar ventana" so the two are
    // distinguishable in a screen reader's controls list.
    const footerClose = within(dialog).getByRole("button", { name: "Cerrar" });
    // Secondary, not the red primary: dismissing is not the CTA here.
    expect(footerClose.className).toContain("bg-paper");
    expect(footerClose.className).not.toContain("cata-red");

    fireEvent.click(footerClose);

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("declares each group's save contract instead of one blanket claim in the header", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();
    fireEvent.click(getEditButton(row));
    const dialog = screen.getByRole("dialog");

    // The old header said "Los cambios se guardan al instante" — true of roles
    // and estado, false of the identity fields and the membership form.
    expect(within(dialog).queryByText(/los cambios se guardan al instante/i)).not.toBeInTheDocument();

    for (const title of ["Datos de la cuenta", "Estado de la cuenta", "Roles", "Estudiantes a cargo"]) {
      const heading = within(dialog).getByRole("heading", { name: title });
      const header = heading.parentElement as HTMLElement;
      expect(within(header).getByText(/se guarda al instante|requiere guardar/i)).toBeInTheDocument();
    }

    const datos = within(dialog).getByRole("heading", { name: "Datos de la cuenta" })
      .parentElement as HTMLElement;
    expect(within(datos).getByText("Requiere guardar")).toBeInTheDocument();

    const roles = within(dialog).getByRole("heading", { name: "Roles" }).parentElement as HTMLElement;
    expect(within(roles).getByText("Se guarda al instante")).toBeInTheDocument();
  });

  it("gives the role switch a visible focus ring on the box that holds focus", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();
    fireEvent.click(getEditButton(row));
    const dialog = screen.getByRole("dialog");

    // The audit: the real checkbox is `sr-only` and the visible switch is
    // `aria-hidden`, so without a focus style on the wrapping label, keyboard
    // focus landed somewhere invisible.
    const checkbox = within(dialog).getByRole("checkbox", { name: /admin/i });
    const label = checkbox.closest("label") as HTMLElement;
    expect(label.className).toContain("focus-within:outline");
    expect(label.className).toContain("focus-within:outline-ball");

    // A bare ball outline is 1.41:1 on the chip fill — the same failure the
    // globals.css rule was written to correct, and this label sits outside
    // that rule's reach. The coal band is what carries the 3:1: it wraps the
    // ball, so the outline hugs the chip at offset 0 instead of floating 2px
    // off it. See color-contrast.test.ts for the measurements.
    expect(label.className).toContain("focus-within:shadow-focus-band");
    expect(label.className).toContain("focus-within:outline-offset-0");
    expect(label.className).not.toContain("focus-within:outline-offset-2");
  });

  it("marks a selected role with coal, never red", async () => {
    mockObtenerRolesDePersona.mockResolvedValue({ roles: ["ADMINISTRADOR"], activo: true });
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();
    fireEvent.click(getEditButton(row));
    const dialog = screen.getByRole("dialog");

    const checkbox = await within(dialog).findByRole("checkbox", { name: /admin/i });
    await waitFor(() => expect(checkbox).toBeChecked());
    const label = checkbox.closest("label") as HTMLElement;
    expect(label.className).toContain("border-coal");
    expect(label.className).not.toContain("cata-red");
  });

  it("names the identity save button after the two fields it actually saves", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();
    fireEvent.click(getEditButton(row));
    const dialog = screen.getByRole("dialog");

    // "Guardar datos" was ambiguous next to roles/estado/membresía controls
    // that save themselves; this button only PATCHes nombres/apellidos/teléfono.
    expect(
      within(dialog).getByRole("button", { name: "Guardar nombre, apellido y teléfono" }),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Guardar datos" })).not.toBeInTheDocument();
  });

  it("reloads the member list after creating a membership instead of asking the user to reload", async () => {
    mockFetchTiposMembresia.mockResolvedValue([
      { id: 5, categoria: "Mensual", precio: 25, modalidad: "mensual" },
    ]);
    mockCrearMembresia.mockResolvedValue({ id: 77 });

    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();
    fireEvent.click(getEditButton(row));
    const dialog = screen.getByRole("dialog");

    fireEvent.click(await within(dialog).findByRole("button", { name: /crear membresía/i }));
    const combobox = await within(dialog).findByRole("combobox");
    fireEvent.change(combobox, { target: { value: "5" } });

    const callsBefore = mockFetchMembers.mock.calls.length;
    const form = combobox.parentElement as HTMLElement;
    fireEvent.click(within(form).getByRole("button", { name: /^crear$/i }));

    await waitFor(() => expect(mockCrearMembresia).toHaveBeenCalled());
    // The list refreshes itself — the row shows the new membership without a
    // manual page reload.
    await waitFor(() =>
      expect(mockFetchMembers.mock.calls.length).toBeGreaterThan(callsBefore),
    );
    expect(screen.queryByText(/recarga para verla/i)).not.toBeInTheDocument();
  });

  it("assigns a plan without sending any price to the backend", async () => {
    // Issue #400: the client used to read the catalogue price and echo it back
    // as `montoAplicado`, which made the number the club charges with editable
    // in transit. The request must now say only WHO and WHICH PLAN — the
    // backend resolves the current tariff from `tipoMembresiaId`.
    //
    // The assertion is on the ABSENCE of a key, so it is written against the
    // whole payload rather than a subset: `objectContaining` would pass even
    // if the price came back.
    mockFetchTiposMembresia.mockResolvedValue([
      { id: 5, categoria: "Mensual", precio: 25, modalidad: "mensual" },
    ]);
    mockCrearMembresia.mockResolvedValue({ id: 77 });

    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();
    fireEvent.click(getEditButton(row));
    const dialog = screen.getByRole("dialog");

    fireEvent.click(await within(dialog).findByRole("button", { name: /crear membresía/i }));
    const combobox = await within(dialog).findByRole("combobox");
    fireEvent.change(combobox, { target: { value: "5" } });

    const form = combobox.parentElement as HTMLElement;
    fireEvent.click(within(form).getByRole("button", { name: /^crear$/i }));

    await waitFor(() => expect(mockCrearMembresia).toHaveBeenCalled());

    const payload = mockCrearMembresia.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(["personaId", "tipoMembresiaId"]);
    expect(payload).not.toHaveProperty("montoAplicado");
  });

  it("keeps the edit dialog open while the post-creation refresh is in flight", async () => {
    mockFetchTiposMembresia.mockResolvedValue([
      { id: 5, categoria: "Mensual", precio: 25, modalidad: "mensual" },
    ]);
    mockCrearMembresia.mockResolvedValue({ id: 77 });

    // Hold the refresh open so the in-flight window is observable. The bug was
    // that the refresh flipped the page-level `loading` flag, which gates the
    // whole account list — unmounting the dialog the admin was working in and
    // discarding every unsaved field in it.
    let releaseRefresh: (() => void) | undefined;
    const refreshed = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();
    fireEvent.click(getEditButton(row));
    const dialog = screen.getByRole("dialog");

    fireEvent.click(await within(dialog).findByRole("button", { name: /crear membresía/i }));
    const combobox = await within(dialog).findByRole("combobox");
    fireEvent.change(combobox, { target: { value: "5" } });

    mockFetchMembers.mockImplementationOnce(async () => {
      await refreshed;
      return { accounts: [ACCOUNT] };
    });

    const form = combobox.parentElement as HTMLElement;
    fireEvent.click(within(form).getByRole("button", { name: /^crear$/i }));

    await waitFor(() => expect(mockCrearMembresia).toHaveBeenCalled());

    // Mid-refresh: the dialog is still mounted and still holds its own state.
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    releaseRefresh?.();
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
  });
});

// ---------------------------------------------------------------------------
// Role-gated fetch (P2).
//
// `loadMembers` ran from a bare mount effect, so a non-admin (e.g. a student
// landing on /members) fired GET /api/members and logged a 403 before
// ProtectedRoute's redirect effect ran. ProtectedRoute is mocked to a
// pass-through here so the fetch gate is what is under test, not the guard.
// ---------------------------------------------------------------------------

describe("MembersPage — defers /api/members until the role resolves", () => {
  beforeEach(() => {
    mockFetchMembers.mockReset().mockResolvedValue({ accounts: [ACCOUNT] });
    mockObtenerRolesDePersona.mockReset().mockResolvedValue({ roles: [], activo: true });
  });

  it("does not request members while the session is still hydrating", async () => {
    mockUseAuth.mockReturnValue(hydratingAuth());

    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );

    await waitFor(() => expect(mockFetchMembers).not.toHaveBeenCalled());
  });

  it("does not request members for a resolved non-admin role", async () => {
    mockUseAuth.mockReturnValue(resolvedAuth("student"));

    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );

    await waitFor(() => expect(mockFetchMembers).not.toHaveBeenCalled());
  });

  it("requests members once the admin role has resolved", async () => {
    mockUseAuth.mockReturnValue(resolvedAuth("admin"));

    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );

    await waitFor(() => expect(mockFetchMembers).toHaveBeenCalled());
    expect((await screen.findAllByText("María González")).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// D7 — four tiles that were four different things wearing one shape.
//
// "Regla del hombro: el hombro de caucho marca lo que pide acción, y por eso lo
// lleva como mucho una tarjeta por fila. Si lo llevan las cuatro, no marca
// nada." And: "Regla de la forma: la figura toma la forma de lo que mide."
//
// The screen holds one queue of work (payments waiting to be validated) and one
// proportion (students with an active membership, out of the students). The
// other two are counts, and this screen has no creation date on any account or
// student — `MemberAccount` carries id/role/name/phone/students and nothing
// dated — so there is no trend to draw and no card may pretend otherwise.
// ---------------------------------------------------------------------------

describe("MembersPage — four tiles, four shapes (D7)", () => {
  /** Accounts whose single student does or does not hold an active membership. */
  function withMembership(id: string, activa: boolean): MemberAccount {
    return {
      ...ACCOUNT,
      id,
      estudiantes: [
        {
          ...ACCOUNT.estudiantes[0],
          id: `${id}-e`,
          membresia: activa
            ? {
                tipo: "Mensual",
                estado: "activa",
                fechaInicio: "2026-07-01",
                fechaFin: "2026-07-31",
                monto: 50,
                id: Number(id),
              }
            : null,
        },
      ],
    };
  }

  /**
   * The tile carrying a given label.
   *
   * Looked up through `h-stat` — the 116px height token that IS a stat tile —
   * rather than through `getByText`, because two of these labels also name a
   * table column ("Estudiantes") and a plain text query cannot tell the tile
   * from the column header.
   */
  function tileOf(label: string): HTMLElement {
    const tiles = Array.from(document.querySelectorAll<HTMLElement>(".h-stat"));
    const tile = tiles.find((candidate) => candidate.firstElementChild?.textContent === label);
    expect(tile, `no stat tile labelled "${label}"`).toBeDefined();
    return tile as HTMLElement;
  }

  beforeEach(() => {
    mockFetchMembers.mockReset().mockResolvedValue({
      accounts: [withMembership("1", true), withMembership("2", false), withMembership("3", false)],
    });
  });

  it("gives the coal shoulder to the queue of work, and to nothing else", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    await screen.findByText("Pagos pendientes");

    // Pending payments is the only tile that names a pile of things somebody
    // has to come and do; the other three report a state of the world.
    expect(tileOf("Pagos pendientes")).toHaveClass("bg-coal");
    for (const quiet of ["Cuentas", "Estudiantes", "Con membresía activa"]) {
      expect(tileOf(quiet)).not.toHaveClass("bg-coal");
    }
  });

  it("draws the membership share as a share, at the ratio the figures measure", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    await screen.findByText("Con membresía activa");

    // One of the three students holds an active membership.
    const track = within(tileOf("Con membresía activa")).getByTestId("stat-track");
    expect((track.firstElementChild as HTMLElement).style.width).toBe("33.3%");
  });

  it("draws no bar on the tiles that measure a count, because no trend reaches this screen", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    await screen.findByText("Cuentas");

    expect(screen.getAllByTestId("stat-track")).toHaveLength(1);
    for (const counted of ["Cuentas", "Estudiantes", "Pagos pendientes"]) {
      expect(within(tileOf(counted)).queryByTestId("stat-track")).not.toBeInTheDocument();
    }
  });

  it("draws no bar at all when the share cannot be read upstream", async () => {
    // An unreadable numerator is not a numerator of zero, and a bar at 0% is
    // exactly the lie the em dash exists to avoid.
    mockFetchMembers.mockReset().mockResolvedValue({
      accounts: [withMembership("1", false)],
      membresiasDegraded: true,
    });

    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    await screen.findByText("Con membresía activa");

    expect(within(tileOf("Con membresía activa")).getByText("—")).toBeInTheDocument();
    expect(screen.queryByTestId("stat-track")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// D9 — the identity cell is a shared piece, and it says only what the row has.
// ---------------------------------------------------------------------------

describe("MembersPage — the identity cell (D9)", () => {
  beforeEach(() => {
    mockFetchMembers.mockReset().mockResolvedValue({ accounts: [ACCOUNT] });
  });

  it("opens the row with the shared cell — the initials beside the name", async () => {
    const row = await (async () => {
      render(
        <ToastProvider>
          <MembersPage />
        </ToastProvider>,
      );
      return findAccountRow();
    })();

    const initials = within(row).getByText("MG");
    expect(initials).toHaveAttribute("aria-hidden", "true");
    expect(within(row).getByText("María González")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Issue #388 — one row per person: "Representado por" replaces the old
// disclosure/expand mechanic entirely.
//
// The row used to collapse a representative and everyone they represent into
// one group, with a "Representante · N jugadores" summary and a "Ver
// jugadores" disclosure to name them. That mechanic assumed `estudiantes` held
// several people; now every row is exactly one person (`estudiantes` is
// always that one person), so there is nothing left to count or disclose.
// "Representado por" says the same thing a different way: who, if anyone,
// pays for THIS row.
// ---------------------------------------------------------------------------

describe('MembersPage — "Representado por" (issue #388)', () => {
  const REPRESENTED: MemberAccount = {
    ...ACCOUNT,
    id: "10",
    representadoPor: "Carlos Martínez",
  };

  const SELF_MANAGED: MemberAccount = {
    ...ACCOUNT,
    id: "1",
    nombres: "María",
    apellidos: "González",
    representadoPor: undefined,
  };

  it("shows the representative's name in the row when the person is represented", async () => {
    mockFetchMembers.mockReset().mockResolvedValue({ accounts: [REPRESENTED] });
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();

    expect(within(row).getByText("Carlos Martínez")).toBeInTheDocument();
  });

  it("shows the representative's name on the phone card too", async () => {
    mockFetchMembers.mockReset().mockResolvedValue({ accounts: [REPRESENTED] });
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const card = await findAccountCard();

    expect(within(card).getByText(/Carlos Martínez/)).toBeInTheDocument();
  });

  it("shows no representative for a self-managed account", async () => {
    mockFetchMembers.mockReset().mockResolvedValue({ accounts: [SELF_MANAGED] });
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();

    expect(within(row).queryByText(/Carlos Martínez/)).not.toBeInTheDocument();
    // No disclosure trigger survives either — there is no group left to expand.
    expect(within(row).queryByRole("button", { name: /jugadores de/i })).not.toBeInTheDocument();
  });

  it("opens the edit dialog for the exact represented person, not their representative", async () => {
    mockFetchMembers.mockReset().mockResolvedValue({ accounts: [REPRESENTED] });
    mockObtenerRolesDePersona.mockReset().mockResolvedValue({ roles: [], activo: true });
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();
    fireEvent.click(getEditButton(row));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("María González")).toBeInTheDocument();
    // `useAccountRolesAndStatus` is keyed by the row's OWN id (10), never her
    // representative's — editing a represented person must never silently
    // target the representative's account instead.
    expect(mockObtenerRolesDePersona).toHaveBeenCalledWith(10);
  });
});

// ---------------------------------------------------------------------------
// Issue #504 — missing emergency data is optional at registration (backend:
// test_crear_ficha_medica_sin_datos_de_emergencia_son_opcionales in
// test_ficha_medica.py has no validation requiring it), so the row notice
// must read as informational, not borrow the same warn tone and alert
// vocabulary the product uses for real errors (ErrorState.tsx,
// wizard-fields.tsx).
// ---------------------------------------------------------------------------

describe("MembersPage — missing emergency data reads as informational, not an error (issue #504)", () => {
  const NO_EMERGENCY_DATA: MemberAccount = {
    ...ACCOUNT,
    id: "20",
    sinDatosEmergencia: true,
  };

  it("does not use warn tone or the old alert copy for an optional, unfilled field", async () => {
    mockFetchMembers.mockReset().mockResolvedValue({ accounts: [NO_EMERGENCY_DATA] });
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();

    // The old copy borrowed the product's error vocabulary for something the
    // backend never requires — assert it is gone, not just that new text
    // exists alongside it.
    expect(within(row).queryByText("Sin datos de emergencia")).not.toBeInTheDocument();
    // Scoped to the full notice text (not a bare `/ficha médica/i` substring):
    // issue #505 added a "Ficha médica" row action beside this notice, and a
    // loose match now finds both.
    const notice = within(row).getByText(/sin ficha médica cargada/i);
    expect(notice).not.toHaveClass("text-state-warn");
    expect(notice).toHaveClass("text-state-neutral");
  });

  it("shows the same neutral notice on the phone card", async () => {
    mockFetchMembers.mockReset().mockResolvedValue({ accounts: [NO_EMERGENCY_DATA] });
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const card = await findAccountCard();

    expect(within(card).queryByText("Sin datos de emergencia")).not.toBeInTheDocument();
    expect(within(card).getByText(/sin ficha médica cargada/i)).toHaveClass("text-state-neutral");
  });

  it("shows no notice at all once emergency data is present", async () => {
    mockFetchMembers.mockReset().mockResolvedValue({ accounts: [ACCOUNT] });
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();

    expect(within(row).queryByText(/sin ficha médica cargada/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// D9 — a column is named for what it holds, never for the button inside it.
// ---------------------------------------------------------------------------

describe("MembersPage — the trailing column is not named after its button", () => {
  beforeEach(() => {
    mockFetchMembers.mockReset().mockResolvedValue({ accounts: [ACCOUNT] });
  });

  it("names the column for what it contains, and keeps the name off the screen", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();
    const table = row.closest("table") as HTMLElement;
    const headers = within(table).getAllByRole("columnheader");
    const trailing = headers[headers.length - 1];

    expect(trailing.textContent?.trim()).toBe("Acciones");
    // Visually hidden: over a column of 32px triggers that already say what
    // they do, a printed heading is one more word to skip past.
    expect(trailing.querySelector(".sr-only")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// D5 — three levels, and a row action is the third one.
// ---------------------------------------------------------------------------

describe("MembersPage — the repeated row trigger is tertiary (D5)", () => {
  beforeEach(() => {
    mockFetchMembers.mockReset().mockResolvedValue({ accounts: [ACCOUNT] });
  });

  it("fills the row trigger instead of outlining it once per row", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();
    const trigger = getEditButton(row);

    // `secondary` is `bg-paper border-line-2` — on a paper table that is a
    // visible box drawn once per row, forty-five of them down the page, all
    // claiming the weight D8 reserves for the one action beside the primary.
    expect(trigger).toHaveClass("bg-sunken", "border-transparent");
    expect(trigger).not.toHaveClass("bg-paper");
  });
});

// ---------------------------------------------------------------------------
// D11c — the help does not live loose.
// ---------------------------------------------------------------------------

describe("MembersPage — the help is anchored (D11c)", () => {
  beforeEach(() => {
    mockFetchMembers.mockReset().mockResolvedValue({ accounts: [ACCOUNT] });
  });

  it("says what the screen IS in its subtitle, in one line", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );

    expect(
      await screen.findByText("Las cuentas que pagan y los jugadores que tienen a cargo."),
    ).toBeInTheDocument();
  });

  it("lives inside the block it qualifies, not in a band of canvas of its own", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    await findAccountRow();

    const panel = screen.getByRole("region", { name: "Filtros de miembros" });
    expect(
      within(panel).getByRole("button", { name: "Cómo funciona el listado" }),
    ).toBeInTheDocument();
  });

  it("stays on screen when the search finds nobody, which is when the cap matters most", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    await findAccountRow();

    fireEvent.change(screen.getByLabelText("Buscar miembros"), {
      target: { value: "nadie con este nombre" },
    });

    await screen.findByText("No se encontraron miembros");
    const panel = screen.getByRole("region", { name: "Filtros de miembros" });
    expect(
      within(panel).getByRole("button", { name: "Cómo funciona el listado" }),
    ).toBeInTheDocument();
  });

  it("does not repeat the subtitle it sits under", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    await findAccountRow();

    fireEvent.click(screen.getByRole("button", { name: "Cómo funciona el listado" }));
    const help = screen.getByRole("region", { name: "Cómo funciona el listado" });
    expect(help.textContent).not.toContain("Las cuentas que pagan");
  });
});

// ---------------------------------------------------------------------------
// D11b — the 227px under the empty state.
// ---------------------------------------------------------------------------

describe("MembersPage — the empty state leaves no hole under it (D11b)", () => {
  beforeEach(() => {
    mockFetchMembers.mockReset().mockResolvedValue({ accounts: [ACCOUNT] });
  });

  it("stretches the empty-state card to the column instead of leaving canvas under it", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    await findAccountRow();

    fireEvent.change(screen.getByLabelText("Buscar miembros"), {
      target: { value: "nadie con este nombre" },
    });

    const title = await screen.findByText("No se encontraron miembros");
    const card = title.closest("div") as HTMLElement;
    expect(card).toHaveClass("flex-1", "justify-center", "card");
  });

  it("keeps the three parts D11 requires — what is missing, why, and the way out", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    await findAccountRow();

    fireEvent.change(screen.getByLabelText("Buscar miembros"), {
      target: { value: "nadie con este nombre" },
    });

    expect(await screen.findByText("No se encontraron miembros")).toBeInTheDocument();
    expect(
      screen.getByText("Ningún miembro coincide con la búsqueda y los filtros activos."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Limpiar búsqueda" })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// La ayuda explica la pantalla, no solo su tope.
//
// Decía una sola frase, sobre el límite de 200 registros: el dueño preguntó
// para qué servía. El estándar de la casa — Pagos, Descuentos — explica cómo
// funciona la pantalla. La viñeta del estado de membresía es la razón de ser
// del cambio: `getAccountStatusBadge` resume a todos los estudiantes de la
// cuenta y ese cálculo no estaba escrito en ninguna parte de la interfaz.
// ---------------------------------------------------------------------------

describe("MembersPage — la ayuda explica el listado", () => {
  beforeEach(() => {
    mockFetchMembers.mockReset().mockResolvedValue({ accounts: [ACCOUNT] });
  });

  /** Abre el disclosure y devuelve la región de ayuda. */
  async function openHelp(): Promise<HTMLElement> {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    await findAccountRow();
    fireEvent.click(screen.getByRole("button", { name: "Cómo funciona el listado" }));
    return screen.getByRole("region", { name: "Cómo funciona el listado" });
  }

  it("explica en tres viñetas, como el catálogo de Descuentos", async () => {
    const panel = await openHelp();
    expect(within(panel).getAllByRole("listitem")).toHaveLength(3);
  });

  it("dice que la fila es una persona y dónde se lee quién la representa", async () => {
    const panel = await openHelp();
    const [primera] = within(panel).getAllByRole("listitem");

    // Issue #388: la fila dejó de ser un grupo que se despliega — ya no hay
    // nombres que "leer desplegando la fila", solo la persona y, si aplica,
    // quién paga por ella.
    expect(primera).toHaveTextContent(/persona/i);
    expect(primera).toHaveTextContent(/representado por/i);
  });

  it("explica que el estado de la fila es el de esa persona, nunca una mezcla (issue #388)", async () => {
    const panel = await openHelp();
    const segunda = within(panel).getAllByRole("listitem")[1];

    // La vieja copia describía `getAccountStatusBadge` resumiendo a TODOS los
    // estudiantes de un grupo en el MEJOR estado. Ese cálculo ya no existe:
    // cada fila es una sola persona, así que la ayuda no puede seguir
    // hablando de "mejor, no el peor" — no hay nada que comparar dentro de la
    // fila.
    expect(segunda).not.toHaveTextContent(/mejor/i);
    expect(segunda).not.toHaveTextContent(/peor/i);
    expect(segunda).toHaveTextContent(/esa persona/i);
  });

  it("dice el tope y qué esperar cuando alguien no aparece", async () => {
    const panel = await openHelp();
    const tercera = within(panel).getAllByRole("listitem")[2];

    expect(tercera).toHaveTextContent(/200/);
    // El buscador filtra sobre lo ya traído (`filterAccounts` es cliente), así
    // que la ayuda no puede prometer que buscar alcance para traer a alguien
    // que quedó fuera del tope.
    expect(tercera).toHaveTextContent(/tope|fuera/i);
  });
});

/**
 * Issue #460, Escenario 5: the backend already lets an ADMINISTRADOR call
 * `vincular-representado` for any persona, but "Miembros → Editar" had no
 * field for it — an admin following the product ("the minor cannot pay,
 * fix it") hit a dead end. `LinkRepresentativeSection` reuses the exact same
 * endpoint the self-service "Agregar dependiente" flow already calls.
 */
describe("MembersPage — Representante legal (issue #460)", () => {
  const MENOR: MemberAccount = {
    id: "20",
    role: "representante",
    nombres: "Menor",
    apellidos: "SinRepresentante",
    telefono: "0999999999",
    estudiantes: [
      {
        id: "20",
        nombres: "Menor",
        apellidos: "SinRepresentante",
        cedula: "1710034065",
        fechaNacimiento: "2015-01-01",
        activo: true,
        membresia: null,
        ultimoPago: null,
      },
    ],
  };

  const ADULTO: MemberAccount = {
    ...ACCOUNT,
    id: "21",
    nombres: "Adulto",
    apellidos: "ConCuentaPropia",
    estudiantes: [
      {
        id: "21",
        nombres: "Adulto",
        apellidos: "ConCuentaPropia",
        cedula: "1710034073",
        fechaNacimiento: "1990-01-01",
        activo: true,
        membresia: null,
        ultimoPago: null,
      },
    ],
  };

  const REPRESENTANTE_ENCONTRADO = { id: 30, nombres: "Marcela", apellidos: "Ruiz" };

  beforeEach(() => {
    mockFetchMembers.mockReset();
    mockSearchStudents.mockReset().mockResolvedValue([]);
    mockVincularRepresentado.mockReset();
  });

  async function openMenorEditModal(account: MemberAccount = MENOR): Promise<HTMLElement> {
    mockFetchMembers.mockResolvedValue({ accounts: [account] });
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const matches = await screen.findAllByText(`${account.nombres} ${account.apellidos}`);
    const row = matches.map((el) => el.closest("tr")).find(Boolean) as HTMLElement;
    fireEvent.click(getEditButton(row));
    return screen.getByRole("dialog");
  }

  it("shows the field for a minor with no representative", async () => {
    const dialog = await openMenorEditModal();

    expect(within(dialog).getByText("Representante legal")).toBeInTheDocument();
    expect(within(dialog).getByText(/no tiene un representante vinculado/i)).toBeInTheDocument();
  });

  it("does not offer the field for an adult, self-managed account", async () => {
    const dialog = await openMenorEditModal(ADULTO);

    expect(within(dialog).queryByText("Representante legal")).not.toBeInTheDocument();
  });

  it("names the current representative and lets the admin replace it", async () => {
    const dialog = await openMenorEditModal({
      ...MENOR,
      representadoPor: "Pedro Ruiz",
    });

    expect(within(dialog).getByText(/representante actual: pedro ruiz/i)).toBeInTheDocument();
  });

  it("searches by name, then links the selected representative by the minor's own cédula", async () => {
    mockSearchStudents.mockResolvedValue([REPRESENTANTE_ENCONTRADO]);
    mockVincularRepresentado.mockResolvedValue({ id: 20, representanteId: 30 });
    const dialog = await openMenorEditModal();

    const search = within(dialog).getByPlaceholderText(/buscar representante por nombre/i);
    fireEvent.change(search, { target: { value: "Marcela" } });

    const option = await within(dialog).findByText("Marcela Ruiz");
    fireEvent.click(option);

    const link = within(dialog).getByRole("button", { name: /vincular a marcela ruiz/i });
    fireEvent.click(link);

    await waitFor(() =>
      // Path param is the REPRESENTANTE's id; the body is the MENOR's cédula —
      // never the other way around (`vincular-representado`'s own contract).
      expect(mockVincularRepresentado).toHaveBeenCalledWith(30, "1710034065"),
    );
    expect(await within(dialog).findByText(/vinculado a marcela ruiz/i)).toBeInTheDocument();
  });

  it("shows a clear message when linking fails, instead of a silent no-op", async () => {
    mockSearchStudents.mockResolvedValue([REPRESENTANTE_ENCONTRADO]);
    mockVincularRepresentado.mockRejectedValue(
      new (await import("@/services/api")).ApiClientError(
        "No fue posible completar la vinculación solicitada.",
        400,
        true,
      ),
    );
    const dialog = await openMenorEditModal();

    fireEvent.change(within(dialog).getByPlaceholderText(/buscar representante por nombre/i), {
      target: { value: "Marcela" },
    });
    fireEvent.click(await within(dialog).findByText("Marcela Ruiz"));
    fireEvent.click(within(dialog).getByRole("button", { name: /vincular a marcela ruiz/i }));

    expect(await within(dialog).findByText(/no fue posible completar la vinculación/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Issue #505: the row's single "Editar" trigger used to be the only entry
// point into ficha médica (behind an internal "Ficha médica" toggle inside
// the account dialog's "Estudiantes a cargo" section) AND pagos/membresía
// (the create/register/regularizar/suspender/cambiar-plan block in that same
// section) — both reachable only after opening the generic account dialog
// first. "Ficha médica" and "Pagos" are now their own direct entry points,
// each reaching its flow with no intermediate dialog. `Editar` itself is
// untouched — it still opens the full account dialog with roles, estado,
// datos personales and "Estudiantes a cargo", exactly as before.
// ---------------------------------------------------------------------------

describe("MembersPage — direct Ficha médica and Pagos entry points (issue #505)", () => {
  beforeEach(() => {
    mockFetchMembers.mockReset().mockResolvedValue({ accounts: [ACCOUNT] });
    mockFetchFichaMedica.mockReset().mockResolvedValue({
      tipoSangre: "DESCONOCIDO",
      enfermedades: [],
      alergias: null,
      contactoEmergencia: null,
      telefonoEmergencia: null,
    });
    mockFetchTiposMembresia.mockReset().mockResolvedValue([]);
    mockObtenerRolesDePersona.mockReset().mockResolvedValue({ roles: [], activo: true });
  });

  function getRowButton(container: HTMLElement, name: RegExp): HTMLElement {
    return within(container).getAllByRole("button", { name })[0];
  }

  it("gives each rendering exactly one Ficha médica and one Pagos trigger, alongside Editar", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();
    const card = await findAccountCard();

    for (const container of [row, card]) {
      expect(within(container).getAllByRole("button", { name: /^editar/i })).toHaveLength(1);
      expect(within(container).getAllByRole("button", { name: /^ficha médica/i })).toHaveLength(1);
      expect(within(container).getAllByRole("button", { name: /^pagos/i })).toHaveLength(1);
    }
  });

  it("names each trigger after the account holder, matching Editar's own aria-label convention", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();

    expect(getRowButton(row, /^ficha médica/i)).toHaveAccessibleName("Ficha médica de María González");
    expect(getRowButton(row, /^pagos/i)).toHaveAccessibleName("Pagos de María González");
  });

  it("matches Editar's touch target size on both new triggers", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();
    const editar = getRowButton(row, /^editar/i);
    const ficha = getRowButton(row, /^ficha médica/i);
    const pagos = getRowButton(row, /^pagos/i);

    // `Button size="sm"` — the same in-table control height (`h-ctl-sm`) the
    // audit already granted `EditAccountButton`.
    expect(ficha.className).toContain("h-ctl-sm");
    expect(pagos.className).toContain("h-ctl-sm");
    expect(editar.className).toContain("h-ctl-sm");
  });

  it("opens the ficha médica editor directly from the row, with no generic dialog in between", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();

    fireEvent.click(getRowButton(row, /^ficha médica/i));

    const dialog = await screen.findByRole("dialog");
    // No role checkboxes and no "Roles" heading — this is not MemberEditDialog.
    expect(within(dialog).queryByRole("checkbox")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Roles")).not.toBeInTheDocument();
    await waitFor(() => expect(mockFetchFichaMedica).toHaveBeenCalledWith(10));
    expect(within(dialog).getByText(/ficha médica de sofía gonzález/i)).toBeInTheDocument();
  });

  it("opens the pagos/membresía flow directly from the row, with no roles/estado controls present", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();

    fireEvent.click(getRowButton(row, /^pagos/i));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("checkbox")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Roles")).not.toBeInTheDocument();
    expect(await within(dialog).findByRole("button", { name: /crear membresía/i })).toBeInTheDocument();
  });

  it("keeps Editar itself unchanged: still opens the full account dialog with roles and estudiantes", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();

    fireEvent.click(getRowButton(row, /^editar/i));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Estudiantes a cargo")).toBeInTheDocument();
    expect(within(dialog).getByRole("checkbox", { name: /admin/i })).toBeInTheDocument();
  });

  it("only one row dialog is open at a time: Pagos closes an already-open Ficha médica dialog for the same row", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();

    fireEvent.click(getRowButton(row, /^ficha médica/i));
    await screen.findByRole("dialog");

    fireEvent.click(getRowButton(row, /^pagos/i));

    const dialogs = await screen.findAllByRole("dialog");
    expect(dialogs).toHaveLength(1);
    expect(await within(dialogs[0]).findByRole("button", { name: /crear membresía/i })).toBeInTheDocument();
  });

  it("returns focus to the Ficha médica trigger when its dialog closes", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();
    const trigger = getRowButton(row, /^ficha médica/i);

    fireEvent.click(trigger);
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Cerrar ventana" }));

    expect(document.activeElement).toBe(trigger);
  });

  it("returns focus to the Pagos trigger when its dialog closes", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();
    const trigger = getRowButton(row, /^pagos/i);

    fireEvent.click(trigger);
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Cerrar ventana" }));

    expect(document.activeElement).toBe(trigger);
  });

  it("closes the Pagos dialog on Escape, same as the account dialog", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();
    fireEvent.click(getRowButton(row, /^pagos/i));
    await screen.findByRole("dialog");

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
