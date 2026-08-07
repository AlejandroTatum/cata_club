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

vi.mock("@/components/ProtectedRoute", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
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

    // Wait for the hero note, not for the link: `pendingPayments` falls back to
    // 0 before the stats resolve, so "Ver pagos" is already in the header on the
    // very first render and awaiting it proves nothing. "La cola está al día" is
    // the one thing here that only exists once the stats came back saying zero.
    await screen.findByText("La cola está al día");
    expect(screen.getByRole("link", { name: /ver pagos/i })).toHaveAttribute(
      "href",
      "/payments",
    );
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

    for (const href of ["/members", "/groups"]) {
      expect(document.querySelector(`a[href="${href}"]`)).toBeNull();
    }
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
  it("counts active memberships against the alumnos, and Miembros against the whole padrón", async () => {
    mockFetchDashboardStats.mockResolvedValue(
      statsFixture({ totalPersonas: 86, totalAlumnos: 84, activeMemberships: 21 }),
    );

    render(<DashboardPage />);

    await screen.findByText("Membresías activas");
    // 21 of 84 alumnos is 25%. Against all 86 registered personas the same
    // club reads "de 86 · 24%" — which is the bug, not a rounding difference.
    expect(screen.getByText("de 84")).toBeInTheDocument();
    expect(screen.getByText("25% del total")).toBeInTheDocument();
    // The Miembros tile answers the other question and keeps the full padrón:
    // it is captioned "personas registradas" and there are 86 of them.
    expect(screen.getByText("86")).toBeInTheDocument();
    expect(screen.getByText("personas registradas")).toBeInTheDocument();
  });

  it("gives all three tiles the same internal grammar: label, figure, caption", async () => {
    mockFetchAttendanceRecords.mockResolvedValue([todayRecord("1"), todayRecord("2")]);

    render(<DashboardPage />);

    // The attendance caption, again: it is the last of the three to arrive,
    // because it needs the attendance fetch and not just the stats one.
    await screen.findByText("2 de 2 presentes");
    // A caption, a progress bar and four sparkbars side by side read as three
    // unrelated things rather than one pulse. Every tile now closes on a plain
    // caption line — and the caption says what the widget only gestured at.
    expect(screen.queryByRole("img", { name: /asistencia por semana/i })).toBeNull();
    expect(screen.getByText("personas registradas")).toBeInTheDocument();
    // 17 of the 40 alumnos, not of the 44 registered personas.
    expect(screen.getByText("43% del total")).toBeInTheDocument();
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
    expect(within(feed).getAllByRole("listitem").length).toBeLessThanOrEqual(5);
  });

  it("groups the feed and the donut side by side instead of stacking full-width cards", async () => {
    mockFetchAttendanceRecords.mockResolvedValue([todayRecord("1")]);
    mockFetchPaymentValidations.mockResolvedValue([pendingPayment("a", 1)]);

    render(<DashboardPage />);

    // The row and the feed card are structural and render immediately; the
    // donut is the only one of the three that waits for the attendance records.
    // Awaiting the row would let the donut assertion run against a card still
    // showing "Sin asistencias registradas".
    await screen.findByTestId("attendance-donut");
    const lower = screen.getByTestId("dashboard-lower");
    expect(within(lower).getByTestId("activity-feed")).toBeInTheDocument();
    expect(within(lower).getByTestId("attendance-donut")).toBeInTheDocument();
  });

  it("says there is nothing yet, instead of unmounting and leaving a hole", async () => {
    // It used to unmount. On a fresh install that left a hero, four zeroes and
    // ~600px of nothing — with no way to tell "no activity yet" apart from
    // "this page is broken". A section that disappears answers neither.
    render(<DashboardPage />);
    await screen.findByText("Miembros");

    expect(screen.getByText("Actividad reciente")).toBeInTheDocument();
    expect(screen.getByText("Todavía no hay movimiento")).toBeInTheDocument();
    // An empty state without a next action is a dead end.
    expect(screen.getByRole("link", { name: /pasar lista/i })).toHaveAttribute(
      "href",
      "/trainer/attendance",
    );
  });

  it("keeps the attendance donut, and only when there are records", async () => {
    mockFetchAttendanceRecords.mockResolvedValue([todayRecord("1")]);
    render(<DashboardPage />);

    expect(await screen.findByTestId("attendance-donut")).toBeInTheDocument();
  });

  it("keeps the donut's card and explains the blank, rather than dropping it", async () => {
    render(<DashboardPage />);
    await screen.findByText("Miembros");

    expect(screen.queryByTestId("attendance-donut")).not.toBeInTheDocument();
    expect(screen.getByText("Distribución de asistencias")).toBeInTheDocument();
    expect(screen.getByText("Sin asistencias registradas")).toBeInTheDocument();
  });

  it("holds the two-column row whether or not either card has data", async () => {
    // The split used to depend on both cards having data, so the layout moved
    // under the admin as records arrived.
    render(<DashboardPage />);
    await screen.findByText("Miembros");

    // `PAGE_RAIL`, not a literal: the dashboard used to write its own 16px gap
    // and its own `minmax(0,340px)` track, one of the six spellings #36 found
    // of the same split.
    expect(screen.getByTestId("dashboard-lower").className).toBe(PAGE_RAIL);
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
    // The card stays and says so. A secondary list that failed and a club with
    // no activity yet look the same to the admin either way, so the honest
    // thing is to keep the section and let the pulse above carry the news.
    expect(screen.getByText("Actividad reciente")).toBeInTheDocument();
    expect(screen.getByText("Todavía no hay movimiento")).toBeInTheDocument();
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
