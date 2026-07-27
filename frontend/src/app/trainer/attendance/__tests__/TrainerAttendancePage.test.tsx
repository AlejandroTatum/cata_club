/**
 * Component tests for TrainerAttendancePage's admin access (PR8).
 * Backend already allows admins to register attendance; the frontend gate
 * was too narrow. Uses the REAL `ProtectedRoute` (not mocked) so the gate
 * itself is what's under test.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import TrainerAttendancePage from "@/app/trainer/attendance/page";
import { createAuthenticatedAuth } from "@/components/__tests__/test-utils";
import { ToastProvider } from "@/contexts/ToastContext";
import ToastContainer from "@/components/ToastContainer";

const mockReplace = vi.fn();
/** Stable, so the "asks before leaving" test can see where it was sent. */
const mockPush = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/trainer/attendance",
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/image", () => ({
  __esModule: true,
  // eslint-disable-next-line @next/next/no-img-element
  default: (props: Record<string, unknown>) => <img alt="" {...props} />,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from "@/contexts/AuthContext";
const mockUseAuth = vi.mocked(useAuth);

/**
 * A trainer whose session id is a real persona id. `resolveEntrenadorId`
 * parses it with `Number(...)`, and a non-numeric id resolves to `null`, which
 * disables "Confirmar Asistencia" — so any test that files a session needs it.
 */
function trainerAuthWithPersonaId(id = "17"): ReturnType<typeof createAuthenticatedAuth> {
  const auth = createAuthenticatedAuth("trainer", "Coach Torres");
  if (auth.session) auth.session.user.id = id;
  return auth;
}

/**
 * The wizard keeps an in-progress draft in `sessionStorage`, keyed by horario
 * + date — which jsdom shares across every test in this file. Without this,
 * one test's marks would be restored into the next one's roster and the
 * "nobody starts reviewed" guarantee would look broken when it is not.
 */
beforeEach(() => {
  window.sessionStorage.clear();
  // The wizard's step now lives in the query string, and jsdom keeps ONE
  // `window.location` for the whole file — a test that walked to step 2 would
  // otherwise hand the next one a URL that restores straight into the roll
  // call. Each test starts at the flow's front door, like a trainer opening
  // the screen from the panel.
  window.history.replaceState(null, "", "/trainer/attendance");
});

/**
 * A Tuesday, 10:00 in Guayaquil — deliberately a day NO fixture in this file
 * schedules on (they use lun/mie/vie).
 *
 * The picker defaults to today's schedules and auto-expands that day's panel,
 * which makes every test here clock-dependent: the fixtures are reached by
 * clicking a day header to expand it, and on a day the fixture falls on that
 * panel is already open — the click would COLLAPSE it and the schedule button
 * would never be found. Landing on an empty day means the picker falls back to
 * the full week, which is the state these tests were written against. Without
 * this pin they are green six days a week and red on the seventh.
 */
const TUESDAY_IN_CLUB_TIME = new Date("2026-07-21T15:00:00Z");

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(TUESDAY_IN_CLUB_TIME);
});

afterEach(() => {
  vi.useRealTimers();
});

const mockFetchTrainingSchedules = vi.fn().mockResolvedValue([]);
const mockFetchAlumnosPorHorario = vi.fn().mockResolvedValue([]);
const mockFetchAttendanceRecords = vi.fn().mockResolvedValue([]);
const mockRegisterAttendance = vi.fn();

vi.mock("@/services/api", () => ({
  fetchTrainingSchedules: () => mockFetchTrainingSchedules(),
  fetchAlumnosPorHorario: (horarioId: number) => mockFetchAlumnosPorHorario(horarioId),
  fetchAttendanceRecords: (params?: unknown) => mockFetchAttendanceRecords(params),
  registerAttendance: (request: unknown) => mockRegisterAttendance(request),
  fetchNotificaciones: vi.fn().mockResolvedValue([]),
  marcarNotificacionLeida: vi.fn().mockResolvedValue(undefined),
}));

// camelCase — mirrors the real backend contract (`AlumnoHorarioDetalleDTO`
// inherits `ResponseBase`, serialized camelCase server-side).
const ANA_ALUMNO_HORARIO = {
  id: 1,
  personaId: 9,
  personaNombreCompleto: "Ana López",
  horarioId: 12,
  horarioDia: "lun",
  horarioHoraInicio: "18:00",
  horarioHoraFin: "19:00",
  fechaAsignacion: "2026-01-01",
};

describe("TrainerAttendancePage — role gate (PR8)", () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockFetchTrainingSchedules.mockResolvedValue([]);
    mockFetchAlumnosPorHorario.mockResolvedValue([]);
    mockFetchAttendanceRecords.mockReset().mockResolvedValue([]);
    mockRegisterAttendance.mockReset();
  });

  it.each([
    ["admin", "Admin User"],
    ["trainer", "Coach Torres"],
  ] as const)("grants access to role=%s instead of redirecting away", async (role, name) => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth(role, name));

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);

    expect(await screen.findByText("Seleccione el horario de entrenamiento:")).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("redirects a role with no attendance access (e.g. representante) away", async () => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("representante", "Representante User"));

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/student"));
    expect(screen.queryByText("Seleccione el horario de entrenamiento:")).not.toBeInTheDocument();
  });

  it("lets a trainer directly select each visibly labeled attendance state", async () => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("trainer", "Coach Torres"));
    mockFetchTrainingSchedules.mockResolvedValue([
      { id: 12, diaSemana: "lun", horaInicio: "18:00", horaFin: "19:00", entrenadorId: 17, entrenadorNombre: "Coach Torres" },
    ]);
    mockFetchAlumnosPorHorario.mockResolvedValue([ANA_ALUMNO_HORARIO]);

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);

    fireEvent.click(await screen.findByRole("button", { name: /^lunes/i }));
    fireEvent.click(await screen.findByRole("button", { name: /18:00/i }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));

    const stateSelector = await screen.findByRole("radiogroup", { name: "Estado de asistencia de Ana López" });
    expect(within(stateSelector).getByRole("radio", { name: "Presente" })).toBeVisible();
    expect(within(stateSelector).getByRole("radio", { name: "Ausente" })).toBeVisible();
    expect(within(stateSelector).getByRole("radio", { name: "Tardanza" })).toBeVisible();
    const justified = within(stateSelector).getByRole("radio", { name: "Justificado" });

    fireEvent.click(justified);

    expect(justified).toHaveAttribute("aria-checked", "true");
  });

  it("submits the existing justified state mapping after direct selection", async () => {
    const trainerAuth = createAuthenticatedAuth("trainer", "Coach Torres");
    if (trainerAuth.session) trainerAuth.session.user.id = "17";
    mockUseAuth.mockReturnValue(trainerAuth);
    mockFetchTrainingSchedules.mockResolvedValue([
      { id: 12, diaSemana: "lun", horaInicio: "18:00", horaFin: "19:00", entrenadorId: 17, entrenadorNombre: "Coach Torres" },
    ]);
    mockFetchAlumnosPorHorario.mockResolvedValue([ANA_ALUMNO_HORARIO]);
    mockRegisterAttendance.mockResolvedValue({ createdCount: 1, failed: [] });

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);

    fireEvent.click(await screen.findByRole("button", { name: /^lunes/i }));
    fireEvent.click(await screen.findByRole("button", { name: /18:00/i }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    const stateSelector = await screen.findByRole("radiogroup", { name: "Estado de asistencia de Ana López" });
    fireEvent.click(within(stateSelector).getByRole("radio", { name: "Justificado" }));
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar Asistencia" }));

    await waitFor(() => {
      expect(mockRegisterAttendance).toHaveBeenCalledWith(expect.objectContaining({
        horarioId: 12,
        students: [{ personaId: 9, estado: "justified" }],
      }));
    });
  });

  it("shows the horario descriptor (día + rango) and no nivel/grupo text on mark-attendance and confirm", async () => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("trainer", "Coach Torres"));
    mockFetchTrainingSchedules.mockResolvedValue([
      { id: 12, diaSemana: "lun", horaInicio: "18:00", horaFin: "19:00", entrenadorId: 17, entrenadorNombre: "Coach Torres" },
    ]);
    mockFetchAlumnosPorHorario.mockResolvedValue([ANA_ALUMNO_HORARIO]);

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    fireEvent.click(await screen.findByRole("button", { name: /^lunes/i }));
    fireEvent.click(await screen.findByRole("button", { name: /18:00/i }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));

    await screen.findByText("Ana López");
    expect(screen.getByText("Lunes")).toBeInTheDocument();
    expect(screen.queryByText(/Nivel \d/)).not.toBeInTheDocument();
    expect(screen.queryByText("Grupo")).not.toBeInTheDocument();

    // The roster now starts unmarked, so the wizard will not advance until
    // every student carries a real state.
    const stateSelector = screen.getByRole("radiogroup", { name: /Ana López/ });
    fireEvent.click(within(stateSelector).getByRole("radio", { name: "Presente" }));
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    expect(await screen.findByText("Horario")).toBeInTheDocument();
    expect(screen.getAllByText("Lunes", { exact: false }).length).toBeGreaterThan(0);
    expect(screen.queryByText("Grupo")).not.toBeInTheDocument();
    expect(screen.queryByText(/Nivel \d/)).not.toBeInTheDocument();
  });

  it("shows an explanatory empty state and blocks final submit when the horario has no assigned alumnos", async () => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("trainer", "Coach Torres"));
    mockFetchTrainingSchedules.mockResolvedValue([
      { id: 12, diaSemana: "lun", horaInicio: "18:00", horaFin: "19:00", entrenadorId: 17, entrenadorNombre: "Coach Torres" },
    ]);
    mockFetchAlumnosPorHorario.mockResolvedValue([]);

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    fireEvent.click(await screen.findByRole("button", { name: /^lunes/i }));
    fireEvent.click(await screen.findByRole("button", { name: /18:00/i }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));

    expect(await screen.findByText("Este horario no tiene alumnos asignados.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Siguiente" })).toBeDisabled();
  });

  it("pre-selects Presente for a student who already has an attendance record for today's date + this horario", async () => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("trainer", "Coach Torres"));
    mockFetchTrainingSchedules.mockResolvedValue([
      { id: 12, diaSemana: "lun", horaInicio: "18:00", horaFin: "19:00", entrenadorId: 17, entrenadorNombre: "Coach Torres" },
    ]);
    mockFetchAlumnosPorHorario.mockResolvedValue([ANA_ALUMNO_HORARIO]);
    mockFetchAttendanceRecords.mockResolvedValue([
      {
        id: "att-1",
        fecha: "2026-07-23",
        horario: "Lunes 18:00 — 19:00",
        personaId: 9,
        estudiante: "Ana López",
        estado: "present",
        entrenador: "Coach Torres",
      },
    ]);

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);

    fireEvent.click(await screen.findByRole("button", { name: /^lunes/i }));
    fireEvent.click(await screen.findByRole("button", { name: /18:00/i }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));

    const stateSelector = await screen.findByRole("radiogroup", { name: "Estado de asistencia de Ana López" });
    expect(within(stateSelector).getByRole("radio", { name: "Presente" })).toHaveAttribute("aria-checked", "true");
    expect(within(stateSelector).getByRole("radio", { name: "Ausente" })).toHaveAttribute("aria-checked", "false");
  });
});

describe("TrainerAttendancePage — schedule accordion grouped by day (Slice A)", () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockFetchTrainingSchedules.mockResolvedValue([]);
    mockFetchAlumnosPorHorario.mockResolvedValue([]);
    mockFetchAttendanceRecords.mockReset().mockResolvedValue([]);
    mockRegisterAttendance.mockReset();
  });

  it("groups schedules on Monday, Wednesday and Friday into three independent day sections", async () => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("trainer", "Coach Torres"));
    mockFetchTrainingSchedules.mockResolvedValue([
      { id: 1, diaSemana: "lun", horaInicio: "18:00", horaFin: "19:00", entrenadorId: 17, entrenadorNombre: "Coach Torres" },
      { id: 2, diaSemana: "mie", horaInicio: "09:00", horaFin: "10:00", entrenadorId: 18, entrenadorNombre: "Coach Diaz" },
      { id: 3, diaSemana: "vie", horaInicio: "20:00", horaFin: "21:00", entrenadorId: 19, entrenadorNombre: "Coach Ruiz" },
    ]);

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);

    const mondaySection = await screen.findByRole("button", { name: /^lunes/i });
    const wednesdaySection = screen.getByRole("button", { name: /^miércoles/i });
    const fridaySection = screen.getByRole("button", { name: /^viernes/i });
    expect(mondaySection).toBeInTheDocument();
    expect(wednesdaySection).toBeInTheDocument();
    expect(fridaySection).toBeInTheDocument();

    // Collapsed by default: no schedule card is reachable before expanding.
    expect(screen.queryByRole("button", { name: /18:00/i })).not.toBeInTheDocument();

    fireEvent.click(mondaySection);
    expect(await screen.findByRole("button", { name: /18:00/i })).toBeInTheDocument();
    // Wednesday/Friday remain collapsed — their cards are not shown.
    expect(screen.queryByRole("button", { name: /09:00/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /20:00/i })).not.toBeInTheDocument();
  });

  it("expands and collapses each day section independently of the others", async () => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("trainer", "Coach Torres"));
    mockFetchTrainingSchedules.mockResolvedValue([
      { id: 1, diaSemana: "lun", horaInicio: "18:00", horaFin: "19:00", entrenadorId: 17, entrenadorNombre: "Coach Torres" },
      { id: 2, diaSemana: "mie", horaInicio: "09:00", horaFin: "10:00", entrenadorId: 18, entrenadorNombre: "Coach Diaz" },
    ]);

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);

    const mondaySection = await screen.findByRole("button", { name: /^lunes/i });
    const wednesdaySection = screen.getByRole("button", { name: /^miércoles/i });

    fireEvent.click(mondaySection);
    expect(await screen.findByRole("button", { name: /18:00/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /09:00/i })).not.toBeInTheDocument();

    fireEvent.click(wednesdaySection);
    expect(await screen.findByRole("button", { name: /09:00/i })).toBeInTheDocument();
    // Monday card is still visible — expanding Wednesday did not collapse it.
    expect(screen.getByRole("button", { name: /18:00/i })).toBeInTheDocument();

    fireEvent.click(mondaySection);
    expect(screen.queryByRole("button", { name: /18:00/i })).not.toBeInTheDocument();
    // Wednesday remains expanded — collapsing Monday did not affect it.
    expect(screen.getByRole("button", { name: /09:00/i })).toBeInTheDocument();
  });

  it("omits the day section for a day with no schedules", async () => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("trainer", "Coach Torres"));
    mockFetchTrainingSchedules.mockResolvedValue([
      { id: 1, diaSemana: "lun", horaInicio: "18:00", horaFin: "19:00", entrenadorId: 17, entrenadorNombre: "Coach Torres" },
    ]);

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);

    await screen.findByRole("button", { name: /^lunes/i });
    expect(screen.queryByRole("button", { name: /^martes/i })).not.toBeInTheDocument();
  });

  it("still triggers roster loading when a schedule card is selected inside an expanded day", async () => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("trainer", "Coach Torres"));
    mockFetchTrainingSchedules.mockResolvedValue([
      { id: 12, diaSemana: "lun", horaInicio: "18:00", horaFin: "19:00", entrenadorId: 17, entrenadorNombre: "Coach Torres" },
    ]);
    mockFetchAlumnosPorHorario.mockResolvedValue([ANA_ALUMNO_HORARIO]);

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);

    fireEvent.click(await screen.findByRole("button", { name: /^lunes/i }));
    fireEvent.click(await screen.findByRole("button", { name: /18:00/i }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));

    await waitFor(() => expect(mockFetchAlumnosPorHorario).toHaveBeenCalledWith(12));
    expect(await screen.findByText("Ana López")).toBeInTheDocument();
  });

  it("paginates the student list 10-en-10 and shows Anterior/Siguiente controls", async () => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("trainer", "Coach Torres"));
    mockFetchTrainingSchedules.mockResolvedValue([
      { id: 12, diaSemana: "lun", horaInicio: "18:00", horaFin: "19:00", entrenadorId: 17, entrenadorNombre: "Coach Torres" },
    ]);

    const students = Array.from({ length: 25 }, (_, i) => ({
      id: i + 1,
      personaId: 100 + i,
      personaNombreCompleto: `Student ${String(i + 1).padStart(2, "0")}`,
      horarioId: 12,
      horarioDia: "lun",
      horarioHoraInicio: "18:00",
      horarioHoraFin: "19:00",
      fechaAsignacion: "2026-01-01",
    }));
    mockFetchAlumnosPorHorario.mockResolvedValue(students);

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    fireEvent.click(await screen.findByRole("button", { name: /^lunes/i }));
    fireEvent.click(await screen.findByRole("button", { name: /18:00/i }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));

    await screen.findByText("Student 01");
    expect(screen.getByText("Student 10")).toBeInTheDocument();
    expect(screen.queryByText("Student 11")).not.toBeInTheDocument();

    const pageInfo = screen.getByText(/Página 1 de 3/);
    expect(pageInfo).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Página siguiente" }));
    expect(await screen.findByText("Student 11")).toBeInTheDocument();
    expect(screen.getByText("Student 20")).toBeInTheDocument();
    expect(screen.queryByText("Student 01")).not.toBeInTheDocument();
    expect(screen.getByText(/Página 2 de 3/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Página siguiente" }));
    expect(await screen.findByText("Student 21")).toBeInTheDocument();
    expect(screen.getByText("Student 25")).toBeInTheDocument();
    expect(screen.queryByText("Student 26")).not.toBeInTheDocument();
    expect(screen.getByText(/Página 3 de 3/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Unmarked-by-default guard (P0 — silent data loss).
//
// The roster used to default every student to "absent", and "Siguiente" was
// gated only on `students.length === 0`. A trainer could tap
// Continuar → Siguiente → Confirmar and file the whole session as a no-show.
// The wizard paginates at 10 while `students` holds the FULL roster, so
// students the trainer never even scrolled to were submitted as absent.
// ---------------------------------------------------------------------------

const SCHEDULE = {
  id: 12,
  diaSemana: "lun",
  horaInicio: "18:00",
  horaFin: "19:00",
  entrenadorId: 17,
  entrenadorNombre: "Coach Torres",
};

function buildAlumnoHorarios(count: number): unknown[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    personaId: 100 + i,
    personaNombreCompleto: `Student ${String(i + 1).padStart(2, "0")}`,
    horarioId: 12,
    horarioDia: "lun",
    horarioHoraInicio: "18:00",
    horarioHoraFin: "19:00",
    fechaAsignacion: "2026-01-01",
  }));
}

/**
 * The browser's own Back button.
 *
 * jsdom queues `popstate` as a task, and the wizard answers it with React
 * state — so the traversal has to be given a turn of the loop inside `act`
 * or the assertion runs against the previous render.
 */
async function pressBrowserBack(): Promise<void> {
  await act(async () => {
    window.history.back();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Walk the wizard from the schedule accordion to the mark-attendance step. */
async function openRoster(): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: /^lunes/i }));
  fireEvent.click(await screen.findByRole("button", { name: /18:00/i }));
  fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
}

// ---------------------------------------------------------------------------
// The roster starts on "present" — the trainer asked for it, and a session is
// overwhelmingly "everyone showed up".
//
// The silent-data-loss risk that the old `unmarked` default guarded against
// did not go away, it INVERTED: instead of filing a whole session as a no-show
// by tapping through, a distracted trainer now files students as having
// attended without ever looking at them. So these tests moved from "the wizard
// refuses to advance" to "the wizard never lets an untouched roster look like
// a reviewed one" — the count spans the full roster, the fiche says which rows
// are provisional, and the confirmation step names them instead of reporting
// "N presentes" either way.
// ---------------------------------------------------------------------------

describe("TrainerAttendancePage — the present default never passes for a reviewed roster", () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockFetchTrainingSchedules.mockReset().mockResolvedValue([SCHEDULE]);
    mockFetchAlumnosPorHorario.mockReset().mockResolvedValue([]);
    mockFetchAttendanceRecords.mockReset().mockResolvedValue([]);
    mockRegisterAttendance.mockReset().mockResolvedValue({ createdCount: 0, failed: [] });
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("trainer", "Coach Torres"));
  });

  it("starts every student on Presente, and marks nobody as reviewed", async () => {
    mockFetchAlumnosPorHorario.mockResolvedValue([ANA_ALUMNO_HORARIO]);

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();

    const group = await screen.findByRole("radiogroup", { name: /Ana López/ });
    // The state IS present — that is what will be filed if nobody touches it,
    // and the control has to say so rather than hide it.
    expect(within(group).getByRole("radio", { name: "Presente" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    for (const label of ["Ausente", "Tardanza", "Justificado"]) {
      expect(within(group).getByRole("radio", { name: label })).toHaveAttribute("aria-checked", "false");
    }
    // …and the value being present must not read as a decision anybody made.
    expect(screen.getByText("1 sin revisar")).toBeInTheDocument();
    expect(group.closest("[data-reviewed]")).toHaveAttribute("data-reviewed", "false");
  });

  it("counts unreviewed students across the FULL roster, not just the visible page", async () => {
    // 25 students → 3 pages of 10. Page 1 shows Student 01..10 only.
    mockFetchAlumnosPorHorario.mockResolvedValue(buildAlumnoHorarios(25));

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();

    await screen.findByText("Student 01");
    expect(screen.queryByText("Student 11")).not.toBeInTheDocument();
    // The counter must span all 25, not the 10 rendered rows — an off-page
    // student is exactly the one about to be filed present sight unseen.
    expect(screen.getByText("25 sin revisar")).toBeInTheDocument();
    expect(screen.getByText("25 alumnos sin revisar")).toBeInTheDocument();
  });

  it("carries the off-page unreviewed count into the confirmation summary", async () => {
    mockFetchAlumnosPorHorario.mockResolvedValue(buildAlumnoHorarios(25));

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();
    await screen.findByText("Student 01");

    // Mark every student visible on page 1 — the other 15 are never seen.
    for (let i = 1; i <= 10; i++) {
      const group = screen.getByRole("radiogroup", { name: new RegExp(`Student ${String(i).padStart(2, "0")}`) });
      fireEvent.click(within(group).getByRole("radio", { name: "Presente" }));
    }
    expect(screen.getByText("15 sin revisar")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Siguiente/ }));

    // "25 presentes" on its own would read identically whether the trainer
    // went through the roster or never scrolled past page 1.
    expect(await screen.findByText("25 presente")).toBeInTheDocument();
    expect(screen.getByText("15 sin revisar")).toBeInTheDocument();
    expect(
      screen.getByText(/15 de 25 alumnos siguen en "Presente" porque nadie los revisó/),
    ).toBeInTheDocument();
  });

  it("warns about unreviewed students instead of blocking the advance", async () => {
    mockFetchAlumnosPorHorario.mockResolvedValue(buildAlumnoHorarios(3));

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();
    await screen.findByText("Student 01");

    // The trainer asked for a default; a default that cannot be submitted is
    // not a default. The count is a warning, not a gate.
    const next = screen.getByRole("button", { name: /Siguiente/ });
    expect(next).toBeEnabled();
    expect(next).not.toHaveAttribute("aria-describedby");
    expect(screen.getByText("3 alumnos sin revisar")).toBeInTheDocument();
  });

  it("stops flagging a student the moment the trainer decides on them", async () => {
    mockFetchAlumnosPorHorario.mockResolvedValue([ANA_ALUMNO_HORARIO]);

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();

    const group = await screen.findByRole("radiogroup", { name: /Ana López/ });
    expect(screen.getByText("1 sin revisar")).toBeInTheDocument();

    fireEvent.click(within(group).getByRole("radio", { name: "Ausente" }));

    expect(screen.queryByText(/sin revisar/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Siguiente/ })).toBeEnabled();
  });

  // Setting a row to the state it already had is still a decision: the trainer
  // looked at that student and said "yes, that one is here".
  it("counts confirming the default as a review", async () => {
    mockFetchAlumnosPorHorario.mockResolvedValue([ANA_ALUMNO_HORARIO]);

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();

    const group = await screen.findByRole("radiogroup", { name: /Ana López/ });
    fireEvent.click(within(group).getByRole("radio", { name: "Presente" }));

    expect(screen.queryByText(/sin revisar/)).not.toBeInTheDocument();
    expect(group.closest("[data-reviewed]")).toHaveAttribute("data-reviewed", "true");
  });

  it("lets the trainer narrow the roll call down to the students nobody touched", async () => {
    mockFetchAlumnosPorHorario.mockResolvedValue(buildAlumnoHorarios(3));

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();
    await screen.findByText("Student 01");

    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: /Student 01/ })).getByRole("radio", {
        name: "Ausente",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Ver solo sin revisar/ }));

    // Knowing 2 are unreviewed is only useful if it is a way to reach those 2.
    expect(screen.queryByText("Student 01")).not.toBeInTheDocument();
    expect(screen.getByText("Student 02")).toBeInTheDocument();
    expect(screen.getByText("Student 03")).toBeInTheDocument();
  });

  it("marks every remaining student present across all pages via the bulk action", async () => {
    mockFetchAlumnosPorHorario.mockResolvedValue(buildAlumnoHorarios(25));

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();
    await screen.findByText("Student 01");

    // Pre-mark one student justified — the bulk action must not overwrite an
    // explicit decision the trainer already made.
    const first = screen.getByRole("radiogroup", { name: /Student 01/ });
    fireEvent.click(within(first).getByRole("radio", { name: "Justificado" }));

    fireEvent.click(screen.getByRole("button", { name: "Marcar restantes presentes" }));

    // The button is how a trainer says "I looked, the rest are here", so it
    // has to clear the flag as well as set the state.
    expect(screen.queryByText(/sin revisar/)).not.toBeInTheDocument();
    expect(screen.getByText("24 Presentes")).toBeInTheDocument();
    expect(within(first).getByRole("radio", { name: "Justificado" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: /Siguiente/ })).toBeEnabled();
  });

  it("submits a real state for every student on the roster, never the unmarked sentinel", async () => {
    const trainerAuth = createAuthenticatedAuth("trainer", "Coach Torres");
    if (trainerAuth.session) trainerAuth.session.user.id = "17";
    mockUseAuth.mockReturnValue(trainerAuth);
    mockFetchAlumnosPorHorario.mockResolvedValue(buildAlumnoHorarios(25));
    mockRegisterAttendance.mockResolvedValue({ createdCount: 25, failed: [] });

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();
    await screen.findByText("Student 01");

    fireEvent.click(screen.getByRole("button", { name: "Marcar restantes presentes" }));
    fireEvent.click(screen.getByRole("button", { name: /Siguiente/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Confirmar Asistencia/ }));

    await waitFor(() => expect(mockRegisterAttendance).toHaveBeenCalled());
    const payload = mockRegisterAttendance.mock.calls[0][0] as {
      students: { personaId: number; estado: string }[];
    };
    expect(payload.students).toHaveLength(25);
    expect(payload.students.every((s) => s.estado === "present")).toBe(true);
    expect(payload.students.some((s) => s.estado === "unmarked")).toBe(false);
  });

  it("hides the bulk action once nothing is left to mark", async () => {
    mockFetchAlumnosPorHorario.mockResolvedValue([ANA_ALUMNO_HORARIO]);

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();

    const group = await screen.findByRole("radiogroup", { name: /Ana López/ });
    expect(screen.getByRole("button", { name: "Marcar restantes presentes" })).toBeInTheDocument();

    fireEvent.click(within(group).getByRole("radio", { name: "Presente" }));

    expect(screen.queryByRole("button", { name: "Marcar restantes presentes" })).not.toBeInTheDocument();
  });

  it("renders an unreviewed row with a neutral dashed outline that a reviewed row does not have", async () => {
    mockFetchAlumnosPorHorario.mockResolvedValue([ANA_ALUMNO_HORARIO]);

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();

    const group = await screen.findByRole("radiogroup", { name: /Ana López/ });
    const row = group.closest("[data-attendance]");
    expect(row).not.toBeNull();
    // Present, and visibly provisional: the outline is what says "this value
    // is the default, not somebody's answer".
    expect(row).toHaveAttribute("data-attendance", "present");
    expect(row).toHaveAttribute("data-reviewed", "false");
    expect(row).toHaveClass("border-dashed");

    fireEvent.click(within(group).getByRole("radio", { name: "Ausente" }));

    expect(row).toHaveAttribute("data-attendance", "absent");
    expect(row).toHaveAttribute("data-reviewed", "true");
    expect(row).not.toHaveClass("border-dashed");
  });
});

// ---------------------------------------------------------------------------
// Touch-target + exclusivity of the attendance state selector (P0).
//
// The four buttons measured 30px tall in a 2x2 grid at a 390px viewport —
// under the 44px minimum for the trainer's core one-handed courtside flow —
// and were `aria-pressed` toggles inside a `<fieldset>`, so they announced as
// four independent switches and never conveyed that the choice is exclusive.
// ---------------------------------------------------------------------------

describe("TrainerAttendancePage — attendance state selector affordances", () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockFetchTrainingSchedules.mockReset().mockResolvedValue([SCHEDULE]);
    mockFetchAlumnosPorHorario.mockReset().mockResolvedValue([ANA_ALUMNO_HORARIO]);
    mockFetchAttendanceRecords.mockReset().mockResolvedValue([]);
    mockRegisterAttendance.mockReset();
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("trainer", "Coach Torres"));
  });

  it("exposes the four states as one exclusive radiogroup labelled by the student's name", async () => {
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();

    const group = await screen.findByRole("radiogroup", { name: "Estado de asistencia de Ana López" });
    // The name comes from the rendered student name, not a duplicated sr-only
    // string, so the two can never drift apart.
    const labelledBy = group.getAttribute("aria-labelledby")?.split(" ") ?? [];
    expect(labelledBy.length).toBeGreaterThan(0);
    expect(
      labelledBy.map((id) => document.getElementById(id)?.textContent).join(" "),
    ).toContain("Ana López");

    expect(within(group).getAllByRole("radio")).toHaveLength(4);
    expect(group.querySelector("fieldset")).toBeNull();
  });

  it("keeps exactly one state checked at a time", async () => {
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();

    const group = await screen.findByRole("radiogroup", { name: /Ana López/ });
    fireEvent.click(within(group).getByRole("radio", { name: "Presente" }));
    expect(within(group).getByRole("radio", { name: "Presente" })).toHaveAttribute("aria-checked", "true");

    fireEvent.click(within(group).getByRole("radio", { name: "Tardanza" }));
    expect(within(group).getByRole("radio", { name: "Tardanza" })).toHaveAttribute("aria-checked", "true");
    expect(within(group).getByRole("radio", { name: "Presente" })).toHaveAttribute("aria-checked", "false");
    expect(within(group).getAllByRole("radio", { checked: true })).toHaveLength(1);
  });

  it("gives every state control a 44px minimum touch target", async () => {
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();

    const group = await screen.findByRole("radiogroup", { name: /Ana López/ });
    for (const radio of within(group).getAllByRole("radio")) {
      expect(radio).toHaveClass("min-h-[44px]");
    }
  });

  it("lays the four states out in a single full-width row on mobile", async () => {
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();

    const group = await screen.findByRole("radiogroup", { name: /Ana López/ });
    // grid-cols-4 (not the old grid-cols-2 2x2 block) so all four states sit
    // in one row within thumb reach.
    expect(group).toHaveClass("grid", "grid-cols-4", "w-full");
    expect(group).not.toHaveClass("grid-cols-2");
  });
});

// ---------------------------------------------------------------------------
// FASE 4 item 3 — the redesign, layered ON TOP of the guarantees above.
// Prototype: `docs/ux/prototipos/20-tomar-lista.html`.
// ---------------------------------------------------------------------------

describe("TrainerAttendancePage — named stepper", () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockFetchTrainingSchedules.mockReset().mockResolvedValue([SCHEDULE]);
    mockFetchAlumnosPorHorario.mockReset().mockResolvedValue([ANA_ALUMNO_HORARIO]);
    mockFetchAttendanceRecords.mockReset().mockResolvedValue([]);
    mockRegisterAttendance.mockReset();
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("trainer", "Coach Torres"));
  });

  it("names every step instead of counting them", async () => {
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);

    const stepper = await screen.findByRole("list", { name: "Pasos para tomar asistencia" });
    expect(within(stepper).getByText("Horario")).toBeInTheDocument();
    expect(within(stepper).getByText("Pasar lista")).toBeInTheDocument();
    expect(within(stepper).getByText("Confirmar")).toBeInTheDocument();
    // The old "Paso 1 de 3" progress bar is gone.
    expect(screen.queryByText(/Paso 1 de 3/)).not.toBeInTheDocument();
  });

  it("carries the decision already made into step 1's name", async () => {
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();
    // `openRoster` only fires the click; the roster fetch resolves a tick
    // later, and the stepper only advances with it.
    await screen.findByRole("radiogroup", { name: /Ana López/ });

    const stepper = screen.getByRole("list", { name: "Pasos para tomar asistencia" });
    expect(within(stepper).getByText("Horario · Lunes 18:00")).toBeInTheDocument();
    // Step 2 is the current one.
    expect(within(stepper).getByText("Pasar lista")).toHaveAttribute("aria-current", "step");
  });
});

describe("TrainerAttendancePage — the fiche is the target", () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockFetchTrainingSchedules.mockReset().mockResolvedValue([SCHEDULE]);
    mockFetchAlumnosPorHorario.mockReset().mockResolvedValue([ANA_ALUMNO_HORARIO]);
    mockFetchAttendanceRecords.mockReset().mockResolvedValue([]);
    mockRegisterAttendance.mockReset();
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("trainer", "Coach Torres"));
  });

  it("cycles the state when the row itself is tapped", async () => {
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();

    const group = await screen.findByRole("radiogroup", { name: /Ana López/ });
    const row = group.closest("[data-attendance]") as HTMLElement;
    const fiche = within(row).getByRole("button", { name: /Ana López/ });

    expect(row).toHaveAttribute("data-attendance", "present");
    expect(row).toHaveAttribute("data-reviewed", "false");

    // The FIRST tap confirms the default rather than moving off it: tapping
    // the row of a student standing right there means "yes, that one", and
    // sending them to Tardanza for saying so is the opposite of what they did.
    fireEvent.click(fiche);
    expect(row).toHaveAttribute("data-attendance", "present");
    expect(row).toHaveAttribute("data-reviewed", "true");

    for (const expected of ["late", "justified", "absent", "present"]) {
      fireEvent.click(fiche);
      expect(row).toHaveAttribute("data-attendance", expected);
    }
  });

  it("never cycles a student back to unmarked", async () => {
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();

    const group = await screen.findByRole("radiogroup", { name: /Ana López/ });
    const row = group.closest("[data-attendance]") as HTMLElement;
    const fiche = within(row).getByRole("button", { name: /Ana López/ });

    for (let i = 0; i < 9; i++) {
      fireEvent.click(fiche);
      expect(row).not.toHaveAttribute("data-attendance", "unmarked");
    }
    // And the wizard therefore stays unblocked.
    expect(screen.getByRole("button", { name: /Siguiente/ })).toBeEnabled();
  });

  it("keeps the four explicit controls in sync with a tap — the tap is an accelerator", async () => {
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();

    const group = await screen.findByRole("radiogroup", { name: /Ana López/ });
    const fiche = within(group.closest("[data-attendance]") as HTMLElement).getByRole("button", {
      name: /Ana López/,
    });

    fireEvent.click(fiche);
    expect(within(group).getByRole("radio", { name: "Presente" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(within(group).getAllByRole("radio", { checked: true })).toHaveLength(1);

    // …and the explicit control still wins when used directly.
    fireEvent.click(within(group).getByRole("radio", { name: "Justificado" }));
    expect(within(group).getByRole("radio", { name: "Justificado" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("names the tap target with the student, their current state, and whether it is anybody's answer", async () => {
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();

    const group = await screen.findByRole("radiogroup", { name: /Ana López/ });
    // A screen-reader user gets the same two facts a sighted one gets from
    // the dashed outline: the state, and that nobody has confirmed it.
    expect(
      screen.getByRole("button", {
        name: "Ana López: Presente, sin revisar. Confirmar o cambiar estado",
      }),
    ).toBeInTheDocument();

    fireEvent.click(within(group).getByRole("radio", { name: "Tardanza" }));

    expect(
      screen.getByRole("button", { name: "Ana López: Tardanza. Cambiar estado" }),
    ).toBeInTheDocument();
  });
});

describe("TrainerAttendancePage — live marker and sticky commit bar", () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockFetchTrainingSchedules.mockReset().mockResolvedValue([SCHEDULE]);
    mockFetchAlumnosPorHorario.mockReset().mockResolvedValue(buildAlumnoHorarios(12));
    mockFetchAttendanceRecords.mockReset().mockResolvedValue([]);
    mockRegisterAttendance.mockReset();
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("trainer", "Coach Torres"));
  });

  it("shows a live presentes marker over the FULL roster", async () => {
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();
    await screen.findByText("Student 01");

    // 12, not 10: the marker spans every page, like the unreviewed counter.
    // It reads 12/12 from the first second because that IS what would be
    // filed — which is exactly why the unreviewed count sits beside it.
    const marker = screen.getByText("12", { selector: "[aria-live]" });
    expect(marker).toHaveTextContent("12/12");
    expect(screen.getByText("12 alumnos sin revisar")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Marcar restantes presentes" }));

    expect(marker).toHaveTextContent("12/12");
    expect(screen.queryByText(/sin revisar/)).not.toBeInTheDocument();
  });

  // Regression (accidental submission): the advance button and the submit
  // button are the same JSX position, so React reused ONE `<button>` node and
  // only swapped its `type` from "button" to "submit". React flushes the state
  // update inside the click handler, so by the time the browser ran the click's
  // DEFAULT ACTION the node it was standing on was a submit button — one tap on
  // "Siguiente" advanced the wizard AND filed the session, skipping the
  // confirmation step entirely.
  it("does not file the session when the trainer only asked to advance", async () => {
    // A session id that resolves to a real persona id, or `handleConfirm`
    // bails out on its own and the test proves nothing.
    mockUseAuth.mockReturnValue(trainerAuthWithPersonaId());
    mockRegisterAttendance.mockResolvedValue({ createdCount: 12, failed: [] });
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();
    await screen.findByText("Student 01");

    fireEvent.click(screen.getByRole("button", { name: /Siguiente/ }));

    expect(await screen.findByRole("button", { name: /Confirmar Asistencia/ })).toBeInTheDocument();
    expect(mockRegisterAttendance).not.toHaveBeenCalled();
  });

  // The other half of the same defect: whatever route a submit takes to the
  // form, only the confirmation step may file a session. jsdom does not
  // reproduce the browser's activation-behaviour timing, so this drives the
  // form directly — which is exactly the state the browser ended up in.
  it("refuses a submit that did not come from the confirmation step", async () => {
    mockUseAuth.mockReturnValue(trainerAuthWithPersonaId());
    mockRegisterAttendance.mockResolvedValue({ createdCount: 12, failed: [] });
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();
    const roster = await screen.findByText("Student 01");

    const form = roster.closest("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);

    await waitFor(() => expect(screen.getByText("Student 01")).toBeInTheDocument());
    expect(mockRegisterAttendance).not.toHaveBeenCalled();
    expect(screen.queryByText("Asistencia Registrada")).not.toBeInTheDocument();
  });

  it("keeps the commit bar reachable without scrolling the card", async () => {
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();
    await screen.findByText("Student 01");

    const bar = screen.getByRole("button", { name: /Siguiente/ }).closest("div.sticky");
    expect(bar).not.toBeNull();
    expect(bar).toHaveClass("sticky", "bottom-0");
  });

  it("carries the running totals in the commit bar", async () => {
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();
    await screen.findByText("Student 01");

    expect(screen.getByText("12 Presentes")).toBeInTheDocument();
    expect(screen.getByText("12 sin revisar")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Marcar restantes presentes" }));
    expect(screen.getByText("12 Presentes")).toBeInTheDocument();
    expect(screen.queryByText(/sin revisar/)).not.toBeInTheDocument();
  });
});

describe("TrainerAttendancePage — draft persistence", () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockFetchTrainingSchedules.mockReset().mockResolvedValue([SCHEDULE]);
    mockFetchAlumnosPorHorario.mockReset().mockResolvedValue(buildAlumnoHorarios(3));
    mockFetchAttendanceRecords.mockReset().mockResolvedValue([]);
    mockRegisterAttendance.mockReset().mockResolvedValue({ createdCount: 3, failed: [] });
    mockUseAuth.mockReturnValue(trainerAuthWithPersonaId());
  });

  it("restores the marks after the wizard is torn down mid-session", async () => {
    const first = render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();
    await screen.findByText("Student 01");

    const group = screen.getByRole("radiogroup", { name: /Student 01/ });
    fireEvent.click(within(group).getByRole("radio", { name: "Tardanza" }));
    expect(screen.getByText("2 sin revisar")).toBeInTheDocument();

    // A phone call: the component goes away entirely.
    first.unmount();

    // …and the trainer comes back in through the panel rather than through the
    // URL they were on. The step now lives in the query string, so keeping it
    // would restore the roll call directly — that path is worth testing, but it
    // is not the one this test is about (see "resumes the roll call on a
    // reload"). Walking the picker again must still find the marks.
    window.history.replaceState(null, "", "/trainer/attendance");
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();
    await screen.findByText("Student 01");

    const restored = screen.getByRole("radiogroup", { name: /Student 01/ });
    expect(within(restored).getByRole("radio", { name: "Tardanza" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByText(/Recuperamos las marcas/)).toBeInTheDocument();
  });

  it("leaves every other student unreviewed — a draft only ever narrows", async () => {
    const first = render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();
    await screen.findByText("Student 01");
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: /Student 01/ })).getByRole("radio", {
        name: "Presente",
      }),
    );
    first.unmount();

    // Re-entered through the picker, not through the step URL — same reason as
    // the test above.
    window.history.replaceState(null, "", "/trainer/attendance");
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();
    await screen.findByText("Student 01");

    // The restored student counts as reviewed — a drafted entry only got there
    // because a human made it — and the other two do NOT: a refresh must never
    // launder "nobody looked" into "confirmed present".
    expect(screen.getByText("2 sin revisar")).toBeInTheDocument();
    expect(
      screen.getByRole("radiogroup", { name: /Student 01/ }).closest("[data-reviewed]"),
    ).toHaveAttribute("data-reviewed", "true");
    expect(
      screen.getByRole("radiogroup", { name: /Student 02/ }).closest("[data-reviewed]"),
    ).toHaveAttribute("data-reviewed", "false");
  });

  it("never replays one horario's draft onto another", async () => {
    const OTHER = { ...SCHEDULE, id: 13, horaInicio: "20:00", horaFin: "21:00" };
    mockFetchTrainingSchedules.mockResolvedValue([SCHEDULE, OTHER]);

    const first = render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    fireEvent.click(await screen.findByRole("button", { name: /^lunes/i }));
    fireEvent.click(await screen.findByRole("button", { name: /18:00/i }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    await screen.findByText("Student 01");
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: /Student 01/ })).getByRole("radio", {
        name: "Presente",
      }),
    );
    first.unmount();

    // Back at the picker to file a DIFFERENT session — the 18:00 draft must
    // not follow the trainer into the 20:00 one.
    window.history.replaceState(null, "", "/trainer/attendance");
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    fireEvent.click(await screen.findByRole("button", { name: /^lunes/i }));
    fireEvent.click(await screen.findByRole("button", { name: /20:00/i }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    await screen.findByText("Student 01");

    expect(screen.getByText("3 sin revisar")).toBeInTheDocument();
    expect(screen.queryByText(/Recuperamos las marcas/)).not.toBeInTheDocument();
  });

  it("drops the draft once the session is actually filed", async () => {
    const first = render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();
    await screen.findByText("Student 01");
    fireEvent.click(screen.getByRole("button", { name: "Marcar restantes presentes" }));
    fireEvent.click(screen.getByRole("button", { name: /Siguiente/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Confirmar Asistencia/ }));
    await screen.findByText("Asistencia Registrada");
    first.unmount();

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();
    await screen.findByText("Student 01");

    expect(screen.getByText("3 sin revisar")).toBeInTheDocument();
  });

  it("keeps the draft when some records failed, so a retry starts from the marks", async () => {
    mockRegisterAttendance.mockResolvedValue({
      createdCount: 2,
      failed: [{ personaId: 102, message: "conflict" }],
    });

    const first = render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();
    await screen.findByText("Student 01");
    fireEvent.click(screen.getByRole("button", { name: "Marcar restantes presentes" }));
    fireEvent.click(screen.getByRole("button", { name: /Siguiente/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Confirmar Asistencia/ }));
    await screen.findByText("Asistencia Registrada");
    first.unmount();

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();
    await screen.findByText("Student 01");

    expect(screen.queryByText(/sin revisar/)).not.toBeInTheDocument();
  });
});

describe("TrainerAttendancePage — partial failures name the students", () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockFetchTrainingSchedules.mockReset().mockResolvedValue([SCHEDULE]);
    mockFetchAlumnosPorHorario.mockReset().mockResolvedValue(buildAlumnoHorarios(3));
    mockFetchAttendanceRecords.mockReset().mockResolvedValue([]);
    mockUseAuth.mockReturnValue(trainerAuthWithPersonaId());
  });

  async function fileSessionWithFailures(
    failed: { personaId: number; message: string }[],
  ): Promise<void> {
    mockRegisterAttendance.mockReset().mockResolvedValue({
      createdCount: 3 - failed.length,
      failed,
    });
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();
    await screen.findByText("Student 01");
    fireEvent.click(screen.getByRole("button", { name: "Marcar restantes presentes" }));
    fireEvent.click(screen.getByRole("button", { name: /Siguiente/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Confirmar Asistencia/ }));
    await screen.findByText("Asistencia Registrada");
  }

  it("lists WHO could not be saved instead of only how many", async () => {
    // Roster ids are 100.. — Student 02 is personaId 101.
    await fileSessionWithFailures([
      { personaId: 101, message: "conflict" },
      { personaId: 102, message: "conflict" },
    ]);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("No se pudieron guardar 2 registros");
    expect(within(alert).getByText("Student 02")).toBeInTheDocument();
    expect(within(alert).getByText("Student 03")).toBeInTheDocument();
    // Student 01 saved fine and must NOT be listed as failed.
    expect(within(alert).queryByText("Student 01")).not.toBeInTheDocument();
  });

  it("uses the singular when exactly one record failed", async () => {
    await fileSessionWithFailures([{ personaId: 100, message: "conflict" }]);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("No se pudo guardar 1 registro");
    expect(within(alert).getByText("Student 01")).toBeInTheDocument();
  });

  it("still names an id it cannot match rather than dropping it silently", async () => {
    await fileSessionWithFailures([{ personaId: 999, message: "conflict" }]);

    expect(within(screen.getByRole("alert")).getByText("Alumno #999")).toBeInTheDocument();
  });

  it("shows no failure block at all when everything saved", async () => {
    await fileSessionWithFailures([]);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// The picker opens on today — a default, never a lock
// ---------------------------------------------------------------------------

describe("TrainerAttendancePage — the picker opens on today", () => {
  function sched(id: number, diaSemana: string, horaInicio: string) {
    return {
      id,
      diaSemana,
      horaInicio,
      horaFin: "19:00",
      entrenadorId: 17,
      entrenadorNombre: "Coach Torres",
    };
  }

  beforeEach(() => {
    mockUseAuth.mockReturnValue(trainerAuthWithPersonaId());
    mockFetchAlumnosPorHorario.mockResolvedValue([ANA_ALUMNO_HORARIO]);
    mockFetchAttendanceRecords.mockReset().mockResolvedValue([]);
  });

  /** 2026-07-20, 10:00 in Guayaquil — a Monday. */
  function pinToMonday(): void {
    vi.setSystemTime(new Date("2026-07-20T15:00:00Z"));
  }

  it("resolves today in club time, not in the device's time zone", async () => {
    // 02:00Z on the 24th is FRIDAY on the machine clock and 21:00 THURSDAY at
    // the club. This is the whole point of the feature: a tablet left on UTC
    // must still open on the session the trainer is actually standing in.
    vi.setSystemTime(new Date("2026-07-24T02:00:00Z"));
    mockFetchTrainingSchedules.mockResolvedValue([
      sched(30, "jue", "18:00"),
      sched(31, "vie", "20:00"),
    ]);

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);

    expect(await screen.findByText("Horarios de hoy · Jueves")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^viernes/i })).not.toBeInTheDocument();
  });

  it("hides the other days and names the day it is showing", async () => {
    pinToMonday();
    mockFetchTrainingSchedules.mockResolvedValue([
      sched(12, "lun", "18:00"),
      sched(13, "vie", "20:00"),
    ]);

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);

    expect(await screen.findByText("Horarios de hoy · Lunes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^lunes/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^viernes/i })).not.toBeInTheDocument();
  });

  it("opens today's panel so the times are readable without a tap", async () => {
    pinToMonday();
    mockFetchTrainingSchedules.mockResolvedValue([sched(12, "lun", "18:00")]);

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);

    // No click on the "Lunes" header first — that tap is the friction this
    // default exists to remove.
    expect(await screen.findByRole("button", { name: /18:00/ })).toBeInTheDocument();
  });

  it("gives back the whole week on request, and takes it away again", async () => {
    pinToMonday();
    mockFetchTrainingSchedules.mockResolvedValue([
      sched(12, "lun", "18:00"),
      sched(13, "vie", "20:00"),
    ]);

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);

    fireEvent.click(await screen.findByRole("button", { name: "Ver todos los días" }));

    // Yesterday's missed session has to stay reachable — the default narrows,
    // it does not lock.
    expect(screen.getByRole("button", { name: /^viernes/i })).toBeInTheDocument();
    expect(screen.getByText("Seleccione el horario de entrenamiento:")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Ver solo hoy" }));

    expect(screen.queryByRole("button", { name: /^viernes/i })).not.toBeInTheDocument();
  });

  it("shows the full week and says why when today has nothing scheduled", async () => {
    // Narrowing to an empty list would read as a broken screen on a rest day.
    vi.setSystemTime(new Date("2026-07-21T15:00:00Z")); // Tuesday
    mockFetchTrainingSchedules.mockResolvedValue([
      sched(12, "lun", "18:00"),
      sched(13, "vie", "20:00"),
    ]);

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);

    expect(
      await screen.findByText(/No hay entrenamientos hoy \(martes\)/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^lunes/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^viernes/i })).toBeInTheDocument();
    // Nothing to toggle back to — offering "ver todos" here would be a no-op
    // control the trainer has to reason about.
    expect(screen.queryByRole("button", { name: "Ver todos los días" })).not.toBeInTheDocument();
  });

  it("does not blame the day filter when no schedules exist at all", async () => {
    pinToMonday();
    mockFetchTrainingSchedules.mockResolvedValue([]);

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);

    expect(await screen.findByText("No hay horarios registrados")).toBeInTheDocument();
    expect(screen.queryByText(/No hay entrenamientos hoy/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ver todos los días" })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// User control and freedom (the principle that never moved off the prototype).
//
// Reproduced by the evaluator: at step 3, with a student marked Tardanza, the
// browser's Back button threw them out of the wizard to /trainer — no prompt,
// marks gone — because the three steps were never history entries. Coming back
// to /trainer/attendance always restarted at "Elija el horario".
//
// The step now lives in the query string, so each one is a real entry. These
// tests walk that exact path, and they also hold the line the step-in-the-URL
// could quietly cross: a restored roll call may only ever bring back rows a
// HUMAN reviewed.
// ---------------------------------------------------------------------------

describe("TrainerAttendancePage — the steps are history entries", () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockPush.mockReset();
    mockFetchTrainingSchedules.mockReset().mockResolvedValue([SCHEDULE]);
    mockFetchAlumnosPorHorario.mockReset().mockResolvedValue(buildAlumnoHorarios(3));
    mockFetchAttendanceRecords.mockReset().mockResolvedValue([]);
    mockRegisterAttendance.mockReset().mockResolvedValue({ createdCount: 3, failed: [] });
    mockUseAuth.mockReturnValue(trainerAuthWithPersonaId());
  });

  /** Step 2, with Student 01 on Tardanza — the state the evaluator was in. */
  async function reachConfirmWithOneMark(): Promise<void> {
    await openRoster();
    await screen.findByText("Student 01");
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: /Student 01/ })).getByRole("radio", {
        name: "Tardanza",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Siguiente/ }));
    await screen.findByRole("button", { name: /Confirmar Asistencia/ });
  }

  it("gives each step its own address", async () => {
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    expect(window.location.search).toBe("");

    await openRoster();
    await screen.findByText("Student 01");
    expect(window.location.search).toBe("?horario=12&paso=lista");

    fireEvent.click(screen.getByRole("button", { name: /Siguiente/ }));
    await screen.findByRole("button", { name: /Confirmar Asistencia/ });
    expect(window.location.search).toBe("?horario=12&paso=confirmar");
  });

  it("returns Back from step 3 to the roll call, marks intact, instead of ejecting the trainer", async () => {
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await reachConfirmWithOneMark();

    await pressBrowserBack();

    // Step 2, not /trainer and not "Elija el horario".
    expect(screen.getByRole("button", { name: /Siguiente/ })).toBeInTheDocument();
    expect(screen.queryByText("Elija el horario")).not.toBeInTheDocument();
    expect(window.location.search).toBe("?horario=12&paso=lista");
    expect(
      within(screen.getByRole("radiogroup", { name: /Student 01/ })).getByRole("radio", {
        name: "Tardanza",
      }),
    ).toHaveAttribute("aria-checked", "true");
    // The roster was already in memory — going back must not refetch it.
    expect(mockFetchAlumnosPorHorario).toHaveBeenCalledTimes(1);
  });

  it("only leaves the wizard once Back has walked every step", async () => {
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await reachConfirmWithOneMark();

    await pressBrowserBack();
    expect(screen.getByRole("button", { name: /Siguiente/ })).toBeInTheDocument();

    await pressBrowserBack();
    expect(await screen.findByText("Elija el horario")).toBeInTheDocument();
    expect(window.location.search).toBe("");
  });

  it("leaves the same stack behind whether the trainer used Atrás or the browser", async () => {
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await reachConfirmWithOneMark();

    // The in-page control walks the real history, so the browser's Back button
    // does not then push the trainer FORWARD into the step they just left.
    fireEvent.click(screen.getByRole("button", { name: /Atrás/ }));
    await waitFor(() => expect(window.location.search).toBe("?horario=12&paso=lista"));
    expect(screen.getByRole("button", { name: /Siguiente/ })).toBeInTheDocument();

    await pressBrowserBack();
    expect(await screen.findByText("Elija el horario")).toBeInTheDocument();
  });

  it("resumes the roll call on a reload instead of restarting at Elija el horario", async () => {
    const first = render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();
    await screen.findByText("Student 01");
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: /Student 01/ })).getByRole("radio", {
        name: "Tardanza",
      }),
    );

    // A reload: the component goes away, the URL does not.
    first.unmount();
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);

    // No click on the accordion, no Continuar — the roll call comes back.
    expect(await screen.findByText("Student 01")).toBeInTheDocument();
    expect(
      within(screen.getByRole("radiogroup", { name: /Student 01/ })).getByRole("radio", {
        name: "Tardanza",
      }),
    ).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(/Recuperamos las marcas/)).toBeInTheDocument();
  });

  // The guarantee the URL must not launder around: `?paso=lista` restores the
  // ROSTER, and only the draft — reviewed rows — restores DECISIONS.
  it("restores only the rows a human reviewed, never the untouched ones", async () => {
    const first = render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();
    await screen.findByText("Student 01");
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: /Student 01/ })).getByRole("radio", {
        name: "Tardanza",
      }),
    );
    first.unmount();

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await screen.findByText("Student 01");

    expect(screen.getByText("2 sin revisar")).toBeInTheDocument();
    expect(
      screen.getByRole("radiogroup", { name: /Student 02/ }).closest("[data-reviewed]"),
    ).toHaveAttribute("data-reviewed", "false");
    // …and the stored draft itself holds exactly the one decided row.
    const stored = window.sessionStorage.getItem("cata_attendance_draft:12:2026-07-21");
    expect(JSON.parse(stored ?? "{}")).toEqual({ "100": "late" });
  });

  it("brings a roster nobody touched back untouched", async () => {
    const first = render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();
    await screen.findByText("Student 01");
    first.unmount();

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await screen.findByText("Student 01");

    // A reload cannot promote "nobody looked" into "confirmed present".
    expect(screen.getByText("3 sin revisar")).toBeInTheDocument();
    expect(screen.queryByText(/Recuperamos las marcas/)).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem("cata_attendance_draft:12:2026-07-21")).toBeNull();
  });

  it("falls back to the picker for a horario that does not exist", async () => {
    window.history.replaceState(null, "", "/trainer/attendance?horario=999&paso=lista");

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);

    expect(await screen.findByText("Elija el horario")).toBeInTheDocument();
    await waitFor(() => expect(window.location.search).toBe(""));
    expect(mockFetchAlumnosPorHorario).not.toHaveBeenCalled();
  });

  it("does not re-open a filed session when the trainer presses Back on the receipt", async () => {
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();
    await screen.findByText("Student 01");
    fireEvent.click(screen.getByRole("button", { name: "Marcar restantes presentes" }));
    fireEvent.click(screen.getByRole("button", { name: /Siguiente/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Confirmar Asistencia/ }));
    await screen.findByText("Asistencia Registrada");
    // The receipt's own URL carries no step: reloading it must not resurrect
    // the roll call that produced it.
    expect(window.location.search).toBe("");

    await pressBrowserBack();

    expect(screen.getByText("Asistencia Registrada")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Confirmar Asistencia/ })).not.toBeInTheDocument();
  });
});

describe("TrainerAttendancePage — leaving asks first", () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockPush.mockReset();
    mockFetchTrainingSchedules.mockReset().mockResolvedValue([SCHEDULE]);
    mockFetchAlumnosPorHorario.mockReset().mockResolvedValue(buildAlumnoHorarios(3));
    mockFetchAttendanceRecords.mockReset().mockResolvedValue([]);
    mockRegisterAttendance.mockReset().mockResolvedValue({ createdCount: 3, failed: [] });
    mockUseAuth.mockReturnValue(trainerAuthWithPersonaId());
  });

  it("asks before walking out of a roll call with marks on screen", async () => {
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();
    await screen.findByText("Student 01");
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: /Student 01/ })).getByRole("radio", {
        name: "Tardanza",
      }),
    );

    fireEvent.click(screen.getByRole("link", { name: /Volver al Panel del Entrenador/ }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("¿Salir sin registrar la asistencia?")).toBeInTheDocument();
    expect(within(dialog).getByText(/Marcó 1 de 3 alumnos/)).toBeInTheDocument();
    // Nothing has navigated yet.
    expect(mockPush).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Seguir con la lista" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByText("Student 01")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: /Volver al Panel del Entrenador/ }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Salir sin registrar" }),
    );

    expect(mockPush).toHaveBeenCalledWith("/trainer");
  });

  it("does not ask when the trainer has decided nothing", async () => {
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();
    await screen.findByText("Student 01");

    // An untouched roster is not unsaved work — the roster defaults to
    // "present", and asking about it would be asking about nothing.
    fireEvent.click(screen.getByRole("link", { name: /Volver al Panel del Entrenador/ }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("warns the browser before the tab takes the draft with it", async () => {
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();
    await screen.findByText("Student 01");

    const untouched = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(untouched);
    expect(untouched.defaultPrevented).toBe(false);

    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: /Student 01/ })).getByRole("radio", {
        name: "Tardanza",
      }),
    );

    // `sessionStorage` dies with the tab, so this exit is the one that really
    // discards the roll call.
    const withMarks = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(withMarks);
    expect(withMarks.defaultPrevented).toBe(true);
  });
});

describe("TrainerAttendancePage — the picker offers an unfinished list back", () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockPush.mockReset();
    mockFetchTrainingSchedules.mockReset().mockResolvedValue([SCHEDULE]);
    mockFetchAlumnosPorHorario.mockReset().mockResolvedValue(buildAlumnoHorarios(3));
    mockFetchAttendanceRecords.mockReset().mockResolvedValue([]);
    mockRegisterAttendance.mockReset().mockResolvedValue({ createdCount: 3, failed: [] });
    mockUseAuth.mockReturnValue(trainerAuthWithPersonaId());
  });

  /** Leave one mark behind, then come back to the front door. */
  async function leaveADraft(): Promise<void> {
    const first = render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();
    await screen.findByText("Student 01");
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: /Student 01/ })).getByRole("radio", {
        name: "Tardanza",
      }),
    );
    first.unmount();
    window.history.replaceState(null, "", "/trainer/attendance");
  }

  it("offers the draft instead of restoring it behind the trainer", async () => {
    await leaveADraft();

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);

    // Still the picker — a trainer who came to file a DIFFERENT session must
    // not land inside the old one.
    expect(await screen.findByText("Elija el horario")).toBeInTheDocument();
    expect(screen.getByText("Tiene una lista sin terminar")).toBeInTheDocument();
    expect(screen.getByText(/1 alumno marcado/)).toBeInTheDocument();
    expect(screen.getByText("Lunes 18:00 — 19:00")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Retomar la lista/ }));

    expect(await screen.findByText("Student 01")).toBeInTheDocument();
    expect(
      within(screen.getByRole("radiogroup", { name: /Student 01/ })).getByRole("radio", {
        name: "Tardanza",
      }),
    ).toHaveAttribute("aria-checked", "true");
    expect(window.location.search).toBe("?horario=12&paso=lista");
  });

  it("asks before throwing the draft away, and then really does", async () => {
    await leaveADraft();

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Descartar" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("¿Descartar la lista sin terminar?")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Conservar" }));
    expect(screen.getByText("Tiene una lista sin terminar")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Descartar" }),
    );

    expect(screen.queryByText("Tiene una lista sin terminar")).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem("cata_attendance_draft:12:2026-07-21")).toBeNull();
  });

  it("offers nothing when the roster was never touched", async () => {
    const first = render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();
    await screen.findByText("Student 01");
    first.unmount();
    window.history.replaceState(null, "", "/trainer/attendance");

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);

    expect(await screen.findByText("Elija el horario")).toBeInTheDocument();
    expect(screen.queryByText(/lista sin terminar/)).not.toBeInTheDocument();
  });
});

describe("TrainerAttendancePage — undo", () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockFetchTrainingSchedules.mockReset().mockResolvedValue([SCHEDULE]);
    mockFetchAlumnosPorHorario.mockReset().mockResolvedValue(buildAlumnoHorarios(3));
    mockFetchAttendanceRecords.mockReset().mockResolvedValue([]);
    mockRegisterAttendance.mockReset().mockResolvedValue({ createdCount: 3, failed: [] });
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("trainer", "Coach Torres"));
    window.sessionStorage.clear();
  });

  function stateOf(name: string, label: string): string | null {
    const group = screen.getByRole("radiogroup", { name: new RegExp(name) });
    return within(group).getByRole("radio", { name: label }).getAttribute("aria-checked");
  }

  it("offers nothing to undo before the trainer has marked anything", async () => {
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();
    await screen.findByText("Student 01");

    expect(screen.getByRole("button", { name: /deshacer/i })).toBeDisabled();
  });

  it("puts a single mark back", async () => {
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();

    const group = await screen.findByRole("radiogroup", { name: /Student 01/ });
    fireEvent.click(within(group).getByRole("radio", { name: "Ausente" }));
    expect(stateOf("Student 01", "Ausente")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: /deshacer/i }));

    expect(stateOf("Student 01", "Presente")).toBe("true");
  });

  it("puts the row back to UNREVIEWED, not merely back to Presente", async () => {
    // The value and the decision are different facts on this screen. An undo
    // that restored "Presente" but left the row counted as reviewed would
    // launder "nobody looked" into "confirmed" — the exact laundering the
    // unreviewed counter exists to prevent.
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();

    const group = await screen.findByRole("radiogroup", { name: /Student 01/ });
    fireEvent.click(within(group).getByRole("radio", { name: "Ausente" }));
    expect(screen.getByText("2 sin revisar")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /deshacer/i }));

    expect(screen.getByText("3 sin revisar")).toBeInTheDocument();
  });

  it("says what it is about to undo", async () => {
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();

    const group = await screen.findByRole("radiogroup", { name: /Student 01/ });
    fireEvent.click(within(group).getByRole("radio", { name: "Ausente" }));

    expect(
      screen.getByRole("button", { name: /deshacer: marcar a student 01/i }),
    ).toBeInTheDocument();
  });

  it("walks back more than one mark", async () => {
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();

    const first = await screen.findByRole("radiogroup", { name: /Student 01/ });
    fireEvent.click(within(first).getByRole("radio", { name: "Ausente" }));
    const second = screen.getByRole("radiogroup", { name: /Student 02/ });
    fireEvent.click(within(second).getByRole("radio", { name: "Tardanza" }));

    const undo = screen.getByRole("button", { name: /deshacer/i });
    fireEvent.click(undo);
    expect(stateOf("Student 02", "Presente")).toBe("true");
    expect(stateOf("Student 01", "Ausente")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: /deshacer/i }));
    expect(stateOf("Student 01", "Presente")).toBe("true");
    expect(screen.getByRole("button", { name: /deshacer/i })).toBeDisabled();
  });

  it("undoes the bulk action as one step, not three", async () => {
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();
    await screen.findByText("Student 01");

    fireEvent.click(screen.getByRole("button", { name: /marcar restantes presentes/i }));
    expect(screen.queryByText(/sin revisar/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^deshacer/i }));

    expect(screen.getByText("3 sin revisar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^deshacer/i })).toBeDisabled();
  });

  it("offers the bulk undo in the toast too — it changes rows nobody can see", async () => {
    // 25 students is three pages. "Marcar restantes presentes" rewrites rows on
    // pages 2 and 3 that the trainer never scrolled to, so the confirmation of
    // that action has to carry its own way back.
    mockFetchAlumnosPorHorario.mockResolvedValue(buildAlumnoHorarios(25));
    // The toast stack is mounted by the root layout in the real app; this is
    // the one case that asserts on what the toast itself renders.
    render(
      <ToastProvider>
        <TrainerAttendancePage />
        <ToastContainer />
      </ToastProvider>,
    );
    await openRoster();
    await screen.findByText("Student 01");

    fireEvent.click(screen.getByRole("button", { name: /marcar restantes presentes/i }));

    const toast = await screen.findByRole("status");
    fireEvent.click(within(toast).getByRole("button", { name: "Deshacer" }));

    expect(screen.getByText("25 sin revisar")).toBeInTheDocument();
  });
});
