/**
 * Component tests for ForgotPasswordPage.
 *
 * Covers the failed-submit error path, routed through
 * `useToast().showError(...)` instead of an inline `.alert-error` box — see
 * issue #51. The persistent "email sent" success card (anti-enumeration UX)
 * is out of scope for this migration — it always shows the same message
 * regardless of whether the email exists, and does not use the toast system.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ForgotPasswordPage from "@/app/forgot-password/page";
// The mocked ApiClientError (see vi.mock below — vi.mock is hoisted, so the
// class must be defined inside the factory and re-imported here to build
// instances of the exact same class the mocked module exports).
import { ApiClientError as MockApiClientError } from "@/services/api";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockShowError = vi.fn();
vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({
    showToast: vi.fn(),
    showError: mockShowError,
    showSuccess: vi.fn(),
  }),
}));

const mockSolicitarRecuperacion = vi.fn();
vi.mock("@/services/api", () => {
  class MockApiClientError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = "ApiClientError";
      this.status = status;
    }
  }
  return {
    solicitarRecuperacion: (correo: string) => mockSolicitarRecuperacion(correo),
    ApiClientError: MockApiClientError,
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fill and submit the forgot-password form with the given email. */
function submitForgotPasswordForm(email = "user@cataclub.com"): void {
  fireEvent.change(screen.getByLabelText("Correo electrónico"), {
    target: { value: email },
  });
  fireEvent.click(
    screen.getByRole("button", { name: /enviar enlace de recuperación/i }),
  );
}

describe("ForgotPasswordPage", () => {
  beforeEach(() => {
    mockShowError.mockReset();
    mockSolicitarRecuperacion.mockReset();
  });

  it("renders the form by default", () => {
    render(<ForgotPasswordPage />);

    expect(screen.getByLabelText("Correo electrónico")).toBeInTheDocument();
    expect(
      screen.queryByText(/revise su correo/i),
    ).not.toBeInTheDocument();
  });

  it("shows the persistent success card on a successful request, without a toast", async () => {
    mockSolicitarRecuperacion.mockResolvedValue({ mensaje: "ok" });

    render(<ForgotPasswordPage />);
    submitForgotPasswordForm();

    expect(await screen.findByText(/revise su correo/i)).toBeInTheDocument();
    expect(mockShowError).not.toHaveBeenCalled();
  });

  describe("failed submission", () => {
    it("shows the mapped API error via toast.showError instead of an inline alert", async () => {
      // A 5xx from /auth/recuperar-contrasenia: the mail leg failed on the
      // server. Its `detail` describes the server's failure, never the
      // address the user typed, so what reaches the toast is the product's
      // own sentence about the server — not the body of the 500.
      mockSolicitarRecuperacion.mockRejectedValue(
        new MockApiClientError("No se pudo procesar la solicitud.", 500),
      );

      render(<ForgotPasswordPage />);
      submitForgotPasswordForm();

      await waitFor(() => {
        expect(mockShowError).toHaveBeenCalledWith(
          "El servidor no pudo completar la operación. Intente nuevamente en unos minutos.",
        );
      });
      expect(document.querySelector(".alert-error")).not.toBeInTheDocument();
    });

    it("shows a fallback message via toast.showError for a non-API error", async () => {
      mockSolicitarRecuperacion.mockRejectedValue(new Error("network down"));

      render(<ForgotPasswordPage />);
      submitForgotPasswordForm();

      await waitFor(() => {
        expect(mockShowError).toHaveBeenCalledWith(
          "No se pudo procesar la solicitud. Intente nuevamente.",
        );
      });
      expect(document.querySelector(".alert-error")).not.toBeInTheDocument();
    });

    it("shows the empty-email validation message via toast.showError", () => {
      const { container } = render(<ForgotPasswordPage />);

      // Dispatch the submit event directly on the form so the component's
      // own empty-email guard runs, bypassing the browser-only "required"
      // constraint-validation UI (not what this test targets).
      const form = container.querySelector("form");
      expect(form).not.toBeNull();
      fireEvent.submit(form as HTMLFormElement);

      expect(mockShowError).toHaveBeenCalledWith(
        "Ingrese su correo electrónico.",
      );
      expect(document.querySelector(".alert-error")).not.toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// The way back is /login, and there is only one of it (#295)
//
// This screen is reached from the login form's "¿Olvidó su contraseña?", so
// the step behind it is /login — never the public landing. It used to say
// both: AuthShell's coal exit pointed at "/" while a second control inside
// the card pointed at "/login", which is two back controls disagreeing on one
// screen (the DSH-3 defect, already settled once on /ayuda).
// ---------------------------------------------------------------------------

describe("ForgotPasswordPage — the way back", () => {
  it("sends the exit to the login form, not out to the public site", () => {
    render(<ForgotPasswordPage />);

    const back = screen.getByRole("link", { name: /volver a iniciar sesión/i });
    expect(back).toHaveAttribute("href", "/login");
  });

  it("offers exactly one back control, not one per panel", () => {
    render(<ForgotPasswordPage />);

    expect(screen.getAllByRole("link", { name: /^volver/i })).toHaveLength(1);
    expect(screen.queryByRole("link", { name: /volver al inicio/i })).not.toBeInTheDocument();
  });
});
