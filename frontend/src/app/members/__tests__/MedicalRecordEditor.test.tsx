/**
 * The blood type and the emergency phone must never leave this editor unset —
 * and, since issue #643, "set" no longer means "set to anything".
 *
 * The previous contract, locked by the two tests now inverted below, was that
 * the select PRE-SELECTED `DESCONOCIDO` and always sent it, which made the
 * backend's "no blood type" 400 unreachable from the UI. That solved the error
 * by answering the question with a non-answer: "No lo sé" was stored as though
 * it were a blood type, and a record full of `DESCONOCIDO` looked complete to
 * every screen that read it.
 *
 * #643 replaces the pre-selection with a real gate. The editor now refuses to
 * submit until a genuine blood type and a valid emergency phone are present,
 * and it validates the phone with `phoneRule` — the project's one phone
 * validator, shared with the enrollment wizards — rather than a second copy.
 *
 * Deliberately still optional, and asserted as such: alergias, enfermedades,
 * and `contactoEmergencia` (the NAME). See the PR body for why the name stays
 * optional here while remaining required in the enrollment DTO.
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

  /**
   * INVERTED (#643). Was: "creates a first record with DESCONOCIDO instead of
   * an unset blood type". The pre-selection was the defect — it manufactured
   * an answer nobody gave — so the new rule needs a lock exactly where the old
   * one had one.
   */
  it("starts a first record with no blood type chosen, and refuses to save until one is", async () => {
    // No record yet: the backend answers the GET with a 404.
    mockFetchFichaMedica.mockRejectedValue(notFound());

    render(<MedicalRecordEditor personaId={7} />);

    const select = await screen.findByLabelText<HTMLSelectElement>("Tipo de sangre");
    expect(select.value).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByText("El tipo de sangre es obligatorio.")).toBeInTheDocument();
    expect(mockActualizarFichaMedica).not.toHaveBeenCalled();
  });

  /**
   * INVERTED (#643). Was: "offers DESCONOCIDO as a selectable option, not just
   * as a default".
   */
  it("never offers DESCONOCIDO as a choice, and offers an empty placeholder instead", async () => {
    mockFetchFichaMedica.mockRejectedValue(notFound());

    render(<MedicalRecordEditor personaId={7} />);

    const select = await screen.findByLabelText<HTMLSelectElement>("Tipo de sangre");
    const values = Array.from(select.options).map((option) => option.value);
    expect(values).not.toContain("DESCONOCIDO");
    expect(values).toContain("");
    expect(values).toContain("O_POSITIVO");
  });

  it("keeps sending the blood type when editing an existing record", async () => {
    mockFetchFichaMedica.mockResolvedValue({
      tipoSangre: "O_POSITIVO",
      enfermedades: [],
      alergias: null,
      contactoEmergencia: null,
      telefonoEmergencia: "0991112233",
    });

    render(<MedicalRecordEditor personaId={7} />);

    // Una ficha que ya existe abre en reposo: los inputs aparecen al editar.
    fireEvent.click(await screen.findByRole("button", { name: "Editar" }));
    const select = screen.getByLabelText<HTMLSelectElement>("Tipo de sangre");
    expect(select.value).toBe("O_POSITIVO");

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => {
      expect(mockActualizarFichaMedica).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ tipoSangre: "O_POSITIVO" }),
      );
    });
  });

  it("saves a first record once a real blood type and a valid phone are given", async () => {
    mockFetchFichaMedica.mockRejectedValue(notFound());

    render(<MedicalRecordEditor personaId={7} />);

    fireEvent.change(await screen.findByLabelText("Tipo de sangre"), {
      target: { value: "AB_NEGATIVO" },
    });
    fireEvent.change(screen.getByLabelText("Teléfono de emergencia"), {
      target: { value: "0991112233" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => {
      expect(mockActualizarFichaMedica).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ tipoSangre: "AB_NEGATIVO", telefonoEmergencia: "0991112233" }),
      );
    });
  });
});

/**
 * The emergency phone gate. `phoneRule` from `@/lib/identity-validation` is
 * the project's single phone validator — the messages asserted here are its
 * messages verbatim, which is what proves this editor did not grow a second
 * copy of the rule with its own wording.
 */
describe("MedicalRecordEditor emergency phone (#643)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActualizarFichaMedica.mockResolvedValue({});
    mockFetchFichaMedica.mockRejectedValue(notFound());
  });

  async function fillBloodType(): Promise<void> {
    fireEvent.change(await screen.findByLabelText("Tipo de sangre"), {
      target: { value: "O_POSITIVO" },
    });
  }

  it("refuses to save with a blank emergency phone", async () => {
    render(<MedicalRecordEditor personaId={7} />);
    await fillBloodType();

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByText("El teléfono de emergencia es obligatorio.")).toBeInTheDocument();
    expect(mockActualizarFichaMedica).not.toHaveBeenCalled();
  });

  it("refuses to save with a whitespace-only emergency phone", async () => {
    render(<MedicalRecordEditor personaId={7} />);
    await fillBloodType();
    fireEvent.change(screen.getByLabelText("Teléfono de emergencia"), { target: { value: "   " } });

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByText("El teléfono de emergencia es obligatorio.")).toBeInTheDocument();
    expect(mockActualizarFichaMedica).not.toHaveBeenCalled();
  });

  it("refuses to save a malformed emergency phone, quoting the shared rule", async () => {
    render(<MedicalRecordEditor personaId={7} />);
    await fillBloodType();
    fireEvent.change(screen.getByLabelText("Teléfono de emergencia"), { target: { value: "123" } });

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(
      await screen.findByText(
        "El teléfono de emergencia debe ser un celular (09 y 8 dígitos más) o un fijo (0, código de área y 7 dígitos, 9 en total).",
      ),
    ).toBeInTheDocument();
    expect(mockActualizarFichaMedica).not.toHaveBeenCalled();
  });

  it("refuses a phone carrying letters, with the shared rule's own wording", async () => {
    render(<MedicalRecordEditor personaId={7} />);
    await fillBloodType();
    fireEvent.change(screen.getByLabelText("Teléfono de emergencia"), {
      target: { value: "099abc1234" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(
      await screen.findByText(
        "El teléfono de emergencia solo puede contener dígitos y separadores (espacio, guion, paréntesis).",
      ),
    ).toBeInTheDocument();
    expect(mockActualizarFichaMedica).not.toHaveBeenCalled();
  });

  it("accepts a landline, not only a mobile", async () => {
    render(<MedicalRecordEditor personaId={7} />);
    await fillBloodType();
    fireEvent.change(screen.getByLabelText("Teléfono de emergencia"), {
      target: { value: "042345678" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(mockActualizarFichaMedica).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ telefonoEmergencia: "042345678" }),
      ),
    );
  });
});

/**
 * Records written before #643 existed. No migration invents a phone number or
 * a blood type for them, so they arrive here exactly as they were stored — and
 * this editor is where a person, who actually knows the answer, completes them.
 * Reading such a record must keep working; SAVING one must not be able to
 * leave it invalid.
 */
describe("MedicalRecordEditor legacy records (#643)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActualizarFichaMedica.mockResolvedValue({});
  });

  const LEGACY = {
    id: 3,
    personaId: 7,
    tipoSangre: "DESCONOCIDO",
    enfermedades: [],
    alergias: null,
    contactoEmergencia: null,
    telefonoEmergencia: null,
  };

  it("still displays a legacy DESCONOCIDO record in read mode", async () => {
    mockFetchFichaMedica.mockResolvedValue(LEGACY);

    render(<MedicalRecordEditor personaId={7} />);

    await screen.findByRole("button", { name: "Editar" });
    expect(screen.getByText("DESCONOCIDO")).toBeInTheDocument();
  });

  it("drops a legacy DESCONOCIDO to an unchosen select on entering edit mode", async () => {
    mockFetchFichaMedica.mockResolvedValue(LEGACY);

    render(<MedicalRecordEditor personaId={7} />);
    fireEvent.click(await screen.findByRole("button", { name: "Editar" }));

    // Not pre-filled with the legacy non-answer: the person editing has to
    // supply the real value, which is the only honest way to backfill it.
    expect(screen.getByLabelText<HTMLSelectElement>("Tipo de sangre").value).toBe("");
  });

  it("refuses to re-save a legacy record while it is still incomplete", async () => {
    mockFetchFichaMedica.mockResolvedValue(LEGACY);

    render(<MedicalRecordEditor personaId={7} />);
    fireEvent.click(await screen.findByRole("button", { name: "Editar" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByText("El tipo de sangre es obligatorio.")).toBeInTheDocument();
    expect(screen.getByText("El teléfono de emergencia es obligatorio.")).toBeInTheDocument();
    expect(mockActualizarFichaMedica).not.toHaveBeenCalled();
  });

  it("lets a legacy record be completed and saved in one pass", async () => {
    mockFetchFichaMedica.mockResolvedValue(LEGACY);

    render(<MedicalRecordEditor personaId={7} />);
    fireEvent.click(await screen.findByRole("button", { name: "Editar" }));
    fireEvent.change(screen.getByLabelText("Tipo de sangre"), { target: { value: "B_POSITIVO" } });
    fireEvent.change(screen.getByLabelText("Teléfono de emergencia"), {
      target: { value: "0991112233" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(mockActualizarFichaMedica).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ tipoSangre: "B_POSITIVO", telefonoEmergencia: "0991112233" }),
      ),
    );
  });
});

/**
 * The other half of #643, and the easier half to lose: exactly TWO fields
 * became required. If this block ever goes green while the optional fields
 * carry a required marker, the change overshot.
 */
describe("MedicalRecordEditor required markers (#643)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActualizarFichaMedica.mockResolvedValue({});
    mockFetchFichaMedica.mockRejectedValue(notFound());
  });

  it("marks the blood type and the emergency phone as required", async () => {
    render(<MedicalRecordEditor personaId={7} />);

    expect(await screen.findByLabelText("Tipo de sangre")).toHaveAttribute("aria-required", "true");
    expect(screen.getByLabelText("Teléfono de emergencia")).toHaveAttribute("aria-required", "true");
  });

  it("marks nothing else as required", async () => {
    render(<MedicalRecordEditor personaId={7} />);

    await screen.findByLabelText("Tipo de sangre");
    for (const label of ["Alergias", "Enfermedades (separadas por coma)", "Contacto de emergencia"]) {
      expect(screen.getByLabelText(label)).not.toHaveAttribute("aria-required", "true");
    }
  });

  it("saves with every optional field left empty", async () => {
    render(<MedicalRecordEditor personaId={7} />);

    fireEvent.change(await screen.findByLabelText("Tipo de sangre"), {
      target: { value: "O_NEGATIVO" },
    });
    fireEvent.change(screen.getByLabelText("Teléfono de emergencia"), {
      target: { value: "0991112233" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(mockActualizarFichaMedica).toHaveBeenCalledWith(
        7,
        expect.objectContaining({
          tipoSangre: "O_NEGATIVO",
          telefonoEmergencia: "0991112233",
          alergias: null,
          contactoEmergencia: null,
          enfermedades: [],
        }),
      ),
    );
  });
});

/**
 * #514 — this editor is compact and content-driven. It must not stretch a
 * short medical record to fill a parent column or distribute artificial space
 * between its read-mode rows. Layout only: fields, payloads and modes stay
 * untouched.
 */
describe("MedicalRecordEditor compact layout (#514)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the card sized to its content instead of stretching its column", async () => {
    mockFetchFichaMedica.mockResolvedValue({
      tipoSangre: "O_POSITIVO",
      enfermedades: [],
      alergias: null,
      contactoEmergencia: null,
      telefonoEmergencia: null,
    });

    render(<MedicalRecordEditor personaId={7} />);

    const card = await screen.findByTestId("medical-record-card");
    expect(card.className).not.toMatch(/\bflex-1\b/);
  });

  it("keeps read-mode rows compact instead of distributing surplus air", async () => {
    mockFetchFichaMedica.mockResolvedValue({
      tipoSangre: "O_POSITIVO",
      enfermedades: [],
      alergias: null,
      contactoEmergencia: null,
      telefonoEmergencia: null,
    });

    render(<MedicalRecordEditor personaId={7} />);

    const rows = await screen.findByTestId("medical-record-rows");
    expect(rows.className).not.toMatch(/\b(?:flex-1|justify-around|justify-between)\b/);
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
  it("sends null, not undefined, for alergias/contactoEmergencia once emptied", async () => {
    mockFetchFichaMedica.mockResolvedValue({
      tipoSangre: "O_POSITIVO",
      enfermedades: [],
      alergias: "Polen",
      contactoEmergencia: "Ana Torres",
      telefonoEmergencia: "0991112233",
    });

    render(<MedicalRecordEditor personaId={7} />);

    // Una ficha que ya existe abre en reposo: los inputs aparecen al editar.
    fireEvent.click(await screen.findByRole("button", { name: "Editar" }));
    const alergias = screen.getByLabelText<HTMLInputElement>("Alergias");
    expect(alergias.value).toBe("Polen");
    const contacto = screen.getByLabelText<HTMLInputElement>("Contacto de emergencia");

    fireEvent.change(alergias, { target: { value: "" } });
    fireEvent.change(contacto, { target: { value: "" } });

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => {
      expect(mockActualizarFichaMedica).toHaveBeenCalledWith(
        7,
        expect.objectContaining({
          alergias: null,
          contactoEmergencia: null,
        }),
      );
    });
  });

  /**
   * #643 narrows FIC-5 by exactly one field, and this is the seam.
   *
   * FIC-5's fix — send `null` so an emptied field is actually erased — still
   * holds for `alergias` and `contactoEmergencia`, which remain optional. It
   * must NOT hold for the emergency phone any more: erasing that is erasing
   * the one number the club would dial, and the record it leaves behind is
   * exactly the invalid state #643 exists to forbid. The editor blocks the
   * submit instead of sending `telefonoEmergencia: null`.
   */
  it("refuses to erase the emergency phone, rather than sending null for it", async () => {
    mockFetchFichaMedica.mockResolvedValue({
      tipoSangre: "O_POSITIVO",
      enfermedades: [],
      alergias: "Polen",
      contactoEmergencia: "Ana Torres",
      telefonoEmergencia: "0991112233",
    });

    render(<MedicalRecordEditor personaId={7} />);

    fireEvent.click(await screen.findByRole("button", { name: "Editar" }));
    fireEvent.change(screen.getByLabelText("Teléfono de emergencia"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByText("El teléfono de emergencia es obligatorio.")).toBeInTheDocument();
    expect(mockActualizarFichaMedica).not.toHaveBeenCalled();
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

/**
 * El reposo de una ficha ya guardada.
 *
 * El reclamo del dueño: «acá en ficha médica debería estar como predeterminada
 * guardada, o sea un botón de editar para cambiar; si no, parece que hay que
 * llenar eso siempre». El editor SIEMPRE cargó la ficha existente — eso nunca
 * estuvo roto — pero la dibujaba con los mismos cinco inputs existiera o no,
 * así que la pantalla no distinguía «esto ya está guardado» de «esto hay que
 * llenarlo». Sobre datos médicos son dos afirmaciones opuestas.
 *
 * Lo que este bloque NO afirma, y no puede: cuándo se actualizó el dato.
 * `FichaMedicaEditable` no trae ningún timestamp, así que la vista de reposo
 * muestra el valor sin fecharlo. Una línea «actualizado el…» sería inventada.
 */
describe("MedicalRecordEditor — ficha guardada en reposo", () => {
  const FICHA_GUARDADA = {
    id: 3,
    personaId: 7,
    tipoSangre: "O_POSITIVO",
    enfermedades: [{ id: 1, nombreEnfermedad: "Asma" }],
    alergias: "Polen",
    contactoEmergencia: "Ana Torres",
    telefonoEmergencia: "0991112233",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockActualizarFichaMedica.mockResolvedValue({});
    mockFetchFichaMedica.mockResolvedValue(FICHA_GUARDADA);
  });

  it("monta en reposo, sin un solo input a la vista, cuando la ficha ya existe", async () => {
    render(<MedicalRecordEditor personaId={7} />);

    expect(await screen.findByRole("button", { name: "Editar" })).toBeInTheDocument();

    // Los cinco datos se leen; ninguno se edita.
    expect(screen.getByText("O POSITIVO")).toBeInTheDocument();
    expect(screen.getByText("Asma")).toBeInTheDocument();
    expect(screen.getByText("Polen")).toBeInTheDocument();
    expect(screen.getByText("Ana Torres")).toBeInTheDocument();
    expect(screen.getByText("0991112233")).toBeInTheDocument();

    expect(screen.queryByLabelText("Tipo de sangre")).toBeNull();
    expect(screen.queryByLabelText("Alergias")).toBeNull();
    expect(screen.queryByRole("button", { name: "Guardar" })).toBeNull();
    // El badge «Nueva» es de la ficha que no existe; ésta existe.
    expect(screen.queryByText("Nueva")).toBeNull();
  });

  it("dibuja una raya en el campo vacío, en vez de dejar la fila en blanco", async () => {
    mockFetchFichaMedica.mockResolvedValue({
      ...FICHA_GUARDADA,
      enfermedades: [],
      alergias: null,
      contactoEmergencia: null,
      telefonoEmergencia: null,
    });

    render(<MedicalRecordEditor personaId={7} />);

    await screen.findByRole("button", { name: "Editar" });
    // Los cuatro campos opcionales; el tipo de sangre nunca puede faltar.
    expect(screen.getAllByText("—")).toHaveLength(4);
  });

  it("«Editar» devuelve los inputs de siempre, ya cargados con lo guardado", async () => {
    render(<MedicalRecordEditor personaId={7} />);

    fireEvent.click(await screen.findByRole("button", { name: "Editar" }));

    expect(screen.getByLabelText<HTMLSelectElement>("Tipo de sangre").value).toBe("O_POSITIVO");
    expect(screen.getByLabelText<HTMLInputElement>("Alergias").value).toBe("Polen");
    expect(
      screen.getByLabelText<HTMLInputElement>("Enfermedades (separadas por coma)").value,
    ).toBe("Asma");
    expect(screen.getByLabelText<HTMLInputElement>("Contacto de emergencia").value).toBe("Ana Torres");
    expect(screen.getByLabelText<HTMLInputElement>("Teléfono de emergencia").value).toBe("0991112233");

    expect(screen.getByRole("button", { name: "Cancelar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar" })).toBeNull();
  });

  it("«Cancelar» descarta lo tipeado y no deja el formulario sucio", async () => {
    render(<MedicalRecordEditor personaId={7} />);

    fireEvent.click(await screen.findByRole("button", { name: "Editar" }));
    fireEvent.change(screen.getByLabelText("Alergias"), { target: { value: "Maní" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    // Vuelve al reposo mostrando el valor GUARDADO, no el tipeado.
    expect(screen.getByText("Polen")).toBeInTheDocument();
    expect(screen.queryByText("Maní")).toBeNull();
    expect(mockActualizarFichaMedica).not.toHaveBeenCalled();

    // Y al volver a entrar el input arranca limpio: cancelar restaura, no oculta.
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    expect(screen.getByLabelText<HTMLInputElement>("Alergias").value).toBe("Polen");
  });

  it("después de guardar vuelve al reposo mostrando lo recién guardado", async () => {
    mockFetchFichaMedica
      .mockResolvedValueOnce(FICHA_GUARDADA)
      .mockResolvedValue({ ...FICHA_GUARDADA, alergias: "Maní" });

    render(<MedicalRecordEditor personaId={7} />);

    fireEvent.click(await screen.findByRole("button", { name: "Editar" }));
    fireEvent.change(screen.getByLabelText("Alergias"), { target: { value: "Maní" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(mockActualizarFichaMedica).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ alergias: "Maní" }),
      ),
    );

    expect(await screen.findByRole("button", { name: "Editar" })).toBeInTheDocument();
    expect(screen.getByText("Maní")).toBeInTheDocument();
    expect(screen.queryByLabelText("Alergias")).toBeNull();
  });

  it("sin ficha arranca en edición, conserva el badge «Nueva» y lo dice con todas las letras", async () => {
    mockFetchFichaMedica.mockRejectedValue(notFound());

    render(<MedicalRecordEditor personaId={7} />);

    expect(await screen.findByLabelText("Tipo de sangre")).toBeInTheDocument();
    expect(screen.getByText("Nueva")).toBeInTheDocument();
    expect(screen.getByText(/todavía no.*ficha médica/i)).toBeInTheDocument();

    // Nada que editar ni que cancelar: no hay un estado anterior al que volver.
    expect(screen.queryByRole("button", { name: "Editar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancelar" })).toBeNull();
  });
});
