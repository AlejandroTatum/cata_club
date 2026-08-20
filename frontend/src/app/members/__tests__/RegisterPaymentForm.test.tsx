/**
 * Issue #465 — the "El comprobante de transferencia es obligatorio." error
 * shown after a failed "Registrar pago" submit was visually correct but
 * programmatically invisible: the message had no `id`, no ancestor up to the
 * enclosing `<dialog>` carried `role="alert"`/`role="status"`/`aria-live`,
 * the voucher `<input type="file">` had neither `aria-describedby` nor
 * `aria-invalid`, and focus stayed on "Registrar pago" instead of moving to
 * announce the failure. A screen-reader admin got total silence.
 *
 * This form's voucher `<input>` is visually hidden (`className="hidden"`,
 * i.e. `display:none`) behind a "Seleccionar archivo" button — a display:none
 * element cannot receive focus in any browser, so the fix moves focus to the
 * error message itself (a valid alternative the issue explicitly allows) and
 * still wires `aria-describedby`/`aria-invalid` onto the file input as asked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import RegisterPaymentForm from "../RegisterPaymentForm";
import type { MemberStudentSummary } from "../members-utils";

const mockRegistrarPago = vi.fn();
const mockSubirVoucherPago = vi.fn();

vi.mock("@/services/api", () => ({
  registrarPago: (data: unknown) => mockRegistrarPago(data),
  subirVoucherPago: (pagoId: number, archivo: File) => mockSubirVoucherPago(pagoId, archivo),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }),
}));

const MEMBRESIA: NonNullable<MemberStudentSummary["membresia"]> = {
  tipo: "Mensual",
  estado: "activa",
  fechaInicio: "2026-01-01",
  fechaFin: "2026-12-31",
  monto: 25,
  id: 54,
};

function fileInput(): HTMLInputElement {
  // The voucher input has no accessible name of its own (it is visually
  // hidden behind the "Seleccionar archivo" button), so it can only be found
  // by its type.
  return document.querySelector('input[type="file"]') as HTMLInputElement;
}

function openAndSubmitEmpty(): void {
  render(<RegisterPaymentForm personaId={74} membresia={MEMBRESIA} />);
  fireEvent.click(screen.getByRole("button", { name: "Registrar pago" }));
  fireEvent.click(screen.getByRole("button", { name: "Registrar pago" }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RegisterPaymentForm — el error de comprobante faltante ya no es silencioso (#465)", () => {
  it("gives the error message its own id and role=alert", () => {
    openAndSubmitEmpty();

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("El comprobante de transferencia es obligatorio.");
    expect(alert.id).toBeTruthy();
  });

  it("wires the voucher input's aria-describedby to the error message and marks it invalid", () => {
    openAndSubmitEmpty();

    const alert = screen.getByRole("alert");
    expect(fileInput()).toHaveAttribute("aria-describedby", alert.id);
    expect(fileInput()).toHaveAttribute("aria-invalid", "true");
  });

  it("moves focus off 'Registrar pago' to announce the error", () => {
    openAndSubmitEmpty();

    expect(screen.queryByRole("button", { name: "Registrar pago" })).not.toHaveFocus();
    expect(screen.getByRole("alert")).toHaveFocus();
  });

  it("re-announces the same error on a second identical failed submit", () => {
    openAndSubmitEmpty();
    const alert = screen.getByRole("alert");

    // A real user has to move focus back to the button before clicking it
    // again — jsdom's fireEvent.click does not do that implicitly (see
    // PaymentsPage.test.tsx's voucher-viewer suite for the same caveat).
    const submit = screen.getByRole("button", { name: "Registrar pago" });
    submit.focus();
    fireEvent.click(submit);

    // Still announced, not silently stuck on the button a second time.
    expect(screen.getByRole("alert")).toHaveFocus();
    expect(alert).toBeInTheDocument();
  });

  it("clears the alert and the file input's aria wiring once the voucher is attached and the resubmit succeeds", async () => {
    mockRegistrarPago.mockResolvedValue({ id: 501 });
    mockSubirVoucherPago.mockResolvedValue({});
    openAndSubmitEmpty();
    expect(fileInput()).toHaveAttribute("aria-invalid", "true");

    const file = new File(["contenido"], "voucher.png", { type: "image/png" });
    fireEvent.change(fileInput(), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar pago" }));

    // `setError(null)` runs synchronously once validation passes, ahead of
    // the async `registrarPago` call — the silenced/invalid wiring drops
    // immediately, not only after the request resolves.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(fileInput()).not.toHaveAttribute("aria-invalid");
    expect(fileInput()).not.toHaveAttribute("aria-describedby");

    await waitFor(() => expect(mockRegistrarPago).toHaveBeenCalled());
    await waitFor(() => expect(mockSubirVoucherPago).toHaveBeenCalledWith(501, file));
  });
});
