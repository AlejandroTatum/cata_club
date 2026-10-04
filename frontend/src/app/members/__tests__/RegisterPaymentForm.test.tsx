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
const mockRegistrarPagoPresencial = vi.fn();
const mockSubirVoucherPago = vi.fn();
const mockValidarPago = vi.fn();

vi.mock("@/services/api", () => ({
  // #1402: `registrarPago` is the ORIGINAL registration endpoint, kept for
  // renewals/subsequent payments; the in-person FIRST-inscription flow goes
  // through the dedicated admin-only `registrarPagoPresencial` instead.
  registrarPago: (data: unknown) => mockRegistrarPago(data),
  registrarPagoPresencial: (data: unknown) => mockRegistrarPagoPresencial(data),
  subirVoucherPago: (pagoId: number, archivo: File) => mockSubirVoucherPago(pagoId, archivo),
  validarPago: (pagoId: number, datos: unknown) => mockValidarPago(pagoId, datos),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }),
}));

/** #1402 FIRST-inscription fixture: `estadoBackend` INACTIVA is exactly the
 *  branch the form keys on — a membership that never activated, whose first
 *  payment goes through the in-person presencial flow. */
const MEMBRESIA: NonNullable<MemberStudentSummary["membresia"]> = {
  tipo: "Mensual",
  estado: "activa",
  fechaInicio: "2026-01-01",
  fechaFin: "2026-12-31",
  monto: 25,
  id: 54,
  estadoBackend: "INACTIVA",
};

function fileInput(): HTMLInputElement {
  // The voucher input has no accessible name of its own (it is visually
  // hidden behind the "Seleccionar archivo" button), so it can only be found
  // by its type.
  return document.querySelector('input[type="file"]') as HTMLInputElement;
}

/** ADMA-10: no method is preselected, so a transfer test has to choose it. */
function chooseTransfer(): void {
  fireEvent.click(screen.getByRole("radio", { name: "Transferencia" }));
}

function openAndSubmitEmpty(): void {
  render(<RegisterPaymentForm personaId={74} membresia={MEMBRESIA} />);
  fireEvent.click(screen.getByRole("button", { name: "Registrar pago" }));
  chooseTransfer();
  fireEvent.click(screen.getByRole("button", { name: "Registrar pago" }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RegisterPaymentForm — controls follow the md sizing standard (#539)", () => {
  it("uses 40px text-sm controls with standard padding and icons throughout Registrar pago", () => {
    render(<RegisterPaymentForm personaId={74} membresia={MEMBRESIA} />);

    const opener = screen.getByRole("button", { name: "Registrar pago" });
    expect(opener).toHaveClass("h-ctl", "text-sm", "px-4");
    expect(opener.querySelector("svg")).toHaveAttribute("width", "18");
    fireEvent.click(opener);
    chooseTransfer();

    expect(screen.getByRole("spinbutton")).toHaveClass("h-ctl", "text-sm", "px-3");
    // `min-h-ctl` and not `h-ctl` since #778: still the same 40px next to the
    // Monto field, but as a floor, so the group can grow when its two options
    // wrap on a narrow phone instead of clipping the second one.
    expect(screen.getByRole("radiogroup", { name: "Método de pago" })).toHaveClass("min-h-ctl", "text-sm", "px-3");

    const voucher = screen.getByRole("button", { name: "Seleccionar archivo" });
    expect(voucher).toHaveClass("h-ctl", "text-sm", "px-4");
    expect(voucher.querySelector("svg")).toHaveAttribute("width", "18");

    const submit = screen.getByRole("button", { name: "Registrar pago" });
    expect(submit).toHaveClass("h-ctl", "text-sm", "px-4");
    expect(submit.querySelector("svg")).toHaveAttribute("width", "18");
    expect(screen.getByRole("button", { name: "Cancelar" })).toHaveClass("h-ctl", "text-sm", "px-4");

    const file = new File(["contenido"], "voucher.png", { type: "image/png" });
    fireEvent.change(fileInput(), { target: { files: [file] } });
    expect(screen.getByRole("button", { name: "Quitar" })).toHaveClass("h-ctl", "text-sm", "px-3");
  });
});

describe("RegisterPaymentForm — ADMA-10: el admin elige el método, ninguno viene marcado", () => {
  it("opens with neither Efectivo nor Transferencia selected, and no voucher field yet", () => {
    render(<RegisterPaymentForm personaId={74} membresia={MEMBRESIA} />);
    fireEvent.click(screen.getByRole("button", { name: "Registrar pago" }));

    expect(screen.getByRole("radio", { name: "Efectivo" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Transferencia" })).not.toBeChecked();
    expect(fileInput()).not.toBeInTheDocument();
  });

  it("blocks saving with a clear message until a method is chosen", () => {
    render(<RegisterPaymentForm personaId={74} membresia={MEMBRESIA} />);
    fireEvent.click(screen.getByRole("button", { name: "Registrar pago" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: /^Monto/ }), { target: { value: "25" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar pago" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Elige cómo pagó: efectivo o transferencia.");
    expect(mockRegistrarPagoPresencial).not.toHaveBeenCalled();
    expect(mockRegistrarPago).not.toHaveBeenCalled();
  });

  it("lets the payment through once Efectivo is chosen", async () => {
    mockRegistrarPagoPresencial.mockResolvedValue({ id: 701, estadoPago: "APROBADO" });
    render(<RegisterPaymentForm personaId={74} membresia={MEMBRESIA} />);
    fireEvent.click(screen.getByRole("button", { name: "Registrar pago" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: /^Monto/ }), { target: { value: "25" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar pago" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Efectivo" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Registrar pago" }));

    await waitFor(() =>
      expect(mockRegistrarPagoPresencial).toHaveBeenCalledWith(expect.objectContaining({ tipoPago: "EFECTIVO" })),
    );
  });
});

describe("RegisterPaymentForm — método de pago (#540)", () => {
  it("offers an accessible Efectivo/Transferencia selector and requires a voucher for transfer", () => {
    openAndSubmitEmpty();

    expect(screen.getByRole("radio", { name: "Transferencia" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Efectivo" })).not.toBeChecked();
    expect(screen.getByRole("alert")).toHaveTextContent("El comprobante de transferencia es obligatorio.");
  });

  it("registers cash without a voucher and sends EFECTIVO without uploading one", async () => {
    mockRegistrarPagoPresencial.mockResolvedValue({ id: 501, estadoPago: "APROBADO" });
    render(<RegisterPaymentForm personaId={74} membresia={MEMBRESIA} />);
    fireEvent.click(screen.getByRole("button", { name: "Registrar pago" }));
    fireEvent.click(screen.getByRole("radio", { name: "Efectivo" }));
    fireEvent.click(screen.getByRole("button", { name: "Registrar pago" }));

    await waitFor(() => {
      expect(mockRegistrarPagoPresencial).toHaveBeenCalledWith(expect.objectContaining({ tipoPago: "EFECTIVO" }));
    });
    expect(mockSubirVoucherPago).not.toHaveBeenCalled();
    expect(fileInput()).not.toBeInTheDocument();
  });

  // Issue #1199: the dialog used to tell the admin "Recarga para verlo" —
  // this calls the caller's refresh instead, so the row/dialog updates on
  // its own.
  it("calls onPaymentRegistered after a successful registration, and never asks the admin to reload", async () => {
    mockRegistrarPagoPresencial.mockResolvedValue({ id: 501, estadoPago: "APROBADO" });
    const onPaymentRegistered = vi.fn();
    render(<RegisterPaymentForm personaId={74} membresia={MEMBRESIA} onPaymentRegistered={onPaymentRegistered} />);
    fireEvent.click(screen.getByRole("button", { name: "Registrar pago" }));
    fireEvent.click(screen.getByRole("radio", { name: "Efectivo" }));
    fireEvent.click(screen.getByRole("button", { name: "Registrar pago" }));

    await waitFor(() => expect(onPaymentRegistered).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Pago registrado y aprobado.")).toBeInTheDocument();
    expect(screen.queryByText(/recarga/i)).not.toBeInTheDocument();
  });

  it("does not throw when onPaymentRegistered is omitted", async () => {
    mockRegistrarPagoPresencial.mockResolvedValue({ id: 501, estadoPago: "APROBADO" });
    render(<RegisterPaymentForm personaId={74} membresia={MEMBRESIA} />);
    fireEvent.click(screen.getByRole("button", { name: "Registrar pago" }));
    fireEvent.click(screen.getByRole("radio", { name: "Efectivo" }));
    fireEvent.click(screen.getByRole("button", { name: "Registrar pago" }));

    await waitFor(() => expect(screen.getByText("Pago registrado y aprobado.")).toBeInTheDocument());
  });

  it("clears the staged voucher and voucher error when switching to cash", () => {
    render(<RegisterPaymentForm personaId={74} membresia={MEMBRESIA} />);
    fireEvent.click(screen.getByRole("button", { name: "Registrar pago" }));
    chooseTransfer();
    fireEvent.change(fileInput(), {
      target: { files: [new File(["notas"], "notas.txt", { type: "text/plain" })] },
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Efectivo" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("notas.txt")).not.toBeInTheDocument();
    expect(fileInput()).not.toBeInTheDocument();
  });
});

describe("RegisterPaymentForm — el error de comprobante faltante ya no es silencioso (#465)", () => {
  it("marks the amount and transfer proof as required", () => {
    render(<RegisterPaymentForm personaId={74} membresia={MEMBRESIA} />);
    fireEvent.click(screen.getByRole("button", { name: "Registrar pago" }));
    chooseTransfer();
    expect(screen.getByRole("spinbutton", { name: /^Monto/ })).toBeRequired();
    expect(fileInput()).toHaveAttribute("aria-required", "true");
  });

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
    // #1402 transfer flow: registration returns the payment PENDIENTE_VALIDACION,
    // then the separate voucher upload succeeds and the admin-only validar
    // finalize completes the approval.
    mockRegistrarPagoPresencial.mockResolvedValue({ id: 501, estadoPago: "PENDIENTE_VALIDACION" });
    mockSubirVoucherPago.mockResolvedValue({ id: 501, estadoPago: "PENDIENTE_VALIDACION" });
    mockValidarPago.mockResolvedValue({ id: 501, estadoPago: "APROBADO" });
    openAndSubmitEmpty();
    expect(fileInput()).toHaveAttribute("aria-invalid", "true");

    const file = new File(["contenido"], "voucher.png", { type: "image/png" });
    fireEvent.change(fileInput(), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar pago" }));

    // `setError(null)` runs synchronously once validation passes, ahead of
    // the async `registrarPagoPresencial` call — the silenced/invalid wiring
    // drops immediately, not only after the request resolves.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(fileInput()).not.toHaveAttribute("aria-invalid");
    expect(fileInput()).not.toHaveAttribute("aria-describedby");

    await waitFor(() => expect(mockRegistrarPagoPresencial).toHaveBeenCalled());
    await waitFor(() => expect(mockSubirVoucherPago).toHaveBeenCalledWith(501, file));
    // Finalize happens only AFTER the voucher upload succeeded (#1402).
    await waitFor(() => expect(mockValidarPago).toHaveBeenCalledWith(501, { estadoPago: "APROBADO" }));
    await waitFor(() => expect(screen.getByText("Pago registrado y aprobado.")).toBeInTheDocument());
  });
});

// Issue #1402: the in-person flow decides everything server-side. EFECTIVO
// comes back approved in the same request; TRANSFERENCIA only completes
// after the separate voucher upload succeeds and the admin-only validar
// finalize runs. Any failure leaves the payment PENDIENTE_VALIDACION and
// offers an actionable retry that never re-registers the payment.
describe("RegisterPaymentForm — pago presencial de primera inscripción (#1402)", () => {
  function openCash(): void {
    render(<RegisterPaymentForm personaId={74} membresia={MEMBRESIA} />);
    fireEvent.click(screen.getByRole("button", { name: "Registrar pago" }));
    fireEvent.click(screen.getByRole("radio", { name: "Efectivo" }));
  }

  function openTransferWithVoucher(): void {
    render(<RegisterPaymentForm personaId={74} membresia={MEMBRESIA} />);
    fireEvent.click(screen.getByRole("button", { name: "Registrar pago" }));
    chooseTransfer();
    fireEvent.change(fileInput(), {
      target: { files: [new File(["contenido"], "voucher.png", { type: "image/png" })] },
    });
  }

  it("shows the approval outcome for in-person cash without touching voucher or validar", async () => {
    mockRegistrarPagoPresencial.mockResolvedValue({ id: 601, estadoPago: "APROBADO" });
    const onPaymentRegistered = vi.fn();
    render(<RegisterPaymentForm personaId={74} membresia={MEMBRESIA} onPaymentRegistered={onPaymentRegistered} />);
    fireEvent.click(screen.getByRole("button", { name: "Registrar pago" }));
    fireEvent.click(screen.getByRole("radio", { name: "Efectivo" }));
    fireEvent.click(screen.getByRole("button", { name: "Registrar pago" }));

    await waitFor(() => expect(mockRegistrarPagoPresencial).toHaveBeenCalledWith(
      expect.objectContaining({ tipoPago: "EFECTIVO", personaId: 74 }),
    ));
    await waitFor(() => expect(screen.getByText("Pago registrado y aprobado.")).toBeInTheDocument());
    // Evidence for cash is the in-person act itself: no voucher upload, no
    // separate finalize step — the backend already ran its audit tail.
    expect(mockSubirVoucherPago).not.toHaveBeenCalled();
    expect(mockValidarPago).not.toHaveBeenCalled();
    await waitFor(() => expect(onPaymentRegistered).toHaveBeenCalledTimes(1));
  });

  it("uploads the voucher as a separate request and finalizes admin-only for transfer", async () => {
    mockRegistrarPagoPresencial.mockResolvedValue({ id: 602, estadoPago: "PENDIENTE_VALIDACION" });
    mockSubirVoucherPago.mockResolvedValue({ id: 602, estadoPago: "PENDIENTE_VALIDACION" });
    mockValidarPago.mockResolvedValue({ id: 602, estadoPago: "APROBADO" });
    openTransferWithVoucher();
    fireEvent.click(screen.getByRole("button", { name: "Registrar pago" }));

    await waitFor(() => expect(mockSubirVoucherPago).toHaveBeenCalledWith(602, expect.any(File)));
    await waitFor(() => expect(mockValidarPago).toHaveBeenCalledWith(602, { estadoPago: "APROBADO" }));
    await waitFor(() => expect(screen.getByText("Pago registrado y aprobado.")).toBeInTheDocument());
    expect(mockRegistrarPagoPresencial).toHaveBeenCalledTimes(1);
  });

  it("keeps the payment pending with an actionable retry when the voucher upload fails", async () => {
    mockRegistrarPagoPresencial.mockResolvedValue({ id: 603, estadoPago: "PENDIENTE_VALIDACION" });
    mockSubirVoucherPago.mockRejectedValueOnce(Object.assign(new Error("502"), { status: 502 }));
    mockValidarPago.mockResolvedValue({ id: 603, estadoPago: "APROBADO" });
    openTransferWithVoucher();
    fireEvent.click(screen.getByRole("button", { name: "Registrar pago" }));

    // Failure message points at the pending payment and the retry action.
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/El pago quedó registrado y PENDIENTE/));
    const retry = screen.getByRole("button", { name: "Reintentar comprobante" });
    expect(retry).toBeEnabled();

    // Retry uploads + finalizes again; the payment is NEVER re-registered.
    mockSubirVoucherPago.mockResolvedValue({ id: 603, estadoPago: "PENDIENTE_VALIDACION" });
    fireEvent.click(retry);
    await waitFor(() => expect(mockValidarPago).toHaveBeenCalledWith(603, { estadoPago: "APROBADO" }));
    await waitFor(() => expect(screen.getByText("Pago registrado y aprobado.")).toBeInTheDocument());
    expect(mockRegistrarPagoPresencial).toHaveBeenCalledTimes(1);
    expect(mockSubirVoucherPago).toHaveBeenCalledTimes(2);
  });

  it("keeps the payment pending with the same retry when the finalize (validar) fails", async () => {
    mockRegistrarPagoPresencial.mockResolvedValue({ id: 604, estadoPago: "PENDIENTE_VALIDACION" });
    mockSubirVoucherPago.mockResolvedValueOnce({ id: 604, estadoPago: "PENDIENTE_VALIDACION" });
    mockValidarPago.mockRejectedValueOnce(Object.assign(new Error("400"), { status: 400 }));
    openTransferWithVoucher();
    fireEvent.click(screen.getByRole("button", { name: "Registrar pago" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/El pago quedó registrado y PENDIENTE/));
    expect(screen.getByRole("button", { name: "Reintentar comprobante" })).toBeEnabled();
    // The pago exists and stays pending — no second registration.
    expect(mockRegistrarPagoPresencial).toHaveBeenCalledTimes(1);
  });
});

// Issue #1402: the in-person endpoint is ONLY for a first inscription. Any
// membership that already carried a backend state (ACTIVA, VENCIDA,
// SUSPENDIDA — or no `estadoBackend` at all, which reads operational) is a
// RENEWAL and must keep the original `registrarPago` flow untouched: plain
// registration, the staged voucher uploaded right after, the payment into
// the regular validation queue — never `registrarPagoPresencial`/`validar`.
describe("RegisterPaymentForm — renovación usa el flujo original registrarPago (#1402)", () => {
  /** Same shape as the first-inscription fixture but WITHOUT `estadoBackend:
   *  "INACTIVA"` — a lapsed membership being renewed through the regular
   *  flow (the missing field is exactly how MembersPage fixtures read). */
  const MEMBRESIA_RENOVACION: NonNullable<MemberStudentSummary["membresia"]> = {
    tipo: "Mensual",
    estado: "vencida",
    fechaInicio: "2026-01-01",
    fechaFin: "2026-12-31",
    monto: 25,
    id: 54,
  };

  it("registers a renewal transfer through registrarPago and uploads the voucher, never presencial/validar", async () => {
    mockRegistrarPago.mockResolvedValue({ id: 701, estadoPago: "PENDIENTE_VALIDACION" });
    const onPaymentRegistered = vi.fn();
    render(<RegisterPaymentForm personaId={74} membresia={MEMBRESIA_RENOVACION} onPaymentRegistered={onPaymentRegistered} />);
    fireEvent.click(screen.getByRole("button", { name: "Registrar pago" }));
    chooseTransfer();
    fireEvent.change(fileInput(), {
      target: { files: [new File(["contenido"], "voucher.png", { type: "image/png" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Registrar pago" }));

    await waitFor(() => expect(mockRegistrarPago).toHaveBeenCalledWith(
      expect.objectContaining({ tipoPago: "TRANSFERENCIA", personaId: 74, membresiaId: 54 }),
    ));
    // Original voucher handling: the staged file is uploaded against the
    // freshly created pago — no presencial endpoint, no admin-only finalize.
    await waitFor(() => expect(mockSubirVoucherPago).toHaveBeenCalledWith(701, expect.any(File)));
    expect(mockRegistrarPagoPresencial).not.toHaveBeenCalled();
    expect(mockValidarPago).not.toHaveBeenCalled();
    // The original collapsed success text, not the in-person approval one.
    await waitFor(() => expect(screen.getByText("Pago registrado.")).toBeInTheDocument());
    await waitFor(() => expect(onPaymentRegistered).toHaveBeenCalledTimes(1));
  });

  it("registers a renewal cash payment without touching voucher or presencial flows", async () => {
    mockRegistrarPago.mockResolvedValue({ id: 702, estadoPago: "PENDIENTE_VALIDACION" });
    render(<RegisterPaymentForm personaId={74} membresia={MEMBRESIA_RENOVACION} />);
    fireEvent.click(screen.getByRole("button", { name: "Registrar pago" }));
    fireEvent.click(screen.getByRole("radio", { name: "Efectivo" }));
    fireEvent.click(screen.getByRole("button", { name: "Registrar pago" }));

    await waitFor(() => expect(mockRegistrarPago).toHaveBeenCalledWith(
      expect.objectContaining({ tipoPago: "EFECTIVO" }),
    ));
    expect(mockSubirVoucherPago).not.toHaveBeenCalled();
    expect(mockRegistrarPagoPresencial).not.toHaveBeenCalled();
    expect(mockValidarPago).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText("Pago registrado.")).toBeInTheDocument());
  });

  it("keeps the plain original error outcome when a renewal registration fails", async () => {
    // The shape `services/api` really throws: the backend's own detail on an
    // `ApiClientError` — surfaced verbatim by the ORIGINAL flow's error path.
    mockRegistrarPago.mockRejectedValue(
      Object.assign(new Error("Esta membresía ya tiene un pago pendiente de validación."), { status: 400 }),
    );
    render(<RegisterPaymentForm personaId={74} membresia={MEMBRESIA_RENOVACION} />);
    fireEvent.click(screen.getByRole("button", { name: "Registrar pago" }));
    fireEvent.click(screen.getByRole("radio", { name: "Efectivo" }));
    fireEvent.click(screen.getByRole("button", { name: "Registrar pago" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(
      "Esta membresía ya tiene un pago pendiente de validación.",
    ));
    // The failed renewal is NOT turned into the in-person pending-retry flow.
    expect(screen.queryByRole("button", { name: "Reintentar comprobante" })).not.toBeInTheDocument();
    expect(mockRegistrarPagoPresencial).not.toHaveBeenCalled();
  });
});

// Issue #482: `accept="image/jpeg,image/png,application/pdf"` on the input
// only filters the OS picker's own dropdown — a reader who switches it to
// "All Files" can still select a `.txt`, which used to sail through
// unvalidated until the backend rejected the follow-up upload with a 400
// after the pago already existed.
describe("RegisterPaymentForm — el selector rechaza un tipo de archivo inválido antes de subir (#482)", () => {
  it("rejects a .txt file with a clear error and does not stage it as the voucher", () => {
    render(<RegisterPaymentForm personaId={74} membresia={MEMBRESIA} />);
    fireEvent.click(screen.getByRole("button", { name: "Registrar pago" }));
    chooseTransfer();

    const file = new File(["notas"], "notas.txt", { type: "text/plain" });
    fireEvent.change(fileInput(), { target: { files: [file] } });

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("El comprobante debe ser un archivo PDF, JPG o PNG.");
    expect(screen.queryByText("notas.txt")).not.toBeInTheDocument();
    expect(screen.getByText("Seleccionar archivo")).toBeInTheDocument();
  });

  it("accepts a valid file after a rejected one, clearing the error", () => {
    render(<RegisterPaymentForm personaId={74} membresia={MEMBRESIA} />);
    fireEvent.click(screen.getByRole("button", { name: "Registrar pago" }));
    chooseTransfer();

    fireEvent.change(fileInput(), {
      target: { files: [new File(["notas"], "notas.txt", { type: "text/plain" })] },
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();

    fireEvent.change(fileInput(), {
      target: { files: [new File(["contenido"], "voucher.png", { type: "image/png" })] },
    });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("voucher.png")).toBeInTheDocument();
  });
});

// Issue #666: the reported "36-month" defect never involved a missing cap —
// the real, owner-confirmed cap is (and stays) 12 months. What was actually
// missing was a bound on THIS admin form's free-typed amount, which let
// 50,000,000 compute a client-side preview date of the year 54109 before the
// backend's own defensive `le=12` rejected it with a bare, generic 422.
describe("RegisterPaymentForm — el monto no puede comprar más de 12 meses (#666)", () => {
  function open(): void {
    render(<RegisterPaymentForm personaId={74} membresia={MEMBRESIA} />);
    fireEvent.click(screen.getByRole("button", { name: "Registrar pago" }));
  }

  it("caps the amount input's max at 12 months of the plan's monthly price", () => {
    open();
    // MEMBRESIA.monto is 25, so 12 months is 300.
    expect(screen.getByRole("spinbutton", { name: /^Monto/ })).toHaveAttribute("max", "300");
  });

  it("never renders an absurd end date for the amount from the original report", () => {
    open();
    fireEvent.change(screen.getByRole("spinbutton", { name: /^Monto/ }), {
      target: { value: "50000000" },
    });

    expect(screen.getByText("Fin:").nextSibling).toHaveTextContent("—");
    expect(screen.queryByText(/54109/)).not.toBeInTheDocument();
  });

  it("shows the real 12-month limit, not the issue's 36, once the amount buys 13 months", () => {
    open();
    // 25 * 13 = 325.
    fireEvent.change(screen.getByRole("spinbutton", { name: /^Monto/ }), {
      target: { value: "325" },
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "El pago no puede cubrir más de 12 meses. Reduzca el monto ingresado.",
    );
    expect(screen.queryByText(/meses de vigencia/)).not.toBeInTheDocument();
  });

  it("clears the over-cap message and preview once the amount is corrected", () => {
    open();
    const monto = screen.getByRole("spinbutton", { name: /^Monto/ });
    fireEvent.change(monto, { target: { value: "325" } });
    expect(screen.getByRole("alert")).toBeInTheDocument();

    fireEvent.change(monto, { target: { value: "50" } });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText(/2 meses de vigencia/)).toBeInTheDocument();
  });

  it("accepts exactly the 12-month boundary", () => {
    open();
    // 25 * 12 = 300.
    fireEvent.change(screen.getByRole("spinbutton", { name: /^Monto/ }), {
      target: { value: "300" },
    });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText(/12 meses de vigencia/)).toBeInTheDocument();
    expect(screen.getByText("Fin:").nextSibling).not.toHaveTextContent("—");
  });

  it("never submits an over-cap amount even if the submit button is force-clicked", () => {
    open();
    fireEvent.change(screen.getByRole("spinbutton", { name: /^Monto/ }), {
      target: { value: "50000000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Registrar pago" }));

    expect(mockRegistrarPagoPresencial).not.toHaveBeenCalled();
  });

  it("does not resurrect a stale absurd preview after closing and reopening", () => {
    open();
    fireEvent.change(screen.getByRole("spinbutton", { name: /^Monto/ }), {
      target: { value: "50000000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    fireEvent.click(screen.getByRole("button", { name: "Registrar pago" }));

    expect(screen.getByText("Fin:").nextSibling).toHaveTextContent("—");
  });

  it("shows the real limit instead of a generic message when the backend still rejects a 422", async () => {
    mockRegistrarPagoPresencial.mockRejectedValue(
      Object.assign(new Error("Input should be less than or equal to 12"), { status: 422 }),
    );
    open();
    fireEvent.click(screen.getByRole("radio", { name: "Efectivo" }));
    fireEvent.click(screen.getByRole("button", { name: "Registrar pago" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "El pago no puede cubrir más de 12 meses. Reduzca el monto ingresado.",
      );
    });
  });
});

// Issue #1231: an amount that is not a positive multiple of the monthly
// price used to clear "Fin:" and grey out "Registrar pago" with nothing
// said — the reader had to guess. `MEMBRESIA_40` matches the issue's own
// numbers ($40/mes, $33 no compra meses enteros, $80 compra 2).
describe("RegisterPaymentForm — el monto no múltiplo explica por qué el botón está deshabilitado (#1231)", () => {
  const MEMBRESIA_40: NonNullable<MemberStudentSummary["membresia"]> = {
    ...MEMBRESIA,
    monto: 40,
  };

  function openWithMonto(amount: string): void {
    render(<RegisterPaymentForm personaId={74} membresia={MEMBRESIA_40} />);
    fireEvent.click(screen.getByRole("button", { name: "Registrar pago" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: /^Monto/ }), {
      target: { value: amount },
    });
  }

  it("shows an inline hint tied to Monto via aria-describedby and keeps the button disabled", () => {
    openWithMonto("33");

    const monto = screen.getByRole("spinbutton", { name: /^Monto/ });
    const hint = screen.getByText("El monto debe ser un múltiplo de $40 (un mes = $40).");
    expect(monto).toHaveAttribute("aria-describedby", hint.id);
    expect(screen.getByRole("button", { name: "Registrar pago" })).toBeDisabled();
  });

  it("shows no hint, '2 meses de vigencia' and an enabled button for a whole multiple", () => {
    openWithMonto("80");

    expect(
      screen.queryByText("El monto debe ser un múltiplo de $40 (un mes = $40)."),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/2 meses de vigencia/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Registrar pago" })).toBeEnabled();
  });

  it("formats the Inicio/Fin preview as dd/mm/yyyy, not ISO", () => {
    openWithMonto("80");

    const inicio = screen.getByText("Inicio:").nextSibling;
    const fin = screen.getByText("Fin:").nextSibling;
    expect(inicio).toHaveTextContent(/^\d{2}\/\d{2}\/\d{4}$/);
    expect(fin).toHaveTextContent(/^\d{2}\/\d{2}\/\d{4}$/);
  });
});

describe("RegisterPaymentForm — ADMA-09: siempre se rotula «Registrar pago»", () => {
  it.each([
    ["INACTIVA", "vencida"],
    ["ACTIVA", "activa"],
    ["VENCIDA", "vencida"],
    [undefined, "vencida"],
  ] as const)("labels the opener and submit 'Registrar pago' when estadoBackend is %s", (estadoBackend, estado) => {
    render(
      <RegisterPaymentForm
        personaId={74}
        membresia={{ ...MEMBRESIA, estado, estadoBackend }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Registrar pago" }));

    expect(screen.getByRole("button", { name: "Registrar pago" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /inscripción/i })).not.toBeInTheDocument();
  });
});
