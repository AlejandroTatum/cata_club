/**
 * QA4 wave 2, slice 11 — `/student/add-dependent`.
 *
 *  · FAM-17: «Siguiente» stays pressable on an incomplete step and, once pressed,
 *    names what is missing and marks the pending fields.
 *  · FAM-30: advancing a step moves focus to the step title, never to the
 *    «Saltar al contenido» link.
 *  · FAM-08 / REG-13: option labels carry no internal codes («(MUNICIPAL)»,
 *    «B POSITIVO»), and the help names the real requirement.
 *  · FAM-09: the dependent's first payment shows the total and the period it
 *    covers, with a «− 1 +» month stepper and the Pagos file picker.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import AddDependentPage from "@/app/student/add-dependent/page";
import { installAddDependentHarness } from "./add-dependent-harness";
import { addDependentFieldId } from "@/app/student/add-dependent/add-dependent-utils";
import { fillBirthDate } from "@/lib/__tests__/fill-birth-date";
import { crearRepresentadoPropio } from "@/services/api";

const harness = vi.hoisted(() => () => import("./add-dependent-harness"));

vi.mock("@/components/ProtectedRoute", async () => (await harness()).protectedRouteDouble());
vi.mock("next/navigation", async () => (await harness()).navigationDouble());
vi.mock("next/link", async () => (await harness()).nextLinkDouble());
vi.mock("next/image", async () => (await harness()).nextImageDouble());
vi.mock("@/contexts/AuthContext", async () => {
  const double = (await (await harness()).authContextDouble()) as { useAuth: () => Record<string, unknown> };
  const base = double.useAuth();
  const session = {
    ...(base.session as Record<string, unknown>),
    correoVerificado: true,
    activacionCompleta: true,
  };
  return { useAuth: () => ({ ...base, session }) };
});
vi.mock("@/contexts/ToastContext", async () => (await harness()).toastContextDouble());
vi.mock("@/services/api", () => ({
  crearRepresentadoPropio: vi.fn(),
  fetchInstituciones: vi.fn().mockResolvedValue([
    { id: 7, nombre: "Colegio Municipal Sucre", tipoEscuela: "MUNICIPAL" },
  ]),
  fetchTiposMembresia: vi.fn().mockResolvedValue([
    { id: 3, categoria: "Mensual Infantil", precio: "25.00", modalidad: "MENSUAL", activo: true, enUso: false },
  ]),
  inscribirRepresentadoConPago: vi.fn(),
  subirVoucherPago: vi.fn(),
  fetchClubPaymentInfo: vi.fn().mockResolvedValue({ holder: "Titular Prueba", accountType: "Cuenta de Ahorros", accountNumber: "1234567890", bank: "Banco Prueba", holderId: "0102030405" }),
}));

installAddDependentHarness();

function fillChildStep(): void {
  fireEvent.change(screen.getByLabelText(/^Nombres/), { target: { value: "Mateo" } });
  fireEvent.change(screen.getByLabelText(/^Apellidos/), { target: { value: "Zambrano" } });
  fireEvent.change(screen.getByLabelText(/^Cédula/), { target: { value: "1798765432" } });
  fillBirthDate(addDependentFieldId("fechaNacimiento"), "2014-05-12");
}

function next(): void {
  fireEvent.click(screen.getByRole("button", { name: /siguiente/i }));
}

describe("«Siguiente» on an incomplete step (FAM-17)", () => {
  it("stays pressable on an empty form", () => {
    render(<AddDependentPage />);

    expect(screen.getByRole("button", { name: /siguiente/i })).not.toBeDisabled();
  });

  it("names what is missing and marks the pending fields when pressed", () => {
    render(<AddDependentPage />);

    next();

    expect(
      screen.getByText("Completa los nombres, apellidos, fecha de nacimiento y cédula para continuar."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^Nombres/)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText(/^Cédula/)).toHaveAttribute("aria-invalid", "true");
  });

  it("does not advance, and does advance once the step is complete", () => {
    render(<AddDependentPage />);

    next();
    expect(screen.getByLabelText(/^Nombres/)).toBeInTheDocument();

    fillChildStep();
    next();
    expect(screen.getByLabelText(/^Tipo de sangre/)).toBeInTheDocument();
  });
});

describe("focus after advancing (FAM-30)", () => {
  it("moves to the step title, not to the skip link", () => {
    render(<AddDependentPage />);
    fillChildStep();

    next();

    const active = document.activeElement as HTMLElement;
    expect(active.tagName).toBe("H2");
    expect(active).toHaveAttribute("tabindex", "-1");
    expect(active.textContent).not.toMatch(/saltar/i);
  });

  it("does not steal focus on first render", () => {
    render(<AddDependentPage />);

    expect(document.activeElement).toBe(document.body);
  });
});

describe("labels without internal codes (FAM-08, REG-13)", () => {
  it("lists institutions by name only", async () => {
    render(<AddDependentPage />);

    expect(await screen.findByRole("option", { name: "Colegio Municipal Sucre" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /\(MUNICIPAL\)/ })).not.toBeInTheDocument();
  });

  it("writes blood types as «B positivo», in the list and in the summary", () => {
    render(<AddDependentPage />);
    fillChildStep();
    next();

    expect(screen.getByRole("option", { name: "B positivo" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "B POSITIVO" })).not.toBeInTheDocument();

    fireEvent.change(document.getElementById(addDependentFieldId("tipoSangre")) as HTMLElement, {
      target: { value: "B_POSITIVO" },
    });
    next();

    expect(screen.getByText("B positivo")).toBeInTheDocument();
  });

  it("states that the blood type is required in the help", () => {
    render(<AddDependentPage />);

    expect(screen.getByText(/Salud: tipo de sangre \(obligatorio\)/)).toBeInTheDocument();
    expect(screen.queryByText(/contacto de emergencia \(puede dejarlo/)).not.toBeInTheDocument();
  });
});

describe("the dependent's first payment (FAM-09, FAM-08)", () => {
  async function openPaymentStep(): Promise<void> {
    vi.mocked(crearRepresentadoPropio).mockResolvedValue({
      representado: {
        id: 42, nombres: "Mateo", apellidos: "Zambrano", cedula: "1798765432",
        fechaNacimiento: "2014-05-12", telefono: "0991234567",
      },
    });
    render(<AddDependentPage />);
    fillChildStep();
    next();
    fireEvent.change(document.getElementById(addDependentFieldId("tipoSangre")) as HTMLElement, {
      target: { value: "O_POSITIVO" },
    });
    fireEvent.change(screen.getByLabelText(/^Enfermedades/), { target: { value: "Ninguno" } });
    fireEvent.change(screen.getByLabelText(/^Alergias/), { target: { value: "Ninguno" } });
    next();
    fireEvent.change(screen.getByLabelText(/Cuándo quieres pagar/), { target: { value: "now" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /agregar jugador/i }));
    await screen.findByLabelText("Plan de membresía");
  }

  it("shows the club's «Cómo pagar» transfer data on the payment step (FAM-04)", async () => {
    await openPaymentStep();

    const block = await screen.findByTestId("how-to-pay");
    expect(block).toHaveTextContent("Titular Prueba");
    expect(block).toHaveTextContent("1234567890");
  });

  it("labels the plan with a Spanish price and no dot decimal", async () => {
    await openPaymentStep();

    expect(await screen.findByRole("option", { name: "Mensual Infantil — $25,00 al mes" })).toBeInTheDocument();
    expect(screen.queryByText(/\$25\.00/)).not.toBeInTheDocument();
  });

  it("shows the estimated total and the period, following the month stepper", async () => {
    await openPaymentStep();
    await screen.findByRole("option", { name: /Mensual Infantil/ });
    fireEvent.change(screen.getByLabelText("Plan de membresía"), { target: { value: "3" } });

    expect(screen.getByText("Total estimado: $25,00")).toBeInTheDocument();
    expect(screen.getByText("Período que cubre")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Un mes más" }));
    fireEvent.click(screen.getByRole("button", { name: "Un mes más" }));

    expect(screen.getByText("Total estimado: $75,00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Un mes menos" })).not.toBeDisabled();
  });

  it("hides the wizard help once the dependent exists", async () => {
    await openPaymentStep();

    expect(screen.queryByText("Cómo se agrega un jugador")).not.toBeInTheDocument();
    expect(screen.queryByText("Antes de empezar")).not.toBeInTheDocument();
  });

  it("offers the styled file picker for a transfer", async () => {
    await openPaymentStep();

    expect(screen.getByRole("button", { name: /seleccionar archivo/i })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText(/Comprobante de transferencia/)).toBeInTheDocument());
  });
});
