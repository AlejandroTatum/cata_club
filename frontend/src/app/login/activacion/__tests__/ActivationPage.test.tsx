/**
 * Component tests for the /login/activacion page.
 *
 * Issue #940: the redirect out of this page must obey the backend's own
 * gate decision (`activacionCompleta`), not recompute it from the two raw
 * facts (`correoVerificado`, `altaPresencialCompletada`) — an admin/
 * entrenador without a membership has the facts False but the decision
 * True, and must not stay trapped here.
 *
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import ActivationPage from "@/app/login/activacion/page";

const mockReplace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: vi.fn(),
}));

// Same stub as LoginPage.test.tsx: only the content under test matters here,
// not the shell's own layout.
vi.mock("@/components/auth/AuthShell", async () => ({
  ...(await vi.importActual<typeof import("@/components/auth/AuthShell")>(
    "@/components/auth/AuthShell",
  )),
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { useAuth } from "@/contexts/AuthContext";
import { createAuthenticatedAuth, createMockSession } from "@/components/__tests__/test-utils";

const mockUseAuth = vi.mocked(useAuth);

describe("ActivationPage", () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockUseAuth.mockReset();
  });

  it("redirects an admin whose alta presencial is incomplete to the dashboard when the backend's decision is complete", async () => {
    const session = { ...createMockSession(), altaPresencialCompletada: false, activacionCompleta: true };
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("admin", "Test User", { session }));

    render(<ActivationPage />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/dashboard");
    });
  });

  it("stays on the page and renders the checklist when the decision is incomplete", async () => {
    const session = {
      ...createMockSession({ roles: ["ALUMNO"] }),
      correoVerificado: true,
      altaPresencialCompletada: false,
      activacionCompleta: false,
    };
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("estudiante", "Test User", { session }));

    render(<ActivationPage />);

    expect(await screen.findByRole("list", { name: "Estado de activación" })).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  // Issue reported against staging: a stale token can leave `activacionCompleta`
  // false while both raw facts already read true — the explanatory box below
  // the checklist has nothing left to say in that combination, and used to
  // render anyway as an empty bordered bar with no text inside it.
  it("does not render the empty explanatory box when both facts are already true", async () => {
    const session = {
      ...createMockSession({ roles: ["ALUMNO"] }),
      correoVerificado: true,
      altaPresencialCompletada: true,
      activacionCompleta: false,
    };
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("estudiante", "Test User", { session }));

    const { container } = render(<ActivationPage />);

    await screen.findByRole("list", { name: "Estado de activación" });
    expect(container.querySelector("div.rounded-ctl")).not.toBeInTheDocument();
  });
});
