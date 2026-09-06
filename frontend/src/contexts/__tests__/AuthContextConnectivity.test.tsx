/**
 * Behaviour tests for AuthProvider's PERIODIC connectivity detection
 * (issue #454).
 *
 * Distinct from `AuthContextHydration.test.tsx`, which covers the INITIAL
 * mount hydration check. This file covers `revalidate()` — the 5-minute
 * interval / `visibilitychange` tick that runs while a tab stays open with
 * an existing session. Before this fix, `revalidate()` silently no-op'd on
 * an "outage" outcome (correct — a blip must not read as a logout) but left
 * NOTHING visible: no banner, no retry, nothing on screen for a tab left
 * open through a real backend outage.
 *
 * Fake timers, driven with `advanceTimersByTimeAsync` (not `waitFor`,
 * which polls on REAL timers and hangs to its own 5s timeout once fake
 * timers are active) — every timer-driven state update is asserted right
 * after the `act` that flushed it.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import type { SessionOutcome } from "@/services/auth";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const mockGetSession = vi.fn<() => Promise<SessionOutcome>>();

vi.mock("@/services/auth", () => ({
  authService: {
    login: vi.fn(),
    logout: vi.fn(async () => undefined),
    getSession: () => mockGetSession(),
  },
}));

vi.mock("@/services/api", () => ({
  subscribeAuthFailure: () => () => {},
  discardInFlightAuthRequests: vi.fn(),
  setCurrentMockRole: vi.fn(),
}));

import { AuthProvider, useAuth } from "@/contexts/AuthContext";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SESSION_REVALIDATE_INTERVAL_MS = 5 * 60 * 1000;
const PERIODIC_OUTAGE_RETRY_MS = 20 * 1000;

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
  const { session, hydrationOutage, periodicOutage } = useAuth();
  return (
    <div>
      <span data-testid="session">{session ? "present" : "null"}</span>
      <span data-testid="hydration-outage">{String(hydrationOutage)}</span>
      <span data-testid="periodic-outage">{String(periodicOutage)}</span>
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

/** Flushes the mount-hydration promise chain (no timer involved). */
async function flush(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function mountAuthenticated(): Promise<void> {
  mockGetSession.mockResolvedValueOnce({ kind: "authenticated", session: AUTHENTICATED_SESSION });
  renderWithProvider();
  await flush();
  expect(screen.getByTestId("session")).toHaveTextContent("present");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AuthProvider periodic connectivity (issue #454)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // RED: today, a periodic outage produces nothing visible — this is the
  // gap the fix closes. It now passes because `periodicOutage` flips true.
  it("flags an outage when the periodic revalidation hits one (was: nothing visible)", async () => {
    await mountAuthenticated();

    mockGetSession.mockResolvedValueOnce({ kind: "outage" });
    await advance(SESSION_REVALIDATE_INTERVAL_MS);

    expect(screen.getByTestId("periodic-outage")).toHaveTextContent("true");
    // Still must NOT be treated as a logout — the existing session survives.
    expect(screen.getByTestId("session")).toHaveTextContent("present");
  });

  // TRIANGULATE: resolves on its own, no reload / user action required.
  it("clears the flag on its own once a later background retry succeeds", async () => {
    await mountAuthenticated();

    mockGetSession.mockResolvedValueOnce({ kind: "outage" });
    await advance(SESSION_REVALIDATE_INTERVAL_MS);
    expect(screen.getByTestId("periodic-outage")).toHaveTextContent("true");

    mockGetSession.mockResolvedValueOnce({ kind: "authenticated", session: AUTHENTICATED_SESSION });
    await advance(PERIODIC_OUTAGE_RETRY_MS);

    expect(screen.getByTestId("periodic-outage")).toHaveTextContent("false");
  });

  // TRIANGULATE: the initial hydration outage (a different, pre-existing
  // flag) must not bleed into the periodic one — they cover different
  // moments and `ProtectedRoute`/`ConnectivityBanner` must be able to tell
  // them apart.
  it("keeps hydrationOutage and periodicOutage independent", async () => {
    mockGetSession.mockResolvedValueOnce({ kind: "outage" });
    renderWithProvider();
    await flush();

    expect(screen.getByTestId("hydration-outage")).toHaveTextContent("true");
    expect(screen.getByTestId("periodic-outage")).toHaveTextContent("false");
  });

  // TRIANGULATE: background retry keeps firing on its own short cadence
  // while the outage persists, rather than waiting out the full 5-minute
  // session-revalidate interval.
  it("keeps retrying on the short cadence while the outage persists", async () => {
    await mountAuthenticated();

    mockGetSession.mockResolvedValue({ kind: "outage" });
    await advance(SESSION_REVALIDATE_INTERVAL_MS);
    expect(screen.getByTestId("periodic-outage")).toHaveTextContent("true");

    const callsBeforeRetry = mockGetSession.mock.calls.length;
    await advance(PERIODIC_OUTAGE_RETRY_MS);

    expect(mockGetSession.mock.calls.length).toBeGreaterThan(callsBeforeRetry);
  });
});
