/**
 * Component tests for the trainer dashboard, covering the integrated
 * "Historial de Asistencias" list (filterable + paginated 10-per-page)
 * that was merged into the dashboard below the stats cards.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import TrainerPage from "@/app/trainer/page";
import type { TrainingSchedule, AttendanceRecord } from "@/app/attendance/attendance-utils";
import { createAuthenticatedAuth } from "@/components/__tests__/test-utils";

vi.mock("@/components/ProtectedRoute", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => createAuthenticatedAuth("trainer", "Coach Martinez"),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/trainer",
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/StudentSearch", () => ({
  __esModule: true,
  default: ({ onSelect }: { onSelect: (alumno: { id: number; nombres: string; apellidos: string }) => void }) => (
    <button
      type="button"
      onClick={() => onSelect({ id: 1, nombres: "Ana", apellidos: "López" })}
      aria-label="Buscar alumno"
    >
      Buscar alumno
    </button>
  ),
}));

const SCHEDULES: TrainingSchedule[] = [
  { id: 1, diaSemana: "lun", horaInicio: "15:00", horaFin: "16:30", entrenadorId: 42, entrenadorNombre: "Coach Martinez", nivelRankingId: null },
  { id: 2, diaSemana: "mar", horaInicio: "17:00", horaFin: "18:00", entrenadorId: 42, entrenadorNombre: "Coach Martinez", nivelRankingId: null },
];

/** 12 records to verify pagination shows >1 page. */
function makeRecords(n: number): AttendanceRecord[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `att-${i + 1}`,
    fecha: "2026-07-22",
    horario: "Lunes 15:00",
    personaId: i + 1,
    estudiante: `Alumno ${i + 1}`,
    estado: i % 2 === 0 ? "present" : "absent",
    entrenador: "Coach Martinez",
  }));
}

const mockFetchTrainingSchedules = vi.fn();
const mockFetchAttendanceRecords = vi.fn();

vi.mock("@/services/api", () => ({
  fetchTrainingSchedules: () => mockFetchTrainingSchedules(),
  fetchAttendanceRecords: (params?: unknown) => mockFetchAttendanceRecords(params),
}));

/** True for the single-day range used by the today's stat cards, not the history list. */
function isSingleDayRange(params: { fechaInicio?: string; fechaFin?: string } | undefined): boolean {
  return !!params && params.fechaInicio === params.fechaFin;
}

describe("TrainerPage — Historial de Asistencias (integrado)", () => {
  beforeEach(() => {
    mockFetchTrainingSchedules.mockReset().mockResolvedValue(SCHEDULES);
    mockFetchAttendanceRecords.mockReset().mockImplementation((params) =>
      Promise.resolve(isSingleDayRange(params) ? [] : makeRecords(12)),
    );
  });

  it("renders the history records with fecha, alumno, horario, estado and entrenador", async () => {
    render(<TrainerPage />);

    expect(await screen.findByText("Alumno 1")).toBeInTheDocument();
    expect(screen.getByText("Alumno 2")).toBeInTheDocument();
    // 10 filas comparten fecha y horario en la página 1 → usar getAllByText.
    expect(screen.getAllByText("2026-07-22").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Lunes 15:00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Presente").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Ausente").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Coach Martinez").length).toBeGreaterThan(0);
  });

  it("paginates 10 records per page and shows a next button", async () => {
    render(<TrainerPage />);

    // Page 1: rows 1..10. Page 2: rows 11..12.
    expect(await screen.findByText("Alumno 1")).toBeInTheDocument();
    expect(screen.getByText("Alumno 10")).toBeInTheDocument();
    expect(screen.queryByText("Alumno 11")).not.toBeInTheDocument();

    expect(screen.getByText(/Página 1 de 2/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Página siguiente" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Página anterior" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Página siguiente" }));

    await waitFor(() => {
      expect(screen.getByText("Alumno 11")).toBeInTheDocument();
      expect(screen.queryByText("Alumno 1")).not.toBeInTheDocument();
    });
  });

  it("switches to a custom date range and validates fin >= inicio", async () => {
    render(<TrainerPage />);
    await screen.findByText("Alumno 1");

    fireEvent.click(screen.getByRole("button", { name: "Rango personalizado" }));
    expect(screen.getByLabelText("Fecha de inicio")).toBeInTheDocument();

    // Set an invalid range where fin < inicio → should show the validation error.
    fireEvent.change(screen.getByLabelText("Fecha de inicio"), { target: { value: "2026-07-22" } });
    fireEvent.change(screen.getByLabelText("Fecha límite"), { target: { value: "2026-07-21" } });

    await waitFor(() => {
      expect(
        screen.getByText("La fecha límite no puede ser menor que la fecha de inicio."),
      ).toBeInTheDocument();
    });
  });

  it("re-fetches when the horario filter changes", async () => {
    render(<TrainerPage />);
    await screen.findByText("Alumno 1");
    mockFetchAttendanceRecords.mockClear();

    fireEvent.change(screen.getByLabelText("Filtrar por horario"), { target: { value: "2" } });

    await waitFor(() => {
      expect(mockFetchAttendanceRecords).toHaveBeenCalledWith(
        expect.objectContaining({ horarioId: 2 }),
      );
    });
  });

  it("shows an empty state when there are no records in range", async () => {
    mockFetchAttendanceRecords.mockImplementation(() => Promise.resolve([]));
    render(<TrainerPage />);

    expect(await screen.findByText(/no se encontraron registros/i)).toBeInTheDocument();
  });

  it("shows an error state with Reintentar that retries the fetch", async () => {
    mockFetchAttendanceRecords.mockImplementation((params) =>
      isSingleDayRange(params) ? Promise.resolve([]) : Promise.reject(new Error("boom")),
    );
    render(<TrainerPage />);

    expect(await screen.findByText(/no se pudieron cargar los registros/i)).toBeInTheDocument();
    const retryButtons = screen.getAllByRole("button", { name: "Reintentar" });
    expect(retryButtons.length).toBeGreaterThan(0);

    mockFetchAttendanceRecords.mockImplementation((params) =>
      Promise.resolve(isSingleDayRange(params) ? [] : makeRecords(12)),
    );
    fireEvent.click(retryButtons[retryButtons.length - 1]);

    expect(await screen.findByText("Alumno 1")).toBeInTheDocument();
  });
});
