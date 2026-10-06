/**
 * QA round 2 (L17): «Socio antiguo» — the admin loads the last payment date and
 * the existing regularization registers the period (último pago → +1 month).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import MigrarSocioAntiguoForm from "../MigrarSocioAntiguoForm";
import { ApiClientError } from "@/services/api";

const mockCrearMembresia = vi.fn();
const mockCotizacion = vi.fn();
const mockRegularizar = vi.fn();
const mockBeneficio = vi.fn();
const showSuccess = vi.fn();
const showError = vi.fn();

vi.mock("@/services/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/api")>();
  return {
    ...actual,
    crearMembresia: (data: unknown) => mockCrearMembresia(data),
    fetchCotizacionRegularizacion: (...args: unknown[]) => mockCotizacion(...args),
    regularizarDeuda: (...args: unknown[]) => mockRegularizar(...args),
    fetchBeneficio: (personaId: number) => mockBeneficio(personaId),
    fetchTiposMembresia: () =>
      Promise.resolve([{ id: 2, categoria: "Mensual", precio: "30.00", modalidad: "MENSUAL" }]),
  };
});
vi.mock("@/contexts/ToastContext", () => ({ useToast: () => ({ showSuccess, showError }) }));
vi.mock("@/lib/club-date", () => ({ clubIsoDate: () => "2026-10-05" }));

beforeEach(() => {
  vi.clearAllMocks();
  mockBeneficio.mockResolvedValue(null);
  mockCrearMembresia.mockResolvedValue({ id: 55 });
  mockCotizacion.mockResolvedValue({
    meses: 1, montoBase: "30.00", descuentoAplicado: "0.00", montoEsperado: "30.00", tieneBeneficio: false,
  });
  mockRegularizar.mockResolvedValue({ id: 900 });
});

interface Handlers { onDone: ReturnType<typeof vi.fn>; onRefetch: ReturnType<typeof vi.fn>; }

async function renderForm(membresiaId?: number): Promise<Handlers> {
  const handlers = { onDone: vi.fn(), onRefetch: vi.fn() };
  render(<MigrarSocioAntiguoForm personaId={7} membresiaId={membresiaId} onBack={vi.fn()} {...handlers} />);
  await waitFor(() => expect(mockBeneficio).toHaveBeenCalledWith(7));
  return handlers;
}

async function pickPlan(): Promise<void> {
  await screen.findByRole("option", { name: /mensual/i });
  fireEvent.change(screen.getByLabelText(/^Plan/), { target: { value: "2" } });
}

function ultimoPago(value: string): void {
  fireEvent.change(screen.getByLabelText(/^Fecha de su último pago/), { target: { value } });
}

const registrar = () => fireEvent.click(screen.getByRole("button", { name: "Registrar socio antiguo" }));

describe("MigrarSocioAntiguoForm", () => {
  it("asks only for the last payment date (no «Socio desde»), capped at today, and gates the button", async () => {
    await renderForm(55);

    expect(screen.getByLabelText(/^Fecha de su último pago/)).toHaveAttribute("max", "2026-10-05");
    expect(screen.queryByLabelText(/socio desde/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Plan/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Registrar socio antiguo" })).toBeDisabled();
    ultimoPago("2026-09-20");
    expect(screen.getByRole("button", { name: "Registrar socio antiguo" })).toBeEnabled();
  });

  it("with no membership: creates it, quotes, regularizes último pago → +1 month and says «Al día hasta»", async () => {
    const { onDone } = await renderForm();
    await pickPlan();
    ultimoPago("2026-09-20");
    registrar();

    await waitFor(() => expect(onDone).toHaveBeenCalledWith("Al día hasta 20/10/2026"));
    expect(mockCrearMembresia).toHaveBeenCalledWith({ personaId: 7, tipoMembresiaId: 2 });
    expect(mockCotizacion).toHaveBeenCalledWith(55, "2026-09-20", "2026-10-20", undefined);
    expect(mockRegularizar).toHaveBeenCalledWith(55, {
      monto: 30,
      fechaInicio: "2026-09-20",
      fechaFin: "2026-10-20",
      motivo: "Migración: socio antiguo",
    });
    expect(mockCrearMembresia.mock.invocationCallOrder[0]).toBeLessThan(mockRegularizar.mock.invocationCallOrder[0]);
    expect(showSuccess).toHaveBeenCalledWith("Socio antiguo registrado. Al día hasta 20/10/2026.");
  });

  it("with an existing INACTIVA membership: does not create another one", async () => {
    const { onDone } = await renderForm(55);
    ultimoPago("2026-09-20");
    registrar();

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mockCrearMembresia).not.toHaveBeenCalled();
    expect(mockRegularizar).toHaveBeenCalledWith(55, expect.objectContaining({ fechaInicio: "2026-09-20" }));
  });

  it("says «Debe desde» when the paid month already ended", async () => {
    const { onDone } = await renderForm(55);
    ultimoPago("2026-07-31");
    registrar();

    await waitFor(() => expect(onDone).toHaveBeenCalledWith("Debe desde 31/08/2026"));
    expect(mockRegularizar).toHaveBeenCalledWith(55, expect.objectContaining({ fechaFin: "2026-08-31" }));
  });

  it("clamps the end to the last day of a shorter month (31 ene → 28 feb)", async () => {
    const { onDone } = await renderForm(55);
    ultimoPago("2026-01-31");
    registrar();

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mockCotizacion).toHaveBeenCalledWith(55, "2026-01-31", "2026-02-28", undefined);
  });

  it("rejects a future date in Spanish and calls nothing", async () => {
    await renderForm(55);
    ultimoPago("2026-10-06");
    registrar();

    expect(await screen.findByText("La fecha del último pago no puede ser futura.")).toBeInTheDocument();
    expect(mockCotizacion).not.toHaveBeenCalled();
    expect(mockRegularizar).not.toHaveBeenCalled();
  });

  it("asks for the plan when there is no membership", async () => {
    await renderForm();
    ultimoPago("2026-09-20");
    registrar();

    expect(await screen.findByText("Elige el plan del socio.")).toBeInTheDocument();
    expect(mockCrearMembresia).not.toHaveBeenCalled();
  });

  it("offers «Valor normal / Aplicar descuento» only with an active benefit and sends the choice", async () => {
    mockBeneficio.mockResolvedValue({ id: 1 });
    const { onDone } = await renderForm(55);

    expect(await screen.findByRole("radio", { name: "Aplicar descuento" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "Valor normal" }));
    ultimoPago("2026-09-20");
    registrar();

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mockCotizacion).toHaveBeenCalledWith(55, "2026-09-20", "2026-10-20", false);
    expect(mockRegularizar).toHaveBeenCalledWith(55, expect.objectContaining({ aplicarDescuento: false }));
  });

  it("shows no discount choice for a member without a benefit", async () => {
    await renderForm(55);
    expect(screen.queryByRole("radio", { name: "Valor normal" })).not.toBeInTheDocument();
  });

  it("keeps the form editable when creating the membership fails, and never regularizes", async () => {
    mockCrearMembresia.mockRejectedValue(new ApiClientError("Ya tiene una membresía activa.", 409, true));
    const { onDone } = await renderForm();
    await pickPlan();
    ultimoPago("2026-09-20");
    registrar();

    expect(await screen.findByText("Ya tiene una membresía activa.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Fecha de su último pago/)).toBeEnabled();
    expect(mockRegularizar).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("explains a regularization failure after creation, stays editable and retries WITHOUT creating again", async () => {
    mockRegularizar.mockRejectedValueOnce(
      new ApiClientError("El período se solapa con una cobertura ya registrada.", 400, true),
    );
    const { onDone } = await renderForm();
    await pickPlan();
    ultimoPago("2026-09-20");
    registrar();

    const aviso = await screen.findByText(/La membresía se creó, pero no se pudo registrar el último pago/);
    expect(aviso).toHaveTextContent("El período se solapa con una cobertura ya registrada.");
    expect(aviso).toHaveTextContent("Cargar pagos atrasados");
    expect(onDone).not.toHaveBeenCalled();

    ultimoPago("2026-09-25");
    registrar();

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mockCrearMembresia).toHaveBeenCalledTimes(1);
    expect(mockRegularizar).toHaveBeenLastCalledWith(55, expect.objectContaining({ fechaInicio: "2026-09-25" }));
  });

  it("after a partial failure the admin can close and go to «Cargar pagos atrasados» (refetch)", async () => {
    mockCotizacion.mockRejectedValueOnce(new ApiClientError("No se pudo calcular el monto.", 400, true));
    const { onRefetch } = await renderForm();
    await pickPlan();
    ultimoPago("2026-09-20");
    registrar();
    await screen.findByText(/La membresía se creó/);

    fireEvent.click(screen.getByRole("button", { name: /Cerrar y usar Cargar pagos atrasados/ }));

    expect(onRefetch).toHaveBeenCalled();
    expect(mockRegularizar).not.toHaveBeenCalled();
  });

  it("a failure on an already-existing membership does not claim it was just created", async () => {
    mockRegularizar.mockRejectedValueOnce(new ApiClientError("El período se solapa.", 400, true));
    await renderForm(55);
    ultimoPago("2026-09-20");
    registrar();

    const aviso = await screen.findByText("El período se solapa.");
    expect(aviso).not.toHaveTextContent("se creó");
  });
});
