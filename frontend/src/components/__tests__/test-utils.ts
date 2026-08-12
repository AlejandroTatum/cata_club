/**
 * Shared test utilities for component tests.
 *
 * Provides typed mock session factories and reusable test doubles so each
 * test file can focus on scenario logic rather than boilerplate.
 */

import type { AuthSession } from "@/services/auth";
import type { UserRole, Usuario } from "@/types/domain";
import type { AuthContextValue } from "@/contexts/AuthContext";
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
  const session = createMockSession({
    user: buildUser(role, `user-${role}-1`, name, `${role}@cataclub.com`),
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
