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

beforeEach(() => {
  mockFetchDescuentos.mockReset().mockResolvedValue([BECA, CONVENIO]);
  mockCrearDescuento.mockReset();
  mockActualizarDescuento.mockReset();
});

describe("DiscountsPage — listado", () => {
  it("lists active and inactive discounts, visually distinct", async () => {
    renderPage();

    const becaRow = (await screen.findByText("Beca municipal")).closest("tr") as HTMLElement;
    const convenioRow = screen.getByText("Convenio empresa").closest("tr") as HTMLElement;

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

  it("shows an error state with retry when loading fails", async () => {
    mockFetchDescuentos.mockRejectedValueOnce(new Error("caído"));
    renderPage();

    const retry = await screen.findByRole("button", { name: /reintentar/i });
    mockFetchDescuentos.mockResolvedValue([BECA]);
    fireEvent.click(retry);

    expect(await screen.findByText("Beca municipal")).toBeInTheDocument();
  });
});

describe("DiscountsPage — crear", () => {
  it("creates a percentage discount from the form", async () => {
    mockCrearDescuento.mockResolvedValueOnce({ ...BECA, id: 3, nombre: "Media beca", porcentaje: "50" });
    renderPage();
    await screen.findByText("Beca municipal");

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
    await screen.findByText("Beca municipal");

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
    await screen.findByText("Beca municipal");

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
    await screen.findByText("Beca municipal");

    fireEvent.click(screen.getByRole("button", { name: /nuevo descuento/i }));
    fireEvent.change(screen.getByLabelText(/nombre/i), { target: { value: "Inválido" } });
    fireEvent.click(screen.getByRole("button", { name: /^crear$/i }));

    expect(await screen.findByText(/mayor a 0/i)).toBeInTheDocument();
    expect(mockCrearDescuento).not.toHaveBeenCalled();
  });
});

describe("DiscountsPage — editar", () => {
  it("edits a discount pre-filling its current values", async () => {
    mockActualizarDescuento.mockResolvedValueOnce({ ...BECA, porcentaje: "75" });
    renderPage();

    const becaRow = (await screen.findByText("Beca municipal")).closest("tr") as HTMLElement;
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
  it("deactivates an active discount via PATCH activo:false", async () => {
    mockActualizarDescuento.mockResolvedValueOnce({ ...BECA, activo: false });
    renderPage();

    const becaRow = (await screen.findByText("Beca municipal")).closest("tr") as HTMLElement;
    fireEvent.click(within(becaRow).getByRole("button", { name: /desactivar/i }));

    await waitFor(() => {
      expect(mockActualizarDescuento).toHaveBeenCalledWith(1, { activo: false });
    });
  });

  it("reactivates an inactive discount via PATCH activo:true", async () => {
    mockActualizarDescuento.mockResolvedValueOnce({ ...CONVENIO, activo: true });
    renderPage();

    const convenioRow = (await screen.findByText("Convenio empresa")).closest("tr") as HTMLElement;
    fireEvent.click(within(convenioRow).getByRole("button", { name: /reactivar/i }));

    await waitFor(() => {
      expect(mockActualizarDescuento).toHaveBeenCalledWith(2, { activo: true });
    });
  });
});

// ---------------------------------------------------------------------------
// The rail
// ---------------------------------------------------------------------------

describe("DiscountsPage — la segunda columna", () => {
  it("keeps the two columns whether or not a form is open", async () => {
    // A split that appears with the form is a layout that moves under the
    // admin every time they press "Editar" — the defect #81 removed from the
    // dashboard, which is not worth reintroducing here.
    renderPage();
    await screen.findByText("Beca municipal");

    const rail = screen.getByTestId("discounts-split");
    expect(rail.className).toBe(PAGE_RAIL);

    fireEvent.click(screen.getByRole("button", { name: /nuevo descuento/i }));
    expect(screen.getByTestId("discounts-split").className).toBe(PAGE_RAIL);
  });

  it("puts the form beside the table, not above it", async () => {
    // The assertion that carries the weight: the table and the form are
    // SIBLINGS in the split, so opening one cannot push the other down. It
    // used to render between the page header and the catalog.
    renderPage();
    const becaRow = (await screen.findByText("Beca municipal")).closest("tr") as HTMLElement;

    fireEvent.click(within(becaRow).getByRole("button", { name: /editar/i }));

    const split = screen.getByTestId("discounts-split");
    const form = screen.getByLabelText(/nombre/i).closest("[data-testid='discounts-rail']");
    const table = screen.getByRole("table");

    expect(form).not.toBeNull();
    expect(split.contains(table)).toBe(true);
    expect(form?.contains(table)).toBe(false);
  });

  it("answers the missing delete button when no form is open", async () => {
    // There is no "Eliminar" anywhere on this screen and there never will be:
    // applied discounts reference the catalog by FK. Until now that rule lived
    // only in a source comment.
    renderPage();
    await screen.findByText("Beca municipal");

    const rail = screen.getByTestId("discounts-rail");
    expect(within(rail).getByText(/Cómo funciona el catálogo/i)).toBeInTheDocument();
    expect(within(rail).getByText(/no se elimina/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /nuevo descuento/i }));

    // The rail holds one thing at a time: the form replaces the rules.
    expect(screen.queryByText(/Cómo funciona el catálogo/i)).not.toBeInTheDocument();
  });
});
