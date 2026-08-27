/**
 * The login screen must never announce a session it does not have.
 *
 * This is the regression lock for the "200 but no cookie" defect. Unlike
 * `LoginPage.test.tsx`, which stubs `useAuth` and is therefore about the form,
 * this file wires the REAL stack — `LoginPage` -> `AuthProvider` ->
 * `services/auth` — and mocks only `fetch`, the actual network boundary. That
 * is deliberate: the optimism being locked out was not in any one of those
 * layers, it was in the seam between "the POST returned 200" and "a session
 * exists", and a test that stubs the seam cannot see it.
 *
 * The failure it reproduces: /api/auth/login answers 200 with a valid session
 * body and sets both auth cookies, but the browser keeps none of them, so the
 * very next same-origin request arrives anonymous. Observed first in WebKit
 * over plain http (it refuses `Secure` cookies on an insecure origin), and
 * identically reachable with cookies blocked for the site, in a private
 * window, under Safari's ITP, behind a proxy that strips Set-Cookie, or with
 * enough clock skew to invalidate them. In every one of those the person was
 * told "Su sesión quedó iniciada. Le llevamos a su panel." and then left on
 * /login with nothing to act on.
 *
 * Toasts are rendered for real (`ToastProvider` + `ToastContainer`) so the
 * assertions are about what is on screen, not about a spy having been called.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AuthSession } from "@/services/auth";

// ---------------------------------------------------------------------------
// Mocks — only the router, the API client's auth-failure bus, and `fetch`.
// `services/auth`, `AuthContext`, `ToastContext` and the page itself are all
// the real modules.
// ---------------------------------------------------------------------------

const mockReplace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/services/api", () => ({
  subscribeAuthFailure: () => () => undefined,
  discardInFlightRefresh: vi.fn(),
  setCurrentMockRole: vi.fn(),
}));

import LoginPage from "@/app/login/page";
import { AuthProvider } from "@/contexts/AuthContext";
import { ToastProvider } from "@/contexts/ToastContext";
import ToastContainer from "@/components/ToastContainer";

const validSession: AuthSession = {
  user: {
    id: "1",
    name: "Admin Cata Club",
    email: "admin@cataclub.com",
    role: "admin",
    representanteId: null,
  },
  roles: ["ADMINISTRADOR"],
  loggedInAt: "2026-08-27T10:00:00.000Z",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/**
 * Stand in for the browser's cookie jar.
 *
 * The jar starts EMPTY — this is someone arriving at /login, so the mount
 * hydration must find nothing, exactly as it does in a real browser.
 *
 * `POST /api/auth/login` always succeeds: the credentials are right in every
 * case here, and the response always carries Set-Cookie. What `cookiesKept`
 * decides is whether the browser honours it. `GET /api/auth/session` then
 * answers from the jar — with the session when the cookies are there, and
 * with the anonymous `{ authenticated: false }` 200 the BFF really returns
 * for a request carrying none (see src/app/api/auth/session/route.ts) when
 * they are not.
 */
function mockNetwork({ cookiesKept }: { cookiesKept: boolean }): void {
  let jarHasCookies = false;
  vi.mocked(global.fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/auth/login" && init?.method === "POST") {
      if (cookiesKept) jarHasCookies = true;
      return jsonResponse(validSession);
    }
    if (url === "/api/auth/session") {
      return jarHasCookies ? jsonResponse(validSession) : jsonResponse({ authenticated: false });
    }
    throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`);
  });
}

function renderLogin(): void {
  render(
    <ToastProvider>
      <AuthProvider>
        <LoginPage />
      </AuthProvider>
      <ToastContainer />
    </ToastProvider>,
  );
}

function submitLoginForm(): void {
  fireEvent.change(screen.getByLabelText(/^Correo electrónico/), {
    target: { value: "admin@cataclub.com" },
  });
  fireEvent.change(screen.getByLabelText(/^Contraseña/), { target: { value: "admin12345" } });
  fireEvent.click(screen.getByRole("button", { name: /iniciar sesión/i }));
}

beforeEach(() => {
  mockReplace.mockReset();
  vi.spyOn(global, "fetch");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LoginPage — the success state is conditional on a confirmed session", () => {
  describe("when the browser does not keep the session cookies", () => {
    beforeEach(async () => {
      mockNetwork({ cookiesKept: false });
      renderLogin();
      await screen.findByRole("button", { name: /iniciar sesión/i });
      submitLoginForm();
    });

    /*
     * THE lock. If this ever goes green while the screen still says the
     * session started, the interface is lying to the person again.
     */
    it("never claims the session started", async () => {
      // Settle on the toast the submit produces — WHICHEVER one it is. Waiting
      // for the honest notice instead would make this fail with "element not
      // found" when the regression returns, pointing at the fix rather than at
      // the lie. A success toast is role="status", an error toast role="alert"
      // (see ToastContainer), so this waits for either and then asserts on the
      // words.
      await waitFor(() => {
        const announcements = [...screen.queryAllByRole("status"), ...screen.queryAllByRole("alert")];
        expect(announcements.length).toBeGreaterThan(0);
      });

      expect(screen.queryByText(/Su sesión quedó iniciada/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Le llevamos a su panel/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Hola, Admin/)).not.toBeInTheDocument();
    });

    it("says the browser did not store the session and how to fix it", async () => {
      const notice = await screen.findByTestId("session-not-persisted-error");

      expect(notice).toHaveTextContent(/este navegador no guardó la sesión/i);
      expect(notice).toHaveTextContent(/cookies/i);
      expect(notice).toHaveTextContent(/intente nuevamente/i);
    });

    // The remedy is in a browser settings panel, so the notice has to still
    // be there when the person comes back from it — a toast would be gone.
    it("keeps that message on the card instead of only in a toast", async () => {
      const notice = await screen.findByTestId("session-not-persisted-error");
      expect(notice).toHaveAttribute("role", "alert");
    });

    // Nothing they typed was wrong. Painting the fields red would send them
    // to re-check a correo and a contraseña the server already accepted.
    it("does not blame the credentials", async () => {
      await screen.findByTestId("session-not-persisted-error");

      expect(screen.queryByTestId("credentials-error")).not.toBeInTheDocument();
      expect(screen.getByLabelText(/^Contraseña/)).toHaveAttribute("aria-invalid", "false");
    });

    // The two 401s in the original bug report came from an app that thought
    // it was logged in. Staying put with an explanation is the honest state.
    it("does not navigate away from the login screen", async () => {
      await screen.findByTestId("session-not-persisted-error");
      expect(mockReplace).not.toHaveBeenCalled();
    });

    // A failed attempt must leave a usable form behind, not a dead button.
    it("re-enables the form so the attempt can be retried", async () => {
      await screen.findByTestId("session-not-persisted-error");
      expect(screen.getByRole("button", { name: /iniciar sesión/i })).toBeEnabled();
    });
  });

  describe("when the browser keeps the session cookies", () => {
    it("still confirms, announces the session and sends the user to their panel", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        mockNetwork({ cookiesKept: true });
        renderLogin();
        await screen.findByRole("button", { name: /iniciar sesión/i });
        submitLoginForm();

        expect(await screen.findByText(/Su sesión quedó iniciada/)).toBeInTheDocument();
        expect(screen.queryByTestId("session-not-persisted-error")).not.toBeInTheDocument();

        // `WELCOME_HOLD_MS` — the beat the page already held before this fix,
        // and the only wait between the toast and the redirect.
        await vi.advanceTimersByTimeAsync(900);
        await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/dashboard"));
      } finally {
        vi.useRealTimers();
      }
    });

    it("confirms against the session route the rest of the app hydrates from", async () => {
      mockNetwork({ cookiesKept: true });
      renderLogin();
      await screen.findByRole("button", { name: /iniciar sesión/i });
      submitLoginForm();

      await screen.findByText(/Su sesión quedó iniciada/);

      const calls = vi.mocked(global.fetch).mock.calls.map(([input, init]) => `${init?.method ?? "GET"} ${String(input)}`);
      const loginIndex = calls.indexOf("POST /api/auth/login");
      expect(loginIndex).toBeGreaterThanOrEqual(0);
      // The confirmation is a GET of the session route AFTER the login POST.
      expect(calls.slice(loginIndex + 1)).toContain("GET /api/auth/session");
    });
  });
});
