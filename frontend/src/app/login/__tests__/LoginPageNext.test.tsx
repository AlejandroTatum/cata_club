/**
 * REG-21: `/login?next=` returns the person to where they were, INTERNAL paths
 * only. Anything else (absolute URL, `//host`, backslashes, encoded tricks)
 * must be ignored and the person lands on the role's home — an open redirect
 * here would turn a real login into a phishing hop.
 *
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import LoginPage from "@/app/login/page";
import { useAuth } from "@/contexts/AuthContext";
import {
  createAuthenticatedAuth,
  createMockSession,
  createUnauthenticatedAuth,
} from "@/components/__tests__/test-utils";
import { resetTestHistory, useTestSearchParams } from "@/lib/__tests__/next-navigation-double";

const mockReplace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => useTestSearchParams(),
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: vi.fn() }));

const mockShowSuccess = vi.fn();
vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({
    showToast: vi.fn(),
    showError: vi.fn(),
    showSuccess: mockShowSuccess,
    showInfo: vi.fn(),
  }),
}));

const mockUseAuth = vi.mocked(useAuth);

/** `?next=` as a browser would carry it: the value is percent-encoded once. */
function loginUrlWith(rawNext: string): string {
  return `/login?next=${encodeURIComponent(rawNext)}`;
}

async function signInThroughTheForm(session = createMockSession()): Promise<void> {
  mockUseAuth.mockReturnValue({
    ...createUnauthenticatedAuth(false),
    login: vi.fn().mockResolvedValue({ ok: true, session }),
  });
  render(<LoginPage />);
  fireEvent.change(screen.getByLabelText(/^Correo electrónico/), { target: { value: "user@cataclub.com" } });
  fireEvent.change(screen.getByLabelText(/^Contraseña/), { target: { value: "secret123" } });
  fireEvent.click(screen.getByRole("button", { name: /iniciar sesión/i }));
  await vi.advanceTimersByTimeAsync(2000);
}

describe("LoginPage ?next=", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockReplace.mockReset();
    mockShowSuccess.mockReset();
    mockUseAuth.mockReset();
    resetTestHistory("/login");
  });

  it("returns the person to the internal page they were heading to", async () => {
    resetTestHistory(loginUrlWith("/student/payments?month=3"));

    await signInThroughTheForm();

    expect(mockReplace).toHaveBeenCalledWith("/student/payments?month=3");
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockShowSuccess).toHaveBeenCalledWith(expect.any(String), {
      description: "Tu sesión quedó iniciada. Te llevamos a la página que buscabas.",
    });
  });

  it("falls back to the role's home when there is no ?next=", async () => {
    await signInThroughTheForm();

    expect(mockReplace).toHaveBeenCalledWith("/dashboard");
    expect(mockShowSuccess).toHaveBeenCalledWith(expect.any(String), {
      description: "Tu sesión quedó iniciada. Te llevamos a tu panel.",
    });
  });

  it("also honours ?next= for a visitor who is already signed in", () => {
    resetTestHistory(loginUrlWith("/student/payments"));
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("estudiante"));

    render(<LoginPage />);

    expect(mockReplace).toHaveBeenCalledWith("/student/payments");
  });

  it("keeps the activation gate ahead of ?next= — an account that has not activated can use nothing else", async () => {
    resetTestHistory(loginUrlWith("/student/payments"));
    const session = {
      ...createMockSession({ roles: ["ALUMNO"] }),
      correoVerificado: true,
      altaPresencialCompletada: true,
      activacionCompleta: false,
    };

    await signInThroughTheForm(session);

    expect(mockReplace).toHaveBeenCalledWith("/login/activacion");
  });

  describe("open-redirect attempts are ignored", () => {
    it.each([
      ["absolute https URL", "https://evil.example/phish"],
      ["absolute http URL", "http://evil.example"],
      ["protocol-relative", "//evil.example"],
      ["protocol-relative with path", "//evil.example/student/payments"],
      ["backslash host", "/\\evil.example"],
      ["double backslash", "\\\\evil.example"],
      ["javascript scheme", "javascript:alert(1)"],
      ["encoded second slash", "/%2Fevil.example"],
      ["encoded backslash", "/%5Cevil.example"],
      ["double-encoded slash", "/%252Fevil.example"],
      ["tab between slashes", "/\t/evil.example"],
      ["the login page itself", "/login"],
    ])("%s → the role's home", async (_label, rawNext) => {
      resetTestHistory(loginUrlWith(rawNext));

      await signInThroughTheForm();

      expect(mockReplace).toHaveBeenCalledTimes(1);
      expect(mockReplace).toHaveBeenCalledWith("/dashboard");
    });

    it("a hostile ?next= for an already signed-in visitor also lands on the role's home", () => {
      resetTestHistory(loginUrlWith("//evil.example"));
      mockUseAuth.mockReturnValue(createAuthenticatedAuth("admin"));

      render(<LoginPage />);

      expect(mockReplace).toHaveBeenCalledWith("/dashboard");
    });

    it("a ?next= that was never encoded (raw // in the query) is ignored too", async () => {
      resetTestHistory("/login?next=//evil.example");

      await signInThroughTheForm();

      expect(mockReplace).toHaveBeenCalledWith("/dashboard");
    });
  });
});
