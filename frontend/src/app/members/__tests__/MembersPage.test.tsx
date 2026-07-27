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
import type { MemberAccount } from "@/app/members/members-utils";
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
      grupoId: null,
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
    mockFetchMembers.mockResolvedValue({ accounts: [ACCOUNT], niveles: [] });
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
      niveles: [],
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
    mockActualizarPersona.mockRejectedValueOnce(new Error("No se pudo actualizar"));
    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();

    fireEvent.click(getEditButton(row));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /guardar nombre, apellido y teléfono/i }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("No se pudo actualizar");
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
    mockAsignarRol.mockRejectedValueOnce(new Error("Esta persona ya tiene el rol ADMINISTRADOR"));
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

    mockQuitarRol.mockRejectedValueOnce(new Error("Esta persona no tiene el rol ADMINISTRADOR"));
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

    const refusal =
      "No se puede quitar el rol ADMINISTRADOR: es el último administrador activo del sistema";
    mockQuitarRol.mockRejectedValueOnce(new Error(refusal));
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
    mockObtenerRolesDePersona.mockRejectedValue(new Error("No se pudo conectar"));
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
      expect(alert).toHaveTextContent("No se pudo conectar");
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
    mockAsignarRol.mockRejectedValueOnce(new Error("Error de red"));
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
    expect(await screen.findByRole("alert")).toHaveTextContent("Error de red");

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
    mockFetchMembers.mockResolvedValue({ accounts: createAccounts(2), niveles: [] });
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
    mockFetchMembers.mockResolvedValue({ accounts: [ACCOUNT], niveles: [] });
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
  });

  it("renders a 'Registrar pago' button inside the student card when the student has a membership", async () => {
    const cuentaConMembresia: MemberAccount = {
      ...ACCOUNT,
      estudiantes: [
        {
          ...ACCOUNT.estudiantes[0],
          membresia: {
            tipo: "Mensual (Tarde)",
            estado: "activa",
            fechaInicio: "2026-07-01",
            fechaFin: "2026-07-31",
            monto: 85,
            id: 42,
          },
        },
      ],
    };
    mockFetchMembers.mockResolvedValue({ accounts: [cuentaConMembresia], niveles: [] });

    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();
    fireEvent.click(getEditButton(row));

    const dialog = screen.getByRole("dialog");
    const registrarBtn = await within(dialog).findByRole("button", { name: /registrar pago/i });
    expect(registrarBtn).toBeInTheDocument();
  });

  it("opens the payment form with monto/tipo/fechas, calls registrarPago on submit, shows success", async () => {
    const cuentaConMembresia: MemberAccount = {
      ...ACCOUNT,
      estudiantes: [
        {
          ...ACCOUNT.estudiantes[0],
          membresia: {
            tipo: "Mensual (Tarde)",
            estado: "vencida",
            fechaInicio: "2026-06-01",
            fechaFin: "2026-06-30",
            monto: 85,
            id: 42,
          },
        },
      ],
    };
    mockFetchMembers.mockResolvedValue({ accounts: [cuentaConMembresia], niveles: [] });
    mockRegistrarPago.mockResolvedValueOnce({ id: 99, estadoPago: "PENDIENTE_VALIDACION" });

    render(
      <ToastProvider>
        <MembersPage />
      </ToastProvider>,
    );
    const row = await findAccountRow();
    fireEvent.click(getEditButton(row));

    const dialog = screen.getByRole("dialog");
    const registrarBtn = await within(dialog).findByRole("button", { name: /registrar pago/i });
    fireEvent.click(registrarBtn);

    const montoInput = await within(dialog).findByDisplayValue("85");
    expect(montoInput).toBeInTheDocument();
    expect(await within(dialog).findByText(/Inicio:/)).toBeInTheDocument();
    expect(await within(dialog).findByText(/Fin:/)).toBeInTheDocument();

    // Switch payment method to EFECTIVO so no voucher is required
    const metodoSelect = within(dialog).getByDisplayValue("Transferencia");
    fireEvent.change(metodoSelect, { target: { value: "EFECTIVO" } });

    const submitBtn = within(dialog).getByRole("button", { name: /registrar pago/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockRegistrarPago).toHaveBeenCalledTimes(1);
    });
    expect(mockRegistrarPago.mock.calls[0][0]).toMatchObject({
      personaId: 10,
      membresiaId: 42,
      monto: 85,
    });
    await waitFor(() => {
      expect(within(dialog).getByText(/pago registrado/i)).toBeInTheDocument();
    });
  });

  it("does NOT render a 'Registrar pago' button when the student has no membership", async () => {
    mockFetchMembers.mockResolvedValue({ accounts: [ACCOUNT], niveles: [] });

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
    mockFetchMembers.mockResolvedValue({ accounts: [ACCOUNT], niveles: [], personasCapped: true });

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
    mockFetchMembers.mockResolvedValue({ accounts: createAccounts(199), niveles: [], personasCapped: false });

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
    mockFetchMembers.mockReset().mockResolvedValue({ accounts: [ACCOUNT], niveles: [] });
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
    expect(label.className).toContain("focus-within:shadow-[0_0_0_4px_#131316]");
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
      return { accounts: [ACCOUNT], niveles: [] };
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
    mockFetchMembers.mockReset().mockResolvedValue({ accounts: [ACCOUNT], niveles: [] });
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
