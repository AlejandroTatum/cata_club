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
import type { AuthSession, LoginResult } from "@/services/auth";
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
   * @returns A discriminated result — `{ ok: true, session }` on success,
   * `{ ok: false, error }` on failure (see AuthErrorKind for distinct cases).
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
   */
  refreshSession: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthContextValue | null>(null);

/** How often to silently revalidate the session while a tab stays open (also runs on visibility change). Comfortably under the 60-minute access-token lifetime so /api/auth/session has room to proactively refresh before expiry. */
const SESSION_REVALIDATE_INTERVAL_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const sessionRef = useRef<AuthSession | null>(null);
  sessionRef.current = session;
  // Set synchronously at the start of logout() so any revalidation already
  // scheduled (interval tick / visibilitychange) bails out immediately
  // instead of racing a new refresh in after logout begins.
  const loggingOutRef = useRef(false);

  // Mirror the current role to the API client (src/services/api.ts) so its
  // mock-mode `x-mock-role` header reflects the real session.
  useEffect(() => {
    setCurrentMockRole(session?.user.role ?? null);
  }, [session]);

  const revalidate = useCallback(async () => {
    if (loggingOutRef.current) return;
    const outcome = await authService.getSession();
    if (loggingOutRef.current) return;
    // A transient outage (503 / network failure) must NOT be treated as a
    // logout — only a genuine "unauthenticated" result clears the session.
    if (outcome.kind === "outage") return;
    setSession(outcome.kind === "authenticated" ? outcome.session : null);
  }, []);

  // Hydrate session from the BFF on mount
  useEffect(() => {
    let cancelled = false;
    authService.getSession().then((outcome) => {
      if (cancelled) return;
      const saved = outcome.kind === "authenticated" ? outcome.session : null;
      const { session: hydratedSession, isLoading: done } = hydrateState(saved);
      setSession(hydratedSession);
      setIsLoading(done);
    });
    return () => {
      cancelled = true;
    };
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

  // React to a failed refresh-and-retry from the generic API client
  // (src/services/api.ts) — clear local session state so ProtectedRoute
  // redirects to /login.
  useEffect(() => {
    return subscribeAuthFailure(() => {
      setSession(null);
    });
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<LoginResult> => {
    const result = await authService.login(email, password);
    if (result.ok) {
      loggingOutRef.current = false;
      setSession(result.session);
    }
    return result;
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    // Stop revalidation and discard any in-flight refresh BEFORE calling the
    // logout route, so neither can resurrect the access-token cookie after
    // logout's Max-Age=0 clear (see discardInFlightRefresh's own doc comment
    // for why this is a client-side mitigation, not a full guarantee).
    loggingOutRef.current = true;
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
