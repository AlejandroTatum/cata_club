/**
 * Component tests for the «Representantes» card (issue #1666, owner decision
 * L5): the primary representative sees «Invitar a otro representante» and a
 * «Quitar» for the current second guardian; a second guardian sees neither;
 * the button is disabled with its reason when every minor already has two
 * guardians.
 *
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import GuardiansCard, { MENSAJE_TOPE_DOS_REPRESENTANTES } from "@/app/student/GuardiansCard";
import type { MenorConGuardianes } from "@/services/api";

const mockFetch = vi.fn();
const mockInvitar = vi.fn();
const mockQuitar = vi.fn();
const mockShowSuccess = vi.fn();
const mockShowError = vi.fn();

vi.mock("@/services/api", () => ({
  fetchMisMenoresConGuardianes: () => mockFetch(),
  invitarCoRepresentante: (...args: unknown[]) => mockInvitar(...args),
  quitarCoRepresentante: (...args: unknown[]) => mockQuitar(...args),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({
    showToast: vi.fn(),
    showError: mockShowError,
    showSuccess: mockShowSuccess,
    showInfo: vi.fn(),
    showWarning: vi.fn(),
  }),
}));

function menor(over: Partial<MenorConGuardianes> = {}): MenorConGuardianes {
  return {
    personaId: 10,
    nombres: "Nico",
    apellidos: "Torres",
    rol: "PRINCIPAL",
    segundoGuardian: null,
    completo: false,
    ...over,
  };
}

const CON_SEGUNDO = menor({
  completo: true,
  segundoGuardian: {
    personaId: 20,
    nombres: "Pablo",
    apellidos: "Torres",
    correo: "pablo@example.com",
    estado: "ACTIVO",
  },
});

const BOTON_INVITAR = /invitar a otro representante/i;

beforeEach(() => {
  mockFetch.mockReset();
  mockInvitar.mockReset();
  mockQuitar.mockReset();
  mockShowSuccess.mockReset();
  mockShowError.mockReset();
});

describe("GuardiansCard — who sees what", () => {
  it("shows the invite button to the primary representative", async () => {
    mockFetch.mockResolvedValue([menor()]);
    render(<GuardiansCard />);

    const boton = await screen.findByRole("button", { name: BOTON_INVITAR });
    expect(boton).toBeEnabled();
    expect(screen.getByText("Sin segundo representante.")).toBeInTheDocument();
  });

  it("shows no invite or remove control to a second guardian", async () => {
    mockFetch.mockResolvedValue([menor({ rol: "SEGUNDO", completo: true })]);
    render(<GuardiansCard />);

    await screen.findByText(/Eres su segundo representante/);
    expect(screen.queryByRole("button", { name: BOTON_INVITAR })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /quitar/i })).not.toBeInTheDocument();
  });

  it("renders nothing when the session guards no minor", async () => {
    mockFetch.mockResolvedValue([]);
    const { container } = render(<GuardiansCard />);

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("disables the invite button with a one-line reason once every minor has two guardians", async () => {
    mockFetch.mockResolvedValue([CON_SEGUNDO]);
    render(<GuardiansCard />);

    const boton = await screen.findByRole("button", { name: BOTON_INVITAR });
    expect(boton).toBeDisabled();
    expect(screen.getByText(MENSAJE_TOPE_DOS_REPRESENTANTES)).toBeInTheDocument();
  });

  it("keeps the button enabled while at least one minor still has room", async () => {
    mockFetch.mockResolvedValue([CON_SEGUNDO, menor({ personaId: 11, nombres: "Ana" })]);
    render(<GuardiansCard />);

    expect(await screen.findByRole("button", { name: BOTON_INVITAR })).toBeEnabled();
    expect(screen.queryByText(MENSAJE_TOPE_DOS_REPRESENTANTES)).not.toBeInTheDocument();
  });
});

describe("GuardiansCard — invite", () => {
  it("submits the e-mail for the only eligible minor and refreshes", async () => {
    mockFetch.mockResolvedValue([menor()]);
    mockInvitar.mockResolvedValue({ estado: "VINCULADO", personaIds: [10] });
    render(<GuardiansCard />);

    fireEvent.click(await screen.findByRole("button", { name: BOTON_INVITAR }));
    fireEvent.change(screen.getByLabelText(/correo de la persona a invitar/i), {
      target: { value: "  pablo@example.com " },
    });
    fireEvent.click(screen.getByRole("button", { name: /enviar invitación/i }));

    await waitFor(() =>
      expect(mockInvitar).toHaveBeenCalledWith({ personaIds: [10], correo: "pablo@example.com" }),
    );
    await waitFor(() => expect(mockShowSuccess).toHaveBeenCalled());
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("lets the primary pick which of several minors", async () => {
    mockFetch.mockResolvedValue([menor(), menor({ personaId: 11, nombres: "Ana" })]);
    mockInvitar.mockResolvedValue({ estado: "INVITADO", personaIds: [11] });
    render(<GuardiansCard />);

    fireEvent.click(await screen.findByRole("button", { name: BOTON_INVITAR }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Nico Torres/ }));
    fireEvent.change(screen.getByLabelText(/correo de la persona a invitar/i), {
      target: { value: "pablo@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /enviar invitación/i }));

    await waitFor(() =>
      expect(mockInvitar).toHaveBeenCalledWith({ personaIds: [11], correo: "pablo@example.com" }),
    );
  });

  it("asks for the invitee's data when the e-mail has no account, then sends them", async () => {
    mockFetch.mockResolvedValue([menor()]);
    mockInvitar
      .mockResolvedValueOnce({ estado: "REQUIERE_DATOS", personaIds: [] })
      .mockResolvedValueOnce({ estado: "INVITADO", personaIds: [10] });
    render(<GuardiansCard />);

    fireEvent.click(await screen.findByRole("button", { name: BOTON_INVITAR }));
    fireEvent.change(screen.getByLabelText(/correo de la persona a invitar/i), {
      target: { value: "nuevo@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /enviar invitación/i }));

    fireEvent.change(await screen.findByLabelText("Nombres"), { target: { value: "Pablo" } });
    fireEvent.change(screen.getByLabelText("Apellidos"), { target: { value: "Torres" } });
    fireEvent.change(screen.getByLabelText("Cédula"), { target: { value: "1710034065" } });
    fireEvent.change(screen.getByLabelText("Fecha de nacimiento"), { target: { value: "1982-04-04" } });
    fireEvent.change(screen.getByLabelText("Teléfono"), { target: { value: "0991234567" } });
    fireEvent.click(screen.getByRole("button", { name: /crear cuenta e invitar/i }));

    await waitFor(() => expect(mockInvitar).toHaveBeenCalledTimes(2));
    expect(mockInvitar).toHaveBeenLastCalledWith({
      personaIds: [10],
      correo: "nuevo@example.com",
      datos: {
        nombres: "Pablo",
        apellidos: "Torres",
        cedula: "1710034065",
        fechaNacimiento: "1982-04-04",
        telefono: "0991234567",
      },
    });
  });

  it("shows the backend's clear message when the e-mail belongs to another kind of account", async () => {
    mockFetch.mockResolvedValue([menor()]);
    mockInvitar.mockRejectedValue(
      Object.assign(new Error("Ese correo ya pertenece a una cuenta que no es de representante."), { status: 400 }),
    );
    render(<GuardiansCard />);

    fireEvent.click(await screen.findByRole("button", { name: BOTON_INVITAR }));
    fireEvent.change(screen.getByLabelText(/correo de la persona a invitar/i), {
      target: { value: "entrenador@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /enviar invitación/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/no es de representante/);
    expect(mockShowSuccess).not.toHaveBeenCalled();
  });

  it("does not call the backend without an e-mail", async () => {
    mockFetch.mockResolvedValue([menor()]);
    render(<GuardiansCard />);

    fireEvent.click(await screen.findByRole("button", { name: BOTON_INVITAR }));
    fireEvent.click(screen.getByRole("button", { name: /enviar invitación/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/escribe el correo/i);
    expect(mockInvitar).not.toHaveBeenCalled();
  });
});

describe("GuardiansCard — remove", () => {
  it("lists the second guardian and removes them after confirming", async () => {
    mockFetch.mockResolvedValueOnce([CON_SEGUNDO]).mockResolvedValueOnce([menor()]);
    mockQuitar.mockResolvedValue(undefined);
    render(<GuardiansCard />);

    expect(await screen.findByText(/Segundo representante: Pablo Torres \(pablo@example.com\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /quitar al segundo representante de Nico Torres/i }));
    expect(mockQuitar).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(mockQuitar).toHaveBeenCalledWith(10));
    await waitFor(() => expect(screen.getByText("Sin segundo representante.")).toBeInTheDocument());
    expect(mockShowSuccess).toHaveBeenCalled();
  });

  it("does nothing when the primary cancels the confirmation", async () => {
    mockFetch.mockResolvedValue([CON_SEGUNDO]);
    render(<GuardiansCard />);

    fireEvent.click(await screen.findByRole("button", { name: /quitar al segundo representante/i }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(mockQuitar).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /quitar al segundo representante/i })).toBeInTheDocument();
  });

  it("flags a pending invitation", async () => {
    mockFetch.mockResolvedValue([
      menor({
        completo: true,
        segundoGuardian: {
          personaId: 21,
          nombres: "Luis",
          apellidos: "Mora",
          correo: "luis@example.com",
          estado: "PENDIENTE",
        },
      }),
    ]);
    render(<GuardiansCard />);

    expect(await screen.findByText("Invitación pendiente")).toBeInTheDocument();
  });
});
