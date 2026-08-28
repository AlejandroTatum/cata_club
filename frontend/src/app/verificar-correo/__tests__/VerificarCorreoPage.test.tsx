/**
 * Component tests for VerificarCorreoPage (issue #790).
 *
 * Covers the three states the screen can be in and, above all, the two things
 * it must not do:
 *   - verify twice for one arrival (React StrictMode mounts effects twice),
 *   - reinterpret the resend response. The backend answers the same way for a
 *     registered and an unknown address on purpose, so the screen shows that
 *     message verbatim; inventing a "we sent it" confirmation here would put
 *     the enumeration oracle back on the client side.
 *
 * `AuthShell` renders for real (not mocked) so a composition regression is
 * caught by a test, same reasoning as `ResetPasswordPage.test.tsx`.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import VerificarCorreoPage from "@/app/verificar-correo/page";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let mockToken: string | null = "token-valido";
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
vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({
    showToast: vi.fn(),
    showError: mockShowError,
    showSuccess: vi.fn(),
  }),
}));

const mockVerificarCorreo = vi.fn();
const mockReenviarVerificacionCorreo = vi.fn();
vi.mock("@/services/api", () => ({
  verificarCorreo: (...args: unknown[]) => mockVerificarCorreo(...args),
  reenviarVerificacionCorreo: (...args: unknown[]) => mockReenviarVerificacionCorreo(...args),
}));

const MENSAJE_CONSTANTE =
  "Si el correo está registrado y falta verificarlo, se envió un enlace de verificación";

beforeEach(() => {
  vi.clearAllMocks();
  mockToken = "token-valido";
  mockVerificarCorreo.mockResolvedValue(undefined);
  mockReenviarVerificacionCorreo.mockResolvedValue({ mensaje: MENSAJE_CONSTANTE });
});

describe("VerificarCorreoPage", () => {
  it("verifies on arrival and confirms, without asking for a second click", async () => {
    render(<VerificarCorreoPage />);

    expect(await screen.findByText("Correo verificado")).toBeInTheDocument();
    expect(mockVerificarCorreo).toHaveBeenCalledWith("token-valido");
  });

  it("says what the verified account can now do", async () => {
    // The screen exists to close a loop the visitor opened somewhere else; a
    // bare "done" would not tell them the loop is closed.
    render(<VerificarCorreoPage />);

    expect(
      await screen.findByText(/agregar a su cuenta a un\s+representado/i),
    ).toBeInTheDocument();
  });

  it("verifies once per arrival even if the effect runs twice", async () => {
    const { rerender } = render(<VerificarCorreoPage />);
    rerender(<VerificarCorreoPage />);

    await screen.findByText("Correo verificado");
    expect(mockVerificarCorreo).toHaveBeenCalledTimes(1);
  });

  it("offers the resend form when the URL carries no token, without calling the API", async () => {
    mockToken = null;

    render(<VerificarCorreoPage />);

    expect(await screen.findByText("Enlace no válido")).toBeInTheDocument();
    expect(screen.getByLabelText(/Correo electrónico/i)).toBeInTheDocument();
    expect(mockVerificarCorreo).not.toHaveBeenCalled();
  });

  it("offers the resend form when the link is dead", async () => {
    mockVerificarCorreo.mockRejectedValueOnce(new Error("inválido o expiró"));

    render(<VerificarCorreoPage />);

    expect(await screen.findByText("Enlace no válido")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Enviar un enlace nuevo/i })).toBeInTheDocument();
  });

  it("shows the backend's constant message verbatim after a resend", async () => {
    mockToken = null;
    render(<VerificarCorreoPage />);

    fireEvent.change(await screen.findByLabelText(/Correo electrónico/i), {
      target: { value: "quien@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Enviar un enlace nuevo/i }));

    expect(await screen.findByText(MENSAJE_CONSTANTE)).toBeInTheDocument();
    expect(mockReenviarVerificacionCorreo).toHaveBeenCalledWith("quien@example.com");
  });

  it("reports a resend failure through the toast instead of claiming success", async () => {
    mockToken = null;
    mockReenviarVerificacionCorreo.mockRejectedValueOnce(new Error("caído"));
    render(<VerificarCorreoPage />);

    fireEvent.change(await screen.findByLabelText(/Correo electrónico/i), {
      target: { value: "quien@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Enviar un enlace nuevo/i }));

    await waitFor(() => expect(mockShowError).toHaveBeenCalled());
    expect(screen.queryByText(MENSAJE_CONSTANTE)).not.toBeInTheDocument();
  });

  it("states the link lifetime once, below the card", async () => {
    mockToken = null;
    render(<VerificarCorreoPage />);

    expect(
      await screen.findByText("Los enlaces de verificación duran 24 horas."),
    ).toBeInTheDocument();
  });
});
