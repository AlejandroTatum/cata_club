/**
 * Component tests for NivelPage — single "Asignar Nivel" section (the
 * "Resultados Mensuales" tab was removed) plus its search/nivel filter.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import NivelPage from "@/app/trainer/nivel/page";
import type { NivelConOcupacion } from "@/services/api";
import { createAuthenticatedAuth } from "@/components/__tests__/test-utils";

vi.mock("@/components/ProtectedRoute", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// NivelPage now wraps its content in `<AppShell>` — pull in the same mocks
// TrainerAttendancePage.test.tsx uses for that shell's own dependencies.
vi.mock("next/navigation", () => ({
  usePathname: () => "/trainer/nivel",
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
  useAuth: vi.fn(),
}));

import { useAuth } from "@/contexts/AuthContext";
const mockUseAuth = vi.mocked(useAuth);

const mockShowError = vi.fn();
const mockShowSuccess = vi.fn();
vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({
    showToast: vi.fn(),
    showError: mockShowError,
    showSuccess: mockShowSuccess,
  }),
}));

const mockFetchAlumnosConNivel = vi.fn();
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
    fetchAlumnosConNivel: () => mockFetchAlumnosConNivel(),
    fetchNivelesConOcupacion: () => mockFetchNivelesConOcupacion(),
    assignStudentToNivel: (personaId: number, nivelId: number) => mockAssignStudentToNivel(personaId, nivelId),
    moveStudentToNivel: (personaId: number, nivelId: number) => mockMoveStudentToNivel(personaId, nivelId),
    fetchNotificaciones: vi.fn().mockResolvedValue([]),
    marcarNotificacionLeida: vi.fn().mockResolvedValue(undefined),
    ApiClientError: MockApiClientError,
  };
});

const NIVELES: NivelConOcupacion[] = [
  {
    id: 1,
    numeroNivel: 1,
    nombre: "Nivel Iniciación",
    capacidadMinima: 1,
    capacidadMaxima: 10,
    personasActuales: 0,
    cuposDisponibles: 10,
    necesitaRevision: false,
    nivelCategoria: "principiante",
  },
  {
    id: 2,
    numeroNivel: 2,
    nombre: "Nivel Intermedio",
    capacidadMinima: 1,
    capacidadMaxima: 10,
    personasActuales: 0,
    cuposDisponibles: 10,
    necesitaRevision: false,
    nivelCategoria: "intermedio",
  },
];

describe("NivelPage", () => {
  beforeEach(() => {
    mockFetchAlumnosConNivel.mockReset();
    mockFetchNivelesConOcupacion.mockReset();
    mockAssignStudentToNivel.mockReset();
    mockMoveStudentToNivel.mockReset();
    mockFetchAlumnosConNivel.mockResolvedValue([
      { personaId: 10, nombres: "Sofía", apellidos: "González", nivelRankingId: null },
      { personaId: 11, nombres: "Pedro", apellidos: "Ramírez", nivelRankingId: 1 },
    ]);
    mockFetchNivelesConOcupacion.mockResolvedValue(NIVELES);
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("trainer", "Carlos Entrenador"));
    mockShowError.mockClear();
    mockShowSuccess.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("no longer renders a 'Resultados Mensuales' tab or section", async () => {
    render(<NivelPage />);
    await screen.findByText("Sofía González");

    expect(screen.queryByText(/resultados mensuales/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("renders every student by default with the total count", async () => {
    render(<NivelPage />);
    await screen.findByText("Sofía González");

    expect(screen.getByText("Pedro Ramírez")).toBeInTheDocument();
    expect(screen.getByText("Estudiantes (2)")).toBeInTheDocument();
  });

  it("filters students by name (case-insensitive)", async () => {
    render(<NivelPage />);
    await screen.findByText("Sofía González");

    fireEvent.change(screen.getByLabelText(/buscar estudiante/i), { target: { value: "sofía" } });

    await waitFor(() => {
      expect(screen.getByText("Estudiantes (1)")).toBeInTheDocument();
    });
    expect(screen.getByText("Sofía González")).toBeInTheDocument();
    expect(screen.queryByText("Pedro Ramírez")).not.toBeInTheDocument();
  });

  it("filters students by current nivel", async () => {
    render(<NivelPage />);
    await screen.findByText("Sofía González");

    fireEvent.change(screen.getByLabelText(/filtrar por nivel actual/i), { target: { value: "1" } });

    await waitFor(() => {
      expect(screen.getByText("Estudiantes (1)")).toBeInTheDocument();
    });
    expect(screen.getByText("Pedro Ramírez")).toBeInTheDocument();
    expect(screen.queryByText("Sofía González")).not.toBeInTheDocument();
  });

  it("combines the name and nivel filters", async () => {
    render(<NivelPage />);
    await screen.findByText("Sofía González");

    fireEvent.change(screen.getByLabelText(/buscar estudiante/i), { target: { value: "sofía" } });
    fireEvent.change(screen.getByLabelText(/filtrar por nivel actual/i), { target: { value: "1" } });

    await waitFor(() => {
      expect(screen.getByText("No se encontraron estudiantes con ese criterio.")).toBeInTheDocument();
    });
  });

  it("shows an empty-filter state distinct from the no-students state", async () => {
    render(<NivelPage />);
    await screen.findByText("Sofía González");

    fireEvent.change(screen.getByLabelText(/buscar estudiante/i), { target: { value: "nadie-existe" } });

    await waitFor(() => {
      expect(screen.getByText("No se encontraron estudiantes con ese criterio.")).toBeInTheDocument();
    });
    expect(screen.queryByText("No hay estudiantes registrados.")).not.toBeInTheDocument();
  });

  describe("assignment feedback", () => {
    // `onAssigned` (loadData) briefly flips `loading` true/false around the
    // refetch, which unmounts and remounts the `<table>`/`<tr>` — so every
    // assertion below re-queries the row from `screen` instead of reusing a
    // captured DOM node reference (it would go stale mid-flow).
    function getSofiaRow(): HTMLElement {
      const row = screen.getByLabelText("Nuevo nivel para Sofía González").closest("tr");
      if (!row) throw new Error("Sofía row not found");
      return row;
    }

    function getPedroRow(): HTMLElement {
      const row = screen.getByLabelText("Nuevo nivel para Pedro Ramírez").closest("tr");
      if (!row) throw new Error("Pedro row not found");
      return row;
    }

    it("shows a success toast and reverts the 'Asignado' label to 'Asignar' after the timeout", async () => {
      mockAssignStudentToNivel.mockResolvedValue(undefined);
      render(<NivelPage />);
      await screen.findByText("Sofía González");

      fireEvent.change(screen.getByLabelText("Nuevo nivel para Sofía González"), { target: { value: "1" } });
      fireEvent.click(within(getSofiaRow()).getByRole("button", { name: /Asignar/i }));

      await waitFor(() => {
        expect(within(getSofiaRow()).getByRole("button", { name: /Asignado/i })).toBeInTheDocument();
      });
      expect(mockShowSuccess).toHaveBeenCalledTimes(1);

      // The reset `setTimeout` was scheduled under real timers (above), so it
      // must be observed via real timers too — `waitFor`'s default 1000ms
      // timeout is extended to comfortably clear the 2s reset delay.
      await waitFor(
        () => {
          expect(within(getSofiaRow()).getByRole("button", { name: /^Asignar$/i })).toBeInTheDocument();
        },
        { timeout: 3000 },
      );
    });

    it("clears the pending reset timer on unmount so no state update fires afterward", async () => {
      mockAssignStudentToNivel.mockResolvedValue(undefined);
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { unmount } = render(<NivelPage />);
      await screen.findByText("Sofía González");

      fireEvent.change(screen.getByLabelText("Nuevo nivel para Sofía González"), { target: { value: "1" } });
      fireEvent.click(within(getSofiaRow()).getByRole("button", { name: /Asignar/i }));

      await waitFor(() => {
        expect(within(getSofiaRow()).getByRole("button", { name: /Asignado/i })).toBeInTheDocument();
      });

      const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
      unmount();
      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();

      // Give the (now-cleared) reset timer's original 2s window a chance to
      // pass; if it weren't cleared, React would warn about a state update
      // on an unmounted component.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(consoleErrorSpy).not.toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it("keeps each student's 'Asignado' state and reset timer independent when two assignments overlap (race regression)", async () => {
      // Deferred promises so we control exactly when each assignment call
      // resolves, reproducing "two students assigned nearly simultaneously"
      // deterministically: both handleAssign calls start before either
      // resolves, then resolve 500ms apart (both well inside each other's
      // 2s reset window).
      let resolveAssign: (() => void) | undefined;
      let resolveMove: (() => void) | undefined;
      mockAssignStudentToNivel.mockImplementation(
        () => new Promise<void>((resolve) => { resolveAssign = resolve; }),
      );
      mockMoveStudentToNivel.mockImplementation(
        () => new Promise<void>((resolve) => { resolveMove = resolve; }),
      );

      render(<NivelPage />);
      await screen.findByText("Sofía González");

      // Fake timers only from here on — the initial data-fetch render above
      // already settled under real timers, avoiding the same pitfall noted
      // for the previous test (a real timer already in flight cannot be
      // retroactively intercepted by fake timers enabled afterward).
      vi.useFakeTimers();

      // Start both assignments (Sofía → assignStudentToNivel, unassigned;
      // Pedro → moveStudentToNivel, already has a nivel) before either
      // resolves.
      fireEvent.change(screen.getByLabelText("Nuevo nivel para Sofía González"), { target: { value: "1" } });
      fireEvent.click(within(getSofiaRow()).getByRole("button", { name: /Asignar/i }));

      fireEvent.change(screen.getByLabelText("Nuevo nivel para Pedro Ramírez"), { target: { value: "2" } });
      fireEvent.click(within(getPedroRow()).getByRole("button", { name: /Asignar/i }));

      // Sofía's assignment resolves first.
      await act(async () => {
        resolveAssign?.();
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(within(getSofiaRow()).getByRole("button", { name: /Asignado/i })).toBeInTheDocument();

      // 500ms later (still inside Sofía's 2s window), Pedro's resolves too.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
        resolveMove?.();
        await vi.advanceTimersByTimeAsync(0);
      });

      // Both rows must show "Asignado" simultaneously — a single shared
      // `successId` string would have already overwritten Sofía's state
      // with Pedro's here.
      expect(within(getSofiaRow()).getByRole("button", { name: /Asignado/i })).toBeInTheDocument();
      expect(within(getPedroRow()).getByRole("button", { name: /Asignado/i })).toBeInTheDocument();

      // Advance to Sofía's own 2s expiry (1500ms further: 500 elapsed + 1500 = 2000ms since her success).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });
      expect(within(getSofiaRow()).getByRole("button", { name: /^Asignar$/i })).toBeInTheDocument();
      // Pedro's own window (from his resolve, 1500ms ago) has NOT elapsed yet —
      // a shared/orphaned timer ref would have wrongly cleared his state here too.
      expect(within(getPedroRow()).getByRole("button", { name: /Asignado/i })).toBeInTheDocument();

      // Remaining 500ms until Pedro's own timer expires.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(within(getPedroRow()).getByRole("button", { name: /^Asignar$/i })).toBeInTheDocument();

      vi.useRealTimers();
    });
  });
});
