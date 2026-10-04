/**
 * The enrollment page frame is a full-height split from `lg`: a coal brand
 * panel (way out, title, vertical steps, live summary) beside the
 * form. Below `lg` the panel is a compact header and the compact `Stepper`
 * sits above the form. `matchMedia` decides which one renders — jsdom has none,
 * so the other test files exercise the narrow layout.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import EnrollPage from "@/app/student/enroll/page";
import { resetTestHistory, useTestSearchParams } from "@/lib/__tests__/next-navigation-double";
import { fetchTarifas } from "@/services/api";

vi.mock("next/navigation", () => ({
  usePathname: () => "/student/enroll",
  useSearchParams: () => useTestSearchParams(),
}));

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    session: null,
    isAuthenticated: false,
    isLoading: false,
    refreshSession: vi.fn().mockResolvedValue({ kind: "authenticated" }),
  }),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ showError: vi.fn(), showSuccess: vi.fn() }),
}));

vi.mock("@/services/api", () => ({
  enrollStudent: vi.fn(),
  fetchTarifas: vi.fn(),
  fetchTiposMembresia: vi.fn(),
}));

vi.mock("@/lib/enrollment-session", () => ({
  clearLegacyEnrollmentSession: vi.fn(),
}));

function mockWide(matches: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

beforeEach(() => {
  resetTestHistory("/student/enroll");
  window.sessionStorage.clear();
  vi.mocked(fetchTarifas).mockResolvedValue([{ categoria: "Categoria Test A", precio: "12.50" }]);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetTestHistory("/");
  window.sessionStorage.clear();
  vi.clearAllMocks();
});

describe("EnrollPage — split frame from lg", () => {
  it("puts the vertical steps and the summary in the coal panel and the tariffs in the card", async () => {
    mockWide(true);
    render(<EnrollPage />);

    const panel = screen.getByTestId("enroll-brand-panel");
    const steps = within(panel).getByRole("list", { name: /pasos de la inscripción/i });
    expect(within(steps).getAllByRole("listitem")).toHaveLength(4);
    expect(within(steps).getByText("Tipo")).toHaveAttribute("data-state", "current");
    expect(within(panel).getByRole("complementary", { name: /resumen/i })).toBeInTheDocument();
    const tariff = await screen.findByText("Categoria Test A");
    expect(panel).not.toContainElement(tariff);
    expect(screen.getByTestId("enroll-wizard-card")).toContainElement(tariff);
    expect(screen.getByTestId("enroll-nav")).toHaveAttribute("data-enroll-nav");
    expect(screen.getByTestId("enroll-wizard-card")).toContainElement(screen.getByTestId("enroll-nav"));
    // One list of steps only: no compact stepper beside the form.
    expect(screen.getAllByRole("list", { name: /pasos de la inscripción/i })).toHaveLength(1);
    expect(screen.getByTestId("enroll-nav")).not.toContainElement(steps);
  });

  it("marks the current step with aria-current and lets a done step jump back", () => {
    mockWide(true);
    render(<EnrollPage />);
    fireEvent.click(screen.getByRole("button", { name: /^Siguiente/ }));

    const steps = screen.getByRole("list", { name: /pasos de la inscripción/i });
    expect(within(steps).getByText("Jugador").closest("li")).toHaveAttribute(
      "aria-current",
      "step",
    );
    fireEvent.click(within(steps).getByRole("button", { name: /Tipo/ }));
    expect(within(steps).getByText("Tipo").closest("li")).toHaveAttribute("aria-current", "step");
  });

  it("keeps the compact stepper in the card nav and the tariffs under the choices when narrow", async () => {
    mockWide(false);
    render(<EnrollPage />);

    const panel = screen.getByTestId("enroll-brand-panel");
    expect(within(panel).queryByRole("list", { name: /pasos de la inscripción/i })).toBeNull();
    expect(screen.getByTestId("enroll-nav")).toContainElement(
      screen.getByRole("list", { name: /pasos de la inscripción/i }),
    );
    const tariff = await screen.findByText("Categoria Test A");
    expect(screen.getByTestId("enroll-wizard-card")).toContainElement(tariff);
    expect(panel).not.toContainElement(tariff);
  });
});
