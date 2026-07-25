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
import type { NivelConOcupacion } from "@/services/api";
import type { MemberAccount } from "@/app/members/members-utils";
import { ToastProvider } from "@/contexts/ToastContext";

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
const mockAssignStudentToNivel = vi.fn();
const mockMoveStudentToNivel = vi.fn();
const mockFetchNotificaciones = vi.fn().mockResolvedValue([]);
const mockMarcarNotificacionLeida = vi.fn().mockResolvedValue(undefined);
const mockFetchHorarios = vi.fn().mockResolvedValue([]);
const mockFetchNivelesConOcupacion = vi.fn().mockResolvedValue([]);
const mockCrearHorario = vi.fn();
const mockActualizarHorario = vi.fn();
const mockEliminarHorario = vi.fn();
const mockFetchAlumnosPorHorario = vi.fn().mockResolvedValue([]);
const mockAsignarAlumnoAHorario = vi.fn();
const mockDesasignarAlumnoDeHorario = vi.fn();
const mockFetchEntrenadores = vi.fn();

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
    fetchNotificaciones: () => mockFetchNotificaciones(),
    marcarNotificacionLeida: (id: number) => mockMarcarNotificacionLeida(id),
    fetchHorarios: () => mockFetchHorarios(),
    fetchNivelesConOcupacion: () => mockFetchNivelesConOcupacion(),
    crearHorario: (dto: unknown) => mockCrearHorario(dto),
    actualizarHorario: (id: number, dto: unknown) => mockActualizarHorario(id, dto),
    eliminarHorario: (id: number) => mockEliminarHorario(id),
    fetchAlumnosPorHorario: (horarioId: number) => mockFetchAlumnosPorHorario(horarioId),
    asignarAlumnoAHorario: (dto: unknown) => mockAsignarAlumnoAHorario(dto),
    desasignarAlumnoDeHorario: (personaId: number, horarioId: number) => mockDesasignarAlumnoDeHorario(personaId, horarioId),
    fetchEntrenadores: () => mockFetchEntrenadores(),
    ApiClientError: MockApiClientError,
  };
});

// Default entrenador list covers every `entrenadorId` used by fixtures across
// this file's describe blocks (1, 2, 5, 7, 9). Individual tests override this
// via `mockFetchEntrenadores.mockResolvedValue(...)`/`mockReset()` when they
// need to assert on the empty/loading dropdown states specifically.
const DEFAULT_ENTRENADORES = [
  { id: 1, nombreCompleto: "Entrenador Uno" },
  { id: 2, nombreCompleto: "Entrenador Dos" },
  { id: 5, nombreCompleto: "Entrenador Cinco" },
  { id: 7, nombreCompleto: "Entrenador Siete" },
  { id: 9, nombreCompleto: "Entrenador Nueve" },
];

beforeEach(() => {
  mockFetchEntrenadores.mockReset();
  mockFetchEntrenadores.mockResolvedValue(DEFAULT_ENTRENADORES);
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

const UNASSIGNED_ACCOUNT: MemberAccount = {
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
  ],
};

async function findUnassignedRow(): Promise<HTMLElement> {
  const heading = await screen.findByText(/^estudiantes sin grupo/i);
  const section = heading.closest("div.card") as HTMLElement;
  return within(section).getByText("Sofía González").closest("div.card-hover") as HTMLElement;
}

describe.skip("GroupsPage — unassigned dropdown assign (MOVED to RankingPage — issue #43)", () => {
  beforeEach(() => {
    mockFetchMembers.mockReset();
    mockAssignStudentToNivel.mockReset();
    mockMoveStudentToNivel.mockReset();
    mockFetchMembers.mockResolvedValue({ accounts: [UNASSIGNED_ACCOUNT], niveles: NIVELES });
    mockAssignStudentToNivel.mockResolvedValue(undefined);
  });

  it("renders one dropdown + Asignar button per unassigned student, not one button per nivel", async () => {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    const row = await findUnassignedRow();

    const select = within(row).getByRole("combobox");
    const buttons = within(row).getAllByRole("button");

    // Exactly one select (not N buttons — one per nivel) and one Asignar button.
    expect(select).toBeInTheDocument();
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveTextContent(/asignar/i);
  });

  it("fires handleAssignStudent's mutation with the nivel picked from the dropdown", async () => {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    const row = await findUnassignedRow();

    const select = within(row).getByRole("combobox");
    fireEvent.change(select, { target: { value: "2" } });
    fireEvent.click(within(row).getByRole("button", { name: /asignar/i }));

    await waitFor(() => {
      expect(mockAssignStudentToNivel).toHaveBeenCalledWith(10, 2);
    });
  });

  it("disables the Asignar button until a nivel is picked", async () => {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    const row = await findUnassignedRow();

    const assignButton = within(row).getByRole("button", { name: /asignar/i });
    expect(assignButton).toBeDisabled();

    const select = within(row).getByRole("combobox");
    fireEvent.change(select, { target: { value: "1" } });
    expect(assignButton).toBeEnabled();
  });
});

describe("GroupsPage — categoria-driven locked schedule form (v2 design)", () => {
  beforeEach(() => {
    mockFetchMembers.mockReset();
    mockFetchHorarios.mockReset();
    mockFetchNivelesConOcupacion.mockReset();
    mockFetchMembers.mockResolvedValue({ accounts: [], niveles: NIVELES });
    mockFetchHorarios.mockResolvedValue([]);
    mockFetchNivelesConOcupacion.mockResolvedValue(NIVELES);
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
    await screen.findByText(/horarios de entrenamiento/i);
    fireEvent.click(screen.getByRole("button", { name: /nuevo horario/i }));

    fireEvent.change(screen.getByLabelText(/categoría/i), { target: { value: "COMPETITIVO" } });

    expect(screen.getByText("18:00 – 20:00")).toBeInTheDocument();
    expect(screen.getByLabelText("Sábado")).toBeInTheDocument();
  });

  it("locks the displayed time range to FORMATIVO's 15:00–16:00 and excludes Sábado from día checkboxes", async () => {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await screen.findByText(/horarios de entrenamiento/i);
    fireEvent.click(screen.getByRole("button", { name: /nuevo horario/i }));

    fireEvent.change(screen.getByLabelText(/categoría/i), { target: { value: "FORMATIVO" } });

    expect(screen.getByText("15:00 – 16:00")).toBeInTheDocument();
    expect(screen.queryByLabelText("Sábado")).not.toBeInTheDocument();
  });

  it("has no editable hora_inicio/hora_fin time inputs left in the form (locked, not freeform)", async () => {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await screen.findByText(/horarios de entrenamiento/i);
    fireEvent.click(screen.getByRole("button", { name: /nuevo horario/i }));

    expect(screen.queryByLabelText(/hora inicio/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/hora fin/i)).not.toBeInTheDocument();
  });
});

describe("GroupsPage — grouped weekly schedule display (PR2a)", () => {
  beforeEach(() => {
    mockFetchMembers.mockReset();
    mockFetchHorarios.mockReset();
    mockFetchNivelesConOcupacion.mockReset();
    mockFetchMembers.mockResolvedValue({ accounts: [], niveles: NIVELES });
    mockFetchNivelesConOcupacion.mockResolvedValue(NIVELES);
  });

  it("collapses 3 recurring rows (same categoria/horario/entrenador/nivel) into 1 card with 3 day badges", async () => {
    mockFetchHorarios.mockResolvedValue([
      { id: 101, diaSemana: "LUNES", horaInicio: "18:00", horaFin: "20:00", categoria: "COMPETITIVO", entrenadorId: 1, nivelRankingId: 2 },
      { id: 102, diaSemana: "MIERCOLES", horaInicio: "18:00", horaFin: "20:00", categoria: "COMPETITIVO", entrenadorId: 1, nivelRankingId: 2 },
      { id: 103, diaSemana: "VIERNES", horaInicio: "18:00", horaFin: "20:00", categoria: "COMPETITIVO", entrenadorId: 1, nivelRankingId: 2 },
    ]);

    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await screen.findByText(/horarios de entrenamiento/i);

    const cards = document.querySelectorAll(".card.p-5");
    expect(cards).toHaveLength(1);

    const card = cards[0] as HTMLElement;
    expect(within(card).getByText("Lun")).toBeInTheDocument();
    expect(within(card).getByText("Mié")).toBeInTheDocument();
    expect(within(card).getByText("Vie")).toBeInTheDocument();
    expect(within(card).getByText("18:00 – 20:00")).toBeInTheDocument();
  });

  it("keeps rows with a different entrenador_id in separate cards", async () => {
    mockFetchHorarios.mockResolvedValue([
      { id: 201, diaSemana: "LUNES", horaInicio: "15:00", horaFin: "16:00", categoria: "FORMATIVO", entrenadorId: 1, nivelRankingId: null },
      { id: 202, diaSemana: "LUNES", horaInicio: "15:00", horaFin: "16:00", categoria: "FORMATIVO", entrenadorId: 2, nivelRankingId: null },
    ]);

    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await screen.findByText(/horarios de entrenamiento/i);

    const cards = document.querySelectorAll(".card.p-5");
    expect(cards).toHaveLength(2);
    // both cards render exactly one "Lun" badge each (not merged into one card)
    const lunBadges = screen.getAllByText("Lun");
    expect(lunBadges).toHaveLength(2);
  });
});

describe("GroupsPage — categoria title + labeled Ver alumnos button (PR1 layout/UX fixes)", () => {
  beforeEach(() => {
    mockFetchMembers.mockReset();
    mockFetchHorarios.mockReset();
    mockFetchNivelesConOcupacion.mockReset();
    mockFetchMembers.mockResolvedValue({ accounts: [], niveles: NIVELES });
    mockFetchHorarios.mockResolvedValue([
      { id: 801, diaSemana: "LUNES", horaInicio: "18:00", horaFin: "20:00", categoria: "COMPETITIVO", entrenadorId: 1, nivelRankingId: 2 },
    ]);
    mockFetchNivelesConOcupacion.mockResolvedValue(NIVELES);
  });

  function card(): HTMLElement {
    return document.querySelector(".space-y-3 > .card.p-5") as HTMLElement;
  }

  it("shows the categoria label instead of the nivel line", async () => {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await screen.findByText(/horarios de entrenamiento/i);

    expect(within(card()).getByText("Competitivo")).toBeInTheDocument();
    expect(within(card()).queryByText(/sin nivel asignado/i)).not.toBeInTheDocument();
    expect(within(card()).queryByText(/nivel intermedio/i)).not.toBeInTheDocument();
  });

  it("renders 'Ver alumnos' as a labeled button that calls openAlumnosTab (opens the alumnos panel)", async () => {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await screen.findByText(/horarios de entrenamiento/i);

    const verAlumnosButton = within(card()).getByRole("button", { name: /ver alumnos/i });
    expect(verAlumnosButton).toHaveTextContent(/ver alumnos/i);

    fireEvent.click(verAlumnosButton);
    await screen.findByRole("heading", { name: "Asignar alumnos al horario" });
  });
});

describe("GroupsPage — unknown categoria value does not crash the card (bugfix)", () => {
  beforeEach(() => {
    mockFetchMembers.mockReset();
    mockFetchHorarios.mockReset();
    mockFetchNivelesConOcupacion.mockReset();
    mockFetchMembers.mockResolvedValue({ accounts: [], niveles: NIVELES });
    mockFetchHorarios.mockResolvedValue([
      { id: 901, diaSemana: "LUNES", horaInicio: "18:00", horaFin: "20:00", categoria: "NO_EXISTE", entrenadorId: 1, nivelRankingId: 2 },
    ]);
    mockFetchNivelesConOcupacion.mockResolvedValue(NIVELES);
  });

  it("falls back to DEFAULT_CATEGORIA's label instead of crashing when categoria doesn't match any known key", async () => {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await screen.findByText(/horarios de entrenamiento/i);

    expect(screen.getByText("Formativo")).toBeInTheDocument();
  });
});

describe("GroupsPage — day-diffing unified save (PR2b)", () => {
  const GROUP_ROWS = [
    { id: 301, diaSemana: "LUNES", horaInicio: "18:00", horaFin: "20:00", categoria: "COMPETITIVO", entrenadorId: 7, nivelRankingId: 2 },
    { id: 303, diaSemana: "MIERCOLES", horaInicio: "18:00", horaFin: "20:00", categoria: "COMPETITIVO", entrenadorId: 7, nivelRankingId: 2 },
  ];

  beforeEach(() => {
    mockFetchMembers.mockReset();
    mockFetchHorarios.mockReset();
    mockFetchNivelesConOcupacion.mockReset();
    mockCrearHorario.mockReset();
    mockActualizarHorario.mockReset();
    mockEliminarHorario.mockReset();
    mockFetchAlumnosPorHorario.mockReset();
    mockDesasignarAlumnoDeHorario.mockReset();
    mockFetchMembers.mockResolvedValue({ accounts: [], niveles: NIVELES });
    mockFetchHorarios.mockResolvedValue(GROUP_ROWS);
    mockFetchNivelesConOcupacion.mockResolvedValue(NIVELES);
    mockCrearHorario.mockResolvedValue({});
    mockActualizarHorario.mockResolvedValue({});
    mockEliminarHorario.mockResolvedValue(undefined);
    mockFetchAlumnosPorHorario.mockResolvedValue([]);
    mockDesasignarAlumnoDeHorario.mockResolvedValue(undefined);
  });

  async function openEditAndSubmit(): Promise<void> {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await screen.findByText(/horarios de entrenamiento/i);
    fireEvent.click(screen.getByRole("button", { name: /editar horario/i }));
    await screen.findByRole("heading", { name: "Editar Horario" });
  }

  it("ticking a new día creates a row and updates the kept días' shared fields on submit", async () => {
    await openEditAndSubmit();

    fireEvent.click(screen.getByLabelText("Viernes"));
    fireEvent.click(screen.getByRole("button", { name: /guardar cambios/i }));

    await waitFor(() => {
      expect(mockCrearHorario).toHaveBeenCalledWith(
        expect.objectContaining({ dia_semana: "VIERNES", categoria: "COMPETITIVO", entrenador_id: 7, nivel_ranking_id: 2 }),
      );
    });
    expect(mockActualizarHorario).toHaveBeenCalledWith(301, expect.objectContaining({ categoria: "COMPETITIVO", entrenador_id: 7, nivel_ranking_id: 2 }));
    expect(mockActualizarHorario).toHaveBeenCalledWith(303, expect.objectContaining({ categoria: "COMPETITIVO", entrenador_id: 7, nivel_ranking_id: 2 }));
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

  it("confirming the pending deletion desasigna every enrolled student before eliminarHorario", async () => {
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
    expect(mockDesasignarAlumnoDeHorario).toHaveBeenCalledWith(10, 303);
    const desasignarOrder = mockDesasignarAlumnoDeHorario.mock.invocationCallOrder[0];
    const eliminarOrder = mockEliminarHorario.mock.invocationCallOrder[0];
    expect(desasignarOrder).toBeLessThan(eliminarOrder);
  });
});

describe("GroupsPage — accordion single-expand mechanics (PR3a)", () => {
  const GROUPS = [
    { id: 401, diaSemana: "LUNES", horaInicio: "15:00", horaFin: "16:00", categoria: "FORMATIVO", entrenadorId: 1, nivelRankingId: null },
    { id: 402, diaSemana: "LUNES", horaInicio: "15:00", horaFin: "16:00", categoria: "FORMATIVO", entrenadorId: 2, nivelRankingId: null },
  ];

  beforeEach(() => {
    mockFetchMembers.mockReset();
    mockFetchHorarios.mockReset();
    mockFetchNivelesConOcupacion.mockReset();
    mockFetchAlumnosPorHorario.mockReset();
    mockFetchMembers.mockResolvedValue({ accounts: [], niveles: NIVELES });
    mockFetchHorarios.mockResolvedValue(GROUPS);
    mockFetchNivelesConOcupacion.mockResolvedValue(NIVELES);
    mockFetchAlumnosPorHorario.mockResolvedValue([]);
  });

  function cards(): HTMLElement[] {
    // Scoped to the horarios list container — excludes the "Nuevo Horario"
    // create-form wrapper, which reuses the same "card p-5" classes but is a
    // sibling before the list, not a group card.
    return Array.from(document.querySelectorAll(".space-y-3 > .card.p-5")) as HTMLElement[];
  }

  it("renders the edit form inline under the card being edited, not at a fixed page position", async () => {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await screen.findByText(/horarios de entrenamiento/i);

    const [cardA] = cards();
    fireEvent.click(within(cardA).getByTitle("Editar horario"));

    const heading = await screen.findByRole("heading", { name: "Editar Horario" });
    expect(cardA.contains(heading)).toBe(true);
  });

  it("expanding group B's edit form collapses group A's — only one group expanded at a time", async () => {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await screen.findByText(/horarios de entrenamiento/i);

    const [cardA, cardB] = cards();
    fireEvent.click(within(cardA).getByTitle("Editar horario"));
    await screen.findByRole("heading", { name: "Editar Horario" });
    expect(within(cardA).getByRole("heading", { name: "Editar Horario" })).toBeInTheDocument();

    fireEvent.click(within(cardB).getByTitle("Editar horario"));
    await waitFor(() => {
      expect(within(cardB).getByRole("heading", { name: "Editar Horario" })).toBeInTheDocument();
    });
    expect(within(cardA).queryByRole("heading", { name: "Editar Horario" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "Editar Horario" })).toHaveLength(1);
  });

  it("opening the alumnos panel on group B closes group A's edit form (single accordion across tabs)", async () => {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await screen.findByText(/horarios de entrenamiento/i);

    const [cardA, cardB] = cards();
    fireEvent.click(within(cardA).getByTitle("Editar horario"));
    await screen.findByRole("heading", { name: "Editar Horario" });

    fireEvent.click(within(cardB).getByRole("button", { name: /ver alumnos/i }));
    await screen.findByRole("heading", { name: "Asignar alumnos al horario" });

    expect(screen.queryByRole("heading", { name: "Editar Horario" })).not.toBeInTheDocument();
  });

  it("switching tabs on the same group replaces the editar panel with the alumnos panel inline", async () => {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await screen.findByText(/horarios de entrenamiento/i);

    const [cardA] = cards();
    fireEvent.click(within(cardA).getByTitle("Editar horario"));
    await screen.findByRole("heading", { name: "Editar Horario" });

    fireEvent.click(within(cardA).getByRole("button", { name: /ver alumnos/i }));
    const alumnosHeading = await screen.findByRole("heading", { name: "Asignar alumnos al horario" });
    expect(cardA.contains(alumnosHeading)).toBe(true);
    expect(screen.queryByRole("heading", { name: "Editar Horario" })).not.toBeInTheDocument();
  });

  it("the 'Nuevo Horario' create form is not nested inside any existing group card", async () => {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await screen.findByText(/horarios de entrenamiento/i);

    fireEvent.click(screen.getByRole("button", { name: /nuevo horario/i }));
    const heading = await screen.findByRole("heading", { name: "Nuevo Horario" });

    for (const card of cards()) {
      expect(card.contains(heading)).toBe(false);
    }
  });
});

describe("GroupsPage — grupo-level roster: union across días, assign/unassign to every día (bugfix)", () => {
  const MULTI_DIA_GROUP_ROWS = [
    { id: 601, diaSemana: "LUNES", horaInicio: "15:00", horaFin: "16:00", categoria: "FORMATIVO", entrenadorId: 1, nivelRankingId: 2 },
    { id: 602, diaSemana: "MIERCOLES", horaInicio: "15:00", horaFin: "16:00", categoria: "FORMATIVO", entrenadorId: 1, nivelRankingId: 2 },
  ];
  const SINGLE_DIA_ROW = { id: 603, diaSemana: "VIERNES", horaInicio: "15:00", horaFin: "16:00", categoria: "FORMATIVO", entrenadorId: 9, nivelRankingId: 2 };

  // Nivel-matched (grupoId "2") but NEVER enrolled via AlumnoHorario for any
  // row above — proves the roster is sourced from fetchAlumnosPorHorario, not
  // from nivel/grupoId matching against the general student pool.
  const NIVEL_MATCH_UNENROLLED_ACCOUNT: MemberAccount = {
    id: "acc-nivel-match",
    role: "representante",
    nombres: "Carla",
    apellidos: "Ruiz",
    telefono: "0999999999",
    estudiantes: [
      { id: "50", nombres: "Carla", apellidos: "Ruiz", grupoId: "2", activo: true, membresia: null, ultimoPago: null },
    ],
  };

  const ASSIGNABLE_ACCOUNT: MemberAccount = {
    id: "acc-assignable",
    role: "representante",
    nombres: "Diego",
    apellidos: "Vega",
    telefono: "0999999999",
    estudiantes: [
      { id: "70", nombres: "Diego", apellidos: "Vega", grupoId: null, activo: true, membresia: null, ultimoPago: null },
    ],
  };

  beforeEach(() => {
    mockFetchMembers.mockReset();
    mockFetchHorarios.mockReset();
    mockFetchNivelesConOcupacion.mockReset();
    mockFetchAlumnosPorHorario.mockReset();
    mockAsignarAlumnoAHorario.mockReset();
    mockDesasignarAlumnoDeHorario.mockReset();
    mockFetchHorarios.mockResolvedValue([...MULTI_DIA_GROUP_ROWS, SINGLE_DIA_ROW]);
    mockFetchNivelesConOcupacion.mockResolvedValue(NIVELES);
    mockFetchMembers.mockResolvedValue({ accounts: [NIVEL_MATCH_UNENROLLED_ACCOUNT], niveles: NIVELES });
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
    return Array.from(document.querySelectorAll(".space-y-3 > .card.p-5")) as HTMLElement[];
  }

  it("does not render a nivel-filtered roster block outside the accordion", async () => {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await screen.findByText(/horarios de entrenamiento/i);

    expect(screen.queryByText("Alumnos asignados")).not.toBeInTheDocument();
    expect(screen.queryByText("Carla Ruiz")).not.toBeInTheDocument();
  });

  it("shows each student's age next to their name in the roster (Fix 1)", async () => {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await screen.findByText(/horarios de entrenamiento/i);

    const [multiDiaCard] = cards();
    fireEvent.click(within(multiDiaCard).getByRole("button", { name: /ver alumnos/i }));
    await screen.findByRole("heading", { name: "Asignar alumnos al horario" });

    expect(await screen.findByText("Ana Pérez · 12 años")).toBeInTheDocument();
    expect(await screen.findByText("Bruno Díaz · 15 años")).toBeInTheDocument();
  });

  it("renders the deduplicated union of every día's roster, not just one día (bugfix)", async () => {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await screen.findByText(/horarios de entrenamiento/i);

    const [multiDiaCard] = cards();
    fireEvent.click(within(multiDiaCard).getByRole("button", { name: /ver alumnos/i }));
    await screen.findByRole("heading", { name: "Asignar alumnos al horario" });

    await waitFor(() => expect(mockFetchAlumnosPorHorario).toHaveBeenCalledWith(601));
    await waitFor(() => expect(mockFetchAlumnosPorHorario).toHaveBeenCalledWith(602));

    // Ana (personaId 20) appears on both LUNES and MIERCOLES rows but only
    // once in the rendered roster — deduplicated by personaId.
    expect(await screen.findByText("Alumnos asignados (2)")).toBeInTheDocument();
    expect(screen.getAllByText("Ana Pérez · 12 años")).toHaveLength(1);
    expect(screen.getByText("Bruno Díaz · 15 años")).toBeInTheDocument();
  });

  it("no longer renders a día-pill selector — assignment acts on the whole grupo now", async () => {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await screen.findByText(/horarios de entrenamiento/i);

    const [multiDiaCard] = cards();
    fireEvent.click(within(multiDiaCard).getByRole("button", { name: /ver alumnos/i }));
    await screen.findByRole("heading", { name: "Asignar alumnos al horario" });

    expect(screen.queryByRole("button", { name: "Lun" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mié" })).not.toBeInTheDocument();
  });

  it("assigning a student calls asignarAlumnoAHorario once per horario_id row of the group", async () => {
    mockFetchMembers.mockResolvedValue({ accounts: [ASSIGNABLE_ACCOUNT], niveles: NIVELES });
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await screen.findByText(/horarios de entrenamiento/i);

    const [multiDiaCard] = cards();
    fireEvent.click(within(multiDiaCard).getByRole("button", { name: /ver alumnos/i }));
    await screen.findByRole("heading", { name: "Asignar alumnos al horario" });
    await waitFor(() => expect(mockFetchAlumnosPorHorario).toHaveBeenCalledWith(602));

    fireEvent.change(screen.getByLabelText("Seleccionar alumno"), { target: { value: "70" } });
    fireEvent.click(screen.getByRole("button", { name: /^asignar$/i }));

    await waitFor(() => {
      expect(mockAsignarAlumnoAHorario).toHaveBeenCalledWith({ persona_id: 70, horario_id: 601 });
      expect(mockAsignarAlumnoAHorario).toHaveBeenCalledWith({ persona_id: 70, horario_id: 602 });
    });
    expect(mockAsignarAlumnoAHorario).toHaveBeenCalledTimes(2);
  });

  it("assigning tolerates a per-row 400 (already assigned to that día) and still reports success if any row assigned", async () => {
    mockFetchMembers.mockResolvedValue({ accounts: [ASSIGNABLE_ACCOUNT], niveles: NIVELES });
    mockAsignarAlumnoAHorario.mockImplementation((dto: { horario_id: number }) =>
      dto.horario_id === 601
        ? Promise.reject(new ApiClientError("El alumno ya está asignado al horario.", 400))
        : Promise.resolve({}),
    );
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await screen.findByText(/horarios de entrenamiento/i);

    const [multiDiaCard] = cards();
    fireEvent.click(within(multiDiaCard).getByRole("button", { name: /ver alumnos/i }));
    await screen.findByRole("heading", { name: "Asignar alumnos al horario" });
    await waitFor(() => expect(mockFetchAlumnosPorHorario).toHaveBeenCalledWith(602));

    fireEvent.change(screen.getByLabelText("Seleccionar alumno"), { target: { value: "70" } });
    fireEvent.click(screen.getByRole("button", { name: /^asignar$/i }));

    await waitFor(() => {
      expect(mockAsignarAlumnoAHorario).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText(/asignado correctamente/i)).toBeInTheDocument();
  });

  it("shows a real error (not a false success) when every row fails with a non-400 error while assigning", async () => {
    mockFetchMembers.mockResolvedValue({ accounts: [ASSIGNABLE_ACCOUNT], niveles: NIVELES });
    mockAsignarAlumnoAHorario.mockRejectedValue(new ApiClientError("Error de red al asignar el alumno.", 500));
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await screen.findByText(/horarios de entrenamiento/i);

    const [multiDiaCard] = cards();
    fireEvent.click(within(multiDiaCard).getByRole("button", { name: /ver alumnos/i }));
    await screen.findByRole("heading", { name: "Asignar alumnos al horario" });
    await waitFor(() => expect(mockFetchAlumnosPorHorario).toHaveBeenCalledWith(602));

    fireEvent.change(screen.getByLabelText("Seleccionar alumno"), { target: { value: "70" } });
    fireEvent.click(screen.getByRole("button", { name: /^asignar$/i }));

    await waitFor(() => {
      expect(mockAsignarAlumnoAHorario).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText("Error de red al asignar el alumno.")).toBeInTheDocument();
    expect(screen.queryByText(/asignado correctamente/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/ya estaba asignado a este horario/i)).not.toBeInTheDocument();
  });

  it("desasignating a student calls desasignarAlumnoDeHorario once per horario_id row of the group", async () => {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await screen.findByText(/horarios de entrenamiento/i);

    const [multiDiaCard] = cards();
    fireEvent.click(within(multiDiaCard).getByRole("button", { name: /ver alumnos/i }));
    await screen.findByRole("heading", { name: "Asignar alumnos al horario" });
    await waitFor(() => expect(mockFetchAlumnosPorHorario).toHaveBeenCalledWith(602));

    const anaRow = (await screen.findByText("Ana Pérez · 12 años")).closest("div") as HTMLElement;
    fireEvent.click(within(anaRow).getByTitle("Desasignar alumno"));

    await waitFor(() => {
      expect(mockDesasignarAlumnoDeHorario).toHaveBeenCalledWith(20, 601);
      expect(mockDesasignarAlumnoDeHorario).toHaveBeenCalledWith(20, 602);
    });
    expect(mockDesasignarAlumnoDeHorario).toHaveBeenCalledTimes(2);
    expect(await screen.findByText("Alumno desasignado del horario.")).toBeInTheDocument();
  });

  it("shows a real error (not a false success) when every row fails with a non-404 error while desasignating", async () => {
    mockDesasignarAlumnoDeHorario.mockRejectedValue(new ApiClientError("Error de red al desasignar el alumno.", 500));
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await screen.findByText(/horarios de entrenamiento/i);

    const [multiDiaCard] = cards();
    fireEvent.click(within(multiDiaCard).getByRole("button", { name: /ver alumnos/i }));
    await screen.findByRole("heading", { name: "Asignar alumnos al horario" });
    await waitFor(() => expect(mockFetchAlumnosPorHorario).toHaveBeenCalledWith(602));

    const anaRow = (await screen.findByText("Ana Pérez · 12 años")).closest("div") as HTMLElement;
    fireEvent.click(within(anaRow).getByTitle("Desasignar alumno"));

    await waitFor(() => {
      expect(mockDesasignarAlumnoDeHorario).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText("Error de red al desasignar el alumno.")).toBeInTheDocument();
    expect(screen.queryByText("Alumno desasignado del horario.")).not.toBeInTheDocument();
  });
});

describe("GroupsPage — trash icon deletes the whole group, not just the first día (bugfix)", () => {
  const GROUP_ROWS = [
    { id: 701, diaSemana: "LUNES", horaInicio: "18:00", horaFin: "20:00", categoria: "COMPETITIVO", entrenadorId: 5, nivelRankingId: 2 },
    { id: 702, diaSemana: "MIERCOLES", horaInicio: "18:00", horaFin: "20:00", categoria: "COMPETITIVO", entrenadorId: 5, nivelRankingId: 2 },
    { id: 703, diaSemana: "VIERNES", horaInicio: "18:00", horaFin: "20:00", categoria: "COMPETITIVO", entrenadorId: 5, nivelRankingId: 2 },
  ];

  beforeEach(() => {
    mockFetchMembers.mockReset();
    mockFetchHorarios.mockReset();
    mockFetchNivelesConOcupacion.mockReset();
    mockEliminarHorario.mockReset();
    mockFetchAlumnosPorHorario.mockReset();
    mockDesasignarAlumnoDeHorario.mockReset();
    mockFetchMembers.mockResolvedValue({ accounts: [], niveles: NIVELES });
    mockFetchHorarios.mockResolvedValue(GROUP_ROWS);
    mockFetchNivelesConOcupacion.mockResolvedValue(NIVELES);
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
    await screen.findByText(/horarios de entrenamiento/i);

    fireEvent.click(screen.getByTitle("Eliminar horario"));

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

  it("confirming deletes EVERY día row and desasigna every enrolled alumno first, across the whole group", async () => {
    mockFetchAlumnosPorHorario.mockImplementation((horarioId: number) => {
      if (horarioId === 701) {
        return Promise.resolve([
          { id: 1, personaId: 10, personaNombreCompleto: "Ana Pérez", horarioId: 701, horarioDia: "LUNES", horarioHoraInicio: "18:00", horarioHoraFin: "20:00", fechaAsignacion: "2026-01-01" },
        ]);
      }
      return Promise.resolve([]);
    });

    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await screen.findByText(/horarios de entrenamiento/i);

    fireEvent.click(screen.getByTitle("Eliminar horario"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /confirmar/i }));

    await waitFor(() => {
      expect(mockEliminarHorario).toHaveBeenCalledWith(701);
      expect(mockEliminarHorario).toHaveBeenCalledWith(702);
      expect(mockEliminarHorario).toHaveBeenCalledWith(703);
    });
    // Only the LUNES row (701) had an enrolled alumno.
    expect(mockDesasignarAlumnoDeHorario).toHaveBeenCalledWith(10, 701);
    expect(mockDesasignarAlumnoDeHorario).toHaveBeenCalledTimes(1);
    const desasignarOrder = mockDesasignarAlumnoDeHorario.mock.invocationCallOrder[0];
    const eliminar701Order = mockEliminarHorario.mock.calls.findIndex((call) => call[0] === 701);
    expect(eliminar701Order).toBeGreaterThanOrEqual(0);
    expect(desasignarOrder).toBeLessThan(mockEliminarHorario.mock.invocationCallOrder[eliminar701Order]);
  });

  it("canceling the confirmation makes no delete calls and does not resync data", async () => {
    mockFetchAlumnosPorHorario.mockResolvedValue([]);
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await screen.findByText(/horarios de entrenamiento/i);
    mockFetchHorarios.mockClear();

    fireEvent.click(screen.getByTitle("Eliminar horario"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /cancelar/i }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockEliminarHorario).not.toHaveBeenCalled();
    expect(mockFetchHorarios).not.toHaveBeenCalled();
  });
});

describe("GroupsPage — save resyncs local state after a mid-sequence failure (bugfix)", () => {
  const GROUP_ROWS = [
    { id: 301, diaSemana: "LUNES", horaInicio: "18:00", horaFin: "20:00", categoria: "COMPETITIVO", entrenadorId: 7, nivelRankingId: 2 },
    { id: 303, diaSemana: "MIERCOLES", horaInicio: "18:00", horaFin: "20:00", categoria: "COMPETITIVO", entrenadorId: 7, nivelRankingId: 2 },
  ];
  // Simulates the backend state AFTER the partial failure: día VIERNES (705)
  // was already created successfully before actualizarHorario(303) rejected.
  const RESYNCED_ROWS = [
    ...GROUP_ROWS,
    { id: 705, diaSemana: "VIERNES", horaInicio: "18:00", horaFin: "20:00", categoria: "COMPETITIVO", entrenadorId: 7, nivelRankingId: 2 },
  ];

  beforeEach(() => {
    mockFetchMembers.mockReset();
    mockFetchHorarios.mockReset();
    mockFetchNivelesConOcupacion.mockReset();
    mockCrearHorario.mockReset();
    mockActualizarHorario.mockReset();
    mockEliminarHorario.mockReset();
    mockFetchAlumnosPorHorario.mockReset();
    mockDesasignarAlumnoDeHorario.mockReset();
    mockFetchMembers.mockResolvedValue({ accounts: [], niveles: NIVELES });
    mockFetchHorarios.mockResolvedValueOnce(GROUP_ROWS).mockResolvedValue(RESYNCED_ROWS);
    mockFetchNivelesConOcupacion.mockResolvedValue(NIVELES);
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
    await screen.findByText(/horarios de entrenamiento/i);
    fireEvent.click(screen.getByRole("button", { name: /editar horario/i }));
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
    fireEvent.click(screen.getByRole("button", { name: /editar horario/i }));
    await screen.findByRole("heading", { name: "Editar Horario" });
    expect(screen.getByLabelText("Viernes")).toBeChecked();
  });
});

describe("GroupsPage — real entrenador dropdown (CRITICAL fix: no arbitrary auto-fill)", () => {
  const GROUP_ROWS = [
    { id: 301, diaSemana: "LUNES", horaInicio: "18:00", horaFin: "20:00", categoria: "COMPETITIVO", entrenadorId: 7, nivelRankingId: 2 },
  ];

  beforeEach(() => {
    mockFetchMembers.mockReset();
    mockFetchHorarios.mockReset();
    mockFetchNivelesConOcupacion.mockReset();
    mockCrearHorario.mockReset();
    mockFetchMembers.mockResolvedValue({ accounts: [], niveles: NIVELES });
    mockFetchHorarios.mockResolvedValue(GROUP_ROWS);
    mockFetchNivelesConOcupacion.mockResolvedValue(NIVELES);
    mockCrearHorario.mockResolvedValue({});
  });

  it("populates the dropdown with real entrenador names, not raw ids", async () => {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await screen.findByText(/horarios de entrenamiento/i);
    fireEvent.click(screen.getByRole("button", { name: /nuevo horario/i }));

    const select = await screen.findByLabelText("Entrenador");
    expect(within(select).getByText("Entrenador Uno")).toBeInTheDocument();
    expect(within(select).getByText("Entrenador Cinco")).toBeInTheDocument();
    expect(within(select).queryByText(/^\d+$/)).not.toBeInTheDocument();
  });

  it("creating a new horario sends the entrenador_id chosen from the dropdown, not an auto-filled value", async () => {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await screen.findByText(/horarios de entrenamiento/i);
    fireEvent.click(screen.getByRole("button", { name: /nuevo horario/i }));

    fireEvent.click(screen.getByLabelText("Lunes"));
    fireEvent.change(await screen.findByLabelText("Entrenador"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /crear horario/i }));

    await waitFor(() => {
      expect(mockCrearHorario).toHaveBeenCalledWith(expect.objectContaining({ entrenador_id: 5 }));
    });
  });

  it("blocks submit and shows a validation message when no entrenador is selected", async () => {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await screen.findByText(/horarios de entrenamiento/i);
    fireEvent.click(screen.getByRole("button", { name: /nuevo horario/i }));

    fireEvent.click(screen.getByLabelText("Lunes"));
    fireEvent.click(screen.getByRole("button", { name: /crear horario/i }));

    expect(await screen.findByText(/seleccion[aá] un entrenador/i)).toBeInTheDocument();
    expect(mockCrearHorario).not.toHaveBeenCalled();
  });

  it("editing an existing horario preselects the group's real entrenador by name, not a raw id input", async () => {
    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await screen.findByText(/horarios de entrenamiento/i);
    fireEvent.click(screen.getByRole("button", { name: /editar horario/i }));

    const select = (await screen.findByLabelText("Entrenador")) as HTMLSelectElement;
    expect(select.value).toBe("7");
    expect(within(select).getByRole("option", { name: "Entrenador Siete", selected: true })).toBeInTheDocument();
  });

  it("reflects the loading state (disabled + 'Cargando...') instead of a silently empty dropdown while entrenadores are still being fetched", async () => {
    let resolveEntrenadores: (value: typeof DEFAULT_ENTRENADORES) => void = () => {};
    mockFetchEntrenadores.mockReset();
    mockFetchEntrenadores.mockReturnValue(
      new Promise((resolve) => {
        resolveEntrenadores = resolve;
      }),
    );

    render(<ToastProvider><GroupsPage /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: /nuevo horario/i }));

    const select = (await screen.findByLabelText("Entrenador")) as HTMLSelectElement;
    expect(select).toBeDisabled();
    expect(within(select).getByText("Cargando...")).toBeInTheDocument();

    resolveEntrenadores(DEFAULT_ENTRENADORES);
    await waitFor(() => expect(select).toBeEnabled());
  });

  it("shows a clear message instead of failing silently when no entrenador is registered at all", async () => {
    mockFetchEntrenadores.mockReset();
    mockFetchEntrenadores.mockResolvedValue([]);

    render(<ToastProvider><GroupsPage /></ToastProvider>);
    await screen.findByText(/horarios de entrenamiento/i);
    fireEvent.click(screen.getByRole("button", { name: /nuevo horario/i }));

    const select = (await screen.findByLabelText("Entrenador")) as HTMLSelectElement;
    expect(select).toBeDisabled();
    expect(within(select).getByText("No hay entrenadores registrados")).toBeInTheDocument();
  });

  it("CRITICAL: a fetchEntrenadores failure does not block the horarios list — only degrades the dropdown", async () => {
    mockFetchEntrenadores.mockReset();
    mockFetchEntrenadores.mockRejectedValue(new Error("network down"));

    render(<ToastProvider><GroupsPage /></ToastProvider>);

    // The horarios list (backed by fetchHorarios/fetchNivelesConOcupacion/
    // fetchMembers) must still render normally — a rejected fetchEntrenadores
    // must never trip the page-wide loadError, since it is no longer part of
    // the same Promise.all. A distinct, non-blocking notification about the
    // entrenadores fetch failure is acceptable; the page-wide loadError
    // banner (with its "Reintentar" retry-everything button) is not.
    await screen.findByText(/horarios de entrenamiento/i);
    expect(screen.queryByText(/no se pudieron cargar los horarios\. intente nuevamente/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reintentar/i })).not.toBeInTheDocument();
    expect(await screen.findByText(/no se pudieron cargar los entrenadores/i)).toBeInTheDocument();

    // The dropdown itself degrades gracefully instead of crashing the page.
    fireEvent.click(screen.getByRole("button", { name: /nuevo horario/i }));
    const select = (await screen.findByLabelText("Entrenador")) as HTMLSelectElement;
    await waitFor(() => expect(select).toBeDisabled());
    expect(within(select).getByText("No hay entrenadores registrados")).toBeInTheDocument();
  });
});
