/**
 * Component tests for DashboardPage's "Atención" alert indicator.
 *
 * A contrast scan reported the "Atención" label as 2.93:1 (#1F2937 on the
 * #D92128 dot). That measurement is an artifact: the label is `sr-only`, so
 * it is clipped to a 1px box and never painted — there is no visible text to
 * fail WCAG 1.4.3 on. The real defect the scan surfaced is the opposite one:
 * the label sat INSIDE an `aria-hidden="true"` element, so the alert state
 * was announced to nobody either. Visual users saw a red dot; screen-reader
 * users got silence.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import DashboardPage from "@/app/dashboard/page";

vi.mock("@/components/ProtectedRoute", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/shell/AppShell", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("./AttendanceStatusChart", () => ({
  __esModule: true,
  default: () => <div />,
}));

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const mockFetchDashboardStats = vi.fn();
const mockFetchAttendanceRecords = vi.fn();

vi.mock("@/services/api", () => ({
  fetchDashboardStats: () => mockFetchDashboardStats(),
  fetchAttendanceRecords: (params?: unknown) => mockFetchAttendanceRecords(params),
}));

/** `pendingPayments > 0` is what flips a stat card into the "alert" trend. */
function statsWithPendingPayments(pendingPayments: number): Record<string, number> {
  return { totalPersonas: 12, pendingPayments, todaySchedules: 3 };
}

describe("DashboardPage — 'Atención' alert indicator", () => {
  beforeEach(() => {
    mockFetchDashboardStats.mockReset();
    mockFetchAttendanceRecords.mockReset().mockResolvedValue([]);
  });

  it("announces the alert state instead of burying the label inside an aria-hidden dot", async () => {
    mockFetchDashboardStats.mockResolvedValue(statsWithPendingPayments(4));

    render(<DashboardPage />);

    const label = await screen.findByText("Atención");
    // The label must not have an aria-hidden ancestor, or assistive tech
    // never reaches it — the exact bug this test pins.
    expect(label.closest("[aria-hidden='true']")).toBeNull();
  });

  it("keeps the red dot itself decorative, since the text carries the meaning", async () => {
    mockFetchDashboardStats.mockResolvedValue(statsWithPendingPayments(4));

    render(<DashboardPage />);
    await screen.findByText("Atención");

    const dot = document.querySelector(".bg-cata-red.rounded-full") as HTMLElement;
    expect(dot).not.toBeNull();
    expect(dot).toHaveAttribute("aria-hidden", "true");
    // The dot is a pure shape — no text node of its own to be measured for
    // contrast against its own fill.
    expect(dot.textContent).toBe("");
  });

  it("shows no alert indicator when nothing needs attention", async () => {
    mockFetchDashboardStats.mockResolvedValue(statsWithPendingPayments(0));

    render(<DashboardPage />);

    await waitFor(() => expect(screen.getByText("Pagos Pendientes de Validar")).toBeInTheDocument());
    expect(screen.queryByText("Atención")).not.toBeInTheDocument();
  });
});
