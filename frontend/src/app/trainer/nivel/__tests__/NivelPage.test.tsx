/**
 * Component tests for `/trainer/nivel`.
 *
 * The point of this file is ONE requirement — *"la pantalla de nivel tiene que
 * ser la misma en entrenador que la de admin."* The trainer used to get an
 * upstream table (`NivelAsignacionPanel`) while the admin got the ladder; the
 * route now renders the very same `NivelLadderScreen` `/ranking` renders, so
 * these tests assert sameness rather than re-testing the ladder's own
 * behaviour (that lives in `src/app/ranking/__tests__/RankingPage.test.tsx`).
 *
 * What is checked here: the trainer sees the ladder and not the table, with
 * the trainer's own back link and the shared title; a trainer can actually
 * work the screen (both endpoints); the route admits trainers and nobody else;
 * and the two routes render the same content.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import NivelPage from "@/app/trainer/nivel/page";
import RankingPage from "@/app/ranking/page";
import type { AlumnoConNivel, NivelConOcupacion } from "@/services/api";
import type { UserRole } from "@/types/domain";
import { createAuthenticatedAuth } from "@/components/__tests__/test-utils";

/**
 * `ProtectedRoute` is stubbed to render its children AND record the roles it
 * was handed — the route's role gate is a prop, so recording it is how a
 * component test can assert that an estudiante or representante is turned
 * away without mounting the real redirect machinery.
 */
const recordedAllowedRoles: UserRole[][] = [];
vi.mock("@/components/ProtectedRoute", () => ({
  default: ({
    children,
    allowedRoles,
  }: {
    children: React.ReactNode;
    allowedRoles: UserRole[];
  }) => {
    recordedAllowedRoles.push(allowedRoles);
    return <>{children}</>;
  },
}));

const mockPathname = vi.fn(() => "/trainer/nivel");
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname(),
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
    nombre: "Nivel Cima",
    capacidadMinima: 1,
    capacidadMaxima: 10,
    personasActuales: 1,
    cuposDisponibles: 9,
    necesitaRevision: false,
    nivelCategoria: "principiante",
  },
  {
    id: 2,
    numeroNivel: 2,
    nombre: "Nivel Medio",
    capacidadMinima: 1,
    capacidadMaxima: 10,
    personasActuales: 0,
    cuposDisponibles: 10,
    necesitaRevision: false,
    nivelCategoria: "principiante",
  },
];

const ROSTER: AlumnoConNivel[] = [
  { personaId: 10, nombres: "Sofía", apellidos: "González", nivelRankingId: null },
  { personaId: 11, nombres: "Pedro", apellidos: "Ramírez", nivelRankingId: 1 },
];

/** Waits for the ladder to have rendered. */
async function waitForLadder(): Promise<void> {
  await screen.findByRole("button", { name: "Asignar estudiantes al nivel Nivel Cima" });
}

describe("NivelPage — the trainer gets the admin's screen", () => {
  beforeEach(() => {
    recordedAllowedRoles.length = 0;
    mockPathname.mockReturnValue("/trainer/nivel");
    mockFetchAlumnosConNivel.mockReset().mockResolvedValue(ROSTER);
    mockFetchNivelesConOcupacion.mockReset().mockResolvedValue(NIVELES);
    mockAssignStudentToNivel.mockReset().mockResolvedValue(undefined);
    mockMoveStudentToNivel.mockReset().mockResolvedValue(undefined);
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("trainer", "Carlos Entrenador"));
    mockShowError.mockClear();
    mockShowSuccess.mockClear();
  });

  it("renders the ladder, one rung per nivel with 1 at the top", async () => {
    render(<NivelPage />);
    await waitForLadder();

    const ladder = document.querySelector("ol");
    expect(ladder).not.toBeNull();
    const rungs = within(ladder as HTMLElement).getAllByRole("listitem");
    expect(rungs).toHaveLength(2);
    expect(rungs[0]).toHaveTextContent("Nivel Cima");
    expect(rungs[1]).toHaveTextContent("Nivel Medio");
    expect(within(rungs[0]).getByText("1 estudiante")).toBeInTheDocument();
  });

  it("no longer renders the upstream table it replaced", async () => {
    const { container } = render(<NivelPage />);
    await waitForLadder();

    // The table's own furniture: a `<table>`, the "Nivel actual" column and
    // the level `<select>` filter whose "Sin asignar" entry is now the panel's
    // left column.
    expect(container.querySelector("table")).toBeNull();
    expect(screen.queryByText("Nivel actual")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/filtrar por nivel actual/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: /paginación/i })).not.toBeInTheDocument();
  });

  it("carries the trainer's own back link and the screen's shared title", async () => {
    render(<NivelPage />);
    await waitForLadder();

    expect(screen.getByRole("link", { name: /volver a entrenador/i })).toHaveAttribute(
      "href",
      "/trainer",
    );
    expect(screen.getByRole("heading", { level: 1, name: "Niveles" })).toBeInTheDocument();
  });

  it("admits trainers and nobody else", async () => {
    render(<NivelPage />);
    await waitForLadder();

    expect(recordedAllowedRoles[0]).toEqual(["trainer"]);
    expect(recordedAllowedRoles[0]).not.toContain("estudiante");
    expect(recordedAllowedRoles[0]).not.toContain("representante");
  });

  it("lets a trainer place an unassigned student — the trainer holds that permission", async () => {
    render(<NivelPage />);
    await waitForLadder();

    fireEvent.click(screen.getByRole("button", { name: "Asignar estudiantes al nivel Nivel Medio" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Asignar Sofía González al nivel Nivel Medio" }),
    );

    await waitFor(() => {
      expect(mockAssignStudentToNivel).toHaveBeenCalledWith(10, 2);
    });
    expect(mockShowSuccess).toHaveBeenCalled();
  });

  it("lets a trainer move a student already on a rung, from that rung's roster", async () => {
    render(<NivelPage />);
    await waitForLadder();

    fireEvent.click(screen.getByRole("button", { name: "Asignar estudiantes al nivel Nivel Cima" }));
    fireEvent.change(await screen.findByLabelText("Nuevo nivel para Pedro Ramírez"), {
      target: { value: "2" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Mover a Pedro Ramírez desde el nivel Nivel Cima" }),
    );

    await waitFor(() => {
      expect(mockMoveStudentToNivel).toHaveBeenCalledWith(11, 2);
    });
    expect(mockAssignStudentToNivel).not.toHaveBeenCalled();
  });

  it("renders the same content the admin's /ranking renders", async () => {
    // The requirement in one assertion. Everything inside the ladder card —
    // rungs, names, headcounts, actions — has to be identical; only the route
    // chrome (back link, allowed role) is allowed to differ.
    const trainer = render(<NivelPage />);
    await waitForLadder();
    const escaleraEntrenador = trainer.container.querySelector("ol")?.textContent;
    const estadisticasEntrenador = screen.getByText("Estudiantes asignados").closest("div")
      ?.parentElement?.textContent;
    trainer.unmount();

    mockPathname.mockReturnValue("/ranking");
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("admin", "Ana Admin"));
    const admin = render(<RankingPage />);
    await waitForLadder();
    const escaleraAdmin = admin.container.querySelector("ol")?.textContent;
    const estadisticasAdmin = screen.getByText("Estudiantes asignados").closest("div")
      ?.parentElement?.textContent;

    expect(escaleraEntrenador).toBe(escaleraAdmin);
    expect(estadisticasEntrenador).toBe(estadisticasAdmin);
    expect(recordedAllowedRoles).toEqual([["trainer"], ["admin"]]);
  });
});
