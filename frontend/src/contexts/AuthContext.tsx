/**
 * AuthContext — React context for session state.
 *
 * Hydrates from the BFF's /api/auth/session route on mount (never reads
 * localStorage — the browser has no token to read) and exposes async
 * login/logout actions. Must be wrapped in a client component boundary
 * (already done in layout.tsx via AuthProviderWrapper).
 *
 * Session freshness while a tab stays open: on mount, on tab
 * visibilitychange, and on a bounded interval, we silently re-hydrate from
 * /api/auth/session — that route proactively refreshes the access-token
 * cookie server-side when it's close to expiry, so an active session never
 * gets kicked out from under an idle-but-open tab. This is a deliberately
 * simple mechanism (no background timers that survive tab close — the
 * interval is cleared on unmount like any other React effect).
 */

"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import type { AuthSession, LoginResult, SessionOutcome } from "@/services/auth";
import { authService } from "@/services/auth";
import { subscribeAuthFailure, discardInFlightRefresh, setCurrentMockRole } from "@/services/api";
import { hydrateState } from "@/lib/auth-state";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuthContextValue {
  /** The current session, or null when not authenticated. */
  session: AuthSession | null;
  /** Convenience flag — true when session is non-null. */
  isAuthenticated: boolean;
  /** True while hydrating the session from the BFF on first mount. */
  isLoading: boolean;
  /**
   * Attempt login with email + password via the BFF's /api/auth/login route.
   * @returns A discriminated result — `{ ok: true, session }` once the
   * service has CONFIRMED the session round-trips (see `login` in
   * src/services/auth.ts: a 200 alone is not a session), `{ ok: false, error }`
   * on failure (see AuthErrorKind for distinct cases).
   */
  login: (email: string, password: string) => Promise<LoginResult>;
  /** Clear the current session (server cookies first, then local state). */
  logout: () => Promise<void>;
  /**
   * Re-hydrate the session from /api/auth/session without a full page
   * reload — needed after a BFF route sets auth cookies outside the
   * login form itself (e.g. auto-login on /student/enroll), since
   * AuthProvider only mounts once at the root layout and otherwise keeps
   * stale (null) session state across client-side navigation.
   *
   * @returns The round-trip's own `SessionOutcome`, so a caller that needs
   * to KNOW whether the cookies took can find out. Those cookies are
   * `HttpOnly`, so a `Set-Cookie` on a 2xx is not evidence the browser kept
   * them (issue #711 / #717): only this answer is. Returning it rather than
   * `void` is what lets `/student/enroll` stop announcing a session it has
   * no proof of. `outage` is NOT `unauthenticated` — see `SessionOutcome`.
   */
  refreshSession: () => Promise<SessionOutcome>;
  /**
   * True when the INITIAL session check (mount hydration) hit an outage
   * (network failure or 5xx) instead of getting a real answer — see
   * `SessionOutcome`. Distinct from "unauthenticated": a consumer (e.g.
   * `ProtectedRoute`) must show a retry prompt here instead of redirecting
   * to /login, because an outage says nothing about whether the user is
   * actually logged in (DSH-6).
   */
  hydrationOutage: boolean;
  /** Retry the initial session check after a hydration outage. */
  retryHydration: () => void;
  /**
   * True when the session was cleared INVOLUNTARILY — a refresh-and-retry
   * from `src/services/api.ts`'s `request()` ultimately failed (401 on the
   * refresh itself), not an explicit `logout()` and not an ordinary visit
   * that was never authenticated (issue #353). `ProtectedRoute` reads this
   * once, at the moment it redirects, to label that redirect
   * (`?motivo=sesion-expirada`) so `/login` can say WHY the admin landed
   * there instead of bouncing silently — the one resilience finding in this
   * QA round where user-typed data was actually lost.
   *
   * Reset on a fresh successful `login()` so a LATER, unrelated bounce is
   * never mislabeled by a stale flag from a session two logins ago.
   *
   * Issue #817: "not an ordinary visit that was never authenticated" above
   * was only intent until now — the failure listener set this unconditionally,
   * so a first-time visitor with no account also saw the banner. Enforced via
   * `hadSessionRef`, set the moment a session is actually established.
   */
  sessionExpired: boolean;
  /**
   * True from the moment a PERIODIC session revalidation (`revalidate()` —
   * the 5-minute interval or a `visibilitychange` tick, NOT the initial
   * mount hydration covered by `hydrationOutage`) hits an outage, until a
   * later revalidation succeeds. Issue #454: before this flag existed,
   * `revalidate()` silently no-op'd on outage (correctly — a transient blip
   * must not read as a logout) but left literally nothing on screen for a
   * tab that stayed open through a backend outage. `ConnectivityBanner`
   * (mounted once in `AuthProviderWrapper`) is this flag's only consumer —
   * it renders the app-wide "sin conexión" banner and clears itself the
   * moment this goes back to false, with no page reload required.
   */
  periodicOutage: boolean;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthContextValue | null>(null);

/** How often to silently revalidate the session while a tab stays open (also runs on visibility change). Comfortably under the 60-minute access-token lifetime so /api/auth/session has room to proactively refresh before expiry. */
const SESSION_REVALIDATE_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Once `periodicOutage` is true, how often to retry in the background —
 * deliberately much shorter than `SESSION_REVALIDATE_INTERVAL_MS`. Waiting
 * out the full 5-minute cadence while the "sin conexión" banner sits on
 * screen would make "reintentando…" a lie for most of that window; this
 * loop stops the moment a revalidation succeeds (see the effect below).
 */
const PERIODIC_OUTAGE_RETRY_MS = 20 * 1000;

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // DSH-6: set only when the INITIAL hydration check hits an outage. Never
  // touched by the periodic revalidate (that one already no-ops on outage
  // without needing to say anything — a session is already on screen).
  const [hydrationOutage, setHydrationOutage] = useState(false);
  // Issue #353 — see the field's own doc comment on AuthContextValue.
  const [sessionExpired, setSessionExpired] = useState(false);
  // Issue #454 — see the field's own doc comment on AuthContextValue.
  const [periodicOutage, setPeriodicOutage] = useState(false);
  const sessionRef = useRef<AuthSession | null>(null);
  sessionRef.current = session;
  /**
   * Issue #817: true once an authenticated session has actually been
   * established in THIS tab (mount hydration, a background revalidation, or
   * a fresh login) — as opposed to `sessionExpired`, which only says a
   * refresh-and-retry failed. A visitor who opens a protected route with no
   * account at all also fails that refresh, but there was never a session
   * for it to have "expired": without this ref the failure listener below
   * could not tell the two apart, and every first-time visitor saw the
   * "Su sesión expiró" banner. A ref, not state: it must be readable
   * SYNCHRONOUSLY inside the listener below, and a state read there could
   * still observe a stale closure from before the establishing render
   * committed.
   */
  const hadSessionRef = useRef(false);
  // Set synchronously at the start of logout() so any revalidation already
  // scheduled (interval tick / visibilitychange) bails out immediately
  // instead of racing a new refresh in after logout begins. Reset once
  // logout's own request settles (see logout's `finally`) -- it means "a
  // logout is IN FLIGHT", not "a logout ever happened in this tab".
  const loggingOutRef = useRef(false);
  /**
   * Monotonically increasing, bumped the moment `logout()` begins. Exists
   * because `loggingOutRef` alone cannot tell a `revalidate()` that started
   * BEFORE this logout from one that starts AFTER it ends — both read
   * `false` once logout's `finally` resets the ref (issue #1041's own fix).
   * `revalidate()` captures this counter when it starts and compares it
   * again after its network round trip: if a logout began ANYWHERE in
   * between, the answer it is holding is stale -- describing a session that
   * no longer exists -- even though `loggingOutRef` itself has already gone
   * back to `false` by the time the comparison runs. Without this, a
   * `revalidate()` already in flight when the person clicks "Cerrar sesión"
   * (the 5-minute interval, a `visibilitychange` tick) could resolve AFTER
   * logout finishes and hand its now-authenticated answer to `setSession`,
   * resurrecting the very session that was just closed.
   */
  const logoutEpochRef = useRef(0);

  // Mirror the current role to the API client (src/services/api.ts) so its
  // mock-mode `x-mock-role` header reflects the real session.
  useEffect(() => {
    setCurrentMockRole(session?.user.role ?? null);
  }, [session]);

  const revalidate = useCallback(async (): Promise<SessionOutcome> => {
    // A logout is already under way, so there is no session to report and
    // nothing to write into state — `unauthenticated` is the honest answer,
    // and the one that keeps a caller from claiming a session either way.
    if (loggingOutRef.current) return { kind: "unauthenticated" };
    // Captured BEFORE the network round trip: if a logout begins anywhere
    // during the `await` below, this call's answer describes a session that
    // no longer exists by the time it comes back, even though `logout()`'s
    // own `finally` may have already reset `loggingOutRef` to `false` again.
    const epochAtStart = logoutEpochRef.current;
    const outcome = await authService.getSession();
    if (loggingOutRef.current || logoutEpochRef.current !== epochAtStart) return outcome;
    // A transient outage (503 / network failure) must NOT be treated as a
    // logout — only a genuine "unauthenticated" result clears the session.
    // Issue #454: it also must not stay invisible — flag it so
    // `ConnectivityBanner` can tell the rest of the app.
    if (outcome.kind === "outage") {
      setPeriodicOutage(true);
      return outcome;
    }
    setPeriodicOutage(false);
    if (outcome.kind === "authenticated") hadSessionRef.current = true;
    setSession(outcome.kind === "authenticated" ? outcome.session : null);
    return outcome;
  }, []);

  // Hydrate session from the BFF on mount. DSH-6: an "outage" is NOT the
  // same as "unauthenticated" -- a network blip on the very first load must
  // not read as "not logged in" (which ProtectedRoute would send straight
  // to /login, silently, exactly the finding's repro). Mirrors how
  // `revalidate` already treats outage below, just for the mount case,
  // which additionally has no prior session to fall back on and so needs
  // its own error surface (`hydrationOutage`) instead of merely no-op'ing.
  useEffect(() => {
    let cancelled = false;
    authService.getSession().then((outcome) => {
      if (cancelled) return;
      if (outcome.kind === "outage") {
        setHydrationOutage(true);
        setIsLoading(false);
        return;
      }
      setHydrationOutage(false);
      const saved = outcome.kind === "authenticated" ? outcome.session : null;
      if (saved) hadSessionRef.current = true;
      const { session: hydratedSession, isLoading: done } = hydrateState(saved);
      setSession(hydratedSession);
      setIsLoading(done);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const retryHydration = useCallback(() => {
    setIsLoading(true);
    authService.getSession().then((outcome) => {
      if (outcome.kind === "outage") {
        setHydrationOutage(true);
        setIsLoading(false);
        return;
      }
      setHydrationOutage(false);
      const saved = outcome.kind === "authenticated" ? outcome.session : null;
      if (saved) hadSessionRef.current = true;
      const { session: hydratedSession, isLoading: done } = hydrateState(saved);
      setSession(hydratedSession);
      setIsLoading(done);
    });
  }, []);

  // Proactive refresh trigger: periodic + tab-visibility revalidation while
  // a session is active. Both simply re-call /api/auth/session, which
  // silently refreshes the access-token cookie server-side when needed.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (!loggingOutRef.current && document.visibilityState === "visible" && sessionRef.current) {
        void revalidate();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    const intervalId = setInterval(() => {
      if (!loggingOutRef.current && sessionRef.current) void revalidate();
    }, SESSION_REVALIDATE_INTERVAL_MS);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearInterval(intervalId);
    };
  }, [revalidate]);

  // Issue #454 — background retry while `periodicOutage` is up. Separate
  // from the interval above (which keeps ticking every 5 minutes
  // regardless): this one only exists while the banner is visible, retries
  // much sooner, and stops itself the instant `revalidate` clears the flag
  // — `periodicOutage` flipping to false unmounts this effect's interval
  // via the dependency array, no manual bookkeeping needed.
  useEffect(() => {
    if (!periodicOutage) return;
    const retryId = setInterval(() => {
      if (!loggingOutRef.current && sessionRef.current) void revalidate();
    }, PERIODIC_OUTAGE_RETRY_MS);
    return () => clearInterval(retryId);
  }, [periodicOutage, revalidate]);

  // React to a failed refresh-and-retry from the generic API client
  // (src/services/api.ts) — clear local session state so ProtectedRoute
  // redirects to /login.
  useEffect(() => {
    return subscribeAuthFailure(() => {
      setSession(null);
      // Issue #817: a visitor who never had a session in this tab also
      // fails a refresh-and-retry the first time they touch a protected
      // route (there is no token to refresh) — that is not a session that
      // "expired". Only announce it when `hadSessionRef` says one was
      // actually established here; otherwise this stays an ordinary
      // unauthenticated visit and `ProtectedRoute` redirects silently.
      if (hadSessionRef.current) setSessionExpired(true);
    });
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<LoginResult> => {
    const result = await authService.login(email, password);
    if (result.ok) {
      loggingOutRef.current = false;
      hadSessionRef.current = true;
      setSession(result.session);
      setSessionExpired(false);
    }
    return result;
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    // Stop revalidation and discard any in-flight refresh BEFORE calling the
    // logout route, so neither can resurrect the access-token cookie after
    // logout's Max-Age=0 clear (see discardInFlightRefresh's own doc comment
    // for why this is a client-side mitigation, not a full guarantee).
    loggingOutRef.current = true;
    // Bumped here, not in the `finally` below: any `revalidate()` whose
    // `await` straddles this point — already in flight when the click
    // landed — must find a DIFFERENT epoch than the one it captured, no
    // matter when its own network round trip happens to resolve.
    logoutEpochRef.current += 1;
    discardInFlightRefresh();
    try {
      await authService.logout();
    } catch (err) {
      /*
       * `authService.logout` is documented to always resolve, so this is a
       * belt-and-braces path. It is SWALLOWED rather than rethrown because
       * every call site fires logout without awaiting it, and a rejection
       * would surface as an unhandled promise rejection instead of anything a
       * user could act on. The local session is cleared below either way.
       */
      console.error("[auth] logout request failed", err);
    } finally {
      setSession(null);
      // A logout that follows an outage must not carry the banner onto
      // /login — there is no session left for it to be reporting on.
      setPeriodicOutage(false);
      // Issue #1041: this flag means "a logout is IN FLIGHT", not "a logout
      // ever happened in this tab". Leaving it set past this point starved
      // every LATER `revalidate()` (e.g. the public enrolment wizard's
      // post-signup confirmation, which never goes through `login()`) of the
      // network round trip that would have told it a NEW session was saved.
      // Resetting it here does NOT reopen the race `loggingOutRef` was
      // guarding against: a `revalidate()` that was already in flight when
      // this logout began is still caught by `logoutEpochRef` above, even
      // though it may resolve after this exact line runs.
      loggingOutRef.current = false;
      /*
       * Navigate from HERE rather than leaving it to whatever rendered the
       * button. Until this line, landing on /login was only ever a side effect
       * of ProtectedRoute reacting to the session going null — so every screen
       * that deliberately has no ProtectedRoute (/ayuda is public by design)
       * left the user on the page, still showing an authenticated header.
       * Owning the redirect in the one place logout happens covers the header
       * menu, the mobile menu and the profile screen at once.
       *
       * `replace`, not `push`: the page the user just logged out of must not be
       * one Back button away.
       */
      router.replace("/login");
    }
  }, [router]);

  const value: AuthContextValue = {
    session,
    isAuthenticated: session !== null,
    isLoading,
    login,
    logout,
    refreshSession: revalidate,
    hydrationOutage,
    retryHydration,
    sessionExpired,
    periodicOutage,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Access the current auth context. Must be called within an AuthProvider.
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
