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
  useSearchParams: () => useTestSearchParams(),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: vi.fn(),
}));

// The shell is stubbed so these tests stay about the FORM. Only the COMPOSITION
// is replaced; every class constant comes through from the real module, because
// the link skin is one of them now and "the links look like links" below reads
// it. Stubbing those to "" would make that case pass against nothing. See
// ResetPasswordPage.test.tsx for coverage of the real shell.
vi.mock("@/components/auth/AuthShell", async () => ({
  ...(await vi.importActual<typeof import("@/components/auth/AuthShell")>(
    "@/components/auth/AuthShell",
  )),
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
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
import { resetTestHistory, useTestSearchParams } from "@/lib/__tests__/next-navigation-double";

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
    resetTestHistory("/login");
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
   * Issue #353: the bounce `ProtectedRoute` fires after a failed
   * refresh-and-retry used to land here with nothing to explain it — the
   * admin had no way to tell a real logout from a session that quietly died
   * mid-form. `ProtectedRoute` now names the reason in the redirect itself
   * (`/login?motivo=sesion-expirada`); this is the other half, reading it.
   */
  it("names the reason when it arrives via a session-expired bounce (?motivo=sesion-expirada)", () => {
    mockUseAuth.mockReturnValue(createUnauthenticatedAuth(false));
    resetTestHistory("/login?motivo=sesion-expirada");

    render(<LoginPage />);

    expect(screen.getByText("Su sesión expiró. Vuelva a iniciar sesión.")).toBeInTheDocument();
  });

  it("says nothing extra on an ordinary visit to /login — there is nothing to explain", () => {
    mockUseAuth.mockReturnValue(createUnauthenticatedAuth(false));

    render(<LoginPage />);

    expect(screen.queryByText("Su sesión expiró. Vuelva a iniciar sesión.")).not.toBeInTheDocument();
  });

  /**
   * WCAG 2.2 SC 2.5.8 (Target Size, Minimum) — 24x24 CSS px. Measured at
   * 390x844 the login screen carried the two smallest targets in the product:
   * the password toggle at 16x16 (a bare 16px icon in an unpadded button) and
   * the recovery link at 141.5x18.8 (a bare 12.5px line of type).
   *
   * The fix is hit area only — the icon still rides its step and the type is still
   * 12.5px/600. "Inscríbase" is deliberately left alone: it sits inside the
   * sentence "¿No tiene una cuenta? Inscríbase" and is covered by the
   * criterion's own Inline exception.
   */
  describe("targets big enough to hit — SC 2.5.8", () => {
    it("gives the password toggle a 24x24 target around its icon", () => {
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
      expect(recovery.className).toContain("text-xs");
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
          // #312 / hallazgo #30: este es el único aviso de la pantalla que
          // dice POR QUÉ falló el login, así que se queda arriba el piso
          // más largo (20s) en vez del tope ordinario de 4.5-10s.
          duration: 20000,
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

/**
 * The failure that left the form looking untouched.
 *
 * A wrong password produced a toast and nothing else: the two fields stayed
 * exactly as they were, so a few seconds later — once the toast had gone —
 * the screen was indistinguishable from one that had never been submitted.
 * The person is left holding a form that looks fine and a memory of a message.
 *
 * The toast is NOT being replaced, and the two tests above still hold it as
 * the channel that ANNOUNCES the failure: it is the thing that moves, and it
 * carries the recovery sentence. What is added is the part that has to still
 * be true after it fades — `DESIGN.md`'s field-error contract: *"Error: borde
 * en el rojo de estado, con el mensaje debajo diciendo qué pasó y cómo
 * arreglarlo."* No `.alert-error` box comes back with it; that was a
 * full-width banner, and this is the field reacting.
 */
describe("LoginPage — the failed credentials leave a mark on the form", () => {
  it("marks both fields and keeps a message under them after the toast is gone", async () => {
    const mockLogin = vi.fn().mockResolvedValue({ ok: false, error: "invalid_credentials" });
    mockUseAuth.mockReturnValue({ ...createUnauthenticatedAuth(false), login: mockLogin });

    render(<LoginPage />);
    submitLoginForm();

    const email = screen.getByLabelText("Correo electrónico");
    const password = screen.getByLabelText("Contraseña");
    await waitFor(() => expect(email).toHaveAttribute("aria-invalid", "true"));
    expect(password).toHaveAttribute("aria-invalid", "true");

    // One message for the pair, under the second field: the failure is about
    // the COMBINATION, and the backend deliberately never says which half was
    // wrong (naming it would confirm which accounts exist).
    const message = screen.getByTestId("credentials-error");
    expect(message).toHaveTextContent(/no coinciden/i);
    expect(password.getAttribute("aria-describedby")).toContain(message.id);

    // The banner the #51 decision retired stays retired.
    expect(document.querySelector(".alert-error")).not.toBeInTheDocument();
  });

  it("blames nobody's typing when the server is the one that failed", async () => {
    // `backend_unavailable` is not a wrong password. Painting the fields red
    // would tell the person to re-check something that was never the problem.
    const mockLogin = vi.fn().mockResolvedValue({ ok: false, error: "backend_unavailable" });
    mockUseAuth.mockReturnValue({ ...createUnauthenticatedAuth(false), login: mockLogin });

    render(<LoginPage />);
    submitLoginForm();

    await waitFor(() => expect(mockShowError).toHaveBeenCalled());
    expect(screen.getByLabelText("Correo electrónico")).toHaveAttribute("aria-invalid", "false");
    expect(screen.queryByTestId("credentials-error")).not.toBeInTheDocument();
  });

  it("clears the mark as soon as the person starts fixing it", async () => {
    const mockLogin = vi.fn().mockResolvedValue({ ok: false, error: "invalid_credentials" });
    mockUseAuth.mockReturnValue({ ...createUnauthenticatedAuth(false), login: mockLogin });

    render(<LoginPage />);
    submitLoginForm();
    await screen.findByTestId("credentials-error");

    fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "otra-clave" } });

    // An error that outlives the thing it describes trains people to ignore it.
    expect(screen.queryByTestId("credentials-error")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Contraseña")).toHaveAttribute("aria-invalid", "false");
  });

  // #312 / hallazgo #30: tras el 401 el foco quedaba en <body> — el aviso
  // aparecía donde el usuario ya no estaba mirando, y encima se autodescartaba.
  it("returns focus to the password field, so the inline message is where the eye already is", async () => {
    const mockLogin = vi.fn().mockResolvedValue({ ok: false, error: "invalid_credentials" });
    mockUseAuth.mockReturnValue({ ...createUnauthenticatedAuth(false), login: mockLogin });

    render(<LoginPage />);
    submitLoginForm();

    const password = screen.getByLabelText("Contraseña");
    await waitFor(() => expect(password).toHaveAttribute("aria-invalid", "true"));
    expect(document.activeElement).toBe(password);
  });

  it("prints the pair-mismatch message at the body-copy size, not the 12.5px format-hint size", async () => {
    const mockLogin = vi.fn().mockResolvedValue({ ok: false, error: "invalid_credentials" });
    mockUseAuth.mockReturnValue({ ...createUnauthenticatedAuth(false), login: mockLogin });

    render(<LoginPage />);
    submitLoginForm();

    const message = await screen.findByTestId("credentials-error");
    expect(message.className).toContain("text-base");
    expect(message.className).not.toContain("text-xs");
  });

  it("states a field error in the state red, not in the action red", () => {
    // `cata-red` is the fill of the button 40px below, and as TEXT it measures
    // 4.10:1 on paper — under AA. `state-bad` is the ramp's error ink, defined
    // to be read on this surface, and it stops an error line from looking like
    // one more thing to press.
    mockUseAuth.mockReturnValue(createUnauthenticatedAuth());

    render(<LoginPage />);
    fireEvent.submit(
      screen.getByRole("button", { name: /iniciar sesión/i }).closest("form") as HTMLFormElement,
    );

    const alert = screen.getByText("Ingrese su correo electrónico.");
    expect(alert.className).toContain("text-state-bad");
    expect(alert.className).not.toContain("text-cata-red");
  });
});

/**
 * *"Lo que navega no es un botón: es un enlace subrayado en rojo, con flecha
 * cuando apunta a otra pantalla."*
 *
 * Both links on this card were red, bold and bare — the same weight as an
 * error line and the same colour as the submit button, with nothing to say
 * they were links at all. Underlining them is what separates the two things
 * that share the colour: one is pressed, the others are followed.
 *
 * `red-dark` rather than `red`: red-on-paper measures 4.10:1 and fails AA at
 * this size, which is the reason `DESIGN.md` writes *"Como texto se usa su
 * versión oscura"*.
 */
describe("LoginPage — the links look like links", () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue(createUnauthenticatedAuth());
    render(<LoginPage />);
  });

  it("underlines both, in the readable shade of the brand red", () => {
    for (const name of [/olvidó su contraseña/i, /inscríbase/i]) {
      const link = screen.getByRole("link", { name });
      expect(link.className).toContain("underline");
      expect(link.className).toContain("text-cata-red-dark");
    }
  });

  it("gives each one the arrow that says it leads off this screen", () => {
    // Both go somewhere else — /forgot-password and /student/enroll — which is
    // exactly the case the rule reserves the arrow for.
    for (const name of [/olvidó su contraseña/i, /inscríbase/i]) {
      const link = screen.getByRole("link", { name });
      expect(link.querySelector("svg[aria-hidden='true']")).not.toBeNull();
    }
  });
});
