import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import PaymentHistorySection from "../PaymentHistorySection";

const mockFetchPagosDePersona = vi.fn();

vi.mock("@/services/api", () => ({
  fetchPagosDePersona: (personaId: string) => mockFetchPagosDePersona(personaId),
}));

beforeEach(() => {
  mockFetchPagosDePersona.mockReset();
});

/**
 * Issue #615 — admin was limited to `student.ultimoPago` (a single payment)
 * in the members list; this is the full per-student history, opened from the
 * Pagos dialog. Reuses `describePagoEstado` (student/payments/payments-utils.ts)
 * for its status badge, the same three-state vocabulary already shipped and
 * tested on the student's own /student/payments screen.
 */
describe("PaymentHistorySection", () => {
  it("does not fetch until the toggle is opened — collapsed by default", () => {
    render(<PaymentHistorySection personaId={10} />);
    expect(mockFetchPagosDePersona).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /historial de pagos/i })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("fetches and renders every payment with its validation status badge on open", async () => {
    mockFetchPagosDePersona.mockResolvedValue([
      {
        id: 1,
        monto: "35.00",
        motivoRechazo: null,
        estadoPago: "APROBADO",
        tipoPago: "TRANSFERENCIA",
        fechaRegistro: "2026-06-01",
        fechaValidacion: "2026-06-02",
        fechaInicio: "2026-06-01",
        fechaFin: "2026-06-30",
        personaId: 10,
        membresiaId: 1,
        voucherUrl: "https://example.com/v1.png",
        voucherFormato: "png",
        descuentoValorAplicado: null,
        descuentoPorcentajeAplicado: null,
      },
      {
        id: 2,
        monto: "35.00",
        motivoRechazo: "Comprobante ilegible",
        estadoPago: "RECHAZADO",
        tipoPago: "TRANSFERENCIA",
        fechaRegistro: "2026-05-01",
        fechaValidacion: "2026-05-02",
        fechaInicio: "2026-05-01",
        fechaFin: "2026-05-31",
        personaId: 10,
        membresiaId: 1,
        voucherUrl: "https://example.com/v2.png",
        voucherFormato: "png",
        descuentoValorAplicado: null,
        descuentoPorcentajeAplicado: null,
      },
      {
        id: 3,
        monto: "35.00",
        motivoRechazo: null,
        estadoPago: "PENDIENTE_VALIDACION",
        tipoPago: "TRANSFERENCIA",
        fechaRegistro: "2026-07-01",
        fechaValidacion: null,
        fechaInicio: "2026-07-01",
        fechaFin: "2026-07-31",
        personaId: 10,
        membresiaId: 1,
        voucherUrl: null,
        voucherFormato: null,
        descuentoValorAplicado: null,
        descuentoPorcentajeAplicado: null,
      },
    ]);

    render(<PaymentHistorySection personaId={10} />);
    fireEvent.click(screen.getByRole("button", { name: /historial de pagos/i }));

    expect(mockFetchPagosDePersona).toHaveBeenCalledWith("10");

    // All three, no defaulting: an unresolved payment shows its own state,
    // never the reassuring "Aprobado" tone.
    await waitFor(() => {
      expect(screen.getByText("Aprobado")).toBeInTheDocument();
    });
    expect(screen.getByText("Rechazado")).toBeInTheDocument();
    expect(screen.getByText("Pendiente de validación")).toBeInTheDocument();
    // The rejection reason is real evidence the admin can act on, not omitted.
    expect(screen.getByText(/Comprobante ilegible/)).toBeInTheDocument();
  });

  it("shows the missing-proof warning for a transfer payment with no voucher, same token as the student screen", async () => {
    mockFetchPagosDePersona.mockResolvedValue([
      {
        id: 4,
        monto: "35.00",
        motivoRechazo: null,
        estadoPago: "PENDIENTE_VALIDACION",
        tipoPago: "TRANSFERENCIA",
        fechaRegistro: "2026-07-01",
        fechaValidacion: null,
        fechaInicio: "2026-07-01",
        fechaFin: "2026-07-31",
        personaId: 10,
        membresiaId: 1,
        voucherUrl: null,
        voucherFormato: null,
        descuentoValorAplicado: null,
        descuentoPorcentajeAplicado: null,
      },
    ]);

    render(<PaymentHistorySection personaId={10} />);
    fireEvent.click(screen.getByRole("button", { name: /historial de pagos/i }));

    await waitFor(() => {
      expect(screen.getByText("Falta el comprobante")).toBeInTheDocument();
    });
  });

  it("shows an explicit empty state instead of nothing, when the student has no payments", async () => {
    mockFetchPagosDePersona.mockResolvedValue([]);

    render(<PaymentHistorySection personaId={10} />);
    fireEvent.click(screen.getByRole("button", { name: /historial de pagos/i }));

    await waitFor(() => {
      expect(screen.getByText(/todavía no hay pagos registrados/i)).toBeInTheDocument();
    });
  });

  it("renders the backend's rejection message on screen, not just a generic failure", async () => {
    // A bare `new Error(...)` carries no `status`, so `toUserMessage` would
    // silently fall back to the generic fallback text — the exact mistake
    // this repo has been bitten by before (mocks without a `status` never
    // exercise the real message-passthrough path). `ApiClientError` is what
    // `services/api.ts` actually throws.
    const rejection = Object.assign(
      new Error("El historial de pagos no está disponible por ahora."),
      { status: 400 },
    );
    mockFetchPagosDePersona.mockRejectedValue(rejection);

    render(<PaymentHistorySection personaId={10} />);
    fireEvent.click(screen.getByRole("button", { name: /historial de pagos/i }));

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("El historial de pagos no está disponible por ahora.")).toBeInTheDocument();
  });

  it("does not re-fetch on a second open of an already-loaded history", async () => {
    mockFetchPagosDePersona.mockResolvedValue([]);
    render(<PaymentHistorySection personaId={10} />);
    const toggle = screen.getByRole("button", { name: /historial de pagos/i });

    fireEvent.click(toggle); // open — fetches
    await waitFor(() => expect(mockFetchPagosDePersona).toHaveBeenCalledTimes(1));
    fireEvent.click(toggle); // close
    fireEvent.click(toggle); // reopen

    expect(mockFetchPagosDePersona).toHaveBeenCalledTimes(1);
  });
});
