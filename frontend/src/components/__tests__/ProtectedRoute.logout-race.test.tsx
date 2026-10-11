/**
 * Explicit logout vs. ProtectedRoute, wired to the REAL AuthProvider.
 *
 * Flaky e2e (logout.live.spec.ts): after "Cerrar sesión" the user sometimes
 * landed on /login?motivo=sesion-expirada instead of /login. A data request
 * already in flight when the button is clicked gets a 401 once the logout
 * route clears the cookies; its refresh-and-retry fails and
 * `notifyAuthFailure()` fires. Without a guard that read as an involuntary
 * session loss and ProtectedRoute labelled the redirect "sesion-expirada".
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ProtectedRoute from "@/components/ProtectedRoute";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import type { SessionOutcome } from "@/services/auth";

const mockReplace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: vi.fn() }),
}));

const mockLogout = vi.fn<() => Promise<void>>(async () => undefined);
const mockGetSession = vi.fn<() => Promise<SessionOutcome>>();

vi.mock("@/services/auth", () => ({
  authService: {
    login: vi.fn(),
    logout: () => mockLogout(),
    getSession: () => mockGetSession(),
  },
}));

/** The listener AuthProvider registers; the real one fires from api.ts `request()`. */
let authFailureListener: (() => void) | null = null;

vi.mock("@/services/api", () => ({
  subscribeAuthFailure: (listener: () => void) => {
    authFailureListener = listener;
    return () => {
      authFailureListener = null;
    };
  },
  discardInFlightAuthRequests: vi.fn(),
  setCurrentMockRole: vi.fn(),
}));

const ADMIN_SESSION: SessionOutcome = {
  kind: "authenticated",
  session: {
    user: { id: "1", name: "Admin", email: "admin@cataclub.com", role: "admin", representanteId: null, createdAt: "2026-01-01T00:00:00Z" },
    roles: ["ADMINISTRADOR"],
    loggedInAt: "2026-01-01T00:00:00Z",
  },
};

function LogoutButton() {
  const { logout } = useAuth();
  return (
    <button type="button" onClick={() => void logout()}>
      Cerrar sesión
    </button>
  );
}

function renderDashboard() {
  return render(
    <AuthProvider>
      <ProtectedRoute allowedRoles={["admin"]}>
        <LogoutButton />
      </ProtectedRoute>
    </AuthProvider>,
  );
}

/** Every URL the router was sent to, in order. */
function redirects(): string[] {
  return mockReplace.mock.calls.map((call) => String(call[0]));
}

describe("explicit logout never reads as an expired session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authFailureListener = null;
    mockLogout.mockResolvedValue(undefined);
    mockGetSession.mockResolvedValue(ADMIN_SESSION);
  });

  it("ignores an in-flight request's auth failure that lands while the logout request is pending", async () => {
    let finishLogout: () => void = () => undefined;
    mockLogout.mockReturnValue(new Promise<void>((resolve) => (finishLogout = resolve)));
    renderDashboard();

    fireEvent.click(await screen.findByRole("button", { name: "Cerrar sesión" }));
    act(() => {
      authFailureListener?.();
    });
    await act(async () => {
      finishLogout();
    });

    await waitFor(() => expect(redirects()).toContain("/login"));
    expect(redirects().filter((url) => url.includes("motivo"))).toEqual([]);
  });

  it("ignores an in-flight request's auth failure that lands after the logout settled", async () => {
    renderDashboard();

    fireEvent.click(await screen.findByRole("button", { name: "Cerrar sesión" }));
    await waitFor(() => expect(redirects()).toContain("/login"));
    act(() => {
      authFailureListener?.();
    });

    expect(redirects().filter((url) => url.includes("motivo"))).toEqual([]);
  });

  it("still redirects with motivo=sesion-expirada when the session genuinely expires", async () => {
    renderDashboard();

    await screen.findByRole("button", { name: "Cerrar sesión" });
    act(() => {
      authFailureListener?.();
    });

    await waitFor(() => expect(redirects()).toEqual(["/login?motivo=sesion-expirada"]));
  });
});
