/**
 * #1779 S5 (owner decision 2, «Sí, permitir»): a guardian with a blocked child
 * may still add a dependent. The non-payment block only gates the BLOCKED
 * child's own views; `/student/add-dependent` is not one of them and must never
 * bounce to Payments.
 *
 * @vitest-environment jsdom
 */

import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import AddDependentPage from "@/app/student/add-dependent/page";
import { installAddDependentHarness } from "./add-dependent-harness";

const harness = vi.hoisted(() => () => import("./add-dependent-harness"));
const mockReplace = vi.hoisted(() => vi.fn());

vi.mock("@/components/ProtectedRoute", async () => (await harness()).protectedRouteDouble());
vi.mock("next/navigation", async () => ({
  ...(await harness()).navigationDouble(),
  useRouter: () => ({ push: vi.fn(), replace: mockReplace }),
}));
vi.mock("next/link", async () => (await harness()).nextLinkDouble());
vi.mock("next/image", async () => (await harness()).nextImageDouble());
vi.mock("@/contexts/ToastContext", async () => (await harness()).toastContextDouble());
vi.mock("@/contexts/AuthContext", async () => (await harness()).authContextDouble());

vi.mock("@/services/api", () => ({
  crearRepresentadoPropio: vi.fn(),
  fetchInstituciones: vi.fn().mockResolvedValue([]),
  fetchTiposMembresia: vi.fn().mockResolvedValue([]),
  inscribirRepresentadoConPago: vi.fn(),
  subirVoucherPago: vi.fn(),
  fetchClubPaymentInfo: vi.fn().mockResolvedValue(null),
  // The guardian's portal flags a dependent as blocked; this page never gates on it.
  fetchStudentPortal: vi.fn().mockResolvedValue({
    self: null,
    representados: [
      { personaId: "6", nombres: "Mateo", apellidos: "Alumno", recentSessions: [], membership: null, representante: null, representanteId: 9, bloqueadoPorImpago: true, cubiertoHasta: "2026-09-30" },
    ],
    membershipPlans: [],
  }),
}));

installAddDependentHarness();
beforeEach(() => mockReplace.mockReset());

describe("/student/add-dependent with a blocked child", () => {
  it("opens the add-dependent form and never redirects the guardian to Payments", () => {
    render(<AddDependentPage />);

    expect(screen.getByLabelText(/^Nombres/)).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
