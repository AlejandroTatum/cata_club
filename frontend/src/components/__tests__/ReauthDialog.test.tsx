/**
 * Password step-up dialog flow (#1653, S5): the action is attempted, the
 * backend asks for the password, the admin confirms, and the SAME action is
 * retried once. Cancelling retries nothing.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useState } from "react";
import { ApiClientError } from "@/services/api";
import { ReauthCancelledError, useReauthRetry } from "@/lib/use-reauth-retry";

const mockReautenticar = vi.fn();

vi.mock("@/services/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/services/api")>();
  return { ...original, reautenticar: (password: string) => mockReautenticar(password) };
});

function reauthRequired(): ApiClientError {
  return new ApiClientError("Por seguridad, confirma tu contraseña.", 403, true, "reautenticacion_requerida");
}

/** Owns an action the way `useAccountRolesAndStatus` does, and reports how it ended. */
function Harness({ action }: { action: () => Promise<string> }): React.ReactElement {
  const { withReauth, reauthDialog } = useReauthRetry();
  const [outcome, setOutcome] = useState("sin resultado");
  return (
    <>
      <button
        type="button"
        onClick={() => {
          withReauth(action).then(
            (value) => setOutcome(`ok:${value}`),
            (error: unknown) =>
              setOutcome(error instanceof ReauthCancelledError ? "cancelado" : `error:${(error as Error).message}`),
          );
        }}
      >
        Guardar
      </button>
      <p data-testid="outcome">{outcome}</p>
      {reauthDialog}
    </>
  );
}

beforeEach(() => {
  cleanup();
  mockReautenticar.mockReset();
});

describe("password step-up dialog", () => {
  it("does not prompt when the action succeeds on its own", async () => {
    const action = vi.fn().mockResolvedValue("hecho");
    render(<Harness action={action} />);

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(screen.getByTestId("outcome")).toHaveTextContent("ok:hecho"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("prompts on reautenticacion_requerida, confirms the password and retries the action once", async () => {
    const action = vi.fn().mockRejectedValueOnce(reauthRequired()).mockResolvedValueOnce("hecho");
    mockReautenticar.mockResolvedValue({ reautenticadoHasta: "2026-10-12T12:10:00Z" });
    render(<Harness action={action} />);

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    const dialog = await screen.findByRole("dialog", { name: /confirma tu contraseña/i });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription(/vale por 10 minutos/i);
    const input = screen.getByLabelText("Contraseña");
    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveAttribute("autocomplete", "current-password");
    expect(input).toHaveFocus();
    expect(action).toHaveBeenCalledTimes(1);

    fireEvent.change(input, { target: { value: "claveAdmin123" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(screen.getByTestId("outcome")).toHaveTextContent("ok:hecho"));
    expect(mockReautenticar).toHaveBeenCalledWith("claveAdmin123");
    expect(action).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("retries only once: a second reautenticacion_requerida surfaces as the error", async () => {
    const action = vi.fn().mockRejectedValue(reauthRequired());
    mockReautenticar.mockResolvedValue({ reautenticadoHasta: "2026-10-12T12:10:00Z" });
    render(<Harness action={action} />);

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    fireEvent.change(await screen.findByLabelText("Contraseña"), { target: { value: "claveAdmin123" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(screen.getByTestId("outcome")).toHaveTextContent(/^error:/));
    expect(action).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Cancelar closes the prompt and leaves the action unretried", async () => {
    const action = vi.fn().mockRejectedValue(reauthRequired());
    render(<Harness action={action} />);

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.getByTestId("outcome")).toHaveTextContent("cancelado"));
    expect(action).toHaveBeenCalledTimes(1);
    expect(mockReautenticar).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Escape cancels the prompt without reaching listeners on the document", async () => {
    const underneath = vi.fn();
    document.addEventListener("keydown", underneath);
    const action = vi.fn().mockRejectedValue(reauthRequired());
    render(<Harness action={action} />);

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await screen.findByRole("dialog");
    underneath.mockClear();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    await waitFor(() => expect(screen.getByTestId("outcome")).toHaveTextContent("cancelado"));
    expect(underneath).not.toHaveBeenCalled();
    expect(action).toHaveBeenCalledTimes(1);
    document.removeEventListener("keydown", underneath);
  });

  it("a wrong password keeps the prompt open with the backend's message and does not retry", async () => {
    const action = vi.fn().mockRejectedValue(reauthRequired());
    mockReautenticar.mockRejectedValueOnce(new ApiClientError("Contraseña incorrecta", 400, true, "contrasenia_incorrecta"));
    mockReautenticar.mockResolvedValueOnce({ reautenticadoHasta: "2026-10-12T12:10:00Z" });
    render(<Harness action={action} />);

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    fireEvent.change(await screen.findByLabelText("Contraseña"), { target: { value: "mala" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Contraseña incorrecta");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Contraseña")).toHaveValue("");
    expect(screen.getByLabelText("Contraseña")).toHaveAttribute("aria-invalid", "true");
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("asks for a password instead of sending an empty one", async () => {
    render(<Harness action={vi.fn().mockRejectedValue(reauthRequired())} />);

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Ingresa tu contraseña.");
    expect(mockReautenticar).not.toHaveBeenCalled();
  });

  it("does not prompt for any other failure and passes it through", async () => {
    const action = vi.fn().mockRejectedValue(new ApiClientError("No tienes permisos.", 403, true, "otro_codigo"));
    render(<Harness action={action} />);

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(screen.getByTestId("outcome")).toHaveTextContent("error:No tienes permisos."));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("never keeps the password once the dialog closes", async () => {
    const action = vi.fn().mockRejectedValueOnce(reauthRequired()).mockResolvedValueOnce("hecho");
    mockReautenticar.mockResolvedValue({ reautenticadoHasta: "2026-10-12T12:10:00Z" });
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    render(<Harness action={action} />);

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    fireEvent.change(await screen.findByLabelText("Contraseña"), { target: { value: "claveAdmin123" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(screen.getByTestId("outcome")).toHaveTextContent("ok:hecho"));

    expect(setItem).not.toHaveBeenCalled();
    expect(document.body.innerHTML).not.toContain("claveAdmin123");
    setItem.mockRestore();
  });
});
