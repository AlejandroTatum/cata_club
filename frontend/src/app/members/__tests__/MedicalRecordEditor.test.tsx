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

/**
 * The owner's own walkthrough (Aug 7): the "Ficha médica" title read at the
 * same weight as a field label like "Tipo de sangre", so it didn't register
 * as a heading at all; and on a narrow screen the student's identity — shown
 * only above this editor, never inside it — scrolled out of view while the
 * fields were still being edited. That's a real risk on medical data: editing
 * the wrong student's record because you lost sight of whose it was.
 *
 * jsdom does not lay out or scroll, so "stays on screen while scrolling"
 * itself is checked by screenshot (see docs/archive/fixes/14-header-ficha-medica.md),
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

  /*
   * Renegotiated by the socio redesign pass (D11c), with the reason recorded
   * rather than the assertion quietly relaxed.
   *
   * What this test protects has not changed: whoever is editing must not lose
   * sight of WHOSE medical data they are touching, and the mechanism must be
   * real `position: sticky`, not a comment claiming it.
   *
   * What changed is that the name stopped being a second line under the title
   * and moved INTO it. Two lines reading "Ficha médica" / "Jefferson Delgado
   * Rivadeneira" are one statement split in half, and on
   * `/student/medical-record` the first half was already the page's own `<h1>`
   * — so the card header repeated the page title word for word and the name
   * arrived as an orphan under it. That screen stacked THREE headings naming
   * the same thing; D11c allows one.
   */
  it("names the record's owner in the heading, so identity survives the fields scrolling out of view", async () => {
    render(<MedicalRecordEditor personaId={7} studentName="Jefferson Delgado Rivadeneira" />);

    const heading = await screen.findByRole("heading", {
      name: "Ficha médica de Jefferson Delgado Rivadeneira",
    });

    // The mechanism a real browser needs to keep it visible while the fields
    // below scroll: `position: sticky` pinned to the top of the nearest
    // scrolling ancestor (the member-edit dialog's scrollable body, or the
    // family portal's page).
    expect(heading.closest("[class*='sticky']")).not.toBeNull();
  });

  it("names the section alone when the caller has no name in scope", async () => {
    render(<MedicalRecordEditor personaId={7} />);

    expect(await screen.findByRole("heading", { name: "Ficha médica" })).toBeInTheDocument();
  });
});
