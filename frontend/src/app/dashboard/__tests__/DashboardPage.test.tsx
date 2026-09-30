/**
 * Component tests for the redesigned DashboardPage ("la jornada").
 *
 * The three things this page must not regress on:
 *   1. the hero states the priority as TEXT — the previous version buried the
 *      alert label inside an `aria-hidden` dot, so visual users saw a red dot
 *      and screen-reader users got silence;
 *   2. "Acciones Rápidas" stays deleted — four cards duplicating four sidebar
 *      links were the audit's central finding about this screen;
 *   3. the activity feed is derived from data that already loads, and simply
 *      does not render when there is nothing to derive.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import DashboardPage from "@/app/dashboard/page";
import type { PaymentValidationRequest } from "@/services/api";
import type { AttendanceRecord } from "@/app/attendance/attendance-utils";
import { clubIsoDate } from "@/lib/club-date";
import { PAGE_RAIL } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { createAuthenticatedAuth, createLoadingAuth } from "@/components/__tests__/test-utils";

const mockUseAuth = vi.mocked(useAuth);

vi.mock("@/components/ProtectedRoute", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: vi.fn(),
}));

// Renders `actions` as well as `children`. The double used to take only
// `children`, so it silently swallowed a whole slot of the real component's
// contract: a screen could move its primary action into the header and every
// assertion about that action would go red for a reason that had nothing to do
// with the screen. A stub may be smaller than the thing it stands in for; it
// may not answer differently.
vi.mock("@/components/shell/AppShell", () => ({
  __esModule: true,
  default: ({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) => (
    <div>
      {actions}
      {children}
    </div>
  ),
}));

vi.mock("../AttendanceStatusChart", () => ({
  __esModule: true,
  default: () => <div data-testid="attendance-donut" />,
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
const mockFetchPaymentValidations = vi.fn();

vi.mock("@/services/api", () => ({
  fetchDashboardStats: () => mockFetchDashboardStats(),
  fetchAttendanceRecords: (params?: unknown) => mockFetchAttendanceRecords(params),
  fetchPaymentValidations: () => mockFetchPaymentValidations(),
  fetchTrainingSchedules: () => Promise.resolve([]),
  fetchRosterDeTodosLosHorarios: () => Promise.resolve([]),
}));

// `totalPersonas` and `totalAlumnos` differ on purpose, and every assertion
// below reads one or the other. A fixture where they were equal would let the
// page read either field and stay green — the exact defect this suite locks.
function statsFixture(overrides: Partial<Record<string, number>> = {}): Record<string, number> {
  return {
    totalPersonas: 44,
    totalAlumnos: 40,
    activeMemberships: 17,
    pendingPayments: 14,
    todaySchedules: 3,
    ...overrides,
  };
}

/** A pending payment uploaded `daysAgo` days before now. */
function pendingPayment(id: string, daysAgo: number): PaymentValidationRequest {
  return {
    id,
    studentName: "Sofia Vera",
    responsablePagoName: "Laura Vera",
    membershipPeriod: "01/07/2026 – 12/08/2026",
    membershipType: "Mensual",
    expectedAmount: 25,
    paymentMethod: "Transferencia",
    uploadedAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
    currentMembershipStatus: "vencida",
    proofFileType: "image",
    validationStatus: "pendiente",
    startDate: "2026-07-01",
    endDate: "2026-08-12",
  };
}

/** A payment already resolved (validated or rejected) `daysAgo` days ago. */
function resolvedPayment(
  id: string,
  status: "validado" | "rechazado",
  daysAgo = 0,
): PaymentValidationRequest {
  return {
    ...pendingPayment(id, daysAgo + 1),
    validationStatus: status,
    validatedAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
  };
}

function todayRecord(id: string): AttendanceRecord {
  // The club's today, not the runner's: `buildFourWeekAttendance` buckets its
  // windows in club time, so a date built from local components lands outside
  // the newest bar on any machine far enough from Ecuador.
  return {
    id,
    fecha: clubIsoDate(),
    horario: "Lunes 15:00 — 16:00",
    horarioId: 1,
    personaId: Number(id.replace(/\D/g, "")) || 1,
    estudiante: `Estudiante ${id}`,
    estado: "present",
  };
}

beforeEach(() => {
  mockFetchDashboardStats.mockReset().mockResolvedValue(statsFixture());
  mockFetchAttendanceRecords.mockReset().mockResolvedValue([]);
  mockFetchPaymentValidations.mockReset().mockResolvedValue([]);
  mockUseAuth.mockReset().mockReturnValue(createAuthenticatedAuth("admin"));
});

// ---------------------------------------------------------------------------
// 1. The hero
// ---------------------------------------------------------------------------

describe("DashboardPage — the attention strip carries the count and its action", () => {
  it("points the row's action at the payment queue", async () => {
    render(<DashboardPage />);

    expect(await screen.findByRole("link", { name: /^revisar ahora/i })).toHaveAttribute(
      "href",
      "/payments",
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Quick actions are gone
// ---------------------------------------------------------------------------

describe("DashboardPage — the sidebar's table of contents is gone", () => {
  it("no longer renders the Acciones Rápidas block", async () => {
    render(<DashboardPage />);
    await screen.findByText("Miembros");

    expect(screen.queryByText(/acciones r[áa]pidas/i)).not.toBeInTheDocument();
  });

});

// ---------------------------------------------------------------------------
// 3. The pulse
// ---------------------------------------------------------------------------

describe("DashboardPage — the three-stat pulse", () => {
  it("shows members, active memberships against the alumnos, and the 4-week rate", async () => {
    mockFetchAttendanceRecords.mockResolvedValue([todayRecord("1"), todayRecord("2")]);

    render(<DashboardPage />);

    // Two records this week, both present → 100%. Awaited rather than read
    // synchronously after "Miembros": the page runs two independent fetches,
    // and "Miembros" only proves the STATS one resolved. The rate comes from
    // the attendance fetch, which can land a commit later — with no records the
    // tile reads "0". Waiting for "100" waits for both, since the whole pulse
    // stays behind the loading state until the stats are in.
    expect(await screen.findByText("100")).toBeInTheDocument();
    expect(screen.getByText("Miembros")).toBeInTheDocument();
    expect(screen.getByText("Membresías activas")).toBeInTheDocument();
    expect(screen.getByText("de 40")).toBeInTheDocument();
    expect(screen.getByText("Asistencia · 4 semanas")).toBeInTheDocument();
  });

  /**
   * The half of #150 that never reached the screen.
   *
   * The backend grew `total_alumnos` alongside `total_personas` precisely
   * because the pulse asks two different questions: how many people are
   * registered, and how many of the people who CAN hold a membership hold an
   * active one. Administradores and entrenadores are in the first number and
   * never in the second, so reusing `totalPersonas` as the denominator
   * understates the ratio for as long as any staff account exists.
   */
});

// ---------------------------------------------------------------------------
// 4. Activity feed and donut
// ---------------------------------------------------------------------------

describe("DashboardPage — actividad reciente", () => {
  it("derives the feed from the payments and attendance already loaded", async () => {
    mockFetchPaymentValidations.mockResolvedValue([pendingPayment("a", 1)]);
    mockFetchAttendanceRecords.mockResolvedValue([todayRecord("1"), todayRecord("2")]);

    render(<DashboardPage />);

    // Wait for a ROW, not for "Actividad reciente": the heading is part of the
    // card's frame and is painted on the first render, empty feed or not, so it
    // is satisfied before either fetch resolves and the reads below then run
    // against the empty state. The rows are what the data produces.
    expect(await screen.findByText(/subió un comprobante de \$25,00/)).toBeInTheDocument();
    // Synchronous on purpose: both rows come out of the same `Promise.allSettled`
    // continuation, which sets records and payments in one React commit.
    expect(screen.getByText(/lista registrada · 2 estudiantes/)).toBeInTheDocument();
    expect(screen.getByText("Actividad reciente")).toBeInTheDocument();
  });

  it("caps the feed so it cannot dominate the page", async () => {
    mockFetchAttendanceRecords.mockResolvedValue([]);
    mockFetchPaymentValidations.mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => pendingPayment(`p${i}`, i + 1)),
    );

    render(<DashboardPage />);

    const feed = await screen.findByTestId("activity-feed");
    // The card renders unconditionally, so `findByTestId` above resolves on the
    // empty state too — and `getAllByRole` THROWS when it matches nothing. Wait
    // for the list itself, which replaces the empty state only once there is
    // something to list; its items all arrive in that same commit.
    await within(feed).findByRole("list");
    expect(within(feed).getAllByRole("listitem").length).toBeLessThanOrEqual(10);
  });

  it("says there is nothing yet, instead of unmounting and leaving a hole", async () => {
    // It used to unmount. On a fresh install that left a hero, four zeroes and
    // ~600px of nothing — with no way to tell "no activity yet" apart from
    // "this page is broken". A section that disappears answers neither.
    render(<DashboardPage />);

    expect(await screen.findByText("Todavía no hay movimiento")).toBeInTheDocument();
    expect(screen.getByText("Actividad reciente")).toBeInTheDocument();
    // An empty state without a next action is a dead end.
    expect(screen.getByRole("link", { name: /pasar lista/i })).toHaveAttribute(
      "href",
      "/trainer/attendance",
    );
  });

  it("holds the two-column row whether or not either card has data", async () => {
    // The split used to depend on both cards having data, so the layout moved
    // under the admin as records arrived.
    render(<DashboardPage />);
    await screen.findByText("Miembros");

    // `PAGE_RAIL`, not a literal: the dashboard used to write its own 16px gap
    // and its own `minmax(0,340px)` track, one of the six spellings #36 found.
    // Each column stacks its own blocks, so neither is stretched to the other.
    expect(screen.getByTestId("dashboard-work").className).toBe(PAGE_RAIL);
    for (const id of ["dashboard-main", "dashboard-rail"]) {
      expect(screen.getByTestId(id).className).toContain("flex-col");
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Activity feed — event type markers (A5)
// ---------------------------------------------------------------------------

describe("DashboardPage — actividad reciente marks each event type", () => {
  it("marks a validated payment ok and names it for assistive tech", async () => {
    mockFetchPaymentValidations.mockResolvedValue([resolvedPayment("a", "validado")]);

    render(<DashboardPage />);

    const marker = await screen.findByTestId("activity-marker-payment-validated");
    expect(marker.className).toContain("text-state-ok");
    expect(screen.getByText(/^Pago validado/)).toBeInTheDocument();
  });

  it("marks a rejected payment bad — the one type meant to stand out while scanning", async () => {
    mockFetchPaymentValidations.mockResolvedValue([resolvedPayment("a", "rechazado")]);

    render(<DashboardPage />);

    const marker = await screen.findByTestId("activity-marker-payment-rejected");
    expect(marker.className).toContain("text-state-bad");
    expect(screen.getByText(/^Pago rechazado/)).toBeInTheDocument();
  });

  it("marks an attendance session neutral", async () => {
    mockFetchAttendanceRecords.mockResolvedValue([todayRecord("1")]);

    render(<DashboardPage />);

    const marker = await screen.findByTestId("activity-marker-attendance-session");
    expect(marker.className).toContain("text-state-neutral");
    expect(screen.getByText(/^Asistencia:/)).toBeInTheDocument();
  });

  it("marks an uploaded payment neutral — it has not been resolved yet", async () => {
    mockFetchPaymentValidations.mockResolvedValue([pendingPayment("a", 1)]);

    render(<DashboardPage />);

    const marker = await screen.findByTestId("activity-marker-payment-uploaded");
    expect(marker.className).toContain("text-state-neutral");
    expect(screen.getByText(/^Comprobante subido/)).toBeInTheDocument();
  });

  it("keeps the feed's newest-first order unchanged", async () => {
    mockFetchPaymentValidations.mockResolvedValue([
      resolvedPayment("old", "validado", 5),
      resolvedPayment("new", "rechazado", 0),
    ]);

    render(<DashboardPage />);

    const feed = await screen.findByTestId("activity-feed");
    const rows = await within(feed).findAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByTestId("activity-marker-payment-rejected")).toBeInTheDocument();
    expect(within(rows[1]).getByTestId("activity-marker-payment-validated")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Degraded loads
// ---------------------------------------------------------------------------

describe("DashboardPage — degraded loads", () => {
  it("still renders the pulse when the secondary lists fail", async () => {
    mockFetchAttendanceRecords.mockRejectedValue(new Error("boom"));
    mockFetchPaymentValidations.mockRejectedValue(new Error("boom"));

    render(<DashboardPage />);

    expect(await screen.findByText("Miembros")).toBeInTheDocument();
    // The card stays and SAYS it failed. A secondary list that failed and a
    // club with no activity yet used to look the same; now the failure has its
    // own words and the "no movement" empty state is reserved for the real thing.
    const feed = await screen.findByTestId("activity-feed");
    expect(await within(feed).findByText(/no se pudo cargar/i)).toBeInTheDocument();
    expect(within(feed).queryByText("Todavía no hay movimiento")).toBeNull();
  });

  it("offers a retry when the stats themselves fail", async () => {
    mockFetchDashboardStats.mockRejectedValue(new Error("boom"));

    render(<DashboardPage />);

    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /reintentar/i }).length).toBeGreaterThan(0),
    );
    expect(screen.getAllByText(/no se pudieron cargar las estadísticas/i).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Role-gated fetch (issue #319 hallazgo #49).
//
// `loadStats`/`loadDetail` ran from a bare mount effect, so a non-admin
// (e.g. a student landing on /dashboard) fired GET /api/dashboard,
// GET /api/attendance/records and GET /api/payments and logged three 403s
// before ProtectedRoute's redirect effect ran. ProtectedRoute is mocked to a
// pass-through here so the fetch gate itself is what is under test.
// ---------------------------------------------------------------------------

describe("DashboardPage — defers admin API calls until the role resolves", () => {
  it("does not request dashboard data while the session is still hydrating", async () => {
    mockUseAuth.mockReturnValue(createLoadingAuth());

    render(<DashboardPage />);

    await waitFor(() => expect(mockFetchDashboardStats).not.toHaveBeenCalled());
    expect(mockFetchAttendanceRecords).not.toHaveBeenCalled();
    expect(mockFetchPaymentValidations).not.toHaveBeenCalled();
  });

  it("does not request dashboard data for a resolved non-admin role", async () => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("estudiante"));

    render(<DashboardPage />);

    await waitFor(() => expect(mockFetchDashboardStats).not.toHaveBeenCalled());
    expect(mockFetchAttendanceRecords).not.toHaveBeenCalled();
    expect(mockFetchPaymentValidations).not.toHaveBeenCalled();
  });

  it("requests dashboard data once the admin role has resolved", async () => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("admin"));

    render(<DashboardPage />);

    await waitFor(() => expect(mockFetchDashboardStats).toHaveBeenCalled());
    expect(mockFetchAttendanceRecords).toHaveBeenCalled();
    expect(mockFetchPaymentValidations).toHaveBeenCalled();
  });
});
