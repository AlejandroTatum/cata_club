/**
 * Component tests for LoginPage.
 *
 * Covers the redirect-in-progress state for an already-authenticated user:
 * the form must never paint (not even for one frame) while the redirect
 * effect is pending — see issue #31. Also covers failed-submit error
 * reporting, which is routed through `useToast().showError(...)` instead of
 * an inline `.alert-error` box — see issue #51.
 *
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import LoginPage from "@/app/login/page";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockReplace = vi.fn();
const mockRouter = { replace: mockReplace };

vi.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: vi.fn(),
}));

// The shell is stubbed so these tests stay about the FORM. Its two class
// constants are re-exported as-is, since the page applies them to its inputs
// and labels; see ResetPasswordPage.test.tsx for coverage of the real shell.
vi.mock("@/components/auth/AuthShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  AUTH_INPUT_CLASSES: "",
  AUTH_LABEL_CLASSES: "",
}));

const mockShowError = vi.fn();
const mockShowSuccess = vi.fn();
vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({
    showToast: vi.fn(),
    showError: mockShowError,
    showSuccess: mockShowSuccess,
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { useAuth } from "@/contexts/AuthContext";
import {
  createUnauthenticatedAuth,
  createAuthenticatedAuth,
  createLoadingAuth,
  createMockSession,
} from "@/components/__tests__/test-utils";

const mockUseAuth = vi.mocked(useAuth);

/** Fill and submit the login form with the given credentials. */
function submitLoginForm(email = "user@cataclub.com", password = "secret123"): void {
  fireEvent.change(screen.getByLabelText("Correo electrónico"), {
    target: { value: email },
  });
  fireEvent.change(screen.getByLabelText("Contraseña"), {
    target: { value: password },
  });
  fireEvent.click(screen.getByRole("button", { name: /iniciar sesión/i }));
}

describe("LoginPage", () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockUseAuth.mockReset();
    mockShowError.mockReset();
    mockShowSuccess.mockReset();
  });

  it("shows the loading state, never the form, while session is hydrating", () => {
    mockUseAuth.mockReturnValue(createLoadingAuth());

    render(<LoginPage />);

    expect(screen.getByText("Cargando sesión…")).toBeInTheDocument();
    expect(screen.queryByLabelText("Correo electrónico")).not.toBeInTheDocument();
  });

  it("shows the loading state, not the form, once hydration resolves to an authenticated session (redirect in flight)", () => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("admin"));

    render(<LoginPage />);

    expect(screen.getByText("Cargando sesión…")).toBeInTheDocument();
    expect(screen.queryByLabelText("Correo electrónico")).not.toBeInTheDocument();
    expect(mockReplace).toHaveBeenCalledWith("/dashboard");
  });

  it("renders the login form once hydration confirms there is no session", () => {
    mockUseAuth.mockReturnValue(createUnauthenticatedAuth(false));

    render(<LoginPage />);

    expect(screen.getByLabelText("Correo electrónico")).toBeInTheDocument();
    expect(screen.queryByText("Cargando sesión…")).not.toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  /**
   * WCAG 2.2 SC 2.5.8 (Target Size, Minimum) — 24x24 CSS px. Measured at
   * 390x844 the login screen carried the two smallest targets in the product:
   * the password toggle at 16x16 (a bare 16px icon in an unpadded button) and
   * the recovery link at 141.5x18.8 (a bare 12.5px line of type).
   *
   * The fix is hit area only — the icon is still 16px and the type is still
   * 12.5px/600. "Inscríbase" is deliberately left alone: it sits inside the
   * sentence "¿No tiene una cuenta? Inscríbase" and is covered by the
   * criterion's own Inline exception.
   */
  describe("targets big enough to hit — SC 2.5.8", () => {
    it("gives the password toggle a 24x24 target around its 16px icon", () => {
      mockUseAuth.mockReturnValue(createUnauthenticatedAuth(false));

      render(<LoginPage />);

      const toggle = screen.getByRole("button", { name: "Mostrar contraseña" });
      expect(toggle).toHaveClass("h-6", "w-6");
      // Centred, so the icon stays exactly where it was inside the field.
      expect(toggle).toHaveClass("flex", "items-center", "justify-center");
    });

    it("gives the recovery link a 24px-tall target without resizing its type", () => {
      mockUseAuth.mockReturnValue(createUnauthenticatedAuth(false));

      render(<LoginPage />);

      const recovery = screen.getByRole("link", { name: /olvidó su contraseña/i });
      expect(recovery.className).toContain("min-h-[24px]");
      expect(recovery.className).toContain("text-[12.5px]");
    });

    it("leaves the inline enrolment link alone — SC 2.5.8 exempts it", () => {
      mockUseAuth.mockReturnValue(createUnauthenticatedAuth(false));

      render(<LoginPage />);

      const enrol = screen.getByRole("link", { name: /inscríbase/i });
      expect(enrol.className).not.toContain("min-h-[24px]");
    });
  });

  it("does not add contextual help to the unrelated login journey", () => {
    mockUseAuth.mockReturnValue(createUnauthenticatedAuth(false));

    render(<LoginPage />);

    expect(screen.queryByRole("button", { name: /ayuda sobre/i })).not.toBeInTheDocument();
  });

  it("trims credentials before submitting them", () => {
    const auth = createUnauthenticatedAuth();
    const mockLogin = vi.mocked(auth.login);
    mockLogin.mockResolvedValue({ ok: false, error: "invalid_credentials" });
    mockUseAuth.mockReturnValue(auth);

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText(/correo electrónico/i), { target: { value: "  user@example.com  " } });
    fireEvent.change(screen.getByLabelText(/^contraseña$/i), { target: { value: "  safe-password  " } });
    fireEvent.submit(screen.getByRole("button", { name: /iniciar sesión/i }).closest("form") as HTMLFormElement);

    expect(mockLogin).toHaveBeenCalledWith("user@example.com", "safe-password");
  });

  it("blocks a whitespace-only email without sending an authentication request", () => {
    const auth = createUnauthenticatedAuth();
    const mockLogin = vi.mocked(auth.login);
    mockUseAuth.mockReturnValue(auth);

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText(/correo electrónico/i), { target: { value: "   " } });
    fireEvent.change(screen.getByLabelText(/^contraseña$/i), { target: { value: "safe-password" } });
    fireEvent.submit(screen.getByRole("button", { name: /iniciar sesión/i }).closest("form") as HTMLFormElement);

    expect(screen.getByRole("alert")).toHaveTextContent("Ingrese su correo electrónico.");
    expect(screen.getByLabelText(/correo electrónico/i)).toHaveAttribute("aria-invalid", "true");
    expect(mockLogin).not.toHaveBeenCalled();
  });

  describe("failed submission", () => {
    it("shows the mapped error via toast.showError instead of an inline alert", async () => {
      const mockLogin = vi.fn().mockResolvedValue({ ok: false, error: "invalid_credentials" });
      mockUseAuth.mockReturnValue({
        ...createUnauthenticatedAuth(false),
        login: mockLogin,
      });

      render(<LoginPage />);
      submitLoginForm();

      await waitFor(() => {
        expect(mockShowError).toHaveBeenCalledWith("Credenciales incorrectas", {
          description: "Revise su correo y su contraseña, e intente nuevamente.",
        });
      });
      expect(document.querySelector(".alert-error")).not.toBeInTheDocument();
    });

    it("names the problem in the message and the recovery in the supporting line", async () => {
      const mockLogin = vi.fn().mockResolvedValue({ ok: false, error: "backend_unavailable" });
      mockUseAuth.mockReturnValue({
        ...createUnauthenticatedAuth(false),
        login: mockLogin,
      });

      render(<LoginPage />);
      submitLoginForm();

      await waitFor(() => {
        expect(mockShowError).toHaveBeenCalledWith("No se pudo conectar con el servidor", {
          description: "El servicio no está disponible. Intente nuevamente en unos minutos.",
        });
      });
    });
  });

  describe("successful submission", () => {
    /**
     * The full-screen confirmation panel this replaces was rejected as *"muy
     * tosco, como que te impone el mensaje"* — modal weight for an event the
     * user just caused. The confirmation is now a toast with two tiers: the
     * greeting names who signed in, the supporting line says what happens
     * next, which the old panel never did.
     */
    it("confirms with a two-line success toast, not a full-screen panel", async () => {
      vi.useFakeTimers();
      const session = createMockSession();
      const mockLogin = vi.fn().mockResolvedValue({ ok: true, session });
      mockUseAuth.mockReturnValue({
        ...createUnauthenticatedAuth(false),
        login: mockLogin,
      });

      render(<LoginPage />);
      submitLoginForm();
      await vi.advanceTimersByTimeAsync(0);

      const firstName = session.user.name.trim().split(/\s+/)[0];
      expect(mockShowSuccess).toHaveBeenCalledWith(`Hola, ${firstName}`, {
        description: "Su sesión quedó iniciada. Le llevamos a su panel.",
      });
      // Nothing paints over the page any more.
      expect(screen.queryByText(/inicio de sesión exitoso/i)).not.toBeInTheDocument();

      vi.useRealTimers();
    });

    it("holds the form for one beat so the toast is seen, then redirects to the role's default route", async () => {
      vi.useFakeTimers();
      const mockLogin = vi.fn().mockResolvedValue({ ok: true, session: createMockSession() });
      mockUseAuth.mockReturnValue({
        ...createUnauthenticatedAuth(false),
        login: mockLogin,
      });

      render(<LoginPage />);
      submitLoginForm();
      await vi.advanceTimersByTimeAsync(0);

      expect(mockReplace).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(2000);

      expect(mockReplace).toHaveBeenCalledWith("/dashboard");
      vi.useRealTimers();
    });
  });
});
