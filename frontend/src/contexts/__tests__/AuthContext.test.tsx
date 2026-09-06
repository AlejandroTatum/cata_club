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
// loggingOutRef (issue #1041)
// ---------------------------------------------------------------------------

/**
 * `loggingOutRef` means "a logout is IN FLIGHT", not "a logout ever happened
 * in this tab". `login()` was the only place that turned it back off, but
 * the public enrolment wizard establishes a new session WITHOUT going
 * through `login()` (it posts to /api/enrollment and calls `refreshSession`
 * directly) — so after a logout, that ref stayed stuck true for the rest of
 * the provider's life and every later `revalidate()` short-circuited to
 * `unauthenticated` without ever reaching the network.
 */
function RefreshProbe() {
  const { logout, refreshSession, isAuthenticated } = useAuth();
  return (
    <>
      <button type="button" onClick={() => void logout()}>
        Cerrar Sesión
      </button>
      <button type="button" onClick={() => void refreshSession()}>
        Refrescar
      </button>
      <p>auth:{String(isAuthenticated)}</p>
    </>
  );
}

describe("AuthProvider loggingOutRef (issue #1041)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLogout.mockResolvedValue(undefined);
    mockGetSession.mockResolvedValue({ kind: "unauthenticated" as const });
  });

  it("lets a later refreshSession reach the network once the logout has settled", async () => {
    render(
      <AuthProvider>
        <RefreshProbe />
      </AuthProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cerrar Sesión" }));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/login"));

    mockGetSession.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Refrescar" }));

    // Before the fix, this call never happened — `loggingOutRef` cut
    // `revalidate()` off before it ever asked the backend anything, exactly
    // like the enrolment wizard's confirmation round trip in production.
    await waitFor(() => expect(mockGetSession).toHaveBeenCalledTimes(1));
  });

  it("keeps a logout in flight from being reverted by a concurrent refresh", async () => {
    let resolveLogout: (() => void) | undefined;
    mockLogout.mockImplementation(
      () =>
        new Promise<undefined>((resolve) => {
          resolveLogout = () => resolve(undefined);
        }),
    );

    render(
      <AuthProvider>
        <RefreshProbe />
      </AuthProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cerrar Sesión" }));
    // The logout request is still in flight — discardInFlightRefresh already
    // fired synchronously, and no concurrent refresh may resurrect the
    // access-token cookie before logout's own Max-Age=0 clear lands.
    mockGetSession.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Refrescar" }));

    await Promise.resolve();
    expect(mockGetSession).not.toHaveBeenCalled();

    // Let the logout itself settle so no promise is left dangling past the
    // test, then confirm it still finishes normally.
    resolveLogout?.();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/login"));
  });

  /*
   * The race an adversarial review found in this fix's first version: a
   * `revalidate()` that is ALREADY in flight (the 5-minute interval, a
   * `visibilitychange` tick) when the person clicks "Cerrar sesión" captures
   * `loggingOutRef.current === false` on entry — logout has not started yet.
   * Resetting that same ref in logout's `finally` (this issue's own fix) then
   * meant the SECOND check, after this call's `await`, also read `false`,
   * because by the time it runs logout has already finished settling. A
   * stale "authenticated" answer that arrives after that point must still
   * be rejected — this is the case the OTHER two tests in this block do not
   * cover: both of them start the refresh DURING or AFTER the logout, never
   * BEFORE it.
   */
  it("does not resurrect the session from a refresh that started before the logout and resolves after it", async () => {
    let resolveGetSession: ((outcome: SessionOutcome) => void) | undefined;
    mockGetSession.mockImplementation(
      () =>
        new Promise<SessionOutcome>((resolve) => {
          resolveGetSession = resolve;
        }),
    );

    render(
      <AuthProvider>
        <RefreshProbe />
      </AuthProvider>,
    );

    // A revalidation starts while the tab is still authenticated — logout
    // has not been clicked yet, so `loggingOutRef` is still `false`.
    fireEvent.click(screen.getByRole("button", { name: "Refrescar" }));

    // The person logs out WHILE that refresh is still waiting on the
    // network. `authService.logout` resolves immediately (this block's
    // default mock), so logout's own `finally` runs — and resets
    // `loggingOutRef` to `false` — before the stale refresh ever settles.
    fireEvent.click(screen.getByRole("button", { name: "Cerrar Sesión" }));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/login"));
    await screen.findByText("auth:false");

    // Only now does the stale refresh come back — with an answer describing
    // the session that was just closed.
    resolveGetSession?.({
      kind: "authenticated",
      session: {
        user: { id: "1", name: "Admin", email: "admin@cataclub.com", role: "admin", representanteId: null, createdAt: "2026-01-01T00:00:00Z" },
        roles: ["ADMINISTRADOR"],
        loggedInAt: "2026-01-01T00:00:00Z",
      },
    });

    // Give the stale `revalidate()` call's post-`await` continuation a turn
    // to run. If it reinstates the session, this flips to "auth:true" and
    // the person who just logged out is authenticated again.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText("auth:false")).toBeInTheDocument();
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

  it("stays false on an auth failure that never had a session behind it (issue #817)", async () => {
    // A visitor with no account/cookies who opens a protected route hits a
    // 401 whose refresh also fails — `notifyAuthFailure()` fires — without
    // ever having had an authenticated session in this tab. Unlike the other
    // tests in this block, hydration must resolve to UNAUTHENTICATED first,
    // so there is nothing to have "expired".
    mockGetSession.mockResolvedValue({ kind: "unauthenticated" as const });

    render(
      <AuthProvider>
        <SessionProbe />
      </AuthProvider>,
    );
    await screen.findByText("auth:false expired:false");

    expect(authFailureListener).not.toBeNull();
    act(() => {
      authFailureListener?.();
    });

    // Must NOT flip to true — nobody was logged in for this to end.
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
