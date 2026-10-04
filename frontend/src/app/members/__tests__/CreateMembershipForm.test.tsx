/**
 * QA3 ADM-08: when the backend rejects the creation because the person
 * already has a membership pending payment, the form says so and links to it.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CreateMembershipForm from "../CreateMembershipForm";
import { ApiClientError } from "@/services/api";

const mockCrearMembresia = vi.fn();

vi.mock("@/services/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/api")>();
  return {
    ...actual,
    crearMembresia: (data: unknown) => mockCrearMembresia(data),
    fetchTiposMembresia: () =>
      Promise.resolve([{ id: 2, categoria: "Mensual", precio: "30.00", modalidad: "MENSUAL" }]),
  };
});

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }),
}));

async function submit(): Promise<void> {
  render(<CreateMembershipForm personaId={7} onCreated={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /crear membresía/i }));
  const select = await screen.findByRole("combobox");
  await screen.findByRole("option", { name: /mensual/i });
  fireEvent.change(select, { target: { value: "2" } });
  fireEvent.click(screen.getByRole("button", { name: "Crear" }));
}

beforeEach(() => vi.clearAllMocks());

describe("CreateMembershipForm — membresía pendiente de pago (ADM-08)", () => {
  it("shows the message and a link to the pending membership's payments", async () => {
    const error = new ApiClientError("Ya tiene una membresía pendiente de pago.", 400, true);
    error.membresiaId = 157;
    mockCrearMembresia.mockRejectedValue(error);

    await submit();

    expect(await screen.findByText("Ya tiene una membresía pendiente de pago.")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /ver la membresía pendiente/i });
    expect(link).toHaveAttribute("href", "/payments");
    expect(link).toHaveAttribute("data-membresia-id", "157");
  });

  it("shows no link for any other failure", async () => {
    mockCrearMembresia.mockRejectedValue(new ApiClientError("Otro error.", 400, true));

    await submit();

    await waitFor(() => expect(screen.getByText("Otro error.")).toBeInTheDocument());
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("CreateMembershipForm — ADMA-05 membresía existente", () => {
  it("shows the backend's domain message for a 409 and no pending-payment link", async () => {
    const message = "Esta persona ya tiene una membresía inactiva; reactívela o renuévela en lugar de crear otra.";
    mockCrearMembresia.mockRejectedValue(new ApiClientError(message, 409, true));

    await submit();

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
