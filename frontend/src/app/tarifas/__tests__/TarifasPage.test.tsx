/**
 * Component tests for TarifasPage — the admin tariff-catalog screen (issue
 * #394, the frontend half of #400): list every membership price, edit it
 * inline, confirm before saving because a price change is money.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import TarifasPage from "@/app/tarifas/page";
import type { TipoMembresiaCatalogo } from "@/services/api";
import { ToastProvider } from "@/contexts/ToastContext";

vi.mock("@/components/ProtectedRoute", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/tarifas",
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

const mockFetchTiposMembresia = vi.fn();
const mockActualizarTipoMembresia = vi.fn();
const mockCrearTipoMembresia = vi.fn();
const mockEliminarTipoMembresia = vi.fn();
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
    fetchTiposMembresia: () => mockFetchTiposMembresia(),
    actualizarTipoMembresia: (id: number, data: unknown) => mockActualizarTipoMembresia(id, data),
    crearTipoMembresia: (data: unknown) => mockCrearTipoMembresia(data),
    eliminarTipoMembresia: (id: number) => mockEliminarTipoMembresia(id),
    fetchNotificaciones: () => mockFetchNotificaciones(),
    marcarNotificacionLeida: (id: number) => mockMarcarNotificacionLeida(id),
    ApiClientError: MockApiClientError,
  };
});

const JUNIOR: TipoMembresiaCatalogo = {
  id: 1,
  categoria: "Junior",
  precio: "45.00",
  modalidad: "MENSUAL",
  activo: true,
  enUso: true,
};

const SENIOR: TipoMembresiaCatalogo = {
  id: 2,
  categoria: "Senior",
  precio: "60.00",
  modalidad: "MENSUAL",
  activo: true,
  enUso: true,
};

/** Never used and visible: the only kind that may be deleted. */
const PRUEBA: TipoMembresiaCatalogo = {
  id: 3,
  categoria: "Prueba",
  precio: "10.00",
  modalidad: "MENSUAL",
  activo: true,
  enUso: false,
};

/** Hidden from the web and from enrollment, but students still pay it. */
const ADFA: TipoMembresiaCatalogo = {
  id: 4,
  categoria: "ADFA",
  precio: "22.00",
  modalidad: "MENSUAL",
  activo: false,
  enUso: true,
};

function renderPage(): void {
  render(
    <ToastProvider>
      <TarifasPage />
    </ToastProvider>,
  );
}

/** Mirrors `findDescuentoRow` in DiscountsPage.test.tsx: each tariff is one card (`<li>`). */
async function findTarifaRow(categoria: string): Promise<HTMLElement> {
  const matches = await screen.findAllByText(categoria);
  const row = matches.map((el) => el.closest("li")).find(Boolean);
  return row as HTMLElement;
}

beforeEach(() => {
  mockFetchTiposMembresia.mockReset().mockResolvedValue([JUNIOR, SENIOR]);
  mockActualizarTipoMembresia.mockReset();
  mockCrearTipoMembresia.mockReset();
  mockEliminarTipoMembresia.mockReset();
});

describe("TarifasPage — listado", () => {
  it("lists every tariff with its category, price and modality", async () => {
    renderPage();

    const juniorRow = await findTarifaRow("Junior");
    const seniorRow = await findTarifaRow("Senior");

    expect(within(juniorRow).getByText("$ 45.00")).toBeInTheDocument();
    expect(within(juniorRow).getByText("Mensual")).toBeInTheDocument();
    expect(within(seniorRow).getByText("$ 60.00")).toBeInTheDocument();
  });

  it("shows the empty state when the catalog has no tariffs", async () => {
    mockFetchTiposMembresia.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(/sin tarifas/i)).toBeInTheDocument();
    expect(screen.queryByTestId("tarifas-usage")).not.toBeInTheDocument();
  });

  it("continues the main column with where the tariffs are used", async () => {
    renderPage();
    await findTarifaRow("Junior");

    const usage = screen.getByTestId("tarifas-usage");
    expect(
      within(usage).getByRole("heading", { name: /dónde se usan las tarifas/i }),
    ).toBeInTheDocument();
    for (const title of ["Inscripción", "Pagos", "Cambio de plan"]) {
      expect(within(usage).getByRole("heading", { name: title })).toBeInTheDocument();
    }
  });

  it("shows an error state with retry when loading fails", async () => {
    mockFetchTiposMembresia.mockRejectedValueOnce(new Error("caído"));
    renderPage();

    const retry = await screen.findByRole("button", { name: /reintentar/i });
    mockFetchTiposMembresia.mockResolvedValue([JUNIOR]);
    fireEvent.click(retry);

    expect((await screen.findAllByText("Junior")).length).toBeGreaterThan(0);
  });

  it("shows a loading state while the catalog is being fetched", () => {
    mockFetchTiposMembresia.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByText(/cargando tarifas/i)).toBeInTheDocument();
  });
});

describe("TarifasPage — editar precio", () => {
  it("edits a price and confirms it, sending the id and precio as a STRING", async () => {
    mockActualizarTipoMembresia.mockResolvedValueOnce({ ...JUNIOR, precio: "50.00" });
    renderPage();

    const juniorRow = await findTarifaRow("Junior");
    fireEvent.click(within(juniorRow).getByRole("button", { name: /^editar$/i }));

    const input = within(juniorRow).getByLabelText(/precio de junior/i);
    fireEvent.change(input, { target: { value: "50.00" } });
    fireEvent.click(within(juniorRow).getByRole("button", { name: /^guardar$/i }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /cambiar precio/i }));

    await waitFor(() => {
      expect(mockActualizarTipoMembresia).toHaveBeenCalledWith(1, { precio: "50.00" });
    });
    const [, payload] = mockActualizarTipoMembresia.mock.calls[0] as [number, { precio: unknown }];
    expect(typeof payload.precio).toBe("string");

    // The row reflects the new price without a manual reload.
    expect(await within(juniorRow).findByText("$ 50.00")).toBeInTheDocument();
  });

  it("does not call the API when the confirmation is cancelled", async () => {
    renderPage();

    const juniorRow = await findTarifaRow("Junior");
    fireEvent.click(within(juniorRow).getByRole("button", { name: /^editar$/i }));
    fireEvent.change(within(juniorRow).getByLabelText(/precio de junior/i), {
      target: { value: "50.00" },
    });
    fireEvent.click(within(juniorRow).getByRole("button", { name: /^guardar$/i }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^cancelar$/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockActualizarTipoMembresia).not.toHaveBeenCalled();
  });

  it("states in the confirmation that only future payments are affected", async () => {
    renderPage();

    const juniorRow = await findTarifaRow("Junior");
    fireEvent.click(within(juniorRow).getByRole("button", { name: /^editar$/i }));
    fireEvent.change(within(juniorRow).getByLabelText(/precio de junior/i), {
      target: { value: "50.00" },
    });
    fireEvent.click(within(juniorRow).getByRole("button", { name: /^guardar$/i }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/pagos futuros/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/no se modifican/i)).toBeInTheDocument();
  });

  it.each([
    ["0", "cero"],
    ["", "vacío"],
  ])("rejects a %s price (%s) without reaching the API", async (valorInvalido) => {
    // "-5" and "abc" are no longer meaningful cases here: the masking added
    // for #506 filters "-" and letters out at typing time (see the masking
    // describe block below), so they never survive to reach validation.
    // "45.999" moved the same way (issue #667): the `"amount"` mode's cents
    // cap now truncates a 3rd decimal digit as it's typed, so the field
    // itself is "45.99" — a VALID price — by the time Guardar is clicked.
    // See "caps the decimal part at 2 digits while typing" below.
    renderPage();

    const juniorRow = await findTarifaRow("Junior");
    fireEvent.click(within(juniorRow).getByRole("button", { name: /^editar$/i }));
    fireEvent.change(within(juniorRow).getByLabelText(/precio de junior/i), {
      target: { value: valorInvalido },
    });
    fireEvent.click(within(juniorRow).getByRole("button", { name: /^guardar$/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockActualizarTipoMembresia).not.toHaveBeenCalled();
    expect(await within(juniorRow).findByText(/precio válido/i)).toBeInTheDocument();
  });

  it("surfaces the backend's failure message instead of a generic one", async () => {
    const { ApiClientError } = await import("@/services/api");
    mockActualizarTipoMembresia.mockRejectedValueOnce(
      new ApiClientError("El precio debe ser mayor a 0", 422),
    );
    renderPage();

    const juniorRow = await findTarifaRow("Junior");
    fireEvent.click(within(juniorRow).getByRole("button", { name: /^editar$/i }));
    fireEvent.change(within(juniorRow).getByLabelText(/precio de junior/i), {
      target: { value: "50.00" },
    });
    fireEvent.click(within(juniorRow).getByRole("button", { name: /^guardar$/i }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /cambiar precio/i }));

    expect(await within(juniorRow).findByText("El precio debe ser mayor a 0")).toBeInTheDocument();
  });

  it("lets the admin cancel edit mode without saving anything", async () => {
    renderPage();

    const juniorRow = await findTarifaRow("Junior");
    fireEvent.click(within(juniorRow).getByRole("button", { name: /^editar$/i }));
    fireEvent.change(within(juniorRow).getByLabelText(/precio de junior/i), {
      target: { value: "999.00" },
    });
    fireEvent.click(within(juniorRow).getByRole("button", { name: /^cancelar$/i }));

    expect(within(juniorRow).queryByLabelText(/precio de junior/i)).not.toBeInTheDocument();
    expect(mockActualizarTipoMembresia).not.toHaveBeenCalled();
    expect(within(juniorRow).getByText("$ 45.00")).toBeInTheDocument();
  });
});

// The backend/BFF/api client already supported renaming a tariff — this
// screen was the only gap. Edit mode now carries a name input alongside the
// price one, and the PATCH only ever sends what actually changed.
describe("TarifasPage — editar nombre", () => {
  it("sends only categoria when just the name changed", async () => {
    mockActualizarTipoMembresia.mockResolvedValueOnce({ ...JUNIOR, categoria: "Junior Plus" });
    renderPage();

    const juniorRow = await findTarifaRow("Junior");
    fireEvent.click(within(juniorRow).getByRole("button", { name: /^editar$/i }));
    fireEvent.change(within(juniorRow).getByLabelText(/nombre de junior/i), {
      target: { value: "Junior Plus" },
    });
    fireEvent.click(within(juniorRow).getByRole("button", { name: /^guardar$/i }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /cambiar nombre/i }));

    await waitFor(() => {
      expect(mockActualizarTipoMembresia).toHaveBeenCalledWith(1, { categoria: "Junior Plus" });
    });
    expect(await within(juniorRow).findByText("Junior Plus")).toBeInTheDocument();
  });

  it("sends only precio when just the price changed", async () => {
    mockActualizarTipoMembresia.mockResolvedValueOnce({ ...JUNIOR, precio: "50.00" });
    renderPage();

    const juniorRow = await findTarifaRow("Junior");
    fireEvent.click(within(juniorRow).getByRole("button", { name: /^editar$/i }));
    fireEvent.change(within(juniorRow).getByLabelText(/precio de junior/i), {
      target: { value: "50.00" },
    });
    fireEvent.click(within(juniorRow).getByRole("button", { name: /^guardar$/i }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /cambiar precio/i }));

    await waitFor(() => {
      expect(mockActualizarTipoMembresia).toHaveBeenCalledWith(1, { precio: "50.00" });
    });
  });

  it("sends both categoria and precio when both changed", async () => {
    mockActualizarTipoMembresia.mockResolvedValueOnce({
      ...JUNIOR,
      categoria: "Junior Plus",
      precio: "50.00",
    });
    renderPage();

    const juniorRow = await findTarifaRow("Junior");
    fireEvent.click(within(juniorRow).getByRole("button", { name: /^editar$/i }));
    fireEvent.change(within(juniorRow).getByLabelText(/nombre de junior/i), {
      target: { value: "Junior Plus" },
    });
    fireEvent.change(within(juniorRow).getByLabelText(/precio de junior/i), {
      target: { value: "50.00" },
    });
    fireEvent.click(within(juniorRow).getByRole("button", { name: /^guardar$/i }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /cambiar tarifa/i }));

    await waitFor(() => {
      expect(mockActualizarTipoMembresia).toHaveBeenCalledWith(1, {
        categoria: "Junior Plus",
        precio: "50.00",
      });
    });
  });

  it("closes edit mode without calling the API when nothing changed", async () => {
    renderPage();

    const juniorRow = await findTarifaRow("Junior");
    fireEvent.click(within(juniorRow).getByRole("button", { name: /^editar$/i }));
    fireEvent.click(within(juniorRow).getByRole("button", { name: /^guardar$/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockActualizarTipoMembresia).not.toHaveBeenCalled();
    expect(within(juniorRow).queryByLabelText(/nombre de junior/i)).not.toBeInTheDocument();
  });

  it("rejects an empty name without reaching the API", async () => {
    renderPage();

    const juniorRow = await findTarifaRow("Junior");
    fireEvent.click(within(juniorRow).getByRole("button", { name: /^editar$/i }));
    fireEvent.change(within(juniorRow).getByLabelText(/nombre de junior/i), {
      target: { value: "   " },
    });
    fireEvent.click(within(juniorRow).getByRole("button", { name: /^guardar$/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockActualizarTipoMembresia).not.toHaveBeenCalled();
    expect(await within(juniorRow).findByText(/ingrese un nombre/i)).toBeInTheDocument();
  });

  it("rejects a name longer than 80 characters without reaching the API", async () => {
    renderPage();

    const juniorRow = await findTarifaRow("Junior");
    fireEvent.click(within(juniorRow).getByRole("button", { name: /^editar$/i }));
    fireEvent.change(within(juniorRow).getByLabelText(/nombre de junior/i), {
      target: { value: "x".repeat(81) },
    });
    fireEvent.click(within(juniorRow).getByRole("button", { name: /^guardar$/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockActualizarTipoMembresia).not.toHaveBeenCalled();
    expect(
      await within(juniorRow).findByText(/no puede superar los 80 caracteres/i),
    ).toBeInTheDocument();
  });

  it("names both the old and the new name in the confirmation dialog", async () => {
    renderPage();

    const juniorRow = await findTarifaRow("Junior");
    fireEvent.click(within(juniorRow).getByRole("button", { name: /^editar$/i }));
    fireEvent.change(within(juniorRow).getByLabelText(/nombre de junior/i), {
      target: { value: "Junior Plus" },
    });
    fireEvent.click(within(juniorRow).getByRole("button", { name: /^guardar$/i }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/junior/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/junior plus/i)).toBeInTheDocument();
  });
});

// Issue #506 — the price input let anything through and only ever accepted
// "." as the decimal separator, rejecting the "45,50" an es-EC/es-AR admin
// naturally types.
describe("TarifasPage — masking y separador decimal", () => {
  it("filters out letters while typing, keeping only digits and separators", async () => {
    renderPage();

    const juniorRow = await findTarifaRow("Junior");
    fireEvent.click(within(juniorRow).getByRole("button", { name: /^editar$/i }));
    const input = within(juniorRow).getByLabelText(/precio de junior/i) as HTMLInputElement;

    fireEvent.change(input, { target: { value: "4a5b" } });

    expect(input.value).toBe("45");
  });

  it("filters out symbols such as a minus sign while typing", async () => {
    renderPage();

    const juniorRow = await findTarifaRow("Junior");
    fireEvent.click(within(juniorRow).getByRole("button", { name: /^editar$/i }));
    const input = within(juniorRow).getByLabelText(/precio de junior/i) as HTMLInputElement;

    fireEvent.change(input, { target: { value: "-5" } });

    expect(input.value).toBe("5");
  });

  it("drops a second decimal separator while typing", async () => {
    renderPage();

    const juniorRow = await findTarifaRow("Junior");
    fireEvent.click(within(juniorRow).getByRole("button", { name: /^editar$/i }));
    const input = within(juniorRow).getByLabelText(/precio de junior/i) as HTMLInputElement;

    fireEvent.change(input, { target: { value: "45,,50" } });

    expect(input.value).toBe("45,50");
  });

  it("accepts a comma as decimal separator and normalizes it to a dot when saving", async () => {
    mockActualizarTipoMembresia.mockResolvedValueOnce({ ...JUNIOR, precio: "45.50" });
    renderPage();

    const juniorRow = await findTarifaRow("Junior");
    fireEvent.click(within(juniorRow).getByRole("button", { name: /^editar$/i }));
    fireEvent.change(within(juniorRow).getByLabelText(/precio de junior/i), {
      target: { value: "45,50" },
    });
    fireEvent.click(within(juniorRow).getByRole("button", { name: /^guardar$/i }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /cambiar precio/i }));

    await waitFor(() => {
      expect(mockActualizarTipoMembresia).toHaveBeenCalledWith(1, { precio: "45.50" });
    });
  });

  it("does not show the invalid-price error for a comma-separated value", async () => {
    renderPage();

    const juniorRow = await findTarifaRow("Junior");
    fireEvent.click(within(juniorRow).getByRole("button", { name: /^editar$/i }));
    fireEvent.change(within(juniorRow).getByLabelText(/precio de junior/i), {
      target: { value: "45,50" },
    });
    fireEvent.click(within(juniorRow).getByRole("button", { name: /^guardar$/i }));

    expect(within(juniorRow).queryByText(/precio válido/i)).not.toBeInTheDocument();
  });
});

/**
 * Issue #667: `sanitizePrecioInput` only ever ran on `onChange` — there was
 * no `keydown`/`paste` guard, so a letter or a second separator only got
 * caught after it landed. This adopts `numeric-input.ts`'s shared `"amount"`
 * mode (issue #667's foundation PR) for real-time keystroke rejection and a
 * business ceiling on the integer part, the same discipline cédula/teléfono
 * already have on the enrollment wizards.
 */
describe("TarifasPage — masking en tiempo real y techo de negocio (#667)", () => {
  it("blocks a typed letter on the precio field (keydown)", async () => {
    renderPage();

    const juniorRow = await findTarifaRow("Junior");
    fireEvent.click(within(juniorRow).getByRole("button", { name: /^editar$/i }));
    const input = within(juniorRow).getByLabelText(/precio de junior/i);

    expect(fireEvent.keyDown(input, { key: "a" })).toBe(false);
  });

  it("blocks a second decimal separator via keydown", async () => {
    renderPage();

    const juniorRow = await findTarifaRow("Junior");
    fireEvent.click(within(juniorRow).getByRole("button", { name: /^editar$/i }));
    const input = within(juniorRow).getByLabelText(/precio de junior/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "45.5" } });

    expect(fireEvent.keyDown(input, { key: "." })).toBe(false);
  });

  it("strips a currency symbol from a pasted price", async () => {
    renderPage();

    const juniorRow = await findTarifaRow("Junior");
    fireEvent.click(within(juniorRow).getByRole("button", { name: /^editar$/i }));
    const input = within(juniorRow).getByLabelText(/precio de junior/i) as HTMLInputElement;
    // Select JUNIOR's starting "45.00" first — the realistic "select, then
    // paste to replace" gesture. Pasting at an unselected caret would
    // INSERT instead (append/splice), which the masking still handles, but
    // is a different scenario than what this test names.
    input.setSelectionRange(0, input.value.length);

    fireEvent.paste(input, { clipboardData: { getData: () => "$99.50" } });

    expect(input.value).toBe("99.50");
  });

  it("caps the decimal part at 2 digits while typing", async () => {
    renderPage();

    const juniorRow = await findTarifaRow("Junior");
    fireEvent.click(within(juniorRow).getByRole("button", { name: /^editar$/i }));
    const input = within(juniorRow).getByLabelText(/precio de junior/i) as HTMLInputElement;

    fireEvent.change(input, { target: { value: "45.999" } });

    expect(input.value).toBe("45.99");
  });

  it("caps the integer part at the business ceiling (6 digits) while typing", async () => {
    renderPage();

    const juniorRow = await findTarifaRow("Junior");
    fireEvent.click(within(juniorRow).getByRole("button", { name: /^editar$/i }));
    const input = within(juniorRow).getByLabelText(/precio de junior/i) as HTMLInputElement;

    fireEvent.change(input, { target: { value: "1234567" } }); // 7 digits, over the cap

    expect(input.value).toBe("123456");
  });

  it("warns instead of silently truncating a keystroke past the cap", async () => {
    renderPage();

    const juniorRow = await findTarifaRow("Junior");
    fireEvent.click(within(juniorRow).getByRole("button", { name: /^editar$/i }));
    const input = within(juniorRow).getByLabelText(/precio de junior/i);
    fireEvent.change(input, { target: { value: "123456" } }); // already at the 6-digit cap

    fireEvent.keyDown(input, { key: "7" });

    expect(await within(juniorRow).findByText(/alcanzó el máximo/i)).toBeInTheDocument();
  });
});

// Issue #507 — the screen only ever let an admin EDIT an existing tariff's
// price; there was no way to add a new one, even though the backend already
// supports `POST /membresias/tipos`.
describe("TarifasPage — crear tarifa", () => {
  it("opens the form, creates a tariff and refreshes the list", async () => {
    mockCrearTipoMembresia.mockResolvedValueOnce({
      id: 3, categoria: "Mensual Infantil", precio: "25.00", modalidad: "MENSUAL",
    });
    renderPage();
    await screen.findByTestId("tarifas-cards");

    fireEvent.click(screen.getByRole("button", { name: /nueva tarifa/i }));
    expect(screen.getByLabelText(/categoría/i)).toBeRequired();
    expect(screen.getByLabelText(/^precio/i)).toBeRequired();
    expect(screen.getByLabelText(/modalidad/i)).toBeRequired();
    fireEvent.change(screen.getByLabelText(/categoría/i), { target: { value: "Mensual Infantil" } });
    fireEvent.change(screen.getByLabelText(/^precio/i), { target: { value: "25.00" } });
    fireEvent.click(screen.getByRole("button", { name: /^crear$/i }));

    await waitFor(() => {
      expect(mockCrearTipoMembresia).toHaveBeenCalledWith({
        categoria: "Mensual Infantil",
        precio: "25.00",
        modalidad: "MENSUAL",
      });
    });
    // The catalog reloads after a successful create, same as `discounts/page.tsx`.
    expect(mockFetchTiposMembresia).toHaveBeenCalledTimes(2);
  });

  it("lets the admin switch modalidad before creating", async () => {
    mockCrearTipoMembresia.mockResolvedValueOnce({
      id: 4, categoria: "Clases sueltas", precio: "10.00", modalidad: "PERSONALIZADA",
    });
    renderPage();
    await screen.findByTestId("tarifas-cards");

    fireEvent.click(screen.getByRole("button", { name: /nueva tarifa/i }));
    fireEvent.change(screen.getByLabelText(/categoría/i), { target: { value: "Clases sueltas" } });
    fireEvent.change(screen.getByLabelText(/modalidad/i), { target: { value: "PERSONALIZADA" } });
    fireEvent.change(screen.getByLabelText(/^precio/i), { target: { value: "10.00" } });
    fireEvent.click(screen.getByRole("button", { name: /^crear$/i }));

    await waitFor(() => {
      expect(mockCrearTipoMembresia).toHaveBeenCalledWith({
        categoria: "Clases sueltas",
        precio: "10.00",
        modalidad: "PERSONALIZADA",
      });
    });
  });

  it("rejects an empty categoria without calling the API", async () => {
    renderPage();
    await screen.findByTestId("tarifas-cards");

    fireEvent.click(screen.getByRole("button", { name: /nueva tarifa/i }));
    fireEvent.change(screen.getByLabelText(/^precio/i), { target: { value: "25.00" } });
    fireEvent.click(screen.getByRole("button", { name: /^crear$/i }));

    expect(mockCrearTipoMembresia).not.toHaveBeenCalled();
    expect(await screen.findByText(/categoría es obligatoria/i)).toBeInTheDocument();
  });

  it("rejects an invalid price without calling the API", async () => {
    renderPage();
    await screen.findByTestId("tarifas-cards");

    fireEvent.click(screen.getByRole("button", { name: /nueva tarifa/i }));
    fireEvent.change(screen.getByLabelText(/categoría/i), { target: { value: "Mensual Infantil" } });
    fireEvent.change(screen.getByLabelText(/^precio/i), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: /^crear$/i }));

    expect(mockCrearTipoMembresia).not.toHaveBeenCalled();
    expect(await screen.findByText(/precio válido/i)).toBeInTheDocument();
  });

  it("surfaces the backend's failure message instead of a generic one", async () => {
    const { ApiClientError } = await import("@/services/api");
    mockCrearTipoMembresia.mockRejectedValueOnce(
      new ApiClientError("Ya existe una tarifa con esa categoría", 409),
    );
    renderPage();
    await screen.findByTestId("tarifas-cards");

    fireEvent.click(screen.getByRole("button", { name: /nueva tarifa/i }));
    fireEvent.change(screen.getByLabelText(/categoría/i), { target: { value: "Mensual Infantil" } });
    fireEvent.change(screen.getByLabelText(/^precio/i), { target: { value: "25.00" } });
    fireEvent.click(screen.getByRole("button", { name: /^crear$/i }));

    expect(await screen.findByText("Ya existe una tarifa con esa categoría")).toBeInTheDocument();
    // The form stays open so the admin can correct the input.
    expect(screen.getByLabelText(/categoría/i)).toBeInTheDocument();
  });

  it("lets the admin cancel without creating anything", async () => {
    renderPage();
    await screen.findByTestId("tarifas-cards");

    fireEvent.click(screen.getByRole("button", { name: /nueva tarifa/i }));
    fireEvent.change(screen.getByLabelText(/categoría/i), { target: { value: "Mensual Infantil" } });
    fireEvent.click(screen.getByRole("button", { name: /^cancelar$/i }));

    expect(screen.queryByLabelText(/categoría/i)).not.toBeInTheDocument();
    expect(mockCrearTipoMembresia).not.toHaveBeenCalled();
  });

  it("gives the categoria field initial focus when the form opens", async () => {
    renderPage();
    await screen.findByTestId("tarifas-cards");

    fireEvent.click(screen.getByRole("button", { name: /nueva tarifa/i }));

    expect(screen.getByLabelText(/categoría/i)).toHaveFocus();
  });
});

describe("TarifasPage — panel lateral", () => {
  it("explains how tariffs apply beside the catalog while nobody is creating one", async () => {
    renderPage();
    await findTarifaRow("Junior");

    const rail = screen.getByTestId("tarifas-rail");
    expect(within(rail).getByRole("heading", { name: /cómo se aplican las tarifas/i })).toBeInTheDocument();
    expect(within(rail).getByRole("heading", { name: /resumen del catálogo/i })).toBeInTheDocument();
    expect(within(rail).getByText("$ 45.00 – $ 60.00")).toBeInTheDocument();
    expect(within(rail).getByText(/al editar un precio/i)).toBeInTheDocument();
    // The three uses live in the main column, not repeated in the rail.
    expect(within(rail).queryByText(/cambio de plan/i)).not.toBeInTheDocument();
  });

  it("offers an add-card slot in the grid that opens the creation form", async () => {
    renderPage();
    await findTarifaRow("Junior");

    fireEvent.click(screen.getByRole("button", { name: /agregar tarifa/i }));
    expect(within(screen.getByTestId("tarifas-rail")).getByLabelText(/categoría/i)).toBeInTheDocument();
  });

  it("shows the creation form above the guidance, which never disappears", async () => {
    renderPage();
    await findTarifaRow("Junior");

    fireEvent.click(screen.getByRole("button", { name: /nueva tarifa/i }));
    const rail = screen.getByTestId("tarifas-rail");
    expect(within(rail).getByLabelText(/categoría/i)).toBeInTheDocument();
    expect(within(rail).getByText(/cómo se aplican/i)).toBeInTheDocument();

    fireEvent.click(within(rail).getByRole("button", { name: /cancelar/i }));
    expect(within(screen.getByTestId("tarifas-rail")).queryByLabelText(/categoría/i)).not.toBeInTheDocument();
  });
});

describe("TarifasPage — mobile form reveal", () => {
  it("moves focus to the first field of the create form when it opens", async () => {
    renderPage();
    await screen.findByTestId("tarifas-cards");

    fireEvent.click(screen.getByRole("button", { name: /nueva tarifa/i }));

    const first = within(screen.getByTestId("tarifas-rail")).getAllByRole("textbox")[0];
    expect(first).toHaveFocus();
  });
});

describe("TarifasPage — ocultar y mostrar", () => {
  it("asks for confirmation before hiding, explaining what changes, without mutating yet", async () => {
    renderPage();

    const juniorRow = await findTarifaRow("Junior");
    fireEvent.click(within(juniorRow).getByRole("button", { name: /^ocultar$/i }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/¿ocultar «junior»\?/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/siguen pagando igual/i)).toBeInTheDocument();
    expect(mockActualizarTipoMembresia).not.toHaveBeenCalled();
  });

  it("hides a tariff via PATCH activo:false only after confirming, and shows it hidden", async () => {
    mockActualizarTipoMembresia.mockResolvedValueOnce({ ...JUNIOR, activo: false });
    renderPage();

    const juniorRow = await findTarifaRow("Junior");
    fireEvent.click(within(juniorRow).getByRole("button", { name: /^ocultar$/i }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^ocultar$/i }));

    await waitFor(() => {
      expect(mockActualizarTipoMembresia).toHaveBeenCalledWith(1, { activo: false });
    });
    const hiddenRow = await findTarifaRow("Junior");
    await waitFor(() => expect(within(hiddenRow).getByText("Oculta")).toBeInTheDocument());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("leaves the tariff untouched when the hide confirmation is canceled", async () => {
    renderPage();

    const juniorRow = await findTarifaRow("Junior");
    fireEvent.click(within(juniorRow).getByRole("button", { name: /^ocultar$/i }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /cancelar/i }));

    expect(mockActualizarTipoMembresia).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows a hidden tariff again with one click and no dialog", async () => {
    mockFetchTiposMembresia.mockResolvedValue([JUNIOR, ADFA]);
    mockActualizarTipoMembresia.mockResolvedValueOnce({ ...ADFA, activo: true });
    renderPage();

    const adfaRow = await findTarifaRow("ADFA");
    fireEvent.click(within(adfaRow).getByRole("button", { name: /^mostrar$/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(mockActualizarTipoMembresia).toHaveBeenCalledWith(4, { activo: true });
    });
    const shownRow = await findTarifaRow("ADFA");
    await waitFor(() => expect(within(shownRow).queryByText("Oculta")).not.toBeInTheDocument());
  });

  it("dresses a hidden card as hidden: pill, sunken background and the explanatory note", async () => {
    mockFetchTiposMembresia.mockResolvedValue([JUNIOR, ADFA]);
    renderPage();

    const adfaRow = await findTarifaRow("ADFA");
    expect(within(adfaRow).getByText("Oculta")).toBeInTheDocument();
    expect(within(adfaRow).queryByText("Mensual")).not.toBeInTheDocument();
    expect(
      within(adfaRow).getByText(
        /no aparece en la web ni en inscripciones\. los alumnos que ya la tienen siguen pagando igual\./i,
      ),
    ).toBeInTheDocument();
    expect(adfaRow).toHaveAttribute("data-oculta", "true");
    expect(adfaRow.className).toContain("bg-sunken");

    const juniorRow = await findTarifaRow("Junior");
    expect(within(juniorRow).getByText("Mensual")).toBeInTheDocument();
    expect(juniorRow).not.toHaveAttribute("data-oculta");
  });
});

describe("TarifasPage — eliminar", () => {
  it("offers Eliminar only on tariffs that were never used", async () => {
    mockFetchTiposMembresia.mockResolvedValue([JUNIOR, PRUEBA]);
    renderPage();

    const juniorRow = await findTarifaRow("Junior");
    const pruebaRow = await findTarifaRow("Prueba");
    expect(within(juniorRow).queryByRole("button", { name: /eliminar/i })).not.toBeInTheDocument();
    expect(within(pruebaRow).getByRole("button", { name: /eliminar/i })).toBeInTheDocument();
  });

  it("orders the actions Editar, Ocultar/Mostrar, Eliminar", async () => {
    mockFetchTiposMembresia.mockResolvedValue([PRUEBA]);
    renderPage();

    const row = await findTarifaRow("Prueba");
    const labels = within(row).getAllByRole("button").map((b) => b.textContent?.trim());
    expect(labels).toEqual(["Editar", "Ocultar", "Eliminar"]);
  });

  it("confirms with an irreversible warning, then DELETEs and removes the card", async () => {
    mockFetchTiposMembresia.mockResolvedValue([JUNIOR, PRUEBA]);
    mockEliminarTipoMembresia.mockResolvedValueOnce(undefined);
    renderPage();

    const pruebaRow = await findTarifaRow("Prueba");
    fireEvent.click(within(pruebaRow).getByRole("button", { name: /eliminar/i }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/¿eliminar «prueba»\?/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/no se puede deshacer/i)).toBeInTheDocument();
    expect(mockEliminarTipoMembresia).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: /^eliminar$/i }));

    await waitFor(() => expect(mockEliminarTipoMembresia).toHaveBeenCalledWith(3));
    await waitFor(() => expect(screen.queryByText("Prueba")).not.toBeInTheDocument());
    expect(screen.getAllByText("Junior").length).toBeGreaterThan(0);
  });

  it("shows the server's 409 message and keeps the card when the tariff turns out to be in use", async () => {
    mockFetchTiposMembresia.mockResolvedValue([JUNIOR, PRUEBA]);
    const { ApiClientError } = await import("@/services/api");
    mockEliminarTipoMembresia.mockRejectedValueOnce(
      new ApiClientError("No se puede eliminar la tarifa 'Prueba' porque ya se usó en membresías.", 409),
    );
    renderPage();

    const pruebaRow = await findTarifaRow("Prueba");
    fireEvent.click(within(pruebaRow).getByRole("button", { name: /eliminar/i }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^eliminar$/i }));

    expect((await screen.findAllByText(/porque ya se usó en membresías/i)).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Prueba").length).toBeGreaterThan(0);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("TarifasPage — resumen del catálogo", () => {
  it("counts and prices only the visible tariffs, and says how many are hidden", async () => {
    mockFetchTiposMembresia.mockResolvedValue([JUNIOR, SENIOR, ADFA]);
    renderPage();
    await findTarifaRow("Junior");

    const rail = screen.getByTestId("tarifas-rail");
    const summary = within(rail).getByRole("heading", { name: /resumen del catálogo/i }).parentElement as HTMLElement;
    expect(within(summary).getByText("2")).toBeInTheDocument();
    expect(within(summary).getByText("$ 45.00 – $ 60.00")).toBeInTheDocument();
    expect(within(summary).getByText(/1 oculta/i)).toBeInTheDocument();
  });

  it("does not mention hidden tariffs when there are none", async () => {
    renderPage();
    await findTarifaRow("Junior");

    expect(within(screen.getByTestId("tarifas-rail")).queryByText(/\d+ ocultas?/i)).not.toBeInTheDocument();
  });
});

describe("TarifasPage — tarjetas sin estirar", () => {
  it("keeps the usage cards at their natural height: no flex-1 on the list, no leftover-height grid on the column", async () => {
    mockFetchTiposMembresia.mockResolvedValue([JUNIOR, SENIOR]);
    renderPage();
    await findTarifaRow("Junior");

    const usage = screen.getByTestId("tarifas-usage");
    const list = usage.querySelector("ul") as HTMLElement;
    expect(list.className).not.toContain("flex-1");

    const column = usage.parentElement as HTMLElement;
    expect(column.className).not.toContain("grid-rows-[auto_1fr]");
    expect(column.className).not.toContain("min-h-[calc");
    expect(usage.className).not.toContain("flex-1");
  });

  it("does not reserve a tall dead block for the 'Agregar tarifa' placeholder", async () => {
    renderPage();
    await findTarifaRow("Junior");

    const placeholder = screen.getByRole("button", { name: /agregar tarifa/i });
    expect(placeholder.className).not.toMatch(/min-h-56/);
  });
});
