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
};

const CONVENIO: DescuentoCatalogo = {
  id: 2,
  nombre: "Convenio empresa",
  porcentaje: null,
  monto: "10.00",
  activo: false,
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
  const row = matches.map((el) => el.closest("tr")).find(Boolean);
  return row as HTMLElement;
}

beforeEach(() => {
  mockFetchDescuentos.mockReset().mockResolvedValue([BECA, CONVENIO]);
  mockCrearDescuento.mockReset();
  mockActualizarDescuento.mockReset();
});

describe("DiscountsPage — listado", () => {
  it("lists active and inactive discounts, visually distinct", async () => {
    renderPage();

    const becaRow = await findDescuentoRow("Beca municipal");
    const convenioRow = await findDescuentoRow("Convenio empresa");

    expect(within(becaRow).getByText("Activo")).toBeInTheDocument();
    expect(within(becaRow).getByText("100%")).toBeInTheDocument();
    expect(within(convenioRow).getByText("Inactivo")).toBeInTheDocument();
    expect(convenioRow).toHaveAttribute("data-inactivo", "true");
    expect(becaRow).not.toHaveAttribute("data-inactivo", "true");
  });

  it("shows the empty state when the catalog has no discounts", async () => {
    mockFetchDescuentos.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(/sin descuentos/i)).toBeInTheDocument();
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

describe("DiscountsPage — crear", () => {
  it("creates a percentage discount from the form", async () => {
    mockCrearDescuento.mockResolvedValueOnce({ ...BECA, id: 3, nombre: "Media beca", porcentaje: "50" });
    renderPage();
    await screen.findByTestId("discounts-table");

    fireEvent.click(screen.getByRole("button", { name: /nuevo descuento/i }));
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
    await screen.findByTestId("discounts-table");

    fireEvent.click(screen.getByRole("button", { name: /nuevo descuento/i }));
    fireEvent.change(screen.getByLabelText(/nombre/i), { target: { value: "Convenio dos" } });
    fireEvent.change(screen.getByLabelText(/tipo/i), { target: { value: "MONTO" } });
    fireEvent.change(screen.getByLabelText(/valor/i), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: /^crear$/i }));

    await waitFor(() => {
      expect(mockCrearDescuento).toHaveBeenCalledWith({ nombre: "Convenio dos", porcentaje: null, monto: 10 });
    });
  });

  it("surfaces a backend 400 (duplicate name) as a form error", async () => {
    const { ApiClientError } = await import("@/services/api");
    mockCrearDescuento.mockRejectedValueOnce(new ApiClientError("Ya existe un descuento con ese nombre", 400));
    renderPage();
    await screen.findByTestId("discounts-table");

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
    await screen.findByTestId("discounts-table");

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
    await screen.findByTestId("discounts-table");
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
    await screen.findByTestId("discounts-table");
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
  it("opens a confirmation naming the discount on 'Desactivar' click, without mutating yet", async () => {
    renderPage();

    const becaRow = await findDescuentoRow("Beca municipal");
    fireEvent.click(within(becaRow).getByRole("button", { name: /desactivar/i }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/beca municipal/i)).toBeInTheDocument();
    expect(mockActualizarDescuento).not.toHaveBeenCalled();
  });

  it("tells the reader the discount stays in the list to reactivate (#315 hallazgo #40)", async () => {
    // The catalog's own "Ver ayuda" panel (D11c) already explains this, but
    // it starts collapsed and nothing on the closed screen hints it is
    // in there. This is the alternative the finding names: the consequence
    // stated at the one moment the admin is guaranteed to read something —
    // the confirmation the click itself opens.
    renderPage();

    const becaRow = await findDescuentoRow("Beca municipal");
    fireEvent.click(within(becaRow).getByRole("button", { name: /desactivar/i }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/reactivar/i)).toBeInTheDocument();
  });

  it("deactivates an active discount via PATCH activo:false only after confirming", async () => {
    mockActualizarDescuento.mockResolvedValueOnce({ ...BECA, activo: false });
    renderPage();

    const becaRow = await findDescuentoRow("Beca municipal");
    fireEvent.click(within(becaRow).getByRole("button", { name: /desactivar/i }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^desactivar$/i }));

    await waitFor(() => {
      expect(mockActualizarDescuento).toHaveBeenCalledWith(1, { activo: false });
    });
  });

  it("leaves the discount untouched when the deactivation confirmation is canceled", async () => {
    renderPage();

    const becaRow = await findDescuentoRow("Beca municipal");
    fireEvent.click(within(becaRow).getByRole("button", { name: /desactivar/i }));
    fireEvent.click(screen.getByRole("button", { name: /^cancelar$/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockActualizarDescuento).not.toHaveBeenCalled();
  });

  it("reactivates an inactive discount via PATCH activo:true, with no confirmation step", async () => {
    mockActualizarDescuento.mockResolvedValueOnce({ ...CONVENIO, activo: true });
    renderPage();

    const convenioRow = await findDescuentoRow("Convenio empresa");
    fireEvent.click(within(convenioRow).getByRole("button", { name: /reactivar/i }));

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
  it("keeps the catalog on one column while no form is open", async () => {
    // The rail holds the form, and nothing else. It used to be reserved the
    // instant the catalog had a row, so the ORDINARY state of this screen — a
    // short table with nobody editing — stood beside 340px of empty column.
    // #199 is why it was empty: the permanent "Cómo funciona el catálogo"
    // card moved into the header's disclosure and nothing replaced it. A
    // track reserved for content that no longer exists is not a layout, it is
    // a leftover.
    renderPage();
    await screen.findByTestId("discounts-table");

    expect(screen.getByTestId("discounts-split").className).not.toBe(PAGE_RAIL);
    expect(screen.queryByTestId("discounts-rail")).not.toBeInTheDocument();
  });

  it("opens the second column only when there is a form to put in it", async () => {
    renderPage();
    await screen.findByTestId("discounts-table");

    fireEvent.click(screen.getByRole("button", { name: /nuevo descuento/i }));

    expect(screen.getByTestId("discounts-split").className).toBe(PAGE_RAIL);
    expect(screen.getByTestId("discounts-rail")).toBeInTheDocument();
  });

  it("gives the column back when the form is dismissed", async () => {
    renderPage();
    await screen.findByTestId("discounts-table");
    fireEvent.click(screen.getByRole("button", { name: /nuevo descuento/i }));

    fireEvent.click(screen.getByRole("button", { name: /cancelar/i }));

    expect(screen.getByTestId("discounts-split").className).not.toBe(PAGE_RAIL);
    expect(screen.queryByTestId("discounts-rail")).not.toBeInTheDocument();
  });

  it("does not stretch the catalog card past its own rows", async () => {
    // `flex-1` on the card exists for the EMPTY state, whose `fill` needs a
    // tall parent to centre itself in. Applying it to a populated card would
    // just move the dead air inside the card, and a card taller than its own
    // content reads as broken where short canvas only reads as the end of the
    // page. /members already draws its table card this way.
    renderPage();
    await screen.findByTestId("discounts-table");

    const card = screen.getByRole("table").closest("section") as HTMLElement;
    expect(card.className).not.toContain("flex-1");
  });

  it("puts the form beside the table, not above it", async () => {
    // The assertion that carries the weight, and the one #81 is about: the
    // table and the form are SIBLINGS in the split, so opening one cannot
    // push the other down. It used to render between the page header and the
    // catalog. Losing the always-on track costs a horizontal reflow when the
    // form opens; it does not bring back the vertical shove.
    renderPage();
    const becaRow = await findDescuentoRow("Beca municipal");

    fireEvent.click(within(becaRow).getByRole("button", { name: /editar/i }));

    const split = screen.getByTestId("discounts-split");
    const form = screen.getByLabelText(/nombre/i).closest("[data-testid='discounts-rail']");
    const table = screen.getByRole("table");

    expect(form).not.toBeNull();
    expect(split.contains(table)).toBe(true);
    expect(form?.contains(table)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Contextual help — issue #199
// ---------------------------------------------------------------------------

describe("DiscountsPage — ayuda contextual", () => {
  it("keeps the catalog rules collapsed behind a Ver ayuda toggle", async () => {
    // There is no "Eliminar" anywhere on this screen and there never will be:
    // applied discounts reference the catalog by FK. That rule used to sit in
    // a permanent lateral card; it now follows the Members disclosure
    // pattern instead — available, but not occupying space until asked for.
    renderPage();
    await screen.findByTestId("discounts-table");

    expect(screen.queryByText(/no se elimina/i)).not.toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: /cómo funciona el catálogo/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);

    expect(await screen.findByText(/no se elimina/i)).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("does not put the catalog rules inside the form rail", async () => {
    // #199 moved the rules out of a permanent rail card and into the header's
    // disclosure. The rail is the form's column now and holds nothing else,
    // so this has to be asserted with a form actually open — with none, there
    // is no rail at all (see "la segunda columna").
    renderPage();
    await screen.findByTestId("discounts-table");
    fireEvent.click(screen.getByRole("button", { name: /nuevo descuento/i }));
    fireEvent.click(screen.getByRole("button", { name: /cómo funciona el catálogo/i }));

    expect(await screen.findByText(/no se elimina/i)).toBeInTheDocument();
    const rail = screen.getByTestId("discounts-rail");
    expect(within(rail).queryByText(/no se elimina/i)).not.toBeInTheDocument();
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
    await screen.findByTestId("discounts-table");
    fireEvent.click(screen.getByRole("button", { name: /nuevo descuento/i }));

    const nombreLabel = screen.getByLabelText(/nombre/i).closest("label");
    const fieldsContainer = nombreLabel?.parentElement;

    expect(fieldsContainer?.className).not.toMatch(/grid-cols-3/);
  });

  it("gives every field the full input width, so a long name has room to render", async () => {
    renderPage();
    await screen.findByTestId("discounts-table");
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
// D11c — the help stops floating, and the empty catalog stops reserving a rail
// ---------------------------------------------------------------------------

describe("DiscountsPage — la ayuda vive en el bloque que explica", () => {
  it("anchors the Ver ayuda toggle inside the catalog block, not loose on the canvas", async () => {
    // It shipped as a bare child of the shell: no wrapper, no className, a
    // 16px underlined control alone in a 20px band between the error slot and
    // the grid. It got there by losing the `mt-3` it used to hold itself up
    // with, and nothing caught it. Its three rules are all about the catalog,
    // so the catalog card is the block that owns it.
    renderPage();
    await screen.findByTestId("discounts-table");

    const toggle = screen.getByRole("button", { name: /cómo funciona el catálogo/i });
    const block = screen.getByRole("table").closest("section");

    expect(block).not.toBeNull();
    expect(block?.contains(toggle)).toBe(true);
  });

  it("keeps the help beside the catalog title even when there is no catalog yet", async () => {
    // The state that needs the rules most is the one with nothing to look at.
    mockFetchDescuentos.mockResolvedValue([]);
    renderPage();
    await screen.findByText(/sin descuentos en el catálogo/i);

    expect(
      screen.getByRole("button", { name: /cómo funciona el catálogo/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Catálogo de descuentos")).toBeInTheDocument();
  });
});

describe("DiscountsPage — el catálogo vacío no reserva un riel", () => {
  it("drops the 340px track when there is no row to hold still and no form open", async () => {
    // The rail exists so the row being edited does not move. With zero rows
    // that argument has nothing to protect, and the reserved track was 340 of
    // the ~470 horizontal pixels this screen was leaving blank beside a card
    // that says there is nothing here.
    mockFetchDescuentos.mockResolvedValue([]);
    renderPage();
    await screen.findByText(/sin descuentos en el catálogo/i);

    expect(screen.getByTestId("discounts-split").className).not.toBe(PAGE_RAIL);
    expect(screen.queryByTestId("discounts-rail")).not.toBeInTheDocument();
  });

  it("brings the split straight back the moment a form opens over an empty catalog", async () => {
    mockFetchDescuentos.mockResolvedValue([]);
    renderPage();
    await screen.findByText(/sin descuentos en el catálogo/i);

    fireEvent.click(screen.getByRole("button", { name: /crear primer descuento/i }));

    expect(screen.getByTestId("discounts-split").className).toBe(PAGE_RAIL);
    expect(screen.getByTestId("discounts-rail")).toBeInTheDocument();
  });

  it("stretches the empty statement into the card instead of leaving canvas under it", async () => {
    // 62% — 555px — was the largest dead-air figure of the whole redesign.
    mockFetchDescuentos.mockResolvedValue([]);
    renderPage();
    const title = await screen.findByText(/sin descuentos en el catálogo/i);

    const statement = title.parentElement as HTMLElement;
    expect(statement.className).toContain("flex-1");
    // `inset`, because the catalog card is already open around it — a card
    // inside a card is a border and a shadow the design never asks for.
    expect(statement.className).not.toContain("card");
  });
});

describe("DiscountsPage — el formulario habla el idioma del sistema", () => {
  it("dresses its fields in the control radius, not the retired 8px one", async () => {
    renderPage();
    await screen.findByTestId("discounts-table");
    fireEvent.click(screen.getByRole("button", { name: /nuevo descuento/i }));

    for (const field of [
      screen.getByLabelText(/nombre/i),
      screen.getByLabelText(/tipo/i),
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
    await screen.findByTestId("discounts-table");
    fireEvent.click(screen.getByRole("button", { name: /nuevo descuento/i }));

    expect(screen.getByRole("heading", { name: /nuevo descuento/i }).className).toContain(
      "font-display",
    );
  });
});

// ---------------------------------------------------------------------------
// Mobile reflow — issue #339 (blocks release)
//
// At 320/375px the table used to be the ONLY rendering: `overflow-x-auto` on
// its own wrapper let the BODY scroll sideways instead, with no affordance
// that Acciones (Editar/Desactivar) existed off-screen at all. `/members` and
// `/payments` solve this the same way — reflow to cards below the table
// breakpoint, actions inside each card — and this screen now follows that
// exact pattern instead of inventing a scrolling-table variant.
//
// jsdom applies no real CSS, so both the card list and the table are always
// in the document; the breakpoint classes (`sm:hidden` / `hidden sm:block`)
// are what a browser actually uses to show only one. Only a browser can
// measure real pixel widths against a viewport (see
// tests/e2e/content-measure.spec.ts for that kind of assertion elsewhere in
// this repo) — what a unit test CAN pin down, and the thing that actually
// regressed here, is that the mechanism exists at all: a card rendering that
// carries the actions, toggled by the same breakpoint classes `/members`
// already ships.
// ---------------------------------------------------------------------------

describe("DiscountsPage — mobile reflow (issue #339)", () => {
  it("collapses the catalog into cards below sm, each one carrying Editar and Desactivar", async () => {
    renderPage();

    const cards = await screen.findByTestId("discounts-cards");
    expect(cards.className).toContain("sm:hidden");

    const becaCard = within(cards).getByText("Beca municipal").closest("li") as HTMLElement;
    expect(becaCard).not.toBeNull();
    expect(within(becaCard).getByRole("button", { name: /^editar/i })).toBeInTheDocument();
    expect(within(becaCard).getByRole("button", { name: /desactivar/i })).toBeInTheDocument();

    // The inactive discount's card carries "Reactivar" instead — same rule
    // the table row already followed.
    const convenioCard = within(cards).getByText("Convenio empresa").closest("li") as HTMLElement;
    expect(within(convenioCard).getByRole("button", { name: /reactivar/i })).toBeInTheDocument();
  });

  it("hides the table below sm and shows it again at sm and up — never the only rendering", async () => {
    renderPage();

    const tableWrapper = await screen.findByTestId("discounts-table");
    expect(tableWrapper.className).toContain("hidden");
    expect(tableWrapper.className).toContain("sm:block");
    expect(within(tableWrapper).getByRole("table")).toBeInTheDocument();
  });

  it("never wraps the table in a bare overflow-x-auto with no narrower affordance", async () => {
    // The exact shape the issue rules out: `overflow-x-auto` alone, on a
    // wrapper with no `hidden`/breakpoint class, forces the BODY (not a
    // contained box) to carry the sideways scroll and gives the admin no
    // signal there is more to the right at all.
    renderPage();

    const tableWrapper = await screen.findByTestId("discounts-table");
    if (tableWrapper.className.includes("overflow-x-auto")) {
      expect(tableWrapper.className).toContain("hidden");
    }
  });
});
