/**
 * Tariff follow-up to #1699 — the payment step of `/student/add-dependent`
 * buys exactly one period for SEMANAL / DIARIA tariffs; only MENSUAL can buy
 * several months.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import AddDependentPage from "@/app/student/add-dependent/page";
import { ADD_DEPENDENT_PATH, installAddDependentHarness } from "./add-dependent-harness";
import { useTestSearchParams } from "@/lib/__tests__/next-navigation-double";
import { inscribirRepresentadoConPago } from "@/services/api";

const harness = vi.hoisted(() => () => import("./add-dependent-harness"));
const pushMock = vi.hoisted(() => vi.fn());

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
      activacionCompleta: true,
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
    { id: 3, categoria: "Mensual Infantil", precio: "25.00", modalidad: "MENSUAL", periodicidad: "MENSUAL", activo: true, enUso: false },
    { id: 4, categoria: "Semanal Infantil", precio: "8.00", modalidad: "MENSUAL", periodicidad: "SEMANAL", activo: true, enUso: false },
    { id: 5, categoria: "Día suelto", precio: "3.00", modalidad: "MENSUAL", periodicidad: "DIARIA", activo: true, enUso: false },
  ]),
  inscribirRepresentadoConPago: vi.fn(),
  subirVoucherPago: vi.fn(),
  fetchClubPaymentInfo: vi.fn().mockResolvedValue({ holder: "Titular Prueba", accountType: "Cuenta de Ahorros", accountNumber: "1234567890", bank: "Banco Prueba", holderId: "0102030405" }),
}));

installAddDependentHarness();

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, "", `${ADD_DEPENDENT_PATH}?pagar=42`);
  vi.mocked(inscribirRepresentadoConPago).mockResolvedValue({ id: 900 } as never);
});

async function openPaymentStep(planId: string): Promise<void> {
  render(<AddDependentPage />);
  await screen.findByLabelText("Plan de membresía");
  fireEvent.change(screen.getByLabelText("Plan de membresía"), { target: { value: planId } });
}

describe("period selector follows the tariff periodicity", () => {
  it.each([
    ["4", "1 semana", "$8,00"],
    ["5", "1 día", "$3,00"],
  ])("plan %s offers a single period and totals one price", async (planId, label, total) => {
    await openPaymentStep(planId);

    expect(screen.queryByText("Meses a pagar")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /un mes más/i })).not.toBeInTheDocument();
    expect(screen.getByText(new RegExp(label))).toBeInTheDocument();
    expect(screen.getByText(/Total estimado/).textContent).toContain(total.replace(" ", "\u00a0"));
  });

  it("sends meses: 1 for a weekly plan", async () => {
    await openPaymentStep("4");
    fireEvent.change(screen.getByLabelText("Medio de pago"), { target: { value: "EFECTIVO" } });
    fireEvent.click(screen.getByRole("button", { name: /^registrar pago$/i }));

    await waitFor(() => expect(inscribirRepresentadoConPago).toHaveBeenCalled());
    expect(vi.mocked(inscribirRepresentadoConPago).mock.calls[0][0]).toMatchObject({ tipoMembresiaId: 4, meses: 1 });
  });

  it("still offers several months for a MENSUAL plan", async () => {
    await openPaymentStep("3");
    fireEvent.click(screen.getByRole("button", { name: /un mes más/i }));
    fireEvent.click(screen.getByRole("button", { name: /un mes más/i }));

    expect(screen.getByText("Meses a pagar")).toBeInTheDocument();
    expect(screen.getByText(/Total estimado/).textContent).toMatch(/75/);
  });

  it("resets to one period when switching from several months to a weekly plan", async () => {
    await openPaymentStep("3");
    fireEvent.click(screen.getByRole("button", { name: /un mes más/i }));
    fireEvent.click(screen.getByRole("button", { name: /un mes más/i }));
    fireEvent.change(screen.getByLabelText("Plan de membresía"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("Medio de pago"), { target: { value: "EFECTIVO" } });

    expect(screen.getByText(/Total estimado/).textContent).toMatch(/8,00/);
    fireEvent.click(screen.getByRole("button", { name: /^registrar pago$/i }));
    await waitFor(() => expect(inscribirRepresentadoConPago).toHaveBeenCalled());
    expect(vi.mocked(inscribirRepresentadoConPago).mock.calls[0][0]).toMatchObject({ meses: 1 });
  });
});
