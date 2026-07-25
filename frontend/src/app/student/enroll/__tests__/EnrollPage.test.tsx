/**
 * Component tests for the public enrollment wizard (`/student/enroll`).
 *
 * Covers the two things that only matter once the landing page routes every
 * enrollment CTA here: the demo quick-fill panel must never reach a
 * production build, and the back-link must not send an unauthenticated
 * visitor into the protected `/student` prefix.
 *
 * Mocking pattern mirrors StudentPage.test.tsx (next/link, AuthContext and
 * @/services/api stubbed).
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import EnrollPage from "@/app/student/enroll/page";

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

let mockIsAuthenticated = false;

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    session: null,
    isAuthenticated: mockIsAuthenticated,
    isLoading: false,
    refreshSession: vi.fn(),
  }),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ showError: vi.fn(), showSuccess: vi.fn() }),
}));

vi.mock("@/services/api", () => ({
  enrollStudent: vi.fn(),
}));

vi.mock("@/lib/enrollment-session", () => ({
  clearLegacyEnrollmentSession: vi.fn(),
}));

const DEMO_PANEL_LABEL = /rellenar datos de prueba/i;

beforeEach(() => {
  mockIsAuthenticated = false;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("EnrollPage — demo quick-fill panel", () => {
  it("renders the quick-fill panel outside production", () => {
    vi.stubEnv("NODE_ENV", "development");

    render(<EnrollPage />);

    expect(screen.getByText(DEMO_PANEL_LABEL)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Jugador" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Representante" })).toBeInTheDocument();
  });

  it("does not render the quick-fill panel in a production build", () => {
    vi.stubEnv("NODE_ENV", "production");

    render(<EnrollPage />);

    expect(screen.queryByText(DEMO_PANEL_LABEL)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Jugador" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Representante" })).not.toBeInTheDocument();
  });
});

describe("EnrollPage — back link", () => {
  it("sends an unauthenticated visitor back to the landing page", () => {
    mockIsAuthenticated = false;

    render(<EnrollPage />);

    const link = screen.getByRole("link", { name: /volver al inicio/i });
    expect(link).toHaveAttribute("href", "/");
    expect(screen.queryByRole("link", { name: /volver a mi cuenta/i })).not.toBeInTheDocument();
  });

  it("sends an authenticated user back to their account", () => {
    mockIsAuthenticated = true;

    render(<EnrollPage />);

    const link = screen.getByRole("link", { name: /volver a mi cuenta/i });
    expect(link).toHaveAttribute("href", "/student");
  });
});
