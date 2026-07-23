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

const mockFetchTrainingSchedules = vi.fn().mockResolvedValue([]);
const mockFetchAlumnosPorHorario = vi.fn().mockResolvedValue([]);
const mockFetchAttendanceRecords = vi.fn().mockResolvedValue([]);
const mockRegisterAttendance = vi.fn();

vi.mock("@/services/api", () => ({
  fetchTrainingSchedules: () => mockFetchTrainingSchedules(),
  fetchAlumnosPorHorario: (horarioId: number) => mockFetchAlumnosPorHorario(horarioId),
  fetchAttendanceRecords: (params: unknown) => mockFetchAttendanceRecords(params),
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

    const stateSelector = await screen.findByRole("group", { name: "Estado de asistencia de Ana López" });
    expect(within(stateSelector).getByRole("button", { name: "Presente" })).toBeVisible();
    expect(within(stateSelector).getByRole("button", { name: "Ausente" })).toBeVisible();
    expect(within(stateSelector).getByRole("button", { name: "Tardanza" })).toBeVisible();
    const justified = within(stateSelector).getByRole("button", { name: "Justificado" });

    fireEvent.click(justified);

    expect(justified).toHaveAttribute("aria-pressed", "true");
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
    const stateSelector = await screen.findByRole("group", { name: "Estado de asistencia de Ana López" });
    fireEvent.click(within(stateSelector).getByRole("button", { name: "Justificado" }));
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

    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    expect(await screen.findByText("Horario")).toBeInTheDocument();
    expect(screen.getAllByText("Lunes", { exact: false }).length).toBeGreaterThan(0);
    expect(screen.queryByText("Grupo")).not.toBeInTheDocument();
    expect(screen.queryByText(/Nivel \d/)).not.toBeInTheDocument();
  });

  it("pre-selects Presente for a student who already has an attendance record for today's session, instead of defaulting to Ausente", async () => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("trainer", "Coach Torres"));
    mockFetchTrainingSchedules.mockResolvedValue([
      { id: 12, diaSemana: "lun", horaInicio: "18:00", horaFin: "19:00", entrenadorId: 17, entrenadorNombre: "Coach Torres" },
    ]);
    mockFetchAlumnosPorHorario.mockResolvedValue([ANA_ALUMNO_HORARIO]);
    mockFetchAttendanceRecords.mockResolvedValue([
      {
        id: "900",
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

    await waitFor(() =>
      expect(mockFetchAttendanceRecords).toHaveBeenCalledWith(
        expect.objectContaining({ horarioId: 12 }),
      ),
    );

    const stateSelector = await screen.findByRole("group", { name: "Estado de asistencia de Ana López" });
    expect(within(stateSelector).getByRole("button", { name: "Presente" })).toHaveAttribute("aria-pressed", "true");
    expect(within(stateSelector).getByRole("button", { name: "Ausente" })).toHaveAttribute("aria-pressed", "false");
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
