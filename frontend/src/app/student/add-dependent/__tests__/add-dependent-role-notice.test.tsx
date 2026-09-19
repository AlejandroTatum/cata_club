/**
 * Issue #1318: `/student/add-dependent` reachable by a self-managed player,
 * not just an existing representante — the role-change notice and the call
 * to the new self-service endpoint.
 *
 * The auth double here is NOT `add-dependent-harness`'s `authContextDouble`:
 * this suite needs to flip the signed-in role PER TEST (representante vs.
 * estudiante), and a `vi.mock` factory can only close over a binding created
 * through `vi.hoisted` — a plain shared double returns one fixed session for
 * every case in the file. `authState` below is that hoisted, mutable seam.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import AddDependentPage from "@/app/student/add-dependent/page";
import { crearRepresentadoPropio } from "@/services/api";
import { installAddDependentHarness } from "./add-dependent-harness";
import { addDependentFieldId } from "@/app/student/add-dependent/add-dependent-utils";
import { fillBirthDate } from "@/lib/__tests__/fill-birth-date";

const harness = vi.hoisted(() => () => import("./add-dependent-harness"));
const authState = vi.hoisted(() => ({
  roles: ["REPRESENTANTE"] as string[],
  role: "representante" as "representante" | "estudiante",
}));

vi.mock("@/components/ProtectedRoute", async () => (await harness()).protectedRouteDouble());
vi.mock("next/navigation", async () => (await harness()).navigationDouble());
vi.mock("next/link", async () => (await harness()).nextLinkDouble());
vi.mock("next/image", async () => (await harness()).nextImageDouble());
vi.mock("@/contexts/ToastContext", async () => (await harness()).toastContextDouble());
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    session: {
      user: { id: "9", name: "Mishell", email: "m@cataclub.com", role: authState.role },
      roles: authState.roles,
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
}));

installAddDependentHarness();

const NOTICE_TEXT = /al guardar, su cuenta pasa a ser de representante/i;

function fillChildStep(): void {
  fireEvent.change(screen.getByLabelText(/^Nombres/), { target: { value: "Mateo" } });
  fireEvent.change(screen.getByLabelText(/^Apellidos/), { target: { value: "Zambrano" } });
  fireEvent.change(screen.getByLabelText(/^Cédula/), { target: { value: "1798765432" } });
  fillBirthDate(addDependentFieldId("fechaNacimiento"), "2014-05-12");
  fireEvent.change(screen.getByLabelText(/^Teléfono/), { target: { value: "0991234567" } });
}

function goToSummaryStep(): void {
  fillChildStep();
  fireEvent.click(screen.getByRole("button", { name: /siguiente/i }));
  fireEvent.change(document.getElementById(addDependentFieldId("tipoSangre")) as HTMLElement, {
    target: { value: "O_POSITIVO" },
  });
  fireEvent.click(screen.getByRole("button", { name: /siguiente/i }));
}

describe("the role-change notice only appears for a non-representative caller", () => {
  it("shows the notice for a self-managed player who isn't REPRESENTANTE yet", () => {
    authState.roles = ["ALUMNO"];
    authState.role = "estudiante";
    render(<AddDependentPage />);
    goToSummaryStep();

    expect(screen.getByText(NOTICE_TEXT)).toBeInTheDocument();
  });

  it("hides the notice for an account that is already REPRESENTANTE", () => {
    authState.roles = ["REPRESENTANTE"];
    authState.role = "representante";
    render(<AddDependentPage />);
    goToSummaryStep();

    expect(screen.queryByText(NOTICE_TEXT)).not.toBeInTheDocument();
  });

  it("submits through crearRepresentadoPropio — the self-service endpoint, never a persona id in the URL", async () => {
    authState.roles = ["ALUMNO"];
    authState.role = "estudiante";
    vi.mocked(crearRepresentadoPropio).mockResolvedValue({
      representado: {
        id: 42, nombres: "Mateo", apellidos: "Zambrano", cedula: "1798765432",
        fechaNacimiento: "2014-05-12", telefono: "0991234567",
      },
    });
    render(<AddDependentPage />);
    goToSummaryStep();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /agregar dependiente/i }));

    await waitFor(() => expect(crearRepresentadoPropio).toHaveBeenCalledTimes(1));
    expect(crearRepresentadoPropio).toHaveBeenCalledWith(
      expect.objectContaining({ nombres: "Mateo", apellidos: "Zambrano" }),
    );
  });
});
