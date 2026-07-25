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
        expect(mockShowError).toHaveBeenCalledWith(
          "Credenciales inválidas. Verifique su correo y contraseña.",
        );
      });
      expect(document.querySelector(".alert-error")).not.toBeInTheDocument();
    });
  });

  describe("successful submission", () => {
    it("shows a centered welcome overlay instead of a toast, then redirects to the role's default route", async () => {
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

      const overlay = screen.getByRole("status");
      expect(overlay).toHaveTextContent("Inicio de sesión exitoso");
      expect(overlay).toHaveTextContent(session.user.name);
      expect(mockShowSuccess).not.toHaveBeenCalled();
      expect(mockReplace).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(2000);

      expect(mockReplace).toHaveBeenCalledWith("/dashboard");
      vi.useRealTimers();
    });
  });
});
