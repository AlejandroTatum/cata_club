/**
 * #1779 S5 (owner decision 2, «Sí, permitir»): a guardian with a blocked child
 * may still enrol someone and add a dependent. The non-payment block only gates
 * the BLOCKED child's own views (home, attendance, medical record); `/student/enroll`
 * is not one of them and must never bounce to Payments.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import EnrollPage from "@/app/student/enroll/page";
import { resetTestHistory, useTestSearchParams } from "@/lib/__tests__/next-navigation-double";

const mockReplace = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/student/enroll",
  useSearchParams: () => useTestSearchParams(),
  useRouter: () => ({ replace: mockReplace, push: vi.fn() }),
}));

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/shell/AppShell", () => ({
  default: ({ title, back, children }: { title: string; back?: React.ReactNode; children: React.ReactNode }) => (
    <div>
      {back}
      <h1>{title}</h1>
      <main>{children}</main>
    </div>
  ),
}));

// A guardian whose portal flags one dependent as blocked. The session itself carries no block.
const mockFetchStudentPortal = vi.fn();
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    session: { user: { id: "9", role: "representante" } },
    isAuthenticated: true,
    isLoading: false,
    refreshSession: vi.fn().mockResolvedValue({ kind: "authenticated" }),
    logout: vi.fn(),
  }),
}));
vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ showError: vi.fn(), showSuccess: vi.fn() }),
}));
vi.mock("@/services/api", () => ({
  enrollStudent: vi.fn(),
  fetchTarifas: vi.fn().mockResolvedValue([]),
  fetchStudentPortal: (personaId: string) => mockFetchStudentPortal(personaId),
}));
vi.mock("@/lib/enrollment-session", () => ({ clearLegacyEnrollmentSession: vi.fn() }));

beforeEach(() => {
  mockReplace.mockReset();
  resetTestHistory("/student/enroll");
  window.sessionStorage.clear();
  mockFetchStudentPortal.mockResolvedValue({
    self: null,
    representados: [
      { personaId: "6", nombres: "Mateo", apellidos: "Alumno", recentSessions: [], membership: null, representante: null, representanteId: 9, bloqueadoPorImpago: true, cubiertoHasta: "2026-09-30" },
    ],
    membershipPlans: [],
  });
});

afterEach(() => {
  cleanup();
  resetTestHistory("/");
  window.sessionStorage.clear();
});

describe("/student/enroll with a blocked child", () => {
  it("opens its signed-in notice, with the way to add a dependent, and never redirects the guardian to Payments", () => {
    render(<EnrollPage />);

    // A signed-in account is not offered the public wizard: it gets this notice (REG-11),
    // whose first action is the add-dependent form.
    expect(screen.getByRole("heading", { level: 1, name: "Ya tienes una sesión iniciada" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Agregar jugador (menor de edad)" })).toHaveAttribute(
      "href",
      "/student/add-dependent",
    );
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
