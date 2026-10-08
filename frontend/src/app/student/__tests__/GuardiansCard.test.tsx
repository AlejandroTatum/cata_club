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
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import GuardiansCard, { MENSAJE_TOPE_DOS_REPRESENTANTES } from "@/app/student/GuardiansCard";
import type { MenorConGuardianes } from "@/services/api";
import { fillBirthDate } from "@/lib/__tests__/fill-birth-date";
import {
  cedulaRule,
  personNameRule,
  phoneRule,
  representativeBirthDateRule,
} from "@/lib/identity-validation";

const mockFetch = vi.fn();
const mockInvitar = vi.fn();
const mockQuitar = vi.fn();
const mockRecibidas = vi.fn();
const mockAceptar = vi.fn();
const mockShowSuccess = vi.fn();
const mockShowError = vi.fn();

vi.mock("@/services/api", () => ({
  fetchMisMenoresConGuardianes: () => mockFetch(),
  invitarCoRepresentante: (...args: unknown[]) => mockInvitar(...args),
  quitarCoRepresentante: (...args: unknown[]) => mockQuitar(...args),
  fetchInvitacionesRecibidas: () => mockRecibidas(),
  aceptarInvitacionRecibida: (...args: unknown[]) => mockAceptar(...args),
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

const PENDIENTE = menor({
  completo: true,
  segundoGuardian: {
    personaId: null,
    nombres: null,
    apellidos: null,
    correo: "luis@example.com",
    estado: "PENDIENTE",
  },
});

const BOTON_INVITAR = /invitar a otro representante/i;

beforeEach(() => {
  mockFetch.mockReset();
  mockInvitar.mockReset();
  mockQuitar.mockReset();
  mockRecibidas.mockReset().mockResolvedValue([]);
  mockAceptar.mockReset();
  mockShowSuccess.mockReset();
  mockShowError.mockReset();
});

describe("GuardiansCard — who sees what", () => {
  it("shows the invite button to the primary representative", async () => {
    mockFetch.mockResolvedValue([menor()]);
    render(<GuardiansCard />);

    const boton = await screen.findByRole("button", { name: BOTON_INVITAR });
    expect(boton).toBeEnabled();
    expect(screen.getByText("Sin segundo representante")).toBeInTheDocument();
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

const DATOS_INVITADO = {
  nombres: "Pablo",
  apellidos: "Torres",
  cedula: "1710034065",
  fechaNacimiento: "1982-04-04",
  telefono: "0991234567",
};

function campo(id: string): HTMLElement {
  const el = document.getElementById(`invitar-${id}`);
  if (el === null) throw new Error(`missing field invitar-${id}`);
  return el;
}

function escribir(id: string, value: string): void {
  fireEvent.change(campo(id), { target: { value } });
}

function llenarDatos(): void {
  escribir("nombres", "Pablo");
  escribir("apellidos", "Torres");
  escribir("cedula", "1710034065");
  fillBirthDate("invitar-fecha-nacimiento", "1982-04-04");
  escribir("telefono", "991234567");
}

const MENSAJE_NEUTRO = "Si el correo es válido, enviaremos la invitación.";

describe("GuardiansCard — invite", () => {
  it("collects the invitee's data up front and sends everything in one step", async () => {
    mockFetch.mockResolvedValue([menor()]);
    mockInvitar.mockResolvedValue({ mensaje: MENSAJE_NEUTRO });
    render(<GuardiansCard />);

    fireEvent.click(await screen.findByRole("button", { name: BOTON_INVITAR }));
    escribir("correo", "  pablo@example.com ");
    llenarDatos();
    fireEvent.click(screen.getByRole("button", { name: /enviar invitación/i }));

    await waitFor(() =>
      expect(mockInvitar).toHaveBeenCalledWith({
        personaIds: [10],
        correo: "pablo@example.com",
        datos: DATOS_INVITADO,
      }),
    );
    expect(mockInvitar).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mockShowSuccess).toHaveBeenCalledWith(MENSAJE_NEUTRO));
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: /crear cuenta e invitar/i })).not.toBeInTheDocument();
  });

  it("shows the same neutral message whatever the backend decided", async () => {
    mockFetch.mockResolvedValue([menor()]);
    mockInvitar.mockResolvedValue({ mensaje: "otra cosa" });
    render(<GuardiansCard />);

    fireEvent.click(await screen.findByRole("button", { name: BOTON_INVITAR }));
    escribir("correo", "pablo@example.com");
    llenarDatos();
    fireEvent.click(screen.getByRole("button", { name: /enviar invitación/i }));

    await waitFor(() => expect(mockShowSuccess).toHaveBeenCalledWith(MENSAJE_NEUTRO));
  });

  it("lets the primary pick which of several minors", async () => {
    mockFetch.mockResolvedValue([menor(), menor({ personaId: 11, nombres: "Ana" })]);
    mockInvitar.mockResolvedValue({ mensaje: MENSAJE_NEUTRO });
    render(<GuardiansCard />);

    fireEvent.click(await screen.findByRole("button", { name: BOTON_INVITAR }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Nico Torres/ }));
    escribir("correo", "pablo@example.com");
    llenarDatos();
    fireEvent.click(screen.getByRole("button", { name: /enviar invitación/i }));

    await waitFor(() =>
      expect(mockInvitar).toHaveBeenCalledWith({
        personaIds: [11],
        correo: "pablo@example.com",
        datos: DATOS_INVITADO,
      }),
    );
  });

  it("marks every missing field with the registration's own message and sends nothing", async () => {
    mockFetch.mockResolvedValue([menor()]);
    render(<GuardiansCard />);

    fireEvent.click(await screen.findByRole("button", { name: BOTON_INVITAR }));
    escribir("correo", "pablo@example.com");
    escribir("nombres", "Pablo");
    fireEvent.click(screen.getByRole("button", { name: /enviar invitación/i }));

    expect(await screen.findByText("Los apellidos del representante son obligatorios.")).toBeInTheDocument();
    expect(screen.getByText("La cédula del representante es obligatoria.")).toBeInTheDocument();
    expect(screen.getByText("Indica la fecha de nacimiento del representante.")).toBeInTheDocument();
    expect(screen.getByText("El teléfono del representante es obligatorio.")).toBeInTheDocument();
    expect(campo("apellidos")).toHaveAttribute("aria-invalid", "true");
    expect(campo("nombres")).not.toHaveAttribute("aria-invalid");
    expect(screen.getByRole("alert")).toHaveTextContent("Revisa los campos marcados.");
    expect(mockInvitar).not.toHaveBeenCalled();

    llenarDatos();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("rejects the same invalid values the registration rejects", async () => {
    mockFetch.mockResolvedValue([menor()]);
    render(<GuardiansCard />);

    fireEvent.click(await screen.findByRole("button", { name: BOTON_INVITAR }));
    escribir("correo", "pablo@ejemplo");
    escribir("nombres", "Pablo3");
    escribir("apellidos", "Torres");
    escribir("cedula", "1234567890");
    fillBirthDate("invitar-fecha-nacimiento", "2015-04-04");
    escribir("telefono", "12345");
    fireEvent.click(screen.getByRole("button", { name: /enviar invitación/i }));

    expect(
      await screen.findByText(
        "El correo del representante no es válido. Revísalo; debe tener un formato como nombre@ejemplo.com.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(personNameRule("Pablo3", "Los nombres del representante")!)).toBeInTheDocument();
    expect(screen.getByText(cedulaRule("1234567890", "La cédula del representante")!)).toBeInTheDocument();
    expect(screen.getByText(representativeBirthDateRule("2015-04-04")!)).toBeInTheDocument();
    expect(screen.getByText(phoneRule("012345", "El teléfono del representante")!)).toBeInTheDocument();
    expect(screen.queryByText(/apellidos del representante/)).not.toBeInTheDocument();
    expect(mockInvitar).not.toHaveBeenCalled();
  });

  it("shows a field's message once the visitor leaves it, as in the registration", async () => {
    mockFetch.mockResolvedValue([menor()]);
    render(<GuardiansCard />);

    fireEvent.click(await screen.findByRole("button", { name: BOTON_INVITAR }));
    const mensaje = cedulaRule("1234567890", "La cédula del representante")!;
    escribir("cedula", "1234567890");
    expect(screen.queryByText(mensaje)).not.toBeInTheDocument();
    fireEvent.blur(campo("cedula"));
    expect(await screen.findByText(mensaje)).toBeInTheDocument();
    escribir("cedula", "1710034065");
    expect(screen.queryByText(mensaje)).not.toBeInTheDocument();
  });

  it("shows the backend's message when the invitation is refused", async () => {
    mockFetch.mockResolvedValue([menor()]);
    mockInvitar.mockRejectedValue(Object.assign(new Error("Solo el representante principal."), { status: 400 }));
    render(<GuardiansCard />);

    fireEvent.click(await screen.findByRole("button", { name: BOTON_INVITAR }));
    escribir("correo", "pablo@example.com");
    llenarDatos();
    fireEvent.click(screen.getByRole("button", { name: /enviar invitación/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/solo el representante principal/i);
    expect(mockShowSuccess).not.toHaveBeenCalled();
  });

  it("does not call the backend without an e-mail", async () => {
    mockFetch.mockResolvedValue([menor()]);
    render(<GuardiansCard />);

    fireEvent.click(await screen.findByRole("button", { name: BOTON_INVITAR }));
    llenarDatos();
    fireEvent.click(screen.getByRole("button", { name: /enviar invitación/i }));

    expect(await screen.findByText("Escribe el correo de la persona a invitar.")).toBeInTheDocument();
    expect(mockInvitar).not.toHaveBeenCalled();
  });
});

describe("GuardiansCard — remove", () => {
  it("lists the second guardian and removes them after confirming", async () => {
    mockFetch.mockResolvedValueOnce([CON_SEGUNDO]).mockResolvedValueOnce([menor()]);
    mockQuitar.mockResolvedValue(undefined);
    render(<GuardiansCard />);

    expect(await screen.findByText("Con segundo representante")).toBeInTheDocument();
    expect(screen.getByText("Pablo Torres (pablo@example.com)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /quitar al segundo representante de Nico Torres/i }));
    expect(mockQuitar).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(mockQuitar).toHaveBeenCalledWith(10));
    await waitFor(() => expect(screen.getByText("Sin segundo representante")).toBeInTheDocument());
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

  it("shows a pending second guardian as an «Invitación pendiente» chip plus the e-mail, with the remove action", async () => {
    mockFetch.mockResolvedValueOnce([PENDIENTE]).mockResolvedValueOnce([menor()]);
    mockQuitar.mockResolvedValue(undefined);
    render(<GuardiansCard />);

    expect(await screen.findByText("Invitación pendiente")).toBeInTheDocument();
    expect(screen.getByText("luis@example.com")).toBeInTheDocument();
    expect(screen.queryByText(/null/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /quitar al segundo representante de Nico Torres/i }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(mockQuitar).toHaveBeenCalledWith(10));
    await waitFor(() => expect(screen.getByText("Sin segundo representante")).toBeInTheDocument());
  });
});

describe("GuardiansCard — per-child rows (#1707)", () => {
  it("renders one list item per child, each with its own status chip", async () => {
    mockFetch.mockResolvedValue([
      menor(),
      { ...PENDIENTE, personaId: 11, nombres: "Ana", apellidos: "Torres" },
    ]);
    render(<GuardiansCard />);

    await screen.findByText("Sin segundo representante");
    const filas = within(screen.getByRole("list", { name: "Hijos representados" })).getAllByRole("listitem");
    expect(filas).toHaveLength(2);
    expect(within(filas[0]).getByText("Sin segundo representante")).toBeInTheDocument();
    expect(within(filas[1]).getByText("Invitación pendiente")).toBeInTheDocument();
  });
});

describe("GuardiansCard — received invitations", () => {
  const RECIBIDA = { id: 7, nombreMenor: "Nico", nombreInvitante: "Marta Torres" };

  it("lists the invitations with the child's first name and who invited", async () => {
    mockFetch.mockResolvedValue([]);
    mockRecibidas.mockResolvedValue([RECIBIDA]);
    render(<GuardiansCard />);

    expect(await screen.findByText("Invitaciones recibidas")).toBeInTheDocument();
    expect(screen.getByText(/Marta Torres/)).toBeInTheDocument();
    expect(screen.getByText(/Nico/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /aceptar/i })).toBeInTheDocument();
  });

  it("accepts an invitation and refreshes both lists", async () => {
    mockFetch.mockResolvedValueOnce([]).mockResolvedValueOnce([menor({ rol: "SEGUNDO", completo: true })]);
    mockRecibidas.mockResolvedValueOnce([RECIBIDA]).mockResolvedValueOnce([]);
    mockAceptar.mockResolvedValue(undefined);
    render(<GuardiansCard />);

    fireEvent.click(await screen.findByRole("button", { name: /aceptar/i }));

    await waitFor(() => expect(mockAceptar).toHaveBeenCalledWith(7));
    expect(await screen.findByText(/Eres su segundo representante/)).toBeInTheDocument();
    expect(screen.queryByText("Invitaciones recibidas")).not.toBeInTheDocument();
    expect(mockShowSuccess).toHaveBeenCalled();
  });

  it("keeps the invitation and reports the error when accepting fails", async () => {
    mockFetch.mockResolvedValue([]);
    mockRecibidas.mockResolvedValue([RECIBIDA]);
    mockAceptar.mockRejectedValue(
      Object.assign(new Error("La invitación ya no está disponible."), { status: 409 }),
    );
    render(<GuardiansCard />);

    fireEvent.click(await screen.findByRole("button", { name: /aceptar/i }));

    await waitFor(() => expect(mockShowError).toHaveBeenCalledWith("La invitación ya no está disponible."));
    expect(screen.getByText("Invitaciones recibidas")).toBeInTheDocument();
  });

  it("hides the section when there are none", async () => {
    mockFetch.mockResolvedValue([menor()]);
    render(<GuardiansCard />);

    await screen.findByText("Sin segundo representante");
    expect(screen.queryByText("Invitaciones recibidas")).not.toBeInTheDocument();
  });

  it("still shows the invitations when the guardians list cannot load", async () => {
    mockFetch.mockRejectedValue(new Error("boom"));
    mockRecibidas.mockResolvedValue([RECIBIDA]);
    render(<GuardiansCard />);

    expect(await screen.findByText("Invitaciones recibidas")).toBeInTheDocument();
  });
});
