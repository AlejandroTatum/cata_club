/**
 * QA4 decisions, slice C7 — `/student/add-dependent`.
 *
 *  · FAM-10: the medical record is required and the emergency phone is the
 *    account representative's, so the copy promises nothing «para después».
 *  · REG-03: after adding a dependent the screen shows who was added and the
 *    state of their membership, instead of bouncing straight to `/student`.
 *  · FAM-12 «c»: `?pagar=<id>` opens the FIRST payment of an existing
 *    dependent (the entry point from Pagos for a child with no membership).
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import AddDependentPage from "@/app/student/add-dependent/page";
import { ADD_DEPENDENT_PATH, installAddDependentHarness } from "./add-dependent-harness";
import { addDependentFieldId } from "@/app/student/add-dependent/add-dependent-utils";
import { fillBirthDate } from "@/lib/__tests__/fill-birth-date";
import { useTestSearchParams } from "@/lib/__tests__/next-navigation-double";
import { crearRepresentadoPropio, inscribirRepresentadoConPago } from "@/services/api";

const harness = vi.hoisted(() => () => import("./add-dependent-harness"));
const pushMock = vi.hoisted(() => vi.fn());
const authState = vi.hoisted(() => ({ activacionCompleta: true }));

vi.mock("@/components/ProtectedRoute", async () => (await harness()).protectedRouteDouble());
vi.mock("next/link", async () => (await harness()).nextLinkDouble());
vi.mock("next/image", async () => (await harness()).nextImageDouble());
vi.mock("next/navigation", () => ({
  usePathname: () => "/student/add-dependent",
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
  useSearchParams: () => useTestSearchParams(),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    session: {
      user: { id: "9", name: "Mishell", email: "m@cataclub.com", role: "representante" },
      roles: ["REPRESENTANTE"],
      correoVerificado: true,
      activacionCompleta: authState.activacionCompleta,
    },
    isAuthenticated: true,
    isLoading: false,
    logout: vi.fn(),
    refreshSession: vi.fn().mockResolvedValue({ kind: "authenticated" }),
  }),
}));
vi.mock("@/contexts/ToastContext", async () => (await harness()).toastContextDouble());
vi.mock("@/services/api", () => ({
  crearRepresentadoPropio: vi.fn(),
  fetchInstituciones: vi.fn().mockResolvedValue([]),
  fetchTiposMembresia: vi.fn().mockResolvedValue([
    { id: 3, categoria: "Mensual Infantil", precio: "25.00", modalidad: "MENSUAL", activo: true, enUso: false },
  ]),
  inscribirRepresentadoConPago: vi.fn(),
  subirVoucherPago: vi.fn(),
  fetchClubPaymentInfo: vi.fn().mockResolvedValue({ holder: "Titular Prueba", accountType: "Cuenta de Ahorros", accountNumber: "1234567890", bank: "Banco Prueba", holderId: "0102030405" }),
}));

installAddDependentHarness();

beforeEach(() => {
  pushMock.mockReset();
  authState.activacionCompleta = true;
});

function next(): void {
  fireEvent.click(screen.getByRole("button", { name: /siguiente/i }));
}

function goToSummary(): void {
  fireEvent.change(screen.getByLabelText(/^Nombres/), { target: { value: "Mateo" } });
  fireEvent.change(screen.getByLabelText(/^Apellidos/), { target: { value: "Zambrano" } });
  fireEvent.change(screen.getByLabelText(/^Cédula/), { target: { value: "1798765432" } });
  fillBirthDate(addDependentFieldId("fechaNacimiento"), "2014-05-12");
  next();
  fireEvent.change(document.getElementById(addDependentFieldId("tipoSangre")) as HTMLElement, {
    target: { value: "O_POSITIVO" },
  });
  fireEvent.change(screen.getByLabelText(/^Enfermedades/), { target: { value: "Ninguno" } });
  fireEvent.change(screen.getByLabelText(/^Alergias/), { target: { value: "Ninguno" } });
  next();
}

async function addDependentPayingLater(): Promise<void> {
  vi.mocked(crearRepresentadoPropio).mockResolvedValue({
    representado: {
      id: 42, nombres: "Mateo", apellidos: "Zambrano", cedula: "1798765432",
      fechaNacimiento: "2014-05-12", telefono: null,
    },
  });
  render(<AddDependentPage />);
  goToSummary();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: /agregar jugador/i }));
  await screen.findByRole("heading", { name: "Dependiente agregado" });
}

describe("the medical record is required, the emergency phone is the representative's (FAM-10)", () => {
  it("promises nothing «para después» about the medical record", () => {
    render(<AddDependentPage />);

    expect(document.body.textContent).not.toMatch(/más tarde|para después|dejarlo/i);
    expect(screen.getByText(/La ficha médica es obligatoria/)).toBeInTheDocument();
  });

  it("says the emergency phone is the one on the representative's account, without asking for it", () => {
    render(<AddDependentPage />);
    fireEvent.change(screen.getByLabelText(/^Nombres/), { target: { value: "Mateo" } });
    fireEvent.change(screen.getByLabelText(/^Apellidos/), { target: { value: "Zambrano" } });
    fireEvent.change(screen.getByLabelText(/^Cédula/), { target: { value: "1798765432" } });
    fillBirthDate(addDependentFieldId("fechaNacimiento"), "2014-05-12");
    next();

    expect(screen.getByText(/el club llamará al teléfono de tu cuenta/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/teléfono de emergencia/i)).not.toBeInTheDocument();
  });
});

describe("after adding a dependent (REG-03)", () => {
  it("shows who was added and that they have no membership yet, instead of leaving", async () => {
    await addDependentPayingLater();

    const panel = screen.getByTestId("dependent-added");
    expect(within(panel).getByText("Mateo Zambrano")).toBeInTheDocument();
    expect(within(panel).getByText(/Sin membresía todavía/)).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("goes to the account only when asked", async () => {
    await addDependentPayingLater();

    fireEvent.click(screen.getByRole("button", { name: /ir a mi cuenta/i }));

    expect(pushMock).toHaveBeenCalledWith("/student");
  });

  it("opens the first payment from the confirmation", async () => {
    await addDependentPayingLater();

    fireEvent.click(screen.getByRole("button", { name: /registrar el primer pago/i }));

    expect(await screen.findByLabelText("Plan de membresía")).toBeInTheDocument();
  });

  it("does not offer the online payment while the account is not activated", async () => {
    authState.activacionCompleta = false;
    await addDependentPayingLater();

    expect(screen.queryByRole("button", { name: /registrar el primer pago/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ir a mi cuenta/i })).toBeInTheDocument();
  });
});

describe("the first payment of an existing dependent (FAM-12 «c»)", () => {
  it("opens straight on the payment step for ?pagar=<id> and enrolls that person", async () => {
    window.history.replaceState(null, "", `${ADD_DEPENDENT_PATH}?pagar=42`);
    vi.mocked(inscribirRepresentadoConPago).mockResolvedValue({ id: 900 } as never);
    render(<AddDependentPage />);

    expect(await screen.findByLabelText("Plan de membresía")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Nombres/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Plan de membresía"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Medio de pago"), { target: { value: "EFECTIVO" } });
    fireEvent.click(screen.getByRole("button", { name: /^registrar pago$/i }));

    await waitFor(() =>
      expect(inscribirRepresentadoConPago).toHaveBeenCalledWith({
        personaId: 42, tipoMembresiaId: 3, tipoPago: "EFECTIVO", meses: 1,
      }),
    );
  });

  it("ignores ?pagar= while the account is not activated", () => {
    authState.activacionCompleta = false;
    window.history.replaceState(null, "", `${ADD_DEPENDENT_PATH}?pagar=42`);
    render(<AddDependentPage />);

    expect(screen.getByLabelText(/^Nombres/)).toBeInTheDocument();
  });
});
