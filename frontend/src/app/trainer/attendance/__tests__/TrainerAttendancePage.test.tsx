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
/**
 * #334: real `next/navigation` returns a referentially stable router object
 * across renders. Building `{ push, replace }` inline inside `useRouter()`
 * broke that — a fresh object every call fed `ProtectedRoute`'s effect
 * dependency array, which combined with an unstable `allowedRoles` reference
 * to refire the effect (and its toast call) every render, hanging the suite
 * in a synchronous loop. Hoisting it here restores the real contract.
 */
const mockRouter = { push: mockPush, replace: mockReplace };

vi.mock("next/navigation", () => ({
  usePathname: () => "/trainer/attendance",
  useRouter: () => mockRouter,
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
 * disables "Confirmar asistencia" — so any test that files a session needs it.
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
  fetchNotificaciones: vi.fn().mockResolvedValue({ items: [], total: 0, skip: 0, limit: 20 }),
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

  it("defines each of the four attendance states, not just names them (#315 hallazgo #20)", async () => {
    // The FAQ enumerates "Presente Tardanza Justificado Ausente" with zero
    // definitions (indexOf === -1 for all four, even with every accordion
    // open), and this "Cómo funciona pasar lista" panel used to only list the
    // same four names as badges. A novice trainer choosing between four
    // equal-weight buttons needs to know what each one means, not just spell it.
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

    fireEvent.click(screen.getByRole("button", { name: /cómo funciona pasar lista/i }));
    const panel = screen.getByRole("region", { name: /cómo funciona pasar lista/i });

    for (const state of ["Presente", "Tardanza", "Justificado", "Ausente"]) {
      expect(within(panel).getByText(new RegExp(`^${state}:`))).toBeInTheDocument();
    }
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
    fireEvent.click(screen.getByRole("button", { name: "Revisar y confirmar" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar asistencia" }));

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
    fireEvent.click(screen.getByRole("button", { name: "Revisar y confirmar" }));
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
    expect(screen.getByRole("button", { name: "Revisar y confirmar" })).toBeDisabled();
  });

  it("pre-selects Presente for a student who already has an attendance record for today's date + this horario", async () => {
    // Admin, not trainer (issue #310 / #3): a session with an existing record
    // is now a CORRECTION only an admin may edit — a trainer opening this
    // exact roster gets the read-only gate covered by its own describe block
    // below, with no radiogroup to pre-select into. This test is about the
    // PREFILL logic (`buildRosterFromAlumnoHorarios`), which applies the same
    // way regardless of role, so it moves to the role that still sees it as
    // an editable radiogroup.
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("admin", "Admin User"));
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

  // Issue #318 / hallazgo #58 (K9): the roster used to paginate at 10
  // (`WIZARD_PAGE_SIZE`), which is exactly the candado the audit's own click
  // count depended on — "marcar los 10 alumnos de la página 1 (10) → Página
  // siguiente (1) → marcar los 5 de la página 2 (5)" only cost 22 clicks
  // BECAUSE a 15-alumno roster could not render in one screen. This test
  // replaces the old one that asserted that pagination as correct behaviour.
  it("renders the full roster in one pass, with no pagination to change mid-session", async () => {
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

    // All 25, at once — no page 2 to click into.
    await screen.findByText("Student 01");
    expect(screen.getByText("Student 10")).toBeInTheDocument();
    expect(screen.getByText("Student 11")).toBeInTheDocument();
    expect(screen.getByText("Student 25")).toBeInTheDocument();

    expect(screen.queryByText(/Página \d+ de \d+/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Página siguiente" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Página anterior" })).not.toBeInTheDocument();
  });

  // Issue #318 / hallazgo #58 (K9) — the click-count half of the same lock:
  // "un test que exija marcar 15 presentes en ≤3 interacciones". One tap on
  // the existing bulk action (K5's `markRemainingPresent`, unchanged by this
  // cluster) reviews the whole roster regardless of how many render on
  // screen — the fix is that all 15 are now ON screen to begin with.
  it("marks 15 alumnos as reviewed-present in a single interaction, honestly", async () => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("trainer", "Coach Torres"));
    mockFetchTrainingSchedules.mockResolvedValue([
      { id: 12, diaSemana: "lun", horaInicio: "18:00", horaFin: "19:00", entrenadorId: 17, entrenadorNombre: "Coach Torres" },
    ]);

    const students = Array.from({ length: 15 }, (_, i) => ({
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

    // Every one of the 15 has to actually be reachable without paging —
    // otherwise "one click marks them all" would be marking rows the trainer
    // never saw, which is the exact silent-data-loss shape K5 closed.
    expect(screen.getByText("Student 15")).toBeInTheDocument();

    const marker = screen.getByText("0", { selector: "[aria-live]" });
    expect(marker).toHaveTextContent("0/15");

    // Interaction 1 of ≤3: the bulk action.
    fireEvent.click(screen.getByRole("button", { name: "Marcar restantes presentes" }));

    // `reviewedCount`, not the raw "presente" default: this must read the
    // truth of what the trainer actually confirmed, not what the roster
    // defaulted to — the exact tension K5 fixed and this cluster must not
    // reopen.
    expect(marker).toHaveTextContent("15/15");
    expect(screen.queryByText(/sin revisar/)).not.toBeInTheDocument();

    // Interaction 2 of ≤3: advance to the confirmation step.
    fireEvent.click(screen.getByRole("button", { name: "Revisar y confirmar" }));
    expect(await screen.findByText("Horario")).toBeInTheDocument();
    // The confirmation step must not flag anyone as unreviewed either —
    // the bulk action's `reviewed: true` has to survive the step change.
    expect(screen.queryByText(/sin revisar/)).not.toBeInTheDocument();
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

// `diaSemana: "mar"` matches `TUESDAY_IN_CLUB_TIME` (today) on purpose: the
// bulk of this file's tests use `openRoster()` for state/UI behaviour that
// has nothing to do with WHICH date gets filed, and issue #308 made the
// filed date depend on whether the chosen schedule falls on today or not.
// Keeping SCHEDULE same-day as "now" keeps every one of those tests on the
// plain "today" path they were actually written for; the dedicated
// different-day behaviour (choosing a schedule from another day must file
// THAT day's own date) has its own fixtures below, in the "#308" describe
// block.
const SCHEDULE = {
  id: 12,
  diaSemana: "mar",
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
    horarioDia: "mar",
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

/**
 * Walk the wizard from the schedule accordion to the mark-attendance step.
 *
 * SCHEDULE falls on today (`TUESDAY_IN_CLUB_TIME`), so today's single panel
 * is already auto-expanded when the schedules land — no day header to click,
 * unlike the cross-day flow exercised in the "#308" describe block below.
 */
async function openRoster(): Promise<void> {
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

  it("counts unreviewed students across the FULL roster, not just what the name filter shows", async () => {
    // Issue #318 / hallazgo #58 (K9) removed the wizard's pagination — the
    // roster now renders all 25 at once — but the search box still filters,
    // and that is the same silent-data-loss shape pagination used to create:
    // a scope-limited count would report "0 sin revisar" while a filtered-out
    // student was about to be filed present sight unseen.
    mockFetchAlumnosPorHorario.mockResolvedValue(buildAlumnoHorarios(25));

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();

    await screen.findByText("Student 01");
    fireEvent.change(screen.getByRole("textbox", { name: "Filtrar alumnos" }), {
      target: { value: "Student 01" },
    });
    expect(screen.queryByText("Student 11")).not.toBeInTheDocument();
    // The counter must span all 25, not the 1 filtered-in row — a student
    // the filter hides is exactly the one about to be filed present sight
    // unseen.
    expect(screen.getByText("25 sin revisar")).toBeInTheDocument();
    expect(screen.getByText("25 alumnos sin revisar")).toBeInTheDocument();
  });

  it("carries the unreviewed count into the confirmation summary when only some students were reviewed", async () => {
    mockFetchAlumnosPorHorario.mockResolvedValue(buildAlumnoHorarios(25));

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();
    await screen.findByText("Student 01");

    // Mark 10 of the 25 — the other 15 are left on the untouched default.
    for (let i = 1; i <= 10; i++) {
      const group = screen.getByRole("radiogroup", { name: new RegExp(`Student ${String(i).padStart(2, "0")}`) });
      fireEvent.click(within(group).getByRole("radio", { name: "Presente" }));
    }
    expect(screen.getByText("15 sin revisar")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Revisar y confirmar/ }));

    // "25 presentes" on its own would read identically whether the trainer
    // went through the roster or never scrolled past page 1.
    //
    // It reads "25 presentes" now, in the plural: this summary used to print
    // its four counts as badges whose text was a number welded to the NAME of
    // the state ("25 presente"), and the whole panel counts a state through
    // `formatStateCount` since the redesign sweep.
    expect(await screen.findByText("25 presentes")).toBeInTheDocument();
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
    const next = screen.getByRole("button", { name: /Revisar y confirmar/ });
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
    expect(screen.getByRole("button", { name: /Revisar y confirmar/ })).toBeEnabled();
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

  /*
   * D11's third part: an empty state says what is missing, why, and WHAT TO
   * DO. This one had the first two and left the third as a sentence — "revise
   * el filtro o bórrelo" — with nothing to press, while the unreviewed filter
   * beside it had carried its own way out all along.
   */
  it("hands back the way out when the name filter matches nobody", async () => {
    mockFetchAlumnosPorHorario.mockResolvedValue(buildAlumnoHorarios(3));

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();
    await screen.findByText("Student 01");

    fireEvent.change(screen.getByLabelText("Filtrar alumnos"), { target: { value: "zzz" } });
    expect(await screen.findByText("No se encontraron alumnos con ese nombre.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Borrar el filtro" }));

    expect(await screen.findByText("Student 01")).toBeInTheDocument();
    expect(screen.getByLabelText("Filtrar alumnos")).toHaveValue("");
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
    expect(screen.getByText("24 presentes")).toBeInTheDocument();
    expect(within(first).getByRole("radio", { name: "Justificado" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: /Revisar y confirmar/ })).toBeEnabled();
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
    fireEvent.click(screen.getByRole("button", { name: /Revisar y confirmar/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Confirmar asistencia/ }));

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
// #312 / hallazgos #24 y #26 — el radiogroup de asistencia no reaccionaba a
// las flechas (5 tabulaciones por alumno) y en escritorio los cuatro estados
// eran iconos sin rótulo visible (el texto quedaba oculto por CSS a partir de
// 640px, sm:sr-only, y solo sobrevivía como title/tooltip).
// ---------------------------------------------------------------------------
describe("TrainerAttendancePage — teclado y rótulos del radiogroup de asistencia (#312 / #24, #26)", () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockFetchTrainingSchedules.mockReset().mockResolvedValue([SCHEDULE]);
    mockFetchAlumnosPorHorario.mockReset().mockResolvedValue([ANA_ALUMNO_HORARIO]);
    mockFetchAttendanceRecords.mockReset().mockResolvedValue([]);
    mockRegisterAttendance.mockReset();
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("trainer", "Coach Torres"));
  });

  it("gives the group a single tab stop — only the checked radio is tabbable", async () => {
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();

    const group = await screen.findByRole("radiogroup", { name: /Ana López/ });
    const radios = within(group).getAllByRole("radio");
    const tabbable = radios.filter((r) => r.tabIndex === 0);
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toHaveAttribute("aria-checked", "true");
    radios
      .filter((r) => r !== tabbable[0])
      .forEach((r) => expect(r.tabIndex).toBe(-1));
  });

  it("moves focus AND the checked state together with ArrowRight, without leaving the group", async () => {
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();

    const group = await screen.findByRole("radiogroup", { name: /Ana López/ });
    const presente = within(group).getByRole("radio", { name: "Presente" });
    presente.focus();

    fireEvent.keyDown(presente, { key: "ArrowRight" });

    const ausente = within(group).getByRole("radio", { name: "Ausente" });
    expect(ausente).toHaveAttribute("aria-checked", "true");
    expect(document.activeElement).toBe(ausente);
  });

  it("wraps from the last state back to the first with ArrowRight", async () => {
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();

    const group = await screen.findByRole("radiogroup", { name: /Ana López/ });
    fireEvent.click(within(group).getByRole("radio", { name: "Justificado" }));
    const justificado = within(group).getByRole("radio", { name: "Justificado" });
    justificado.focus();

    fireEvent.keyDown(justificado, { key: "ArrowRight" });

    const presente = within(group).getByRole("radio", { name: "Presente" });
    expect(presente).toHaveAttribute("aria-checked", "true");
    expect(document.activeElement).toBe(presente);
  });

  it("moves backward and wraps with ArrowLeft", async () => {
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();

    const group = await screen.findByRole("radiogroup", { name: /Ana López/ });
    const presente = within(group).getByRole("radio", { name: "Presente" });
    presente.focus();

    fireEvent.keyDown(presente, { key: "ArrowLeft" });

    const justificado = within(group).getByRole("radio", { name: "Justificado" });
    expect(justificado).toHaveAttribute("aria-checked", "true");
    expect(document.activeElement).toBe(justificado);
  });

  it("keeps a visible label under each icon from desktop width up, not just sm:", async () => {
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();

    const group = await screen.findByRole("radiogroup", { name: /Ana López/ });
    const label = within(group).getByText("Presente", { selector: "span" });
    // Old class hid it from 640px up (`sm:sr-only`) — a laptop-width screen
    // never saw it. It stays hidden only below `lg` (1024px, where the fiche
    // is a narrow column with no room) and is visible from there on.
    expect(label.className).not.toContain("sm:sr-only");
    expect(label.className).toContain("lg:not-sr-only");
  });
});

// ---------------------------------------------------------------------------
// FASE 4 item 3 — the redesign, layered ON TOP of the guarantees above.
// Prototype: `docs/archive/prototypes/prototipos/20-tomar-lista.html`.
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
    expect(within(stepper).getByText("Horario · Martes 18:00")).toBeInTheDocument();
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
    // Anchored on the fiche's own aria-label prefix (`"${name}: …"`, set in
    // page.tsx): the row's accessible names all start with the student, so an
    // unanchored /Ana López/ stops being unambiguous the moment the row grows
    // a second name-bearing control.
    const fiche = within(row).getByRole("button", { name: /^Ana López:/ });

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
    // Anchored on the fiche's own aria-label prefix (`"${name}: …"`, set in
    // page.tsx): the row's accessible names all start with the student, so an
    // unanchored /Ana López/ stops being unambiguous the moment the row grows
    // a second name-bearing control.
    const fiche = within(row).getByRole("button", { name: /^Ana López:/ });

    for (let i = 0; i < 9; i++) {
      fireEvent.click(fiche);
      expect(row).not.toHaveAttribute("data-attendance", "unmarked");
    }
    // And the wizard therefore stays unblocked.
    expect(screen.getByRole("button", { name: /Revisar y confirmar/ })).toBeEnabled();
  });

  it("keeps the four explicit controls in sync with a tap — the tap is an accelerator", async () => {
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();

    const group = await screen.findByRole("radiogroup", { name: /Ana López/ });
    // Anchored on the fiche's own aria-label prefix (`"${name}: …"`, set in
    // page.tsx) — see the note above: an unanchored /Ana López/ only stays
    // unambiguous while the fiche is the row's one name-bearing control.
    const fiche = within(group.closest("[data-attendance]") as HTMLElement).getByRole("button", {
      name: /^Ana López:/,
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

  // The emergency card lives on `/trainer/students`, the screen whose whole
  // purpose is that ficha. Not here: taking attendance is marking states, and
  // the trigger put a SECOND name-bearing control in every row — two
  // destinations for one tap, on the screen used standing up, phone in hand.
  it("offers no emergency-card trigger inside the roster row", async () => {
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();

    const group = await screen.findByRole("radiogroup", { name: /Ana López/ });
    const row = group.closest("[data-attendance]") as HTMLElement;

    expect(
      within(row).queryByRole("button", { name: /Ficha de emergencia/ }),
    ).not.toBeInTheDocument();
    // What the row still carries: the fiche that cycles the state, and the
    // radiogroup's four explicit controls.
    expect(within(row).getByRole("button", { name: /^Ana López:/ })).toBeInTheDocument();
    expect(within(row).getAllByRole("radio")).toHaveLength(4);
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

  it("shows a live revisados marker over the FULL roster, never a default nobody declared", async () => {
    // Issue #313 (K5 hallazgo #23): the big counter used to read "N/N
    // presentes" before the trainer looked at anyone, because every row
    // starts on the PRESENTE default. A novice reading "16/16 presentes"
    // on open concludes the list is already taken — the default is the
    // absence of a decision, not a result. The counter now measures what
    // was actually REVIEWED, and "sin revisar" is the same honest number.
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();
    await screen.findByText("Student 01");

    // 12, not 10: the marker spans every page, like the unreviewed counter.
    // It reads 0/12 from the first second — nobody has been reviewed yet.
    const marker = screen.getByText("0", { selector: "[aria-live]" });
    expect(marker).toHaveTextContent("0/12");
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

    fireEvent.click(screen.getByRole("button", { name: /Revisar y confirmar/ }));

    expect(await screen.findByRole("button", { name: /Confirmar asistencia/ })).toBeInTheDocument();
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
    expect(screen.queryByText(/Asistencia registrada/i)).not.toBeInTheDocument();
  });

  it("keeps the commit bar reachable without scrolling the card", async () => {
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();
    await screen.findByText("Student 01");

    const bar = screen.getByRole("button", { name: /Revisar y confirmar/ }).closest("div.sticky");
    expect(bar).not.toBeNull();
    expect(bar).toHaveClass("sticky", "bottom-0");
  });

  // Lowercase since the redesign sweep: the bar had its own singular/plural
  // table ("12 Presentes"), the third one in a panel that already had one.
  // Everything that counts a state now spells it through `formatStateCount`.
  it("carries the running totals in the commit bar", async () => {
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();
    await screen.findByText("Student 01");

    expect(screen.getByText("12 presentes")).toBeInTheDocument();
    expect(screen.getByText("12 sin revisar")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Marcar restantes presentes" }));
    expect(screen.getByText("12 presentes")).toBeInTheDocument();
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
    // Both schedules fall on today, so today's panel is already expanded —
    // same reasoning as `openRoster()`, no day header to click.
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
    fireEvent.click(screen.getByRole("button", { name: /Revisar y confirmar/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Confirmar asistencia/ }));
    await screen.findByText(/Asistencia registrada/i);
    first.unmount();

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();
    await screen.findByText("Student 01");

    expect(screen.getByText("3 sin revisar")).toBeInTheDocument();
  });

  /*
   * Regression guard for issue #310 / #5: this test used to assert the
   * OPPOSITE — that a partial failure KEPT the draft, so reopening the roster
   * showed the trainer's REJECTED marks as if the club had them on file. That
   * was the exact defect the audit reported: a rejected write surviving,
   * unlabeled, as if it were real data. The fix discards the draft on any
   * failure, full or partial — a retry re-derives its starting point from the
   * freshly re-fetched roster (`handleRetryFailed`), never from a stale
   * draft.
   */
  it("descarta el borrador incluso cuando el guardado fue parcial, en vez de reabrir con las marcas rechazadas (issue #310)", async () => {
    mockRegisterAttendance.mockResolvedValue({
      createdCount: 2,
      failed: [{ personaId: 102, message: "conflict" }],
    });

    const first = render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();
    await screen.findByText("Student 01");
    fireEvent.click(screen.getByRole("button", { name: "Marcar restantes presentes" }));
    expect(window.sessionStorage.getItem("cata_attendance_draft:12:2026-07-21")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Revisar y confirmar/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Confirmar asistencia/ }));
    await screen.findByText(/Asistencia registrada/i);

    expect(window.sessionStorage.getItem("cata_attendance_draft:12:2026-07-21")).toBeNull();

    first.unmount();
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();
    await screen.findByText("Student 01");

    // No draft, and `fetchAttendanceRecords` keeps returning `[]` in this
    // describe block, so the roster comes back with nobody reviewed — the
    // rejected marks do not reappear disguised as saved ones.
    expect(screen.getByText("3 sin revisar")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Issue #310 — the wizard did not know whether the session it just opened was
// already registered. Two blocking findings shared this one root cause:
//   #3 — a trainer discovered "solo el administrador puede corregir" only on
//        the LAST click of "Confirmar asistencia", after rebuilding every
//        state by hand.
//   #5 — a rejected POST left its unsaved marks in `sessionStorage`, and a
//        reopened roster showed them as if the club had them on file.
// #22 (step 1 cannot tell a taken session from a pending one) is the same
// family, closed alongside these two.
// ---------------------------------------------------------------------------

describe("TrainerAttendancePage — la restricción de corrección se ve al abrir (issue #310)", () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockFetchTrainingSchedules.mockReset().mockResolvedValue([SCHEDULE]);
    mockFetchAlumnosPorHorario.mockReset().mockResolvedValue(buildAlumnoHorarios(3));
    mockFetchAttendanceRecords.mockReset();
    mockRegisterAttendance.mockReset();
  });

  /** Every student in `buildAlumnoHorarios(3)` already has a record for TODAY. */
  function existingRecordsForAllStudents(): unknown[] {
    return buildAlumnoHorarios(3).map((raw) => {
      const s = raw as { personaId: number; personaNombreCompleto: string };
      return {
        id: `att-${s.personaId}`,
        fecha: "2026-07-21",
        horario: "Martes 18:00 — 19:00",
        horarioId: 12,
        personaId: s.personaId,
        estudiante: s.personaNombreCompleto,
        estado: "present",
        entrenador: "Coach Torres",
      };
    });
  }

  it("abre en modo lectura, con el motivo visible, cuando un entrenador reabre una lista ya registrada", async () => {
    mockUseAuth.mockReturnValue(trainerAuthWithPersonaId());
    mockFetchAttendanceRecords.mockResolvedValue(existingRecordsForAllStudents());
    // Issue #397: the card for a taken-today schedule is a real `disabled`
    // control now, so `openRoster()`'s click can no longer reach this state —
    // it still exists, reached the way a reload/deep-link reaches it (#95's
    // URL restore), which is exactly what a trainer coming back to a session
    // they already had open does.
    window.history.replaceState(null, "", "/trainer/attendance?horario=12&paso=lista");

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await screen.findByText("Student 01");

    expect(screen.getByText("Esta lista ya fue registrada.")).toBeInTheDocument();
    expect(screen.getByText(/Solo un administrador puede corregirla/)).toBeInTheDocument();
    // Nothing left that promises an edit the backend was always going to
    // refuse — no radios, and "Revisar y confirmar" is disabled rather than
    // silently reachable.
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Revisar y confirmar" })).toBeDisabled();
  });

  it("no aplica el modo lectura para un administrador, que sí puede corregir", async () => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("admin", "Admin User"));
    mockFetchAttendanceRecords.mockResolvedValue(existingRecordsForAllStudents());

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();
    await screen.findByText("Student 01");

    expect(screen.queryByText("Esta lista ya fue registrada.")).not.toBeInTheDocument();
    expect(screen.getAllByRole("radio").length).toBeGreaterThan(0);
  });

  it("marca en el paso 1 el horario que ya tiene lista tomada hoy (issue #310 / #22)", async () => {
    mockUseAuth.mockReturnValue(trainerAuthWithPersonaId());
    mockFetchAttendanceRecords.mockResolvedValue(existingRecordsForAllStudents());

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    const scheduleButton = await screen.findByRole("button", { name: /18:00/i });

    expect(await within(scheduleButton).findByText(/Lista tomada hoy · 3 registros/)).toBeInTheDocument();
  });

  it("descarta el borrador cuando el guardado es rechazado por completo, no solo cuando fue parcial (issue #310)", async () => {
    mockUseAuth.mockReturnValue(trainerAuthWithPersonaId());
    // No hay registros previos, así que el gate de modo lectura no bloquea el
    // envío — este test cubre el rechazo TOTAL en sí (defensa en profundidad
    // ante, por ejemplo, un administrador que corrige entre la carga y el
    // envío), no el gate del hallazgo #3.
    mockFetchAttendanceRecords.mockResolvedValue([]);
    mockRegisterAttendance.mockReset().mockRejectedValue(
      new Error("No se pudo completar la operación."),
    );

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();
    await screen.findByText("Student 01");
    fireEvent.click(screen.getByRole("button", { name: "Marcar restantes presentes" }));
    expect(window.sessionStorage.getItem("cata_attendance_draft:12:2026-07-21")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Revisar y confirmar/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Confirmar asistencia/ }));

    await waitFor(() => expect(mockRegisterAttendance).toHaveBeenCalled());
    await waitFor(() => {
      expect(window.sessionStorage.getItem("cata_attendance_draft:12:2026-07-21")).toBeNull();
    });
  });

  /**
   * Issue #352 — QA found the button re-enabling with no visible message
   * specifically when the backend was slow enough to trip the client's own
   * timeout, while a fully-cut network (a plain rejection) already showed a
   * toast. Mounts `ToastContainer` — most tests in this file don't, since the
   * toast stack is mounted by the root layout in the real app — because this
   * is exactly the DOM-visibility question issue #352 turns on: a
   * `submitError` that only ever changed component state, without a toast
   * actually reaching the screen, would look identical from the assertions
   * every other test in this describe block makes.
   */
  it("muestra el mismo toast visible ante un timeout que ante una red cortada (issue #352)", async () => {
    mockUseAuth.mockReturnValue(trainerAuthWithPersonaId());
    mockFetchAttendanceRecords.mockResolvedValue([]);

    // A bare rejection stands in for "red totalmente cortada" — fetch itself
    // never resolves a Response.
    mockRegisterAttendance.mockReset().mockRejectedValue(new Error("Failed to fetch"));

    render(
      <ToastProvider>
        <TrainerAttendancePage />
        <ToastContainer />
      </ToastProvider>,
    );
    await openRoster();
    await screen.findByText("Student 01");
    fireEvent.click(screen.getByRole("button", { name: "Marcar restantes presentes" }));
    fireEvent.click(screen.getByRole("button", { name: /Revisar y confirmar/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Confirmar asistencia/ }));

    // Scoped to `.toast-error` (issue #352's fix): `submitError` now ALSO
    // renders inline in the confirmation step, so an unscoped `findByText`
    // would match either node — this test is about the TOAST specifically,
    // the one that is allowed to disappear on its own clock.
    const networkCutToast = await screen.findByText(
      "No se pudo registrar la asistencia. Intente nuevamente.",
      { selector: ".toast-error p" },
    );
    expect(networkCutToast).toBeInTheDocument();
    const networkCutText = networkCutToast.textContent;

    // Let the first toast fully dismiss before triggering the second — both
    // attempts render the identical message, and two simultaneous toasts with
    // the same text would make the next `findByText` ambiguous.
    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    expect(
      screen.queryByText("No se pudo registrar la asistencia. Intente nuevamente.", {
        selector: ".toast-error p",
      }),
    ).not.toBeInTheDocument();

    // A total rejection never advances `step` away from "confirm" (see
    // `handleConfirm`'s catch) — the button that just re-enabled is right
    // here, no need to re-walk the wizard. Simulate the OTHER branch on the
    // SAME retry: the client's own deadline elapsed before the server
    // answered — `ApiTimeoutError`, named "TimeoutError" (see
    // services/api.ts), which is what `request()` throws instead of a bare
    // `AbortError` once its 10s budget expires.
    const timeoutError = new Error("The request exceeded its 10000 ms timeout.");
    timeoutError.name = "TimeoutError";
    mockRegisterAttendance.mockReset().mockRejectedValue(timeoutError);
    fireEvent.click(await screen.findByRole("button", { name: /Confirmar asistencia/ }));

    const timeoutToast = await screen.findByText(
      "No se pudo registrar la asistencia. Intente nuevamente.",
      { selector: ".toast-error p" },
    );
    expect(timeoutToast).toBeInTheDocument();
    expect(timeoutToast.textContent).toBe(networkCutText);
  });

  /**
   * Issue #352, the actual gap: the test above proves the toast EXISTS, never
   * that it PERSISTS — and it passed in green in PR #354 without fixing
   * anything, because the toast dismisses itself in `TOAST_DURATION_MS`
   * (4500ms, `ToastContext.tsx`) while the trainer's own wait for the
   * timeout is `DEFAULT_TIMEOUT_MS` (10000ms, `services/api.ts`). By the
   * time the failure lands, nobody is looking at the corner where the toast
   * already came and went. This test advances past that window and demands
   * the screen still say the save failed, next to the button the trainer
   * would tap to retry.
   */
  it("el aviso de guardado fallido sigue en pantalla después de que el toast se autodescarta (issue #352)", async () => {
    mockUseAuth.mockReturnValue(trainerAuthWithPersonaId());
    mockFetchAttendanceRecords.mockResolvedValue([]);
    mockRegisterAttendance.mockReset().mockRejectedValue(new Error("Failed to fetch"));

    render(
      <ToastProvider>
        <TrainerAttendancePage />
        <ToastContainer />
      </ToastProvider>,
    );
    await openRoster();
    await screen.findByText("Student 01");
    fireEvent.click(screen.getByRole("button", { name: "Marcar restantes presentes" }));
    fireEvent.click(screen.getByRole("button", { name: /Revisar y confirmar/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Confirmar asistencia/ }));

    // The persistent, inline copy — distinct from the toast's own `<p>`, and
    // the one this test is actually about.
    await screen.findByText("No se pudo registrar la asistencia. Intente nuevamente.", {
      selector: ".alert-error",
    });

    // Past the toast's own dismissal window — the toast is gone, but the
    // failure it reported has not stopped being true.
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });

    expect(
      screen.getByText("No se pudo registrar la asistencia. Intente nuevamente.", {
        selector: ".alert-error",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Confirmar asistencia/ }),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Issue #368 — el candado del #310 funciona, pero recién en el paso 2. En el
// paso 1 un horario ya registrado se seleccionaba y ofrecía "Continuar" igual
// que cualquier otro: el entrenador descubría el modo solo lectura después de
// haberse decidido. El indicador "Lista tomada hoy · N registros" informaba,
// pero no decía que eso IMPIDE volver a tomarla ni por qué.
//
// Issue #397 endureció ese arreglo: la tarjeta de un horario tomado hoy ya
// NO es alcanzable por click — es un `disabled` real, no un modo consulta
// vestido de CSS. Los únicos caminos que siguen llegando a modo solo lectura
// son el deep-link/reload (#95) y el caso de "Atrás" después de que un
// horario se tomó mientras el entrenador ya lo tenía seleccionado; ninguno
// pasa por esta tarjeta.
// ---------------------------------------------------------------------------

describe("TrainerAttendancePage — el paso 1 avisa antes de continuar sobre una lista ya tomada (issue #368)", () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockFetchTrainingSchedules.mockReset().mockResolvedValue([SCHEDULE]);
    mockFetchAlumnosPorHorario.mockReset().mockResolvedValue(buildAlumnoHorarios(3));
    mockFetchAttendanceRecords.mockReset();
    mockRegisterAttendance.mockReset();
  });

  /** Los tres alumnos de `buildAlumnoHorarios(3)` ya tienen registro de HOY. */
  function todaysRecordsForAllStudents(): unknown[] {
    return buildAlumnoHorarios(3).map((raw) => {
      const s = raw as { personaId: number; personaNombreCompleto: string };
      return {
        id: `att-${s.personaId}`,
        fecha: "2026-07-21",
        horario: "Martes 18:00 — 19:00",
        horarioId: 12,
        personaId: s.personaId,
        estudiante: s.personaNombreCompleto,
        estado: "present",
        entrenador: "Coach Torres",
      };
    });
  }

  it("nombra en la tarjeta que el entrenador no puede volver a tomarla, y la deshabilita de verdad (issue #397)", async () => {
    mockUseAuth.mockReturnValue(trainerAuthWithPersonaId());
    mockFetchAttendanceRecords.mockResolvedValue(todaysRecordsForAllStudents());

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    const scheduleButton = await screen.findByRole("button", { name: /18:00/i });

    // El conteo del #310 / #22 sigue estando: informa CUÁNTO hay registrado.
    expect(await within(scheduleButton).findByText(/Lista tomada hoy · 3 registros/)).toBeInTheDocument();
    // #397: ya no hay un "modo consulta" que nombrar — la tarjeta es
    // inalcanzable de verdad, así que ese aviso desaparece.
    expect(within(scheduleButton).queryByText(/solo consulta/i)).not.toBeInTheDocument();
    expect(within(scheduleButton).queryByText(/no se puede volver a tomar/i)).not.toBeInTheDocument();

    // El control es un `disabled` nativo, no un cosmético: ni el foco ni el
    // click lo alcanzan.
    expect(scheduleButton).toBeDisabled();

    // Un click no selecciona nada: ni se abre el paso 2/3, ni aparece el
    // aviso de "ya fue tomada hoy", ni "Continuar" se habilita.
    fireEvent.click(scheduleButton);
    expect(screen.queryByText("Esta lista ya fue tomada hoy.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();
  });

  it("no le advierte nada al administrador, que sí puede corregir dentro de la ventana", async () => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("admin", "Admin User"));
    mockFetchAttendanceRecords.mockResolvedValue(todaysRecordsForAllStudents());

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    const scheduleButton = await screen.findByRole("button", { name: /18:00/i });

    expect(await within(scheduleButton).findByText(/Lista tomada hoy · 3 registros/)).toBeInTheDocument();
    expect(within(scheduleButton).queryByText(/no se puede volver a tomar/i)).not.toBeInTheDocument();

    fireEvent.click(scheduleButton);
    expect(screen.queryByText("Esta lista ya fue tomada hoy.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continuar" })).toBeEnabled();
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
    fireEvent.click(screen.getByRole("button", { name: /Revisar y confirmar/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Confirmar asistencia/ }));
    await screen.findByText(/Asistencia registrada/i);
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
// The confirmation receipt (issue #213) — the confirmed screen reads as a
// receipt of the session, not an announcement. Covers the three approved
// content decisions and the accessibility requirements the issue lists.
// ---------------------------------------------------------------------------

describe("TrainerAttendancePage — confirmation receipt (issue #213)", () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockFetchTrainingSchedules.mockReset().mockResolvedValue([SCHEDULE]);
    mockFetchAlumnosPorHorario.mockReset().mockResolvedValue(buildAlumnoHorarios(3));
    mockFetchAttendanceRecords.mockReset().mockResolvedValue([]);
    mockUseAuth.mockReturnValue(trainerAuthWithPersonaId());
  });

  async function fileSession(): Promise<void> {
    await openRoster();
    await screen.findByText("Student 01");
    fireEvent.click(screen.getByRole("button", { name: "Marcar restantes presentes" }));
    fireEvent.click(screen.getByRole("button", { name: /Revisar y confirmar/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Confirmar asistencia/ }));
    await screen.findByText(/Asistencia registrada/i);
  }

  // Decision 1: a state at zero is shown atenuado, never omitted — otherwise
  // "nadie llegó tarde" and "la tardanza no se reportó" read identically.
  it("shows all four states in the breakdown, including a zero, instead of omitting it", async () => {
    mockRegisterAttendance.mockReset().mockResolvedValue({ createdCount: 3, failed: [] });
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await fileSession();

    const presentRow = screen.getByText("Presente").closest("li");
    expect(presentRow).not.toBeNull();
    expect(within(presentRow as HTMLElement).getByText("3")).toBeInTheDocument();

    for (const label of ["Ausente", "Tardanza", "Justificado"]) {
      const row = screen.getByText(label).closest("li");
      expect(row).not.toBeNull();
      expect(within(row as HTMLElement).getByText("0")).toBeInTheDocument();
    }
  });

  // Decision 2: with failed records, the breakdown counts what was SAVED, not
  // what the trainer marked. Student 02 is marked "Justificado" but fails to
  // save, so the receipt must show 0 justificados, not 1.
  it("counts what was saved, not what was marked, when a record failed", async () => {
    mockRegisterAttendance.mockReset().mockResolvedValue({
      createdCount: 2,
      failed: [{ personaId: 101, message: "conflict" }],
    });
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();
    await screen.findByText("Student 01");
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: /Student 02/ })).getByRole("radio", {
        name: "Justificado",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Marcar restantes presentes" }));
    fireEvent.click(screen.getByRole("button", { name: /Revisar y confirmar/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Confirmar asistencia/ }));
    await screen.findByText(/Asistencia registrada/i);

    const justifiedRow = screen.getByText("Justificado").closest("li");
    expect(within(justifiedRow as HTMLElement).getByText("0")).toBeInTheDocument();
    const presentRow = screen.getByText("Presente").closest("li");
    expect(within(presentRow as HTMLElement).getByText("2")).toBeInTheDocument();
  });

  /*
   * Accessibility: the bar is decorative on its own, so its accessible name
   * has to enunciate the four values a sighted reader gets from the bar
   * itself. That requirement is unchanged — the SENTENCE is what moved.
   *
   * The receipt drew its own bar, with its own palette and its own wording,
   * while "Últimas listas" and the history drew the same measurement with the
   * panel's shared one. Both are gone into `SessionComposition`, so the four
   * values now reach a screen reader in the same words wherever they are
   * drawn, and the total comes with them.
   */
  it("gives the proportional bar an aria-label enunciating all four values", async () => {
    mockRegisterAttendance.mockReset().mockResolvedValue({ createdCount: 3, failed: [] });
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await fileSession();

    expect(
      screen.getByRole("img", {
        name: "3 presentes, 0 tardanzas, 0 justificados y 0 ausentes sobre 3 registros",
      }),
    ).toBeInTheDocument();
  });

  // The issue's scoped fix: `page.tsx:1404`'s `!confirmed &&` guard hid the
  // frame's own BackLink exactly when the receipt needed it most.
  it("keeps the frame's BackLink visible once the session is confirmed", async () => {
    mockRegisterAttendance.mockReset().mockResolvedValue({ createdCount: 3, failed: [] });
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await fileSession();

    /*
     * ONE of them now, and closing that is the point of this edit.
     *
     * There were two: the frame's control at the top of the screen and the
     * receipt's own in its action row, both pointing at `backHref` since #213.
     * The duplication was masked while they wrote their own labels — "Volver
     * al Panel del Entrenador" and "Volver al Panel", two names for one
     * destination — and the destination registry, by making both of them say
     * "Volver a Mi día", put it in plain sight. This test used to assert the
     * pair as tolerated, with the note that the duplication was a separate
     * question. It is not a question any more: the frame's control is the one
     * every other screen in the panel keeps, it is the one this test exists to
     * protect, and DESIGN.md puts going back at the bottom of a screen's
     * priorities — so it does not belong in the row that says what to do next.
     */
    const backLinks = screen.getAllByRole("link", { name: /Volver a Mi día/ });
    expect(backLinks).toHaveLength(1);
    // The frame's, carrying the page's own bottom margin.
    expect(backLinks[0].className).toContain("mb-6");
    expect(backLinks[0]).toHaveAttribute("href", "/trainer");
  });

  // Preserved behavior: "Registrar otra asistencia" still runs `handleReset`.
  it('"Registrar otra asistencia" still resets the wizard back to the picker', async () => {
    mockRegisterAttendance.mockReset().mockResolvedValue({ createdCount: 3, failed: [] });
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await fileSession();

    fireEvent.click(screen.getByRole("button", { name: "Registrar otra asistencia" }));

    expect(await screen.findByText("Elija el horario")).toBeInTheDocument();
  });

  // Decision 2: the primary action displaces to the retry — it is the only
  // action that actually corrects the state — and it re-opens the SAME
  // session's roster rather than sending the trainer back to the picker.
  it("moves the primary action to retrying the failed records", async () => {
    mockRegisterAttendance.mockReset().mockResolvedValue({
      createdCount: 2,
      failed: [{ personaId: 101, message: "conflict" }],
    });
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();
    await screen.findByText("Student 01");
    fireEvent.click(screen.getByRole("button", { name: "Marcar restantes presentes" }));
    fireEvent.click(screen.getByRole("button", { name: /Revisar y confirmar/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Confirmar asistencia/ }));
    await screen.findByText(/Asistencia registrada/i);

    const retry = screen.getByRole("button", { name: /Reintentar/ });
    fireEvent.click(retry);

    await screen.findByText("Student 01");
    expect(screen.queryByRole("button", { name: /Confirmar asistencia/ })).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Revisar y confirmar/ })).toBeInTheDocument();
  });

  // A retry whose re-fetch fails must leave the receipt standing. Tearing it
  // down first would show the pre-submission review of a roster that is still
  // fully marked — with no error on that step — where confirming again refiles
  // every student, including the ones already saved.
  it("keeps the receipt when the retry's roster re-fetch fails", async () => {
    mockRegisterAttendance.mockReset().mockResolvedValue({
      createdCount: 2,
      failed: [{ personaId: 101, message: "conflict" }],
    });
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();
    await screen.findByText("Student 01");
    fireEvent.click(screen.getByRole("button", { name: "Marcar restantes presentes" }));
    fireEvent.click(screen.getByRole("button", { name: /Revisar y confirmar/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Confirmar asistencia/ }));
    await screen.findByText(/Asistencia registrada/i);

    mockFetchAlumnosPorHorario.mockRejectedValueOnce(new Error("network down"));
    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }));

    await waitFor(() => expect(mockFetchAlumnosPorHorario).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/Asistencia registrada parcialmente/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reintentar/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Confirmar asistencia/ })).not.toBeInTheDocument();
    expect(mockRegisterAttendance).toHaveBeenCalledTimes(1);
  });

  // Issue #241 hallazgo 1: `rosterError` used to render only on step 1, so a
  // retry launched from the receipt failed with nothing on screen — the
  // button "looked like it did nothing". It must surface here, next to the
  // control that failed, and say what the trainer can do about it.
  it("shows a visible, actionable error on the receipt when the retry's re-fetch fails", async () => {
    mockRegisterAttendance.mockReset().mockResolvedValue({
      createdCount: 2,
      failed: [{ personaId: 101, message: "conflict" }],
    });
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();
    await screen.findByText("Student 01");
    fireEvent.click(screen.getByRole("button", { name: "Marcar restantes presentes" }));
    fireEvent.click(screen.getByRole("button", { name: /Revisar y confirmar/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Confirmar asistencia/ }));
    await screen.findByText(/Asistencia registrada/i);

    mockFetchAlumnosPorHorario.mockRejectedValueOnce(new Error("network down"));
    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }));

    const errorText = await screen.findByText(/No se pudo cargar el listado/i);
    expect(errorText.closest('[role="alert"]')).not.toBeNull();
    // States what happened AND what to do — not just that it failed.
    expect(errorText.textContent).toMatch(/conexión|intente|reintente/i);
  });

  // Issue #241 hallazgo 2: nothing stopped a second click from firing a
  // second request while the first was still in flight.
  it("disables the retry button while its own re-fetch is in flight", async () => {
    mockRegisterAttendance.mockReset().mockResolvedValue({
      createdCount: 2,
      failed: [{ personaId: 101, message: "conflict" }],
    });
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();
    await screen.findByText("Student 01");
    fireEvent.click(screen.getByRole("button", { name: "Marcar restantes presentes" }));
    fireEvent.click(screen.getByRole("button", { name: /Revisar y confirmar/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Confirmar asistencia/ }));
    await screen.findByText(/Asistencia registrada/i);

    let releaseFetch: () => void = () => {};
    mockFetchAlumnosPorHorario.mockReturnValueOnce(
      new Promise((resolve) => {
        releaseFetch = () => resolve(buildAlumnoHorarios(3));
      }),
    );
    const retry = screen.getByRole("button", { name: /Reintentar/ });
    fireEvent.click(retry);

    // Perceivable as more than a color shift: the accessible disabled state
    // and the label itself both change while the request is in flight.
    expect(retry).toHaveAttribute("aria-disabled", "true");
    expect(retry).toHaveTextContent(/Reintentando/i);

    fireEvent.click(retry);
    // The initial `openRoster()` call plus exactly ONE retry call — the
    // repeated click above must not have fired a second request.
    expect(mockFetchAlumnosPorHorario).toHaveBeenCalledTimes(2);

    await act(async () => {
      releaseFetch();
      await Promise.resolve();
    });
  });

  // A re-enabled control a keyboard user can no longer reach is its own kind
  // of silent failure. `disabled` blurs the element to <body> the instant
  // it's applied; this must stay reachable through the whole cycle.
  it("keeps the retry button focusable once it re-enables after a failed re-fetch", async () => {
    mockRegisterAttendance.mockReset().mockResolvedValue({
      createdCount: 2,
      failed: [{ personaId: 101, message: "conflict" }],
    });
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();
    await screen.findByText("Student 01");
    fireEvent.click(screen.getByRole("button", { name: "Marcar restantes presentes" }));
    fireEvent.click(screen.getByRole("button", { name: /Revisar y confirmar/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Confirmar asistencia/ }));
    await screen.findByText(/Asistencia registrada/i);

    let rejectFetch: (reason: unknown) => void = () => {};
    mockFetchAlumnosPorHorario.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectFetch = reject;
        }),
    );
    const retry = screen.getByRole("button", { name: /Reintentar/ });
    retry.focus();
    fireEvent.click(retry);

    // The request must actually go through its disabled phase — otherwise
    // this test would pass trivially without ever exercising a re-enable.
    await waitFor(() => expect(retry).toHaveAttribute("aria-disabled", "true"));

    await act(async () => {
      rejectFetch(new Error("network down"));
      await Promise.resolve();
    });

    await waitFor(() => expect(retry).not.toHaveAttribute("aria-disabled", "true"));
    expect(retry).toHaveFocus();
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
    fireEvent.click(screen.getByRole("button", { name: /Revisar y confirmar/ }));
    await screen.findByRole("button", { name: /Confirmar asistencia/ });
  }

  it("gives each step its own address", async () => {
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    expect(window.location.search).toBe("");

    await openRoster();
    await screen.findByText("Student 01");
    expect(window.location.search).toBe("?horario=12&paso=lista");

    fireEvent.click(screen.getByRole("button", { name: /Revisar y confirmar/ }));
    await screen.findByRole("button", { name: /Confirmar asistencia/ });
    expect(window.location.search).toBe("?horario=12&paso=confirmar");
  });

  it("returns Back from step 3 to the roll call, marks intact, instead of ejecting the trainer", async () => {
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await reachConfirmWithOneMark();

    await pressBrowserBack();

    // Step 2, not /trainer and not "Elija el horario".
    expect(screen.getByRole("button", { name: /Revisar y confirmar/ })).toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: /Revisar y confirmar/ })).toBeInTheDocument();

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
    expect(screen.getByRole("button", { name: /Revisar y confirmar/ })).toBeInTheDocument();

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
    fireEvent.click(screen.getByRole("button", { name: /Revisar y confirmar/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Confirmar asistencia/ }));
    await screen.findByText(/Asistencia registrada/i);
    // The receipt's own URL carries no step: reloading it must not resurrect
    // the roll call that produced it.
    expect(window.location.search).toBe("");

    await pressBrowserBack();

    expect(screen.getByText(/Asistencia registrada/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Confirmar asistencia/ })).not.toBeInTheDocument();
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

    fireEvent.click(screen.getByRole("link", { name: /Volver a Mi día/ }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("¿Salir sin registrar la asistencia?")).toBeInTheDocument();
    expect(within(dialog).getByText(/Marcó 1 de 3 alumnos/)).toBeInTheDocument();
    // Nothing has navigated yet.
    expect(mockPush).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Seguir con la lista" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByText("Student 01")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: /Volver a Mi día/ }));
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
    fireEvent.click(screen.getByRole("link", { name: /Volver a Mi día/ }));

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

// ---------------------------------------------------------------------------
// Issue #335 — regression from #323's read-only mode. `hasUnsavedMarks` used
// to be `!confirmed && reviewedCount > 0`: it could not tell "the server
// already sent every state filled in" apart from "the trainer just typed
// something", so opening an already-registered list in read-only mode and
// leaving WITHOUT touching anything still fired the `beforeunload` prompt.
// ---------------------------------------------------------------------------

describe("TrainerAttendancePage — el aviso de salida distingue datos del servidor de ediciones (issue #335)", () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockPush.mockReset();
    mockFetchTrainingSchedules.mockReset().mockResolvedValue([SCHEDULE]);
    mockFetchAlumnosPorHorario.mockReset().mockResolvedValue(buildAlumnoHorarios(3));
    mockFetchAttendanceRecords.mockReset();
    mockRegisterAttendance.mockReset();
    mockUseAuth.mockReturnValue(trainerAuthWithPersonaId());
  });

  /** Every student in `buildAlumnoHorarios(3)` already has a record for TODAY. */
  function existingRecordsForAllStudents(): unknown[] {
    return buildAlumnoHorarios(3).map((raw) => {
      const s = raw as { personaId: number; personaNombreCompleto: string };
      return {
        id: `att-${s.personaId}`,
        fecha: "2026-07-21",
        horario: "Martes 18:00 — 19:00",
        horarioId: 12,
        personaId: s.personaId,
        estudiante: s.personaNombreCompleto,
        estado: "present",
        entrenador: "Coach Torres",
      };
    });
  }

  function beforeUnloadRegistrations(spy: ReturnType<typeof vi.spyOn>): unknown[][] {
    return spy.mock.calls.filter(([type]) => type === "beforeunload");
  }

  it("no registra el listener de beforeunload en modo lectura sin ninguna interacción", async () => {
    mockFetchAttendanceRecords.mockResolvedValue(existingRecordsForAllStudents());
    const addEventListenerSpy = vi.spyOn(window, "addEventListener");
    // Issue #397: same reasoning as the #310 read-only test above — a
    // taken-today card is disabled now, so this state is reached via URL
    // restore, not via `openRoster()`'s click.
    window.history.replaceState(null, "", "/trainer/attendance?horario=12&paso=lista");

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await screen.findByText("Student 01");

    // Modo lectura confirmado: sin radios que editar.
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(beforeUnloadRegistrations(addEventListenerSpy)).toHaveLength(0);

    addEventListenerSpy.mockRestore();
  });

  it("sí registra el listener de beforeunload cuando el entrenador edita una marca en una lista abierta normalmente", async () => {
    mockFetchAttendanceRecords.mockResolvedValue([]);
    const addEventListenerSpy = vi.spyOn(window, "addEventListener");

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();
    await screen.findByText("Student 01");
    expect(beforeUnloadRegistrations(addEventListenerSpy)).toHaveLength(0);

    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: /Student 01/ })).getByRole("radio", {
        name: "Tardanza",
      }),
    );

    await waitFor(() => {
      expect(beforeUnloadRegistrations(addEventListenerSpy).length).toBeGreaterThan(0);
    });

    addEventListenerSpy.mockRestore();
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
    expect(screen.getByText("Martes 18:00 — 19:00")).toBeInTheDocument();

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

  it("offers the bulk undo in the toast too — it changes rows nobody deliberately reviewed", async () => {
    // 25 students, all rendered at once (#318/#58 removed the wizard's
    // pagination). "Marcar restantes presentes" still rewrites every
    // unreviewed row in one tap, including ones far below the fold the
    // trainer never scrolled to, so the confirmation of that action has to
    // carry its own way back.
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

// ---------------------------------------------------------------------------
// "Corregir" deep-links into ONE session (#95)
//
// The trainer history's rows now address the roll call they summarise:
// `?horario=<id>&fecha=<YYYY-MM-DD>&paso=lista`. The horario alone is not
// enough. The wizard was hard-wired to `clubIsoDate()` everywhere it mattered
// — the prefill of already-filed marks, the draft key, and the date the batch
// is filed on — so a deep link carrying only the horario would have opened
// TODAY's roll call for that group and, on Confirmar, filed a brand new
// session dated today instead of correcting the one the trainer clicked.
//
// The clock in these tests is Tuesday 2026-07-21 in club time, so every date
// below is deliberately NOT today.
// ---------------------------------------------------------------------------

describe("TrainerAttendancePage — a corrected session keeps its own date", () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockPush.mockReset();
    mockFetchTrainingSchedules.mockReset().mockResolvedValue([SCHEDULE]);
    mockFetchAlumnosPorHorario.mockReset().mockResolvedValue(buildAlumnoHorarios(3));
    mockFetchAttendanceRecords.mockReset().mockResolvedValue([]);
    mockRegisterAttendance.mockReset().mockResolvedValue({ createdCount: 3, failed: [] });
    mockUseAuth.mockReturnValue(trainerAuthWithPersonaId());
    window.sessionStorage.clear();
  });

  function deepLink(search: string): void {
    window.history.replaceState(null, "", `/trainer/attendance${search}`);
  }

  it("reads the roll call of the day the URL names, not of today", async () => {
    deepLink("?horario=12&fecha=2026-07-13&paso=lista");

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await screen.findByText("Student 01");

    // The prefill of already-filed marks has to ask for THAT day. Asking for
    // today would show an empty list and hide the very records being corrected.
    expect(mockFetchAttendanceRecords).toHaveBeenCalledWith({
      fechaInicio: "2026-07-13",
      fechaFin: "2026-07-13",
      horarioId: 12,
    });
  });

  it("files the correction on the session's own date", async () => {
    deepLink("?horario=12&fecha=2026-07-13&paso=lista");

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await screen.findByText("Student 01");
    fireEvent.click(screen.getByRole("button", { name: "Marcar restantes presentes" }));
    fireEvent.click(screen.getByRole("button", { name: /Revisar y confirmar/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Confirmar asistencia/ }));

    await waitFor(() => expect(mockRegisterAttendance).toHaveBeenCalled());
    // Without this the "correction" is a second session dated today, and the
    // wrong one stays wrong.
    expect(mockRegisterAttendance.mock.calls[0][0]).toMatchObject({
      horarioId: 12,
      fechaEntrenamiento: "2026-07-13",
    });
  });

  it("keys the draft by the session being corrected", async () => {
    deepLink("?horario=12&fecha=2026-07-13&paso=lista");

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await screen.findByText("Student 01");
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: /Student 01/ })).getByRole("radio", {
        name: "Tardanza",
      }),
    );

    // A correction interrupted halfway must not come back as today's draft.
    expect(window.sessionStorage.getItem("cata_attendance_draft:12:2026-07-13")).not.toBeNull();
    expect(window.sessionStorage.getItem("cata_attendance_draft:12:2026-07-21")).toBeNull();
  });

  it("carries the date through the wizard's own steps", async () => {
    deepLink("?horario=12&fecha=2026-07-13&paso=lista");

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await screen.findByText("Student 01");
    expect(window.location.search).toBe("?horario=12&fecha=2026-07-13&paso=lista");

    fireEvent.click(screen.getByRole("button", { name: /Revisar y confirmar/ }));
    await screen.findByRole("button", { name: /Confirmar asistencia/ });
    // Losing the date on Siguiente would file the batch on today after all.
    expect(window.location.search).toBe("?horario=12&fecha=2026-07-13&paso=confirmar");

    await pressBrowserBack();
    expect(await screen.findByText("Student 01")).toBeInTheDocument();
    expect(window.location.search).toBe("?horario=12&fecha=2026-07-13&paso=lista");
  });

  it("ignores a fecha with no horario to belong to", async () => {
    deepLink("?fecha=2026-07-13&paso=lista");

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);

    expect(await screen.findByText("Elija el horario")).toBeInTheDocument();
    expect(mockFetchAlumnosPorHorario).not.toHaveBeenCalled();
  });

  it("falls back to today when the URL names no date at all", async () => {
    // The ordinary "pasar lista" flow is untouched: today needs no address,
    // so its URL stays exactly as short as it was.
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();
    await screen.findByText("Student 01");

    expect(window.location.search).toBe("?horario=12&paso=lista");
    expect(mockFetchAttendanceRecords).toHaveBeenCalledWith({
      fechaInicio: "2026-07-21",
      fechaFin: "2026-07-21",
      horarioId: 12,
    });

    fireEvent.click(screen.getByRole("button", { name: "Marcar restantes presentes" }));
    fireEvent.click(screen.getByRole("button", { name: /Revisar y confirmar/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Confirmar asistencia/ }));

    await waitFor(() => expect(mockRegisterAttendance).toHaveBeenCalled());
    expect(mockRegisterAttendance.mock.calls[0][0]).toMatchObject({
      horarioId: 12,
      fechaEntrenamiento: "2026-07-21",
    });
  });
});

// ---------------------------------------------------------------------------
// Issue #308 (audit finding #4, blocking): choosing a schedule from a
// DIFFERENT day must file its own date, not today's.
//
// Reproduced live: a trainer picked "Miércoles 17:00 — 18:00" on a Sunday —
// the exact flow `/trainer`'s own empty state recommends ("puede pasar la
// lista de otro día si quedó pendiente") — and the POST carried today's
// (Sunday's) date. 50 of 50 sessions taken this way came back with a
// `fechaEntrenamiento` that disagreed with the horario's `diaSemana`.
//
// The clock here is the file's global Tuesday 2026-07-21; the only schedule
// on offer is Wednesday's, so today's picker panel is empty and the trainer
// reaches it exactly the way the empty state describes.
// ---------------------------------------------------------------------------

describe("TrainerAttendancePage — a schedule from a different day keeps ITS OWN date (#308)", () => {
  const WEDNESDAY_SCHEDULE = {
    id: 20,
    diaSemana: "mie",
    horaInicio: "17:00",
    horaFin: "18:00",
    entrenadorId: 21,
    entrenadorNombre: "Coach Vera",
  };
  /** The Wednesday just past, as club-date.ts's `lastOccurrenceOfDiaSemana`
   * resolves it from Tuesday 2026-07-21 — never the 21st itself. */
  const LAST_WEDNESDAY = "2026-07-15";

  beforeEach(() => {
    mockReplace.mockReset();
    mockPush.mockReset();
    mockFetchTrainingSchedules.mockReset().mockResolvedValue([WEDNESDAY_SCHEDULE]);
    mockFetchAlumnosPorHorario.mockReset().mockResolvedValue(buildAlumnoHorarios(2));
    mockFetchAttendanceRecords.mockReset().mockResolvedValue([]);
    mockRegisterAttendance.mockReset().mockResolvedValue({ createdCount: 2, failed: [] });
    mockUseAuth.mockReturnValue(trainerAuthWithPersonaId());
    window.sessionStorage.clear();
  });

  /**
   * Today (Tuesday) has nothing scheduled, so the picker already shows the
   * full week without needing "Ver todos los días" — same reasoning as
   * `openRoster()`, just walking Wednesday's panel instead of today's.
   */
  async function openWednesdayRoster(): Promise<void> {
    fireEvent.click(await screen.findByRole("button", { name: /^miércoles/i }));
    fireEvent.click(await screen.findByRole("button", { name: /17:00/i }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
  }

  it("addresses the roll call with that day's own date, not today's", async () => {
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openWednesdayRoster();
    await screen.findByText("Student 01");

    expect(window.location.search).toBe(`?horario=20&fecha=${LAST_WEDNESDAY}&paso=lista`);
    // The prefill of already-filed marks has to ask for the Wednesday that
    // actually happened — asking for today (Tuesday) would silently hide any
    // marks already on file for that session.
    expect(mockFetchAttendanceRecords).toHaveBeenCalledWith({
      fechaInicio: LAST_WEDNESDAY,
      fechaFin: LAST_WEDNESDAY,
      horarioId: 20,
    });
  });

  it("files the batch on the Wednesday that actually happened, never on today", async () => {
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openWednesdayRoster();
    await screen.findByText("Student 01");
    fireEvent.click(screen.getByRole("button", { name: "Marcar restantes presentes" }));
    fireEvent.click(screen.getByRole("button", { name: /Revisar y confirmar/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Confirmar asistencia/ }));

    await waitFor(() => expect(mockRegisterAttendance).toHaveBeenCalled());
    // The whole point of #308: without the fix this would be "2026-07-21"
    // (today), and the Wednesday session the trainer actually ran would
    // still be wrong in the history.
    expect(mockRegisterAttendance.mock.calls[0][0]).toMatchObject({
      horarioId: 20,
      fechaEntrenamiento: LAST_WEDNESDAY,
    });
  });

  it("keys the draft by the Wednesday session, not by today", async () => {
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openWednesdayRoster();
    await screen.findByText("Student 01");
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: /Student 01/ })).getByRole("radio", {
        name: "Tardanza",
      }),
    );

    expect(window.sessionStorage.getItem(`cata_attendance_draft:20:${LAST_WEDNESDAY}`)).not.toBeNull();
    expect(window.sessionStorage.getItem("cata_attendance_draft:20:2026-07-21")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Issue #346 (regresión de #308 + #310): la fecha de una sesión y "hoy" eran
// siempre el mismo valor antes de K1, así que ninguna pantalla necesitaba
// distinguirlas. Separarlas en la escritura dejó expuesta cualquier lectura
// que todavía asumiera que coinciden -- este candado cubre el detalle real de
// la sesión (el propio roster del wizard), el tercer punto del triángulo
// junto con "Mi día" e "Historial".
//
// Todos los mocks de `fetchAttendanceRecords` de arriba devuelven lo mismo sin
// mirar el rango recibido, así que ninguno puede distinguir un rango correcto
// de uno roto que hubiera pedido la fecha de HOY. Este bloque, en cambio,
// filtra por el rango recibido -- como el backend real filtra por
// `fecha_entrenamiento` -- para que la aserción solo pase si el wizard
// realmente pide la fecha de la sesión.
// ---------------------------------------------------------------------------
describe("TrainerAttendancePage — el detalle de la sesión coincide con lo ya registrado (issue #346)", () => {
  const SUNDAY_IN_CLUB_TIME = new Date("2026-08-16T15:00:00Z");
  const WEDNESDAY_SCHEDULE = {
    id: 30,
    diaSemana: "mie",
    horaInicio: "17:00",
    horaFin: "18:00",
    entrenadorId: 21,
    entrenadorNombre: "Coach Vera",
  };
  const WEDNESDAY_SESSION_DATE = "2026-08-12";

  function closedWednesdayRecords(): unknown[] {
    return buildAlumnoHorarios(15).map((raw) => {
      const s = raw as { personaId: number; personaNombreCompleto: string };
      return {
        id: `att-${s.personaId}`,
        fecha: WEDNESDAY_SESSION_DATE,
        horario: "Miércoles 17:00 — 18:00",
        horarioId: WEDNESDAY_SCHEDULE.id,
        personaId: s.personaId,
        estudiante: s.personaNombreCompleto,
        estado: "present",
        registradoPorNombre: "Coach Vera",
      };
    });
  }

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(SUNDAY_IN_CLUB_TIME);
    mockReplace.mockReset();
    mockPush.mockReset();
    mockFetchTrainingSchedules.mockReset().mockResolvedValue([WEDNESDAY_SCHEDULE]);
    mockFetchAlumnosPorHorario.mockReset().mockResolvedValue(buildAlumnoHorarios(15));
    mockUseAuth.mockReturnValue(trainerAuthWithPersonaId());
    window.sessionStorage.clear();
    // El mismo mock consciente del rango que el candado de Historial: filtra
    // por lo que de verdad recibe, no devuelve lo mismo siempre.
    mockFetchAttendanceRecords.mockReset().mockImplementation(
      (params?: { fechaInicio?: string; fechaFin?: string; horarioId?: number }) =>
        Promise.resolve(
          closedWednesdayRecords().filter((raw) => {
            const r = raw as { fecha: string; horarioId: number };
            if (params?.fechaInicio && r.fecha < params.fechaInicio) return false;
            if (params?.fechaFin && r.fecha > params.fechaFin) return false;
            if (params?.horarioId !== undefined && r.horarioId !== params.horarioId) return false;
            return true;
          }),
        ),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Hoy es domingo y no hay nada programado, así que el acordeón ya
   *  muestra la semana completa (misma razón que en el bloque "#308"). */
  async function openWednesdayRoster(): Promise<void> {
    fireEvent.click(await screen.findByRole("button", { name: /^miércoles/i }));
    fireEvent.click(await screen.findByRole("button", { name: /17:00/i }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
  }

  it("abre en modo lectura con las 15 marcas ya registradas, visto un domingo (candado #346)", async () => {
    render(
      <ToastProvider>
        <TrainerAttendancePage />
      </ToastProvider>,
    );
    await openWednesdayRoster();
    await screen.findByText("Student 01");

    // El pedido de prefill tiene que direccionarse con la fecha DE LA SESIÓN
    // (el miércoles pasado), nunca con la de hoy (domingo) -- pedir la de hoy
    // habría vuelto con 0 registros y mostrado la lista como sin tomar.
    expect(mockFetchAttendanceRecords).toHaveBeenCalledWith({
      fechaInicio: WEDNESDAY_SESSION_DATE,
      fechaFin: WEDNESDAY_SESSION_DATE,
      horarioId: WEDNESDAY_SCHEDULE.id,
    });
    expect(screen.getByText("Esta lista ya fue registrada.")).toBeInTheDocument();
    // Los 15 inscriptos completos, ninguno perdido por pedir la fecha
    // equivocada -- el mismo número que reporta Admin para ese horario.
    expect(screen.getByText("Student 15")).toBeInTheDocument();
  });
});
