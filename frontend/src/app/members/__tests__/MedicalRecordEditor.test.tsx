/**
 * The blood type must never leave this editor unset.
 *
 * The backend's PATCH upsert refuses to create a first medical record without
 * a blood type (400, `OperacionInvalida`). `DESCONOCIDO` is a valid value in
 * the `TipoSangre` enum, so the editor pre-selects it and always sends it —
 * which is why that error is unreachable from the UI. This test locks that in:
 * a refactor that starts the select empty, or drops `tipoSangre` from the
 * payload, brings the error back and fails here.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import MedicalRecordEditor from "../MedicalRecordEditor";

const mockFetchFichaMedica = vi.fn();
const mockActualizarFichaMedica = vi.fn();

vi.mock("@/services/api", () => ({
  fetchFichaMedica: (personaId: number) => mockFetchFichaMedica(personaId),
  actualizarFichaMedica: (personaId: number, data: unknown) =>
    mockActualizarFichaMedica(personaId, data),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }),
}));

describe("MedicalRecordEditor blood type", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActualizarFichaMedica.mockResolvedValue({});
  });

  it("creates a first record with DESCONOCIDO instead of an unset blood type", async () => {
    // No record yet: the backend answers the GET with "Ficha médica no encontrada".
    mockFetchFichaMedica.mockRejectedValue(new Error("Ficha médica no encontrada"));

    render(<MedicalRecordEditor personaId={7} />);

    const select = await screen.findByLabelText<HTMLSelectElement>("Tipo de sangre");
    expect(select.value).toBe("DESCONOCIDO");

    fireEvent.click(screen.getByRole("button", { name: /Guardar ficha médica/i }));

    await waitFor(() => {
      expect(mockActualizarFichaMedica).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ tipoSangre: "DESCONOCIDO" }),
      );
    });
  });

  it("offers DESCONOCIDO as a selectable option, not just as a default", async () => {
    mockFetchFichaMedica.mockRejectedValue(new Error("Ficha médica no encontrada"));

    render(<MedicalRecordEditor personaId={7} />);

    const select = await screen.findByLabelText<HTMLSelectElement>("Tipo de sangre");
    const values = Array.from(select.options).map((option) => option.value);
    expect(values).toContain("DESCONOCIDO");
    expect(values).not.toContain("");
  });

  it("keeps sending the blood type when editing an existing record", async () => {
    mockFetchFichaMedica.mockResolvedValue({
      tipoSangre: "O_POSITIVO",
      enfermedades: [],
      alergias: null,
      contactoEmergencia: null,
      telefonoEmergencia: null,
    });

    render(<MedicalRecordEditor personaId={7} />);

    const select = await screen.findByLabelText<HTMLSelectElement>("Tipo de sangre");
    await waitFor(() => expect(select.value).toBe("O_POSITIVO"));

    fireEvent.click(screen.getByRole("button", { name: /Guardar ficha médica/i }));

    await waitFor(() => {
      expect(mockActualizarFichaMedica).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ tipoSangre: "O_POSITIVO" }),
      );
    });
  });
});
