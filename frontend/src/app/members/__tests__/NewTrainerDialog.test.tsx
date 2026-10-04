/**
 * Issue #1575: «Nuevo entrenador» — minimal data, the existing identity
 * validations, and a clear message when the cédula or email already exist.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import NewTrainerDialog from "../NewTrainerDialog";
import { ApiClientError } from "@/services/api";

const mockCrearEntrenador = vi.fn();
const mockShowSuccess = vi.fn();

vi.mock("@/services/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/api")>();
  return { ...actual, crearEntrenador: (data: unknown) => mockCrearEntrenador(data) };
});

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ showSuccess: mockShowSuccess, showError: vi.fn() }),
}));

const VALID = {
  nombres: "Marta",
  apellidos: "Zambrano",
  cedula: "1710034065",
  fechaNacimiento: "1988-03-02",
  correo: "marta@cataclub.com",
  telefono: "0991234567",
};

function fill(overrides: Partial<typeof VALID> = {}): void {
  const values = { ...VALID, ...overrides };
  fireEvent.change(screen.getByLabelText(/^Nombres/), { target: { value: values.nombres } });
  fireEvent.change(screen.getByLabelText(/^Apellidos/), { target: { value: values.apellidos } });
  fireEvent.change(screen.getByLabelText(/^Cédula/), { target: { value: values.cedula } });
  fireEvent.change(screen.getByLabelText(/^Fecha de nacimiento/), { target: { value: values.fechaNacimiento } });
  fireEvent.change(screen.getByLabelText(/^Correo/), { target: { value: values.correo } });
  fireEvent.change(screen.getByLabelText(/^Celular/), { target: { value: values.telefono } });
}

function submit(): void {
  fireEvent.click(screen.getByRole("button", { name: "Crear y enviar invitación" }));
}

beforeEach(() => vi.clearAllMocks());

describe("NewTrainerDialog", () => {
  it("asks only for names, cédula, birth date, email and mobile — no plan, ficha or category", () => {
    render(<NewTrainerDialog onClose={vi.fn()} onCreated={vi.fn()} />);

    for (const label of [/^Nombres/, /^Apellidos/, /^Cédula/, /^Fecha de nacimiento/, /^Correo/, /^Celular/]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.getAllByRole("textbox").length + document.querySelectorAll("input[type=date]").length).toBe(6);
    expect(screen.queryByText(/plan|mensualidad|categoría|ficha/i)).not.toBeInTheDocument();
  });

  it("sends the trimmed data, confirms the invitation and refreshes the list", async () => {
    mockCrearEntrenador.mockResolvedValue({ personaId: 91 });
    const onCreated = vi.fn();
    const onClose = vi.fn();
    render(<NewTrainerDialog onClose={onClose} onCreated={onCreated} />);

    fill({ nombres: "  Marta ", correo: " marta@cataclub.com " });
    submit();

    await waitFor(() => expect(mockCrearEntrenador).toHaveBeenCalledWith(VALID));
    expect(mockShowSuccess).toHaveBeenCalledWith(expect.stringContaining("marta@cataclub.com"));
    expect(onCreated).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it.each([
    ["cédula", { cedula: "1234567890" }, /^La cédula/],
    ["celular", { telefono: "123" }, /^El celular no es válido/],
    ["correo", { correo: "no-es-correo" }, /^Escribe un correo válido/],
    ["fecha de nacimiento", { fechaNacimiento: "" }, /^Indica la fecha de nacimiento/],
    ["mayoría de edad", { fechaNacimiento: "2020-01-01" }, /^El entrenador debe ser mayor de edad/],
    ["nombres", { nombres: "" }, /^Los nombres son obligatorios/],
  ])("blocks the submit and says what is wrong with the %s", async (_name, override, message) => {
    render(<NewTrainerDialog onClose={vi.fn()} onCreated={vi.fn()} />);

    fill(override);
    submit();

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(mockCrearEntrenador).not.toHaveBeenCalled();
  });

  it("shows the backend's duplicate message and stays open so nothing is lost", async () => {
    mockCrearEntrenador.mockRejectedValue(
      new ApiClientError("Ya existe una persona o una cuenta con esa cédula o ese correo.", 400, true),
    );
    const onClose = vi.fn();
    render(<NewTrainerDialog onClose={onClose} onCreated={vi.fn()} />);

    fill();
    submit();

    expect(await screen.findByText(/Ya existe una persona o una cuenta/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/^Cédula/)).toHaveValue(VALID.cedula);
  });
});
