/**
 * Component tests for DiscountsPage — the admin discount-catalog screen
 * (issue #12): list active + inactive, create, edit, soft toggle. There is
 * no delete: deactivating is the only removal, so history keeps its FK.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import DiscountsPage from "@/app/discounts/page";
import type { DescuentoCatalogo } from "@/services/api";
import { ToastProvider } from "@/contexts/ToastContext";
import { PAGE_RAIL } from "@/components/ui";

vi.mock("@/components/ProtectedRoute", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// AppShell renders NotificationBell + needs next/navigation, next/link,
// next/image, AuthContext — same minimal mock pattern as GroupsPage.test.tsx.
vi.mock("next/navigation", () => ({
  usePathname: () => "/discounts",
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
  useAuth: () => ({
    session: {
      user: { id: "u1", name: "Admin Test", email: "admin@cataclub.com", role: "admin", representanteId: null },
      roles: ["ADMINISTRADOR"],
      loggedInAt: "2026-07-01T12:00:00Z",
    },
    isAuthenticated: true,
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

const mockFetchDescuentos = vi.fn();
const mockCrearDescuento = vi.fn();
const mockActualizarDescuento = vi.fn();
const mockEliminarDescuento = vi.fn();
const mockFetchNotificaciones = vi.fn().mockResolvedValue({ items: [], total: 0, skip: 0, limit: 20 });
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
    fetchDescuentos: () => mockFetchDescuentos(),
    crearDescuento: (data: unknown) => mockCrearDescuento(data),
    actualizarDescuento: (id: number, data: unknown) => mockActualizarDescuento(id, data),
    eliminarDescuento: (id: number) => mockEliminarDescuento(id),
    fetchNotificaciones: () => mockFetchNotificaciones(),
    marcarNotificacionLeida: (id: number) => mockMarcarNotificacionLeida(id),
    ApiClientError: MockApiClientError,
  };
});

const BECA: DescuentoCatalogo = {
  id: 1,
  nombre: "Beca municipal",
  porcentaje: "100",
  monto: null,
  activo: true,
  enUso: true,
};

/** Never applied or assigned: the only kind that may be deleted. */
const PROMO: DescuentoCatalogo = {
  id: 3,
  nombre: "Promo por error",
  porcentaje: "5",
  monto: null,
  activo: true,
  enUso: false,
};

const CONVENIO: DescuentoCatalogo = {
  id: 2,
  nombre: "Convenio empresa",
  porcentaje: null,
  monto: "10.00",
  activo: false,
  enUso: true,
};

function renderPage(): void {
  render(
    <ToastProvider>
      <DiscountsPage />
    </ToastProvider>,
  );
}

/**
 * The discount's table row (`sm` and up). Below `sm` the same discount is
 * rendered again as a card (issue #339) — the four-column table cannot fit a
 * phone, same reason `/members` reflows its own list. jsdom applies no real
 * CSS, so both renderings are in the document here; this helper picks the
 * row, mirroring `findAccountRow` in MembersPage.test.tsx.
 */
async function findDescuentoRow(nombre: string): Promise<HTMLElement> {
  const matches = await screen.findAllByText(nombre);
  const row = matches.map((el) => el.closest("li")).find(Boolean);
  return row as HTMLElement;
}

beforeEach(() => {
  mockFetchDescuentos.mockReset().mockResolvedValue([BECA, CONVENIO]);
  mockCrearDescuento.mockReset();
  mockActualizarDescuento.mockReset();
  mockEliminarDescuento.mockReset();
});

describe("DiscountsPage — listado", () => {
  it("lists active and inactive discounts, visually distinct", async () => {
    renderPage();

    const becaRow = await findDescuentoRow("Beca municipal");
    const convenioRow = await findDescuentoRow("Convenio empresa");

    expect(within(becaRow).getByText("Activo")).toBeInTheDocument();
    expect(within(becaRow).getByText("100 %")).toBeInTheDocument();
    expect(within(convenioRow).getByText("Oculta")).toBeInTheDocument();
    expect(convenioRow).toHaveAttribute("data-inactivo", "true");
    expect(becaRow).not.toHaveAttribute("data-inactivo", "true");
  });

  it("shows the empty state when the catalog has no discounts", async () => {
    mockFetchDescuentos.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(/sin descuentos/i)).toBeInTheDocument();
  });

  it("explains the discount types while the catalog is empty", async () => {
    mockFetchDescuentos.mockResolvedValue([]);
    renderPage();
    const types = await screen.findByTestId("discounts-types");
    expect(within(types).getByRole("heading", { name: "Porcentaje" })).toBeInTheDocument();
    expect(within(types).getByRole("heading", { name: "Monto fijo" })).toBeInTheDocument();
  });

  it("continues a short catalog with the types explainer in the main column", async () => {
    renderPage();
    await findDescuentoRow("Beca municipal");
    const types = screen.getByTestId("discounts-types");
    expect(within(screen.getByTestId("discounts-rail")).queryByTestId("discounts-types")).not.toBeInTheDocument();
    expect(within(types).getByRole("heading", { name: "Porcentaje" })).toBeInTheDocument();
  });

  it("drops the types explainer once the catalog has four entries", async () => {
    mockFetchDescuentos.mockResolvedValue([
      BECA,
      CONVENIO,
      { ...BECA, id: 11, nombre: "Tercero" },
      { ...BECA, id: 12, nombre: "Cuarto" },
    ]);
    renderPage();
    await findDescuentoRow("Cuarto");
    expect(screen.queryByTestId("discounts-types")).not.toBeInTheDocument();
  });

  it("keeps a single primary action to create the first discount", async () => {
    // Issue #199: the header's "Nuevo descuento" and the empty state's own
    // action used to share the exact same label, reading as two competing
    // ways to do the same thing. The header action stays the one generic
    // control; the empty state's is worded for the first-discount moment,
    // same distinction Groups already draws between "Nueva categoría" and
    // "Crear primera categoría".
    mockFetchDescuentos.mockResolvedValue([]);
    renderPage();
    await screen.findByText(/sin descuentos/i);

    expect(screen.getAllByRole("button", { name: /^nuevo descuento$/i })).toHaveLength(1);
    expect(screen.getByRole("button", { name: /crear primer descuento/i })).toBeInTheDocument();
  });

  it("shows an error state with retry when loading fails", async () => {
    mockFetchDescuentos.mockRejectedValueOnce(new Error("caído"));
    renderPage();

    const retry = await screen.findByRole("button", { name: /reintentar/i });
    mockFetchDescuentos.mockResolvedValue([BECA]);
    fireEvent.click(retry);

    expect((await screen.findAllByText("Beca municipal")).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Search — issue A3: the catalog mixes real discounts with QA noise and had
// no way to narrow it, unlike /members and /payments.
// ---------------------------------------------------------------------------

describe("DiscountsPage — búsqueda", () => {
  it("has an accessible search field, consistent with /members", async () => {
    renderPage();
    await screen.findByTestId("discounts-cards");

    expect(screen.getByLabelText("Buscar descuentos")).toBeInTheDocument();
  });

  it("narrows the list to discounts whose name matches the typed term", async () => {
    renderPage();
    await screen.findByTestId("discounts-cards");

    fireEvent.change(screen.getByLabelText("Buscar descuentos"), {
      target: { value: "beca" },
    });

    expect(screen.getAllByText("Beca municipal").length).toBeGreaterThan(0);
    expect(screen.queryByText("Convenio empresa")).not.toBeInTheDocument();
  });

  it("restores the full list when the search term is cleared", async () => {
    renderPage();
    await screen.findByTestId("discounts-cards");

    const search = screen.getByLabelText("Buscar descuentos");
    fireEvent.change(search, { target: { value: "beca" } });
    expect(screen.queryByText("Convenio empresa")).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "" } });

    expect(screen.getAllByText("Beca municipal").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Convenio empresa").length).toBeGreaterThan(0);
  });

  it("shows the no-results empty state when nothing matches the search", async () => {
    renderPage();
    await screen.findByTestId("discounts-cards");

    fireEvent.change(screen.getByLabelText("Buscar descuentos"), {
      target: { value: "nadie con este nombre" },
    });

    expect(await screen.findByText("No se encontraron descuentos")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("clears the search from the no-results empty state action", async () => {
    renderPage();
    await screen.findByTestId("discounts-cards");

    fireEvent.change(screen.getByLabelText("Buscar descuentos"), {
      target: { value: "nadie con este nombre" },
    });
    await screen.findByText("No se encontraron descuentos");

    fireEvent.click(screen.getByRole("button", { name: /limpiar búsqueda/i }));

    expect(await screen.findByTestId("discounts-cards")).toBeInTheDocument();
    expect((screen.getByLabelText("Buscar descuentos") as HTMLInputElement).value).toBe("");
  });
});

describe("DiscountsPage — crear", () => {
  it("creates a percentage discount from the form", async () => {
    mockCrearDescuento.mockResolvedValueOnce({ ...BECA, id: 3, nombre: "Media beca", porcentaje: "50" });
    renderPage();
    await screen.findByTestId("discounts-cards");

    fireEvent.click(screen.getByRole("button", { name: /nuevo descuento/i }));
    expect(screen.getByLabelText(/^Nombre/)).toBeRequired();
    expect(screen.getByLabelText(/^Tipo\b(?!s)/)).toBeRequired();
    expect(screen.getByLabelText(/^Valor/)).toBeRequired();
    fireEvent.change(screen.getByLabelText(/nombre/i), { target: { value: "Media beca" } });
    fireEvent.change(screen.getByLabelText(/valor/i), { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: /^crear$/i }));

    await waitFor(() => {
      expect(mockCrearDescuento).toHaveBeenCalledWith({ nombre: "Media beca", porcentaje: 50, monto: null });
    });
    // The list reloads after a successful create.
    expect(mockFetchDescuentos).toHaveBeenCalledTimes(2);
  });

  it("creates a fixed-amount discount when the modality is switched", async () => {
    mockCrearDescuento.mockResolvedValueOnce({ ...CONVENIO, id: 4, nombre: "Convenio dos", activo: true });
    renderPage();
    await screen.findByTestId("discounts-cards");

    fireEvent.click(screen.getByRole("button", { name: /nuevo descuento/i }));
    fireEvent.change(screen.getByLabelText(/nombre/i), { target: { value: "Convenio dos" } });
    fireEvent.change(screen.getByLabelText(/^tipo\b(?!s)/i), { target: { value: "MONTO" } });
    fireEvent.change(screen.getByLabelText(/valor/i), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: /^crear$/i }));

    await waitFor(() => {
      expect(mockCrearDescuento).toHaveBeenCalledWith({ nombre: "Convenio dos", porcentaje: null, monto: 10 });
    });
  });

  /**
   * Issue #667: PORCENTAJE already had a business ceiling (100 — enforced
   * both by the `max` HTML attribute and by `handleSubmit`'s own check just
   * below it). MONTO had neither: `max={... : undefined}` left the native
   * spinner unbounded, and `handleSubmit` only checked `valor > 0`. This
   * gives MONTO the same "límites de negocio" ceiling `AMOUNT_MAX_VALUE`
   * (numeric-input.ts) already applies to `/tarifas`'s precio field.
   */
  it("carries a max attribute on the MONTO branch, matching the amount business ceiling", async () => {
    renderPage();
    await screen.findByTestId("discounts-cards");

    fireEvent.click(screen.getByRole("button", { name: /nuevo descuento/i }));
    fireEvent.change(screen.getByLabelText(/^tipo\b(?!s)/i), { target: { value: "MONTO" } });

    expect(screen.getByLabelText(/valor/i)).toHaveAttribute("max", "999999.99");
  });

  it("refuses to save a MONTO value over the business ceiling", async () => {
    renderPage();
    await screen.findByTestId("discounts-cards");

    fireEvent.click(screen.getByRole("button", { name: /nuevo descuento/i }));
    fireEvent.change(screen.getByLabelText(/nombre/i), { target: { value: "Convenio grande" } });
    fireEvent.change(screen.getByLabelText(/^tipo\b(?!s)/i), { target: { value: "MONTO" } });
    fireEvent.change(screen.getByLabelText(/valor/i), { target: { value: "1000000" } });
    fireEvent.click(screen.getByRole("button", { name: /^crear$/i }));

    expect(await screen.findByText(/no puede superar/i)).toBeInTheDocument();
    expect(mockCrearDescuento).not.toHaveBeenCalled();
  });

  it("surfaces a backend 400 (duplicate name) as a form error", async () => {
    const { ApiClientError } = await import("@/services/api");
    mockCrearDescuento.mockRejectedValueOnce(new ApiClientError("Ya existe un descuento con ese nombre", 400));
    renderPage();
    await screen.findByTestId("discounts-cards");

    fireEvent.click(screen.getByRole("button", { name: /nuevo descuento/i }));
    fireEvent.change(screen.getByLabelText(/nombre/i), { target: { value: "Beca municipal" } });
    fireEvent.change(screen.getByLabelText(/valor/i), { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: /^crear$/i }));

    expect(await screen.findByText("Ya existe un descuento con ese nombre")).toBeInTheDocument();
    // The form stays open so the admin can correct the name.
    expect(screen.getByLabelText(/nombre/i)).toBeInTheDocument();
  });

  it("validates locally that the value is positive before calling the API", async () => {
    renderPage();
    await screen.findByTestId("discounts-cards");

    fireEvent.click(screen.getByRole("button", { name: /nuevo descuento/i }));
    fireEvent.change(screen.getByLabelText(/nombre/i), { target: { value: "Inválido" } });
    fireEvent.click(screen.getByRole("button", { name: /^crear$/i }));

    expect(await screen.findByText(/mayor a 0/i)).toBeInTheDocument();
    expect(mockCrearDescuento).not.toHaveBeenCalled();
  });

  // Issue #314 (K6 hallazgo #34): a 521-char paste used to enter an
  // uncontrolled `maxLength={100}` input, get silently clipped to 100 chars
  // by the DOM, and save under a green "Descuento creado correctamente."
  // toast — no counter, no color change, no warning anywhere. The field no
  // longer truncates: it keeps the full pasted value, shows a live counter,
  // and `handleSubmit` refuses to save until it fits.
  it("keeps the full pasted name instead of silently clipping it at 100 chars", async () => {
    renderPage();
    await screen.findByTestId("discounts-cards");
    fireEvent.click(screen.getByRole("button", { name: /nuevo descuento/i }));

    const nombreInput = screen.getByLabelText(/nombre/i) as HTMLInputElement;
    const largo = "X".repeat(521);
    fireEvent.change(nombreInput, { target: { value: largo } });

    expect(nombreInput.value).toHaveLength(521);
    expect(nombreInput).not.toHaveAttribute("maxLength");
    expect(screen.getByText(/521\/100/)).toBeInTheDocument();
  });

  it("refuses to save a name over 100 characters instead of truncating it silently", async () => {
    renderPage();
    await screen.findByTestId("discounts-cards");
    fireEvent.click(screen.getByRole("button", { name: /nuevo descuento/i }));

    fireEvent.change(screen.getByLabelText(/nombre/i), { target: { value: "X".repeat(521) } });
    fireEvent.change(screen.getByLabelText(/valor/i), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: /^crear$/i }));

    expect(await screen.findByText(/no puede superar los 100 caracteres/i)).toBeInTheDocument();
    expect(mockCrearDescuento).not.toHaveBeenCalled();
  });
});

describe("DiscountsPage — editar", () => {
  it("edits a discount pre-filling its current values", async () => {
    mockActualizarDescuento.mockResolvedValueOnce({ ...BECA, porcentaje: "75" });
    renderPage();

    const becaRow = await findDescuentoRow("Beca municipal");
    fireEvent.click(within(becaRow).getByRole("button", { name: /editar/i }));

    const nombreInput = screen.getByLabelText(/nombre/i) as HTMLInputElement;
    expect(nombreInput.value).toBe("Beca municipal");

    fireEvent.change(screen.getByLabelText(/valor/i), { target: { value: "75" } });
    fireEvent.click(screen.getByRole("button", { name: /^guardar$/i }));

    await waitFor(() => {
      expect(mockActualizarDescuento).toHaveBeenCalledWith(1, {
        nombre: "Beca municipal",
        porcentaje: 75,
        monto: null,
      });
    });
  });
});

describe("DiscountsPage — baja y reactivación suaves", () => {
  // Issue #314 (K6 hallazgo #14): this used to be the false lock — a single
  // click on "Desactivar" fired the PATCH immediately, asserting the very
  // bug the audit found as if it were correct behavior. "Desactivar" now
  // opens a confirmation naming the discount before anything mutates;
  // "Reactivar" is unaffected (reversible, stays one click) — see below.
  it("opens a confirmation naming the discount on 'Ocultar' click, without mutating yet", async () => {
    renderPage();

    const becaRow = await findDescuentoRow("Beca municipal");
    fireEvent.click(within(becaRow).getByRole("button", { name: /^ocultar$/i }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/beca municipal/i)).toBeInTheDocument();
    expect(mockActualizarDescuento).not.toHaveBeenCalled();
  });

  it("tells the reader the discount stays in the list to reactivate (#315 hallazgo #40)", async () => {
    // The consequence is stated at the one moment the admin is guaranteed to read something —
    // the confirmation the click itself opens.
    renderPage();

    const becaRow = await findDescuentoRow("Beca municipal");
    fireEvent.click(within(becaRow).getByRole("button", { name: /^ocultar$/i }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/volver a mostrarlo/i)).toBeInTheDocument();
  });

  it("deactivates an active discount via PATCH activo:false only after confirming", async () => {
    mockActualizarDescuento.mockResolvedValueOnce({ ...BECA, activo: false });
    renderPage();

    const becaRow = await findDescuentoRow("Beca municipal");
    fireEvent.click(within(becaRow).getByRole("button", { name: /^ocultar$/i }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^ocultar$/i }));

    await waitFor(() => {
      expect(mockActualizarDescuento).toHaveBeenCalledWith(1, { activo: false });
    });
  });

  it("leaves the discount untouched when the deactivation confirmation is canceled", async () => {
    renderPage();

    const becaRow = await findDescuentoRow("Beca municipal");
    fireEvent.click(within(becaRow).getByRole("button", { name: /^ocultar$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^cancelar$/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockActualizarDescuento).not.toHaveBeenCalled();
  });

  it("reactivates an inactive discount via PATCH activo:true, with no confirmation step", async () => {
    mockActualizarDescuento.mockResolvedValueOnce({ ...CONVENIO, activo: true });
    renderPage();

    const convenioRow = await findDescuentoRow("Convenio empresa");
    fireEvent.click(within(convenioRow).getByRole("button", { name: /^mostrar$/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(mockActualizarDescuento).toHaveBeenCalledWith(2, { activo: true });
    });
  });
});

// ---------------------------------------------------------------------------
// The rail
// ---------------------------------------------------------------------------

describe("DiscountsPage — la segunda columna", () => {
  it("shows the catalog summary in the rail while no form is open", async () => {
    // The rail is always drawn: a short table on a wide page read as a page
    // that ran out of content, so the resting state holds a summary of the
    // catalog instead of 340px of nothing.
    renderPage();
    await screen.findByTestId("discounts-cards");

    expect(screen.getByTestId("discounts-split").className).toBe(PAGE_RAIL);
    const rail = screen.getByTestId("discounts-rail");
    expect(within(rail).getByRole("heading", { name: /resumen del catálogo/i })).toBeInTheDocument();
    expect(within(rail).getByText("Activos")).toBeInTheDocument();
    expect(within(rail).getByText("Ocultos")).toBeInTheDocument();
  });

  it("shows the create form above the summary when there is one to show", async () => {
    renderPage();
    await screen.findByTestId("discounts-cards");

    fireEvent.click(screen.getByRole("button", { name: /nuevo descuento/i }));

    const rail = screen.getByTestId("discounts-rail");
    expect(within(rail).getByLabelText(/nombre/i)).toBeInTheDocument();
    expect(within(rail).getByText(/resumen del catálogo/i)).toBeInTheDocument();
  });

  it("brings the summary back when the form is dismissed", async () => {
    renderPage();
    await screen.findByTestId("discounts-cards");
    fireEvent.click(screen.getByRole("button", { name: /nuevo descuento/i }));

    fireEvent.click(screen.getByRole("button", { name: /cancelar/i }));

    expect(
      within(screen.getByTestId("discounts-rail")).getByText(/resumen del catálogo/i),
    ).toBeInTheDocument();
  });

  it("draws the catalog as cards with an add-card slot, never as a table", async () => {
    renderPage();
    const cards = await screen.findByTestId("discounts-cards");

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(within(cards).getByRole("button", { name: /agregar descuento/i })).toBeInTheDocument();
    const becaCard = within(cards).getByText("Beca municipal").closest("li") as HTMLElement;
    expect(within(becaCard).getByText("Porcentaje")).toBeInTheDocument();
    const convenioCard = within(cards).getByText("Convenio empresa").closest("li") as HTMLElement;
    expect(within(convenioCard).getByText("Monto fijo")).toBeInTheDocument();
  });

  it("opens the create form from the add-card slot", async () => {
    renderPage();
    const cards = await screen.findByTestId("discounts-cards");

    fireEvent.click(within(cards).getByRole("button", { name: /agregar descuento/i }));

    expect(within(screen.getByTestId("discounts-rail")).getByLabelText(/nombre/i)).toBeInTheDocument();
  });

  it("edits inline inside the card, leaving the rail on its summary", async () => {
    renderPage();
    const becaRow = await findDescuentoRow("Beca municipal");

    fireEvent.click(within(becaRow).getByRole("button", { name: /editar/i }));

    const cards = screen.getByTestId("discounts-cards");
    expect(within(cards).getByLabelText(/nombre/i)).toBeInTheDocument();
    const rail = screen.getByTestId("discounts-rail");
    expect(within(rail).queryByLabelText(/nombre/i)).not.toBeInTheDocument();
    expect(within(rail).getByText(/resumen del catálogo/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// The form's field layout
// ---------------------------------------------------------------------------

describe("DiscountsPage — el formulario de alta/edición", () => {
  it("does not cram Nombre/Tipo/Valor into a three-column grid inside the 340px rail", async () => {
    // The rail is a fixed 340px (PAGE_RAIL). A `sm:grid-cols-3` inside it
    // gives each field ~90px — not enough for "Beca municipal" or
    // "Porcentaje (%)" to render without being cut off. The fields must
    // stack in a single column so each one gets the rail's full width.
    renderPage();
    await screen.findByTestId("discounts-cards");
    fireEvent.click(screen.getByRole("button", { name: /nuevo descuento/i }));

    const nombreLabel = screen.getByLabelText(/nombre/i).closest("label");
    const fieldsContainer = nombreLabel?.parentElement;

    expect(fieldsContainer?.className).not.toMatch(/grid-cols-3/);
  });

  it("gives every field the full input width, so a long name has room to render", async () => {
    renderPage();
    await screen.findByTestId("discounts-cards");
    fireEvent.click(screen.getByRole("button", { name: /nuevo descuento/i }));

    const nombreInput = screen.getByLabelText(/nombre/i);
    fireEvent.change(nombreInput, {
      target: { value: "Beca municipal completa para hijos de socios fundadores" },
    });

    expect((nombreInput as HTMLInputElement).value).toBe(
      "Beca municipal completa para hijos de socios fundadores",
    );
    expect(nombreInput.className).toMatch(/w-full/);
  });
});

// ---------------------------------------------------------------------------
// The empty catalog stops reserving a rail
// ---------------------------------------------------------------------------

describe("DiscountsPage — el catálogo vacío conserva el riel de indicaciones", () => {
  it("keeps the PAGE_RAIL split and the indications card on an empty catalog", async () => {
    mockFetchDescuentos.mockResolvedValue([]);
    renderPage();
    await screen.findByText(/sin descuentos en el catálogo/i);

    expect(screen.getByTestId("discounts-split").className).toBe(PAGE_RAIL);
    const rail = screen.getByTestId("discounts-rail");
    expect(within(rail).getByRole("heading", { name: /cómo funcionan los descuentos/i })).toBeInTheDocument();
    // Types live in their own rail card on an empty catalog, not repeated in the guidance.
    expect(within(rail).getByTestId("discounts-types")).toBeInTheDocument();
    expect(within(rail).queryByText(/porcentaje:/i)).not.toBeInTheDocument();
    expect(within(rail).getByText(/oculto:/i)).toBeInTheDocument();
  });

  it("keeps the indications card while the form is open", async () => {
    mockFetchDescuentos.mockResolvedValue([]);
    renderPage();
    await screen.findByText(/sin descuentos en el catálogo/i);

    fireEvent.click(screen.getByRole("button", { name: /crear primer descuento/i }));

    const rail = screen.getByTestId("discounts-rail");
    expect(within(rail).getByLabelText(/nombre/i)).toBeInTheDocument();
    expect(within(rail).getByRole("heading", { name: /cómo funcionan los descuentos/i })).toBeInTheDocument();
  });

  it("stays compact: ghost example cards instead of a stretched card", async () => {
    mockFetchDescuentos.mockResolvedValue([]);
    renderPage();
    const title = await screen.findByText(/sin descuentos en el catálogo/i);

    const statement = title.parentElement as HTMLElement;
    expect(statement.className).not.toContain("flex-1");
    expect(screen.getAllByText("Ejemplo")).toHaveLength(4);
  });
});

describe("DiscountsPage — el formulario habla el idioma del sistema", () => {
  it("dresses its fields in the control radius, not the retired 8px one", async () => {
    renderPage();
    await screen.findByTestId("discounts-cards");
    fireEvent.click(screen.getByRole("button", { name: /nuevo descuento/i }));

    for (const field of [
      screen.getByLabelText(/nombre/i),
      screen.getByLabelText(/^tipo\b(?!s)/i),
      screen.getByLabelText(/valor/i),
    ]) {
      expect(field.className).toContain("rounded-ctl");
      expect(field.className).toContain("h-ctl");
      expect(field.className).not.toMatch(/\brounded-lg\b/);
      expect(field.className).not.toMatch(/\bcata-(border|surface|text)\b/);
    }
  });

  it("titles its card in the display face, like every other card title", async () => {
    renderPage();
    await screen.findByTestId("discounts-cards");
    fireEvent.click(screen.getByRole("button", { name: /nuevo descuento/i }));

    expect(screen.getByRole("heading", { name: /nuevo descuento/i }).className).toContain(
      "font-display",
    );
  });
});

// ---------------------------------------------------------------------------
// Responsive reflow — issue #339 (blocks release)
//
// The catalog is a card grid at every width (one column on phones), so there
// is no table to overflow sideways; Editar/Ocultar live inside each card.
// ---------------------------------------------------------------------------

describe("DiscountsPage — responsive cards (issue #339)", () => {
  it("carries Editar and Ocultar/Mostrar inside every card", async () => {
    renderPage();

    const cards = await screen.findByTestId("discounts-cards");
    expect(cards.className).not.toContain("overflow-x-auto");

    const becaCard = within(cards).getByText("Beca municipal").closest("li") as HTMLElement;
    expect(within(becaCard).getByRole("button", { name: /^editar/i })).toBeInTheDocument();
    expect(within(becaCard).getByRole("button", { name: /^ocultar$/i })).toBeInTheDocument();

    const convenioCard = within(cards).getByText("Convenio empresa").closest("li") as HTMLElement;
    expect(within(convenioCard).getByRole("button", { name: /^mostrar$/i })).toBeInTheDocument();
  });
});

describe("DiscountsPage — mobile form reveal", () => {
  it("moves focus to the first field of the create form when it opens", async () => {
    renderPage();
    await screen.findByTestId("discounts-cards");

    fireEvent.click(screen.getByRole("button", { name: /nuevo descuento/i }));

    expect(await screen.findByPlaceholderText("Beca municipal")).toHaveFocus();
  });
});

describe("DiscountsPage — ocultar, mostrar y eliminar", () => {
  it("dresses a hidden card like a hidden tariff: sunken background, no opacity fade", async () => {
    renderPage();

    const convenioRow = await findDescuentoRow("Convenio empresa");
    expect(convenioRow.className).toContain("bg-sunken");
    expect(convenioRow.className).not.toContain("opacity-60");
    expect(
      within(convenioRow).getByText(/no aparece.*las aplicaciones existentes se conservan/i),
    ).toBeInTheDocument();
  });

  it("offers Eliminar only on discounts that were never used, after Ocultar", async () => {
    mockFetchDescuentos.mockResolvedValue([BECA, PROMO]);
    renderPage();

    const becaRow = await findDescuentoRow("Beca municipal");
    const promoRow = await findDescuentoRow("Promo por error");
    expect(within(becaRow).queryByRole("button", { name: /eliminar/i })).not.toBeInTheDocument();
    expect(
      within(promoRow).getAllByRole("button").map((b) => b.textContent?.trim()),
    ).toEqual(["Editar", "Ocultar", "Eliminar"]);
  });

  it("confirms with an irreversible warning, then DELETEs and removes the card", async () => {
    mockFetchDescuentos.mockResolvedValue([BECA, PROMO]);
    mockEliminarDescuento.mockResolvedValueOnce(undefined);
    renderPage();

    const promoRow = await findDescuentoRow("Promo por error");
    fireEvent.click(within(promoRow).getByRole("button", { name: /eliminar/i }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/¿eliminar «promo por error»\?/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/no se puede deshacer/i)).toBeInTheDocument();
    expect(mockEliminarDescuento).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: /^eliminar$/i }));

    await waitFor(() => expect(mockEliminarDescuento).toHaveBeenCalledWith(3));
    await waitFor(() => expect(screen.queryByText("Promo por error")).not.toBeInTheDocument());
  });

  it("shows the server's 409 message when the discount turns out to be in use", async () => {
    mockFetchDescuentos.mockResolvedValue([BECA, PROMO]);
    const { ApiClientError } = await import("@/services/api");
    mockEliminarDescuento.mockRejectedValueOnce(
      new ApiClientError("No se puede eliminar el descuento 'Promo por error' porque ya se aplicó.", 409),
    );
    renderPage();

    const promoRow = await findDescuentoRow("Promo por error");
    fireEvent.click(within(promoRow).getByRole("button", { name: /eliminar/i }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^eliminar$/i }));

    expect((await screen.findAllByText(/porque ya se aplicó/i)).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Promo por error").length).toBeGreaterThan(0);
  });
});

describe("DiscountsPage — tarjetas sin estirar", () => {
  it("lets a short catalog and its explainer keep their natural height", async () => {
    renderPage();
    await screen.findByTestId("discounts-cards");

    const types = screen.getByTestId("discounts-types");
    expect(types.querySelector("ul")?.className).not.toContain("flex-1");
    const column = types.parentElement as HTMLElement;
    expect(column.className).not.toContain("grid-rows-");
    expect(column.className).not.toContain("min-h-[calc");
  });

  it("lets the empty-catalog ghost cards keep their natural height", async () => {
    mockFetchDescuentos.mockResolvedValue([]);
    renderPage();
    await screen.findByText(/sin descuentos en el catálogo/i);

    const ghost = screen.getAllByText("Ejemplo")[0].closest("ul") as HTMLElement;
    const column = ghost.parentElement as HTMLElement;
    expect(column.className).not.toContain("grid-rows-");
    expect(column.className).not.toContain("min-h-[calc");
  });

  it("does not reserve a tall dead block for the 'Agregar descuento' placeholder", async () => {
    renderPage();
    await screen.findByTestId("discounts-cards");

    expect(screen.getByRole("button", { name: /agregar descuento/i }).className).not.toMatch(/min-h-56/);
  });
});
