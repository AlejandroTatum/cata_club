/**
 * The admin dashboard organised around today's work: greeting + context line,
 * one attention strip (no lonely hero), clickable metric cards, the payment
 * queue beside today's classes, and two bottom blocks that fail out loud.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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

const mockStats = vi.fn();
const mockRecords = vi.fn();
const mockPayments = vi.fn();
const mockSchedules = vi.fn();

vi.mock("@/services/api", () => ({
  fetchDashboardStats: () => mockStats(),
  fetchAttendanceRecords: () => mockRecords(),
  fetchPaymentValidations: () => mockPayments(),
  fetchTrainingSchedules: () => mockSchedules(),
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
    await screen.findByTestId("attention-strip");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/Marta/);
    expect(screen.getByTestId("subtitle").textContent).toMatch(/^Administración · \w+, \d{1,2} de \w+ de \d{4}$/);
  });
});

describe("admin dashboard — attention strip", () => {
  it("puts the pending-payment count and its action on one row, with no separate hero", async () => {
    render(<DashboardPage />);
    const strip = await screen.findByTestId("attention-strip");
    const row = (await within(strip).findByText(/pagos esperan su validación/i)).closest("li") as HTMLElement;
    expect(within(row).getByText("3")).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: /revisar/i })).toHaveAttribute("href", "/payments");
    expect(screen.queryByTestId("hero-note")).toBeNull();
  });

  it("adds the ageing reason and the members without membership as further rows", async () => {
    mockPayments.mockResolvedValue([payment("a", 10), payment("b", 9), payment("c", 1)]);
    render(<DashboardPage />);
    const strip = await screen.findByTestId("attention-strip");
    expect(await within(strip).findByText("2 llevan más de una semana esperando")).toBeInTheDocument();
    const members = within(strip).getByText(/personas sin membresía/i).closest("li") as HTMLElement;
    expect(within(members).getByRole("link")).toHaveAttribute("href", "/members");
  });

  it("says everything is up to date instead of rendering nothing", async () => {
    mockStats.mockResolvedValue(stats({ pendingPayments: 0, personasSinMembresia: 0 }));
    render(<DashboardPage />);
    const strip = await screen.findByTestId("attention-strip");
    expect(within(strip).getByText(/no hay nada pendiente/i)).toBeInTheDocument();
    expect(within(strip).queryByRole("link")).toBeNull();
  });
});

describe("admin dashboard — metric cards", () => {
  it("links each figure to the module it comes from", async () => {
    render(<DashboardPage />);
    await screen.findByText("Miembros");
    expect(screen.getByText("Miembros").closest("a")).toHaveAttribute("href", "/members");
    expect(screen.getByText("Membresías activas").closest("a")).toHaveAttribute("href", "/members");
    expect(screen.getByText(/Asistencia · 4 semanas/).closest("a")).toHaveAttribute("href", "/attendance");
    expect(screen.getByText("Sesiones hoy").closest("a")).toHaveAttribute("href", "/attendance");
  });
});

describe("admin dashboard — pagos por validar", () => {
  it("lists the oldest pending receipts first and links to the full queue", async () => {
    mockPayments.mockResolvedValue([payment("new", 1), payment("old", 12)]);
    render(<DashboardPage />);
    const queue = await screen.findByTestId("payment-queue");
    const rows = await within(queue).findAllByRole("listitem");
    expect(rows[0].textContent).toMatch(/Pagador old/);
    expect(rows[0].textContent).toMatch(/Hace 12 días/);
    expect(within(queue).getByRole("link", { name: /ver todos/i })).toHaveAttribute("href", "/payments");
  });

  it("shows a guidance empty state when the queue is clear", async () => {
    render(<DashboardPage />);
    const queue = await screen.findByTestId("payment-queue");
    expect(await within(queue).findByText("No hay pagos por validar")).toBeInTheDocument();
  });
});

describe("admin dashboard — clases de hoy", () => {
  it("states which of today's lists were taken and which are missing", async () => {
    // A session that ended at 00:01 is always over; one at 23:58 never is.
    mockSchedules.mockResolvedValue([
      todaySchedule(1, "00:00", "00:01"),
      todaySchedule(2, "00:00", "00:02"),
      todaySchedule(3, "23:58", "23:59"),
    ]);
    mockRecords.mockResolvedValue([todayRecord(2)]);
    render(<DashboardPage />);
    const today = await screen.findByTestId("today-classes");
    await within(today).findByText("Lista tomada");
    expect(within(today).getByText("Sin lista")).toBeInTheDocument();
    expect(within(today).getByText("Pendiente")).toBeInTheDocument();
  });

  it("offers to take a missing list", async () => {
    mockSchedules.mockResolvedValue([todaySchedule(7, "00:00", "00:01")]);
    render(<DashboardPage />);
    const today = await screen.findByTestId("today-classes");
    const link = await within(today).findByRole("link", { name: /pasar lista/i });
    expect(link.getAttribute("href")).toContain("/trainer/attendance");
  });

  it("says there are no classes today", async () => {
    render(<DashboardPage />);
    const today = await screen.findByTestId("today-classes");
    expect(await within(today).findByText("Hoy no hay clases")).toBeInTheDocument();
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

  it("tells the admin when today's timetable could not load", async () => {
    mockSchedules.mockRejectedValue(new Error("boom"));
    render(<DashboardPage />);
    const today = await screen.findByTestId("today-classes");
    expect(await within(today).findByText(/no se pudieron cargar las clases/i)).toBeInTheDocument();
  });
});
