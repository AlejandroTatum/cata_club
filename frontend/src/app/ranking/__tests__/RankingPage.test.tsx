/**
 * Component tests for RankingPage (admin) — "la escalera".
 *
 * The screen used to be a per-student table with a nivel `<select>` per row.
 * It is now the ladder itself: one rung per nivel, ordered by rank, each
 * stating how many students hold it, with a single action that opens a
 * TWO-COLUMN panel — unassigned LEFT, that level's roster RIGHT — plus a
 * page-level person finder for "where is Juan, and move him".
 *
 * These tests exist mostly to keep settled product rules from silently
 * regressing: no occupancy indicator of any kind, no "Promover", one LEVEL
 * number per rung (the club's name, never the rank beside it), the headcount
 * derived from the roster rather than from the API's own occupancy field, and
 * the unassigned students reachable from every rung.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import RankingPage from "@/app/ranking/page";
import type { AlumnoConNivel, NivelConOcupacion } from "@/services/api";

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

const ROSTER: AlumnoConNivel[] = [
  { personaId: 10, nombres: "Sofía", apellidos: "González", nivelRankingId: null },
  { personaId: 11, nombres: "Pedro", apellidos: "Ramírez", nivelRankingId: 1 },
  { personaId: 12, nombres: "Carla", apellidos: "Vera", nivelRankingId: 3 },
];

/**
 * The ladder is the page's only `<ol>`; the unassigned block and the search
 * results are `<ul>`s of student rows. Scoping to it keeps "one rung per
 * nivel" from accidentally counting those rows.
 */
function rungs(): HTMLElement[] {
  const ladder = document.querySelector("ol");
  if (ladder === null) throw new Error("la escalera no está renderizada");
  return within(ladder).getAllByRole("listitem");
}

/** Waits for the ladder to have loaded, without matching a `<select>` option. */
async function waitForLadder(): Promise<void> {
  await screen.findByRole("button", { name: "Asignar estudiantes al nivel Nivel Cima" });
}

describe("RankingPage — la escalera", () => {
  beforeEach(() => {
    mockFetchAlumnosConNivel.mockReset().mockResolvedValue(ROSTER);
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
    await waitForLadder();

    expect(rungs()).toHaveLength(3);
    expect(rungs()[0]).toHaveTextContent("Nivel Cima");
    expect(rungs()[1]).toHaveTextContent("Nivel Medio");
    expect(rungs()[2]).toHaveTextContent("Nivel Base");
  });

  it("labels each rung with its rank chip", async () => {
    render(<RankingPage />);
    await waitForLadder();

    expect(within(rungs()[0]).getByTitle("Puesto 1 de la escalera")).toBeInTheDocument();
    expect(within(rungs()[1]).getByTitle("Puesto 2 de la escalera")).toBeInTheDocument();
    expect(within(rungs()[2]).getByTitle("Puesto 3 de la escalera")).toBeInTheDocument();
  });

  it("states exactly how many students hold each level", async () => {
    render(<RankingPage />);
    await waitForLadder();

    // Pedro Ramírez sits on nivel 1, Carla Vera on nivel 3, nobody on nivel 2.
    expect(within(rungs()[0]).getByText("1 estudiante")).toBeInTheDocument();
    expect(within(rungs()[1]).getByText("Sin estudiantes")).toBeInTheDocument();
    expect(within(rungs()[2]).getByText("1 estudiante")).toBeInTheDocument();
  });

  it("counts from the roster, never from the API's own occupancy figure", async () => {
    // The two backend sources disagree in live data. `personasActuales` says
    // 2 for "Nivel Base"; the roster names exactly one student on it, and the
    // roster is what the panel prints — so the roster is what the rung counts.
    render(<RankingPage />);
    await waitForLadder();

    expect(within(rungs()[2]).getByText("1 estudiante")).toBeInTheDocument();
    expect(within(rungs()[2]).queryByText("2 estudiantes")).not.toBeInTheDocument();
  });

  it("keeps the roster off the rung itself — names live in the panel", async () => {
    render(<RankingPage />);
    await waitForLadder();

    expect(within(rungs()[0]).queryByText("Pedro Ramírez")).not.toBeInTheDocument();
    expect(within(rungs()[2]).queryByText("Carla Vera")).not.toBeInTheDocument();
  });

  it("renders ONE number per rung — the club's name, never the rank beside it", async () => {
    render(<RankingPage />);
    await waitForLadder();

    // The rank is announceable but never rendered as a digit next to the
    // name: "Nivel 3" sitting beside a rung named "2" was the screen's worst
    // ambiguity, and the club's name is the one people say out loud.
    const rung = rungs()[2];
    expect(within(rung).getByTitle("Nivel Base")).toBeInTheDocument();
    // The rank is carried by the node's accessible title, not by a digit.
    expect(within(rung).queryByText("3")).not.toBeInTheDocument();
    expect(within(rung).getByTitle("Puesto 3 de la escalera")).toBeInTheDocument();
  });

  it("shows exactly two stats — Estudiantes asignados and Niveles — and no judgement", async () => {
    render(<RankingPage />);
    await waitForLadder();

    expect(screen.getByText("Estudiantes asignados")).toBeInTheDocument();
    // The hint splits once there are unassigned students: the gap becomes a
    // jump link to the block that can actually place them (see below).
    expect(screen.getByText(/de 3 estudiantes/)).toBeInTheDocument();
    // "Niveles" also names the sidebar nav entry, so scope to the stat's hint.
    // The hint names the REAL top rung instead of hardcoding "1" — the club's
    // top level is called "1A", and its rank is not its name.
    expect(screen.getByText("Nivel Cima es la cima")).toBeInTheDocument();
  });

  it("renders no occupancy indicator anywhere — no fraction, no cupos, no 'Bajo mínimo'", async () => {
    const { container } = render(<RankingPage />);
    await waitForLadder();

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
    await waitForLadder();

    expect(screen.getAllByRole("button", { name: /^asignar estudiantes a/i })).toHaveLength(3);
    expect(screen.queryByRole("button", { name: /promover/i })).not.toBeInTheDocument();
  });

  it("opens an assignment panel scoped to the rung that was clicked", async () => {
    render(<RankingPage />);
    await waitForLadder();

    fireEvent.click(screen.getByRole("button", { name: "Asignar estudiantes al nivel Nivel Medio" }));

    expect(await screen.findByText("Asignar estudiantes al nivel Nivel Medio")).toBeInTheDocument();
    expect(
      within(rungs()[1]).getByRole("button", { name: "Asignar Sofía González al nivel Nivel Medio" }),
    ).toBeInTheDocument();
  });

  it("assigns an unassigned student to the rung's nivel via asignar-nivel-inicial", async () => {
    render(<RankingPage />);
    await waitForLadder();

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

  it("splits the open rung into unassigned LEFT and this level's roster RIGHT", async () => {
    render(<RankingPage />);
    await waitForLadder();

    fireEvent.click(screen.getByRole("button", { name: "Asignar estudiantes al nivel Nivel Cima" }));

    const izquierda = (await screen.findByRole("heading", { name: "Sin nivel asignado (1)" }))
      .closest("section") as HTMLElement;
    const derecha = screen
      .getByRole("heading", { name: "En el nivel Nivel Cima (1)" })
      .closest("section") as HTMLElement;

    // Sofía has no level; Pedro holds this one. Each is in exactly one column.
    expect(within(izquierda).getByText("Sofía González")).toBeInTheDocument();
    expect(within(izquierda).queryByText("Pedro Ramírez")).not.toBeInTheDocument();
    expect(within(derecha).getByText("Pedro Ramírez")).toBeInTheDocument();
    expect(within(derecha).queryByText("Sofía González")).not.toBeInTheDocument();

    // Left comes first in the DOM, which is what makes it left on a wide
    // screen AND first in the stacked reading order on a phone.
    expect(izquierda.compareDocumentPosition(derecha) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("offers no assign action for a student already on the open rung", async () => {
    render(<RankingPage />);
    await waitForLadder();

    fireEvent.click(screen.getByRole("button", { name: "Asignar estudiantes al nivel Nivel Cima" }));
    await screen.findByRole("heading", { name: "En el nivel Nivel Cima (1)" });

    // "Asignar" is `asignar-nivel-inicial`, and he already has a level. The
    // action he gets is "Mover" — see the roster-column tests below.
    expect(
      screen.queryByRole("button", { name: "Asignar Pedro Ramírez al nivel Nivel Cima" }),
    ).not.toBeInTheDocument();
  });

  it("never offers an already-assigned student in another rung's left column", async () => {
    // The left column is the unassigned, and only them: moving somebody who
    // already holds a level is the page finder's job, not the rung panel's.
    render(<RankingPage />);
    await waitForLadder();

    fireEvent.click(screen.getByRole("button", { name: "Asignar estudiantes al nivel Nivel Medio" }));
    await screen.findByRole("heading", { name: "Sin nivel asignado (1)" });

    expect(
      screen.queryByRole("button", { name: "Asignar Pedro Ramírez al nivel Nivel Medio" }),
    ).not.toBeInTheDocument();
    expect(mockMoveStudentToNivel).not.toHaveBeenCalled();
  });

  it("filters the assignment panel by name", async () => {
    render(<RankingPage />);
    await waitForLadder();

    fireEvent.click(screen.getByRole("button", { name: "Asignar estudiantes al nivel Nivel Medio" }));
    fireEvent.change(await screen.findByLabelText(/buscar estudiante para el nivel nivel medio/i), {
      target: { value: "sofía" },
    });

    // Scoped to the open rung, which contains its panel: Pedro's NAME is also
    // on his own rung now, and the ladder is not what the panel filter filters.
    await waitFor(() => {
      expect(within(rungs()[1]).queryByText("Pedro Ramírez")).not.toBeInTheDocument();
    });
    expect(within(rungs()[1]).getByText("Sofía González")).toBeInTheDocument();
  });

  it("moves the student from the left column to the right one, and the rung's count with her", async () => {
    render(<RankingPage />);
    await waitForLadder();

    fireEvent.click(screen.getByRole("button", { name: "Asignar estudiantes al nivel Nivel Medio" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Asignar Sofía González al nivel Nivel Medio" }),
    );

    await waitFor(() => {
      expect(within(rungs()[1]).getByText("1 estudiante")).toBeInTheDocument();
    });
    const derecha = screen
      .getByRole("heading", { name: "En el nivel Nivel Medio (1)" })
      .closest("section") as HTMLElement;
    expect(within(derecha).getByText("Sofía González")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sin nivel asignado (0)" })).toBeInTheDocument();
  });

  it("surfaces a real backend failure instead of a false success", async () => {
    mockAssignStudentToNivel.mockRejectedValue(new Error("boom"));
    render(<RankingPage />);
    await waitForLadder();

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
    await waitForLadder();

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

describe("RankingPage — finding a student and placing the unassigned", () => {
  beforeEach(() => {
    mockFetchAlumnosConNivel.mockReset().mockResolvedValue(ROSTER);
    mockFetchNivelesConOcupacion.mockReset().mockResolvedValue(NIVELES);
    mockAssignStudentToNivel.mockReset().mockResolvedValue(undefined);
    mockMoveStudentToNivel.mockReset().mockResolvedValue(undefined);
    mockShowError.mockClear();
    mockShowSuccess.mockClear();
  });

  function search(term: string): void {
    fireEvent.change(screen.getByLabelText("Buscar un estudiante en toda la escalera"), {
      target: { value: term },
    });
  }

  it("lists the students who have no level inside every rung's panel", async () => {
    render(<RankingPage />);
    await waitForLadder();

    fireEvent.click(screen.getByRole("button", { name: "Asignar estudiantes al nivel Nivel Base" }));

    const section = (await screen.findByRole("heading", { name: "Sin nivel asignado (1)" }))
      .closest("section") as HTMLElement;
    expect(within(section).getByText("Sofía González")).toBeInTheDocument();
  });

  it("keeps no second unassigned block below the ladder", async () => {
    // The list used to appear twice on this screen once a rung was open: once
    // beside a level picker at the foot of the page, once beside the level
    // itself. One of the two had to go, and the one attached to the
    // destination is the one that survives.
    render(<RankingPage />);
    await waitForLadder();

    expect(
      screen.queryByRole("heading", { name: /^Sin nivel asignado/ }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Asignar estudiantes al nivel Nivel Base" }));
    expect(
      await screen.findAllByRole("heading", { name: "Sin nivel asignado (1)" }),
    ).toHaveLength(1);
  });

  it("announces the unassigned count at the top, as a figure and not as a jump link", async () => {
    render(<RankingPage />);
    await waitForLadder();

    expect(screen.getByText("de 3 estudiantes · 1 sin asignar")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /sin asignar/ })).not.toBeInTheDocument();
  });

  it("keeps the unassigned count stable while searching", async () => {
    render(<RankingPage />);
    await waitForLadder();
    search("Sofía");

    expect(screen.getByText("de 3 estudiantes · 1 sin asignar")).toBeInTheDocument();
  });

  it("places an unassigned student on the level picked in their search-result row", async () => {
    render(<RankingPage />);
    await waitForLadder();

    search("Sofía");
    fireEvent.change(screen.getByLabelText("Nivel de destino para Sofía González"), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Asignar a Sofía González" }));

    await waitFor(() => {
      expect(mockAssignStudentToNivel).toHaveBeenCalledWith(10, 2);
    });
    expect(mockMoveStudentToNivel).not.toHaveBeenCalled();
  });

  it("will not act until a destination level is chosen", async () => {
    render(<RankingPage />);
    await waitForLadder();

    search("Sofía");
    expect(screen.getByRole("button", { name: "Asignar a Sofía González" })).toBeDisabled();
  });

  it("finds a student by name and points at the rung they are on", async () => {
    render(<RankingPage />);
    await waitForLadder();

    search("ramirez");

    const results = screen.getByRole("heading", { name: "Resultados de la búsqueda (1)" });
    const section = results.closest("section") as HTMLElement;
    expect(within(section).getByText("Pedro Ramírez")).toBeInTheDocument();
    expect(within(section).getByText("Nivel Nivel Cima")).toBeInTheDocument();
    // And he is picked out on his own rung, which is where the question
    // "where is Juan?" is really answered.
    expect(within(rungs()[0]).getByTitle("Pedro Ramírez").className).toContain("bg-ball");
  });

  it("moves the student found by the search, from the search result itself", async () => {
    render(<RankingPage />);
    await waitForLadder();

    search("ramirez");
    fireEvent.change(screen.getByLabelText("Nivel de destino para Pedro Ramírez"), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mover a Pedro Ramírez" }));

    await waitFor(() => {
      expect(mockMoveStudentToNivel).toHaveBeenCalledWith(11, 2);
    });
    expect(mockAssignStudentToNivel).not.toHaveBeenCalled();
  });

  it("says so when nobody matches, instead of showing an empty list", async () => {
    render(<RankingPage />);
    await waitForLadder();

    search("zzz");

    expect(await screen.findByText("Ningún estudiante coincide")).toBeInTheDocument();
  });

  it("never offers a student their current level as a destination", async () => {
    render(<RankingPage />);
    await waitForLadder();

    search("ramirez");
    const options = within(
      screen.getByLabelText("Nivel de destino para Pedro Ramírez"),
    ).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "Elegir nivel…",
      "Nivel Medio",
      "Nivel Base",
    ]);
  });
});

/**
 * The two things the upstream trainer table could do that the ladder could
 * not, carried over when the two screens were unified (see
 * `NivelLadderScreen`'s header). Both are about a student you are LOOKING at
 * rather than one whose name you can already spell into the page search.
 */
describe("RankingPage — what the old table could do", () => {
  beforeEach(() => {
    mockFetchAlumnosConNivel.mockReset().mockResolvedValue(ROSTER);
    mockFetchNivelesConOcupacion.mockReset().mockResolvedValue(NIVELES);
    mockAssignStudentToNivel.mockReset().mockResolvedValue(undefined);
    mockMoveStudentToNivel.mockReset().mockResolvedValue(undefined);
    mockShowError.mockClear();
    mockShowSuccess.mockClear();
  });

  function openCima(): void {
    fireEvent.click(screen.getByRole("button", { name: "Asignar estudiantes al nivel Nivel Cima" }));
  }

  it("moves a resident of the open rung without asking for their name", async () => {
    // The table's "Nuevo nivel" picker sat on every row. Losing it would have
    // left the roster column inert: the only way to move Pedro would be to
    // type "Pedro" into a search while already reading his name on screen.
    render(<RankingPage />);
    await waitForLadder();
    openCima();

    fireEvent.change(await screen.findByLabelText("Nuevo nivel para Pedro Ramírez"), {
      target: { value: "2" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Mover a Pedro Ramírez desde el nivel Nivel Cima" }),
    );

    await waitFor(() => {
      expect(mockMoveStudentToNivel).toHaveBeenCalledWith(11, 2);
    });
    // `mover-de-nivel`, never `asignar-nivel-inicial`: he already holds one.
    expect(mockAssignStudentToNivel).not.toHaveBeenCalled();
  });

  it("will not move a resident until a destination is chosen", async () => {
    render(<RankingPage />);
    await waitForLadder();
    openCima();

    expect(
      await screen.findByRole("button", { name: "Mover a Pedro Ramírez desde el nivel Nivel Cima" }),
    ).toBeDisabled();
  });

  it("never offers a resident the level they are already on", async () => {
    render(<RankingPage />);
    await waitForLadder();
    openCima();

    const options = within(await screen.findByLabelText("Nuevo nivel para Pedro Ramírez"))
      .getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "Mover a…",
      "Nivel Medio",
      "Nivel Base",
    ]);
  });

  it("takes the moved student off the rung and off its headcount", async () => {
    render(<RankingPage />);
    await waitForLadder();
    openCima();

    fireEvent.change(await screen.findByLabelText("Nuevo nivel para Pedro Ramírez"), {
      target: { value: "2" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Mover a Pedro Ramírez desde el nivel Nivel Cima" }),
    );

    // By test id, not by rung index: an open rung's `<li>` contains the
    // panel's own `<li>`s, so positional lookups would land inside the panel.
    await waitFor(() => {
      expect(screen.getByTestId("rung-headcount-1")).toHaveTextContent("Sin estudiantes");
    });
    expect(screen.getByTestId("rung-headcount-2")).toHaveTextContent("1 estudiante");
    expect(screen.getByRole("heading", { name: "En el nivel Nivel Cima (0)" })).toBeInTheDocument();
  });

  it("reaches every name in a column instead of printing the first few", async () => {
    // The table paginated; the panel used to print twelve and say "use the
    // search for the rest", which cannot be followed for a student whose name
    // you do not know. Both columns scroll now, so the list is complete.
    const many: AlumnoConNivel[] = Array.from({ length: 20 }, (_, i) => ({
      personaId: 100 + i,
      nombres: `Alumno${String(i).padStart(2, "0")}`,
      apellidos: "Sinnivel",
      nivelRankingId: null,
    }));
    mockFetchAlumnosConNivel.mockResolvedValue(many);

    render(<RankingPage />);
    await waitForLadder();
    openCima();

    await screen.findByRole("heading", { name: "Sin nivel asignado (20)" });
    // The last name in the column is rendered, not hidden behind a note.
    expect(screen.getByText("Alumno19 Sinnivel")).toBeInTheDocument();
    expect(screen.queryByText(/use la búsqueda para encontrarlos/i)).not.toBeInTheDocument();

    // …reachable by scrolling the column rather than by growing the page.
    const columna = screen
      .getByRole("heading", { name: "Sin nivel asignado (20)" })
      .closest("section")
      ?.querySelector("ul");
    expect(columna?.className).toContain("overflow-y-auto");
  });
});

describe("RankingPage — empty ladder", () => {
  beforeEach(() => {
    mockFetchAlumnosConNivel.mockReset().mockResolvedValue([]);
    mockFetchNivelesConOcupacion.mockReset().mockResolvedValue([]);
  });

  it("explains the empty state instead of rendering an empty card", async () => {
    render(<RankingPage />);
    expect(await screen.findByText("Todavía no hay niveles")).toBeInTheDocument();
  });
});
