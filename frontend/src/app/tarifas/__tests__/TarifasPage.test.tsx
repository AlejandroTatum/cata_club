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
};

const SENIOR: TipoMembresiaCatalogo = {
  id: 2,
  categoria: "Senior",
  precio: "60.00",
  modalidad: "MENSUAL",
};

function renderPage(): void {
  render(
    <ToastProvider>
      <TarifasPage />
    </ToastProvider>,
  );
}

/** Mirrors `findDescuentoRow` in DiscountsPage.test.tsx: jsdom renders both
 *  the `sm`+ table row and the below-`sm` card, so pick the `<tr>`. */
async function findTarifaRow(categoria: string): Promise<HTMLElement> {
  const matches = await screen.findAllByText(categoria);
  const row = matches.map((el) => el.closest("tr")).find(Boolean);
  return row as HTMLElement;
}

beforeEach(() => {
  mockFetchTiposMembresia.mockReset().mockResolvedValue([JUNIOR, SENIOR]);
  mockActualizarTipoMembresia.mockReset();
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
    fireEvent.click(within(juniorRow).getByRole("button", { name: /editar precio/i }));

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
    fireEvent.click(within(juniorRow).getByRole("button", { name: /editar precio/i }));
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
    fireEvent.click(within(juniorRow).getByRole("button", { name: /editar precio/i }));
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
    ["-5", "negativo"],
    ["abc", "no numérico"],
    ["45.999", "más de dos decimales"],
    ["", "vacío"],
  ])("rejects a %s price (%s) without reaching the API", async (valorInvalido) => {
    renderPage();

    const juniorRow = await findTarifaRow("Junior");
    fireEvent.click(within(juniorRow).getByRole("button", { name: /editar precio/i }));
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
    fireEvent.click(within(juniorRow).getByRole("button", { name: /editar precio/i }));
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
    fireEvent.click(within(juniorRow).getByRole("button", { name: /editar precio/i }));
    fireEvent.change(within(juniorRow).getByLabelText(/precio de junior/i), {
      target: { value: "999.00" },
    });
    fireEvent.click(within(juniorRow).getByRole("button", { name: /^cancelar$/i }));

    expect(within(juniorRow).queryByLabelText(/precio de junior/i)).not.toBeInTheDocument();
    expect(mockActualizarTipoMembresia).not.toHaveBeenCalled();
    expect(within(juniorRow).getByText("$ 45.00")).toBeInTheDocument();
  });
});
