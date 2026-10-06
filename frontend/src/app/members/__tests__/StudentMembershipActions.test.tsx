/**
 * Pagos dialog actions: ADMA-04 (history refreshes after a write), ADMA-17
 * (a suspended membership leads with «Reactivar membresía»), ADMA-05 UI
 * (no «Crear membresía» when the person already has one, even INACTIVA).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import StudentMembershipActions from "../StudentMembershipActions";
import type { MemberStudentSummary } from "../members-utils";

const mockFetchPagos = vi.fn();

vi.mock("@/services/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/api")>();
  return { ...actual, fetchPagosDePersona: (id: string) => mockFetchPagos(id) };
});

vi.mock("../BeneficioSection", () => ({ default: () => <div /> }));
vi.mock("../RegularizarDeudaForm", () => ({ default: () => <button type="button">Regularizar deuda</button> }));
vi.mock("../SuspenderReactivarForm", () => ({
  default: ({ estado, primary }: { estado: string; primary?: boolean }) => (
    <button type="button" data-primary={primary ? "yes" : "no"}>
      {estado === "activa" ? "Suspender membresía" : "Reactivar membresía"}
    </button>
  ),
}));
vi.mock("../CambiarPlanForm", () => ({ default: () => <div /> }));
vi.mock("../MigrarSocioAntiguoForm", () => ({
  default: ({ membresiaId, onDone, onBack }: { membresiaId?: number; onDone: (r: string) => void; onBack: () => void }) => (
    <div data-testid="migrar" data-membresia-id={membresiaId ?? ""}>
      <button type="button" onClick={() => onDone("Al día hasta 20/10/2026")}>mock-done</button>
      <button type="button" onClick={onBack}>mock-back</button>
    </div>
  ),
}));
vi.mock("../RegisterPaymentForm", () => ({
  default: ({ onPaymentRegistered }: { onPaymentRegistered?: () => void }) => (
    <button type="button" onClick={() => onPaymentRegistered?.()}>
      Registrar pago
    </button>
  ),
}));

function student(estado: "activa" | "suspendida" | "vencida", estadoBackend: string): MemberStudentSummary {
  return {
    id: "7",
    nombres: "Sofía",
    apellidos: "Vera",
    activo: true,
    membresia: {
      id: 3,
      tipo: "Mensual Adultos",
      estado,
      estadoBackend: estadoBackend as never,
      fechaInicio: "2026-01-01",
      fechaFin: "2026-02-01",
      cubiertoHasta: null,
      monto: 40,
    },
    ultimoPago: null,
  };
}

function renderActions(s: MemberStudentSummary, onPaymentRegistered = vi.fn()) {
  return render(
    <StudentMembershipActions
      personaId={7}
      student={s}
      onMembershipCreated={vi.fn()}
      onDebtRegularized={vi.fn()}
      onMembresiaChanged={vi.fn()}
      onPaymentRegistered={onPaymentRegistered}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchPagos.mockResolvedValue([]);
});

describe("StudentMembershipActions — ADMA-04 history refresh", () => {
  it("fetches the payment history again after a payment is registered", async () => {
    const onPaymentRegistered = vi.fn();
    renderActions(student("vencida", "VENCIDA"), onPaymentRegistered);
    await screen.findByText("Todavía no hay pagos registrados.");
    expect(mockFetchPagos).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Registrar pago" }));

    expect(onPaymentRegistered).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mockFetchPagos).toHaveBeenCalledTimes(2));
  });
});

describe("StudentMembershipActions — ADMA-17 suspended membership", () => {
  it("leads with Reactivar and disables Registrar pago with a note", () => {
    renderActions(student("suspendida", "SUSPENDIDA"));

    const reactivar = screen.getByRole("button", { name: "Reactivar membresía" });
    expect(reactivar).toHaveAttribute("data-primary", "yes");
    expect(reactivar.closest("[data-primary-action]")).toHaveAttribute("data-primary-action", "reactivar");

    const registrar = screen.getByRole("button", { name: "Registrar pago" });
    expect(registrar).toBeDisabled();
    expect(screen.getByText("Reactiva la membresía para registrar pagos.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Reactivar membresía" })).toHaveLength(1);
  });

  it("keeps Registrar pago primary and enabled when the membership is active", () => {
    renderActions(student("activa", "ACTIVA"));

    expect(screen.getByRole("button", { name: "Registrar pago" })).toBeEnabled();
    expect(screen.queryByText("Reactiva la membresía para registrar pagos.")).not.toBeInTheDocument();
  });
});

describe("StudentMembershipActions — ADMA-05 existing membership", () => {
  it("does not offer «Crear membresía» when the person already has an INACTIVA one", () => {
    renderActions(student("vencida", "INACTIVA"));
    fireEvent.click(screen.getByRole("radio", { name: "Socio nuevo" }));

    expect(screen.queryByRole("button", { name: /crear membresía/i })).not.toBeInTheDocument();
    expect(within(document.body).getByRole("button", { name: "Registrar pago" })).toBeInTheDocument();
  });
});

describe("StudentMembershipActions — ¿Socio nuevo o socio antiguo? (L17)", () => {
  const sinCobertura = () => student("vencida", "INACTIVA");

  it("asks first, showing none of the usual first-payment actions", () => {
    renderActions(sinCobertura());

    expect(screen.getByRole("radio", { name: "Socio nuevo" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Socio antiguo" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Registrar pago" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Regularizar deuda" })).not.toBeInTheDocument();
  });

  it("«Socio nuevo» leaves the existing flow untouched and the question gone", () => {
    renderActions(sinCobertura());
    fireEvent.click(screen.getByRole("radio", { name: "Socio nuevo" }));

    expect(screen.queryByRole("radio", { name: "Socio antiguo" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Registrar pago" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Regularizar deuda" })).toBeInTheDocument();
  });

  it("«Socio nuevo» → «Cancelar» brings the question back and creates nothing (#1664)", () => {
    renderActions(sinCobertura());
    fireEvent.click(screen.getByRole("radio", { name: "Socio nuevo" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(screen.getByText("¿Socio nuevo o socio antiguo?")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Socio nuevo" })).not.toBeChecked();
    expect(screen.queryByRole("button", { name: "Registrar pago" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancelar" })).not.toBeInTheDocument();
  });

  it("offers no «Cancelar» before choosing, nor under «Socio antiguo» (which keeps «Volver»)", () => {
    renderActions(sinCobertura());
    expect(screen.queryByRole("button", { name: "Cancelar" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Socio antiguo" }));
    expect(screen.queryByRole("button", { name: "Cancelar" })).not.toBeInTheDocument();
  });

  it("«Socio antiguo» goes straight to the last-payment form for the existing membership", () => {
    renderActions(sinCobertura());
    fireEvent.click(screen.getByRole("radio", { name: "Socio antiguo" }));

    expect(screen.getByTestId("migrar")).toHaveAttribute("data-membresia-id", "3");
    expect(screen.queryByRole("button", { name: "Registrar pago" })).not.toBeInTheDocument();
  });

  it("with no membership it asks too, and the form creates it (no membership id)", () => {
    renderActions({ ...sinCobertura(), membresia: null });
    fireEvent.click(screen.getByRole("radio", { name: "Socio antiguo" }));

    expect(screen.getByTestId("migrar")).toHaveAttribute("data-membresia-id", "");
  });

  it("shows the resulting state once the migration is done", () => {
    renderActions(sinCobertura());
    fireEvent.click(screen.getByRole("radio", { name: "Socio antiguo" }));
    fireEvent.click(screen.getByRole("button", { name: "mock-done" }));

    expect(screen.getByText(/Socio antiguo registrado\. Al día hasta 20\/10\/2026\./)).toBeInTheDocument();
  });

  it("never asks once the member has coverage", () => {
    const conCobertura = student("activa", "ACTIVA");
    conCobertura.membresia = { ...conCobertura.membresia!, cubiertoHasta: "2026-11-30" };
    renderActions(conCobertura);

    expect(screen.queryByRole("radio", { name: "Socio nuevo" })).not.toBeInTheDocument();
  });

  it("shows no «Cancelar» for a member who already has coverage", () => {
    const conCobertura = student("activa", "ACTIVA");
    conCobertura.membresia = { ...conCobertura.membresia!, cubiertoHasta: "2026-11-30" };
    renderActions(conCobertura);

    expect(screen.queryByRole("button", { name: "Cancelar" })).not.toBeInTheDocument();
  });

  it("never asks while a payment awaits validation", () => {
    const pendiente = sinCobertura();
    pendiente.ultimoPago = { estado: "pendiente_validacion" } as MemberStudentSummary["ultimoPago"];
    renderActions(pendiente);

    expect(screen.queryByRole("radio", { name: "Socio nuevo" })).not.toBeInTheDocument();
  });
});
