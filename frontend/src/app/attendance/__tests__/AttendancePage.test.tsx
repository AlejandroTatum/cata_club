/**
 * Component tests for the admin AttendancePage.
 *
 * Kept from earlier phases: the "Horarios de Entrenamiento" table stays gone,
 * "Tomar asistencia" stays reachable, and pagination stays a pair of visible,
 * labeled controls rather than icon-only ghost buttons.
 *
 * Added in Fase 3: the range/horario/alumno filters actually reach the records
 * endpoint — this screen used to call it with no arguments at all and pull the
 * whole table on every visit.
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
const mockSearchStudents = vi.fn().mockResolvedValue([]);
const mockFetchNotificaciones = vi.fn().mockResolvedValue([]);
const mockMarcarNotificacionLeida = vi.fn().mockResolvedValue(undefined);

vi.mock("@/services/api", () => ({
  fetchTrainingSchedules: () => mockFetchTrainingSchedules(),
  fetchAttendanceRecords: (params?: unknown) => mockFetchAttendanceRecords(params),
  searchStudents: (query: string) => mockSearchStudents(query),
  fetchNotificaciones: () => mockFetchNotificaciones(),
  marcarNotificacionLeida: (id: number) => mockMarcarNotificacionLeida(id),
}));

beforeEach(() => {
  mockFetchTrainingSchedules.mockReset().mockResolvedValue(SCHEDULES);
  mockFetchAttendanceRecords.mockReset().mockResolvedValue(buildRecords(5));
});

describe("AttendancePage — Horarios section removed, Tomar asistencia in the header", () => {
  it("removes the Horarios table and keeps a Tomar asistencia entry point", async () => {
    render(<AttendancePage />);

    await waitFor(() => expect(screen.getByText("Estudiante 1")).toBeInTheDocument());
    expect(screen.queryByText("Horarios de Entrenamiento")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Filtrar por día")).not.toBeInTheDocument();

    const links = screen.getAllByRole("link", { name: /tomar asistencia/i });
    expect(links.length).toBeGreaterThan(0);
    expect(links[0]).toHaveAttribute("href", "/trainer/attendance");
  });

  it("drops the redundant 'Volver al Panel' link the sidebar already provides", async () => {
    render(<AttendancePage />);
    await waitFor(() => expect(screen.getByText("Estudiante 1")).toBeInTheDocument());

    expect(screen.queryByRole("link", { name: /volver al panel/i })).not.toBeInTheDocument();
  });
});

describe("AttendancePage — filters reach the records endpoint", () => {
  it("queries a bounded range on first load instead of the whole table", async () => {
    render(<AttendancePage />);

    await waitFor(() => expect(mockFetchAttendanceRecords).toHaveBeenCalled());
    const params = mockFetchAttendanceRecords.mock.calls[0][0];
    expect(params).toMatchObject({
      fechaInicio: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      fechaFin: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
  });

  it("passes the selected horario through as horarioId", async () => {
    render(<AttendancePage />);
    await waitFor(() => expect(screen.getByText("Estudiante 1")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Filtrar por horario"), { target: { value: "1" } });

    await waitFor(() => {
      const lastCall = mockFetchAttendanceRecords.mock.calls.at(-1)?.[0];
      expect(lastCall).toMatchObject({ horarioId: 1 });
    });
  });

  it("narrows the range to a single day when 'Hoy' is chosen", async () => {
    render(<AttendancePage />);
    await waitFor(() => expect(screen.getByText("Estudiante 1")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /^hoy$/i }));

    await waitFor(() => {
      const lastCall = mockFetchAttendanceRecords.mock.calls.at(-1)?.[0];
      expect(lastCall.fechaInicio).toBe(lastCall.fechaFin);
    });
  });

  it("refuses to query an inverted custom range and says why", async () => {
    render(<AttendancePage />);
    await waitFor(() => expect(screen.getByText("Estudiante 1")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /rango personalizado/i }));
    fireEvent.change(await screen.findByLabelText("Fecha de inicio"), {
      target: { value: "2026-07-10" },
    });
    const callsBefore = mockFetchAttendanceRecords.mock.calls.length;
    fireEvent.change(screen.getByLabelText("Fecha límite"), { target: { value: "2026-07-01" } });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "La fecha límite no puede ser menor que la fecha de inicio.",
    );
    expect(mockFetchAttendanceRecords.mock.calls.length).toBe(callsBefore);
  });
});

describe("AttendancePage — records table", () => {
  it("humanises the record date instead of printing dd/mm/yyyy in the log", async () => {
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    mockFetchAttendanceRecords.mockResolvedValue([{ ...buildRecords(1)[0], fecha: iso }]);

    render(<AttendancePage />);

    expect(await screen.findByText(/^Hoy, /)).toBeInTheDocument();
  });

  it("renders the attendance state as a badge", async () => {
    render(<AttendancePage />);

    expect((await screen.findAllByText("Presente")).length).toBe(5);
  });

  it("offers a way out when the filters match nothing", async () => {
    mockFetchAttendanceRecords.mockResolvedValue([]);
    render(<AttendancePage />);

    expect(await screen.findByText("No hay registros en este rango")).toBeInTheDocument();
  });
});

describe("AttendancePage — visible records pagination (PR8b)", () => {
  beforeEach(() => {
    mockFetchAttendanceRecords.mockReset().mockResolvedValue(buildRecords(15));
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

    // The "Página X de Y" string is split across multiple text nodes by JSX
    // interpolation (`Página {page} de {total}`), so a plain findByText string
    // match is flaky across re-renders. Match on the normalized textContent
    // of the wrapping <p> instead.
    expect(await screen.findByText((_content, element) => element?.textContent === "Página 2 de 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /siguiente/i })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /anterior/i }));
    expect(await screen.findByText((_content, element) => element?.textContent === "Página 1 de 2")).toBeInTheDocument();
  });
});
