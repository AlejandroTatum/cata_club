/**
 * `ChangePasswordCard` — "Cambiar contraseña" en el perfil (FAM-17).
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ChangePasswordCard from "@/app/profile/ChangePasswordCard";

const mockCambiar = vi.fn();
vi.mock("@/services/api", () => ({
  cambiarContrasenia: (actual: string, nueva: string) => mockCambiar(actual, nueva),
}));
const mockShowSuccess = vi.fn();
const mockShowError = vi.fn();
vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ showSuccess: mockShowSuccess, showError: mockShowError }),
}));

function fill(label: RegExp, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function fillAll(actual = "claveActual123", nueva = "claveNueva456", repetir = nueva): void {
  fill(/^contraseña actual/i, actual);
  fill(/^nueva contraseña/i, nueva);
  fill(/^repetir nueva contraseña/i, repetir);
}

function submit(): void {
  fireEvent.click(screen.getByRole("button", { name: /actualizar contraseña/i }));
}

beforeEach(() => {
  mockCambiar.mockReset().mockResolvedValue({ mensaje: "Contraseña actualizada." });
  mockShowSuccess.mockReset();
  mockShowError.mockReset();
});

describe("ChangePasswordCard", () => {
  it("sends the current and the new password and confirms success", async () => {
    render(<ChangePasswordCard />);
    fillAll();
    submit();

    await waitFor(() => expect(mockCambiar).toHaveBeenCalledWith("claveActual123", "claveNueva456"));
    expect(await screen.findByRole("status")).toHaveTextContent("Contraseña actualizada.");
    expect(screen.getByLabelText(/^contraseña actual/i)).toHaveValue("");
  });

  it("blocks a mismatched repeat inline without calling the API", () => {
    render(<ChangePasswordCard />);
    fillAll("claveActual123", "claveNueva456", "otraDistinta789");
    submit();

    expect(screen.getByText(/no coincide con la nueva contraseña/i)).toBeInTheDocument();
    expect(mockCambiar).not.toHaveBeenCalled();
  });

  it("blocks a new password equal to the current one inline", () => {
    render(<ChangePasswordCard />);
    fillAll("claveActual123", "claveActual123");
    submit();

    expect(screen.getByText(/debe ser distinta de la actual/i)).toBeInTheDocument();
    expect(mockCambiar).not.toHaveBeenCalled();
  });

  it("blocks a password that breaks the policy inline", () => {
    render(<ChangePasswordCard />);
    fillAll("claveActual123", "corta");
    submit();

    expect(screen.getByText(/al menos 8 caracteres/i, { selector: "[role=alert]" })).toBeInTheDocument();
    expect(mockCambiar).not.toHaveBeenCalled();
  });

  it("shows nothing wrong before the first submit attempt", () => {
    render(<ChangePasswordCard />);

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the backend's message under the current-password field when it is wrong", async () => {
    mockCambiar.mockRejectedValueOnce(Object.assign(new Error("La contraseña actual es incorrecta."), { status: 400 }));
    render(<ChangePasswordCard />);
    fillAll();
    submit();

    expect(await screen.findByText("La contraseña actual es incorrecta.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^contraseña actual/i)).toHaveAttribute("aria-invalid", "true");
  });
});
