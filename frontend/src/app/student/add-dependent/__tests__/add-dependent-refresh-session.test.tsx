/**
 * Issue #1340 (R4-001/R2/R3-001 from the #1318 review): `refreshSession()`
 * used to run INSIDE the same `try` that persists the dependent. The alta
 * had already succeeded and the success toast had already fired by the time
 * it ran, so a rejected rehydration landed in the CREATE's own `catch` and
 * reported a failure for something that had not failed.
 *
 * Locks the split: the dependent gets created, the success toast fires, and
 * the visitor still lands on `/student` even when `refreshSession` rejects —
 * with no submit error shown for it.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import AddDependentPage from "@/app/student/add-dependent/page";
import { crearRepresentadoPropio } from "@/services/api";
import { useTestSearchParams } from "@/lib/__tests__/next-navigation-double";
import { ADD_DEPENDENT_PATH, installAddDependentHarness } from "./add-dependent-harness";
import { addDependentFieldId } from "@/app/student/add-dependent/add-dependent-utils";
import { fillBirthDate } from "@/lib/__tests__/fill-birth-date";

const harness = vi.hoisted(() => () => import("./add-dependent-harness"));
const refreshSessionMock = vi.hoisted(() => vi.fn());
const pushMock = vi.hoisted(() => vi.fn());
const showSuccessMock = vi.hoisted(() => vi.fn());

vi.mock("@/components/ProtectedRoute", async () => (await harness()).protectedRouteDouble());
vi.mock("next/link", async () => (await harness()).nextLinkDouble());
vi.mock("next/image", async () => (await harness()).nextImageDouble());

vi.mock("next/navigation", () => ({
  usePathname: () => ADD_DEPENDENT_PATH,
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
  useSearchParams: () => useTestSearchParams(),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    session: {
      user: { id: "9", name: "Mishell", email: "m@cataclub.com", role: "representante" },
      roles: ["REPRESENTANTE"],
    },
    isAuthenticated: true,
    isLoading: false,
    logout: vi.fn(),
    refreshSession: refreshSessionMock,
  }),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ showError: vi.fn(), showSuccess: showSuccessMock }),
}));

vi.mock("@/services/api", () => ({
  crearRepresentadoPropio: vi.fn(),
  fetchInstituciones: vi.fn().mockResolvedValue([]),
}));

installAddDependentHarness();

beforeEach(() => {
  refreshSessionMock.mockReset();
  pushMock.mockReset();
  showSuccessMock.mockReset();
});

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

async function submit(): Promise<void> {
  render(<AddDependentPage />);
  goToSummaryStep();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: /agregar dependiente/i }));
}

describe("a rejected refreshSession does not turn a successful alta into a reported failure", () => {
  it("keeps the success toast and still navigates to /student when refreshSession rejects", async () => {
    vi.mocked(crearRepresentadoPropio).mockResolvedValue({
      representado: {
        id: 42, nombres: "Mateo", apellidos: "Zambrano", cedula: "1798765432",
        fechaNacimiento: "2014-05-12", telefono: "0991234567",
      },
    });
    refreshSessionMock.mockRejectedValue(new Error("session outage"));

    await submit();

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/student"));
    expect(showSuccessMock).toHaveBeenCalledWith("Dependiente agregado correctamente.");
  });

  it("shows no submit error for a rejected refreshSession", async () => {
    vi.mocked(crearRepresentadoPropio).mockResolvedValue({
      representado: {
        id: 43, nombres: "Mateo", apellidos: "Zambrano", cedula: "1798765432",
        fechaNacimiento: "2014-05-12", telefono: "0991234567",
      },
    });
    refreshSessionMock.mockRejectedValue(new Error("session outage"));

    await submit();

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/student"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
