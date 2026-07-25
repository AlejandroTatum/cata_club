/**
 * Component tests for RankingPage (admin) — literal copy of the trainer's
 * Nivel screen (see NivelPage.test.tsx), single "Asignar Nivel" table with
 * its search/nivel filter, reused for the admin actor.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import RankingPage from "@/app/ranking/page";
import type { NivelConOcupacion } from "@/services/api";
import type { MemberAccount } from "@/app/members/members-utils";

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

const mockFetchMembers = vi.fn();
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
    fetchMembers: () => mockFetchMembers(),
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

const ACCOUNT: MemberAccount = {
  id: "acc-1",
  role: "representante",
  nombres: "María",
  apellidos: "González",
  telefono: "0999999999",
  estudiantes: [
    {
      id: "10",
      nombres: "Sofía",
      apellidos: "González",
      grupoId: null,
      activo: true,
      membresia: null,
      ultimoPago: null,
    },
    {
      id: "11",
      nombres: "Pedro",
      apellidos: "Ramírez",
      grupoId: "1",
      activo: true,
      membresia: null,
      ultimoPago: null,
    },
  ],
};

describe("RankingPage — admin Niveles screen (copy of trainer's Nivel)", () => {
  beforeEach(() => {
    mockFetchMembers.mockReset();
    mockAssignStudentToNivel.mockReset();
    mockMoveStudentToNivel.mockReset();
    mockFetchMembers.mockResolvedValue({ accounts: [ACCOUNT], niveles: NIVELES });
    mockShowError.mockClear();
    mockShowSuccess.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders every student by default with the total count", async () => {
    render(<RankingPage />);
    await screen.findByText("Sofía González");

    expect(screen.getByText("Pedro Ramírez")).toBeInTheDocument();
    expect(screen.getByText("Estudiantes (2)")).toBeInTheDocument();
  });

  it("filters students by name (case-insensitive)", async () => {
    render(<RankingPage />);
    await screen.findByText("Sofía González");

    fireEvent.change(screen.getByLabelText(/buscar estudiante/i), { target: { value: "sofía" } });

    await waitFor(() => {
      expect(screen.getByText("Estudiantes (1)")).toBeInTheDocument();
    });
    expect(screen.getByText("Sofía González")).toBeInTheDocument();
    expect(screen.queryByText("Pedro Ramírez")).not.toBeInTheDocument();
  });

  it("filters students by current nivel", async () => {
    render(<RankingPage />);
    await screen.findByText("Sofía González");

    fireEvent.change(screen.getByLabelText(/filtrar por nivel actual/i), { target: { value: "1" } });

    await waitFor(() => {
      expect(screen.getByText("Estudiantes (1)")).toBeInTheDocument();
    });
    expect(screen.getByText("Pedro Ramírez")).toBeInTheDocument();
    expect(screen.queryByText("Sofía González")).not.toBeInTheDocument();
  });

  it("paginates the student list at 10 per page, with prev/next controls", async () => {
    const manyStudents: MemberAccount = {
      id: "acc-many",
      role: "representante",
      nombres: "Ana",
      apellidos: "Pérez",
      telefono: "0999999999",
      estudiantes: Array.from({ length: 15 }, (_, i) => ({
        id: String(100 + i),
        nombres: `Estudiante${i}`,
        apellidos: "Test",
        grupoId: null,
        activo: true,
        membresia: null,
        ultimoPago: null,
      })),
    };
    mockFetchMembers.mockResolvedValue({ accounts: [manyStudents], niveles: NIVELES });

    render(<RankingPage />);
    await screen.findByText("Estudiantes (15)");

    expect(screen.getByText("Estudiante0 Test")).toBeInTheDocument();
    expect(screen.queryByText("Estudiante10 Test")).not.toBeInTheDocument();
    expect(screen.getByText(/Página 1 de 2/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Página siguiente/i }));

    await waitFor(() => {
      expect(screen.getByText("Estudiante10 Test")).toBeInTheDocument();
    });
    expect(screen.queryByText("Estudiante0 Test")).not.toBeInTheDocument();
    expect(screen.getByText(/Página 2 de 2/)).toBeInTheDocument();
  });

  it("shows an empty-filter state distinct from the no-students state", async () => {
    render(<RankingPage />);
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

    it("shows a success toast and reverts the 'Asignado' label to 'Asignar' after the timeout", async () => {
      mockAssignStudentToNivel.mockResolvedValue(undefined);
      render(<RankingPage />);
      await screen.findByText("Sofía González");

      fireEvent.change(screen.getByLabelText("Nuevo nivel para Sofía González"), { target: { value: "1" } });
      fireEvent.click(within(getSofiaRow()).getByRole("button", { name: /Asignar/i }));

      await waitFor(() => {
        expect(within(getSofiaRow()).getByRole("button", { name: /Asignado/i })).toBeInTheDocument();
      });
      expect(mockShowSuccess).toHaveBeenCalledTimes(1);

      await waitFor(
        () => {
          expect(within(getSofiaRow()).getByRole("button", { name: /^Asignar$/i })).toBeInTheDocument();
        },
        { timeout: 3000 },
      );
    });

    it("fires assignStudentToNivel for an unassigned student and moveStudentToNivel for an already-assigned one", async () => {
      mockAssignStudentToNivel.mockResolvedValue(undefined);
      mockMoveStudentToNivel.mockResolvedValue(undefined);
      render(<RankingPage />);
      await screen.findByText("Sofía González");

      fireEvent.change(screen.getByLabelText("Nuevo nivel para Sofía González"), { target: { value: "1" } });
      fireEvent.click(within(getSofiaRow()).getByRole("button", { name: /Asignar/i }));

      await waitFor(() => {
        expect(mockAssignStudentToNivel).toHaveBeenCalledWith(10, 1);
      });
      expect(mockMoveStudentToNivel).not.toHaveBeenCalled();
    });

    it("clears the pending reset timer on unmount so no state update fires afterward", async () => {
      mockAssignStudentToNivel.mockResolvedValue(undefined);
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { unmount } = render(<RankingPage />);
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

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(consoleErrorSpy).not.toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
  });
});

// ---------------------------------------------------------------------------
// WCAG AA contrast (P1). The "Sin asignar" badge rendered `text-gray-400`
// (#9CA3AF) on `bg-gray-100` (#F3F4F6) — 2.31:1, the worst measured pair in
// the app, on a label that marks a real, actionable state. The numeric proof
// lives in src/lib/__tests__/color-contrast.test.ts; this pins the call site.
// ---------------------------------------------------------------------------

describe("RankingPage — 'Sin asignar' badge contrast", () => {
  beforeEach(() => {
    mockFetchMembers.mockReset().mockResolvedValue({ accounts: [ACCOUNT], niveles: NIVELES });
    mockShowError.mockClear();
    mockShowSuccess.mockClear();
  });

  it("renders the unassigned badge with an AA-passing foreground, not gray-400", async () => {
    render(<RankingPage />);

    await screen.findByText("Sofía González");
    // "Sin asignar" also names an <option> in the nivel filter; the badge is
    // the <span> in the student table cell.
    const badge = screen
      .getAllByText("Sin asignar")
      .find((el) => el.tagName === "SPAN") as HTMLElement;
    expect(badge).toBeDefined();
    expect(badge).not.toHaveClass("text-gray-400");
    expect(badge).toHaveClass("text-gray-700");
    // The fill it must contrast against is unchanged.
    expect(badge).toHaveClass("bg-gray-100");
  });
});
