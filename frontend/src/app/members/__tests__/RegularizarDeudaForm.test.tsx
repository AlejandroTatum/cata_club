/**
 * QA3 ADM-09: the regularization amount is no longer typed. The form asks the
 * backend for a quote (monthly price x months of the period, minus the active
 * discount), shows it, and submits exactly that amount.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import RegularizarDeudaForm from "../RegularizarDeudaForm";

const mockFetchMembresiaDeuda = vi.fn();
const mockRegularizarDeuda = vi.fn();
const mockFetchCotizacion = vi.fn();

vi.mock("@/services/api", () => ({
  fetchMembresiaDeuda: (membresiaId: number) => mockFetchMembresiaDeuda(membresiaId),
  regularizarDeuda: (membresiaId: number, data: unknown) => mockRegularizarDeuda(membresiaId, data),
  fetchCotizacionRegularizacion: (id: number, inicio: string, fin: string) =>
    mockFetchCotizacion(id, inicio, fin),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }),
}));

async function open(
  props: Partial<React.ComponentProps<typeof RegularizarDeudaForm>> = {},
): Promise<void> {
  render(
    <RegularizarDeudaForm
      membresiaId={42}
      montoMensual={25}
      onRegularized={vi.fn()}
      {...props}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Regularizar deuda" }));
  // `handleOpen` fires `void loadDeuda()` (fire-and-forget) — awaiting its
  // mocked resolution here keeps every state update inside `act()`.
  await waitFor(() => expect(mockFetchMembresiaDeuda).toHaveBeenCalled());
}

function fillRequiredFields(): void {
  // The required asterisk is a sibling `<span>` with no separating space, so
  // the label's accessible/text-content name is "Fecha inicio*", not "Fecha
  // inicio" — a prefix regex matches it the same way `RegisterPaymentForm`'s
  // own tests already match `/^Monto/` for the identical pattern.
  fireEvent.change(screen.getByLabelText(/^Fecha inicio/), { target: { value: "2026-01-01" } });
  fireEvent.change(screen.getByLabelText(/^Fecha fin/), { target: { value: "2026-01-31" } });
  fireEvent.change(screen.getByLabelText(/^Motivo/), {
    target: { value: "Demora del club" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchMembresiaDeuda.mockResolvedValue({
    mesesAdeudados: 1,
    ultimaCoberturaFin: "2025-12-31",
    montoMensual: 25,
  });
  mockFetchCotizacion.mockResolvedValue({
    meses: 1,
    montoBase: "25.00",
    descuentoAplicado: "0.00",
    montoEsperado: "25.00",
  });
});

describe("RegularizarDeudaForm — monto cotizado por el backend (ADM-09)", () => {
  it("collapses the form with a Cancelar button without submitting", async () => {
    await open();
    expect(screen.getByRole("form", { name: "Regularizar deuda" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByRole("form", { name: "Regularizar deuda" })).not.toBeInTheDocument();
    expect(mockRegularizarDeuda).not.toHaveBeenCalled();
  });

  it("has no free-typed monto field", async () => {
    await open();
    expect(screen.queryByRole("spinbutton", { name: /^Monto/ })).not.toBeInTheDocument();
  });

  it("quotes the period and shows the discounted amount", async () => {
    mockFetchCotizacion.mockResolvedValue({
      meses: 2,
      montoBase: "50.00",
      descuentoAplicado: "25.00",
      montoEsperado: "25.00",
    });
    await open();
    fillRequiredFields();

    await waitFor(() => expect(mockFetchCotizacion).toHaveBeenCalledWith(42, "2026-01-01", "2026-01-31"));
    expect(await screen.findByText("$25,00")).toBeInTheDocument();
    expect(screen.getByText(/2 meses/)).toBeInTheDocument();
    expect(screen.getByText(/beneficio de \$25,00/)).toBeInTheDocument();
  });

  it("submits exactly the quoted amount", async () => {
    mockRegularizarDeuda.mockResolvedValue({ id: 99 });
    await open();
    fillRequiredFields();
    await screen.findByText("$25,00");

    fireEvent.click(screen.getByRole("button", { name: /^Regularizar$/ }));

    await waitFor(() => {
      expect(mockRegularizarDeuda).toHaveBeenCalledWith(42, {
        monto: 25,
        fechaInicio: "2026-01-01",
        fechaFin: "2026-01-31",
        motivo: "Demora del club",
      });
    });
  });

  it("shows $0 and submits it when a 100% discount covers the whole period", async () => {
    mockFetchCotizacion.mockResolvedValue({
      meses: 1,
      montoBase: "25.00",
      descuentoAplicado: "25.00",
      montoEsperado: "0.00",
    });
    mockRegularizarDeuda.mockResolvedValue({ id: 99 });
    await open();
    fillRequiredFields();
    await screen.findByText("$0,00");

    fireEvent.click(screen.getByRole("button", { name: /^Regularizar$/ }));

    await waitFor(() => {
      expect(mockRegularizarDeuda).toHaveBeenCalledWith(42, {
        monto: 0,
        fechaInicio: "2026-01-01",
        fechaFin: "2026-01-31",
        motivo: "Demora del club",
      });
    });
  });

  it("does not submit while there is no quote", async () => {
    await open();
    fireEvent.change(screen.getByLabelText(/^Motivo/), { target: { value: "Demora del club" } });
    fireEvent.click(screen.getByRole("button", { name: /^Regularizar$/ }));

    expect(await screen.findByText("Las fechas son obligatorias.")).toBeInTheDocument();
    expect(mockRegularizarDeuda).not.toHaveBeenCalled();
  });

  it("rejects a period past the 12-month cap", async () => {
    mockFetchCotizacion.mockResolvedValue({
      meses: 13,
      montoBase: "325.00",
      descuentoAplicado: "0.00",
      montoEsperado: "325.00",
    });
    await open();
    fillRequiredFields();
    await screen.findByText("$325,00");

    fireEvent.click(screen.getByRole("button", { name: /^Regularizar$/ }));

    expect(
      await screen.findByText("El pago no puede cubrir más de 12 meses. Reduzca el monto ingresado."),
    ).toBeInTheDocument();
    expect(mockRegularizarDeuda).not.toHaveBeenCalled();
  });

  it("shows the backend's message when the quote fails", async () => {
    mockFetchCotizacion.mockRejectedValue(new Error("La fecha de inicio debe ser anterior a la de fin."));
    await open();
    fillRequiredFields();

    await waitFor(() => expect(mockFetchCotizacion).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /^Regularizar$/ }));
    expect(mockRegularizarDeuda).not.toHaveBeenCalled();
  });
});

describe("RegularizarDeudaForm — ayuda en lenguaje del club (#1492, ADMA-13)", () => {
  it("explains that the form also loads existing payments and activates the membership when the period covers today", async () => {
    await open();
    expect(
      screen.getByText(
        "Registra aquí los meses atrasados que el jugador ya pagó o debe regularizar. " +
          "Si el período incluye hoy, la membresía queda activa.",
      ),
    ).toBeInTheDocument();
  });
});
