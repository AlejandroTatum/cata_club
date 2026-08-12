/**
 * Behaviour tests for AuthProvider's initial session hydration (DSH-6).
 *
 * `authService.getSession()` already returns a 3-way discriminated outcome
 * (authenticated / unauthenticated / outage — see services/auth.ts) and the
 * periodic `revalidate` callback already treats "outage" as a no-op. The bug
 * was the mount-hydration effect: it collapsed BOTH "unauthenticated" and
 * "outage" into `session = null`, so a network blip on the very first load
 * looked identical to "never logged in" and ProtectedRoute redirected to
 * /login without telling the admin why.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const mockGetSession = vi.fn();

vi.mock("@/services/auth", () => ({
  authService: {
    login: vi.fn(),
    logout: vi.fn(async () => undefined),
    getSession: () => mockGetSession(),
  },
}));

vi.mock("@/services/api", () => ({
  subscribeAuthFailure: () => () => {},
  discardInFlightRefresh: vi.fn(),
  setCurrentMockRole: vi.fn(),
}));

import { AuthProvider, useAuth } from "@/contexts/AuthContext";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const AUTHENTICATED_SESSION = {
  user: {
    id: "user-1",
    name: "Admin",
    email: "admin@cataclub.com",
    role: "admin" as const,
    representanteId: null,
    createdAt: "2026-01-01T00:00:00Z",
  },
  roles: ["ADMINISTRADOR"],
  loggedInAt: "2026-07-01T12:00:00Z",
};

function Probe() {
  const { session, isAuthenticated, isLoading, hydrationOutage } = useAuth();
  return (
    <div>
      <span data-testid="session">{session ? "present" : "null"}</span>
      <span data-testid="authenticated">{String(isAuthenticated)}</span>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="outage">{String(hydrationOutage)}</span>
    </div>
  );
}

function renderWithProvider() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AuthProvider initial hydration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not log the user out when the initial check hits an outage", async () => {
    mockGetSession.mockResolvedValue({ kind: "outage" });
    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("false");
    });

    // Session state must stay untouched by the outage -- never forced to
    // "unauthenticated" just because the network hiccupped.
    expect(screen.getByTestId("authenticated")).toHaveTextContent("false");
    expect(screen.getByTestId("outage")).toHaveTextContent("true");
  });

  it("still logs out for a genuine unauthenticated result", async () => {
    mockGetSession.mockResolvedValue({ kind: "unauthenticated" });
    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("false");
    });

    expect(screen.getByTestId("authenticated")).toHaveTextContent("false");
    expect(screen.getByTestId("outage")).toHaveTextContent("false");
  });

  it("hydrates the session normally when the initial check succeeds", async () => {
    mockGetSession.mockResolvedValue({ kind: "authenticated", session: AUTHENTICATED_SESSION });
    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("false");
    });

    expect(screen.getByTestId("authenticated")).toHaveTextContent("true");
    expect(screen.getByTestId("session")).toHaveTextContent("present");
    expect(screen.getByTestId("outage")).toHaveTextContent("false");
  });
});
