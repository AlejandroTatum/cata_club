/**
 * Issue #666: `RegularizarDeudaForm`'s "Monto" field is the second unbounded
 * free-amount `<input type="number">` the issue names — an admin regularizing
 * debt could type 50,000,000 with no upper bound at all (the backend's
 * `RegularizacionDeudaDTO.monto` only checks `gt=0` and that it is a multiple
 * of the plan's monthly price; nothing caps how many months' worth it is).
 * This form does not compute a date from `monto` (fechaInicio/fechaFin are
 * typed independently), so there is no absurd preview date bug here — but the
 * amount itself must still respect the real, owner-confirmed 12-month cap
 * (`MAX_MESES_COBERTURA`), the same one `RegisterPaymentForm` enforces.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import RegularizarDeudaForm from "../RegularizarDeudaForm";

const mockFetchMembresiaDeuda = vi.fn();
const mockRegularizarDeuda = vi.fn();

vi.mock("@/services/api", () => ({
  fetchMembresiaDeuda: (membresiaId: number) => mockFetchMembresiaDeuda(membresiaId),
  regularizarDeuda: (membresiaId: number, data: unknown) => mockRegularizarDeuda(membresiaId, data),
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
});

describe("RegularizarDeudaForm — el monto no puede comprar más de 12 meses (#666)", () => {
  it("caps the monto input's max at 12 months of the known monthly price", async () => {
    await open();
    // 25 * 12 = 300.
    expect(screen.getByRole("spinbutton", { name: /^Monto/ })).toHaveAttribute("max", "300");
  });

  it("rejects an amount past the 12-month cap and does not submit it", async () => {
    await open();
    fillRequiredFields();
    // 25 * 13 = 325.
    fireEvent.change(screen.getByRole("spinbutton", { name: /^Monto/ }), {
      target: { value: "325" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Regularizar$/ }));

    expect(
      await screen.findByText("El pago no puede cubrir más de 12 meses. Reduzca el monto ingresado."),
    ).toBeInTheDocument();
    expect(mockRegularizarDeuda).not.toHaveBeenCalled();
  });

  it("accepts exactly the 12-month boundary", async () => {
    mockRegularizarDeuda.mockResolvedValue({ id: 99 });
    await open();
    fillRequiredFields();
    // 25 * 12 = 300.
    fireEvent.change(screen.getByRole("spinbutton", { name: /^Monto/ }), {
      target: { value: "300" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Regularizar$/ }));

    await waitFor(() => {
      expect(mockRegularizarDeuda).toHaveBeenCalledWith(
        42,
        expect.objectContaining({ monto: 300 }),
      );
    });
  });

  it("derives the same 12-month cap from the fetched debt price when the prop's price is not yet known", async () => {
    mockFetchMembresiaDeuda.mockResolvedValue({
      mesesAdeudados: 1,
      ultimaCoberturaFin: "2025-12-31",
      montoMensual: 40,
    });
    await open({ montoMensual: 0 });

    await waitFor(() => {
      // 40 * 12 = 480.
      expect(screen.getByRole("spinbutton", { name: /^Monto/ })).toHaveAttribute("max", "480");
    });
  });
});
