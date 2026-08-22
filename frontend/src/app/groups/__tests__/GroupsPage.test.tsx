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
const mockFetchNotificaciones = vi.fn().mockResolvedValue({ items: [], total: 0, skip: 0, limit: 20 });
const mockMarcarNotificacionLeida = vi.fn().mockResolvedValue(undefined);
const mockFetchHorarios = vi.fn().mockResolvedValue([]);
const mockCrearCategoria = vi.fn();
const mockActualizarCategoria = vi.fn();
const mockEliminarCategoria = vi.fn();
const mockFetchAlumnosPorHorario = vi.fn().mockResolvedValue([]);
const mockFetchRosterDeTodosLosHorarios = vi.fn().mockResolvedValue([]);
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
    crearCategoria: (dto: unknown) => mockCrearCategoria(dto),
    actualizarCategoria: (codigo: string, dto: unknown) => mockActualizarCategoria(codigo, dto),
    eliminarCategoria: (codigo: string) => mockEliminarCategoria(codigo),
    fetchAlumnosPorHorario: (horarioId: number) => mockFetchAlumnosPorHorario(horarioId),
    fetchRosterDeTodosLosHorarios: () => mockFetchRosterDeTodosLosHorarios(),
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
/**
 * The seven boxes of a row's week strip, in render order.
 *
 * The screen used to draw a local `DiaTrack` keyed by the backend's
 * `data-dia="LUNES"`; it now draws the shared `ui/WeekStrip`, which is keyed by
 * the frontend's `data-day="lun"` — the vocabulary the rest of the product
 * carries — and always renders all seven.
 */
function daysOf(card: HTMLElement): HTMLElement[] {
  return Array.from(
    within(card).getByTestId("week-strip").querySelectorAll<HTMLElement>("[data-day]"),
  );
}

/** `activo` | `disponible` | `inactivo` for one day of a strip. */
function stateOf(boxes: HTMLElement[], day: string): string | undefined {
  return boxes.find((box) => box.dataset.day === day)?.dataset.state;
}

async function waitForHorarios(): Promise<void> {
  await waitFor(() => {
    expect(screen.queryByText("Cargando horarios…")).not.toBeInTheDocument();
  });
}

describe("GroupsPage — categoría form is typed input, not a locked catalog select (v6, docs/archive/fixes/24-abm-categorias.md)", () => {
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

  it("the create form has a free-text nombre input and editable hora_inicio/hora_fin — no categoría <select> left", async () => {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();
    fireEvent.click(screen.getByRole("button", { name: /nueva categoría/i }));

    expect(screen.getByLabelText(/^Nombre/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Hora de inicio/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Hora de fin/)).toBeRequired();
    expect(screen.getByLabelText(/^Nombre/)).toBeRequired();
    expect(screen.getByLabelText(/^Hora de inicio/)).toBeRequired();
    expect(screen.getByRole("group", { name: /^Días de la semana/ })).toHaveAttribute("aria-required", "true");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("offers all seven días as checkboxes — not restricted to a fixed allowed set", async () => {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();
    fireEvent.click(screen.getByRole("button", { name: /nueva categoría/i }));

    for (const dia of ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]) {
      expect(screen.getByLabelText(dia)).toBeInTheDocument();
    }
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
    mockFetchRosterDeTodosLosHorarios.mockReset();
    mockFetchMembers.mockResolvedValue({ accounts: [] });
    mockFetchAlumnosPorHorario.mockResolvedValue([]);
    mockFetchRosterDeTodosLosHorarios.mockResolvedValue([]);
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

  /**
   * RENEGOTIATED, and tightened rather than loosened.
   *
   * This asserted the old local `DiaTrack`: a capsule per día OF THE TRACK, so
   * the expected list was 6 entries for COMPETITIVO and 5 for everyone else —
   * i.e. the test encoded the variable-length row that broke the rule of
   * format ("los días son siempre siete casillas fijas en el mismo orden").
   * The screen now draws the shared `WeekStrip`, so the assertion becomes
   * SEVEN boxes always, in one fixed order, which is a stricter statement than
   * the one it replaces: it fails if the strip ever shrinks to the track again.
   *
   * The three-state fact the old markers carried is preserved and still
   * asserted — it just moved from `data-active` true/false plus absence, to
   * `data-state` activo/disponible/inactivo, which can say all three.
   */
  it("lays the categoria's week out as seven fixed boxes, flagging the ones it actually runs", async () => {
    mockFetchHorarios.mockResolvedValue(RECURRING_ROWS);

    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();

    const card = screen.getAllByTestId("horario-card")[0];
    const boxes = daysOf(card);

    expect(boxes.map((box) => box.dataset.day)).toEqual([
      "lun", "mar", "mie", "jue", "vie", "sab", "dom",
    ]);
    // COMPETITIVO may meet Lunes–Sábado; these rows only use Lun/Mié/Vie.
    expect(stateOf(boxes, "lun")).toBe("activo");
    expect(stateOf(boxes, "mie")).toBe("activo");
    expect(stateOf(boxes, "vie")).toBe("activo");
    // Allowed by the track and unused — the distinction the dashed capsule
    // used to carry.
    expect(stateOf(boxes, "mar")).toBe("disponible");
    expect(stateOf(boxes, "sab")).toBe("disponible");
    // Outside the track entirely, and now visible as a position rather than
    // as a missing capsule.
    expect(stateOf(boxes, "dom")).toBe("inactivo");
  });

  it("says the week in whole words for a screen reader, never in three-letter slices", async () => {
    // The letters in the boxes are positions on a scale, which is the one
    // declared exception to the rule of words. "Lun"/"Mié"/"Sáb" were not
    // that: they were the day's name, cut. The sentence carries the fact.
    mockFetchHorarios.mockResolvedValue(RECURRING_ROWS);

    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();

    const card = screen.getAllByTestId("horario-card")[0];
    expect(within(card).getByTestId("week-strip")).toHaveAttribute(
      "aria-label",
      "Lunes, miércoles y viernes",
    );
  });

  it("shows the live Sábado row as an active día marker, not a missing one", async () => {
    mockFetchHorarios.mockResolvedValue(FULL_WEEK_ROWS);

    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();

    const card = screen.getAllByTestId("horario-card")[0];
    expect(stateOf(daysOf(card), "sab")).toBe("activo");
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
    const markers = daysOf(card).filter((box) => box.dataset.state !== "inactivo");

    expect(markers.map((box) => box.dataset.day)).toEqual([
      "lun", "mar", "mie", "jue", "vie",
    ]);
    const miercoles = markers.find((box) => box.dataset.day === "mie");
    expect(miercoles?.dataset.state).toBe("disponible");
    expect(
      markers.filter((box) => box.dataset.day !== "mie"),
    ).toSatisfy((rest: HTMLElement[]) => rest.every((box) => box.dataset.state === "activo"));
  });

  it("names every column inside the row, not only in the strip above it", async () => {
    // The strip above the list is `aria-hidden` — correctly, since announcing
    // it too would read each column name twice per row. So the names assistive
    // tech actually gets are the ones INSIDE each row, and two of the four were
    // missing: `Categoría` had a strip entry and no cell label, and the action
    // column had neither. Below `xl` there is no strip at all, so the first
    // column of every row was unnamed at every width.
    //
    // Asserted per row rather than per page: a label that exists once, above,
    // is exactly the state this replaces.
    //
    // Column reads "Categoría", not "Grupo" (#315 hallazgo #41): this column
    // shows `categoriaLabel(card.categoria)`, the exact value the "Nueva
    // categoría"/"Editar categoría" controls on this same screen already name
    // — a third word for the same thing was the finding, not the column
    // existing.
    mockFetchHorarios.mockResolvedValue(RECURRING_ROWS);

    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();

    for (const card of screen.getAllByTestId("horario-card")) {
      for (const column of ["Categoría", "Horario", "Alumnos", "Acciones"]) {
        expect(within(card).getByText(column), `${column} is unnamed in the row`).toBeInTheDocument();
      }
      expect(within(card).queryByText("Grupo")).not.toBeInTheDocument();
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
    // rows would report six; the group has two. TRA-7: one bulk roster call
    // (fetchRosterDeTodosLosHorarios), not one per horario.
    mockFetchRosterDeTodosLosHorarios.mockResolvedValue(
      RECURRING_ROWS.flatMap((row) => [alumno(10, row.id), alumno(11, row.id)]),
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
    mockFetchRosterDeTodosLosHorarios.mockResolvedValue([
      alumno(10, 101), alumno(11, 101),
      alumno(10, 102),
      alumno(10, 103),
    ]);

    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();

    expect(await screen.findByText("2 inscriptos")).toBeInTheDocument();
    expect(screen.queryByText(/no está inscript[oa]/i)).not.toBeInTheDocument();
  });

  it("omits the headcount rather than undercounting when the roster request fails", async () => {
    // TRA-7 collapsed the 26 per-horario requests into one bulk call: a
    // failure is now all-or-nothing (no card gets a count), coarser-grained
    // than the old per-horario partial failure but the same principle —
    // never render a false number.
    mockFetchHorarios.mockResolvedValue(RECURRING_ROWS);
    mockFetchRosterDeTodosLosHorarios.mockRejectedValue(new Error("network"));

    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();

    await waitFor(() => expect(mockFetchRosterDeTodosLosHorarios).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/inscripto/i)).not.toBeInTheDocument();
  });

  it("fetches the roster in one call regardless of how many schedules there are (TRA-7)", async () => {
    // The regression this closes: card counts used to cost one request per
    // horario (26 in production). FULL_WEEK_ROWS stands in for "many
    // schedules" here; the fix means the count stays flat at one call.
    mockFetchHorarios.mockResolvedValue(FULL_WEEK_ROWS);
    mockFetchRosterDeTodosLosHorarios.mockResolvedValue(
      FULL_WEEK_ROWS.map((row) => alumno(10, row.id)),
    );

    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();

    await waitFor(() => expect(screen.getByText("1 inscripto")).toBeInTheDocument());
    expect(mockFetchRosterDeTodosLosHorarios).toHaveBeenCalledTimes(1);
    // The per-horario endpoint is only for the "Ver alumnos" panel of a
    // SINGLE opened group, never for the grid's count line.
    expect(mockFetchAlumnosPorHorario).not.toHaveBeenCalled();
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
    expect(screen.queryByRole("heading", { name: "Editar categoría" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /editar los días martes/i }));
    await screen.findByRole("heading", { name: "Editar categoría" });
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
    const boxes = daysOf(card);
    // Seven boxes even here: with no allowed-day metadata the strip has no
    // track to shade, so the other six read as unlit positions rather than
    // disappearing and leaving a one-capsule row.
    expect(boxes).toHaveLength(7);
    expect(stateOf(boxes, "lun")).toBe("activo");
    expect(boxes.filter((box) => box.dataset.state === "activo")).toHaveLength(1);
  });
});

describe("GroupsPage — atomic categoría save (v6, docs/archive/fixes/24-abm-categorias.md)", () => {
  const GROUP_ROWS = [
    { id: 301, diaSemana: "LUNES", horaInicio: "18:00", horaFin: "20:00", categoria: "COMPETITIVO" },
    { id: 303, diaSemana: "MIERCOLES", horaInicio: "18:00", horaFin: "20:00", categoria: "COMPETITIVO" },
  ];

  beforeEach(() => {
    mockFetchMembers.mockReset();
    mockFetchHorarios.mockReset();
    mockCrearCategoria.mockReset();
    mockActualizarCategoria.mockReset();
    mockEliminarCategoria.mockReset();
    mockFetchAlumnosPorHorario.mockReset();
    mockDesasignarAlumnoDeHorario.mockReset();
    mockFetchMembers.mockResolvedValue({ accounts: [] });
    mockFetchHorarios.mockResolvedValue(GROUP_ROWS);
    mockCrearCategoria.mockResolvedValue({});
    mockActualizarCategoria.mockResolvedValue({});
    mockEliminarCategoria.mockResolvedValue(undefined);
    mockFetchAlumnosPorHorario.mockResolvedValue([]);
    mockDesasignarAlumnoDeHorario.mockResolvedValue(undefined);
  });

  async function openEditAndSubmit(): Promise<void> {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();
    fireEvent.click(screen.getAllByRole("button", { name: /^editar /i })[0]);
    await screen.findByRole("heading", { name: "Editar categoría" });
  }

  it("ticking a new día saves the categoría with the whole new day-set in ONE actualizarCategoria call", async () => {
    await openEditAndSubmit();

    fireEvent.click(screen.getByRole("checkbox", { name: "Viernes" }));
    fireEvent.click(screen.getByRole("button", { name: /guardar cambios/i }));

    await waitFor(() => {
      expect(mockActualizarCategoria).toHaveBeenCalledWith(
        "COMPETITIVO",
        expect.objectContaining({ dias: expect.arrayContaining(["LUNES", "MIERCOLES", "VIERNES"]) }),
      );
    });
    expect(mockActualizarCategoria).toHaveBeenCalledTimes(1);
  });

  it("unticking a día with zero enrolled students saves atomically, without a confirmation dialog", async () => {
    mockFetchAlumnosPorHorario.mockResolvedValue([]);
    await openEditAndSubmit();

    fireEvent.click(screen.getByRole("checkbox", { name: "Miércoles" }));
    fireEvent.click(screen.getByRole("button", { name: /guardar cambios/i }));

    await waitFor(() => {
      expect(mockActualizarCategoria).toHaveBeenCalledWith(
        "COMPETITIVO",
        expect.objectContaining({ dias: ["LUNES"] }),
      );
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("unticking a día with enrolled students shows a confirmation naming the count and día BEFORE saving", async () => {
    mockFetchAlumnosPorHorario.mockResolvedValue([
      { id: 1, personaId: 10, personaNombreCompleto: "Ana Pérez", horarioId: 303, horarioDia: "MIERCOLES", horarioHoraInicio: "18:00", horarioHoraFin: "20:00", fechaAsignacion: "2026-01-01" },
      { id: 2, personaId: 11, personaNombreCompleto: "Bruno Díaz", horarioId: 303, horarioDia: "MIERCOLES", horarioHoraInicio: "18:00", horarioHoraFin: "20:00", fechaAsignacion: "2026-01-01" },
    ]);
    await openEditAndSubmit();

    fireEvent.click(screen.getByRole("checkbox", { name: "Miércoles" }));
    fireEvent.click(screen.getByRole("button", { name: /guardar cambios/i }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/2/)).toBeInTheDocument();
    expect(within(dialog).getByText(/mié/i)).toBeInTheDocument();
    expect(mockActualizarCategoria).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: /cancelar/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockActualizarCategoria).not.toHaveBeenCalled();
    expect(mockDesasignarAlumnoDeHorario).not.toHaveBeenCalled();
  });

  it("confirming the pending removal saves atomically via actualizarCategoria (not desasignarAlumnoDeHorario, which would unenroll Ana from every OTHER día of the categoría too)", async () => {
    mockFetchAlumnosPorHorario.mockResolvedValue([
      { id: 1, personaId: 10, personaNombreCompleto: "Ana Pérez", horarioId: 303, horarioDia: "MIERCOLES", horarioHoraInicio: "18:00", horarioHoraFin: "20:00", fechaAsignacion: "2026-01-01" },
    ]);
    await openEditAndSubmit();

    fireEvent.click(screen.getByRole("checkbox", { name: "Miércoles" }));
    fireEvent.click(screen.getByRole("button", { name: /guardar cambios/i }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /confirmar/i }));

    await waitFor(() => {
      expect(mockActualizarCategoria).toHaveBeenCalledWith(
        "COMPETITIVO",
        expect.objectContaining({ dias: ["LUNES"] }),
      );
    });
    expect(mockDesasignarAlumnoDeHorario).not.toHaveBeenCalled();
  });

  it("stays open and shows the server's message instead of closing/resyncing when the save fails (fully atomic: nothing was written)", async () => {
    mockActualizarCategoria.mockRejectedValue(new ApiClientError("La categoría ya tiene ese nombre.", 400));
    await openEditAndSubmit();

    fireEvent.click(screen.getByRole("button", { name: /guardar cambios/i }));

    expect(await screen.findByText("La categoría ya tiene ese nombre.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Editar categoría" })).toBeInTheDocument();
    expect(mockFetchHorarios).toHaveBeenCalledTimes(1); // only the initial load — no resync on failure.
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
    // Scoped to the horarios list container — excludes the "Nueva categoría"
    // create-form wrapper, which reuses the same "card p-5" classes but is a
    // sibling before the list, not a group card.
    return screen.getAllByTestId("horario-card");
  }

  it("renders the edit form inline under the card being edited, not at a fixed page position", async () => {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();

    const [cardA] = cards();
    fireEvent.click(within(cardA).getByRole("button", { name: /^editar /i }));

    const heading = await screen.findByRole("heading", { name: "Editar categoría" });
    expect(cardA.contains(heading)).toBe(true);
  });

  it("expanding group B's edit form collapses group A's — only one group expanded at a time", async () => {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();

    const [cardA, cardB] = cards();
    fireEvent.click(within(cardA).getByRole("button", { name: /^editar /i }));
    await screen.findByRole("heading", { name: "Editar categoría" });
    expect(within(cardA).getByRole("heading", { name: "Editar categoría" })).toBeInTheDocument();

    fireEvent.click(within(cardB).getByRole("button", { name: /^editar /i }));
    await waitFor(() => {
      expect(within(cardB).getByRole("heading", { name: "Editar categoría" })).toBeInTheDocument();
    });
    expect(within(cardA).queryByRole("heading", { name: "Editar categoría" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "Editar categoría" })).toHaveLength(1);
  });

  it("opening the alumnos panel on group B closes group A's edit form (single accordion across tabs)", async () => {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();

    const [cardA, cardB] = cards();
    fireEvent.click(within(cardA).getByRole("button", { name: /^editar /i }));
    await screen.findByRole("heading", { name: "Editar categoría" });

    fireEvent.click(within(cardB).getByRole("button", { name: /ver alumnos/i }));
    await screen.findByRole("heading", { name: "Alumnos de Competitivo" });

    expect(screen.queryByRole("heading", { name: "Editar categoría" })).not.toBeInTheDocument();
  });

  it("switching tabs on the same group replaces the editar panel with the alumnos panel inline", async () => {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();

    const [cardA] = cards();
    fireEvent.click(within(cardA).getByRole("button", { name: /^editar /i }));
    await screen.findByRole("heading", { name: "Editar categoría" });

    fireEvent.click(within(cardA).getByRole("button", { name: /ver alumnos/i }));
    const alumnosHeading = await screen.findByRole("heading", { name: "Alumnos de Formativo" });
    expect(cardA.contains(alumnosHeading)).toBe(true);
    expect(screen.queryByRole("heading", { name: "Editar categoría" })).not.toBeInTheDocument();
  });

  it("the 'Nueva categoría' create form is not nested inside any existing group card", async () => {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();

    fireEvent.click(screen.getByRole("button", { name: /nueva categoría/i }));
    const heading = await screen.findByRole("heading", { name: "Nueva categoría" });

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

  it("shows a non-blocking overdue-membership warning without failing the assignment (INS-6)", async () => {
    mockFetchMembers.mockResolvedValue({ accounts: [ASSIGNABLE_ACCOUNT] });
    mockAsignarAlumnoAHorario.mockResolvedValue({
      asignaciones: [],
      membresiaVencida: true,
      diasVencida: 14,
    });
    render(
      <ToastProvider>
        <GroupsPage />
        <ToastContainer />
      </ToastProvider>,
    );
    await waitForHorarios();

    const [multiDiaCard] = cards();
    fireEvent.click(within(multiDiaCard).getByRole("button", { name: /ver alumnos/i }));
    await screen.findByRole("heading", { name: "Alumnos de Formativo" });
    await waitFor(() => expect(mockFetchAlumnosPorHorario).toHaveBeenCalledWith(602));

    fireEvent.change(screen.getByLabelText("Seleccionar alumno"), { target: { value: "70" } });
    fireEvent.click(screen.getByRole("button", { name: /^asignar$/i }));

    // The assignment itself still succeeds -- the warning rides alongside
    // the success toast, it never replaces it. Two success surfaces now
    // render the same text (the page's own banner AND the toast), so this
    // asserts presence rather than a single unique match.
    expect((await screen.findAllByText(/asignado correctamente/i)).length).toBeGreaterThan(0);
    expect(
      await screen.findByText("Diego Vega tiene la cuota vencida hace 14 días."),
    ).toBeInTheDocument();
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
      await screen.findByText("Tuvimos un problema de nuestro lado y no pudimos completar esto. Escríbanos por WhatsApp y lo ayudamos: https://wa.me/593994219619"),
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
      await screen.findByText("Tuvimos un problema de nuestro lado y no pudimos completar esto. Escríbanos por WhatsApp y lo ayudamos: https://wa.me/593994219619"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Alumno desasignado del horario.")).not.toBeInTheDocument();
  });
});

describe("GroupsPage — deleting removes the categoría entera atomically (docs/archive/fixes/24-abm-categorias.md)", () => {
  /** The delete action lives inside the edit panel (`15-horario-editar.html`),
   *  not on the card, because it removes every weekday of the categoría. */
  async function openDeleteFromEditPanel(): Promise<void> {
    fireEvent.click(screen.getAllByRole("button", { name: /^editar /i })[0]);
    await screen.findByRole("heading", { name: "Editar categoría" });
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
    mockEliminarCategoria.mockReset();
    mockFetchAlumnosPorHorario.mockReset();
    mockDesasignarAlumnoDeHorario.mockReset();
    mockFetchMembers.mockResolvedValue({ accounts: [] });
    mockFetchHorarios.mockResolvedValue(GROUP_ROWS);
    mockEliminarCategoria.mockResolvedValue(undefined);
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
    expect(mockEliminarCategoria).not.toHaveBeenCalled();
  });

  it("confirming deletes the categoría with ONE eliminarCategoria call (not desasignarAlumnoDeHorario)", async () => {
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
      expect(mockEliminarCategoria).toHaveBeenCalledWith("COMPETITIVO");
    });
    expect(mockEliminarCategoria).toHaveBeenCalledTimes(1);
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
    expect(mockEliminarCategoria).not.toHaveBeenCalled();
    expect(mockFetchHorarios).not.toHaveBeenCalled();
  });

  it("shows the server's message and does not remove the card when eliminarCategoria is blocked (real Asistencia history)", async () => {
    mockFetchAlumnosPorHorario.mockResolvedValue([]);
    mockEliminarCategoria.mockRejectedValue(
      new ApiClientError(
        'No se puede eliminar la categoría "Competitivo": el día lunes tiene asistencias registradas. El historial no se borra.',
        400,
      ),
    );
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();

    await openDeleteFromEditPanel();
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /confirmar/i }));

    expect(
      await screen.findByText(/el historial no se borra/i),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("horario-card")).toHaveLength(1);
  });
});

// "save resyncs local state after a mid-sequence failure" died with the
// per-día diff loop it guarded: `submitCategoria` is now ONE atomic backend
// call, so there is no mid-sequence to fail partway through — see "stays
// open and shows the server's message instead of closing/resyncing when the
// save fails" in the "atomic categoría save" describe block above, which
// replaces this guard for the new (impossible-to-partially-fail) shape.

describe("GroupsPage — sin selector de entrenador (issue #13)", () => {
  const GROUP_ROWS = [
    { id: 301, diaSemana: "LUNES", horaInicio: "18:00", horaFin: "20:00", categoria: "COMPETITIVO" },
  ];

  beforeEach(() => {
    mockFetchMembers.mockReset();
    mockFetchHorarios.mockReset();
    mockCrearCategoria.mockReset();
    mockFetchMembers.mockResolvedValue({ accounts: [] });
    mockFetchHorarios.mockResolvedValue(GROUP_ROWS);
    mockCrearCategoria.mockResolvedValue({});
  });

  it("the create form has no Entrenador field — the relation is gone", async () => {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();
    fireEvent.click(screen.getByRole("button", { name: /nueva categoría/i }));

    await screen.findByRole("heading", { name: "Nueva categoría" });
    expect(screen.queryByLabelText("Entrenador")).not.toBeInTheDocument();
  });

  it("creating a new categoría submits nombre, franja and días — no entrenador, no categoria code typed by hand", async () => {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();
    fireEvent.click(screen.getByRole("button", { name: /nueva categoría/i }));

    fireEvent.change(screen.getByLabelText(/^Nombre/), { target: { value: "Preinfantil" } });
    fireEvent.change(screen.getByLabelText(/^Hora de inicio/), { target: { value: "15:00" } });
    fireEvent.change(screen.getByLabelText(/^Hora de fin/), { target: { value: "16:00" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Lunes" }));
    fireEvent.click(screen.getByRole("button", { name: /crear categoría/i }));

    await waitFor(() => {
      expect(mockCrearCategoria).toHaveBeenCalledWith({
        nombre: "Preinfantil", hora_inicio: "15:00", hora_fin: "16:00", dias: ["LUNES"],
      });
    });
  });

  it("editing an existing categoría opens the form without any trainer field", async () => {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await waitForHorarios();
    fireEvent.click(screen.getAllByRole("button", { name: /^editar /i })[0]);

    await screen.findByRole("heading", { name: "Editar categoría" });
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
