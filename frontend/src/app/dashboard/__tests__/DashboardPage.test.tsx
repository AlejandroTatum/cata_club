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

vi.mock("@/components/ProtectedRoute", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/shell/AppShell", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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
}));

function statsFixture(overrides: Partial<Record<string, number>> = {}): Record<string, number> {
  return {
    totalPersonas: 44,
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
    proofFileName: "comprobante.png",
    proofFileType: "image",
    validationStatus: "pendiente",
    startDate: "2026-07-01",
    endDate: "2026-08-12",
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
    personaId: Number(id.replace(/\D/g, "")) || 1,
    estudiante: `Estudiante ${id}`,
    estado: "present",
    entrenador: "Carlos Mendoza",
  };
}

beforeEach(() => {
  mockFetchDashboardStats.mockReset().mockResolvedValue(statsFixture());
  mockFetchAttendanceRecords.mockReset().mockResolvedValue([]);
  mockFetchPaymentValidations.mockReset().mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// 1. The hero
// ---------------------------------------------------------------------------

describe("DashboardPage — the hero carries one number and one action", () => {
  it("states the pending payment count and the ageing sub-line as real text", async () => {
    mockFetchPaymentValidations.mockResolvedValue([
      pendingPayment("a", 10),
      pendingPayment("b", 9),
      pendingPayment("c", 1),
    ]);

    render(<DashboardPage />);

    expect(await screen.findByText("14")).toBeInTheDocument();
    const ageing = await screen.findByText("2 llevan más de una semana esperando");
    // The old alert label sat inside an `aria-hidden` element, so assistive
    // tech never reached it. This one must stay reachable.
    expect(ageing.closest("[aria-hidden='true']")).toBeNull();
  });

  it("stays quiet instead of spending the hero on a negative", async () => {
    mockFetchPaymentValidations.mockResolvedValue([pendingPayment("a", 1)]);

    render(<DashboardPage />);

    await screen.findByText("14");
    // "Ninguno lleva más de una semana esperando" is dead weight in the most
    // valuable space on the screen: the sub-line earns its place or is absent.
    expect(screen.queryByText(/ninguno lleva/i)).toBeNull();
    expect(screen.queryByTestId("hero-note")).toBeNull();
  });

  it("switches the call to action when the queue is empty", async () => {
    mockFetchDashboardStats.mockResolvedValue(statsFixture({ pendingPayments: 0 }));

    render(<DashboardPage />);

    const link = await screen.findByRole("link", { name: /ver pagos/i });
    expect(link).toHaveAttribute("href", "/payments");
    expect(screen.getByText("La cola está al día")).toBeInTheDocument();
  });

  it("points the primary action at the payment queue", async () => {
    render(<DashboardPage />);

    expect(await screen.findByRole("link", { name: /revisar ahora/i })).toHaveAttribute(
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

  it("keeps no duplicate navigation to sections the sidebar already owns", async () => {
    render(<DashboardPage />);
    await screen.findByText("Miembros");

    for (const href of ["/members", "/ranking"]) {
      expect(document.querySelector(`a[href="${href}"]`)).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// 3. The pulse
// ---------------------------------------------------------------------------

describe("DashboardPage — the three-stat pulse", () => {
  it("shows members, active memberships against the total, and the 4-week rate", async () => {
    mockFetchAttendanceRecords.mockResolvedValue([todayRecord("1"), todayRecord("2")]);

    render(<DashboardPage />);

    expect(await screen.findByText("Miembros")).toBeInTheDocument();
    expect(screen.getByText("Membresías activas")).toBeInTheDocument();
    expect(screen.getByText("de 44")).toBeInTheDocument();
    expect(screen.getByText("Asistencia · 4 semanas")).toBeInTheDocument();
    // Two records this week, both present → 100%.
    expect(screen.getByText("100")).toBeInTheDocument();
  });

  it("gives all three tiles the same internal grammar: label, figure, caption", async () => {
    mockFetchAttendanceRecords.mockResolvedValue([todayRecord("1"), todayRecord("2")]);

    render(<DashboardPage />);

    await screen.findByText("Miembros");
    // A caption, a progress bar and four sparkbars side by side read as three
    // unrelated things rather than one pulse. Every tile now closes on a plain
    // caption line — and the caption says what the widget only gestured at.
    expect(screen.queryByRole("img", { name: /asistencia por semana/i })).toBeNull();
    expect(screen.getByText("personas registradas")).toBeInTheDocument();
    expect(screen.getByText("39% de las personas registradas")).toBeInTheDocument();
    expect(screen.getByText("2 de 2 presentes")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 4. Activity feed and donut
// ---------------------------------------------------------------------------

describe("DashboardPage — actividad reciente", () => {
  it("derives the feed from the payments and attendance already loaded", async () => {
    mockFetchPaymentValidations.mockResolvedValue([pendingPayment("a", 1)]);
    mockFetchAttendanceRecords.mockResolvedValue([todayRecord("1"), todayRecord("2")]);

    render(<DashboardPage />);

    expect(await screen.findByText("Actividad reciente")).toBeInTheDocument();
    expect(screen.getByText(/subió un comprobante de \$25,00/)).toBeInTheDocument();
    expect(screen.getByText(/registró la lista de Lunes 15:00 — 16:00 · 2 estudiantes/)).toBeInTheDocument();
  });

  it("caps the feed so it cannot dominate the page", async () => {
    mockFetchAttendanceRecords.mockResolvedValue([]);
    mockFetchPaymentValidations.mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => pendingPayment(`p${i}`, i + 1)),
    );

    render(<DashboardPage />);

    const feed = await screen.findByTestId("activity-feed");
    expect(within(feed).getAllByRole("listitem").length).toBeLessThanOrEqual(5);
  });

  it("groups the feed and the donut side by side instead of stacking full-width cards", async () => {
    mockFetchAttendanceRecords.mockResolvedValue([todayRecord("1")]);
    mockFetchPaymentValidations.mockResolvedValue([pendingPayment("a", 1)]);

    render(<DashboardPage />);

    const lower = await screen.findByTestId("dashboard-lower");
    expect(within(lower).getByTestId("activity-feed")).toBeInTheDocument();
    expect(within(lower).getByTestId("attendance-donut")).toBeInTheDocument();
  });

  it("omits the card entirely when there is nothing to show", async () => {
    render(<DashboardPage />);
    await screen.findByText("Miembros");

    expect(screen.queryByText("Actividad reciente")).not.toBeInTheDocument();
  });

  it("keeps the attendance donut, and only when there are records", async () => {
    mockFetchAttendanceRecords.mockResolvedValue([todayRecord("1")]);
    render(<DashboardPage />);

    expect(await screen.findByTestId("attendance-donut")).toBeInTheDocument();
  });

  it("does not render the donut without any attendance data", async () => {
    render(<DashboardPage />);
    await screen.findByText("Miembros");

    expect(screen.queryByTestId("attendance-donut")).not.toBeInTheDocument();
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
    expect(screen.queryByText("Actividad reciente")).not.toBeInTheDocument();
  });

  it("offers a retry when the stats themselves fail", async () => {
    mockFetchDashboardStats.mockRejectedValue(new Error("boom"));

    render(<DashboardPage />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /reintentar/i })).toBeInTheDocument(),
    );
    expect(screen.getAllByText(/no se pudieron cargar las estadísticas/i).length).toBeGreaterThan(0);
  });
});
