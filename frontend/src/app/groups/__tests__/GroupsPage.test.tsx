/**
 * Component tests for GroupsPage — schedule/group management (horarios,
 * accordion, categoria-driven form, roster assignment). The dropdown-assign
 * and justificativo-review coverage that used to live here moved to
 * RankingPage (issue #43) — the justificativo-review flow itself was later
 * removed entirely along with the ranking-mensual feature.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import GroupsPage from "@/app/groups/page";
import { ApiClientError } from "@/services/api";
import type { AlumnoHorario } from "@/services/api";
import type { MemberAccount } from "@/app/members/members-utils";
import { ToastProvider } from "@/contexts/ToastContext";
import ToastContainer from "@/components/ToastContainer";

vi.mock("@/components/ProtectedRoute", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// AppShell renders NotificationBell + needs next/navigation, next/link,
// next/image, AuthContext — same minimal mock pattern as PaymentsPage.test.tsx.
vi.mock("next/navigation", () => ({
  usePathname: () => "/groups",
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
  default: (props: React.ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean; priority?: boolean }) => {
    const { fill, priority, sizes, ...rest } = props;
    void fill;
    void priority;
    void sizes;
    // eslint-disable-next-line @next/next/no-img-element
    return <img alt="" {...rest} />;
  },
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

const mockFetchMembers = vi.fn();
const mockFetchNotificaciones = vi.fn().mockResolvedValue([]);
const mockMarcarNotificacionLeida = vi.fn().mockResolvedValue(undefined);
const mockFetchHorarios = vi.fn().mockResolvedValue([]);
const mockCrearHorario = vi.fn();
const mockActualizarHorario = vi.fn();
const mockEliminarHorario = vi.fn();
const mockFetchAlumnosPorHorario = vi.fn().mockResolvedValue([]);
const mockAsignarAlumnoAHorario = vi.fn();
const mockDesasignarAlumnoDeHorario = vi.fn();

// Stand-in for the live categoria catalog `@/services/categorias` now fetches
// via `fetchCategoriasCatalogo` (`GET /api/attendance/categories`) instead of
// the static `CATEGORIA_METADATA` mirror this page used to import directly.
// `dias` here is the BFF route's actual wire shape (frontend `DiaSemana`
// codes) — `cargarCategorias` converts it back to the backend day format
// this page's checkboxes/labels use, same as before.
const LUN_VIE_DIAS = ["lun", "mar", "mie", "jue", "vie"];
const DEFAULT_CATEGORIA_CATALOG = [
  { codigo: "FORMATIVO", label: "Formativo", horaInicio: "15:00", horaFin: "16:00", dias: LUN_VIE_DIAS },
  { codigo: "INFANTIL", label: "Infantil", horaInicio: "16:00", horaFin: "17:00", dias: LUN_VIE_DIAS },
  { codigo: "JUVENIL", label: "Juvenil", horaInicio: "17:00", horaFin: "18:00", dias: LUN_VIE_DIAS },
  { codigo: "COMPETITIVO", label: "Competitivo", horaInicio: "18:00", horaFin: "20:00", dias: [...LUN_VIE_DIAS, "sab"] },
  { codigo: "ADULTOS", label: "Adultos", horaInicio: "20:00", horaFin: "21:15", dias: LUN_VIE_DIAS },
];
const mockFetchCategoriasCatalogo = vi.fn().mockResolvedValue(DEFAULT_CATEGORIA_CATALOG);

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
    fetchNotificaciones: () => mockFetchNotificaciones(),
    marcarNotificacionLeida: (id: number) => mockMarcarNotificacionLeida(id),
    fetchHorarios: () => mockFetchHorarios(),
    crearHorario: (dto: unknown) => mockCrearHorario(dto),
    actualizarHorario: (id: number, dto: unknown) => mockActualizarHorario(id, dto),
    eliminarHorario: (id: number) => mockEliminarHorario(id),
    fetchAlumnosPorHorario: (horarioId: number) => mockFetchAlumnosPorHorario(horarioId),
    asignarAlumnoAHorario: (dto: unknown) => mockAsignarAlumnoAHorario(dto),
    desasignarAlumnoDeHorario: (personaId: number, horarioId: number) => mockDesasignarAlumnoDeHorario(personaId, horarioId),
    fetchCategoriasCatalogo: () => mockFetchCategoriasCatalogo(),
    ApiClientError: MockApiClientError,
  };
});

/**
 * Wait until the schedules have loaded.
 *
 * The old sentinel was the "Horarios de Entrenamiento (N)" heading. The screen
 * no longer has one — `AppShell` already renders the page's `<h1>`, and the
 * approved prototype puts the weekday filter directly under it — so the
 * sentinel is the disappearance of the loading block, which works for an empty
 * list too.
 */
async function waitForHorarios(): Promise<void> {
  await waitFor(() => {
    expect(screen.queryByText("Cargando horarios…")).not.toBeInTheDocument();
  });
}

describe("GroupsPage — categoria-driven locked schedule form (v2 design)", () => {
  beforeEach(() => {
    mockFetchMembers.mockReset();
    mockFetchHorarios.mockReset();
    mockFetchMembers.mockResolvedValue({ accounts: [] });
    mockFetchHorarios.mockResolvedValue([]);
  });

  // The screen's name matches its nav entry and the approved prototype
  // (14-horarios.html: `<h2 class="h-page">Horarios</h2>`).
  it("shows its own name as a visible page heading", async () => {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    const heading = await screen.findByRole("heading", { level: 1, name: "Horarios" });
    expect(heading).toBeInTheDocument();
    expect(heading).not.toHaveClass("sr-only");
  });

  it("locks the displayed time range to COMPETITIVO's 18:00–20:00 and offers Sábado as a día checkbox", async () => {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();
    fireEvent.click(screen.getByRole("button", { name: /nuevo horario/i }));

    fireEvent.change(screen.getByLabelText(/categoría/i), { target: { value: "COMPETITIVO" } });

    expect(screen.getByText("18:00 – 20:00")).toBeInTheDocument();
    expect(screen.getByLabelText("Sábado")).toBeInTheDocument();
  });

  it("locks the displayed time range to FORMATIVO's 15:00–16:00 and excludes Sábado from día checkboxes", async () => {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();
    fireEvent.click(screen.getByRole("button", { name: /nuevo horario/i }));

    fireEvent.change(screen.getByLabelText(/categoría/i), { target: { value: "FORMATIVO" } });

    expect(screen.getByText("15:00 – 16:00")).toBeInTheDocument();
    expect(screen.queryByLabelText("Sábado")).not.toBeInTheDocument();
  });

  it("has no editable hora_inicio/hora_fin time inputs left in the form (locked, not freeform)", async () => {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();
    fireEvent.click(screen.getByRole("button", { name: /nuevo horario/i }));

    expect(screen.queryByLabelText(/hora inicio/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/hora fin/i)).not.toBeInTheDocument();
  });
});

describe("GroupsPage — categoria card grid (one card per training group)", () => {
  const RECURRING_ROWS = [
    { id: 101, diaSemana: "LUNES", horaInicio: "18:00", horaFin: "20:00", categoria: "COMPETITIVO" },
    { id: 102, diaSemana: "MIERCOLES", horaInicio: "18:00", horaFin: "20:00", categoria: "COMPETITIVO" },
    { id: 103, diaSemana: "VIERNES", horaInicio: "18:00", horaFin: "20:00", categoria: "COMPETITIVO" },
  ];

  /** The club's real shape: five weekdays of one categoria, plus its Saturday. */
  const FULL_WEEK_ROWS = [
    ...["LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES", "SABADO"].map((dia, i) => ({
      id: 110 + i,
      diaSemana: dia,
      horaInicio: "18:00",
      horaFin: "20:00",
      categoria: "COMPETITIVO",
    })),
  ];

  function alumno(personaId: number, horarioId: number) {
    return {
      id: personaId * 1000 + horarioId,
      personaId,
      personaNombreCompleto: `Alumno ${personaId}`,
      edad: 12,
      horarioId,
      horarioDia: "LUNES",
      horarioHoraInicio: "18:00",
      horarioHoraFin: "20:00",
      fechaAsignacion: "2026-01-01",
    };
  }

  beforeEach(() => {
    mockFetchMembers.mockReset();
    mockFetchHorarios.mockReset();
    mockFetchAlumnosPorHorario.mockReset();
    mockFetchMembers.mockResolvedValue({ accounts: [] });
    mockFetchAlumnosPorHorario.mockResolvedValue([]);
  });

  it("renders ONE card for a categoria, not one per weekday row", async () => {
    mockFetchHorarios.mockResolvedValue(RECURRING_ROWS);

    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();

    expect(screen.getAllByTestId("horario-card")).toHaveLength(1);
    expect(screen.getByText("Competitivo")).toBeInTheDocument();
  });

  it("states the day set and the time range once, derived from the rows", async () => {
    mockFetchHorarios.mockResolvedValue(RECURRING_ROWS);

    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();

    expect(
      screen.getByText("Lunes, miércoles y viernes · 18:00 — 20:00"),
    ).toBeInTheDocument();
  });

  it("names the Saturday exception instead of rounding it to Lunes a viernes", async () => {
    mockFetchHorarios.mockResolvedValue(FULL_WEEK_ROWS);

    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();

    expect(
      screen.getByText("Lunes a viernes + sábado · 18:00 — 20:00"),
    ).toBeInTheDocument();
  });

  it("lays the categoria's week out as día markers, flagging the ones it actually runs", async () => {
    mockFetchHorarios.mockResolvedValue(RECURRING_ROWS);

    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();

    const card = screen.getAllByTestId("horario-card")[0];
    const markers = within(card).getAllByTestId("dia-marker");

    // COMPETITIVO may meet Lunes–Sábado; these rows only use Lun/Mié/Vie.
    expect(markers.map((marker) => marker.dataset.dia)).toEqual([
      "LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES", "SABADO",
    ]);
    expect(
      markers.filter((marker) => marker.dataset.active === "true").map((marker) => marker.dataset.dia),
    ).toEqual(["LUNES", "MIERCOLES", "VIERNES"]);
  });

  it("shows the live Sábado row as an active día marker, not a missing one", async () => {
    mockFetchHorarios.mockResolvedValue(FULL_WEEK_ROWS);

    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();

    const card = screen.getAllByTestId("horario-card")[0];
    const sabado = within(card)
      .getAllByTestId("dia-marker")
      .find((marker) => marker.dataset.dia === "SABADO");
    expect(sabado?.dataset.active).toBe("true");
  });

  /**
   * Regression guard for `DiaTrack`'s dashed/outlined marker.
   *
   * Every other fixture in this describe block either covers all of its
   * categoría's permitted días (no dashed markers ever render) or only skips
   * Sábado on a LUN_SAB categoría (COMPETITIVO), which reads as "the usual
   * weekly exception" rather than a genuinely missing weekday. Neither shape
   * proves the dashed marker still works, so a reviewer skimming the diff
   * could mistake `DiaTrack`'s outlined branch for dead code and delete it —
   * the prose line (`formatDiaSet`) never mentions the days a categoría
   * skips, only the ones it uses.
   *
   * FORMATIVO permits Monday–Friday; this fixture drops a plain weekday
   * (Miércoles) from the middle of that range, so the only way the dashed
   * marker can be absent is if someone actually removes it.
   */
  it("marks a permitted weekday the categoria doesn't use as a dashed marker, not a missing one", async () => {
    mockFetchHorarios.mockResolvedValue(
      ["LUNES", "MARTES", "JUEVES", "VIERNES"].map((dia, i) => ({
        id: 120 + i,
        diaSemana: dia,
        horaInicio: "15:00",
        horaFin: "16:00",
        categoria: "FORMATIVO",
      })),
    );

    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();

    const card = screen.getAllByTestId("horario-card")[0];
    const markers = within(card).getAllByTestId("dia-marker");

    expect(markers.map((marker) => marker.dataset.dia)).toEqual([
      "LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES",
    ]);
    const miercoles = markers.find((marker) => marker.dataset.dia === "MIERCOLES");
    expect(miercoles?.dataset.active).toBe("false");
    expect(
      markers.filter((marker) => marker.dataset.dia !== "MIERCOLES"),
    ).toSatisfy((rest: HTMLElement[]) => rest.every((marker) => marker.dataset.active === "true"));
  });

  it("names every column inside the row, not only in the strip above it", async () => {
    // The strip above the list is `aria-hidden` — correctly, since announcing
    // it too would read each column name twice per row. So the names assistive
    // tech actually gets are the ones INSIDE each row, and two of the four were
    // missing: `Grupo` had a strip entry and no cell label, and the action
    // column had neither. Below `xl` there is no strip at all, so the first
    // column of every row was unnamed at every width.
    //
    // Asserted per row rather than per page: a label that exists once, above,
    // is exactly the state this replaces.
    mockFetchHorarios.mockResolvedValue(RECURRING_ROWS);

    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();

    for (const card of screen.getAllByTestId("horario-card")) {
      for (const column of ["Grupo", "Horario", "Alumnos", "Acciones"]) {
        expect(within(card).getByText(column), `${column} is unnamed in the row`).toBeInTheDocument();
      }
    }
  });

  it("takes its row height from the dense-row token, not from loose padding", async () => {
    // `px-5 py-4` is why a Horarios row measured differently from a Descuentos
    // row and from a members row. The token is the floor; the row grows past it
    // when a cell wraps, which is what `min-h-*` is for.
    mockFetchHorarios.mockResolvedValue(RECURRING_ROWS);

    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();

    expect(screen.getAllByTestId("horario-card")[0]).toHaveClass("min-h-drow");
  });

  it("carries no level information on the cards (settled product decision)", async () => {
    mockFetchHorarios.mockResolvedValue(RECURRING_ROWS);

    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();

    for (const card of screen.getAllByTestId("horario-card")) {
      expect(card.textContent).not.toMatch(/nivel/i);
    }
  });

  it("names the categoria without a trainer (issue #13), and no fabricated table/mesa", async () => {
    mockFetchHorarios.mockResolvedValue(RECURRING_ROWS);

    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();

    const card = screen.getAllByTestId("horario-card")[0];
    expect(within(card).getByText("Competitivo")).toBeInTheDocument();
    expect(card.textContent).not.toMatch(/entrenador/i);
    expect(card.textContent).not.toMatch(/mesa/i);
  });

  it("counts each student once across the categoria's weekdays, not once per weekday", async () => {
    mockFetchHorarios.mockResolvedValue(RECURRING_ROWS);
    // The same two students train Monday, Wednesday and Friday. Summing the
    // rows would report six; the group has two.
    mockFetchAlumnosPorHorario.mockImplementation((horarioId: number) =>
      Promise.resolve([alumno(10, horarioId), alumno(11, horarioId)]),
    );

    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();

    expect(await screen.findByText("2 inscriptos")).toBeInTheDocument();
    expect(screen.queryByText("6 inscriptos")).not.toBeInTheDocument();
  });

  it("never shows a partial-enrollment footnote (full-month enrollment, v5): even mismatched rosters across días render no such message", async () => {
    // Full-month enrollment is now enforced atomically on the backend, so
    // this per-día mismatch should not occur in practice — but the footnote
    // that used to flag it is gone with the state it described, and this
    // guards that it stays gone even if stale/inconsistent rosters ever
    // reach the client.
    mockFetchHorarios.mockResolvedValue(RECURRING_ROWS);
    mockFetchAlumnosPorHorario.mockImplementation((horarioId: number) =>
      Promise.resolve(
        horarioId === 101
          ? [alumno(10, horarioId), alumno(11, horarioId)]
          : [alumno(10, horarioId)],
      ),
    );

    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();

    expect(await screen.findByText("2 inscriptos")).toBeInTheDocument();
    expect(screen.queryByText(/no está inscript[oa]/i)).not.toBeInTheDocument();
  });

  it("omits the headcount rather than undercounting when a roster request fails", async () => {
    mockFetchHorarios.mockResolvedValue(RECURRING_ROWS);
    mockFetchAlumnosPorHorario.mockImplementation((horarioId: number) =>
      horarioId === 103
        ? Promise.reject(new Error("network"))
        : Promise.resolve([alumno(10, horarioId)]),
    );

    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();

    await waitFor(() => expect(mockFetchAlumnosPorHorario).toHaveBeenCalledTimes(3));
    expect(screen.queryByText(/inscripto/i)).not.toBeInTheDocument();
  });

  it("has no weekday filter left — five cards do not need filtering", async () => {
    mockFetchHorarios.mockResolvedValue(FULL_WEEK_ROWS);

    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();

    expect(screen.queryByRole("group", { name: /filtrar por día/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^miércoles/i })).not.toBeInTheDocument();
  });

  it("keeps a categoria whose weekdays have drifted horas on ONE card", async () => {
    mockFetchHorarios.mockResolvedValue([
      { id: 201, diaSemana: "LUNES", horaInicio: "15:00", horaFin: "16:00", categoria: "FORMATIVO" },
      { id: 202, diaSemana: "MARTES", horaInicio: "15:30", horaFin: "16:30", categoria: "FORMATIVO" },
    ]);

    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();

    expect(screen.getAllByTestId("horario-card")).toHaveLength(1);
  });

  it("asks which configuration to edit when a categoria's weekdays are split", async () => {
    // Split by drifted horas: with the trainer relation gone (issue #13) the
    // grouping key is (categoria, horaInicio, horaFin) alone.
    mockFetchHorarios.mockResolvedValue([
      { id: 201, diaSemana: "LUNES", horaInicio: "15:00", horaFin: "16:00", categoria: "FORMATIVO" },
      { id: 202, diaSemana: "MARTES", horaInicio: "15:30", horaFin: "16:30", categoria: "FORMATIVO" },
    ]);

    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();

    fireEvent.click(screen.getByRole("button", { name: /^editar formativo/i }));
    await screen.findByRole("heading", { name: "Editar Formativo" });
    expect(screen.queryByRole("heading", { name: "Editar Horario" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /editar los días martes/i }));
    await screen.findByRole("heading", { name: "Editar Horario" });
  });

  it("collapses the club's twenty-six rows into its five training groups", async () => {
    const CATEGORIAS = ["FORMATIVO", "INFANTIL", "JUVENIL", "COMPETITIVO", "ADULTOS"];
    mockFetchHorarios.mockResolvedValue(
      CATEGORIAS.flatMap((categoria, c) =>
        ["LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES"].map((dia, d) => ({
          id: 1000 + c * 10 + d,
          diaSemana: dia,
          horaInicio: `1${5 + c}:00`,
          horaFin: `1${6 + c}:00`,
          categoria,
        })),
      ),
    );

    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();

    expect(screen.getAllByTestId("horario-card")).toHaveLength(5);
    expect(screen.queryByRole("button", { name: /página siguiente/i })).not.toBeInTheDocument();
  });
});

describe("GroupsPage — categoria title + labeled Ver alumnos button (PR1 layout/UX fixes)", () => {
  beforeEach(() => {
    mockFetchMembers.mockReset();
    mockFetchHorarios.mockReset();
    mockFetchMembers.mockResolvedValue({ accounts: [] });
    mockFetchHorarios.mockResolvedValue([
      { id: 801, diaSemana: "LUNES", horaInicio: "18:00", horaFin: "20:00", categoria: "COMPETITIVO" },
    ]);
  });

  function card(): HTMLElement {
    return screen.getAllByTestId("horario-card")[0];
  }

  it("shows the categoria label instead of the nivel line", async () => {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();

    expect(within(card()).getByText(/competitivo/i)).toBeInTheDocument();
    expect(within(card()).queryByText(/sin nivel asignado/i)).not.toBeInTheDocument();
    expect(within(card()).queryByText(/nivel intermedio/i)).not.toBeInTheDocument();
  });

  it("renders 'Ver alumnos' as a labeled button that calls openAlumnosTab (opens the alumnos panel)", async () => {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();

    const verAlumnosButton = within(card()).getByRole("button", { name: /ver alumnos/i });
    expect(verAlumnosButton).toHaveTextContent(/ver alumnos/i);

    fireEvent.click(verAlumnosButton);
    await screen.findByRole("heading", { name: "Alumnos de Competitivo" });
  });
});

describe("GroupsPage — unknown categoria value does not crash the card (bugfix)", () => {
  beforeEach(() => {
    mockFetchMembers.mockReset();
    mockFetchHorarios.mockReset();
    mockFetchMembers.mockResolvedValue({ accounts: [] });
    mockFetchHorarios.mockResolvedValue([
      { id: 901, diaSemana: "LUNES", horaInicio: "18:00", horaFin: "20:00", categoria: "NO_EXISTE" },
    ]);
  });

  it("shows the raw value instead of crashing — or mislabelling it as Formativo", async () => {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();

    const card = screen.getAllByTestId("horario-card")[0];
    expect(card).toHaveTextContent("NO_EXISTE");
    expect(card).not.toHaveTextContent(/formativo/i);
  });

  it("falls back to the días that exist when the categoría has no allowed-day metadata", async () => {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();

    const card = screen.getAllByTestId("horario-card")[0];
    const markers = within(card).getAllByTestId("dia-marker");
    expect(markers.map((marker) => marker.dataset.dia)).toEqual(["LUNES"]);
    expect(markers[0].dataset.active).toBe("true");
  });
});

describe("GroupsPage — day-diffing unified save (PR2b)", () => {
  const GROUP_ROWS = [
    { id: 301, diaSemana: "LUNES", horaInicio: "18:00", horaFin: "20:00", categoria: "COMPETITIVO" },
    { id: 303, diaSemana: "MIERCOLES", horaInicio: "18:00", horaFin: "20:00", categoria: "COMPETITIVO" },
  ];

  beforeEach(() => {
    mockFetchMembers.mockReset();
    mockFetchHorarios.mockReset();
    mockCrearHorario.mockReset();
    mockActualizarHorario.mockReset();
    mockEliminarHorario.mockReset();
    mockFetchAlumnosPorHorario.mockReset();
    mockDesasignarAlumnoDeHorario.mockReset();
    mockFetchMembers.mockResolvedValue({ accounts: [] });
    mockFetchHorarios.mockResolvedValue(GROUP_ROWS);
    mockCrearHorario.mockResolvedValue({});
    mockActualizarHorario.mockResolvedValue({});
    mockEliminarHorario.mockResolvedValue(undefined);
    mockFetchAlumnosPorHorario.mockResolvedValue([]);
    mockDesasignarAlumnoDeHorario.mockResolvedValue(undefined);
  });

  async function openEditAndSubmit(): Promise<void> {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();
    fireEvent.click(screen.getAllByRole("button", { name: /^editar /i })[0]);
    await screen.findByRole("heading", { name: "Editar Horario" });
  }

  it("ticking a new día creates a row and updates the kept días' shared fields on submit", async () => {
    await openEditAndSubmit();

    fireEvent.click(screen.getByLabelText("Viernes"));
    fireEvent.click(screen.getByRole("button", { name: /guardar cambios/i }));

    await waitFor(() => {
      expect(mockCrearHorario).toHaveBeenCalledWith(
        expect.objectContaining({ dia_semana: "VIERNES", categoria: "COMPETITIVO" }),
      );
    });
    expect(mockActualizarHorario).toHaveBeenCalledWith(301, expect.objectContaining({ categoria: "COMPETITIVO" }));
    expect(mockActualizarHorario).toHaveBeenCalledWith(303, expect.objectContaining({ categoria: "COMPETITIVO" }));
    // Sin relación entrenador–horario (issue #13): ningún DTO lleva entrenador_id.
    expect(mockCrearHorario).not.toHaveBeenCalledWith(expect.objectContaining({ entrenador_id: expect.anything() }));
  });

  it("unticking a día with zero enrolled students deletes it silently, without a confirmation dialog", async () => {
    mockFetchAlumnosPorHorario.mockResolvedValue([]);
    await openEditAndSubmit();

    fireEvent.click(screen.getByLabelText("Miércoles"));
    fireEvent.click(screen.getByRole("button", { name: /guardar cambios/i }));

    await waitFor(() => {
      expect(mockEliminarHorario).toHaveBeenCalledWith(303);
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("unticking a día with enrolled students shows a confirmation naming the count and día before deleting", async () => {
    mockFetchAlumnosPorHorario.mockResolvedValue([
      { id: 1, personaId: 10, personaNombreCompleto: "Ana Pérez", horarioId: 303, horarioDia: "MIERCOLES", horarioHoraInicio: "18:00", horarioHoraFin: "20:00", fechaAsignacion: "2026-01-01" },
      { id: 2, personaId: 11, personaNombreCompleto: "Bruno Díaz", horarioId: 303, horarioDia: "MIERCOLES", horarioHoraInicio: "18:00", horarioHoraFin: "20:00", fechaAsignacion: "2026-01-01" },
    ]);
    await openEditAndSubmit();

    fireEvent.click(screen.getByLabelText("Miércoles"));
    fireEvent.click(screen.getByRole("button", { name: /guardar cambios/i }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/2/)).toBeInTheDocument();
    expect(within(dialog).getByText(/mié/i)).toBeInTheDocument();
    expect(mockEliminarHorario).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: /cancelar/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockEliminarHorario).not.toHaveBeenCalled();
    expect(mockDesasignarAlumnoDeHorario).not.toHaveBeenCalled();
  });

  it("confirming the pending deletion calls eliminarHorario, which unassigns that ONE row's students server-side (not desasignarAlumnoDeHorario, which would unenroll them from the whole categoria)", async () => {
    mockFetchAlumnosPorHorario.mockResolvedValue([
      { id: 1, personaId: 10, personaNombreCompleto: "Ana Pérez", horarioId: 303, horarioDia: "MIERCOLES", horarioHoraInicio: "18:00", horarioHoraFin: "20:00", fechaAsignacion: "2026-01-01" },
    ]);
    await openEditAndSubmit();

    fireEvent.click(screen.getByLabelText("Miércoles"));
    fireEvent.click(screen.getByRole("button", { name: /guardar cambios/i }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /confirmar/i }));

    await waitFor(() => {
      expect(mockEliminarHorario).toHaveBeenCalledWith(303);
    });
    // NOT desasignarAlumnoDeHorario: since it now fans out to the whole
    // categoria server-side, calling it here would wrongly unenroll Ana from
    // every OTHER día of the group too, just because Miércoles is dropped.
    expect(mockDesasignarAlumnoDeHorario).not.toHaveBeenCalled();
  });
});

describe("GroupsPage — accordion single-expand mechanics (PR3a)", () => {
  // Two categorias, therefore two cards: the accordion is per card, and the
  // card is the categoria now.
  const GROUPS = [
    { id: 401, diaSemana: "LUNES", horaInicio: "15:00", horaFin: "16:00", categoria: "FORMATIVO" },
    { id: 402, diaSemana: "LUNES", horaInicio: "18:00", horaFin: "20:00", categoria: "COMPETITIVO" },
  ];

  beforeEach(() => {
    mockFetchMembers.mockReset();
    mockFetchHorarios.mockReset();
    mockFetchAlumnosPorHorario.mockReset();
    mockFetchMembers.mockResolvedValue({ accounts: [] });
    mockFetchHorarios.mockResolvedValue(GROUPS);
    mockFetchAlumnosPorHorario.mockResolvedValue([]);
  });

  function cards(): HTMLElement[] {
    // Scoped to the horarios list container — excludes the "Nuevo Horario"
    // create-form wrapper, which reuses the same "card p-5" classes but is a
    // sibling before the list, not a group card.
    return screen.getAllByTestId("horario-card");
  }

  it("renders the edit form inline under the card being edited, not at a fixed page position", async () => {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();

    const [cardA] = cards();
    fireEvent.click(within(cardA).getByRole("button", { name: /^editar /i }));

    const heading = await screen.findByRole("heading", { name: "Editar Horario" });
    expect(cardA.contains(heading)).toBe(true);
  });

  it("expanding group B's edit form collapses group A's — only one group expanded at a time", async () => {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();

    const [cardA, cardB] = cards();
    fireEvent.click(within(cardA).getByRole("button", { name: /^editar /i }));
    await screen.findByRole("heading", { name: "Editar Horario" });
    expect(within(cardA).getByRole("heading", { name: "Editar Horario" })).toBeInTheDocument();

    fireEvent.click(within(cardB).getByRole("button", { name: /^editar /i }));
    await waitFor(() => {
      expect(within(cardB).getByRole("heading", { name: "Editar Horario" })).toBeInTheDocument();
    });
    expect(within(cardA).queryByRole("heading", { name: "Editar Horario" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "Editar Horario" })).toHaveLength(1);
  });

  it("opening the alumnos panel on group B closes group A's edit form (single accordion across tabs)", async () => {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();

    const [cardA, cardB] = cards();
    fireEvent.click(within(cardA).getByRole("button", { name: /^editar /i }));
    await screen.findByRole("heading", { name: "Editar Horario" });

    fireEvent.click(within(cardB).getByRole("button", { name: /ver alumnos/i }));
    await screen.findByRole("heading", { name: "Alumnos de Competitivo" });

    expect(screen.queryByRole("heading", { name: "Editar Horario" })).not.toBeInTheDocument();
  });

  it("switching tabs on the same group replaces the editar panel with the alumnos panel inline", async () => {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();

    const [cardA] = cards();
    fireEvent.click(within(cardA).getByRole("button", { name: /^editar /i }));
    await screen.findByRole("heading", { name: "Editar Horario" });

    fireEvent.click(within(cardA).getByRole("button", { name: /ver alumnos/i }));
    const alumnosHeading = await screen.findByRole("heading", { name: "Alumnos de Formativo" });
    expect(cardA.contains(alumnosHeading)).toBe(true);
    expect(screen.queryByRole("heading", { name: "Editar Horario" })).not.toBeInTheDocument();
  });

  it("the 'Nuevo Horario' create form is not nested inside any existing group card", async () => {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();

    fireEvent.click(screen.getByRole("button", { name: /nuevo horario/i }));
    const heading = await screen.findByRole("heading", { name: "Nuevo Horario" });

    for (const card of cards()) {
      expect(card.contains(heading)).toBe(false);
    }
  });
});

describe("GroupsPage — grupo-level roster: union across días, assign/unassign to every día (bugfix)", () => {
  const MULTI_DIA_GROUP_ROWS = [
    { id: 601, diaSemana: "LUNES", horaInicio: "15:00", horaFin: "16:00", categoria: "FORMATIVO" },
    { id: 602, diaSemana: "MIERCOLES", horaInicio: "15:00", horaFin: "16:00", categoria: "FORMATIVO" },
  ];
  // A second training group — a different categoria, therefore a different
  // card. It exists to prove the roster union stops at the categoria it
  // belongs to instead of pooling every schedule on the screen.
  const SINGLE_DIA_ROW = { id: 603, diaSemana: "VIERNES", horaInicio: "20:00", horaFin: "21:15", categoria: "ADULTOS" };

  // Present in the general student pool but NEVER enrolled via AlumnoHorario
  // for any row above — proves the roster is sourced from
  // fetchAlumnosPorHorario, not from matching against the general student pool.
  const UNENROLLED_ACCOUNT: MemberAccount = {
    id: "acc-unenrolled",
    role: "representante",
    nombres: "Carla",
    apellidos: "Ruiz",
    telefono: "0999999999",
    estudiantes: [
      { id: "50", nombres: "Carla", apellidos: "Ruiz", activo: true, membresia: null, ultimoPago: null },
    ],
  };

  const ASSIGNABLE_ACCOUNT: MemberAccount = {
    id: "acc-assignable",
    role: "representante",
    nombres: "Diego",
    apellidos: "Vega",
    telefono: "0999999999",
    estudiantes: [
      { id: "70", nombres: "Diego", apellidos: "Vega", activo: true, membresia: null, ultimoPago: null },
    ],
  };

  beforeEach(() => {
    mockFetchMembers.mockReset();
    mockFetchHorarios.mockReset();
    mockFetchAlumnosPorHorario.mockReset();
    mockAsignarAlumnoAHorario.mockReset();
    mockDesasignarAlumnoDeHorario.mockReset();
    mockFetchHorarios.mockResolvedValue([...MULTI_DIA_GROUP_ROWS, SINGLE_DIA_ROW]);
    mockFetchMembers.mockResolvedValue({ accounts: [UNENROLLED_ACCOUNT] });
    mockAsignarAlumnoAHorario.mockResolvedValue({});
    mockDesasignarAlumnoDeHorario.mockResolvedValue(undefined);
    mockFetchAlumnosPorHorario.mockImplementation((horarioId: number) => {
      if (horarioId === 601) {
        return Promise.resolve([
          { id: 1, personaId: 20, personaNombreCompleto: "Ana Pérez", edad: 12, horarioId: 601, horarioDia: "LUNES", horarioHoraInicio: "15:00", horarioHoraFin: "16:00", fechaAsignacion: "2026-01-01" },
        ]);
      }
      if (horarioId === 602) {
        return Promise.resolve([
          // Same personaId 20 as the LUNES row above — must be deduplicated
          // in the union, plus Bruno who is only enrolled on this día.
          { id: 1, personaId: 20, personaNombreCompleto: "Ana Pérez", edad: 12, horarioId: 602, horarioDia: "MIERCOLES", horarioHoraInicio: "15:00", horarioHoraFin: "16:00", fechaAsignacion: "2026-01-01" },
          { id: 2, personaId: 21, personaNombreCompleto: "Bruno Díaz", edad: 15, horarioId: 602, horarioDia: "MIERCOLES", horarioHoraInicio: "15:00", horarioHoraFin: "16:00", fechaAsignacion: "2026-01-01" },
        ]);
      }
      return Promise.resolve([]);
    });
  });

  function cards(): HTMLElement[] {
    return screen.getAllByTestId("horario-card");
  }

  it("does not render a nivel-filtered roster block outside the accordion", async () => {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();

    expect(screen.queryByText("Alumnos asignados")).not.toBeInTheDocument();
    expect(screen.queryByText("Carla Ruiz")).not.toBeInTheDocument();
  });

  it("shows each student's age next to their name in the roster (Fix 1)", async () => {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();

    const [multiDiaCard] = cards();
    fireEvent.click(within(multiDiaCard).getByRole("button", { name: /ver alumnos/i }));
    await screen.findByRole("heading", { name: "Alumnos de Formativo" });

    expect(await screen.findByText("Ana Pérez")).toBeInTheDocument();
    expect(screen.getByText("12 años")).toBeInTheDocument();
    expect(await screen.findByText("Bruno Díaz")).toBeInTheDocument();
    expect(screen.getByText("15 años")).toBeInTheDocument();
  });

  it("renders the deduplicated union of every día's roster, not just one día (bugfix)", async () => {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();

    const [multiDiaCard] = cards();
    fireEvent.click(within(multiDiaCard).getByRole("button", { name: /ver alumnos/i }));
    await screen.findByRole("heading", { name: "Alumnos de Formativo" });

    await waitFor(() => expect(mockFetchAlumnosPorHorario).toHaveBeenCalledWith(601));
    await waitFor(() => expect(mockFetchAlumnosPorHorario).toHaveBeenCalledWith(602));

    // Ana (personaId 20) appears on both LUNES and MIERCOLES rows but only
    // once in the rendered roster — deduplicated by personaId.
    expect(await screen.findByText("Alumnos asignados (2)")).toBeInTheDocument();
    expect(screen.getAllByText("Ana Pérez")).toHaveLength(1);
    expect(screen.getByText("Bruno Díaz")).toBeInTheDocument();
  });

  /** A roster of `size` distinct students on the LUNES row of Formativo. */
  function rosterOf(size: number): AlumnoHorario[] {
    return Array.from({ length: size }, (_, i) => ({
      id: 1000 + i,
      personaId: 1000 + i,
      personaNombreCompleto: `Alumno ${String(i + 1).padStart(2, "0")}`,
      edad: 10,
      horarioId: 601,
      horarioDia: "LUNES",
      horarioHoraInicio: "15:00",
      horarioHoraFin: "16:00",
      fechaAsignacion: "2026-01-01",
    }));
  }

  async function openFormativoAlumnos(): Promise<void> {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();
    const [multiDiaCard] = cards();
    fireEvent.click(within(multiDiaCard).getByRole("button", { name: /ver alumnos/i }));
    await screen.findByRole("heading", { name: "Alumnos de Formativo" });
  }

  it("puts 'Asignar nuevo estudiante' before the roster, not after it", async () => {
    // On the 44-student categoría the picker sat under every enrolled name, so
    // adding somebody meant scrolling the whole roster to reach it.
    await openFormativoAlumnos();
    const roster = await screen.findByText("Alumnos asignados (2)");
    const picker = screen.getByLabelText("Seleccionar alumno");

    expect(picker.compareDocumentPosition(roster) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("pages the roster instead of printing all 25 names at once", async () => {
    mockFetchAlumnosPorHorario.mockImplementation((horarioId: number) =>
      Promise.resolve(horarioId === 601 ? rosterOf(25) : []),
    );
    await openFormativoAlumnos();

    expect(await screen.findByText("Alumnos asignados (25)")).toBeInTheDocument();
    expect(screen.getByText(/1–10 de 25 alumnos/)).toBeInTheDocument();
    expect(screen.getByText("Alumno 01")).toBeInTheDocument();
    expect(screen.queryByText("Alumno 11")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /siguiente/i }));

    expect(await screen.findByText("Alumno 11")).toBeInTheDocument();
    expect(screen.queryByText("Alumno 01")).not.toBeInTheDocument();
    expect(screen.getByText(/11–20 de 25 alumnos/)).toBeInTheDocument();
  });

  it("shows no pager for a roster that fits on one page", async () => {
    await openFormativoAlumnos();

    expect(await screen.findByText("Alumnos asignados (2)")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /siguiente/i })).not.toBeInTheDocument();
  });

  it("re-opens the roster on page 1 after having paged another group", async () => {
    mockFetchAlumnosPorHorario.mockImplementation((horarioId: number) =>
      Promise.resolve(horarioId === 601 ? rosterOf(25) : []),
    );
    await openFormativoAlumnos();
    await screen.findByText(/1–10 de 25 alumnos/);
    fireEvent.click(screen.getByRole("button", { name: /siguiente/i }));
    await screen.findByText(/11–20 de 25 alumnos/);

    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    const [multiDiaCard] = cards();
    fireEvent.click(within(multiDiaCard).getByRole("button", { name: /ver alumnos/i }));

    expect(await screen.findByText(/1–10 de 25 alumnos/)).toBeInTheDocument();
  });

  it("no longer renders a día-pill selector — assignment acts on the whole grupo now", async () => {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();

    const [multiDiaCard] = cards();
    fireEvent.click(within(multiDiaCard).getByRole("button", { name: /ver alumnos/i }));
    await screen.findByRole("heading", { name: "Alumnos de Formativo" });

    expect(screen.queryByRole("button", { name: "Lun" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mié" })).not.toBeInTheDocument();
  });

  it("assigning a student calls asignarAlumnoAHorario ONCE, anchored on the first row of the group (backend enrolls the whole categoria atomically)", async () => {
    mockFetchMembers.mockResolvedValue({ accounts: [ASSIGNABLE_ACCOUNT] });
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();

    const [multiDiaCard] = cards();
    fireEvent.click(within(multiDiaCard).getByRole("button", { name: /ver alumnos/i }));
    await screen.findByRole("heading", { name: "Alumnos de Formativo" });
    await waitFor(() => expect(mockFetchAlumnosPorHorario).toHaveBeenCalledWith(602));

    fireEvent.change(screen.getByLabelText("Seleccionar alumno"), { target: { value: "70" } });
    fireEvent.click(screen.getByRole("button", { name: /^asignar$/i }));

    await waitFor(() => {
      expect(mockAsignarAlumnoAHorario).toHaveBeenCalledWith({ persona_id: 70, horario_id: 601 });
    });
    expect(mockAsignarAlumnoAHorario).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/asignado correctamente/i)).toBeInTheDocument();
  });

  it("shows a real error when the assign call fails (e.g. already enrolled in the whole categoria)", async () => {
    mockFetchMembers.mockResolvedValue({ accounts: [ASSIGNABLE_ACCOUNT] });
    mockAsignarAlumnoAHorario.mockRejectedValue(new ApiClientError("Diego Vega ya figura en esa categoría.", 400));
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();

    const [multiDiaCard] = cards();
    fireEvent.click(within(multiDiaCard).getByRole("button", { name: /ver alumnos/i }));
    await screen.findByRole("heading", { name: "Alumnos de Formativo" });
    await waitFor(() => expect(mockFetchAlumnosPorHorario).toHaveBeenCalledWith(602));

    fireEvent.change(screen.getByLabelText("Seleccionar alumno"), { target: { value: "70" } });
    const rosterCallsBeforeAssign = mockFetchAlumnosPorHorario.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: /^asignar$/i }));

    await waitFor(() => {
      expect(mockAsignarAlumnoAHorario).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText("Diego Vega ya figura en esa categoría.")).toBeInTheDocument();
    expect(screen.queryByText(/asignado correctamente/i)).not.toBeInTheDocument();
    // The roster still refreshes after a failed assign — the request may
    // have landed server-side even though the client saw an error, so
    // staying on stale data would be worse than a wasted refetch.
    await waitFor(() => {
      expect(mockFetchAlumnosPorHorario.mock.calls.length).toBeGreaterThan(rosterCallsBeforeAssign);
    });
  });

  it("shows a real error (not a false success) on a server failure while assigning", async () => {
    mockFetchMembers.mockResolvedValue({ accounts: [ASSIGNABLE_ACCOUNT] });
    mockAsignarAlumnoAHorario.mockRejectedValue(new ApiClientError("Error de red al asignar el alumno.", 500));
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();

    const [multiDiaCard] = cards();
    fireEvent.click(within(multiDiaCard).getByRole("button", { name: /ver alumnos/i }));
    await screen.findByRole("heading", { name: "Alumnos de Formativo" });
    await waitFor(() => expect(mockFetchAlumnosPorHorario).toHaveBeenCalledWith(602));

    fireEvent.change(screen.getByLabelText("Seleccionar alumno"), { target: { value: "70" } });
    fireEvent.click(screen.getByRole("button", { name: /^asignar$/i }));

    await waitFor(() => {
      expect(mockAsignarAlumnoAHorario).toHaveBeenCalledTimes(1);
    });
    // The mock was already faithful — a 500 from the assign endpoint. What
    // was fiction is the assertion: a 5xx `detail` describes the server's
    // failure, so the row reports the server, not the body of the 500.
    expect(
      await screen.findByText("El servidor no pudo completar la operación. Intente nuevamente en unos minutos."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/asignado correctamente/i)).not.toBeInTheDocument();
  });

  it("desasignating a student calls desasignarAlumnoDeHorario ONCE, anchored on the first row of the group (backend unassigns the whole categoria atomically)", async () => {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();

    const [multiDiaCard] = cards();
    fireEvent.click(within(multiDiaCard).getByRole("button", { name: /ver alumnos/i }));
    await screen.findByRole("heading", { name: "Alumnos de Formativo" });
    await waitFor(() => expect(mockFetchAlumnosPorHorario).toHaveBeenCalledWith(602));

    const anaRow = (await screen.findByText("Ana Pérez")).closest("li") as HTMLElement;
    fireEvent.click(within(anaRow).getByTitle("Desasignar alumno"));

    await waitFor(() => {
      expect(mockDesasignarAlumnoDeHorario).toHaveBeenCalledWith(20, 601);
    });
    expect(mockDesasignarAlumnoDeHorario).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Alumno desasignado del horario.")).toBeInTheDocument();
  });

  it("shows a real error (not a false success) on a server failure while desasignating", async () => {
    mockDesasignarAlumnoDeHorario.mockRejectedValue(new ApiClientError("Error de red al desasignar el alumno.", 500));
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();

    const [multiDiaCard] = cards();
    fireEvent.click(within(multiDiaCard).getByRole("button", { name: /ver alumnos/i }));
    await screen.findByRole("heading", { name: "Alumnos de Formativo" });
    await waitFor(() => expect(mockFetchAlumnosPorHorario).toHaveBeenCalledWith(602));

    const anaRow = (await screen.findByText("Ana Pérez")).closest("li") as HTMLElement;
    fireEvent.click(within(anaRow).getByTitle("Desasignar alumno"));

    await waitFor(() => {
      expect(mockDesasignarAlumnoDeHorario).toHaveBeenCalledTimes(1);
    });
    expect(
      await screen.findByText("El servidor no pudo completar la operación. Intente nuevamente en unos minutos."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Alumno desasignado del horario.")).not.toBeInTheDocument();
  });
});

describe("GroupsPage — deleting removes the whole group, not just the first día (bugfix)", () => {
  /** The delete action lives inside the edit panel (`15-horario-editar.html`),
   *  not on the card, because it removes every weekday of the group. */
  async function openDeleteFromEditPanel(): Promise<void> {
    fireEvent.click(screen.getAllByRole("button", { name: /^editar /i })[0]);
    await screen.findByRole("heading", { name: "Editar Horario" });
    fireEvent.click(screen.getByRole("button", { name: /^eliminar/i }));
  }

  const GROUP_ROWS = [
    { id: 701, diaSemana: "LUNES", horaInicio: "18:00", horaFin: "20:00", categoria: "COMPETITIVO" },
    { id: 702, diaSemana: "MIERCOLES", horaInicio: "18:00", horaFin: "20:00", categoria: "COMPETITIVO" },
    { id: 703, diaSemana: "VIERNES", horaInicio: "18:00", horaFin: "20:00", categoria: "COMPETITIVO" },
  ];

  beforeEach(() => {
    mockFetchMembers.mockReset();
    mockFetchHorarios.mockReset();
    mockEliminarHorario.mockReset();
    mockFetchAlumnosPorHorario.mockReset();
    mockDesasignarAlumnoDeHorario.mockReset();
    mockFetchMembers.mockResolvedValue({ accounts: [] });
    mockFetchHorarios.mockResolvedValue(GROUP_ROWS);
    mockEliminarHorario.mockResolvedValue(undefined);
    mockDesasignarAlumnoDeHorario.mockResolvedValue(undefined);
  });

  it("checks alumnos for EVERY día row (not only the first) before showing the confirmation dialog", async () => {
    mockFetchAlumnosPorHorario.mockImplementation((horarioId: number) => {
      if (horarioId === 701) {
        return Promise.resolve([
          { id: 1, personaId: 10, personaNombreCompleto: "Ana Pérez", horarioId: 701, horarioDia: "LUNES", horarioHoraInicio: "18:00", horarioHoraFin: "20:00", fechaAsignacion: "2026-01-01" },
        ]);
      }
      if (horarioId === 703) {
        return Promise.resolve([
          { id: 2, personaId: 11, personaNombreCompleto: "Bruno Díaz", horarioId: 703, horarioDia: "VIERNES", horarioHoraInicio: "18:00", horarioHoraFin: "20:00", fechaAsignacion: "2026-01-01" },
        ]);
      }
      return Promise.resolve([]);
    });

    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();

    await openDeleteFromEditPanel();

    await waitFor(() => {
      expect(mockFetchAlumnosPorHorario).toHaveBeenCalledWith(701);
      expect(mockFetchAlumnosPorHorario).toHaveBeenCalledWith(702);
      expect(mockFetchAlumnosPorHorario).toHaveBeenCalledWith(703);
    });

    const dialog = await screen.findByRole("dialog");
    // Total across all 3 días (1 + 0 + 1), not just the first row's count.
    expect(within(dialog).getByText(/2/)).toBeInTheDocument();
    expect(within(dialog).getByText(/lun/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/mié/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/vie/i)).toBeInTheDocument();
    expect(mockEliminarHorario).not.toHaveBeenCalled();
  });

  it("confirming deletes EVERY día row of the whole group via eliminarHorario alone (each row's own students are unassigned server-side, not via desasignarAlumnoDeHorario)", async () => {
    mockFetchAlumnosPorHorario.mockImplementation((horarioId: number) => {
      if (horarioId === 701) {
        return Promise.resolve([
          { id: 1, personaId: 10, personaNombreCompleto: "Ana Pérez", horarioId: 701, horarioDia: "LUNES", horarioHoraInicio: "18:00", horarioHoraFin: "20:00", fechaAsignacion: "2026-01-01" },
        ]);
      }
      return Promise.resolve([]);
    });

    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();

    await openDeleteFromEditPanel();
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /confirmar/i }));

    await waitFor(() => {
      expect(mockEliminarHorario).toHaveBeenCalledWith(701);
      expect(mockEliminarHorario).toHaveBeenCalledWith(702);
      expect(mockEliminarHorario).toHaveBeenCalledWith(703);
    });
    expect(mockDesasignarAlumnoDeHorario).not.toHaveBeenCalled();
  });

  it("canceling the confirmation makes no delete calls and does not resync data", async () => {
    mockFetchAlumnosPorHorario.mockResolvedValue([]);
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();
    mockFetchHorarios.mockClear();

    await openDeleteFromEditPanel();
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /cancelar/i }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockEliminarHorario).not.toHaveBeenCalled();
    expect(mockFetchHorarios).not.toHaveBeenCalled();
  });
});

describe("GroupsPage — save resyncs local state after a mid-sequence failure (bugfix)", () => {
  const GROUP_ROWS = [
    { id: 301, diaSemana: "LUNES", horaInicio: "18:00", horaFin: "20:00", categoria: "COMPETITIVO" },
    { id: 303, diaSemana: "MIERCOLES", horaInicio: "18:00", horaFin: "20:00", categoria: "COMPETITIVO" },
  ];
  // Simulates the backend state AFTER the partial failure: día VIERNES (705)
  // was already created successfully before actualizarHorario(303) rejected.
  const RESYNCED_ROWS = [
    ...GROUP_ROWS,
    { id: 705, diaSemana: "VIERNES", horaInicio: "18:00", horaFin: "20:00", categoria: "COMPETITIVO" },
  ];

  beforeEach(() => {
    mockFetchMembers.mockReset();
    mockFetchHorarios.mockReset();
    mockCrearHorario.mockReset();
    mockActualizarHorario.mockReset();
    mockEliminarHorario.mockReset();
    mockFetchAlumnosPorHorario.mockReset();
    mockDesasignarAlumnoDeHorario.mockReset();
    mockFetchMembers.mockResolvedValue({ accounts: [] });
    mockFetchHorarios.mockResolvedValueOnce(GROUP_ROWS).mockResolvedValue(RESYNCED_ROWS);
    mockFetchAlumnosPorHorario.mockResolvedValue([]);
  });

  it("resyncs via loadData() and closes the form after a mid-sequence save failure, so a retry does not re-diff against stale rows", async () => {
    mockCrearHorario.mockResolvedValue({}); // crearHorario(VIERNES) succeeds
    // actualizarHorario(301) succeeds, actualizarHorario(303) fails — the
    // real bug: a 2nd/3rd call in the sequence rejecting after earlier calls
    // already succeeded.
    mockActualizarHorario.mockImplementation((id: number) =>
      id === 301 ? Promise.resolve({}) : Promise.reject(new Error("boom")),
    );

    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();
    fireEvent.click(screen.getAllByRole("button", { name: /^editar /i })[0]);
    await screen.findByRole("heading", { name: "Editar Horario" });

    fireEvent.click(screen.getByLabelText("Viernes"));
    fireEvent.click(screen.getByRole("button", { name: /guardar cambios/i }));

    await waitFor(() => expect(mockActualizarHorario).toHaveBeenCalledWith(303, expect.anything()));

    // loadData()/fetchHorarios is called again to resync with what actually
    // persisted (initial load + post-failure resync).
    await waitFor(() => expect(mockFetchHorarios).toHaveBeenCalledTimes(2));
    // The form closes instead of continuing to edit against the stale
    // pre-failure `editingGroup` snapshot.
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Editar Horario" })).not.toBeInTheDocument());
    await screen.findByText(/error al guardar el horario/i);

    // Reopening the form must reflect the RESYNCED backend state (día
    // VIERNES already exists, id 705) — not the stale 2-día snapshot from
    // before the failed save, which would cause a retry to re-create it.
    fireEvent.click(screen.getAllByRole("button", { name: /^editar /i })[0]);
    await screen.findByRole("heading", { name: "Editar Horario" });
    expect(screen.getByLabelText("Viernes")).toBeChecked();
  });
});

describe("GroupsPage — sin selector de entrenador (issue #13)", () => {
  const GROUP_ROWS = [
    { id: 301, diaSemana: "LUNES", horaInicio: "18:00", horaFin: "20:00", categoria: "COMPETITIVO" },
  ];

  beforeEach(() => {
    mockFetchMembers.mockReset();
    mockFetchHorarios.mockReset();
    mockCrearHorario.mockReset();
    mockFetchMembers.mockResolvedValue({ accounts: [] });
    mockFetchHorarios.mockResolvedValue(GROUP_ROWS);
    mockCrearHorario.mockResolvedValue({});
  });

  it("the create form has no Entrenador field — the relation is gone", async () => {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();
    fireEvent.click(screen.getByRole("button", { name: /nuevo horario/i }));

    await screen.findByRole("heading", { name: "Nuevo Horario" });
    expect(screen.queryByLabelText("Entrenador")).not.toBeInTheDocument();
  });

  it("creating a new horario submits only categoria and dia_semana", async () => {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();
    fireEvent.click(screen.getByRole("button", { name: /nuevo horario/i }));

    fireEvent.click(screen.getByLabelText("Lunes"));
    fireEvent.click(screen.getByRole("button", { name: /crear horario/i }));

    await waitFor(() => {
      // FORMATIVO es la categoría por defecto del formulario "Nuevo Horario".
      expect(mockCrearHorario).toHaveBeenCalledWith({ dia_semana: "LUNES", categoria: "FORMATIVO" });
    });
  });

  it("editing an existing horario opens the form without any trainer field", async () => {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();
    fireEvent.click(screen.getAllByRole("button", { name: /^editar /i })[0]);

    await screen.findByRole("heading", { name: "Editar Horario" });
    expect(screen.queryByLabelText("Entrenador")).not.toBeInTheDocument();
  });
});

describe("GroupsPage — categoria catalog fetch failure does not blank the page (resilience fix)", () => {
  beforeEach(() => {
    mockFetchMembers.mockReset();
    mockFetchHorarios.mockReset();
    mockFetchCategoriasCatalogo.mockReset();
    mockFetchMembers.mockResolvedValue({ accounts: [] });
    mockFetchHorarios.mockResolvedValue([
      { id: 1, diaSemana: "LUNES", horaInicio: "15:00", horaFin: "16:00", categoria: "FORMATIVO" },
    ]);
    mockFetchCategoriasCatalogo.mockRejectedValue(new Error("network error"));
  });

  it("still renders the horarios list when only the categoria catalog fetch fails", async () => {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();

    // The schedule list loaded fine — an outage of the categoria catalog
    // alone must not replace it with the full-page ErrorState.
    expect(screen.getAllByTestId("horario-card").length).toBeGreaterThan(0);
    expect(screen.queryByText("No se pudieron cargar los horarios. Intente nuevamente.")).not.toBeInTheDocument();
  });

  it("shows a non-blocking toast for the categoria catalog failure", async () => {
    render(
      <ToastProvider>
        <GroupsPage />
        <ToastContainer />
      </ToastProvider>,
    );
    await waitForHorarios();

    expect(await screen.findByText("No se pudo cargar el catálogo de categorías.")).toBeInTheDocument();
  });

  it("degrades the categoría label to the raw code instead of crashing while the catalog is unavailable", async () => {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();

    const card = screen.getAllByTestId("horario-card")[0];
    expect(card).toHaveTextContent("FORMATIVO");
  });
});
