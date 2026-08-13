/**
 * Component tests for the trainer's "Mi día" (issue #211,
 * `docs/ux/prototipos/31-entrenador-dashboard-alternativas.html`).
 *
 * The screen was compacted around two symmetric top cards — the immediate
 * session (`SessionCard`) and the attendance summary — plus dense
 * "Últimas listas" rows below. These tests are mostly about the same rule
 * `SessionCard.test.tsx` locks down at the unit level, exercised here through
 * the full page and real system-clock states: no state without a session may
 * ever leave a `horario=` link in the tree.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import TrainerPage from "@/app/trainer/page";
import type { TrainingSchedule, AttendanceRecord } from "@/app/attendance/attendance-utils";
import type { AlumnoHorario, RecentAttendanceSession } from "@/services/api";
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
const mockFetchRosterDeTodosLosHorarios = vi.fn();
const mockFetchRecentAttendanceSessions = vi.fn();

vi.mock("@/services/api", () => ({
  fetchTrainingSchedules: () => mockFetchTrainingSchedules(),
  fetchAttendanceRecords: (params?: unknown) => mockFetchAttendanceRecords(params),
  fetchRosterDeTodosLosHorarios: () => mockFetchRosterDeTodosLosHorarios(),
  fetchRecentAttendanceSessions: () => mockFetchRecentAttendanceSessions(),
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
  };
}

const TODAY_SCHEDULES: TrainingSchedule[] = [
  schedule(1, "15:00", "16:00"),
  schedule(2, "16:00", "17:00"),
  schedule(3, "17:00", "18:00"),
  // A Tuesday session that must never reach today's card.
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
    horarioId: 1,
    personaId: 1,
    estudiante,
    estado,
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

const RECENT_SESSIONS: RecentAttendanceSession[] = [
  {
    horarioId: 2,
    fecha: "2026-07-20",
    horario: "Lunes 16:00 — 17:00",
    counts: { present: 6, late: 0, justified: 1, absent: 1 },
    total: 8,
  },
  {
    horarioId: 3,
    fecha: "2026-07-19",
    horario: "Domingo 09:00 — 10:00",
    counts: { present: 4, late: 1, justified: 0, absent: 0 },
    total: 5,
  },
];

/** Every anchor in the document whose href addresses a specific session. */
function horarioLinks(): HTMLAnchorElement[] {
  return Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href*='horario=']"));
}

function alumno(horarioId: number): AlumnoHorario {
  return {
    id: Math.random(),
    personaId: Math.random(),
    personaNombreCompleto: "Alumno",
    edad: 12,
    horarioId,
    horarioDia: "lun",
    horarioHoraInicio: "15:00",
    horarioHoraFin: "16:00",
    fechaAsignacion: "2026-01-01",
  };
}

// 12 enrolled in the hero session (id 1), 3 in the next one (id 2), and a
// real, seeded 0 in the last (id 3) — issue #211's "no fabricated capacity"
// rule cuts both ways: an empty class still SHOWS as 0, not as a blank.
const ROSTER: AlumnoHorario[] = [
  ...new Array(12).fill(null).map(() => alumno(1)),
  ...new Array(3).fill(null).map(() => alumno(2)),
];

describe("TrainerPage — Mi día", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(NOW);
    mockFetchTrainingSchedules.mockReset().mockResolvedValue(TODAY_SCHEDULES);
    mockFetchAttendanceRecords.mockReset().mockResolvedValue(MONTH_RECORDS);
    mockFetchRosterDeTodosLosHorarios.mockReset().mockResolvedValue(ROSTER);
    mockFetchRecentAttendanceSessions.mockReset().mockResolvedValue(RECENT_SESSIONS);
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

  // -------------------------------------------------------------------------
  // The immediate-session card's four states.
  // -------------------------------------------------------------------------

  it("'next': leads with the countdown, the session's hours and the roster count", async () => {
    render(<TrainerPage />);

    expect(await screen.findByText("Lunes 15:00 — 16:00")).toBeInTheDocument();
    expect(screen.getByText("25")).toBeInTheDocument();
    // "inscritos", never "esperan": the count is of AlumnoHorario rows, and no
    // DTO says who actually turned up.
    expect(await screen.findByText(/12 estudiantes inscritos/)).toBeInTheDocument();
    expect(mockFetchRosterDeTodosLosHorarios).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // "The rest of today" — the fix for QA's actual complaint: a card with
  // ~250px of dead air between its five short lines and the mt-auto actions.
  // -------------------------------------------------------------------------

  it("fills the rest of the card with every OTHER session left today, roster counts included", async () => {
    render(<TrainerPage />);
    await screen.findByText("Lunes 15:00 — 16:00");

    const list = screen.getByRole("list", { name: "Después, más tarde hoy" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("16:00 — 17:00")).toBeInTheDocument();
    expect(screen.getByText("17:00 — 18:00")).toBeInTheDocument();
    // The roster resolves after the initial render, so wait for it.
    expect(await screen.findByText(/3 estudiantes inscritos/)).toBeInTheDocument();
    // Schedule 3's real, seeded enrollment is 0 — shown, not hidden.
    expect(screen.getByText(/0 estudiantes inscritos/)).toBeInTheDocument();
    // No hidden or tabbable session link snuck in through the list.
    expect(within(list).queryAllByRole("link")).toHaveLength(0);
  });

  it("does not block the 'rest of today' list when the roster fails to load", async () => {
    mockFetchRosterDeTodosLosHorarios.mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(<TrainerPage />);
    await screen.findByText("Lunes 15:00 — 16:00");

    const list = screen.getByRole("list", { name: "Después, más tarde hoy" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByText(/estudiantes inscritos/)).not.toBeInTheDocument();
  });

  it("'next': the primary action names the session by its hour and calls the wizard's real query contract", async () => {
    render(<TrainerPage />);
    await screen.findByText("Lunes 15:00 — 16:00");

    const primary = screen.getByRole("link", { name: "Pasar lista de las 15:00" });
    expect(primary).toHaveAttribute("href", "/trainer/attendance?horario=1&paso=lista");
    expect(screen.getByRole("link", { name: "Elegir otro horario" })).toHaveAttribute(
      "href",
      "/trainer/attendance",
    );
    // No second copy of the primary action inside the page's own content —
    // the sidebar carries its own "Pasar lista" nav row, which is
    // navigation, not this screen's CTA.
    expect(
      within(screen.getByRole("main")).getAllByRole("link", { name: /Pasar lista/ }),
    ).toHaveLength(1);
  });

  it("'live': the start hour replaces the countdown as the big number, and 'En curso' is written text", async () => {
    // 15:10 — ten minutes into the 15:00-16:00 session.
    vi.setSystemTime(new Date(2026, 6, 20, 15, 10));
    render(<TrainerPage />);

    await screen.findByText("Lunes 15:00 — 16:00");
    expect(screen.getByText("15:00")).toBeInTheDocument();
    expect(screen.getByText("En curso")).toBeInTheDocument();
    expect(screen.getByText(/Hace 10 minutos/)).toBeInTheDocument();
    // The number that was the countdown before the session started is gone.
    expect(screen.queryByText("25")).not.toBeInTheDocument();

    const primary = screen.getByRole("link", { name: "Pasar lista de las 15:00" });
    expect(primary).toHaveAttribute("href", "/trainer/attendance?horario=1&paso=lista");
  });

  it("'done': no countdown and no session link anywhere once every session today has ended", async () => {
    vi.setSystemTime(new Date(2026, 6, 20, 21, 0));
    render(<TrainerPage />);

    expect(await screen.findByText("Ya no quedan sesiones hoy.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Elegir otro horario" })).toHaveAttribute(
      "href",
      "/trainer/attendance",
    );
    expect(screen.queryByRole("link", { name: /Pasar lista de las/ })).not.toBeInTheDocument();
    expect(horarioLinks()).toHaveLength(0);
  });

  it("rest day: the card does not render at all, and no session link exists in the tree", async () => {
    mockFetchTrainingSchedules.mockResolvedValue([
      { ...schedule(4, "09:00", "10:00"), diaSemana: "mar" },
    ]);
    render(<TrainerPage />);

    await screen.findByText("Distribución de asistencias");
    expect(screen.queryByText(/Pasar lista de las/)).not.toBeInTheDocument();
    expect(screen.queryByText("Elegir otro horario")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Tu día de hoy")).not.toBeInTheDocument();
    expect(horarioLinks()).toHaveLength(0);
  });

  it("leaves no session link in the tree while the day is still loading", async () => {
    let resolveSchedules: (value: TrainingSchedule[]) => void = () => {};
    mockFetchTrainingSchedules.mockReturnValue(
      new Promise((resolve) => {
        resolveSchedules = resolve;
      }),
    );
    render(<TrainerPage />);

    expect(screen.getByText("Cargando tu día…")).toBeInTheDocument();
    expect(horarioLinks()).toHaveLength(0);
    resolveSchedules(TODAY_SCHEDULES);
    await screen.findByText("Lunes 15:00 — 16:00");
  });

  it("recovers from a failed load with a retry, and shows no session link while errored", async () => {
    mockFetchTrainingSchedules.mockRejectedValueOnce(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(<TrainerPage />);

    expect(await screen.findByText(/No se pudo cargar su día/)).toBeInTheDocument();
    expect(horarioLinks()).toHaveLength(0);

    mockFetchTrainingSchedules.mockResolvedValue(TODAY_SCHEDULES);
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    await waitFor(() => {
      expect(screen.getByText("Lunes 15:00 — 16:00")).toBeInTheDocument();
    });
  });

  it("does not block the hero session's countdown when the roster fails to load", async () => {
    mockFetchRosterDeTodosLosHorarios.mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(<TrainerPage />);

    expect(await screen.findByText("Lunes 15:00 — 16:00")).toBeInTheDocument();
    expect(screen.getByText("25")).toBeInTheDocument();
    expect(screen.queryByText(/estudiantes inscritos/)).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Distribución de asistencias (donut, reused from /dashboard).
  // -------------------------------------------------------------------------

  it("shows the attendance distribution chart, with a labeled center number", async () => {
    render(<TrainerPage />);

    await screen.findByText("Lunes 15:00 — 16:00");
    expect(screen.getByText("Distribución de asistencias")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: /Distribución de asistencias/ }),
    ).toBeInTheDocument();
    // The donut's center number needs a label — "7" alone says nothing.
    expect(screen.getByText("REGISTROS")).toBeInTheDocument();
  });

  it("names the student piling up absences, without a button to act on it", async () => {
    render(<TrainerPage />);

    await screen.findByText("Distribución de asistencias");
    expect(screen.getByText("Luis Lopez")).toBeInTheDocument();
    expect(screen.getByText("3 ausencias")).toBeInTheDocument();
  });

  it("stays quiet about absences when nobody has reached the threshold", async () => {
    mockFetchAttendanceRecords.mockResolvedValue([
      record("present", "Sofia Vera"),
      record("absent", "Luis Lopez"),
    ]);
    render(<TrainerPage />);

    await screen.findByText("Distribución de asistencias");
    expect(screen.queryByText(/ausencias/)).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Últimas listas — dense rows, one proportional bar per session.
  // -------------------------------------------------------------------------

  it("lists the club's recent sessions as dense rows with a proportional-bar aria-label", async () => {
    render(<TrainerPage />);

    expect(await screen.findByText("Últimas listas")).toBeInTheDocument();
    expect(screen.getByText("Lunes 16:00 — 17:00")).toBeInTheDocument();
    expect(screen.getByText("Domingo 09:00 — 10:00")).toBeInTheDocument();
    expect(
      screen.getByRole("img", {
        name: "6 presentes, 0 tardanzas, 1 justificado y 1 ausente sobre 8 registros",
      }),
    ).toBeInTheDocument();
  });

  it("does not render the four counts as loose colored badges — no author column either", async () => {
    render(<TrainerPage />);

    const heading = await screen.findByText("Últimas listas");
    const list = within(heading.closest("section") as HTMLElement);
    expect(list.queryByText(/Entrenador/)).not.toBeInTheDocument();
    expect(list.queryByText(/Registrad[oa] por/)).not.toBeInTheDocument();
  });

  it("shows an empty state when the club has no recent sessions", async () => {
    mockFetchRecentAttendanceSessions.mockResolvedValue([]);
    render(<TrainerPage />);

    expect(
      await screen.findByText("Todavía no hay listas registradas"),
    ).toBeInTheDocument();
  });

  it("does not let a failed recent-sessions load block the rest of the panel", async () => {
    mockFetchRecentAttendanceSessions.mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(<TrainerPage />);

    expect(await screen.findByText("Lunes 15:00 — 16:00")).toBeInTheDocument();
    expect(
      await screen.findByText("Todavía no hay listas registradas"),
    ).toBeInTheDocument();
  });

  it("sends the history to its own view instead of embedding a correction table", async () => {
    render(<TrainerPage />);

    const link = await screen.findByRole("link", { name: "Ver historial" });
    expect(link).toHaveAttribute("href", "/trainer/attendance/history");
    expect(screen.queryByRole("link", { name: "Corregir" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Filtrar por horario")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Página siguiente" })).not.toBeInTheDocument();
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

  it("does not render an 'Avisar al club' button — no endpoint notifies the club (owner: not an MVP feature)", async () => {
    render(<TrainerPage />);
    await screen.findByText("Distribución de asistencias");

    expect(screen.queryByRole("button", { name: /Avisar al club/ })).not.toBeInTheDocument();
    expect(
      screen.queryByText("Abre el asistente con el mensaje ya escrito. Usted lo revisa y lo envía."),
    ).not.toBeInTheDocument();
  });

  it("puts the two top cards in one row on desktop, and drops that constraint on a rest day", async () => {
    const { container: withSession } = render(<TrainerPage />);
    await screen.findByText("Lunes 15:00 — 16:00");
    expect(withSession.querySelector(".split\\:grid-cols-2")).not.toBeNull();
  });

  it("scopes the header row correctly: exactly one primary action reaches the DOM", async () => {
    render(<TrainerPage />);
    await screen.findByText("Lunes 15:00 — 16:00");

    const header = within(screen.getByRole("banner"));
    expect(header.queryByRole("link", { name: /Pasar lista/ })).toBeNull();
  });
});
