/**
 * Component tests for ResetPasswordPage.
 *
 * Covers:
 *   - the screen now inheriting `AuthShell` — this was the ONE auth screen
 *     that drew its own composition, which is why it broke the layout
 *     (`docs/ux/prototipos/04-restablecer-contrasenia.html`). `AuthShell` is
 *     rendered for real here (not mocked) precisely so that regression is
 *     caught by a test rather than by eye.
 *   - the live password checklist: rules visible BEFORE anything is typed,
 *     ticking over as the user types, and gating submit — not an error that
 *     only appears after a failed submit.
 *   - the server-error path, routed through `useToast().showError(...)`
 *     instead of an inline `.alert-error` box (issue #51).
 *   - the success toast fired ALONGSIDE the persistent success card.
 *   - the invalid/expired link having its own way out.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import ResetPasswordPage from "@/app/reset-password/page";
import { buildPasswordRules } from "@/app/reset-password/reset-password-utils";
// The mocked ApiClientError — see the vi.mock factory below.
import { ApiClientError as MockApiClientError } from "@/services/api";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let mockToken: string | null = "valid-token";
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: (key: string) => (key === "token" ? mockToken : null),
  }),
}));

vi.mock("next/image", () => ({
  __esModule: true,
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ alt }: { alt: string }) => <img alt={alt} />,
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

const mockRestablecerContrasenia = vi.fn();
vi.mock("@/services/api", () => {
  // vi.mock is hoisted, so the class has to be defined inside the factory;
  // it is re-imported below to build instances of the exact same class the
  // mocked module exports. Every failure route in the real client throws
  // ApiClientError(message, status) — an error with a message and no status
  // is a shape it cannot produce.
  class MockApiClientError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = "ApiClientError";
      this.status = status;
    }
  }
  return {
    restablecerContrasenia: (token: string, nuevaContrasenia: string) =>
      mockRestablecerContrasenia(token, nuevaContrasenia),
    ApiClientError: MockApiClientError,
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fillMatchingPasswords(password = "password123"): void {
  fireEvent.change(screen.getByLabelText("Nueva contraseña"), {
    target: { value: password },
  });
  fireEvent.change(screen.getByLabelText("Repetir contraseña"), {
    target: { value: password },
  });
}

function submitResetForm(): void {
  fireEvent.click(screen.getByRole("button", { name: "Guardar contraseña" }));
}

function ruleItem(label: string): HTMLElement {
  const list = screen.getByRole("status", { name: "Requisitos de la contraseña" });
  return within(list).getByText(label).closest("li") as HTMLElement;
}

describe("buildPasswordRules", () => {
  it("reports both rules unmet for an empty form", () => {
    expect(buildPasswordRules("", "")).toEqual([
      { label: "Al menos 8 caracteres", met: false },
      { label: "Las dos contraseñas coinciden", met: false },
    ]);
  });

  it("does not call two empty strings a match", () => {
    // Otherwise the checklist would show "coinciden" satisfied before the
    // user typed anything, and submit would look one rule away from enabled.
    expect(buildPasswordRules("", "")[1].met).toBe(false);
  });

  it("marks the length rule at exactly the backend minimum of 8", () => {
    expect(buildPasswordRules("1234567", "1234567")[0].met).toBe(false);
    expect(buildPasswordRules("12345678", "12345678")[0].met).toBe(true);
  });

  it("marks the match rule only when both fields are identical", () => {
    expect(buildPasswordRules("password123", "password456")[1].met).toBe(false);
    expect(buildPasswordRules("password123", "password123")[1].met).toBe(true);
  });

  it("does not invent an uppercase/number policy the backend does not enforce", () => {
    // `nueva_contrasenia: str = Field(..., min_length=8)` is the whole
    // server-side contract — a stricter client would reject valid passwords.
    const rules = buildPasswordRules("alllowercase", "alllowercase");
    expect(rules).toHaveLength(2);
    expect(rules.every((rule) => rule.met)).toBe(true);
  });
});

describe("ResetPasswordPage", () => {
  beforeEach(() => {
    mockToken = "valid-token";
    mockShowError.mockReset();
    mockShowSuccess.mockReset();
    mockRestablecerContrasenia.mockReset();
  });

  it("renders the form when a token is present", () => {
    render(<ResetPasswordPage />);

    expect(screen.getByLabelText("Nueva contraseña")).toBeInTheDocument();
    expect(screen.queryByText(/enlace no válido/i)).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // The template. `/reset-password` was the only one of the four auth screens
  // that did not use AuthShell, which is exactly why it broke the layout.
  // -------------------------------------------------------------------------

  it("inherits the shared AuthShell template instead of drawing its own layout", () => {
    render(<ResetPasswordPage />);

    // The coal panel's motto and its "volver al sitio" exit come from the
    // template — if the screen stopped inheriting it, these disappear.
    expect(screen.getByText(/Formando/)).toBeInTheDocument();
    expect(screen.getByText("campeones")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /volver al sitio/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByAltText("Cata Club").length).toBeGreaterThan(0);
  });

  it("puts the expired-link escape hatch in the note below the card", () => {
    render(<ResetPasswordPage />);

    expect(screen.getByText(/¿El enlace ya venció\?/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pedir uno nuevo" })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
  });

  // -------------------------------------------------------------------------
  // Live rules, shown before typing — not an error after submit.
  // -------------------------------------------------------------------------

  describe("live password checklist", () => {
    it("shows both rules unmet before anything is typed, with submit disabled", () => {
      render(<ResetPasswordPage />);

      expect(ruleItem("Al menos 8 caracteres")).toHaveAttribute("data-met", "false");
      expect(ruleItem("Las dos contraseñas coinciden")).toHaveAttribute("data-met", "false");
      expect(screen.getByRole("button", { name: "Guardar contraseña" })).toBeDisabled();
      expect(mockShowError).not.toHaveBeenCalled();
    });

    it("ticks the length rule over as soon as it is satisfied", () => {
      render(<ResetPasswordPage />);

      fireEvent.change(screen.getByLabelText("Nueva contraseña"), {
        target: { value: "short" },
      });
      expect(ruleItem("Al menos 8 caracteres")).toHaveAttribute("data-met", "false");

      fireEvent.change(screen.getByLabelText("Nueva contraseña"), {
        target: { value: "password123" },
      });
      expect(ruleItem("Al menos 8 caracteres")).toHaveAttribute("data-met", "true");
      expect(mockShowError).not.toHaveBeenCalled();
    });

    it("flags a mismatch inline on the second field and keeps submit disabled", () => {
      render(<ResetPasswordPage />);

      fireEvent.change(screen.getByLabelText("Nueva contraseña"), {
        target: { value: "password123" },
      });
      fireEvent.change(screen.getByLabelText("Repetir contraseña"), {
        target: { value: "password456" },
      });

      const error = screen.getByRole("alert");
      expect(error).toHaveTextContent("No coincide con la anterior.");
      expect(screen.getByLabelText("Repetir contraseña")).toHaveAttribute("aria-invalid", "true");
      expect(ruleItem("Las dos contraseñas coinciden")).toHaveAttribute("data-met", "false");
      expect(screen.getByRole("button", { name: "Guardar contraseña" })).toBeDisabled();
      expect(mockShowError).not.toHaveBeenCalled();
    });

    it("enables submit only once every rule is met", () => {
      render(<ResetPasswordPage />);

      expect(screen.getByRole("button", { name: "Guardar contraseña" })).toBeDisabled();
      fillMatchingPasswords();
      expect(screen.getByRole("button", { name: "Guardar contraseña" })).toBeEnabled();
    });
  });

  describe("successful reset", () => {
    it("shows the success toast AND keeps the persistent success card", async () => {
      mockRestablecerContrasenia.mockResolvedValue(undefined);

      render(<ResetPasswordPage />);
      fillMatchingPasswords();
      submitResetForm();

      await waitFor(() => {
        expect(mockShowSuccess).toHaveBeenCalledWith("Contraseña actualizada correctamente");
      });
      expect(await screen.findByText(/contraseña actualizada/i)).toBeInTheDocument();
      expect(mockShowError).not.toHaveBeenCalled();
    });
  });

  describe("failed submission", () => {
    it("shows the server error via toast.showError instead of an inline alert", async () => {
      // An expired or already-used reset token is refused by
      // POST /auth/restablecer-contrasenia as a 400 — the status that means
      // "about what you sent". The frontend cannot know the token expired,
      // so the backend's sentence is the only thing that tells the user to
      // ask for a new link, and it survives both gates to reach the toast.
      mockRestablecerContrasenia.mockRejectedValue(
        new MockApiClientError("El token ha expirado.", 400),
      );

      render(<ResetPasswordPage />);
      fillMatchingPasswords();
      submitResetForm();

      await waitFor(() => {
        expect(mockShowError).toHaveBeenCalledWith("El token ha expirado.");
      });
      expect(document.querySelector(".alert-error")).not.toBeInTheDocument();
      expect(mockShowSuccess).not.toHaveBeenCalled();
    });

    it("shows a fallback message via toast.showError for a non-Error rejection", async () => {
      mockRestablecerContrasenia.mockRejectedValue("boom");

      render(<ResetPasswordPage />);
      fillMatchingPasswords();
      submitResetForm();

      await waitFor(() => {
        expect(mockShowError).toHaveBeenCalledWith("Ocurrió un error inesperado.");
      });
      expect(document.querySelector(".alert-error")).not.toBeInTheDocument();
    });
  });

  describe("invalid token", () => {
    it("shows the invalid-link state, not a toast, and offers a way to request a new one", () => {
      mockToken = null;

      render(<ResetPasswordPage />);

      expect(screen.getByText(/enlace no válido/i)).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: /solicitar nuevo enlace/i }),
      ).toHaveAttribute("href", "/forgot-password");
      expect(mockShowError).not.toHaveBeenCalled();
    });

    it("still wears the shared template on the dead-link state", () => {
      mockToken = null;

      render(<ResetPasswordPage />);

      expect(screen.getByText("campeones")).toBeInTheDocument();
    });
  });
});
