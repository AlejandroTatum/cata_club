/**
 * #1668 / S4 — correcting an APPROVED payment from the member's payments page:
 * amount, months and covered dates (start/end) plus a required reason, through
 * the existing `POST /membresias/pagos/{id}/corregir`. The `/payments` queue
 * keeps the amount-only form (ADMA-16, asserted in `PaymentsPage.test.tsx`);
 * `extended` is what turns the rest on.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import PagoCorreccionSection from "../PagoCorreccionSection";

const mockFetchPagoDetalle = vi.fn();
const mockFetchCorrecciones = vi.fn();
const mockCorregirPago = vi.fn();
const mockShowError = vi.fn();

vi.mock("@/services/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/api")>();
  return {
    ...actual,
    fetchPagoDetalle: (id: number) => mockFetchPagoDetalle(id),
    fetchCorrecciones: (id: number) => mockFetchCorrecciones(id),
    corregirPago: (id: number, datos: unknown) => mockCorregirPago(id, datos),
  };
});
vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ showSuccess: vi.fn(), showError: mockShowError, showToast: vi.fn(), showInfo: vi.fn(), showWarning: vi.fn() }),
}));

const PAGO = {
  id: 9,
  monto: "50.00",
  estadoPago: "APROBADO",
  fechaInicio: "2026-07-01",
  fechaFin: "2026-09-01",
  comprobanteOficialUrl: null,
};

const CORRECCION = {
  id: 1,
  pagoId: 9,
  tarifaMensualAplicadaAnterior: null,
  tarifaMensualAplicadaNuevo: null,
  mesesCompradosAnterior: 2,
  mesesCompradosNuevo: 1,
  montoBaseAnterior: null,
  montoBaseNuevo: null,
  montoAnterior: "50.00",
  montoNuevo: "25.00",
  fechaInicioAnterior: "2026-07-01",
  fechaInicioNuevo: "2026-07-01",
  fechaFinAnterior: "2026-09-01",
  fechaFinNuevo: "2026-08-01",
  efectoCobertura: "REDUCIDA",
  motivo: "Se cobró un mes de más",
  actorPersonaId: 1,
  fechaRegistro: "2026-09-02T10:00:00",
};

async function renderExtended(onCorrected = vi.fn()): Promise<void> {
  render(<PagoCorreccionSection pagoId={9} onCorrected={onCorrected} extended initialOpen />);
  await screen.findByRole("button", { name: /registrar corrección/i });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchPagoDetalle.mockResolvedValue(PAGO);
  mockFetchCorrecciones.mockResolvedValue([]);
});

describe("PagoCorreccionSection — extended (amount, months, dates)", () => {
  it("offers amount, months, start and end dates plus a required reason, prefilled with what the payment says now", async () => {
    await renderExtended();

    expect(screen.getByLabelText(/^monto/i)).toHaveValue(50);
    expect(screen.getByLabelText(/^meses/i)).toHaveValue(null);
    expect(screen.getByLabelText(/^desde/i)).toHaveValue("2026-07-01");
    expect(screen.getByLabelText(/^hasta/i)).toHaveValue("2026-09-01");
    expect(screen.getByLabelText(/^motivo/i)).toBeRequired();
    expect(screen.getByText(/solo lo que está mal/i)).toBeInTheDocument();
    expect(screen.getByText(/si te equivocaste de mes, cambia las fechas/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Corregir el pago de $50,00 del 01/07 al 01/09" })).toBeInTheDocument();
  });

  it("keeps «Registrar corrección» off until something changed AND a reason is given", async () => {
    await renderExtended();
    const submit = screen.getByRole("button", { name: /registrar corrección/i });

    fireEvent.change(screen.getByLabelText(/^motivo/i), { target: { value: "Probando" } });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/^hasta/i), { target: { value: "2026-08-01" } });
    expect(submit).toBeEnabled();
    expect(screen.getByText("Hasta: 01/09/2026 → 01/08/2026")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^motivo/i), { target: { value: "  " } });
    expect(submit).toBeDisabled();
  });

  it("sends months, dates and amount with the reason — and ONLY what changed", async () => {
    mockCorregirPago.mockResolvedValue({ pago: PAGO, correccion: CORRECCION });
    const onCorrected = vi.fn();
    await renderExtended(onCorrected);

    fireEvent.change(screen.getByLabelText(/^monto/i), { target: { value: "25.00" } });
    fireEvent.change(screen.getByLabelText(/^meses/i), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText(/^hasta/i), { target: { value: "2026-08-01" } });
    fireEvent.change(screen.getByLabelText(/^motivo/i), { target: { value: "Se cobró un mes de más" } });
    fireEvent.click(screen.getByRole("button", { name: /registrar corrección/i }));

    await waitFor(() =>
      expect(mockCorregirPago).toHaveBeenCalledWith(9, {
        motivo: "Se cobró un mes de más",
        monto: "25.00",
        mesesComprados: 1,
        fechaFin: "2026-08-01",
      }),
    );
    // The start date was left alone, so it is not part of the correction.
    expect(mockCorregirPago.mock.calls[0][1]).not.toHaveProperty("fechaInicio");
    await waitFor(() => expect(onCorrected).toHaveBeenCalled());
  });

  it("surfaces the backend's overlap / continuity message next to the form and keeps what was typed", async () => {
    const { ApiClientError } = await import("@/services/api");
    mockCorregirPago.mockRejectedValue(
      new ApiClientError(
        "El período corregido se superpone o rompe la continuidad con la cobertura de otro pago aprobado, o de un beneficio bonificado, de esta membresía.",
        400,
      ),
    );
    await renderExtended();
    fireEvent.change(screen.getByLabelText(/^hasta/i), { target: { value: "2026-12-01" } });
    fireEvent.change(screen.getByLabelText(/^motivo/i), { target: { value: "Se extendió" } });
    fireEvent.click(screen.getByRole("button", { name: /registrar corrección/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/se superpone o rompe la continuidad/i);
    expect(screen.getByLabelText(/^hasta/i)).toHaveValue("2026-12-01");
    expect(screen.getByLabelText(/^motivo/i)).toHaveValue("Se extendió");
  });

  it("shows the correction history with the months and dates that changed", async () => {
    mockFetchCorrecciones.mockResolvedValue([CORRECCION]);
    await renderExtended();

    const entry = (await screen.findByText(/se cobró un mes de más/i)).closest("li") as HTMLElement;
    expect(within(entry).getByText(/meses: 2 → 1/i)).toBeInTheDocument();
    expect(within(entry).getByText(/hasta: 01\/09\/2026 → 01\/08\/2026/i)).toBeInTheDocument();
    expect(within(entry).getByText(/monto: \$\s?50,00 → \$\s?25,00/i)).toBeInTheDocument();
    expect(within(entry).queryByText(/desde:/i)).not.toBeInTheDocument();
  });

  it("the queue's default form stays amount-only", async () => {
    render(<PagoCorreccionSection pagoId={9} onCorrected={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /corregir pago/i }));

    expect(screen.getByLabelText(/monto correcto/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/meses comprados/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/fecha inicio/i)).not.toBeInTheDocument();
  });
});
