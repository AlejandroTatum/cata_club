/**
 * Unit tests for auth state transition functions, plus integration tests for
 * the real AuthProvider (src/contexts/AuthContext.tsx) that consumes them.
 *
 * The state-transition tests are pure functions — no React, no browser APIs
 * needed. The AuthProvider tests below render the real provider (with
 * `src/services/auth.ts`/`src/services/api.ts` mocked at the service
 * boundary, not the context) since every OTHER consumer test in this repo
 * mocks AuthContext entirely, leaving the provider's own mount-hydration,
 * periodic/visibility revalidation, and auth-failure wiring uncovered.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import {
  createInitialAuthState,
  hydrateState,
  applyLoginResult,
  applyLogout,
} from "../auth-state";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import type { AuthSession, SessionOutcome } from "@/services/auth";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockSession: AuthSession = {
  user: {
    id: "user-admin-1",
    name: "Admin",
    email: "admin@cataclub.com",
    role: "admin",
    representanteId: null,
    createdAt: "2026-01-01T00:00:00Z",
  },
  roles: ["ADMINISTRADOR"],
  loggedInAt: "2026-07-01T12:00:00Z",
};

// ---------------------------------------------------------------------------
// createInitialAuthState
// ---------------------------------------------------------------------------

describe("createInitialAuthState", () => {
  it("returns an unauthenticated loading state", () => {
    const state = createInitialAuthState();
    expect(state.session).toBeNull();
    expect(state.isLoading).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// hydrateState
// ---------------------------------------------------------------------------

describe("hydrateState", () => {
  it("sets session when saved session exists", () => {
    const state = hydrateState(mockSession);
    expect(state.session).toBe(mockSession);
    expect(state.isLoading).toBe(false);
  });

  it("keeps session null when no saved session", () => {
    const state = hydrateState(null);
    expect(state.session).toBeNull();
    expect(state.isLoading).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// applyLoginResult
// ---------------------------------------------------------------------------

describe("applyLoginResult", () => {
  it("updates session on successful login", () => {
    const initial = createInitialAuthState();
    const next = applyLoginResult(initial, mockSession);
    expect(next.session).toBe(mockSession);
    expect(next.isLoading).toBe(initial.isLoading);
  });

  it("does not change state on failed login", () => {
    const initial = createInitialAuthState();
    // Simulate a failed login after hydration (not loading anymore)
    const hydrated = hydrateState(null);
    const next = applyLoginResult(hydrated, null);
    expect(next.session).toBeNull();
    expect(next.isLoading).toBe(false);
  });

  it("preserves existing session on failed login", () => {
    const initial = hydrateState(mockSession);
    const next = applyLoginResult(initial, null);
    expect(next.session).toBe(mockSession);
    expect(next.isLoading).toBe(false);
  });

  it("replaces existing session with new login", () => {
    const newSession: AuthSession = {
      ...mockSession,
      user: { ...mockSession.user, id: "user-trainer-1", role: "trainer" },
      roles: ["ENTRENADOR"],
    };
    const initial = hydrateState(mockSession);
    const next = applyLoginResult(initial, newSession);
    expect(next.session).toBe(newSession);
    // Safe: the assertion on the line above already proved next.session is
    // newSession (non-null) before this line runs.
    expect(next.session!.user.role).toBe("trainer");
    expect(next.isLoading).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// applyLogout
// ---------------------------------------------------------------------------

describe("applyLogout", () => {
  it("clears session when authenticated", () => {
    const initial = hydrateState(mockSession);
    const next = applyLogout(initial);
    expect(next.session).toBeNull();
    expect(next.isLoading).toBe(false);
  });

  it("is a no-op on session when already null", () => {
    const initial = hydrateState(null);
    const next = applyLogout(initial);
    expect(next.session).toBeNull();
    expect(next.isLoading).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AuthProvider (integration) — mount hydration, revalidation, auth-failure
// wiring, and Finding 1's outage-vs-unauthenticated contract.
// ---------------------------------------------------------------------------

/*
 * AuthProvider now owns the post-logout redirect, so it consumes `useRouter`.
 * These tests are about hydration and revalidation, not navigation — the stub
 * exists so the provider can mount. The redirect itself is asserted in
 * `src/contexts/__tests__/AuthContext.test.tsx`.
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const mockGetSession = vi.fn<() => Promise<SessionOutcome>>();

vi.mock("@/services/auth", () => ({
  authService: {
    getSession: () => mockGetSession(),
    login: vi.fn(),
    logout: vi.fn(),
  },
}));

let authFailureListener: (() => void) | undefined;

vi.mock("@/services/api", () => ({
  subscribeAuthFailure: (listener: () => void) => {
    authFailureListener = listener;
    return () => {
      authFailureListener = undefined;
    };
  },
  discardInFlightRefresh: vi.fn(),
  setCurrentMockRole: vi.fn(),
}));

const adminSession: AuthSession = {
  user: {
    id: "user-admin-1",
    name: "Admin",
    email: "admin@cataclub.com",
    role: "admin",
    representanteId: null,
  },
  roles: ["ADMINISTRADOR"],
  loggedInAt: "2026-07-17T10:00:00.000Z",
};

function Consumer(): React.ReactElement {
  const { session, isLoading } = useAuth();
  if (isLoading) return createElement("p", null, "loading");
  return createElement(
    "p",
    null,
    session ? `authenticated:${session.user.email}` : "unauthenticated",
  );
}

function renderAuthProvider(): ReturnType<typeof render> {
  return render(createElement(AuthProvider, null, createElement(Consumer, null)));
}

function triggerVisibilityChange(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("AuthProvider", () => {
  beforeEach(() => {
    mockGetSession.mockReset();
    authFailureListener = undefined;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("hydrates the session on mount by calling getSession exactly once", async () => {
    mockGetSession.mockResolvedValue({ kind: "authenticated", session: adminSession });

    renderAuthProvider();

    await waitFor(() =>
      expect(screen.getByText("authenticated:admin@cataclub.com")).toBeInTheDocument(),
    );
    expect(mockGetSession).toHaveBeenCalledTimes(1);
  });

  it("a visibilitychange event triggers revalidation", async () => {
    vi.useFakeTimers();
    mockGetSession.mockResolvedValueOnce({ kind: "authenticated", session: adminSession });
    renderAuthProvider();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mockGetSession).toHaveBeenCalledTimes(1);

    mockGetSession.mockResolvedValueOnce({ kind: "authenticated", session: adminSession });
    act(() => triggerVisibilityChange("visible"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mockGetSession).toHaveBeenCalledTimes(2);
  });

  it("the periodic interval triggers revalidation while a session is active", async () => {
    vi.useFakeTimers();
    mockGetSession.mockResolvedValue({ kind: "authenticated", session: adminSession });

    renderAuthProvider();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mockGetSession).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    });
    expect(mockGetSession).toHaveBeenCalledTimes(2);
  });

  it("an auth-failure notification from the API client clears the session", async () => {
    mockGetSession.mockResolvedValueOnce({ kind: "authenticated", session: adminSession });
    renderAuthProvider();
    await waitFor(() =>
      expect(screen.getByText("authenticated:admin@cataclub.com")).toBeInTheDocument(),
    );

    expect(authFailureListener).toBeDefined();
    act(() => authFailureListener?.());

    await waitFor(() => expect(screen.getByText("unauthenticated")).toBeInTheDocument());
  });

  it("preserves the existing session when revalidation reports an outage (Finding 1)", async () => {
    mockGetSession.mockResolvedValueOnce({ kind: "authenticated", session: adminSession });
    renderAuthProvider();
    await waitFor(() =>
      expect(screen.getByText("authenticated:admin@cataclub.com")).toBeInTheDocument(),
    );

    mockGetSession.mockResolvedValueOnce({ kind: "outage" });
    act(() => triggerVisibilityChange("visible"));

    await waitFor(() => expect(mockGetSession).toHaveBeenCalledTimes(2));
    // Still authenticated — an outage must not be treated as a logout.
    expect(screen.getByText("authenticated:admin@cataclub.com")).toBeInTheDocument();
  });

  it("clears the session when revalidation reports genuinely unauthenticated (Finding 1)", async () => {
    mockGetSession.mockResolvedValueOnce({ kind: "authenticated", session: adminSession });
    renderAuthProvider();
    await waitFor(() =>
      expect(screen.getByText("authenticated:admin@cataclub.com")).toBeInTheDocument(),
    );

    mockGetSession.mockResolvedValueOnce({ kind: "unauthenticated" });
    act(() => triggerVisibilityChange("visible"));

    await waitFor(() => expect(screen.getByText("unauthenticated")).toBeInTheDocument());
  });
});
