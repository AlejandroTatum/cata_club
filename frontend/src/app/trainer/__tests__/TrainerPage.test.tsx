/**
 * Component tests for the trainer's "Mi día"
 * (`docs/ux/prototipos/19-entrenador.html`).
 *
 * The screen was rebuilt around a single decision — pass the list for the
 * next session — so these tests are mostly about what is NOT on it any more:
 * no stat cards, no filter panel, no paginated history table, and no level
 * information or Niveles entry point anywhere.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import TrainerPage from "@/app/trainer/page";
import { OPEN_HELP_CHAT_EVENT, type OpenHelpChatDetail } from "@/components/shell/AppShell";
import type { TrainingSchedule, AttendanceRecord } from "@/app/attendance/attendance-utils";
import { createAuthenticatedAuth } from "@/components/__tests__/test-utils";

vi.mock("@/components/ProtectedRoute", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => createAuthenticatedAuth("trainer", "Carlos Mendoza"),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/trainer",
  useRouter: () => ({ push: vi.fn() }),
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

vi.mock("next/image", () => ({
  __esModule: true,
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ alt }: { alt: string }) => <img alt={alt} />,
}));

const mockFetchTrainingSchedules = vi.fn();
const mockFetchAttendanceRecords = vi.fn();
const mockFetchAlumnosPorHorario = vi.fn();

vi.mock("@/services/api", () => ({
  fetchTrainingSchedules: () => mockFetchTrainingSchedules(),
  fetchAttendanceRecords: (params?: unknown) => mockFetchAttendanceRecords(params),
  fetchAlumnosPorHorario: (id: number) => mockFetchAlumnosPorHorario(id),
  fetchNotificaciones: vi.fn().mockResolvedValue([]),
  marcarNotificacionLeida: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Fixtures. Monday 2026-07-20 at 14:35 — 25 minutes before the 15:00 session.
// ---------------------------------------------------------------------------

const NOW = new Date(2026, 6, 20, 14, 35);

function schedule(id: number, horaInicio: string, horaFin: string): TrainingSchedule {
  return {
    id,
    diaSemana: "lun",
    horaInicio,
    horaFin,
    entrenadorId: 42,
    entrenadorNombre: "Carlos Mendoza",
    nivelRankingId: 9,
  };
}

const TODAY_SCHEDULES: TrainingSchedule[] = [
  schedule(1, "15:00", "16:00"),
  schedule(2, "16:00", "17:00"),
  schedule(3, "17:00", "18:00"),
  // A Tuesday session that must never reach today's hero.
  { ...schedule(4, "09:00", "10:00"), diaSemana: "mar" },
];

function record(
  estado: AttendanceRecord["estado"],
  estudiante: string,
  fecha = "2026-07-20",
): AttendanceRecord {
  return {
    id: `${estudiante}-${fecha}-${estado}`,
    fecha,
    horario: "Lunes 15:00 — 16:00",
    personaId: 1,
    estudiante,
    estado,
    entrenador: "Carlos Mendoza",
  };
}

const MONTH_RECORDS: AttendanceRecord[] = [
  record("present", "Sofia Vera"),
  record("present", "Diego Mendoza"),
  record("late", "Ana Garcia"),
  record("justified", "Melany Quimis"),
  record("absent", "Luis Lopez"),
  record("absent", "Luis Lopez", "2026-07-13"),
  record("absent", "Luis Lopez", "2026-07-06"),
];

describe("TrainerPage — Mi día", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(NOW);
    mockFetchTrainingSchedules.mockReset().mockResolvedValue(TODAY_SCHEDULES);
    mockFetchAttendanceRecords.mockReset().mockResolvedValue(MONTH_RECORDS);
    mockFetchAlumnosPorHorario.mockReset().mockResolvedValue(new Array(12).fill({}));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("greets the trainer by first name", async () => {
    render(<TrainerPage />);

    expect(
      await screen.findByRole("heading", { level: 1, name: "Hola, Carlos" }),
    ).toBeInTheDocument();
  });

  it("leads with the next session, the countdown and the roster count", async () => {
    render(<TrainerPage />);

    expect(await screen.findByText("Lunes 15:00 — 16:00")).toBeInTheDocument();
    // "inscritos", never "esperan": the count is of AlumnoHorario rows, and no
    // DTO says who actually turned up. `find`, not `get`: the roster count is
    // fetched separately once the next session resolves.
    expect(
      await screen.findByText(/En 25 minutos · 12 estudiantes inscritos/),
    ).toBeInTheDocument();
    expect(mockFetchAlumnosPorHorario).toHaveBeenCalledWith(1);
  });

  it("offers exactly one primary action, and it is Pasar lista", async () => {
    render(<TrainerPage />);
    await screen.findByText("Lunes 15:00 — 16:00");

    // Scoped to the page body: the shell's sidebar carries its own "Pasar
    // lista" nav row, which is navigation, not the screen's CTA.
    const page = within(screen.getByRole("main"));
    const cta = page.getByRole("link", { name: /Pasar lista/ });
    expect(cta).toHaveAttribute("href", "/trainer/attendance");
    expect(page.getAllByRole("link", { name: /Pasar lista/ })).toHaveLength(1);
  });

  it("lists what comes after the hero on one line, not as a second list", async () => {
    render(<TrainerPage />);

    await screen.findByText("Lunes 15:00 — 16:00");
    const after = screen.getByText(/Después:/);
    expect(after).toHaveTextContent("16:00");
    expect(after).toHaveTextContent("17:00");
  });

  it("keeps the hero honest when the day is over", async () => {
    vi.setSystemTime(new Date(2026, 6, 20, 21, 0));
    render(<TrainerPage />);

    expect(await screen.findByText("Ya no quedan sesiones hoy")).toBeInTheDocument();
    expect(screen.queryByText(/Después:/)).not.toBeInTheDocument();
    // Even with nothing scheduled, the way to take a list stays reachable.
    expect(
      within(screen.getByRole("main")).getByRole("link", { name: /Pasar lista/ }),
    ).toBeInTheDocument();
  });

  it("says so plainly when there is nothing scheduled today at all", async () => {
    mockFetchTrainingSchedules.mockResolvedValue([
      { ...schedule(4, "09:00", "10:00"), diaSemana: "mar" },
    ]);
    render(<TrainerPage />);

    expect(await screen.findByText("Hoy no tienes sesiones")).toBeInTheDocument();
  });

  it("does not block the hero when the roster count cannot be loaded", async () => {
    mockFetchAlumnosPorHorario.mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(<TrainerPage />);

    expect(await screen.findByText("Lunes 15:00 — 16:00")).toBeInTheDocument();
    // The countdown survives; only the roster clause is dropped.
    expect(screen.getByText(/En 25 minutos/)).toBeInTheDocument();
    expect(screen.queryByText(/estudiantes inscritos/)).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Última lista — a result, plus something to do about it.
  // -------------------------------------------------------------------------

  it("summarizes the most recent list with all four state counts", async () => {
    render(<TrainerPage />);

    expect(await screen.findByText(/Última lista/)).toBeInTheDocument();
    expect(screen.getByText("2 presente")).toBeInTheDocument();
    expect(screen.getByText("1 tardanza")).toBeInTheDocument();
    expect(screen.getByText("1 justificado")).toBeInTheDocument();
    expect(screen.getByText("1 ausente")).toBeInTheDocument();
  });

  it("names the student piling up absences and offers a way to act on it", async () => {
    render(<TrainerPage />);

    await screen.findByText(/Última lista/);
    expect(screen.getByText("Luis Lopez")).toBeInTheDocument();
    expect(screen.getByText("3 ausencias")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Avisar al club/ })).toBeInTheDocument();
  });

  it("opens the help assistant with the notice already written", async () => {
    const listener = vi.fn();
    window.addEventListener(OPEN_HELP_CHAT_EVENT, listener);

    render(<TrainerPage />);
    await screen.findByText(/Última lista/);
    fireEvent.click(screen.getByRole("button", { name: /Avisar al club/ }));

    expect(listener).toHaveBeenCalledTimes(1);
    const detail = (listener.mock.calls[0][0] as CustomEvent<OpenHelpChatDetail>).detail;
    expect(detail.draft).toBe("Hola, quiero avisar que Luis Lopez suma 3 ausencias este mes.");
    window.removeEventListener(OPEN_HELP_CHAT_EVENT, listener);
  });

  it("stays quiet about absences when nobody has reached the threshold", async () => {
    mockFetchAttendanceRecords.mockResolvedValue([
      record("present", "Sofia Vera"),
      record("absent", "Luis Lopez"),
    ]);
    render(<TrainerPage />);

    await screen.findByText(/Última lista/);
    expect(screen.queryByRole("button", { name: /Avisar al club/ })).not.toBeInTheDocument();
  });

  it("shows an actionable empty state when no list has been filed this month", async () => {
    mockFetchAttendanceRecords.mockResolvedValue([]);
    render(<TrainerPage />);

    expect(
      await screen.findByText("Todavía no registraste ninguna lista este mes"),
    ).toBeInTheDocument();
  });

  it("sends the history to its own view instead of embedding it", async () => {
    render(<TrainerPage />);

    const link = await screen.findByRole("link", { name: "Ver historial" });
    expect(link).toHaveAttribute("href", "/trainer/attendance/history");
    // The table, its filter panel and its pager are gone from this screen.
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Filtrar por horario")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Página siguiente" })).not.toBeInTheDocument();
  });

  it("recovers from a failed load with a retry", async () => {
    mockFetchTrainingSchedules.mockRejectedValueOnce(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(<TrainerPage />);

    expect(await screen.findByText(/No se pudo cargar su día/)).toBeInTheDocument();
    mockFetchTrainingSchedules.mockResolvedValue(TODAY_SCHEDULES);
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    await waitFor(() => {
      expect(screen.getByText("Lunes 15:00 — 16:00")).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Settled product decisions.
  // -------------------------------------------------------------------------

  it("no longer stacks quick-action and stat cards above the fold", async () => {
    render(<TrainerPage />);

    await screen.findByText("Lunes 15:00 — 16:00");
    expect(screen.queryByText("Registrar Asistencia")).not.toBeInTheDocument();
    expect(screen.queryByText("Horarios de Hoy")).not.toBeInTheDocument();
    expect(screen.queryByText("Asistencias Registradas Hoy")).not.toBeInTheDocument();
    expect(screen.queryByText("Presentes Hoy")).not.toBeInTheDocument();
  });
});
