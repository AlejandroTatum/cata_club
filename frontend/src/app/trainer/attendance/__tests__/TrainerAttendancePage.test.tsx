/**
 * Component tests for TrainerAttendancePage's admin access (PR8).
 * Backend already allows admins to register attendance; the frontend gate
 * was too narrow. Uses the REAL `ProtectedRoute` (not mocked) so the gate
 * itself is what's under test.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import TrainerAttendancePage from "@/app/trainer/attendance/page";
import { createAuthenticatedAuth } from "@/components/__tests__/test-utils";
import { ToastProvider } from "@/contexts/ToastContext";

const mockReplace = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/trainer/attendance",
  useRouter: () => ({ push: vi.fn(), replace: mockReplace }),
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
 * "starts unmarked" guarantee would look broken when it is not.
 */
beforeEach(() => {
  window.sessionStorage.clear();
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

/** Walk the wizard from the schedule accordion to the mark-attendance step. */
async function openRoster(): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: /^lunes/i }));
  fireEvent.click(await screen.findByRole("button", { name: /18:00/i }));
  fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
}

describe("TrainerAttendancePage — unmarked students block submission", () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockFetchTrainingSchedules.mockReset().mockResolvedValue([SCHEDULE]);
    mockFetchAlumnosPorHorario.mockReset().mockResolvedValue([]);
    mockFetchAttendanceRecords.mockReset().mockResolvedValue([]);
    mockRegisterAttendance.mockReset().mockResolvedValue({ createdCount: 0, failed: [] });
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("trainer", "Coach Torres"));
  });

  it("starts every student unmarked rather than pre-marking the roster absent", async () => {
    mockFetchAlumnosPorHorario.mockResolvedValue([ANA_ALUMNO_HORARIO]);

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();

    const group = await screen.findByRole("radiogroup", { name: /Ana López/ });
    // No state is pre-selected — in particular "Ausente" is NOT checked, so a
    // real absence stays distinguishable from an undecided one.
    for (const label of ["Presente", "Ausente", "Tardanza", "Justificado"]) {
      expect(within(group).getByRole("radio", { name: label })).toHaveAttribute("aria-checked", "false");
    }
    expect(screen.getByText("1 Sin marcar")).toBeInTheDocument();
  });

  it("counts unmarked students across the FULL roster, not just the visible page", async () => {
    // 25 students → 3 pages of 10. Page 1 shows Student 01..10 only.
    mockFetchAlumnosPorHorario.mockResolvedValue(buildAlumnoHorarios(25));

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();

    await screen.findByText("Student 01");
    expect(screen.queryByText("Student 11")).not.toBeInTheDocument();
    // The counter must span all 25, not the 10 rendered rows.
    expect(screen.getByText("25 Sin marcar")).toBeInTheDocument();
  });

  it("keeps Siguiente disabled while off-page students are still unmarked", async () => {
    mockFetchAlumnosPorHorario.mockResolvedValue(buildAlumnoHorarios(25));

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();
    await screen.findByText("Student 01");

    // Mark every student visible on page 1 — the other 15 are never seen.
    for (let i = 1; i <= 10; i++) {
      const group = screen.getByRole("radiogroup", { name: new RegExp(`Student ${String(i).padStart(2, "0")}`) });
      fireEvent.click(within(group).getByRole("radio", { name: "Presente" }));
    }

    expect(screen.getByText("15 Sin marcar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Siguiente/ })).toBeDisabled();
  });

  it("names the outstanding count as the visible reason Siguiente is disabled", async () => {
    mockFetchAlumnosPorHorario.mockResolvedValue(buildAlumnoHorarios(3));

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();
    await screen.findByText("Student 01");

    const next = screen.getByRole("button", { name: /Siguiente/ });
    expect(next).toBeDisabled();
    const reason = screen.getByRole("status");
    expect(reason).toHaveTextContent("Faltan 3 alumnos por marcar");
    // The reason is programmatically tied to the button, not just nearby text.
    expect(next.getAttribute("aria-describedby")).toBe(reason.id);
  });

  it("enables Siguiente once every student across every page carries a real state", async () => {
    mockFetchAlumnosPorHorario.mockResolvedValue([ANA_ALUMNO_HORARIO]);

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();

    const group = await screen.findByRole("radiogroup", { name: /Ana López/ });
    expect(screen.getByRole("button", { name: /Siguiente/ })).toBeDisabled();

    fireEvent.click(within(group).getByRole("radio", { name: "Ausente" }));

    expect(screen.queryByText(/Sin marcar/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Siguiente/ })).toBeEnabled();
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

    expect(screen.queryByText(/Sin marcar/)).not.toBeInTheDocument();
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

  it("renders an unmarked row with a neutral dashed outline that a marked row does not have", async () => {
    mockFetchAlumnosPorHorario.mockResolvedValue([ANA_ALUMNO_HORARIO]);

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();

    const group = await screen.findByRole("radiogroup", { name: /Ana López/ });
    const row = group.closest("[data-attendance]");
    expect(row).not.toBeNull();
    expect(row).toHaveAttribute("data-attendance", "unmarked");
    expect(row).toHaveClass("border-dashed");

    fireEvent.click(within(group).getByRole("radio", { name: "Ausente" }));

    expect(row).toHaveAttribute("data-attendance", "absent");
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

    expect(row).toHaveAttribute("data-attendance", "unmarked");
    for (const expected of ["present", "late", "justified", "absent", "present"]) {
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

  it("names the tap target with the student and their current state", async () => {
    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();

    await screen.findByRole("radiogroup", { name: /Ana López/ });
    expect(
      screen.getByRole("button", { name: "Ana López: Sin marcar. Cambiar estado" }),
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

    const marker = screen.getByText("0", { selector: "[aria-live]" });
    expect(marker).toHaveTextContent("0/12");

    fireEvent.click(screen.getByRole("button", { name: "Marcar restantes presentes" }));
    // 12, not 10: the marker spans every page, like the "Sin marcar" counter.
    expect(marker).toHaveTextContent("12/12");
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

    expect(screen.getByText("12 Sin marcar")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Marcar restantes presentes" }));
    expect(screen.getByText("12 Presentes")).toBeInTheDocument();
    expect(screen.queryByText(/Sin marcar/)).not.toBeInTheDocument();
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
    expect(screen.getByText("2 Sin marcar")).toBeInTheDocument();

    // A phone call: the component goes away entirely.
    first.unmount();

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

  it("leaves every other student undecided — a draft only ever narrows", async () => {
    const first = render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();
    await screen.findByText("Student 01");
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: /Student 01/ })).getByRole("radio", {
        name: "Presente",
      }),
    );
    first.unmount();

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    await openRoster();
    await screen.findByText("Student 01");

    // The other two are still unmarked, and the wizard is still blocked.
    expect(screen.getByText("2 Sin marcar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Siguiente/ })).toBeDisabled();
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

    render(<ToastProvider><TrainerAttendancePage /></ToastProvider>);
    fireEvent.click(await screen.findByRole("button", { name: /^lunes/i }));
    fireEvent.click(await screen.findByRole("button", { name: /20:00/i }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    await screen.findByText("Student 01");

    expect(screen.getByText("3 Sin marcar")).toBeInTheDocument();
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

    expect(screen.getByText("3 Sin marcar")).toBeInTheDocument();
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

    expect(screen.queryByText(/Sin marcar/)).not.toBeInTheDocument();
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
