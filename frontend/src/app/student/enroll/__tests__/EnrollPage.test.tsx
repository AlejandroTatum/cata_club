/**
 * Component tests for the public enrollment wizard (`/student/enroll`).
 *
 * Covers the two things that only matter once the landing page routes every
 * enrollment CTA here: the demo quick-fill panel must never reach a
 * production build, and the back-link must not send an unauthenticated
 * visitor into the protected `/student` prefix.
 *
 * Mocking pattern mirrors StudentPage.test.tsx (next/link, AuthContext and
 * @/services/api stubbed).
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import EnrollPage from "@/app/student/enroll/page";

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

let mockIsAuthenticated = false;

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    session: null,
    isAuthenticated: mockIsAuthenticated,
    isLoading: false,
    refreshSession: vi.fn(),
  }),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ showError: vi.fn(), showSuccess: vi.fn() }),
}));

vi.mock("@/services/api", () => ({
  enrollStudent: vi.fn(),
  // The wizard loads the school catalogue on mount for the child flow.
  fetchInstituciones: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/enrollment-session", () => ({
  clearLegacyEnrollmentSession: vi.fn(),
}));

const DEMO_PANEL_LABEL = /rellenar datos de prueba/i;

beforeEach(() => {
  mockIsAuthenticated = false;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("EnrollPage — demo quick-fill panel", () => {
  it("renders the quick-fill panel outside production", () => {
    vi.stubEnv("NODE_ENV", "development");

    render(<EnrollPage />);

    expect(screen.getByText(DEMO_PANEL_LABEL)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Jugador" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Representante" })).toBeInTheDocument();
  });

  it("does not render the quick-fill panel in a production build", () => {
    vi.stubEnv("NODE_ENV", "production");

    render(<EnrollPage />);

    expect(screen.queryByText(DEMO_PANEL_LABEL)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Jugador" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Representante" })).not.toBeInTheDocument();
  });
});

describe("EnrollPage — back link", () => {
  it("sends an unauthenticated visitor back to the landing page", () => {
    mockIsAuthenticated = false;

    render(<EnrollPage />);

    const link = screen.getByRole("link", { name: /volver al inicio/i });
    expect(link).toHaveAttribute("href", "/");
    expect(screen.queryByRole("link", { name: /volver a mi cuenta/i })).not.toBeInTheDocument();
  });

  it("sends an authenticated user back to their account", () => {
    mockIsAuthenticated = true;

    render(<EnrollPage />);

    const link = screen.getByRole("link", { name: /volver a mi cuenta/i });
    expect(link).toHaveAttribute("href", "/student");
  });
});

describe("EnrollPage — the named stepper", () => {
  it("names every step of a self enrollment from step one", () => {
    render(<EnrollPage />);

    const stepper = screen.getByRole("list", { name: /pasos de la inscripción/i });
    expect(within(stepper).getByText("Tipo")).toBeInTheDocument();
    expect(within(stepper).getByText("Estudiante")).toBeInTheDocument();
    expect(within(stepper).getByText("Salud")).toBeInTheDocument();
    expect(within(stepper).getByText("Confirmar")).toBeInTheDocument();
    // A self enrollment has no representante, so it never gets that step.
    expect(within(stepper).queryByText("Representante")).not.toBeInTheDocument();
  });

  it("adds the representante step once a dependent enrollment is chosen", () => {
    render(<EnrollPage />);

    fireEvent.click(screen.getByRole("button", { name: /^Representante Gestiono la inscripción/ }));

    const stepper = screen.getByRole("list", { name: /pasos de la inscripción/i });
    expect(within(stepper).getByText("Representante")).toBeInTheDocument();
  });
});

describe("EnrollPage — choice cards", () => {
  it("marks the selected type with the coal + ball pill, never a red one", () => {
    render(<EnrollPage />);

    const selected = screen.getByRole("button", { name: /^Jugador Me inscribo yo al club/ });
    expect(selected).toHaveAttribute("aria-pressed", "true");
    expect(selected.className).toContain("border-coal");
    expect(selected.className).not.toMatch(/cata-red/);

    const other = screen.getByRole("button", { name: /^Representante Gestiono la inscripción/ });
    expect(other).toHaveAttribute("aria-pressed", "false");
  });

  it("moves the selection when the other card is chosen", () => {
    render(<EnrollPage />);

    const representante = screen.getByRole("button", { name: /^Representante Gestiono la inscripción/ });
    fireEvent.click(representante);

    expect(representante).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: /^Jugador Me inscribo yo al club/ }),
    ).toHaveAttribute("aria-pressed", "false");
  });
});

describe("EnrollPage — error prevention on the student step", () => {
  function goToStudentStep(): void {
    fireEvent.click(screen.getByRole("button", { name: /^Siguiente/ }));
  }

  it("disables 'Siguiente' on an empty step and says what is missing", () => {
    render(<EnrollPage />);
    goToStudentStep();

    const next = screen.getByRole("button", { name: /^Siguiente/ });
    expect(next).toBeDisabled();
    expect(screen.getByText(/para continuar, revise:/i)).toHaveTextContent("Nombres");
    expect(screen.getByText(/para continuar, revise:/i)).toHaveTextContent("Cédula de identidad");
  });

  it("shows the cédula message beside the field only after the visitor leaves it", () => {
    render(<EnrollPage />);
    goToStudentStep();

    const cedula = screen.getByLabelText(/cédula de identidad/i);
    fireEvent.change(cedula, { target: { value: "13100456" } });
    expect(screen.queryByText("La cédula debe tener 10 dígitos.")).not.toBeInTheDocument();

    fireEvent.blur(cedula);
    expect(screen.getByText("La cédula debe tener 10 dígitos.")).toBeInTheDocument();
    expect(cedula).toHaveAttribute("aria-invalid", "true");
  });

  it("counts the cédula digits as they are typed", () => {
    render(<EnrollPage />);
    goToStudentStep();

    fireEvent.change(screen.getByLabelText(/cédula de identidad/i), { target: { value: "13100456" } });
    expect(screen.getByText("Lleva 8 de 10 dígitos.")).toBeInTheDocument();
  });

  it("caps the cédula input at ten characters and keeps it numeric", () => {
    render(<EnrollPage />);
    goToStudentStep();

    const cedula = screen.getByLabelText(/cédula de identidad/i);
    expect(cedula).toHaveAttribute("maxLength", "10");
    expect(cedula).toHaveAttribute("inputMode", "numeric");
    expect(cedula).toHaveAttribute("pattern", "[0-9]{10}");
  });

  it("enables 'Siguiente' once every field on the step is valid", () => {
    render(<EnrollPage />);
    goToStudentStep();

    fireEvent.change(screen.getByLabelText(/^Nombres/), { target: { value: "Sofia" } });
    fireEvent.change(screen.getByLabelText(/^Apellidos/), { target: { value: "Martinez" } });
    fireEvent.change(screen.getByLabelText(/fecha de nacimiento/i), { target: { value: "1990-05-20" } });
    fireEvent.change(screen.getByLabelText(/cédula de identidad/i), { target: { value: "1712345678" } });
    fireEvent.change(screen.getByLabelText(/^Teléfono/), { target: { value: "0991234567" } });
    // A self enrollment signs in as the student, so its credentials are part
    // of this step (they moved here when the representante got its own step).
    fireEvent.change(screen.getByLabelText(/^Correo electrónico/), { target: { value: "sofia@example.com" } });
    fireEvent.change(screen.getByLabelText(/^Contraseña/), { target: { value: "password8" } });

    expect(screen.getByRole("button", { name: /^Siguiente/ })).toBeEnabled();
    expect(screen.queryByText(/para continuar, revise:/i)).not.toBeInTheDocument();
  });

  it("keeps a minor from self-enrolling, with the message on the birth-date field", () => {
    render(<EnrollPage />);
    goToStudentStep();

    const fecha = screen.getByLabelText(/fecha de nacimiento/i);
    fireEvent.change(fecha, { target: { value: "2015-06-15" } });
    fireEvent.blur(fecha);

    expect(screen.getByText(/menores de edad no pueden autoinscribirse/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Siguiente/ })).toBeDisabled();
  });
});
