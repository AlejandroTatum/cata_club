/**
 * Component tests for RankingPage (admin) — "la escalera".
 *
 * The screen used to be a per-student table with a nivel `<select>` per row.
 * It is now the ladder itself: one rung per nivel, ordered 1→10, with the
 * roster as an avatar stack and a single "Asignar" action that opens an
 * assignment panel scoped to that rung.
 *
 * These tests exist mostly to keep two settled product rules from silently
 * regressing: no occupancy indicator of any kind, and no "Promover" action.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import RankingPage from "@/app/ranking/page";
import type { AlumnoParaNivel, NivelConOcupacion } from "@/services/api";

vi.mock("@/components/ProtectedRoute", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/ranking",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
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

const mockShowError = vi.fn();
const mockShowSuccess = vi.fn();
vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({
    showToast: vi.fn(),
    showError: mockShowError,
    showSuccess: mockShowSuccess,
  }),
}));

const mockFetchAlumnosParaNivel = vi.fn();
const mockFetchNivelesConOcupacion = vi.fn();
const mockAssignStudentToNivel = vi.fn();
const mockMoveStudentToNivel = vi.fn();

vi.mock("@/services/api", () => {
  class MockApiClientError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = "ApiClientError";
      this.status = status;
    }
  }
  return {
    fetchAlumnosParaNivel: () => mockFetchAlumnosParaNivel(),
    fetchNivelesConOcupacion: () => mockFetchNivelesConOcupacion(),
    assignStudentToNivel: (personaId: number, nivelId: number) => mockAssignStudentToNivel(personaId, nivelId),
    moveStudentToNivel: (personaId: number, nivelId: number) => mockMoveStudentToNivel(personaId, nivelId),
    fetchNotificaciones: vi.fn().mockResolvedValue([]),
    marcarNotificacionLeida: vi.fn().mockResolvedValue(undefined),
    ApiClientError: MockApiClientError,
  };
});

/**
 * Deliberately returned out of rank order, and deliberately carrying the
 * occupancy fields the API really sends — the screen has to sort 1-first
 * itself and has to keep those three numbers off the page.
 */
const NIVELES: NivelConOcupacion[] = [
  {
    id: 3,
    numeroNivel: 3,
    nombre: "Nivel Base",
    capacidadMinima: 6,
    capacidadMaxima: 10,
    personasActuales: 2,
    cuposDisponibles: 8,
    necesitaRevision: true,
    nivelCategoria: "avanzado",
  },
  {
    id: 1,
    numeroNivel: 1,
    nombre: "Nivel Cima",
    capacidadMinima: 6,
    capacidadMaxima: 10,
    personasActuales: 1,
    cuposDisponibles: 9,
    necesitaRevision: true,
    nivelCategoria: "avanzado",
  },
  {
    id: 2,
    numeroNivel: 2,
    nombre: "Nivel Medio",
    capacidadMinima: 6,
    capacidadMaxima: 10,
    personasActuales: 0,
    cuposDisponibles: 10,
    necesitaRevision: true,
    nivelCategoria: "avanzado",
  },
];

const ROSTER: AlumnoParaNivel[] = [
  { personaId: 10, nombres: "Sofía", apellidos: "González", activo: true, representanteId: null, nivelRankingId: null },
  { personaId: 11, nombres: "Pedro", apellidos: "Ramírez", activo: true, representanteId: null, nivelRankingId: 1 },
  { personaId: 12, nombres: "Carla", apellidos: "Vera", activo: true, representanteId: null, nivelRankingId: 3 },
];

describe("RankingPage — la escalera", () => {
  beforeEach(() => {
    mockFetchAlumnosParaNivel.mockReset().mockResolvedValue(ROSTER);
    mockFetchNivelesConOcupacion.mockReset().mockResolvedValue(NIVELES);
    mockAssignStudentToNivel.mockReset().mockResolvedValue(undefined);
    mockMoveStudentToNivel.mockReset().mockResolvedValue(undefined);
    mockShowError.mockClear();
    mockShowSuccess.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders one rung per nivel, ordered with 1 at the top", async () => {
    render(<RankingPage />);
    await screen.findByText("Nivel Cima");

    const rungs = screen.getAllByRole("listitem");
    expect(rungs).toHaveLength(3);
    expect(rungs[0]).toHaveTextContent("Nivel Cima");
    expect(rungs[1]).toHaveTextContent("Nivel Medio");
    expect(rungs[2]).toHaveTextContent("Nivel Base");
  });

  it("labels each rung with its rank chip", async () => {
    render(<RankingPage />);
    await screen.findByText("Nivel Cima");

    const rungs = screen.getAllByRole("listitem");
    expect(within(rungs[0]).getByTitle("Puesto 1 de la escalera")).toBeInTheDocument();
    expect(within(rungs[1]).getByTitle("Puesto 2 de la escalera")).toBeInTheDocument();
    expect(within(rungs[2]).getByTitle("Puesto 3 de la escalera")).toBeInTheDocument();
  });

  it("shows the roster of each rung as an avatar stack of initials", async () => {
    render(<RankingPage />);
    await screen.findByText("Nivel Cima");

    const rungs = screen.getAllByRole("listitem");
    // Pedro Ramírez sits on nivel 1, Carla Vera on nivel 3.
    expect(within(rungs[0]).getByTitle("Pedro Ramírez")).toHaveTextContent("PR");
    expect(within(rungs[2]).getByTitle("Carla Vera")).toHaveTextContent("CV");
    expect(within(rungs[0]).getByText("1 estudiante")).toBeInTheDocument();
    expect(within(rungs[1]).getByText("0 estudiantes")).toBeInTheDocument();
  });

  it("shows exactly two stats — Estudiantes asignados and Niveles — and no judgement", async () => {
    render(<RankingPage />);
    await screen.findByText("Nivel Cima");

    expect(screen.getByText("Estudiantes asignados")).toBeInTheDocument();
    expect(screen.getByText("de 3 estudiantes")).toBeInTheDocument();
    // "Niveles" also names the sidebar nav entry, so scope to the stat's hint.
    expect(screen.getByText("1 es la cima")).toBeInTheDocument();
  });

  it("renders no occupancy indicator anywhere — no fraction, no cupos, no 'Bajo mínimo'", async () => {
    const { container } = render(<RankingPage />);
    await screen.findByText("Nivel Cima");

    const text = container.textContent ?? "";
    expect(text).not.toMatch(/cupos?/i);
    expect(text).not.toMatch(/bajo mínimo/i);
    expect(text).not.toMatch(/capacidad/i);
    expect(text).not.toMatch(/revisión/i);
    // "N/M" occupancy fractions, e.g. "2/10".
    expect(text).not.toMatch(/\b\d+\s*\/\s*\d+\b/);
    expect(container.querySelector("progress")).toBeNull();
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
  });

  it("offers 'Asignar' as the only rung action — never 'Promover'", async () => {
    render(<RankingPage />);
    await screen.findByText("Nivel Cima");

    expect(screen.getAllByRole("button", { name: /^asignar estudiantes a/i })).toHaveLength(3);
    expect(screen.queryByRole("button", { name: /promover/i })).not.toBeInTheDocument();
  });

  it("opens an assignment panel scoped to the rung that was clicked", async () => {
    render(<RankingPage />);
    await screen.findByText("Nivel Cima");

    fireEvent.click(screen.getByRole("button", { name: "Asignar estudiantes al nivel Nivel Medio" }));

    expect(await screen.findByText("Asignar estudiantes al nivel Nivel Medio")).toBeInTheDocument();
    expect(screen.getByText("Sofía González")).toBeInTheDocument();
  });

  it("assigns an unassigned student to the rung's nivel via asignar-nivel-inicial", async () => {
    render(<RankingPage />);
    await screen.findByText("Nivel Cima");

    fireEvent.click(screen.getByRole("button", { name: "Asignar estudiantes al nivel Nivel Medio" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Asignar Sofía González al nivel Nivel Medio" }),
    );

    await waitFor(() => {
      expect(mockAssignStudentToNivel).toHaveBeenCalledWith(10, 2);
    });
    expect(mockMoveStudentToNivel).not.toHaveBeenCalled();
    expect(mockShowSuccess).toHaveBeenCalled();
  });

  it("moves an already-assigned student via mover-de-nivel, under the same 'Asignar' label", async () => {
    render(<RankingPage />);
    await screen.findByText("Nivel Cima");

    fireEvent.click(screen.getByRole("button", { name: "Asignar estudiantes al nivel Nivel Medio" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Asignar Pedro Ramírez al nivel Nivel Medio" }),
    );

    await waitFor(() => {
      expect(mockMoveStudentToNivel).toHaveBeenCalledWith(11, 2);
    });
    expect(mockAssignStudentToNivel).not.toHaveBeenCalled();
  });

  it("marks a student already on the open rung as such instead of offering to re-assign them", async () => {
    render(<RankingPage />);
    await screen.findByText("Nivel Cima");

    fireEvent.click(screen.getByRole("button", { name: "Asignar estudiantes al nivel Nivel Cima" }));

    expect(await screen.findByText("Ya está aquí")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Asignar Pedro Ramírez al nivel Nivel Cima" }),
    ).not.toBeInTheDocument();
  });

  it("filters the assignment panel by name", async () => {
    render(<RankingPage />);
    await screen.findByText("Nivel Cima");

    fireEvent.click(screen.getByRole("button", { name: "Asignar estudiantes al nivel Nivel Medio" }));
    fireEvent.change(await screen.findByLabelText(/buscar estudiante para el nivel nivel medio/i), {
      target: { value: "sofía" },
    });

    await waitFor(() => {
      expect(screen.queryByText("Pedro Ramírez")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Sofía González")).toBeInTheDocument();
  });

  it("moves the student's avatar onto the target rung after a successful assignment", async () => {
    render(<RankingPage />);
    await screen.findByText("Nivel Cima");

    fireEvent.click(screen.getByRole("button", { name: "Asignar estudiantes al nivel Nivel Medio" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Asignar Sofía González al nivel Nivel Medio" }),
    );

    await waitFor(() => {
      const rungs = screen.getAllByRole("listitem");
      expect(within(rungs[1]).getByTitle("Sofía González")).toBeInTheDocument();
    });
  });

  it("surfaces a real backend failure instead of a false success", async () => {
    mockAssignStudentToNivel.mockRejectedValue(new Error("boom"));
    render(<RankingPage />);
    await screen.findByText("Nivel Cima");

    fireEvent.click(screen.getByRole("button", { name: "Asignar estudiantes al nivel Nivel Medio" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Asignar Sofía González al nivel Nivel Medio" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("Error al asignar el nivel.");
    expect(mockShowSuccess).not.toHaveBeenCalled();
  });

  it("clears the pending 'Asignado' reset timer on unmount", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { unmount } = render(<RankingPage />);
    await screen.findByText("Nivel Cima");

    fireEvent.click(screen.getByRole("button", { name: "Asignar estudiantes al nivel Nivel Medio" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Asignar Sofía González al nivel Nivel Medio" }),
    );
    await waitFor(() => expect(mockAssignStudentToNivel).toHaveBeenCalled());

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    unmount();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("shows a retryable error state when the ladder cannot be loaded", async () => {
    mockFetchNivelesConOcupacion.mockRejectedValue(new Error("network"));
    render(<RankingPage />);

    expect(
      await screen.findByText("No se pudieron cargar los niveles. Intente nuevamente."),
    ).toBeInTheDocument();
  });
});

describe("RankingPage — empty ladder", () => {
  beforeEach(() => {
    mockFetchAlumnosParaNivel.mockReset().mockResolvedValue([]);
    mockFetchNivelesConOcupacion.mockReset().mockResolvedValue([]);
  });

  it("explains the empty state instead of rendering an empty card", async () => {
    render(<RankingPage />);
    expect(await screen.findByText("Todavía no hay niveles")).toBeInTheDocument();
  });
});
