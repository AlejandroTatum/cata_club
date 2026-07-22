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
const mockFetchNivelesConOcupacion = vi.fn().mockResolvedValue([]);
const mockFetchNivelRoster = vi.fn().mockResolvedValue([]);
const mockRegisterAttendance = vi.fn();

vi.mock("@/services/api", () => ({
  fetchTrainingSchedules: () => mockFetchTrainingSchedules(),
  fetchNivelesConOcupacion: () => mockFetchNivelesConOcupacion(),
  fetchNivelRoster: () => mockFetchNivelRoster(),
  registerAttendance: (request: unknown) => mockRegisterAttendance(request),
  fetchNotificaciones: vi.fn().mockResolvedValue([]),
  marcarNotificacionLeida: vi.fn().mockResolvedValue(undefined),
}));

describe("TrainerAttendancePage — role gate (PR8)", () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockFetchTrainingSchedules.mockResolvedValue([]);
    mockFetchNivelesConOcupacion.mockResolvedValue([]);
    mockFetchNivelRoster.mockResolvedValue([]);
    mockRegisterAttendance.mockReset();
  });

  it.each([
    ["admin", "Admin User"],
    ["trainer", "Coach Torres"],
  ] as const)("grants access to role=%s instead of redirecting away", async (role, name) => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth(role, name));

    render(<TrainerAttendancePage />);

    expect(await screen.findByText("Seleccione el horario de entrenamiento:")).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("redirects a role with no attendance access (e.g. tesorero) away", async () => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("tesorero", "Treasurer User"));

    render(<TrainerAttendancePage />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/payments"));
    expect(screen.queryByText("Seleccione el horario de entrenamiento:")).not.toBeInTheDocument();
  });

  it("lets a trainer directly select each visibly labeled attendance state", async () => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("trainer", "Coach Torres"));
    mockFetchTrainingSchedules.mockResolvedValue([
      { id: 12, diaSemana: "lunes", horaInicio: "18:00", horaFin: "19:00", entrenadorId: 17, entrenadorNombre: "Coach Torres" },
    ]);
    mockFetchNivelesConOcupacion.mockResolvedValue([
      { id: 4, numeroNivel: 2, nombre: "Intermedio", nivelCategoria: "intermedio", personasActuales: 1 },
    ]);
    mockFetchNivelRoster.mockResolvedValue([
      { personaId: 9, personaNombreCompleto: "Ana López", posicionActual: 1, puntajeAcumulado: 20, estaEnRanking: true },
    ]);

    render(<TrainerAttendancePage />);

    fireEvent.click(await screen.findByRole("button", { name: /lunes/i }));
    fireEvent.click(screen.getByRole("button", { name: /intermedio/i }));
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
      { id: 12, diaSemana: "lunes", horaInicio: "18:00", horaFin: "19:00", entrenadorId: 17, entrenadorNombre: "Coach Torres" },
    ]);
    mockFetchNivelesConOcupacion.mockResolvedValue([
      { id: 4, numeroNivel: 2, nombre: "Intermedio", nivelCategoria: "intermedio", personasActuales: 1 },
    ]);
    mockFetchNivelRoster.mockResolvedValue([
      { personaId: 9, personaNombreCompleto: "Ana López", posicionActual: 1, puntajeAcumulado: 20, estaEnRanking: true },
    ]);
    mockRegisterAttendance.mockResolvedValue({ createdCount: 1, failed: [] });

    render(<TrainerAttendancePage />);

    fireEvent.click(await screen.findByRole("button", { name: /lunes/i }));
    fireEvent.click(screen.getByRole("button", { name: /intermedio/i }));
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

  it("opens named help that preserves the existing Justificado semantics", async () => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("trainer", "Coach Torres"));
    mockFetchTrainingSchedules.mockResolvedValue([
      { id: 12, diaSemana: "lunes", horaInicio: "18:00", horaFin: "19:00", entrenadorId: 17, entrenadorNombre: "Coach Torres" },
    ]);
    mockFetchNivelesConOcupacion.mockResolvedValue([
      { id: 4, numeroNivel: 2, nombre: "Intermedio", nivelCategoria: "intermedio", personasActuales: 1 },
    ]);
    mockFetchNivelRoster.mockResolvedValue([
      { personaId: 9, personaNombreCompleto: "Ana López", posicionActual: 1, puntajeAcumulado: 20, estaEnRanking: true },
    ]);

    render(<TrainerAttendancePage />);
    fireEvent.click(await screen.findByRole("button", { name: /lunes/i }));
    fireEvent.click(screen.getByRole("button", { name: /intermedio/i }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Ayuda sobre el estado Justificado" }));

    const help = screen.getByRole("region", { name: "Ayuda sobre el estado Justificado" });
    expect(help).toHaveTextContent("no modifica la validación ni el significado actual");
  });
});

// ---------------------------------------------------------------------------
// Slice 7 — schedule→group linkage: derive roster when nivelRankingId is
// set, preserve the explicit manual-selection fallback when it's null.
// ---------------------------------------------------------------------------

describe("TrainerAttendancePage — schedule→group linkage (Slice 7)", () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockFetchTrainingSchedules.mockResolvedValue([]);
    mockFetchNivelesConOcupacion.mockResolvedValue([]);
    mockFetchNivelRoster.mockResolvedValue([]);
    mockRegisterAttendance.mockReset();
  });

  it("derives the linked nivel automatically and fetches its real roster, without asking the trainer to pick a group", async () => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("trainer", "Coach Torres"));
    mockFetchTrainingSchedules.mockResolvedValue([
      { id: 12, diaSemana: "lunes", horaInicio: "18:00", horaFin: "19:00", entrenadorId: 17, entrenadorNombre: "Coach Torres", nivelRankingId: 4 },
    ]);
    mockFetchNivelesConOcupacion.mockResolvedValue([
      { id: 4, numeroNivel: 2, nombre: "Intermedio", nivelCategoria: "intermedio", personasActuales: 1 },
    ]);
    mockFetchNivelRoster.mockResolvedValue([
      { personaId: 9, personaNombreCompleto: "Ana López", posicionActual: 1, puntajeAcumulado: 20, estaEnRanking: true },
    ]);

    render(<TrainerAttendancePage />);

    fireEvent.click(await screen.findByRole("button", { name: /lunes/i }));
    // No manual "Intermedio" group button needed — the link is derived.
    expect(screen.queryByRole("button", { name: /intermedio/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));

    await waitFor(() => expect(mockFetchNivelRoster).toHaveBeenCalledWith(4));
    // Roster comes from the real tabla response, never fabricated client-side.
    expect(await screen.findByText("Ana López")).toBeInTheDocument();
  });

  it("keeps the explicit manual nivel-selection fallback when nivelRankingId is null", async () => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("trainer", "Coach Torres"));
    mockFetchTrainingSchedules.mockResolvedValue([
      { id: 12, diaSemana: "lunes", horaInicio: "18:00", horaFin: "19:00", entrenadorId: 17, entrenadorNombre: "Coach Torres", nivelRankingId: null },
    ]);
    mockFetchNivelesConOcupacion.mockResolvedValue([
      { id: 4, numeroNivel: 2, nombre: "Intermedio", nivelCategoria: "intermedio", personasActuales: 1 },
    ]);
    mockFetchNivelRoster.mockResolvedValue([
      { personaId: 9, personaNombreCompleto: "Ana López", posicionActual: 1, puntajeAcumulado: 20, estaEnRanking: true },
    ]);

    render(<TrainerAttendancePage />);

    fireEvent.click(await screen.findByRole("button", { name: /lunes/i }));
    // Manual selection is still required and still honest — "Continuar" is
    // disabled until the trainer picks a group explicitly.
    expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /intermedio/i }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));

    await waitFor(() => expect(mockFetchNivelRoster).toHaveBeenCalledWith(4));
  });
});
