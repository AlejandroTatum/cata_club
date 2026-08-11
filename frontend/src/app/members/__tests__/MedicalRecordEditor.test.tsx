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

/**
 * What `fetchFichaMedica` really rejects with when there is no record yet: an
 * `ApiClientError`, which carries the STATUS as well as the sentence. These
 * mocks used to throw a bare `Error`, and it passed only because the component
 * detected "no record" by looking for a substring in the message. It now reads
 * the 404, so the mock has to be faithful to the client it stands in for.
 */
function notFound(): Error & { status: number } {
  return Object.assign(new Error("Ficha médica no encontrada"), { status: 404 });
}

describe("MedicalRecordEditor blood type", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActualizarFichaMedica.mockResolvedValue({});
  });

  it("creates a first record with DESCONOCIDO instead of an unset blood type", async () => {
    // No record yet: the backend answers the GET with a 404.
    mockFetchFichaMedica.mockRejectedValue(notFound());

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
    mockFetchFichaMedica.mockRejectedValue(notFound());

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

describe("MedicalRecordEditor clearing a field (FIC-5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActualizarFichaMedica.mockResolvedValue({});
  });

  /**
   * FIC-5: clearing "Alergias" and saving showed a green success toast, but
   * the old value survived in the database. Root cause was
   * `alergias.trim() || undefined` — an emptied field became `undefined`,
   * the BFF route omits `undefined` keys, and the backend's partial-update
   * PATCH treats an omitted key as "leave unchanged". Sending `null`
   * explicitly is what actually clears it (see the backend's
   * `test_vaciar_alergias_contacto_y_telefono_los_borra`).
   */
  it("sends null, not undefined, for alergias/contactoEmergencia/telefonoEmergencia once emptied", async () => {
    mockFetchFichaMedica.mockResolvedValue({
      tipoSangre: "O_POSITIVO",
      enfermedades: [],
      alergias: "Polen",
      contactoEmergencia: "Ana Torres",
      telefonoEmergencia: "0991112233",
    });

    render(<MedicalRecordEditor personaId={7} />);

    const alergias = await screen.findByLabelText<HTMLInputElement>("Alergias");
    await waitFor(() => expect(alergias.value).toBe("Polen"));
    const contacto = screen.getByLabelText<HTMLInputElement>("Contacto de emergencia");
    const telefono = screen.getByLabelText<HTMLInputElement>("Teléfono de emergencia");

    fireEvent.change(alergias, { target: { value: "" } });
    fireEvent.change(contacto, { target: { value: "" } });
    fireEvent.change(telefono, { target: { value: "" } });

    fireEvent.click(screen.getByRole("button", { name: /Guardar ficha médica/i }));

    await waitFor(() => {
      expect(mockActualizarFichaMedica).toHaveBeenCalledWith(
        7,
        expect.objectContaining({
          alergias: null,
          contactoEmergencia: null,
          telefonoEmergencia: null,
        }),
      );
    });
  });
});
