/**
 * Account-creation wizard — inline step validation and the live summary rail.
 *
 * "Siguiente" is never disabled: pressing it on an incomplete step validates
 * the whole step at once, prints every message under its own field and moves
 * focus to the first invalid one. The summary rail mirrors what the visitor
 * has typed, and "Atrás" keeps every entered value.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import EnrollPage from "@/app/student/enroll/page";
import { resetTestHistory, useTestSearchParams } from "@/lib/__tests__/next-navigation-double";
import { fillBirthDate } from "@/lib/__tests__/fill-birth-date";
import { fillEnrollStudentStep } from "@/lib/__tests__/fill-enroll-student-step";
import { enrollFieldId } from "@/app/student/enroll/enroll-utils";

vi.mock("next/navigation", () => ({
  usePathname: () => "/student/enroll",
  useSearchParams: () => useTestSearchParams(),
}));

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    session: null,
    isAuthenticated: false,
    isLoading: false,
    refreshSession: vi.fn().mockResolvedValue({ kind: "authenticated" }),
  }),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ showError: vi.fn(), showSuccess: vi.fn() }),
}));

vi.mock("@/services/api", () => ({
  enrollStudent: vi.fn(),
  fetchTarifas: vi.fn().mockResolvedValue([{ categoria: "Categoria Test", precio: "1.00" }]),
}));

vi.mock("@/lib/enrollment-session", () => ({
  clearLegacyEnrollmentSession: vi.fn(),
}));

beforeEach(() => {
  resetTestHistory("/student/enroll");
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  resetTestHistory("/");
  window.sessionStorage.clear();
});

function next(): HTMLElement {
  return screen.getByRole("button", { name: /^Siguiente/ });
}

function goToPersonalStep(): void {
  fireEvent.click(next());
}

/** The message element a field points at with `aria-describedby`. */
function describedMessage(field: HTMLElement): string {
  // The field's own message comes first; a meter id may follow it.
  const id = field.getAttribute("aria-describedby")?.split(" ")[0];
  expect(id).toBeTruthy();
  return document.getElementById(id as string)?.textContent ?? "";
}

describe("EnrollPage — inline step validation", () => {
  it("keeps 'Siguiente' enabled on an empty step and shows every error inline on click", () => {
    render(<EnrollPage />);
    goToPersonalStep();

    expect(next()).toBeEnabled();
    // Nothing is red before the first attempt.
    expect(screen.getByLabelText(/^Nombres/)).not.toHaveAttribute("aria-invalid");

    fireEvent.click(next());

    for (const field of ["nombres", "apellidos", "cedula", "correo", "contrasenia"] as const) {
      const input = document.getElementById(enrollFieldId(field)) as HTMLElement;
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(describedMessage(input)).not.toBe("");
    }
    // The birth date is a fieldset around Día/Mes/Año.
    expect(document.getElementById(enrollFieldId("fechaNacimiento"))).toHaveAttribute("aria-invalid", "true");
    // The step did not advance and the red paragraph is gone.
    expect(screen.getByLabelText(/^Nombres/)).toBeInTheDocument();
    expect(screen.queryByText(/^Para continuar, revise:/)).not.toBeInTheDocument();
  });

  it("focuses the first invalid field after the attempt", () => {
    render(<EnrollPage />);
    goToPersonalStep();
    fireEvent.click(next());

    expect(document.activeElement).toBe(screen.getByLabelText(/^Nombres/));
  });

  it("re-validates an errored field as it is corrected, leaving the rest alone", () => {
    render(<EnrollPage />);
    goToPersonalStep();
    fireEvent.click(next());

    const nombres = screen.getByLabelText(/^Nombres/);
    fireEvent.change(nombres, { target: { value: "Sofia" } });

    expect(nombres).not.toHaveAttribute("aria-invalid");
    expect(screen.getByLabelText(/^Apellidos/)).toHaveAttribute("aria-invalid", "true");
  });

  it("advances on submit (Enter) once the step is valid, and 'Siguiente' is the submit control", () => {
    render(<EnrollPage />);
    goToPersonalStep();
    expect(next()).toHaveAttribute("type", "submit");

    fillEnrollStudentStep();
    fireEvent.submit(next().closest("form") as HTMLFormElement);

    expect(screen.getByLabelText(/tipo de sangre/i)).toBeInTheDocument();
  });
});

describe("EnrollPage — summary rail", () => {
  it("mirrors the typed name, the computed age and the minor hint", () => {
    render(<EnrollPage />);
    goToPersonalStep();

    const rail = screen.getByRole("complementary", { name: /resumen de la inscripción/i });
    expect(within(rail).getByText("Jugador")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^Nombres/), { target: { value: "Lucas" } });
    fireEvent.change(screen.getByLabelText(/^Apellidos/), { target: { value: "Martinez" } });
    fillBirthDate(enrollFieldId("fechaNacimiento"), "2015-06-15");

    expect(within(rail).getByText("Lucas Martinez")).toBeInTheDocument();
    expect(within(rail).getByText(/\d+ años/)).toBeInTheDocument();
    expect(within(rail).getByText(/menor de edad/i)).toBeInTheDocument();
    // The identity header leads with the initials of the typed name.
    expect(within(rail).getByText("LM")).toBeInTheDocument();
  });

  it("shows placeholders and 'Pendiente' rows before anything is typed", () => {
    render(<EnrollPage />);
    goToPersonalStep();

    const rail = screen.getByRole("complementary", { name: /resumen de la inscripción/i });
    expect(within(rail).getByText("Nuevo jugador")).toBeInTheDocument();
    expect(within(rail).getByText("Edad por completar")).toBeInTheDocument();
    // Cédula, Teléfono and Correo all read "Pendiente" so the rows keep their height.
    expect(within(rail).getAllByText("Pendiente")).toHaveLength(3);
  });

  it("reports the step as a labelled progressbar", () => {
    render(<EnrollPage />);
    goToPersonalStep();

    const rail = screen.getByRole("complementary", { name: /resumen de la inscripción/i });
    const bar = within(rail).getByRole("progressbar", { name: /progreso de la inscripción/i });
    expect(bar).toHaveAttribute("aria-valuemin", "1");
    expect(bar).toHaveAttribute("aria-valuenow", "2");
    expect(bar).toHaveAttribute("aria-valuemax", "4");
    expect(within(rail).getByText("2 de 4 pasos")).toBeInTheDocument();
  });
});

describe("EnrollPage — Atrás", () => {
  it("keeps every value entered on the previous step", async () => {
    render(<EnrollPage />);
    goToPersonalStep();
    fillEnrollStudentStep();
    fireEvent.click(next());
    fireEvent.click(screen.getByRole("button", { name: /^Atrás/ }));

    // "Atrás" is the browser's Back: it resolves on the popstate tick.
    expect(await screen.findByLabelText(/^Nombres/)).toHaveValue("Sofia");
    expect(screen.getByLabelText(/^Correo electrónico/)).toHaveValue("sofia@example.com");
  });
});
