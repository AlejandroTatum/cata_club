/**
 * Component tests for the admin AttendancePage:
 *  - PR8a: the "Horarios de Entrenamiento" table (PR3) is replaced by a
 *    "Tomar asistencia" link to the (now admin-accessible) flow.
 *  - PR8b: records pagination is a visible, labeled control instead of
 *    tiny icon-only ghost buttons.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AttendancePage from "@/app/attendance/page";
import type { TrainingSchedule, AttendanceRecord } from "@/app/attendance/attendance-utils";

vi.mock("@/components/ProtectedRoute", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/attendance",
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

vi.mock("next/image", () => ({
  __esModule: true,
  // eslint-disable-next-line @next/next/no-img-element
  default: (props: Record<string, unknown>) => <img alt="" {...props} />,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    session: {
      user: { id: "u1", name: "Admin Test", email: "admin@cataclub.com", role: "admin", representanteId: null },
      roles: ["ADMINISTRADOR"],
      loggedInAt: "2026-07-01T12:00:00Z",
    },
    isAuthenticated: true,
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

const SCHEDULES: TrainingSchedule[] = [
  { id: 1, diaSemana: "lun", horaInicio: "15:00", horaFin: "16:30", entrenadorId: 42, entrenadorNombre: "Coach Martinez", nivelRankingId: null },
];

function buildRecords(count: number): AttendanceRecord[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `att-${i + 1}`,
    fecha: "2026-07-01",
    horario: "Lunes 15:00",
    personaId: i + 1,
    estudiante: `Estudiante ${i + 1}`,
    estado: "present" as const,
    entrenador: "Coach Martinez",
  }));
}

const mockFetchTrainingSchedules = vi.fn();
const mockFetchAttendanceRecords = vi.fn();
const mockFetchNotificaciones = vi.fn().mockResolvedValue([]);
const mockMarcarNotificacionLeida = vi.fn().mockResolvedValue(undefined);

vi.mock("@/services/api", () => ({
  fetchTrainingSchedules: () => mockFetchTrainingSchedules(),
  fetchAttendanceRecords: () => mockFetchAttendanceRecords(),
  fetchNotificaciones: () => mockFetchNotificaciones(),
  marcarNotificacionLeida: (id: number) => mockMarcarNotificacionLeida(id),
}));

describe("AttendancePage — Horarios section removed, Tomar asistencia added (PR8)", () => {
  beforeEach(() => {
    mockFetchTrainingSchedules.mockReset().mockResolvedValue(SCHEDULES);
    mockFetchAttendanceRecords.mockReset().mockResolvedValue(buildRecords(5));
  });

  it("removes the Horarios table and replaces it with a Tomar asistencia link", async () => {
    render(<AttendancePage />);

    await waitFor(() => expect(screen.getByText("Registros de Asistencia")).toBeInTheDocument());
    expect(screen.queryByText("Horarios de Entrenamiento")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Filtrar por día")).not.toBeInTheDocument();

    const link = screen.getByRole("link", { name: /tomar asistencia/i });
    expect(link).toHaveAttribute("href", "/trainer/attendance");
  });
});

describe("AttendancePage — visible records pagination (PR8b)", () => {
  beforeEach(() => {
    mockFetchTrainingSchedules.mockReset().mockResolvedValue(SCHEDULES);
    mockFetchAttendanceRecords.mockReset().mockResolvedValue(buildRecords(30));
  });

  it("shows labeled Anterior/Siguiente controls (visible text, not icon-only) and a prominent page count", async () => {
    render(<AttendancePage />);

    expect(await screen.findByText("Página 1 de 2")).toBeInTheDocument();

    const prevButton = screen.getByRole("button", { name: /anterior/i });
    const nextButton = screen.getByRole("button", { name: /siguiente/i });
    // The old design was icon-only with only an aria-label — assert real
    // VISIBLE text content so a regression back to icon-only fails this test.
    expect(prevButton).toHaveTextContent("Anterior");
    expect(nextButton).toHaveTextContent("Siguiente");
    expect(prevButton).toBeDisabled();
    expect(nextButton).toBeEnabled();
  });

  it("advances to the next page and back when the labeled buttons are clicked", async () => {
    render(<AttendancePage />);

    await screen.findByText("Página 1 de 2");
    fireEvent.click(screen.getByRole("button", { name: /siguiente/i }));

    expect(await screen.findByText("Página 2 de 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /siguiente/i })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /anterior/i }));
    expect(await screen.findByText("Página 1 de 2")).toBeInTheDocument();
  });
});
