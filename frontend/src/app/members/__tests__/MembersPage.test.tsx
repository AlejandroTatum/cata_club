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
const mockFetchNotificaciones = vi.fn().mockResolvedValue([]);
const mockMarcarNotificacionLeida = vi.fn().mockResolvedValue(undefined);

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
    fetchNotificaciones: () => mockFetchNotificaciones(),
    marcarNotificacionLeida: (id: number) => mockMarcarNotificacionLeida(id),
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

  it("shows contact, student count and membership on the phone card instead of hiding them", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const card = await findAccountCard();

    // The audit's finding: below `sm` these were all `hidden sm:table-cell`.
    expect(within(card).getByText(ACCOUNT.telefono)).toBeInTheDocument();
    expect(within(card).getByText(String(ACCOUNT.estudiantes.length))).toBeInTheDocument();
    expect(within(card).getByText(/activo|sin membresía|vencida|pendiente/i)).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Visual system: table column set/alignment, DataRow/DataBox adoption.
  // -------------------------------------------------------------------------

  it("drops the Contacto column and keeps Responsable de pago / Estudiantes / Membresía / Editar", async () => {
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
    expect(headers[0]).toBe("Responsable de pago");
  });

  it("right-aligns the Estudiantes column (header and body alike) and boxes the count", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();
    const table = row.closest("table") as HTMLElement;
    const header = within(table).getByRole("columnheader", { name: "Estudiantes" });
    expect(header.className).toContain("text-right");

    const countText = within(row).getByText(String(ACCOUNT.estudiantes.length));
    // `TableCell type="number"` boxes the value in a numeric `DataBox`.
    expect(countText.closest("span")?.className).toContain("font-mono");
    expect(countText.closest("td")?.className).toContain("text-right");
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
      "El servidor no pudo completar la operación. Intente nuevamente en unos minutos.",
    );
  });

  it("selecting a role in the modal fires asignarRol, same as the old popover", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();

    const dialog = await openModalAndWaitForRoles(row);
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /admin/i }));

    await waitFor(() => {
      expect(mockAsignarRol).toHaveBeenCalledWith(1, "ADMINISTRADOR");
    });
  });

  it("deselecting an already-selected role fires quitarRol", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();

    const dialog = await openModalAndWaitForRoles(row);
    const adminCheckbox = within(dialog).getByRole("checkbox", { name: /admin/i });

    fireEvent.click(adminCheckbox);
    await waitFor(() => expect(mockAsignarRol).toHaveBeenCalledWith(1, "ADMINISTRADOR"));

    fireEvent.click(adminCheckbox);
    await waitFor(() => {
      expect(mockQuitarRol).toHaveBeenCalledWith(1, "ADMINISTRADOR");
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
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /admin/i }));

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

    // First click assigns (default mockAsignarRol success) so the checkbox
    // is checked before we exercise the removal-reconciliation branch.
    fireEvent.click(adminCheckbox);
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
    fireEvent.click(adminCheckbox);

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

    fireEvent.click(adminCheckbox);
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
    fireEvent.click(adminCheckbox);

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
        "No pudimos conectar con el servidor. Revise su conexión e intente nuevamente.",
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
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No pudimos conectar con el servidor. Revise su conexión e intente nuevamente.",
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
      descuentos?: DescuentoCatalogo[];
      registrarPagoRejects?: Error;
    } = {},
  ): Promise<HTMLElement> {
    const cuentaConMembresia: MemberAccount = {
      ...ACCOUNT,
      estudiantes: [{ ...ACCOUNT.estudiantes[0], membresia: options.membresia ?? MEMBRESIA_VENCIDA }],
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
      monto: 85,
      tipoPago: "TRANSFERENCIA",
    });
    await waitFor(() => {
      expect(within(dialog).getByText(/pago registrado/i)).toBeInTheDocument();
    });
  });

  it("offers active discounts, previews the final amount and submits descuentoIds (issue #12)", async () => {
    const dialog = await openMemberDialog({
      descuentos: [
        { id: 1, nombre: "Media beca", porcentaje: "50", monto: null, activo: true },
        { id: 2, nombre: "Beca vieja", porcentaje: "100", monto: null, activo: false },
      ],
    });
    await openPaymentForm(dialog);

    // Only ACTIVE discounts are offered for application; the inactive one
    // stays visible in the catalog screen but never here.
    const mediaBeca = await within(dialog).findByRole("radio", { name: /media beca/i });
    expect(within(dialog).queryByRole("radio", { name: /beca vieja/i })).not.toBeInTheDocument();

    fireEvent.click(mediaBeca);

    // Client-side DISPLAY preview: 85 − 50 % = 42.50 (backend recomputes).
    expect(await within(dialog).findByText(/monto final/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/42,50/)).toBeInTheDocument();

    submitPaymentWithVoucher(dialog);

    await waitFor(() => {
      expect(mockRegistrarPago).toHaveBeenCalledTimes(1);
    });
    // `monto` stays the BASE amount: the backend freezes catalog values and
    // computes the final amount itself.
    expect(mockRegistrarPago.mock.calls[0][0]).toMatchObject({
      monto: 85,
      descuentoIds: [1],
    });
  });

  it("omits descuentoIds when no discount is selected", async () => {
    const dialog = await openMemberDialog({
      descuentos: [{ id: 1, nombre: "Media beca", porcentaje: "50", monto: null, activo: true }],
    });
    await openPaymentForm(dialog);
    await within(dialog).findByRole("radio", { name: /media beca/i });

    // "Sin descuento" is the default selection — a payment with no discount
    // is the normal case and must stay reachable without touching any radio.
    expect(within(dialog).getByRole("radio", { name: /sin descuento/i })).toBeChecked();

    submitPaymentWithVoucher(dialog);

    await waitFor(() => {
      expect(mockRegistrarPago).toHaveBeenCalledTimes(1);
    });
    expect("descuentoIds" in (mockRegistrarPago.mock.calls[0][0] as Record<string, unknown>)).toBe(false);
  });

  it("only allows one discount selected at a time (regression: backend rejects more than one)", async () => {
    const dialog = await openMemberDialog({
      descuentos: [
        { id: 1, nombre: "Beca parcial", porcentaje: "30", monto: null, activo: true },
        { id: 2, nombre: "Familiar", porcentaje: "20", monto: null, activo: true },
      ],
    });
    await openPaymentForm(dialog);

    const becaParcial = await within(dialog).findByRole("radio", { name: /beca parcial/i });
    const familiar = within(dialog).getByRole("radio", { name: /^familiar/i });
    const sinDescuento = within(dialog).getByRole("radio", { name: /sin descuento/i });

    // Picking a discount is mutually exclusive with the others — there is no
    // way, through this UI, to have two selected at once.
    fireEvent.click(becaParcial);
    expect(becaParcial).toBeChecked();
    expect(familiar).not.toBeChecked();
    expect(sinDescuento).not.toBeChecked();

    fireEvent.click(familiar);
    expect(familiar).toBeChecked();
    expect(becaParcial).not.toBeChecked();
    expect(sinDescuento).not.toBeChecked();

    submitPaymentWithVoucher(dialog);

    await waitFor(() => {
      expect(mockRegistrarPago).toHaveBeenCalledTimes(1);
    });
    // Exactly one id travels — never both.
    expect(mockRegistrarPago.mock.calls[0][0]).toMatchObject({ descuentoIds: [2] });
  });

  it("surfaces the backend cap-exceeded 400 as a normal form error", async () => {
    const { ApiClientError } = await import("@/services/api");
    const dialog = await openMemberDialog({
      // A single FIXED discount larger than the base amount is enough to hit
      // the backend's 100% cap — the old two-checkbox setup that summed two
      // discounts no longer applies now that only one can be selected.
      descuentos: [{ id: 1, nombre: "Beca completa+", porcentaje: null, monto: "200", activo: true }],
      registrarPagoRejects: new ApiClientError("El descuento total no puede superar el 100% del monto", 400),
    });
    await openPaymentForm(dialog);

    fireEvent.click(await within(dialog).findByRole("radio", { name: /beca completa\+/i }));
    submitPaymentWithVoucher(dialog);

    expect(
      await within(dialog).findByText("El descuento total no puede superar el 100% del monto"),
    ).toBeInTheDocument();
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
});

describe("MembersPage — capped results help", () => {
  it("opens named help that truthfully describes the known 200-result cap", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    await findAccountRow();

    fireEvent.click(screen.getByRole("button", { name: "Ayuda sobre límite de resultados" }));

    const help = screen.getByRole("region", { name: "Ayuda sobre límite de resultados" });
    expect(help).toHaveTextContent("hasta 200 registros");
    expect(help).toHaveTextContent("no confirma que se hayan cargado todos los miembros");
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

    expect(await screen.findByRole("status", { name: "Resultados mostrados" })).toHaveTextContent(
      "1 resultados mostrados",
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

  it("names the players the account actually holds", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();

    // The row carries the dependants by name, so the cell spends the width on
    // saying WHO instead of repeating the payer type on all 45 rows.
    expect(within(row).getByText("Representante de Sofía González")).toBeInTheDocument();
  });

  it("says nothing about the role of an account that holds nobody but itself", async () => {
    // The adapter hands a childless root persona ITSELF as its only student.
    mockFetchMembers.mockReset().mockResolvedValue({
      accounts: [
        {
          ...ACCOUNT,
          id: "7",
          estudiantes: [{ ...ACCOUNT.estudiantes[0], id: "7", nombres: "María", apellidos: "González" }],
        },
      ],
    });

    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();

    // It used to read a boxed "Representante" here, and the word was a
    // constant: `lib/server/members-adapter.ts:173` stamps
    // `role: "representante" as const` on every root account. With no dependant
    // to prove the relationship the row has nothing left to say about who this
    // person is, so the cell draws the name and stops. The account's real roles
    // are read one account at a time, in the edit dialog.
    expect(within(row).getByText("María González")).toBeInTheDocument();
    expect(within(row).queryByText(/Representante/)).not.toBeInTheDocument();
  });

  it("says the same thing on the phone rendering as in the table", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const card = await findAccountCard();

    // Two renderings of one account that disagree about who that account is
    // are two bugs waiting for someone to resize a window.
    expect(within(card).getByText("Representante de Sofía González")).toBeInTheDocument();
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
      within(panel).getByRole("button", { name: "Ayuda sobre límite de resultados" }),
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
      within(panel).getByRole("button", { name: "Ayuda sobre límite de resultados" }),
    ).toBeInTheDocument();
  });

  it("does not repeat the subtitle it sits under", async () => {
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    await findAccountRow();

    fireEvent.click(screen.getByRole("button", { name: "Ayuda sobre límite de resultados" }));
    const help = screen.getByRole("region", { name: "Ayuda sobre límite de resultados" });
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
