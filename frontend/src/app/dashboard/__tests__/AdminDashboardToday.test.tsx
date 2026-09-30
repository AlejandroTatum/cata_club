/**
 * The admin dashboard, drawn: "Hoy en el club" as a timeline with its action
 * chips, four pulse tiles with their own small picture, attendance by state,
 * the payments pipeline and a filterable activity feed — and every block that
 * has no data says so in one line.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import DashboardPage from "@/app/dashboard/page";
import type { PaymentValidationRequest } from "@/services/api";
import type { AttendanceRecord, TrainingSchedule } from "@/app/attendance/attendance-utils";
import { clubIsoDate, todayDiaSemana } from "@/lib/club-date";
import { useAuth } from "@/contexts/AuthContext";
import { createAuthenticatedAuth } from "@/components/__tests__/test-utils";

const mockUseAuth = vi.mocked(useAuth);

vi.mock("@/components/ProtectedRoute", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("@/components/shell/AppShell", () => ({
  __esModule: true,
  default: ({
    children,
    title,
    subtitle,
    actions,
  }: {
    children: React.ReactNode;
    title: string;
    subtitle?: string;
    actions?: React.ReactNode;
  }) => (
    <div>
      <h1>{title}</h1>
      {subtitle ? <p data-testid="subtitle">{subtitle}</p> : null}
      {actions}
      {children}
    </div>
  ),
}));
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const mockStats = vi.fn();
const mockRecords = vi.fn();
const mockPayments = vi.fn();
const mockSchedules = vi.fn();

vi.mock("@/services/api", () => ({
  fetchDashboardStats: () => mockStats(),
  fetchAttendanceRecords: () => mockRecords(),
  fetchPaymentValidations: () => mockPayments(),
  fetchTrainingSchedules: () => mockSchedules(),
  fetchRosterDeTodosLosHorarios: () => Promise.resolve([]),
}));

function stats(overrides: Partial<Record<string, number>> = {}): Record<string, number> {
  return {
    totalPersonas: 44,
    totalAlumnos: 40,
    activeMemberships: 17,
    pendingPayments: 3,
    todaySchedules: 2,
    personasSinMembresia: 5,
    ...overrides,
  };
}

function payment(id: string, daysAgo: number): PaymentValidationRequest {
  return {
    id,
    studentName: `Alumno ${id}`,
    responsablePagoName: `Pagador ${id}`,
    membershipPeriod: "01/09/2026 – 30/09/2026",
    membershipType: "Mensual",
    expectedAmount: 25,
    paymentMethod: "Transferencia",
    uploadedAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
    currentMembershipStatus: "vencida",
    proofFileType: "image",
    validationStatus: "pendiente",
    startDate: "2026-09-01",
    endDate: "2026-09-30",
  };
}

function todaySchedule(id: number, horaInicio: string, horaFin: string): TrainingSchedule {
  return { id, diaSemana: todayDiaSemana(), horaInicio, horaFin, categoriaLabel: "Sub-12" };
}

function todayRecord(horarioId: number): AttendanceRecord {
  return {
    id: `r${horarioId}`,
    fecha: clubIsoDate(),
    horario: "Hoy",
    horarioId,
    personaId: 1,
    estudiante: "Ana",
    estado: "present",
  };
}

beforeEach(() => {
  mockStats.mockReset().mockResolvedValue(stats());
  mockRecords.mockReset().mockResolvedValue([]);
  mockPayments.mockReset().mockResolvedValue([]);
  mockSchedules.mockReset().mockResolvedValue([]);
  mockUseAuth.mockReset().mockReturnValue(createAuthenticatedAuth("admin", "Marta Gómez"));
});

describe("admin dashboard — header", () => {
  it("greets by first name and states role and date on the context line", async () => {
    render(<DashboardPage />);
    await screen.findByTestId("today-hero");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/Marta/);
    expect(screen.getByTestId("subtitle").textContent).toMatch(/^Administración · \p{L}+, \d{1,2} de \p{L}+ de \d{4}$/u);
  });
});

describe("admin dashboard — hoy en el club", () => {
  it("draws today's classes on a timeline, each one a link into its attendance", async () => {
    mockSchedules.mockResolvedValue([todaySchedule(7, "00:00", "00:01"), todaySchedule(8, "23:58", "23:59")]);
    render(<DashboardPage />);
    const hero = await screen.findByTestId("today-hero");
    expect(await within(hero).findByTestId("timeline-summary")).toHaveTextContent("0 de 2 listas tomadas");
    const timeline = within(hero).getByTestId("timeline");
    const links = within(timeline).getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute("href")).toContain("/trainer/attendance");
    expect(links[0].getAttribute("href")).toContain("horario=7");
  });

  it("states which of today's lists were taken and which are missing, in words", async () => {
    // A session that ended at 00:01 is always over; one at 23:58 never is.
    mockSchedules.mockResolvedValue([
      todaySchedule(1, "00:00", "00:01"),
      todaySchedule(2, "00:00", "00:02"),
      todaySchedule(3, "23:58", "23:59"),
    ]);
    mockRecords.mockResolvedValue([todayRecord(2)]);
    render(<DashboardPage />);
    const timeline = await screen.findByTestId("timeline");
    const names = within(timeline).getAllByRole("link").map((link) => link.getAttribute("aria-label") ?? link.textContent ?? "");
    expect(names.some((name) => /lista tomada/i.test(name))).toBe(true);
    expect(names.some((name) => /sin lista/i.test(name))).toBe(true);
    expect(names.some((name) => /pendiente/i.test(name))).toBe(true);
    expect(screen.getByTestId("timeline-summary")).toHaveTextContent("1 de 3 listas tomadas");
  });

  it("says there are no classes today in one line", async () => {
    render(<DashboardPage />);
    const hero = await screen.findByTestId("today-hero");
    expect(await within(hero).findByText("Hoy no hay clases")).toBeInTheDocument();
    expect(within(hero).queryByTestId("timeline")).toBeNull();
  });

  it("tells the admin when today's timetable could not load, and retries", async () => {
    mockSchedules.mockRejectedValueOnce(new Error("boom")).mockResolvedValue([]);
    render(<DashboardPage />);
    const hero = await screen.findByTestId("today-hero");
    expect(await within(hero).findByText(/no se pudieron cargar las clases/i)).toBeInTheDocument();
    within(hero).getByRole("button", { name: /reintentar/i }).click();
    expect(await within(hero).findByText("Hoy no hay clases")).toBeInTheDocument();
  });

  it("puts the pending payments and their action inside the hero", async () => {
    mockPayments.mockResolvedValue([payment("a", 5), payment("b", 2), payment("c", 1)]);
    render(<DashboardPage />);
    const chips = await screen.findByTestId("attention-chips");
    const action = await within(chips).findByTestId("payments-action");
    expect(action).toHaveTextContent("3");
    expect(action).toHaveTextContent(/comprobantes por revisar/i);
    await within(action).findByText(/el más antiguo: hace 5 días/i);
    expect(within(action).getAllByText(/Pagador a/).length).toBeGreaterThan(0);
    expect(within(chips).getByRole("link", { name: /revisar ahora/i })).toHaveAttribute("href", "/payments");
    expect(within(chips).getByRole("link", { name: /ver miembros/i })).toHaveAttribute("href", "/members");
  });

  it("names the payments that have waited over a week", async () => {
    mockPayments.mockResolvedValue([payment("a", 10), payment("b", 9), payment("c", 1)]);
    render(<DashboardPage />);
    const chips = await screen.findByTestId("attention-chips");
    expect(await within(chips).findByText(/2 llevan más de una semana esperando/)).toBeInTheDocument();
  });

  it("says everything is up to date instead of rendering nothing", async () => {
    mockStats.mockResolvedValue(stats({ pendingPayments: 0, personasSinMembresia: 0 }));
    render(<DashboardPage />);
    const chips = await screen.findByTestId("attention-chips");
    expect(await within(chips).findByText(/todo al día/i)).toBeInTheDocument();
    expect(within(chips).queryByRole("link")).toBeNull();
    expect(within(chips).queryByText(/revisar ahora/i)).toBeNull();
  });
});

describe("admin dashboard — the pulse tiles", () => {
  it("draws four tiles, each with its own figure and a way into its module", async () => {
    render(<DashboardPage />);
    const kpis = await screen.findByTestId("dashboard-kpis");
    const tiles = within(kpis).getAllByTestId("kpi-tile");
    expect(tiles).toHaveLength(4);
    expect(within(tiles[0]).getByText("Miembros")).toBeInTheDocument();
    expect(within(tiles[0]).getByText("44")).toBeInTheDocument();
    expect(within(tiles[0]).getByRole("link")).toHaveAttribute("href", "/members");
    expect(within(tiles[1]).getByRole("link")).toHaveAttribute("href", "/members");
    expect(within(tiles[2]).getByRole("link")).toHaveAttribute("href", "/payments");
    expect(within(tiles[3]).getByRole("link")).toHaveAttribute("href", "/attendance");
  });

  it("counts Miembros over the whole padrón and memberships over the alumnos", async () => {
    render(<DashboardPage />);
    const kpis = await screen.findByTestId("dashboard-kpis");
    expect(within(kpis).getByRole("group", { name: /Miembros: 40 alumnos y 4 de staff/ })).toBeInTheDocument();
    expect(within(kpis).getByRole("img", { name: /Membresías activas: 17 de 40/ })).toBeInTheDocument();
  });

  it("buckets the pending payments by how long they have waited", async () => {
    mockPayments.mockResolvedValue([payment("a", 0), payment("b", 2), payment("c", 8), payment("d", 9)]);
    render(<DashboardPage />);
    const kpis = await screen.findByTestId("dashboard-kpis");
    expect(
      await within(kpis).findByRole("group", { name: /1 hoy, 1 de 1 a 3 días, 2 de más de 3 días/ }),
    ).toBeInTheDocument();
  });

  it("draws no empty age bars when nothing is pending", async () => {
    render(<DashboardPage />);
    const kpis = await screen.findByTestId("dashboard-kpis");
    await within(kpis).findByText("Pagos por validar");
    expect(within(kpis).queryByRole("group", { name: /según su espera/ })).toBeNull();
  });

  it("shows the four weekly columns of the attendance rate", async () => {
    mockRecords.mockResolvedValue([todayRecord(1), todayRecord(1)]);
    render(<DashboardPage />);
    const kpis = await screen.findByTestId("dashboard-kpis");
    const summary = await within(kpis).findByRole("group", { name: /Asistencia de las últimas 4 semanas/ });
    expect(summary.getAttribute("aria-label")).toMatch(/Act\. 100%/);
    expect(within(kpis).getAllByTestId("bars-column").length).toBeGreaterThanOrEqual(4);
  });
});

describe("admin dashboard — attendance by state", () => {
  it("says so in one line when there are no records", async () => {
    render(<DashboardPage />);
    const block = await screen.findByTestId("attendance-distribution");
    expect(await within(block).findByText("Sin asistencias registradas")).toBeInTheDocument();
  });

  it("draws the stacked weeks and lets the legend hide a state", async () => {
    mockRecords.mockResolvedValue([todayRecord(1), { ...todayRecord(1), id: "x", estado: "absent" }]);
    render(<DashboardPage />);
    const block = await screen.findByTestId("attendance-distribution");
    const presente = await within(block).findByRole("button", { name: /Presente/ });
    expect(presente).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(presente);
    expect(presente).toHaveAttribute("aria-pressed", "false");
    expect(within(block).getByText(/ver como tabla/i)).toBeInTheDocument();
  });
});

describe("admin dashboard — payments", () => {
  it("draws the pipeline with every segment linking to the payments page", async () => {
    mockPayments.mockResolvedValue([payment("a", 1), { ...payment("b", 3), validationStatus: "validado" }]);
    render(<DashboardPage />);
    const block = await screen.findByTestId("payment-queue");
    const bar = await within(block).findByRole("img", { name: /Pagos por estado: 1 por validar, 1 validados, 0 rechazados/ }).catch(() => null);
    expect(bar ?? within(block).getAllByTestId("segment")[0]).toBeTruthy();
    for (const segment of within(block).getAllByTestId("segment")) {
      expect(segment.closest("a") ?? segment).toHaveAttribute("href", "/payments");
    }
  });

  it("lists the oldest pending receipts first and links to the full queue", async () => {
    mockPayments.mockResolvedValue([payment("new", 1), payment("old", 12)]);
    render(<DashboardPage />);
    const queue = await screen.findByTestId("payment-queue");
    const first = await within(queue).findByText(/Pagador old/);
    const row = first.closest("li") as HTMLElement;
    expect(row.textContent).toMatch(/Hace 12 días/);
    expect(queue.textContent!.indexOf("Pagador old")).toBeLessThan(queue.textContent!.indexOf("Pagador new"));
    expect(within(queue).getByRole("link", { name: /ver todos/i })).toHaveAttribute("href", "/payments");
  });

  it("shows a one-line empty state when there are no payments", async () => {
    render(<DashboardPage />);
    const queue = await screen.findByTestId("payment-queue");
    expect(await within(queue).findByText("No hay pagos por validar")).toBeInTheDocument();
  });
});

describe("admin dashboard — activity filter", () => {
  it("narrows the feed to payments or attendance client-side", async () => {
    mockPayments.mockResolvedValue([payment("a", 1)]);
    mockRecords.mockResolvedValue([todayRecord(1)]);
    render(<DashboardPage />);
    const feed = await screen.findByTestId("activity-feed");
    await within(feed).findByText(/subió un comprobante/i);
    expect(within(feed).getByText(/lista/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Pagos/ }));
    expect(within(feed).getByText(/subió un comprobante/i)).toBeInTheDocument();
    expect(within(feed).queryByTestId("activity-marker-attendance-session")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Asistencia/ }));
    expect(within(feed).queryByText(/subió un comprobante/i)).toBeNull();
    expect(within(feed).getByTestId("activity-marker-attendance-session")).toBeInTheDocument();
  });
});

describe("admin dashboard — two independent columns", () => {
  it("puts the feed in the main column, and the payments with the attendance chart in the rail", async () => {
    render(<DashboardPage />);
    await screen.findByTestId("payment-queue");
    const main = screen.getByTestId("dashboard-main");
    const rail = screen.getByTestId("dashboard-rail");
    expect(within(main).getByTestId("activity-feed")).toBeInTheDocument();
    expect(within(rail).getByTestId("attendance-distribution")).toBeInTheDocument();
    expect(within(rail).getByTestId("payment-queue")).toBeInTheDocument();
    expect(main).toHaveAttribute("data-dash-col");
    expect(rail).toHaveAttribute("data-dash-col");
  });

  it("carries the activity filters and search in the feed's own card", async () => {
    mockPayments.mockResolvedValue([payment("a", 1)]);
    render(<DashboardPage />);
    const feed = await screen.findByTestId("activity-feed");
    const toolbar = await within(feed).findByTestId("activity-toolbar");
    expect(within(toolbar).getByRole("searchbox")).toBeInTheDocument();
    expect(within(toolbar).getByRole("button", { name: /pagos/i })).toBeInTheDocument();
  });

  it("never stretches a block to its neighbour's height", async () => {
    mockPayments.mockResolvedValue([payment("a", 1)]);
    render(<DashboardPage />);
    await within(screen.getByTestId("payment-queue")).findByText(/Pagador a/);
    for (const id of ["payment-queue", "today-hero", "activity-feed", "attendance-distribution"]) {
      expect(screen.getByTestId(id).className).not.toMatch(/\bh-full\b/);
    }
  });

  it("renders every empty block as a one-line state, never a tall empty card", async () => {
    render(<DashboardPage />);
    await within(screen.getByTestId("payment-queue")).findByText("No hay pagos por validar");
    await within(screen.getByTestId("today-hero")).findByText("Hoy no hay clases");
    await within(screen.getByTestId("activity-feed")).findByText("Todavía no hay movimiento");
    await within(screen.getByTestId("attendance-distribution")).findByText("Sin asistencias registradas");
    expect(screen.getAllByTestId("compact-empty")).toHaveLength(4);
    expect(screen.queryByTestId("empty-state")).toBeNull();
  });
});

describe("admin dashboard — best-effort failures are visible", () => {
  it("tells the admin when payments could not load, and retries", async () => {
    mockPayments.mockRejectedValueOnce(new Error("boom")).mockResolvedValue([payment("a", 2)]);
    render(<DashboardPage />);
    const queue = await screen.findByTestId("payment-queue");
    expect(await within(queue).findByText(/no se pudieron cargar los pagos/i)).toBeInTheDocument();
    within(queue).getByRole("button", { name: /reintentar/i }).click();
    expect(await within(queue).findByText(/Pagador a/)).toBeInTheDocument();
  });

  it("tells the admin when attendance could not load instead of an empty feed", async () => {
    mockRecords.mockRejectedValue(new Error("boom"));
    render(<DashboardPage />);
    const feed = await screen.findByTestId("activity-feed");
    expect(await within(feed).findByText(/no se pudo cargar la asistencia/i)).toBeInTheDocument();
    expect(within(feed).queryByText("Todavía no hay movimiento")).toBeNull();
    await waitFor(() => expect(screen.getAllByTestId("section-notice").length).toBeGreaterThan(0));
  });
});
