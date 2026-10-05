/**
 * QA round 2 (L15): the admin sets a migrated member's real «Socio desde».
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SocioDesdeForm from "../SocioDesdeForm";

const mockEstablecer = vi.fn();
const showSuccess = vi.fn();
const showError = vi.fn();

vi.mock("@/services/api", () => ({
  establecerSocioDesde: (personaId: number, fecha: string) => mockEstablecer(personaId, fecha),
}));
vi.mock("@/contexts/ToastContext", () => ({ useToast: () => ({ showSuccess, showError }) }));
vi.mock("@/lib/club-date", () => ({ clubIsoDate: () => "2026-10-05" }));

beforeEach(() => {
  vi.clearAllMocks();
  mockEstablecer.mockResolvedValue(undefined);
});

function fecha(value: string): void {
  fireEvent.change(screen.getByLabelText(/^Nueva fecha de ingreso/), { target: { value } });
}

describe("SocioDesdeForm", () => {
  it("shows the current value and caps the picker at today", () => {
    render(<SocioDesdeForm personaId={7} actual="2026-10-05T00:00:00Z" onChanged={vi.fn()} />);

    expect(screen.getByText("05/10/2026")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Nueva fecha de ingreso/)).toHaveAttribute("max", "2026-10-05");
  });

  it("shows a dash when there is no current value", () => {
    render(<SocioDesdeForm personaId={7} actual={null} onChanged={vi.fn()} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("keeps save disabled until a date is chosen", () => {
    render(<SocioDesdeForm personaId={7} onChanged={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Guardar fecha" })).toBeDisabled();
  });

  it("saves a past date and refreshes the list", async () => {
    const onChanged = vi.fn();
    render(<SocioDesdeForm personaId={7} onChanged={onChanged} />);

    fecha("2019-03-15");
    fireEvent.click(screen.getByRole("button", { name: "Guardar fecha" }));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(mockEstablecer).toHaveBeenCalledWith(7, "2019-03-15");
    expect(showSuccess).toHaveBeenCalledWith("Fecha de socio guardada correctamente.");
  });

  it("rejects a future date without calling the API", () => {
    render(<SocioDesdeForm personaId={7} onChanged={vi.fn()} />);

    fecha("2026-10-06");
    // The native `max` blocks a click-submit in the browser; the handler's own guard is the backstop.
    fireEvent.submit(screen.getByRole("form", { name: "Socio desde" }));

    expect(screen.getByText("La fecha de socio no puede ser futura.")).toBeInTheDocument();
    expect(mockEstablecer).not.toHaveBeenCalled();
  });

  it("surfaces a backend failure and does not refresh", async () => {
    mockEstablecer.mockRejectedValueOnce(new Error("boom"));
    const onChanged = vi.fn();
    render(<SocioDesdeForm personaId={7} onChanged={onChanged} />);

    fecha("2019-03-15");
    fireEvent.click(screen.getByRole("button", { name: "Guardar fecha" }));

    await waitFor(() => expect(showError).toHaveBeenCalled());
    expect(onChanged).not.toHaveBeenCalled();
  });
});
