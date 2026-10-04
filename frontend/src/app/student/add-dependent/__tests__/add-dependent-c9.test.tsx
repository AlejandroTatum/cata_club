/**
 * QA4 decisions, slice C9 — FAM-26 on `/student/add-dependent`: a receipt
 * photo over 5 MB is shrunk in the browser before it is uploaded.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import AddDependentPage from "@/app/student/add-dependent/page";
import { ADD_DEPENDENT_PATH, installAddDependentHarness } from "./add-dependent-harness";
import { useTestSearchParams } from "@/lib/__tests__/next-navigation-double";
import { inscribirRepresentadoConPago, subirVoucherPago } from "@/services/api";

const harness = vi.hoisted(() => () => import("./add-dependent-harness"));
const pushMock = vi.hoisted(() => vi.fn());
const shrinkImage = vi.hoisted(() => vi.fn());
const authState = vi.hoisted(() => ({ activacionCompleta: true }));

vi.mock("@/lib/shrink-image", () => ({ shrinkImage }));
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
}));

installAddDependentHarness();

const MB = 1024 * 1024;

beforeEach(() => {
  vi.clearAllMocks();
  authState.activacionCompleta = true;
  shrinkImage.mockReset();
  window.history.replaceState(null, "", `${ADD_DEPENDENT_PATH}?pagar=42`);
  vi.mocked(inscribirRepresentadoConPago).mockResolvedValue({ id: 900 } as never);
});

async function pickTransferVoucher(file: File): Promise<void> {
  render(<AddDependentPage />);
  await screen.findByLabelText("Plan de membresía");
  fireEvent.change(screen.getByLabelText("Plan de membresía"), { target: { value: "3" } });
  fireEvent.change(screen.getByLabelText("Medio de pago"), { target: { value: "TRANSFERENCIA" } });
  fireEvent.change(document.getElementById("dependent-voucher") as HTMLInputElement, { target: { files: [file] } });
}

describe("receipt photo over 5 MB (FAM-26)", () => {
  it("uploads the shrunk photo instead of rejecting the original", async () => {
    const small = new File([new Uint8Array(2 * MB)], "foto.jpg", { type: "image/jpeg" });
    shrinkImage.mockResolvedValue(small);
    await pickTransferVoucher(new File([new Uint8Array(6 * MB)], "foto.jpeg", { type: "image/jpeg" }));

    await screen.findByText("foto.jpg");
    fireEvent.click(screen.getByRole("button", { name: /^registrar pago$/i }));

    await waitFor(() => expect(subirVoucherPago).toHaveBeenCalledWith(900, small));
  });

  it("keeps the 5 MB message when shrinking fails", async () => {
    shrinkImage.mockRejectedValue(new Error("no canvas"));
    await pickTransferVoucher(new File([new Uint8Array(6 * MB)], "foto.jpeg", { type: "image/jpeg" }));
    await waitFor(() => expect(shrinkImage).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: /^registrar pago$/i }));

    expect(await screen.findByText(/pesar hasta 5 MB/)).toBeInTheDocument();
    expect(subirVoucherPago).not.toHaveBeenCalled();
  });

  it("keeps the newer pick when an older shrink resolves last", async () => {
    let resolveA: (f: File) => void = () => {};
    const shrunkB = new File([new Uint8Array(1 * MB)], "b.jpg", { type: "image/jpeg" });
    shrinkImage
      .mockImplementationOnce(() => new Promise<File>((resolve) => { resolveA = resolve; }))
      .mockResolvedValueOnce(shrunkB);
    await pickTransferVoucher(new File([new Uint8Array(6 * MB)], "a.jpeg", { type: "image/jpeg" }));
    fireEvent.change(document.getElementById("dependent-voucher") as HTMLInputElement, {
      target: { files: [new File([new Uint8Array(6 * MB)], "b.jpeg", { type: "image/jpeg" })] },
    });
    await screen.findByText("b.jpg");

    resolveA(new File([new Uint8Array(1 * MB)], "a.jpg", { type: "image/jpeg" }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.queryByText("a.jpg")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^registrar pago$/i }));
    await waitFor(() => expect(subirVoucherPago).toHaveBeenCalledWith(900, shrunkB));
  });
});
