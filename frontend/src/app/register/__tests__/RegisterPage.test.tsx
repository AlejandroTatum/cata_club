/**
 * Component tests for RegisterPage.
 *
 * Covers the demo registration flow:
 *   - filling + submitting the form transitions to success state
 *   - clicking "Inscribirse" calls login with demo credentials and navigates
 *   - the navigating guard prevents double-click / repeated activation
 *   - the client-only password-mismatch check reports via
 *     `useToast().showError(...)` instead of an inline `.alert-error` box —
 *     see issue #51
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import RegisterPage from "@/app/register/page";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPush = vi.fn();
const mockRouter = { push: mockPush };

vi.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
}));

const mockLogin = vi.fn();
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    login: mockLogin,
    session: null,
    isAuthenticated: false,
    isLoading: false,
    logout: vi.fn(),
  }),
}));

const mockShowError = vi.fn();
vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({
    showToast: vi.fn(),
    showError: mockShowError,
    showSuccess: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Fill required fields and submit the registration form. */
function submitDemoForm(): void {
  fireEvent.change(screen.getByLabelText("Correo electrónico"), {
    target: { value: "test@catclub.com" },
  });
  fireEvent.change(screen.getByLabelText("Contraseña"), {
    target: { value: "password123" },
  });
  fireEvent.change(screen.getByLabelText("Confirmar Contraseña"), {
    target: { value: "password123" },
  });
  fireEvent.change(screen.getByLabelText("Nombres"), {
    target: { value: "Juan" },
  });
  fireEvent.change(screen.getByLabelText("Apellidos"), {
    target: { value: "Pérez" },
  });
  fireEvent.change(screen.getByLabelText("Cédula de Identidad"), {
    target: { value: "1712345678" },
  });
  fireEvent.change(screen.getByLabelText("Fecha de Nacimiento"), {
    target: { value: "2000-01-15" },
  });
  fireEvent.change(screen.getByLabelText("Teléfono Celular"), {
    target: { value: "0991234567" },
  });

  fireEvent.click(screen.getByRole("button", { name: /crear cuenta/i }));
}

/**
 * Submit the form and wait for the 1.5 s demo delay to resolve.
 * Returns the "Inscribirse" button once success state is visible.
 */
async function submitAndReachSuccess(): Promise<HTMLElement> {
  render(<RegisterPage />);
  submitDemoForm();
  await screen.findByText(/registro de demostración completado/i, undefined, {
    timeout: 3000,
  });
  return screen.getByRole("button", { name: /inscribirse/i });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RegisterPage", () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockLogin.mockReset();
    mockShowError.mockReset();
    // Simulate successful login by default
    mockLogin.mockResolvedValue({
      ok: true,
      session: {
        user: {
          id: "user-natural-1",
          name: "Usuario Natural",
          email: "natural@cataclub.com",
          role: "representante",
          representanteId: null,
        },
        roles: ["TESORERO"],
        loggedInAt: new Date().toISOString(),
      },
    });
  });

  it("renders the registration form by default", () => {
    render(<RegisterPage />);

    expect(
      // The heading now comes from `AuthShell`'s card title
      // (`02-registro.html:55` — "Crear una cuenta").
      screen.getByRole("heading", { name: /crear una cuenta/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /crear cuenta/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/registro de demostración completado/i),
    ).not.toBeInTheDocument();
  });

  it("shows success state after form submission", async () => {
    render(<RegisterPage />);

    submitDemoForm();

    expect(
      await screen.findByText(/registro de demostración completado/i, undefined, {
        timeout: 3000,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /inscribirse/i }),
    ).toBeInTheDocument();
  });

  describe("handleContinueToEnrollment", () => {
    // /student/enroll is a public, unauthenticated flow — see PUBLIC_EXCEPTIONS
    // in src/lib/middleware-utils.ts. This must navigate directly, without
    // calling the real login() (previously a hardcoded demo account that
    // doesn't exist on the real backend — see Finding 7).

    it("navigates directly to /student/enroll without calling login", async () => {
      const button = await submitAndReachSuccess();

      fireEvent.click(button);

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledTimes(1);
      });
      expect(mockPush).toHaveBeenCalledWith("/student/enroll");
      expect(mockLogin).not.toHaveBeenCalled();
    });

    it("disables the button and shows loading text during navigation", async () => {
      const button = await submitAndReachSuccess();

      fireEvent.click(button);

      await waitFor(() => {
        expect(button).toBeDisabled();
        expect(button).toHaveTextContent(/redirigiendo/i);
      });
    });

    it("prevents repeated activation (double-click guard)", async () => {
      const button = await submitAndReachSuccess();

      fireEvent.click(button);

      await waitFor(() => {
        expect(button).toBeDisabled();
      });

      // Click again — the guard should prevent a second navigation
      fireEvent.click(button);

      expect(mockPush).toHaveBeenCalledTimes(1);
    });
  });

  describe("empty submit", () => {
    it("shows inline field errors and blocks submission instead of relying on native validation", () => {
      render(<RegisterPage />);

      fireEvent.click(screen.getByRole("button", { name: /crear cuenta/i }));

      expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
      expect(screen.getByText("Ingrese su correo electrónico.")).toBeInTheDocument();
      expect(screen.getByLabelText("Correo electrónico")).toHaveAttribute("aria-invalid", "true");
      expect(
        screen.queryByText(/registro de demostración completado/i),
      ).not.toBeInTheDocument();
    });

    it("clears once every required field is filled in and resubmitted", async () => {
      render(<RegisterPage />);

      fireEvent.click(screen.getByRole("button", { name: /crear cuenta/i }));
      expect(screen.getByText("Ingrese su correo electrónico.")).toBeInTheDocument();

      submitDemoForm();

      expect(
        await screen.findByText(/registro de demostración completado/i, undefined, { timeout: 3000 }),
      ).toBeInTheDocument();
      expect(screen.queryByText("Ingrese su correo electrónico.")).not.toBeInTheDocument();
    });
  });

  describe("password mismatch", () => {
    it("reports the mismatch via toast.showError instead of an inline alert", () => {
      render(<RegisterPage />);

      fireEvent.change(screen.getByLabelText("Correo electrónico"), {
        target: { value: "test@catclub.com" },
      });
      fireEvent.change(screen.getByLabelText("Contraseña"), {
        target: { value: "password123" },
      });
      fireEvent.change(screen.getByLabelText("Confirmar Contraseña"), {
        target: { value: "password456" },
      });
      fireEvent.change(screen.getByLabelText("Nombres"), {
        target: { value: "Juan" },
      });
      fireEvent.change(screen.getByLabelText("Apellidos"), {
        target: { value: "Pérez" },
      });
      fireEvent.change(screen.getByLabelText("Cédula de Identidad"), {
        target: { value: "1712345678" },
      });
      fireEvent.change(screen.getByLabelText("Fecha de Nacimiento"), {
        target: { value: "2000-01-15" },
      });
      fireEvent.change(screen.getByLabelText("Teléfono Celular"), {
        target: { value: "0991234567" },
      });

      fireEvent.click(screen.getByRole("button", { name: /crear cuenta/i }));

      expect(mockShowError).toHaveBeenCalledWith("Las contraseñas no coinciden.");
      expect(document.querySelector(".alert-error")).not.toBeInTheDocument();
      expect(
        screen.queryByText(/registro de demostración completado/i),
      ).not.toBeInTheDocument();
    });
  });
});
