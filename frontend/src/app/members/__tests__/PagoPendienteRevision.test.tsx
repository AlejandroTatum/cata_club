/**
 * #1668 — approve or reject a pending payment from the member's own page,
 * through the same validation endpoint as the `/payments` queue.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import PagoPendienteRevision from "../PagoPendienteRevision";
import type { PagoPersona } from "@/services/api";

const mockValidarPago = vi.fn();

vi.mock("@/services/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/api")>();
  return { ...actual, validarPago: (id: number, body: unknown) => mockValidarPago(id, body) };
});
vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }),
}));

function pago(overrides: Partial<PagoPersona> = {}): PagoPersona {
  return {
    id: 91,
    monto: "25.00",
    motivoRechazo: null,
    estadoPago: "PENDIENTE_VALIDACION",
    tipoPago: "TRANSFERENCIA",
    fechaRegistro: "2026-10-06T10:00:00",
    fechaValidacion: null,
    fechaInicio: "2026-10-01",
    fechaFin: "2026-10-31",
    personaId: 7,
    membresiaId: 3,
    voucherUrl: "https://files.example/voucher.pdf",
    voucherFormato: "pdf",
    ...overrides,
  } as PagoPersona;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockValidarPago.mockResolvedValue(pago({ estadoPago: "APROBADO" }));
});

describe("PagoPendienteRevision", () => {
  it("shows the amount, method, period in words and a link to the voucher", () => {
    render(<PagoPendienteRevision pago={pago()} onResolved={vi.fn()} />);

    expect(screen.getByText("$25,00")).toBeInTheDocument();
    expect(screen.getByText("Transferencia")).toBeInTheDocument();
    expect(screen.getByText("octubre 2026")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /ver comprobante/i })).toHaveAttribute("href", "https://files.example/voucher.pdf");
  });

  it("«Aprobar pago» calls the validation endpoint and tells the page to refresh", async () => {
    const onResolved = vi.fn();
    render(<PagoPendienteRevision pago={pago()} onResolved={onResolved} />);
    fireEvent.click(screen.getByRole("button", { name: "Aprobar pago" }));

    await waitFor(() => expect(onResolved).toHaveBeenCalledTimes(1));
    expect(mockValidarPago).toHaveBeenCalledWith(91, { estadoPago: "APROBADO" });
  });

  it("rejecting needs a reason first and sends it to the same endpoint", async () => {
    const onResolved = vi.fn();
    render(<PagoPendienteRevision pago={pago()} onResolved={onResolved} />);
    fireEvent.click(screen.getByRole("button", { name: "Rechazar pago…" }));

    const confirm = screen.getByRole("button", { name: "Rechazar y avisar" });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: /^El monto no coincide/ }));
    fireEvent.click(confirm);

    await waitFor(() => expect(onResolved).toHaveBeenCalledTimes(1));
    expect(mockValidarPago).toHaveBeenCalledWith(91, { estadoPago: "RECHAZADO", motivoRechazo: "El monto no coincide" });
  });

  it("a transfer without voucher needs the audited exception reason before approving", async () => {
    render(<PagoPendienteRevision pago={pago({ voucherUrl: null })} onResolved={vi.fn()} />);

    const approve = screen.getByRole("button", { name: "Aprobar pago" });
    expect(approve).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/por qué lo apruebas sin comprobante/i), { target: { value: "Lo vio el tesorero" } });
    expect(approve).toBeEnabled();
    fireEvent.click(approve);

    await waitFor(() => expect(mockValidarPago).toHaveBeenCalledWith(91, {
      estadoPago: "APROBADO",
      motivoExcepcionSinComprobante: "Lo vio el tesorero",
    }));
  });

  it("a cash payment needs no voucher to be approved", () => {
    render(<PagoPendienteRevision pago={pago({ tipoPago: "EFECTIVO", voucherUrl: null })} onResolved={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Aprobar pago" })).toBeEnabled();
  });

  it("says why it failed and does not refresh the page", async () => {
    mockValidarPago.mockRejectedValue(new Error("boom"));
    const onResolved = vi.fn();
    render(<PagoPendienteRevision pago={pago()} onResolved={onResolved} />);
    fireEvent.click(screen.getByRole("button", { name: "Aprobar pago" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(onResolved).not.toHaveBeenCalled();
  });
});
