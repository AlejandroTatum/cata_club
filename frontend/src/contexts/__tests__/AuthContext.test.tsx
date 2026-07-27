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
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockReplace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: vi.fn() }),
}));

const mockLogout = vi.fn(async () => undefined);
const mockGetSession = vi.fn(async () => ({ kind: "unauthenticated" as const }));

vi.mock("@/services/auth", () => ({
  authService: {
    login: vi.fn(),
    logout: () => mockLogout(),
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
