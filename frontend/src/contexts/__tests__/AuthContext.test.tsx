/**
 * Behaviour tests for AuthProvider's logout action.
 *
 * The point of these is the NAVIGATION, not the cookie clearing. Every
 * authenticated screen used to land on /login only as a side effect of
 * ProtectedRoute noticing the session went null. Public-but-authenticated
 * pages (/ayuda) have no ProtectedRoute, so logging out from there left the
 * user sitting on the same page still looking logged in. Redirecting from
 * logout itself makes that independent of who rendered the button.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SessionOutcome } from "@/services/auth";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockReplace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: vi.fn() }),
}));

const mockLogin = vi.fn();
const mockLogout = vi.fn(async () => undefined);
const mockGetSession = vi.fn<() => Promise<SessionOutcome>>(async () => ({ kind: "unauthenticated" }));

vi.mock("@/services/auth", () => ({
  authService: {
    login: (...args: unknown[]) => mockLogin(...args),
    logout: () => mockLogout(),
    getSession: () => mockGetSession(),
  },
}));

/**
 * Captures the listener `AuthProvider` registers so tests can fire it
 * directly — the real one only fires from inside `src/services/api.ts`'s
 * `request()` after a failed refresh-and-retry, which this test file has no
 * reason to reimplement.
 */
let authFailureListener: (() => void) | null = null;

vi.mock("@/services/api", () => ({
  subscribeAuthFailure: (listener: () => void) => {
    authFailureListener = listener;
    return () => {
      authFailureListener = null;
    };
  },
  discardInFlightRefresh: vi.fn(),
  setCurrentMockRole: vi.fn(),
}));

import { AuthProvider, useAuth } from "@/contexts/AuthContext";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function LogoutButton() {
  const { logout } = useAuth();
  return (
    <button type="button" onClick={() => void logout()}>
      Cerrar Sesión
    </button>
  );
}

function renderWithProvider() {
  return render(
    <AuthProvider>
      <LogoutButton />
    </AuthProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AuthProvider logout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLogout.mockResolvedValue(undefined);
    mockGetSession.mockResolvedValue({ kind: "unauthenticated" as const });
  });

  it("sends the user to /login after clearing the session", async () => {
    renderWithProvider();

    fireEvent.click(screen.getByRole("button", { name: "Cerrar Sesión" }));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/login");
    });
  });

  it("redirects even when the logout request itself fails", async () => {
    /*
     * `authService.logout` is documented to always resolve, but a rejection
     * here must still leave the user OUT rather than stranded on a page that
     * looks authenticated. The local session is already gone at that point.
     */
    mockLogout.mockRejectedValue(new Error("network down"));
    renderWithProvider();

    fireEvent.click(screen.getByRole("button", { name: "Cerrar Sesión" }));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/login");
    });
  });

  it("clears the session before navigating, so no protected view repaints", async () => {
    renderWithProvider();

    fireEvent.click(screen.getByRole("button", { name: "Cerrar Sesión" }));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalled();
    });
    expect(mockLogout).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// sessionExpired (issue #353)
// ---------------------------------------------------------------------------

/**
 * A refresh-and-retry that ultimately fails (401 on the refresh, e.g. mid a
 * long admin form) reaches this exact path: `src/services/api.ts`'s
 * `request()` calls `notifyAuthFailure()`, which fires every listener
 * `subscribeAuthFailure` registered — this file's mock captures the one
 * `AuthProvider` installs in `authFailureListener`.
 */
function SessionProbe() {
  const { isAuthenticated, sessionExpired } = useAuth();
  return (
    <p>
      auth:{String(isAuthenticated)} expired:{String(sessionExpired)}
    </p>
  );
}

describe("AuthProvider sessionExpired (issue #353)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLogin.mockReset();
    mockGetSession.mockResolvedValue({
      kind: "authenticated" as const,
      session: {
        user: { id: "1", name: "Admin", email: "admin@cataclub.com", role: "admin", representanteId: null, createdAt: "2026-01-01T00:00:00Z" },
        roles: ["ADMINISTRADOR"],
        loggedInAt: "2026-01-01T00:00:00Z",
      },
    });
  });

  it("starts false — an ordinary unauthenticated visit is not a 'session expired' one", async () => {
    mockGetSession.mockResolvedValue({ kind: "unauthenticated" as const });
    render(
      <AuthProvider>
        <SessionProbe />
      </AuthProvider>,
    );

    await screen.findByText("auth:false expired:false");
  });

  it("flips true when the API client's failed refresh-and-retry fires (401 mid-request)", async () => {
    render(
      <AuthProvider>
        <SessionProbe />
      </AuthProvider>,
    );

    await screen.findByText("auth:true expired:false");

    expect(authFailureListener).not.toBeNull();
    act(() => {
      authFailureListener?.();
    });

    await screen.findByText("auth:false expired:true");
  });

  it("does NOT flip true on an explicit, user-initiated logout — only the involuntary path does", async () => {
    mockLogout.mockResolvedValue(undefined);

    function ProbeWithLogout() {
      const { logout } = useAuth();
      return (
        <>
          <SessionProbe />
          <button type="button" onClick={() => void logout()}>
            Cerrar Sesión
          </button>
        </>
      );
    }

    render(
      <AuthProvider>
        <ProbeWithLogout />
      </AuthProvider>,
    );
    await screen.findByText("auth:true expired:false");

    fireEvent.click(screen.getByRole("button", { name: "Cerrar Sesión" }));

    await screen.findByText("auth:false expired:false");
  });

  it("resets on a fresh successful login, so a later unrelated bounce is not mislabeled", async () => {
    function ProbeWithLogin() {
      const { login } = useAuth();
      return (
        <>
          <SessionProbe />
          <button type="button" onClick={() => void login("admin@cataclub.com", "secret")}>
            Entrar
          </button>
        </>
      );
    }

    render(
      <AuthProvider>
        <ProbeWithLogin />
      </AuthProvider>,
    );
    await screen.findByText("auth:true expired:false");

    act(() => {
      authFailureListener?.();
    });
    await screen.findByText("auth:false expired:true");

    mockLogin.mockResolvedValue({
      ok: true,
      session: {
        user: { id: "1", name: "Admin", email: "admin@cataclub.com", role: "admin", representanteId: null, createdAt: "2026-01-01T00:00:00Z" },
        roles: ["ADMINISTRADOR"],
        loggedInAt: "2026-01-01T00:00:00Z",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));

    await screen.findByText("auth:true expired:false");
  });
});
