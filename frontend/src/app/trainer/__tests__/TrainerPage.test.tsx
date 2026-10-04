/**
 * Component tests for the trainer's "Mi día".
 *
 * The screen reads top to bottom: the next session as a hero (`NextSessionHero`),
 * the day on a timeline, the attendance trend and the students to follow, and
 * the sessions that never got a list. The rule exercised through real
 * system-clock states: no state without a session may ever leave a `horario=`
 * link in the hero.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PAGE_RAIL, STAT_GRID } from "@/components/ui";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import TrainerPage from "@/app/trainer/page";
import type { TrainingSchedule, AttendanceRecord } from "@/app/attendance/attendance-utils";
import type { AlumnoHorario, RecentAttendanceSession } from "@/services/api";
import { createAuthenticatedAuth, createLoadingAuth } from "@/components/__tests__/test-utils";
import { useAuth } from "@/contexts/AuthContext";
import { CLUB_TIME_ZONE } from "@/lib/club-date";

vi.mock("@/components/ProtectedRoute", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: vi.fn(),
}));

const mockUseAuth = vi.mocked(useAuth);

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
  fetchNotificaciones: vi.fn().mockResolvedValue({ items: [], total: 0, skip: 0, limit: 20 }),
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
  record("sick", "Melany Quimis"),
  record("absent", "Luis Lopez"),
  record("absent", "Luis Lopez", "2026-07-13"),
  record("absent", "Luis Lopez", "2026-07-06"),
];

const RECENT_SESSIONS: RecentAttendanceSession[] = [
  {
    horarioId: 2,
    fecha: "2026-07-20",
    horario: "Lunes 16:00 — 17:00",
    counts: { present: 6, late: 0, absent: 1, sick: 1, competition: 0 },
    total: 8,
  },
  {
    horarioId: 3,
    fecha: "2026-07-19",
    horario: "Domingo 09:00 — 10:00",
    counts: { present: 4, late: 1, absent: 0, sick: 0, competition: 0 },
    total: 5,
  },
];

/**
 * Every anchor OUTSIDE the rail whose href addresses a specific session.
 *
 * The rule this guards is about the HERO band: no state without today's
 * session may leave one of its `horario=` links behind. "Sesiones sin lista"
 * deliberately carries its own `horario=` links, into a DIFFERENT day's
 * roster each time — that is the whole feature, not a leak, so the rail is
 * excluded here rather than asserted empty.
 */
function horarioLinks(): HTMLAnchorElement[] {
  const elsewhere = ["trainer-lower", "trainer-today"].map((id) => document.querySelector(`[data-testid='${id}']`));
  return Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href*='horario=']")).filter(
    (link) => !elsewhere.some((region) => region?.contains(link)),
  );
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
    mockUseAuth.mockReset().mockReturnValue(createAuthenticatedAuth("trainer", "Carlos Mendoza"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("greets the trainer by first name and states role and date", async () => {
    render(<TrainerPage />);

    expect(await screen.findByRole("heading", { level: 1, name: "Hola, Carlos" })).toBeInTheDocument();
    expect(screen.getByText("Entrenador · lunes, 20 de julio de 2026")).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // The hero's states.
  // -------------------------------------------------------------------------

  it("'next': leads with the hour, the wait in words and the roster count", async () => {
    render(<TrainerPage />);

    const hero = within(await screen.findByTestId("session-hero"));
    expect(hero.getByText("Próxima sesión")).toBeInTheDocument();
    expect(hero.getByText("Empieza en 25 minutos")).toBeInTheDocument();
    expect(await hero.findByText("12 estudiantes inscritos")).toBeInTheDocument();
  });

  it("'next': the hero is one card with a bar counting down to the start", async () => {
    render(<TrainerPage />);

    const hero = await screen.findByTestId("session-hero");
    expect(hero.className).toContain("card");
    const bar = within(hero).getByRole("progressbar", { name: /cuenta regresiva/i });
    expect(Number(bar.getAttribute("aria-valuenow"))).toBeGreaterThan(80);
  });

  it("'next': the primary action names the session by its hour and calls the wizard's real query contract", async () => {
    render(<TrainerPage />);

    const hero = within(await screen.findByTestId("session-hero"));
    expect(hero.getByRole("link", { name: "Pasar lista de las 15:00" })).toHaveAttribute(
      "href",
      "/trainer/attendance?horario=1&paso=lista",
    );
    expect(hero.getByRole("link", { name: "Elegir otro horario" })).toHaveAttribute("href", "/trainer/attendance");
  });

  it("'next': names the enrolled students by first name, with a +N for the rest", async () => {
    mockFetchRosterDeTodosLosHorarios.mockResolvedValue(
      ["Ana Garcia", "Sofia Vera", "Luis Lopez", "Diego Mendoza", "Melany Quimis", "Pedro Salgado", "Maria Torres", "Jose Ruiz", "Rosa Mora", "Raul Paz"].map(
        (name) => ({ ...alumno(1), personaNombreCompleto: name }),
      ),
    );
    render(<TrainerPage />);

    const hero = within(await screen.findByTestId("session-hero"));
    const chips = await hero.findByRole("list", { name: "Alumnos inscritos" });
    expect(within(chips).getAllByRole("listitem")).toHaveLength(9);
    expect(within(chips).getByText("Ana")).toBeInTheDocument();
    expect(within(chips).getByText("+2 más")).toBeInTheDocument();
  });

  it("'next': summarises how the previous session of the same horario went", async () => {
    mockFetchAttendanceRecords.mockResolvedValue([
      { ...record("present", "Ana Garcia", "2026-07-13") },
      { ...record("late", "Sofia Vera", "2026-07-13") },
      { ...record("absent", "Luis Lopez", "2026-07-13") },
    ]);
    render(<TrainerPage />);

    const summary = await screen.findByTestId("hero-last-summary");
    expect(summary).toHaveTextContent("2 de 3 entrenaron");
  });

  it("'live': says the session is running and what has elapsed", async () => {
    vi.setSystemTime(new Date(2026, 6, 20, 15, 10));
    render(<TrainerPage />);

    const hero = within(await screen.findByTestId("session-hero"));
    expect(hero.getByText("Sesión en curso")).toBeInTheDocument();
    expect(hero.getByRole("progressbar", { name: /avance de la sesión/i })).toBeInTheDocument();
    expect(hero.getByRole("link", { name: "Pasar lista de las 15:00" })).toBeInTheDocument();
  });

  it("'done': no countdown and no session link in the hero once every session today has ended", async () => {
    vi.setSystemTime(new Date(2026, 6, 20, 21, 0));
    render(<TrainerPage />);

    const hero = within(await screen.findByTestId("session-hero"));
    expect(hero.getByText(/ya terminaron/)).toBeInTheDocument();
    expect(hero.getByRole("link", { name: "Elegir otro horario" })).toHaveAttribute("href", "/trainer/attendance");
    expect(hero.queryByRole("link", { name: /Pasar lista de las/ })).not.toBeInTheDocument();
    expect(horarioLinks()).toHaveLength(0);
  });

  it("rest day: says so, says why, offers the picker, and draws no timeline", async () => {
    mockFetchTrainingSchedules.mockResolvedValue([{ ...schedule(4, "09:00", "10:00"), diaSemana: "mar" }]);
    render(<TrainerPage />);

    expect(await screen.findByText("Hoy no hay entrenamientos")).toBeInTheDocument();
    expect(screen.getByText(/El club no tiene sesiones programadas para hoy, lunes\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Elegir otro horario" })).toHaveAttribute("href", "/trainer/attendance");
    expect(screen.queryByTestId("session-hero")).not.toBeInTheDocument();
    expect(screen.queryByTestId("timeline")).not.toBeInTheDocument();
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

    expect(screen.getByText("Cargando su día…")).toBeInTheDocument();
    expect(horarioLinks()).toHaveLength(0);
    resolveSchedules(TODAY_SCHEDULES);
    await screen.findByTestId("session-hero");
  });

  it("recovers from a failed load with a retry, and shows no session link while errored", async () => {
    mockFetchTrainingSchedules.mockRejectedValueOnce(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(<TrainerPage />);

    expect(await screen.findByText(/No se pudo cargar su día/)).toBeInTheDocument();
    expect(horarioLinks()).toHaveLength(0);

    mockFetchTrainingSchedules.mockResolvedValue(TODAY_SCHEDULES);
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByTestId("session-hero")).toBeInTheDocument();
  });

  it("does not block the hero's countdown when the roster fails to load", async () => {
    mockFetchRosterDeTodosLosHorarios.mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(<TrainerPage />);

    const hero = within(await screen.findByTestId("session-hero"));
    expect(hero.getByText("Empieza en 25 minutos")).toBeInTheDocument();
    expect(hero.queryByText(/estudiantes inscritos/)).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Hoy — the day on the shared timeline.
  // -------------------------------------------------------------------------

  it("draws today's sessions on the timeline, none of another day's, each linking into the wizard", async () => {
    render(<TrainerPage />);

    const today = within(await screen.findByTestId("trainer-today"));
    const blocks = today.getAllByTestId("timeline-block");
    expect(blocks).toHaveLength(3);
    expect(blocks[0].getAttribute("href")).toBe("/trainer/attendance?horario=1&paso=lista");
    expect(today.getByTestId("timeline-summary")).toHaveTextContent("1 de 3 listas tomadas");
  });

  it("offers the same day as a vertical list for a phone, where the track is cut off (ENT-12)", async () => {
    render(<TrainerPage />);

    const today = within(await screen.findByTestId("trainer-today"));
    const rows = today.getAllByTestId("today-list-row");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("Lista tomada");
    expect(rows[0].getAttribute("href")).toBe("/trainer/attendance?horario=1&paso=lista");
    expect(today.getByTestId("today-list")).toHaveClass("sm:hidden");
  });

  it("colours the blocks by group and marks the clock with the 'ahora' line", async () => {
    render(<TrainerPage />);

    const today = within(await screen.findByTestId("trainer-today"));
    // The page reads the clock in the club's time zone, so the expected label
    // must too; NOW is built in the runner's local time.
    const clubClock = new Intl.DateTimeFormat("en-GB", {
      timeZone: CLUB_TIME_ZONE,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(NOW);
    expect(today.getByTestId("timeline-now-label")).toHaveTextContent(`Ahora ${clubClock}`);
    expect(today.getAllByTestId("timeline-block")[0]).toHaveAttribute("data-status", "done");
    expect(today.getAllByTestId("timeline-block")[1]).toHaveAttribute("data-status", "pending");
  });

  // -------------------------------------------------------------------------
  // Trend, students to follow, recent lists.
  // -------------------------------------------------------------------------

  it("reads the trend as quienes entrenaron — presentes MÁS tardanzas — over the records", async () => {
    render(<TrainerPage />);

    const trend = within(await screen.findByTestId("attendance-trend"));
    // 3 of 7 records trained (present ×2, late ×1, sick ×1 and absent ×3 do not).
    expect(trend.getByText(/3 de 7 registros/)).toBeInTheDocument();
    expect(trend.getByRole("group", { name: /Asistencia de las últimas 6 semanas/ })).toBeInTheDocument();
  });

  it("says so in one line when there is no attendance yet", async () => {
    mockFetchAttendanceRecords.mockResolvedValue([]);
    render(<TrainerPage />);

    const trend = within(await screen.findByTestId("attendance-trend"));
    expect(trend.getByText("Sin asistencias recientes")).toBeInTheDocument();
    expect(trend.queryByTestId("bars")).toBeNull();
  });

  it("lists the students to follow with their absence count and a dot per session", async () => {
    render(<TrainerPage />);

    const block = await screen.findByTestId("students-to-follow");
    expect(within(block).getByText("Luis Lopez")).toBeInTheDocument();
    expect(within(block).getByText("3 ausencias")).toBeInTheDocument();
    expect(within(block).getByRole("img", { name: /Últimas asistencias de Luis Lopez/ })).toBeInTheDocument();
  });

  it("says nobody needs follow-up instead of hiding the block", async () => {
    mockFetchAttendanceRecords.mockResolvedValue([record("present", "Sofia Vera")]);
    render(<TrainerPage />);

    const block = await screen.findByTestId("students-to-follow");
    expect(within(block).getByText("Nadie necesita seguimiento")).toBeInTheDocument();
  });

  it("tells the trainer the recent lists failed to load, and retries", async () => {
    mockFetchRecentAttendanceSessions.mockRejectedValueOnce(new Error("boom")).mockResolvedValue(RECENT_SESSIONS);
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<TrainerPage />);

    const notice = await screen.findByText(/no se pudieron cargar las últimas listas/i);
    expect(screen.queryByText("Todavía no hay listas registradas")).toBeNull();
    fireEvent.click(within(notice.closest("[role=status]") as HTMLElement).getByRole("button", { name: /reintentar/i }));
    expect(await screen.findByText("Domingo 09:00 — 10:00")).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Sesiones sin lista.
  //
  // TODAY_SCHEDULES puts schedules 1/2/3 on every Monday and schedule 4 on
  // every Tuesday; MONTH_RECORDS only ever files schedule 1. Within the
  // month-to-date window (2026-07-01..20) that leaves schedules 2 and 3
  // without a list on the 6th and 13th, and schedule 4 without one on the
  // 7th and 14th — six sessions, newest first, capped at five.
  // -------------------------------------------------------------------------

  it("keeps an always-visible 'Cómo funciona su día' guide in the rail", async () => {
    render(<TrainerPage />);

    const guide = await screen.findByRole("complementary", { name: "Cómo funciona su día" });
    expect(within(screen.getByTestId("trainer-rail")).getByText("Cómo funciona su día")).toBeInTheDocument();
    expect(guide).toHaveTextContent("Sesiones sin lista");
  });

  it("lists the month's sessions that never got a list, newest first and capped at five, each linking into the wizard", async () => {
    render(<TrainerPage />);

    expect(await screen.findByText("Sesiones sin lista")).toBeInTheDocument();

    // Scoped to the rail: the sidebar carries its own bare "Pasar lista" nav
    // row, sharing this exact accessible name but pointing at no session.
    const rail = within(screen.getByTestId("trainer-lower"));
    const links = rail.getAllByRole("link", { name: /^(Pasar|Completar) lista$/ });
    // The 6th's schedule 2 (the oldest of the six) falls off the cap.
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/trainer/attendance?horario=4&fecha=2026-07-14&paso=lista",
      "/trainer/attendance?horario=3&fecha=2026-07-13&paso=lista",
      "/trainer/attendance?horario=2&fecha=2026-07-13&paso=lista",
      // Schedule 1 was filed on the 13th, but with 1 record of 12 enrolled:
      // an incomplete list is pending too (ENT-13).
      "/trainer/attendance?horario=1&fecha=2026-07-13&paso=lista",
      "/trainer/attendance?horario=4&fecha=2026-07-07&paso=lista",
    ]);
    expect(rail.getByText("1 de 12 registrados")).toBeInTheDocument();
    expect(rail.getByRole("link", { name: "Completar lista" })).toBeInTheDocument();
    // The full count reaches the footer even though only five rows show.
    expect(screen.getByText(/sesiones sin lista o incompletas este mes/)).toHaveTextContent(/^8 sesiones/);
    expect(
      screen.getByText(/Estimación: se compara contra el horario semanal/),
    ).toBeInTheDocument();
  });

  it("does not claim every list is complete when enrolment could not be read (ENT-13)", async () => {
    mockFetchRosterDeTodosLosHorarios.mockRejectedValue(new Error("boom"));
    mockFetchTrainingSchedules.mockResolvedValue([{ id: 9, diaSemana: "vie" as const, horaInicio: "17:00", horaFin: "18:30" }]);
    mockFetchAttendanceRecords.mockResolvedValue(
      ["2026-07-03", "2026-07-10", "2026-07-17"].map((fecha, i) => ({
        id: `v-${i}`,
        fecha,
        horario: "Viernes 17:00 — 18:30",
        horarioId: 9,
        personaId: 1,
        estudiante: "Sofia Vera",
        estado: "present" as const,
      })),
    );

    render(<TrainerPage />);

    expect(await screen.findByText(/No se pudo comprobar si las listas están completas/)).toBeInTheDocument();
    expect(screen.queryByText(/Todas las sesiones del mes tienen lista/)).not.toBeInTheDocument();
  });

  it("shows a positive empty state when every scheduled session already has a list", async () => {
    const FRIDAY_ONLY = [{ id: 9, diaSemana: "vie" as const, horaInicio: "17:00", horaFin: "18:30" }];
    mockFetchTrainingSchedules.mockResolvedValue(FRIDAY_ONLY);
    mockFetchAttendanceRecords.mockResolvedValue(
      ["2026-07-03", "2026-07-10", "2026-07-17"].map((fecha, i) => ({
        id: `v-${i}`,
        fecha,
        horario: "Viernes 17:00 — 18:30",
        horarioId: 9,
        personaId: 1,
        estudiante: "Sofia Vera",
        estado: "present" as const,
      })),
    );

    render(<TrainerPage />);

    expect(
      await screen.findByText(/Todas las sesiones del mes tienen lista/),
    ).toBeInTheDocument();
    // Scoped to the rail: the sidebar's own bare "Pasar lista" nav row shares
    // this exact accessible name and is unrelated to the empty state.
    const rail = within(screen.getByTestId("trainer-lower"));
    expect(rail.queryByRole("link", { name: "Pasar lista" })).not.toBeInTheDocument();
  });
});

describe("TrainerPage — defers attendance API calls until the role resolves", () => {
  beforeEach(() => {
    mockFetchTrainingSchedules.mockReset().mockResolvedValue(TODAY_SCHEDULES);
    mockFetchAttendanceRecords.mockReset().mockResolvedValue(MONTH_RECORDS);
    mockFetchRosterDeTodosLosHorarios.mockReset().mockResolvedValue(ROSTER);
    mockFetchRecentAttendanceSessions.mockReset().mockResolvedValue(RECENT_SESSIONS);
  });

  it("does not request attendance data while the session is still hydrating", async () => {
    mockUseAuth.mockReturnValue(createLoadingAuth());

    render(<TrainerPage />);

    await waitFor(() => expect(mockFetchAttendanceRecords).not.toHaveBeenCalled());
    expect(mockFetchRecentAttendanceSessions).not.toHaveBeenCalled();
  });

  it("does not request attendance data for a resolved non-trainer role", async () => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("estudiante"));

    render(<TrainerPage />);

    await waitFor(() => expect(mockFetchAttendanceRecords).not.toHaveBeenCalled());
    expect(mockFetchRecentAttendanceSessions).not.toHaveBeenCalled();
  });

  it("requests attendance data once the trainer role has resolved", async () => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("trainer", "Carlos Mendoza"));

    render(<TrainerPage />);

    await waitFor(() => expect(mockFetchAttendanceRecords).toHaveBeenCalled());
    expect(mockFetchRecentAttendanceSessions).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Issue #346 (regresión de #308 + #310): antes de K1, "la fecha de la sesión"
// y "hoy" eran siempre el mismo valor. Separarlas en la escritura dejó
// expuesta cualquier lectura que todavía asumiera que coinciden -- este
// candado cubre el pulso mensual de "Mi día", el primer punto del triángulo
// junto con "Historial" y el detalle propio de la sesión.
//
// `MONTH_RECORDS` arriba siempre vuelve igual sin mirar el rango que
// `monthToDateRange()` construye, así que ese test no puede distinguir un
// rango correcto de uno roto. Este bloque filtra por el rango recibido --
// como el backend real filtra por `fecha_entrenamiento` -- para que la
// aserción solo pase si la pantalla realmente pide un rango que alcance la
// sesión, no solo hoy.
// ---------------------------------------------------------------------------

describe("TrainerPage — el pulso mensual no pierde una sesión de días antes (issue #346)", () => {
  const SUNDAY_IN_CLUB_TIME = new Date("2026-08-16T15:00:00Z");
  const WEDNESDAY_SESSION_DATE = "2026-08-12";

  const CLOSED_WEDNESDAY_SESSION: AttendanceRecord[] = Array.from({ length: 15 }, (_, i) => ({
    id: `w-${i}`,
    fecha: WEDNESDAY_SESSION_DATE,
    horario: "Miércoles 17:00 — 18:00",
    horarioId: 30,
    personaId: i,
    estudiante: `Alumno ${i + 1}`,
    estado: "present" as const,
    registradoPorNombre: "Coach Vera",
  }));

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(SUNDAY_IN_CLUB_TIME);
    // Domingo no tiene horarios propios en este fixture -- el hero queda en
    // su estado vacío, y el pulso mensual es lo único bajo prueba acá.
    mockFetchTrainingSchedules.mockReset().mockResolvedValue([]);
    mockFetchRosterDeTodosLosHorarios.mockReset().mockResolvedValue([]);
    mockFetchRecentAttendanceSessions.mockReset().mockResolvedValue([]);
    mockUseAuth.mockReset().mockReturnValue(createAuthenticatedAuth("trainer", "Carlos Mendoza"));
    // Un rango de verdad: solo vuelven los registros cuya PROPIA `fecha` cae
    // dentro de [fechaInicio, fechaFin]. Un llamado que (por error) pidiera
    // solo la fecha de hoy no recibiría nada de esta sesión.
    mockFetchAttendanceRecords.mockReset().mockImplementation(
      (params?: { fechaInicio?: string; fechaFin?: string }) =>
        Promise.resolve(
          CLOSED_WEDNESDAY_SESSION.filter((r) => {
            if (params?.fechaInicio && r.fecha < params.fechaInicio) return false;
            if (params?.fechaFin && r.fecha > params.fechaFin) return false;
            return true;
          }),
        ),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("cuenta los 15 registros de la sesión del miércoles en el pulso del mes, visto un domingo (candado #346)", async () => {
    render(<TrainerPage />);

    const trend = within(await screen.findByTestId("attendance-trend"));
    // Los 15 registros de la sesión del miércoles entran en la tendencia: una
    // fecha mal resuelta los dejaría fuera y la tendencia diría "sin asistencias".
    expect(await trend.findByText(/15 de 15 registros/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Dashboard reorganisation: context line, clickable pulse, "Alumnos a seguir",
// and a recent-lists failure that says so.
// ---------------------------------------------------------------------------
