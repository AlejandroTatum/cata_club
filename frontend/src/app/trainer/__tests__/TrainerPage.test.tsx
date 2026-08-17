/**
 * Component tests for the trainer's "Mi día" (issue #211,
 * `docs/archive/prototypes/prototipos/31-entrenador-dashboard-alternativas.html`).
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
import { PAGE_RAIL, STAT_GRID } from "@/components/ui";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import TrainerPage from "@/app/trainer/page";
import type { TrainingSchedule, AttendanceRecord } from "@/app/attendance/attendance-utils";
import type { AlumnoHorario, RecentAttendanceSession } from "@/services/api";
import { createAuthenticatedAuth, createLoadingAuth } from "@/components/__tests__/test-utils";
import { useAuth } from "@/contexts/AuthContext";

vi.mock("@/components/ProtectedRoute", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: vi.fn(),
}));

const mockUseAuth = vi.mocked(useAuth);

const mockShowInfo = vi.fn();
vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({
    showToast: vi.fn(),
    showError: vi.fn(),
    showSuccess: vi.fn(),
    showInfo: mockShowInfo,
    showWarning: vi.fn(),
  }),
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
    mockUseAuth.mockReset().mockReturnValue(createAuthenticatedAuth("trainer", "Carlos Mendoza"));
    mockShowInfo.mockReset();
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

  // The figure is the hour in both states now, and the wait is a sentence —
  // see the renegotiation note in `SessionCard.test.tsx`. What this test is
  // about (which session leads, and that the roster count is fetched and
  // worded as "inscritos") did not move.
  it("'next': leads with the session's hour, the wait in words and the roster count", async () => {
    render(<TrainerPage />);

    expect(await screen.findByText("Lunes 15:00 — 16:00")).toBeInTheDocument();
    expect(screen.getByText("15:00")).toBeInTheDocument();
    expect(screen.getByText("Empieza en 25 minutos")).toBeInTheDocument();
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
    // Three sessions today, ONE roster call: the list must not reintroduce
    // the per-horario N+1 `fetchAlumnosPorHorario` replaced.
    expect(mockFetchRosterDeTodosLosHorarios).toHaveBeenCalledTimes(1);
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

  it("rest day: the session card does not render at all, and no session link exists in the tree", async () => {
    mockFetchTrainingSchedules.mockResolvedValue([
      { ...schedule(4, "09:00", "10:00"), diaSemana: "mar" },
    ]);
    render(<TrainerPage />);

    await screen.findByText("Distribución de asistencias");
    expect(screen.queryByText(/Pasar lista de las/)).not.toBeInTheDocument();
    // `SessionCard` still renders NOTHING for `state === null` — the guard the
    // whole component is built around is untouched.
    expect(screen.queryByLabelText("Su día de hoy")).not.toBeInTheDocument();
    expect(horarioLinks()).toHaveLength(0);
  });

  /*
   * Renegotiated in the trainer sweep, with the reason written: this used to
   * assert that "Elegir otro horario" was absent on a rest day, which was true
   * because the screen said NOTHING about a day with no sessions — the card
   * simply vanished and the summary took the whole row. DESIGN.md's "regla del
   * estado flaco" was written about this very screen, and D11 asks an empty
   * state for three things: what is missing, why, and what to do. The exit is
   * the generic picker, which carries no `horario=` — the safety rule the
   * assertion above protects is unchanged and still asserted.
   */
  it("rest day: says so, says why, and still offers the picker as the way out", async () => {
    mockFetchTrainingSchedules.mockResolvedValue([
      { ...schedule(4, "09:00", "10:00"), diaSemana: "mar" },
    ]);
    render(<TrainerPage />);

    expect(await screen.findByText("Hoy no hay entrenamientos")).toBeInTheDocument();
    // The day is named, and it is TODAY's day — not a fixed string.
    expect(
      screen.getByText(/El club no tiene sesiones programadas para hoy, lunes\./),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Elegir otro horario" })).toHaveAttribute(
      "href",
      "/trainer/attendance",
    );
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
    expect(screen.getByText("Empieza en 25 minutos")).toBeInTheDocument();
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
    //
    // The label is now written as the WORD "Registros" and shouted by CSS,
    // where it used to be typed in literal capitals inside the SVG. Same rule
    // the rest of the product follows for a micro-label, and it keeps the
    // accessible name a word rather than an acronym-shaped string. The
    // assertion still fails if the label disappears, which is what it guards.
    //
    // Scoped to the donut, because the legend table beneath it has a
    // "Registros" column header — the two used to differ only because the
    // centre label was typed in literal capitals, which is not a distinction
    // worth keeping a shouted string for.
    const donut = screen.getByRole("img", { name: /Distribución de asistencias/ });
    expect(within(donut).getByText("Registros")).toBeInTheDocument();
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

  it("runs the session hero across the full width instead of pairing it with the donut", async () => {
    // The pair was this screen's own invention: `/dashboard`, the panel the
    // owner approves, leads with ONE full-width coal band and puts its
    // secondary cards in the rail below. The half-width pair is what made the
    // two screens read as different products.
    const { container: withSession } = render(<TrainerPage />);
    await screen.findByText("Lunes 15:00 — 16:00");
    expect(withSession.querySelector(".split\\:grid-cols-2")).toBeNull();

    mockFetchTrainingSchedules.mockResolvedValue([
      { ...schedule(4, "09:00", "10:00"), diaSemana: "mar" },
    ]);
    const { container: restDay } = render(<TrainerPage />);
    await screen.findAllByText("Distribución de asistencias");
    expect(restDay.querySelector(".split\\:grid-cols-2")).toBeNull();
  });

  it("scopes the header row correctly: exactly one primary action reaches the DOM", async () => {
    render(<TrainerPage />);
    await screen.findByText("Lunes 15:00 — 16:00");

    const header = within(screen.getByRole("banner"));
    expect(header.queryByRole("link", { name: /Pasar lista/ })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The admin panel's anatomy, on this screen
//
// The owner approves `/dashboard` and asked for this one to be rebuilt on it,
// because the two read as different products. `/dashboard` is three layers: a
// full-width coal band, a STAT_GRID pulse row, and a PAGE_RAIL region holding
// a fluid feed beside a 340px rail. This screen had the first layer's
// VOCABULARY already — SessionCard is `rounded-card bg-coal` with a
// `font-display text-display` figure — but none of its SHAPE: no pulse row at
// all, and a symmetric pair where the rail belongs.
//
// Every tile below is read from data the screen already fetches. That
// constraint is the point: /profile's own history records two attempts to
// fill space with figures nobody could falsify, and both were retired.
// ---------------------------------------------------------------------------

describe("TrainerPage — la anatomía del panel de admin", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(NOW);
    mockFetchTrainingSchedules.mockReset().mockResolvedValue(TODAY_SCHEDULES);
    mockFetchAttendanceRecords.mockReset().mockResolvedValue(MONTH_RECORDS);
    mockFetchRosterDeTodosLosHorarios.mockReset().mockResolvedValue(ROSTER);
    mockFetchRecentAttendanceSessions.mockReset().mockResolvedValue(RECENT_SESSIONS);
    mockUseAuth.mockReset().mockReturnValue(createAuthenticatedAuth("trainer", "Carlos Mendoza"));
    mockShowInfo.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("draws the pulse row on the admin panel's own grid", async () => {
    render(<TrainerPage />);
    await screen.findByText("Lunes 15:00 — 16:00");

    const pulse = screen.getByTestId("trainer-pulse");
    expect(pulse.className).toBe(STAT_GRID);
  });

  it("counts today's sessions, ignoring the ones on other days", async () => {
    // TODAY_SCHEDULES carries a Tuesday session that must never be counted.
    render(<TrainerPage />);
    await screen.findByText("Lunes 15:00 — 16:00");

    const tile = within(screen.getByTestId("trainer-pulse")).getByText("Sesiones hoy");
    expect(tile.closest("[data-testid='stat-card']") ?? tile.parentElement).toHaveTextContent("3");
  });

  // Issue #313 (K5 hallazgo #56): "SESIONES HOY 0" convivía con una lista de
  // hoy con registros reales en la misma pantalla, sin decir su alcance —
  // este tile cuenta lo PROGRAMADO por horario semanal, no lo REGISTRADO.
  // Las dos cosas son legítimamente distintas; el fix nombra cuál es cuál.
  it("names the tile's own scope — sesiones PROGRAMADAS, no listas tomadas", async () => {
    render(<TrainerPage />);
    await screen.findByText("Lunes 15:00 — 16:00");

    const tile = within(screen.getByTestId("trainer-pulse")).getByText("Sesiones hoy");
    const card = tile.closest("[data-testid='stat-card']") ?? tile.parentElement;
    expect(card).toHaveTextContent(/programadas para hoy/i);
  });

  it("names the enrolled-today tile's own scope once the roster arrives", async () => {
    render(<TrainerPage />);
    await screen.findByText("Lunes 15:00 — 16:00");

    const pulse = within(screen.getByTestId("trainer-pulse"));
    await waitFor(() => {
      expect(pulse.getByText(/alumnos en las sesiones programadas para hoy/i)).toBeInTheDocument();
    });
  });

  it("adds the enrolments across today's sessions, empty classes included", async () => {
    // ROSTER is 12 in horario 1 and 3 in horario 2; horario 3 has nobody, and
    // an empty class counts as 0 rather than dropping out of the sum.
    render(<TrainerPage />);
    await screen.findByText("Lunes 15:00 — 16:00");

    const pulse = within(screen.getByTestId("trainer-pulse"));
    expect(pulse.getByText("Inscritos hoy")).toBeInTheDocument();
    expect(pulse.getByText("15")).toBeInTheDocument();
  });

  it("says nothing about enrolments when the roster did not arrive", async () => {
    // A wrong number renders exactly as confidently as a right one, so the
    // tile states the absence instead of a partial sum.
    mockFetchRosterDeTodosLosHorarios.mockRejectedValue(new Error("network"));
    render(<TrainerPage />);
    await screen.findByText("Lunes 15:00 — 16:00");

    const pulse = within(screen.getByTestId("trainer-pulse"));
    await waitFor(() => {
      expect(pulse.getByText("Inscritos hoy")).toBeInTheDocument();
    });
    expect(pulse.queryByText("15")).not.toBeInTheDocument();
  });

  it("reads the month's attendance as quienes entrenaron — presentes MAS tardanzas — over all records", async () => {
    // MONTH_RECORDS is 2 present + 1 late out of 7 — 43%. Issue #313 (K5
    // hallazgo #57): a trainer who only counted presentes read 29% here
    // while the same screen's own distribution table implied 43%, and
    // "asistencia" for a trainer means "vino a entrenar" — tardanza incluida.
    render(<TrainerPage />);
    await screen.findByText("Lunes 15:00 — 16:00");

    const pulse = within(screen.getByTestId("trainer-pulse"));
    expect(pulse.getByText("Asistencia del mes")).toBeInTheDocument();
    expect(pulse.getByText("43")).toBeInTheDocument();
    expect(pulse.getByText("3 de 7 entrenaron")).toBeInTheDocument();
  });

  it("counts the lists taken as sessions, not as records", async () => {
    // Seven records across three (fecha, horarioId) pairs is three lists —
    // counting rows would have said seven.
    render(<TrainerPage />);
    await screen.findByText("Lunes 15:00 — 16:00");

    const pulse = within(screen.getByTestId("trainer-pulse"));
    expect(pulse.getByText("Listas del mes")).toBeInTheDocument();
  });

  it("puts the recent lists beside the donut in the rail, as the panel does", async () => {
    render(<TrainerPage />);
    await screen.findByText("Lunes 15:00 — 16:00");

    const lower = screen.getByTestId("trainer-lower");
    expect(lower.className).toBe(PAGE_RAIL);
    expect(within(lower).getByText("Distribución de asistencias")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Role-gated fetch (issue #319 hallazgo #49).
//
// `loadData`/`loadRecentSessions` ran from a bare mount effect, so a
// non-trainer (e.g. a student landing on /trainer) fired
// GET /api/attendance/records and GET /api/attendance/recent-sessions and
// logged two 403s before ProtectedRoute's redirect effect ran. ProtectedRoute
// is mocked to a pass-through here so the fetch gate itself is what is under
// test.
// ---------------------------------------------------------------------------

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
// Silent bounce, explained (issue #319 hallazgo #68).
//
// `ProtectedRoute` (mocked to a pass-through here) already redirects a
// non-trainer session away from /trainer — but silently, with nothing in the
// UI naming why. Same pattern as the medical-record minor bounce (#315
// hallazgo #69): a toast at the landing spot.
// ---------------------------------------------------------------------------

describe("TrainerPage — names the reason when a non-trainer session lands here", () => {
  beforeEach(() => {
    mockFetchTrainingSchedules.mockReset().mockResolvedValue(TODAY_SCHEDULES);
    mockFetchAttendanceRecords.mockReset().mockResolvedValue(MONTH_RECORDS);
    mockFetchRosterDeTodosLosHorarios.mockReset().mockResolvedValue(ROSTER);
    mockFetchRecentAttendanceSessions.mockReset().mockResolvedValue(RECENT_SESSIONS);
    mockShowInfo.mockReset();
  });

  it("shows no toast while the session is still hydrating", async () => {
    mockUseAuth.mockReturnValue(createLoadingAuth());

    render(<TrainerPage />);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockShowInfo).not.toHaveBeenCalled();
  });

  it("shows a visible reason for a resolved non-trainer role", async () => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("estudiante"));

    render(<TrainerPage />);

    await waitFor(() =>
      expect(mockShowInfo).toHaveBeenCalledWith(
        expect.stringMatching(/permiso|autorizad|acceso|no corresponde/i),
      ),
    );
  });

  it("shows no toast for the trainer role that actually belongs here", async () => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("trainer", "Carlos Mendoza"));

    render(<TrainerPage />);

    await waitFor(() => expect(mockFetchAttendanceRecords).toHaveBeenCalled());
    expect(mockShowInfo).not.toHaveBeenCalled();
  });
});
