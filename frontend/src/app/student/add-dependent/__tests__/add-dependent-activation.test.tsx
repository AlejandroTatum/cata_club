/**
 * REG-12: a representative may add dependents as soon as their email is
 * verified, without waiting for the club to activate the account. The page is
 * reachable with the activation gate still pending; only an UNVERIFIED email
 * sends the visitor back to the activation screen. Paying right away stays
 * for activated accounts — the membership endpoints behind it are still
 * closed to a pending one.
 *
 * @vitest-environment jsdom
 */

import { beforeEach, describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import AddDependentPage from "@/app/student/add-dependent/page";
import { installAddDependentHarness } from "./add-dependent-harness";
import { addDependentFieldId } from "@/app/student/add-dependent/add-dependent-utils";
import { fillBirthDate } from "@/lib/__tests__/fill-birth-date";

const harness = vi.hoisted(() => () => import("./add-dependent-harness"));
const state = vi.hoisted(() => ({
  correoVerificado: true as boolean,
  activacionCompleta: true as boolean,
  replace: undefined as unknown as ReturnType<typeof import("vitest").vi.fn>,
}));

vi.mock("@/components/ProtectedRoute", async () => (await harness()).protectedRouteDouble());
vi.mock("next/navigation", async () => ({
  ...(await (await harness()).navigationDouble()),
  useRouter: () => ({ push: vi.fn(), replace: state.replace }),
}));
vi.mock("next/link", async () => (await harness()).nextLinkDouble());
vi.mock("next/image", async () => (await harness()).nextImageDouble());
vi.mock("@/contexts/ToastContext", async () => (await harness()).toastContextDouble());
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    session: {
      user: { id: "9", name: "Mishell", email: "m@cataclub.com", role: "representante" },
      roles: ["REPRESENTANTE"],
      correoVerificado: state.correoVerificado,
      activacionCompleta: state.activacionCompleta,
    },
    isAuthenticated: true,
    isLoading: false,
    logout: vi.fn(),
    refreshSession: vi.fn().mockResolvedValue({ kind: "authenticated" }),
  }),
}));
vi.mock("@/services/api", () => ({
  crearRepresentadoPropio: vi.fn(),
  fetchInstituciones: vi.fn().mockResolvedValue([]),
  fetchTiposMembresia: vi.fn().mockResolvedValue([]),
  inscribirRepresentadoConPago: vi.fn(),
  subirVoucherPago: vi.fn(),
}));

installAddDependentHarness();
beforeEach(() => {
  state.correoVerificado = true;
  state.activacionCompleta = true;
  state.replace = vi.fn();
});

function goToSummaryStep(): void {
  fireEvent.change(screen.getByLabelText(/^Nombres/), { target: { value: "Mateo" } });
  fireEvent.change(screen.getByLabelText(/^Apellidos/), { target: { value: "Zambrano" } });
  fireEvent.change(screen.getByLabelText(/^Cédula/), { target: { value: "1798765432" } });
  fillBirthDate(addDependentFieldId("fechaNacimiento"), "2014-05-12");
  fireEvent.click(screen.getByRole("button", { name: /siguiente/i }));
  fireEvent.change(document.getElementById(addDependentFieldId("tipoSangre")) as HTMLElement, {
    target: { value: "O_POSITIVO" },
  });
  fireEvent.change(screen.getByLabelText(/^Enfermedades/), { target: { value: "Ninguno" } });
  fireEvent.change(screen.getByLabelText(/^Alergias/), { target: { value: "Ninguno" } });
  fireEvent.click(screen.getByRole("button", { name: /siguiente/i }));
}

describe("add-dependent while the activation gate is pending (REG-12)", () => {
  it("lets a verified account in, without sending it to the activation screen", () => {
    state.activacionCompleta = false;

    render(<AddDependentPage />);

    expect(screen.getByLabelText(/^Nombres/)).toBeInTheDocument();
    expect(state.replace).not.toHaveBeenCalled();
  });

  it("sends an account whose email is not verified yet to the activation screen", () => {
    state.correoVerificado = false;
    state.activacionCompleta = false;

    render(<AddDependentPage />);

    expect(state.replace).toHaveBeenCalledWith("/login/activacion");
    expect(screen.queryByLabelText(/^Nombres/)).not.toBeInTheDocument();
  });

  it("does not offer to pay right away while the account is not activated", () => {
    state.activacionCompleta = false;

    render(<AddDependentPage />);
    goToSummaryStep();

    expect(screen.queryByRole("option", { name: /registrar el pago ahora/i })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /pagar más tarde/i })).toBeInTheDocument();
  });

  it("offers it once the account is activated", () => {
    render(<AddDependentPage />);
    goToSummaryStep();

    expect(screen.getByRole("option", { name: /registrar el pago ahora/i })).toBeInTheDocument();
  });
});
