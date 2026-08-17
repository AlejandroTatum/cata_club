/**
 * EmergencyCardDialog — issue #360.
 *
 * On-demand, single-alumno lookup triggered from the roster (never bundled
 * into the roster fetch itself, so there is no N+1 to guard here: one open
 * is one `fetchFichaEmergencia` call for exactly the alumno the trainer
 * tapped). No confirmation gate on open or close — the issue is explicit
 * that a friction step in an emergency is harm, not protection.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import EmergencyCardDialog from "../EmergencyCardDialog";
import { fetchFichaEmergencia, type FichaEmergencia } from "@/services/api";

vi.mock("@/services/api", () => ({
  fetchFichaEmergencia: vi.fn(),
}));

const fichaCompleta: FichaEmergencia = {
  alumnoNombreCompleto: "Iker Solís",
  tipoSangre: "O_POSITIVO",
  alergias: "Polen",
  contactoEmergencia: "Marta Solís",
  telefonoEmergencia: "0987654321",
  representanteNombreCompleto: "Marta Solís",
  representanteTelefono: "0987654321",
};

const fichaSinFichaMedica: FichaEmergencia = {
  alumnoNombreCompleto: "Iker Solís",
  tipoSangre: null,
  alergias: null,
  contactoEmergencia: null,
  telefonoEmergencia: null,
  representanteNombreCompleto: "Marta Solís",
  representanteTelefono: "0987654321",
};

beforeEach(() => {
  vi.mocked(fetchFichaEmergencia).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("EmergencyCardDialog", () => {
  it("renders nothing when there is no selected student", () => {
    const { container } = render(
      <EmergencyCardDialog student={null} onClose={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("fetches exactly the tapped student's card, once, when opened", async () => {
    vi.mocked(fetchFichaEmergencia).mockResolvedValue(fichaCompleta);

    render(<EmergencyCardDialog student={{ id: 5, name: "Iker Solís" }} onClose={vi.fn()} />);

    await waitFor(() => expect(fetchFichaEmergencia).toHaveBeenCalledWith(5));
    expect(fetchFichaEmergencia).toHaveBeenCalledTimes(1);
  });

  it("shows the four emergency fields and the representative backup once loaded", async () => {
    vi.mocked(fetchFichaEmergencia).mockResolvedValue(fichaCompleta);

    render(<EmergencyCardDialog student={{ id: 5, name: "Iker Solís" }} onClose={vi.fn()} />);

    expect(await screen.findByText("O_POSITIVO")).toBeInTheDocument();
    expect(screen.getByText("Polen")).toBeInTheDocument();
    expect(screen.getAllByText("Marta Solís")).not.toHaveLength(0);
    expect(screen.getAllByText("0987654321").length).toBeGreaterThan(0);
  });

  it("falls back to the representative's contact, without an error, when there is no ficha médica", async () => {
    vi.mocked(fetchFichaEmergencia).mockResolvedValue(fichaSinFichaMedica);

    render(<EmergencyCardDialog student={{ id: 5, name: "Iker Solís" }} onClose={vi.fn()} />);

    await waitFor(() => expect(fetchFichaEmergencia).toHaveBeenCalled());
    expect(screen.getByText("Marta Solís")).toBeInTheDocument();
    expect(screen.getByText("0987654321")).toBeInTheDocument();
    // No error surface for the missing-ficha case — it is expected data, not a failure.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a recoverable error, never a system-sounding message, when the fetch fails", async () => {
    vi.mocked(fetchFichaEmergencia).mockRejectedValue(new Error("network boom"));

    render(<EmergencyCardDialog student={{ id: 5, name: "Iker Solís" }} onClose={vi.fn()} />);

    const alerta = await screen.findByRole("alert");
    expect(alerta.textContent).not.toMatch(/network|error:|exception|undefined/i);
  });

  it("retries the same student on the error state's retry action", async () => {
    vi.mocked(fetchFichaEmergencia).mockRejectedValueOnce(new Error("boom"));
    vi.mocked(fetchFichaEmergencia).mockResolvedValueOnce(fichaCompleta);

    render(<EmergencyCardDialog student={{ id: 5, name: "Iker Solís" }} onClose={vi.fn()} />);

    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: /reintentar/i }));

    expect(await screen.findByText("O_POSITIVO")).toBeInTheDocument();
    expect(fetchFichaEmergencia).toHaveBeenCalledTimes(2);
  });

  it("calls onClose on Escape, with no confirmation step", async () => {
    vi.mocked(fetchFichaEmergencia).mockResolvedValue(fichaCompleta);
    const onClose = vi.fn();

    render(<EmergencyCardDialog student={{ id: 5, name: "Iker Solís" }} onClose={onClose} />);
    await screen.findByText("O_POSITIVO");

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose from its own close button, with no confirmation step", async () => {
    vi.mocked(fetchFichaEmergencia).mockResolvedValue(fichaCompleta);
    const onClose = vi.fn();

    render(<EmergencyCardDialog student={{ id: 5, name: "Iker Solís" }} onClose={onClose} />);
    await screen.findByText("O_POSITIVO");

    fireEvent.click(screen.getByRole("button", { name: /cerrar/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("never renders a field the DTO does not carry (id, cédula, fecha de nacimiento, dirección)", async () => {
    vi.mocked(fetchFichaEmergencia).mockResolvedValue(fichaCompleta);

    render(<EmergencyCardDialog student={{ id: 5, name: "Iker Solís" }} onClose={vi.fn()} />);
    await screen.findByText("O_POSITIVO");

    expect(screen.queryByText(/cédula/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/fecha de nacimiento/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/dirección/i)).not.toBeInTheDocument();
  });
});
