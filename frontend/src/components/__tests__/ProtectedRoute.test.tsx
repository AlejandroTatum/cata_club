/**
 * Component tests for ProtectedRoute.
 *
 * Covers all four states: loading, unauthenticated, wrong role, and authorized.
 * Uses mocked next/navigation and AuthContext to avoid coupling to the full
 * provider tree.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import ProtectedRoute from "@/components/ProtectedRoute";
import { ToastProvider } from "@/contexts/ToastContext";
import ToastContainer from "@/components/ToastContainer";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockReplace = vi.fn();
const mockRouter = { replace: mockReplace };

vi.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { useAuth } from "@/contexts/AuthContext";
import {
  createUnauthenticatedAuth,
  createAuthenticatedAuth,
  createLoadingAuth,
  createHydrationOutageAuth,
} from "./test-utils";

const mockUseAuth = vi.mocked(useAuth);

const CONTENT = <p>Protected content</p>;

const ROLE_REJECTION_TOAST = "No tiene permiso para acceder a esa sección.";

/**
 * Renders inside a REAL `ToastProvider` (+ `ToastContainer` to surface the
 * live toast text) rather than a mock — `ProtectedRoute` now calls
 * `useToast()` on role rejection, so it needs an actual provider in the tree.
 */
function renderProtected(ui: ReactNode) {
  return render(
    <ToastProvider>
      {ui}
      <ToastContainer />
    </ToastProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ProtectedRoute", () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockUseAuth.mockReset();
    // Default: admin authenticated
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("admin"));
  });

  // --- Loading state ---

  it("shows loading skeleton while session is hydrating", () => {
    mockUseAuth.mockReturnValue(createLoadingAuth());

    renderProtected(
      <ProtectedRoute allowedRoles={["admin"]}>{CONTENT}</ProtectedRoute>,
    );

    expect(screen.getByText("Cargando sesión…")).toBeInTheDocument();
    expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  // --- Hydration outage (DSH-6) ---

  it("does NOT redirect to /login when the initial session check hits an outage", () => {
    mockUseAuth.mockReturnValue(createHydrationOutageAuth());

    renderProtected(
      <ProtectedRoute allowedRoles={["admin"]}>{CONTENT}</ProtectedRoute>,
    );

    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
  });

  it("shows a retry prompt instead of silently doing nothing on outage", () => {
    mockUseAuth.mockReturnValue(createHydrationOutageAuth());

    renderProtected(
      <ProtectedRoute allowedRoles={["admin"]}>{CONTENT}</ProtectedRoute>,
    );

    expect(screen.getByText("No se pudo verificar su sesión")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });

  it("retrying calls retryHydration", () => {
    const retryHydration = vi.fn();
    mockUseAuth.mockReturnValue({ ...createHydrationOutageAuth(), retryHydration });

    renderProtected(
      <ProtectedRoute allowedRoles={["admin"]}>{CONTENT}</ProtectedRoute>,
    );

    screen.getByRole("button", { name: "Reintentar" }).click();
    expect(retryHydration).toHaveBeenCalledTimes(1);
  });

  // --- Unauthenticated ---

  it("redirects unauthenticated users to the default /login", () => {
    mockUseAuth.mockReturnValue(createUnauthenticatedAuth(false));

    renderProtected(
      <ProtectedRoute allowedRoles={["admin"]}>{CONTENT}</ProtectedRoute>,
    );

    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith("/login");
    expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
  });

  it("redirects unauthenticated users to a custom redirectTo", () => {
    mockUseAuth.mockReturnValue(createUnauthenticatedAuth(false));

    renderProtected(
      <ProtectedRoute
        allowedRoles={["admin"]}
        redirectTo="/custom-login"
      >
        {CONTENT}
      </ProtectedRoute>,
    );

    expect(mockReplace).toHaveBeenCalledWith("/custom-login");
  });

  // --- Involuntary session loss names itself (issue #353) ---

  it("names the reason when the bounce follows a failed refresh-and-retry, not an ordinary unauthenticated visit", () => {
    mockUseAuth.mockReturnValue(createUnauthenticatedAuth(false, true));

    renderProtected(
      <ProtectedRoute allowedRoles={["admin"]}>{CONTENT}</ProtectedRoute>,
    );

    expect(mockReplace).toHaveBeenCalledWith("/login?motivo=sesion-expirada");
  });

  it("stays silent for an ordinary unauthenticated visit — nothing expired, there is nothing to explain", () => {
    mockUseAuth.mockReturnValue(createUnauthenticatedAuth(false, false));

    renderProtected(
      <ProtectedRoute allowedRoles={["admin"]}>{CONTENT}</ProtectedRoute>,
    );

    expect(mockReplace).toHaveBeenCalledWith("/login");
  });

  it("carries the reason onto a custom redirectTo too", () => {
    mockUseAuth.mockReturnValue(createUnauthenticatedAuth(false, true));

    renderProtected(
      <ProtectedRoute allowedRoles={["admin"]} redirectTo="/custom-login">
        {CONTENT}
      </ProtectedRoute>,
    );

    expect(mockReplace).toHaveBeenCalledWith("/custom-login?motivo=sesion-expirada");
  });

  // --- Wrong role ---

  it("redirects users with an insufficient role to their default route", () => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("trainer"));

    renderProtected(
      <ProtectedRoute allowedRoles={["admin"]}>{CONTENT}</ProtectedRoute>,
    );

    expect(mockReplace).toHaveBeenCalledWith("/trainer");
    expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
  });

  it("shows an informational toast naming the reason for the bounce on role rejection", () => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("trainer"));

    renderProtected(
      <ProtectedRoute allowedRoles={["admin"]}>{CONTENT}</ProtectedRoute>,
    );

    expect(mockReplace).toHaveBeenCalledWith("/trainer");
    expect(screen.getByText(ROLE_REJECTION_TOAST)).toBeInTheDocument();
  });

  // Issue #484: `/payments` and `/trainer` stacked two identical toasts on a
  // blocked access attempt while `/groups` and `/trainer/students` only ever
  // showed one. Root cause was route-specific, not role-specific — those two
  // pages carried their own leftover "name the reason" effect (issue #319
  // hallazgo #68) that fired the exact same message `ProtectedRoute` already
  // shows on its own, once #421 centralized it here. `ProtectedRoute` itself
  // was never the double-fire: this asserts the container renders exactly one
  // toast node per blocked attempt, however many pages route through here.
  it("renders exactly one toast node per blocked access attempt", () => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("trainer"));

    renderProtected(
      <ProtectedRoute allowedRoles={["admin"]}>{CONTENT}</ProtectedRoute>,
    );

    expect(screen.getAllByText(ROLE_REJECTION_TOAST)).toHaveLength(1);
  });

  it("redirects estudiante to /student when page requires admin", () => {
    mockUseAuth.mockReturnValue(
      createAuthenticatedAuth("estudiante"),
    );

    renderProtected(
      <ProtectedRoute allowedRoles={["admin"]}>{CONTENT}</ProtectedRoute>,
    );

    expect(mockReplace).toHaveBeenCalledWith("/student");
  });

  it("redirects representante to /student when page requires admin", () => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("representante"));

    renderProtected(
      <ProtectedRoute allowedRoles={["admin"]}>{CONTENT}</ProtectedRoute>,
    );

    expect(mockReplace).toHaveBeenCalledWith("/student");
  });

  // --- Unsupported role: authenticated, but no recognized backend role ---

  it("redirects a user with an unsupported role to /unauthorized instead of any real role's page", () => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("unsupported"));

    renderProtected(
      <ProtectedRoute allowedRoles={["admin"]}>{CONTENT}</ProtectedRoute>,
    );

    expect(mockReplace).toHaveBeenCalledWith("/unauthorized");
    expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
  });

  it("the /unauthorized page itself renders for an unsupported-role user (terminates the redirect chain)", () => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("unsupported"));

    renderProtected(
      <ProtectedRoute allowedRoles={["unsupported"]}>{CONTENT}</ProtectedRoute>,
    );

    expect(screen.getByText("Protected content")).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("a real-role user who navigates to /unauthorized directly is bounced to their own default route, not shown the forbidden page", () => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("admin"));

    renderProtected(
      <ProtectedRoute allowedRoles={["unsupported"]}>{CONTENT}</ProtectedRoute>,
    );

    expect(mockReplace).toHaveBeenCalledWith("/dashboard");
    expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
  });

  // --- Authorized ---

  it("renders children when the user has an allowed role", () => {
    renderProtected(
      <ProtectedRoute allowedRoles={["admin"]}>{CONTENT}</ProtectedRoute>,
    );

    expect(screen.getByText("Protected content")).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("accepts multiple allowed roles and renders for any match", () => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("trainer"));

    renderProtected(
      <ProtectedRoute allowedRoles={["admin", "trainer"]}>
        {CONTENT}
      </ProtectedRoute>,
    );

    expect(screen.getByText("Protected content")).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("renders nothing while in redirect transition for unauthenticated users", () => {
    mockUseAuth.mockReturnValue(createUnauthenticatedAuth(false));

    const { container } = renderProtected(
      <ProtectedRoute allowedRoles={["admin"]}>{CONTENT}</ProtectedRoute>,
    );

    // Component returns null — container should be empty
    expect(container.textContent).toBe("");
  });

  it("renders nothing while in redirect transition for wrong-role users", () => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("trainer"));

    renderProtected(
      <ProtectedRoute allowedRoles={["admin"]}>{CONTENT}</ProtectedRoute>,
    );

    // Component's own children slot renders nothing — the only text in the
    // tree is the role-rejection toast, not the protected content.
    expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
  });

  // --- Boundary: empty allowed roles ---

  it("redirects when allowedRoles is empty even for an authorized role", () => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("admin"));

    renderProtected(
      <ProtectedRoute allowedRoles={[]}>{CONTENT}</ProtectedRoute>,
    );

    // canAccess("admin", []) returns false → redirect to admin default
    expect(mockReplace).toHaveBeenCalledWith("/dashboard");
  });
});
