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

/**
 * The owner's own walkthrough (Aug 7): the "Ficha médica" title read at the
 * same weight as a field label like "Tipo de sangre", so it didn't register
 * as a heading at all; and on a narrow screen the student's identity — shown
 * only above this editor, never inside it — scrolled out of view while the
 * fields were still being edited. That's a real risk on medical data: editing
 * the wrong student's record because you lost sight of whose it was.
 *
 * jsdom does not lay out or scroll, so "stays on screen while scrolling"
 * itself is checked by screenshot (see docs/fixes/14-header-ficha-medica.md),
 * not here. What IS locked here: the title carries weight a field label
 * doesn't, the student's name is rendered at all when the caller supplies
 * it, and the element meant to persist is wired with `sticky` positioning —
 * the actual mechanism a real browser needs to keep it on screen.
 */
describe("MedicalRecordEditor header hierarchy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchFichaMedica.mockRejectedValue(notFound());
  });

  it("gives the section title more visual weight than a field label", async () => {
    render(<MedicalRecordEditor personaId={7} />);

    const title = await screen.findByRole("heading", { name: "Ficha médica" });
    const fieldLabel = screen.getByText("Tipo de sangre");

    // The field label's own weight is `font-semibold`; the title must read
    // heavier than that, not merely differently-colored.
    expect(fieldLabel.className).toMatch(/font-semibold/);
    expect(title.className).toMatch(/font-extrabold/);
    expect(title.className).not.toMatch(/text-xs/);
  });

  it("shows the student's name so identity survives once the fields scroll out of view", async () => {
    render(<MedicalRecordEditor personaId={7} studentName="Jefferson Delgado Rivadeneira" />);

    await screen.findByRole("heading", { name: "Ficha médica" });

    const identity = screen.getByText("Jefferson Delgado Rivadeneira");
    // The mechanism a real browser needs to keep it visible while the fields
    // below scroll: `position: sticky` pinned to the top of the nearest
    // scrolling ancestor (the member-edit dialog's scrollable body, or the
    // family portal's page).
    expect(identity.closest("[class*='sticky']")).not.toBeNull();
  });
});
