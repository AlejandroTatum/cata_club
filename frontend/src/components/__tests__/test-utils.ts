/**
 * Shared test utilities for component tests.
 *
 * Provides typed mock session factories and reusable test doubles so each
 * test file can focus on scenario logic rather than boilerplate.
 */

import type { AuthSession } from "@/services/auth";
import type { BackendTipoRol, UserRole, Usuario } from "@/types/domain";
import type { AuthContextValue } from "@/contexts/AuthContext";
import { backendRoleForUserRole } from "@/lib/auth-utils";
import { vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock session factories
// ---------------------------------------------------------------------------

/**
 * Build a lightweight AuthSession suitable for component tests.
 * All fields are populated with sensible defaults — override as needed.
 */
export function createMockSession(
  overrides?: Partial<AuthSession>,
): AuthSession {
  return {
    user: {
      id: "user-test-1",
      name: "Test User",
      email: "test@cataclub.com",
      role: "admin",
      representanteId: null,
      createdAt: "2026-01-01T00:00:00Z",
    },
    roles: ["ADMINISTRADOR"],
    loggedInAt: "2026-07-01T12:00:00Z",
    ...overrides,
  };
}

/**
 * Build a `Usuario` for the given role — handles the discriminated union so
 * callers don't need to know that "estudiante" carries extra required fields.
 */
function buildUser(role: UserRole, id: string, name: string, email: string): Usuario {
  const base = {
    id,
    name,
    email,
    representanteId: null,
    createdAt: "2026-01-01T00:00:00Z",
  };
  if (role === "estudiante") {
    return { ...base, role, activo: true };
  }
  return { ...base, role };
}

// ---------------------------------------------------------------------------
// AuthContext mock values
// ---------------------------------------------------------------------------

/**
 * Build an AuthContextValue for the unauthenticated / loading state.
 */
export function createUnauthenticatedAuth(
  isLoading = false,
): AuthContextValue {
  return {
    session: null,
    isAuthenticated: false,
    isLoading,
    login: vi.fn(),
    logout: vi.fn(),
    refreshSession: vi.fn(),
    hydrationOutage: false,
    retryHydration: vi.fn(),
  };
}

/**
 * Build an AuthContextValue for an authenticated user with the given role.
 */
export function createAuthenticatedAuth(
  role: UserRole = "admin",
  name = "Test User",
  overrides?: Partial<AuthContextValue>,
): AuthContextValue {
  // `roles` is DERIVED, never left at the factory's admin default: a session
  // whose `user.role` is "trainer" while `roles` still says ADMINISTRADOR is a
  // session `buildSession` (src/lib/server/auth.ts) cannot produce — it reads
  // the primary role OFF that array. The rail now reads the array too, so a
  // fixture that disagreed with itself would have made every non-admin role
  // render the admin sections.
  const backendRole = backendRoleForUserRole(role);
  const session = createMockSession({
    user: buildUser(role, `user-${role}-1`, name, `${role}@cataclub.com`),
    // "unsupported" maps from no backend role at all — an account whose roles
    // the frontend does not recognise. An empty array is exactly that state.
    roles: backendRole === null ? [] : [backendRole],
  });

  return {
    session,
    isAuthenticated: true,
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
    refreshSession: vi.fn(),
    hydrationOutage: false,
    retryHydration: vi.fn(),
    ...overrides,
  };
}

/**
 * Build an AuthContextValue for an account that holds SEVERAL backend roles —
 * a representante who also plays (18 of them exist), a trainer who also plays.
 *
 * `primary` is stated rather than derived on purpose. The collapse lives in
 * `pickPrimaryRole` (src/lib/server/auth.ts), which is server-only and which
 * this change does not touch; a fixture that re-implemented its precedence
 * would be a second copy of a rule with one owner. Stating it also keeps the
 * two halves of the session visible side by side: `user.role` is what guards
 * and redirects still gate on, `roles` is what the rail draws.
 */
export function createMultiRoleAuth(
  backendRoles: readonly BackendTipoRol[],
  primary: UserRole,
  name = "Test User",
): AuthContextValue {
  const session = createMockSession({
    user: buildUser(primary, `user-${primary}-multi`, name, `${primary}@cataclub.com`),
    roles: [...backendRoles],
  });

  return {
    session,
    isAuthenticated: true,
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
    refreshSession: vi.fn(),
    hydrationOutage: false,
    retryHydration: vi.fn(),
  };
}

/**
 * Build an AuthContextValue for the loading / hydrating state.
 */
export function createLoadingAuth(): AuthContextValue {
  return {
    session: null,
    isAuthenticated: false,
    isLoading: true,
    login: vi.fn(),
    logout: vi.fn(),
    refreshSession: vi.fn(),
    hydrationOutage: false,
    retryHydration: vi.fn(),
  };
}

/**
 * Build an AuthContextValue for the DSH-6 hydration-outage state: the
 * initial session check failed with a network/5xx outage, so there is no
 * verdict on whether the user is authenticated yet.
 */
export function createHydrationOutageAuth(): AuthContextValue {
  return {
    session: null,
    isAuthenticated: false,
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
    refreshSession: vi.fn(),
    hydrationOutage: true,
    retryHydration: vi.fn(),
  };
}
