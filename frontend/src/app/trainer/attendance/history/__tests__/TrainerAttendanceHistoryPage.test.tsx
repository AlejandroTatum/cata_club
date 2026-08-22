/**
 * Component tests for the trainer's attendance history
 * (`docs/archive/prototypes/prototipos/21-entrenador-historial.html`).
 *
 * The route used to be a bare `redirect("/trainer")`. It is a real screen
 * again, and the thing worth pinning down is the grouping: one row per
 * SESSION, not one per student — "el entrenador no busca «qué hizo Ana el
 * 14»; busca «la lista del lunes pasado»".
 *
 * The other thing pinned down here is filter PARITY with the admin's
 * `/attendance`: horario, custom range and alumno were only ever built on that
 * screen, which redirects a trainer away, so the trainer had lost them
 * entirely. These tests fail if they regress out of this page again.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import TrainerAttendanceHistoryPage from "@/app/trainer/attendance/history/page";
import type { AttendanceRecord, TrainingSchedule } from "@/app/attendance/attendance-utils";
import { createAuthenticatedAuth } from "@/components/__tests__/test-utils";

vi.mock("@/components/ProtectedRoute", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from "@/contexts/AuthContext";
const mockUseAuth = vi.mocked(useAuth);

vi.mock("next/navigation", () => ({
  usePathname: () => "/trainer/attendance/history",
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/image", () => ({
  __esModule: true,
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ alt }: { alt: string }) => <img alt={alt} />,
}));

const mockFetchAttendanceRecords = vi.fn();
const mockFetchTrainingSchedules = vi.fn();
const mockSearchStudents = vi.fn();

vi.mock("@/services/api", () => ({
  fetchAttendanceRecords: (params?: unknown) => mockFetchAttendanceRecords(params),
  fetchTrainingSchedules: () => mockFetchTrainingSchedules(),
  searchStudents: (...args: unknown[]) => mockSearchStudents(...args),
  fetchNotificaciones: vi.fn().mockResolvedValue({ items: [], total: 0, skip: 0, limit: 20 }),
  marcarNotificacionLeida: vi.fn().mockResolvedValue(undefined),
}));

const SCHEDULES: TrainingSchedule[] = [
  {
    id: 7,
    diaSemana: "lun",
    horaInicio: "15:00",
    horaFin: "16:00",
  },
  {
    id: 9,
    diaSemana: "vie",
    horaInicio: "17:00",
    horaFin: "18:00",
  },
];

function record(
  estado: AttendanceRecord["estado"],
  estudiante: string,
  fecha: string,
  horario = "Lunes 15:00 — 16:00",
  horarioId = 12,
  registradoPorNombre: string | null = null,
): AttendanceRecord {
  return {
    id: `${estudiante}-${fecha}-${horario}-${estado}`,
    fecha,
    horario,
    horarioId,
    personaId: 1,
    estudiante,
    estado,
    registradoPorNombre,
  };
}

const RECORDS: AttendanceRecord[] = [
  record("present", "Sofia Vera", "2026-07-20", "Lunes 15:00 — 16:00", 12, "Carlos Mendoza"),
  record("present", "Diego Mendoza", "2026-07-20", "Lunes 15:00 — 16:00", 12, "Carlos Mendoza"),
  record("late", "Ana Garcia", "2026-07-20", "Lunes 15:00 — 16:00", 12, "Carlos Mendoza"),
  record("absent", "Luis Lopez", "2026-07-20", "Lunes 15:00 — 16:00", 12, "Carlos Mendoza"),
  // A different session, on an earlier day and on a different horario.
  record("present", "Kevin Sabando", "2026-07-17", "Viernes 17:00 — 18:00", 7),
  record("justified", "Melany Quimis", "2026-07-17", "Viernes 17:00 — 18:00", 7),
];

// Fixed "today" for the clock-dependent correction gate (issue #389, the
// window the backend re-verifies in `PATCH /asistencias/{id}/corregir`):
// without this pin the 30-day window shifts with whatever day CI runs on.
// The existing fixtures (2026-07-17/20) fall inside the window; 2026-07-15 is
// one day past the 30-day cut-off (2026-07-16).
const TODAY_IN_CLUB_TIME = new Date("2026-08-15T15:00:00Z");

describe("TrainerAttendanceHistoryPage", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(TODAY_IN_CLUB_TIME);
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("trainer", "Carlos Mendoza"));
    mockFetchAttendanceRecords.mockReset().mockResolvedValue(RECORDS);
    mockFetchTrainingSchedules.mockReset().mockResolvedValue(SCHEDULES);
    mockSearchStudents.mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders one row per session, most recent first — not one per student", async () => {
    render(<TrainerAttendanceHistoryPage />);

    const rows = await screen.findAllByRole("row");
    // 1 header + 2 sessions, from 6 student records.
    expect(rows).toHaveLength(3);
    expect(within(rows[1]).getByText("Lunes 15:00 — 16:00")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Viernes 17:00 — 18:00")).toBeInTheDocument();
    // No student name appears anywhere: this list is about sessions.
    expect(screen.queryByText("Sofia Vera")).not.toBeInTheDocument();
  });

  it("pluralises 'sesión' as 'sesiones', not 'sesións' (ASI-6)", async () => {
    // 11 distinct sessions (one record each, all different dates) force a
    // second page at PAGE_SIZE=10, which is what renders the range readout.
    const manySessions: AttendanceRecord[] = Array.from({ length: 11 }, (_, i) =>
      record("present", `Alumno ${i}`, `2026-07-${String(i + 1).padStart(2, "0")}`),
    );
    mockFetchAttendanceRecords.mockResolvedValue(manySessions);

    render(<TrainerAttendanceHistoryPage />);

    await screen.findAllByRole("row");
    expect(screen.getByText(/11 sesiones/)).toBeInTheDocument();
    expect(screen.queryByText(/sesións/)).not.toBeInTheDocument();
  });

  it("shows who took each list (issue #263) — a persisted taker, and 'No registrado' for legacy rows", async () => {
    render(<TrainerAttendanceHistoryPage />);

    const rows = await screen.findAllByRole("row");
    // Header: Sesión, Registró, Resultado — no "Acciones" for a trainer, who
    // can never correct an already-registered session (issue #310 / #27).
    expect(within(rows[0]).getByText("Registró")).toBeInTheDocument();
    expect(within(rows[0]).getAllByRole("columnheader")).toHaveLength(3);

    // The Monday session carries a persisted taker; the Friday session is
    // legacy (no author) and renders the explicit "No registrado" placeholder.
    expect(within(rows[1]).getByText("Carlos Mendoza")).toBeInTheDocument();
    expect(within(rows[2]).getByText("No registrado")).toBeInTheDocument();
  });

  /*
   * Renegotiated in the trainer sweep of the visual redesign, with the reason
   * written. What this test protects is unchanged and still asserted below:
   * all four counts live in the row, as REAL visible text with the state
   * named, never as a colour a reader has to memorise and never hidden in an
   * `sr-only` span.
   *
   * Two things did change. The four loose colored badges became the same
   * proportional bar "Últimas listas" already draws for the same measurement —
   * `RecentSessionsList.tsx` retired that badge table on this screen's twin,
   * for the reason written there, and leaving it standing here kept two
   * vocabularies for one number. And the counts stopped being a count against
   * a singular label: "2 Presente" is not Spanish, and `formatStateCount` is
   * now the one place this product counts a state out loud.
   */
  it("carries the four state counts in the row itself, with a visible state name", async () => {
    render(<TrainerAttendanceHistoryPage />);

    const rows = await screen.findAllByRole("row");
    const resultCell = within(rows[1]).getAllByRole("cell")[2];
    expect(resultCell.querySelector(".sr-only")).toBeNull();
    expect(resultCell).toHaveTextContent("2 presentes");
    expect(resultCell).toHaveTextContent("1 tardanza");
    expect(resultCell).toHaveTextContent("0 justificados");
    expect(resultCell).toHaveTextContent("1 ausente");
  });

  it("draws the session's composition as the one bar the panel already uses, named for a screen reader", async () => {
    render(<TrainerAttendanceHistoryPage />);

    const rows = await screen.findAllByRole("row");
    expect(
      within(rows[1]).getByRole("img", {
        name: "2 presentes, 1 tardanza, 0 justificados y 1 ausente sobre 4 registros",
      }),
    ).toBeInTheDocument();
    // One bar per row, and nothing left of the four-badge table it replaces.
    expect(within(screen.getByTestId("history-desktop-table")).getAllByRole("img", { name: /sobre \d+ registros/ })).toHaveLength(2);
  });

  it("shows Corregir for every session within 30 days when the user is admin", async () => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("admin", "Carlos Mendoza"));
    render(<TrainerAttendanceHistoryPage />);

    await screen.findByTestId("history-desktop-table");
    const links = within(screen.getByTestId("history-desktop-table")).getAllByRole("link", { name: "Corregir" });
    expect(links).toHaveLength(2);
  });

  it("deep-links Corregir into that session's roll call, not the picker", async () => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("admin", "Carlos Mendoza"));
    render(<TrainerAttendanceHistoryPage />);

    await screen.findByTestId("history-desktop-table");
    const links = within(screen.getByTestId("history-desktop-table")).getAllByRole("link", { name: "Corregir" });
    const rows = await screen.findAllByRole("row");

    // Row order is most recent first, and each href must belong to the row it
    // sits in — both the horario AND the day. Sending the Friday's button to
    // the Monday's roll call is the same defect one row over.
    expect(rows[1]).toHaveTextContent("20/07/2026");
    expect(links[0]).toHaveAttribute(
      "href",
      "/trainer/attendance?horario=12&fecha=2026-07-20&paso=lista",
    );
    expect(rows[2]).toHaveTextContent("17/07/2026");
    expect(links[1]).toHaveAttribute(
      "href",
      "/trainer/attendance?horario=7&fecha=2026-07-17&paso=lista",
    );
  });

  it("does not show Corregir to a trainer", async () => {
    render(<TrainerAttendanceHistoryPage />);

    await screen.findAllByRole("row");
    expect(screen.queryByRole("link", { name: "Corregir" })).not.toBeInTheDocument();
  });

  /*
   * Issue #373: la celda vacía era el defecto, no la solución.
   *
   * Este test afirmaba lo contrario -- que pasados los 30 días no hubiera
   * acción alguna -- y por eso el vencimiento se veía igual que un error de
   * carga: el administrador no podía distinguir "esta sesión ya no se corrige"
   * de "algo se rompió". La ventana de 30 días no se toca -- es el mismo tope
   * que el backend re-verifica hoy en `PATCH /asistencias/{id}/corregir`
   * (issue #389) --; lo que cambia es que ahora se NOMBRA.
   *
   * Un `<Link>` deshabilitado no existe en HTML, así que la acción vencida deja
   * de ser un ancla y pasa a ser un `<button disabled>` con el motivo colgado
   * de `aria-describedby` -- el mismo par que el asistente de asistencia ya usa
   * para bloquear "Revisar y confirmar" con `unmarkedReasonId`
   * (`src/app/trainer/attendance/page.tsx:2261-2336`).
   */
  it("mantiene la acción presente pero bloqueada, nombrando el motivo, pasados los 30 días (issue #373)", async () => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("admin", "Carlos Mendoza"));
    const oldRecords: AttendanceRecord[] = [
      record("present", "Sofia Vera", "2026-07-15"),
    ];
    mockFetchAttendanceRecords.mockResolvedValue(oldRecords);

    render(<TrainerAttendanceHistoryPage />);

    const rows = await screen.findAllByRole("row");
    // The admin still HAS an "Acciones" column — the header exists, so the
    // cell keeps the row's columns aligned with it.
    const cells = within(rows[1]).getAllByRole("cell");
    expect(cells).toHaveLength(4);

    // Ya no navega a ningún lado, pero sigue estando y se lee deshabilitada.
    expect(screen.queryByRole("link", { name: "Corregir" })).not.toBeInTheDocument();
    const accion = within(cells[3]).getByRole("button", { name: "Corregir" });
    expect(accion).toBeDisabled();

    // El motivo es texto real de la celda -- no un `title` que solo existe al
    // pasar el mouse -- y está atado al control para un lector de pantalla.
    const motivo = "La ventana de corrección de 30 días ya cerró para esta sesión.";
    expect(cells[3]).toHaveTextContent(motivo);
    const motivoId = accion.getAttribute("aria-describedby");
    expect(motivoId).toBeTruthy();
    expect(document.getElementById(motivoId as string)).toHaveTextContent(motivo);
  });

  it("deja intacta la acción dentro de la ventana: enlace vivo, sin bloqueo ni motivo (issue #373)", async () => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("admin", "Carlos Mendoza"));
    render(<TrainerAttendanceHistoryPage />);

    await screen.findByTestId("history-desktop-table");
    const links = within(screen.getByTestId("history-desktop-table")).getAllByRole("link", { name: "Corregir" });
    expect(links).toHaveLength(2);
    // Nada de la superficie vencida se filtra a una sesión que todavía se puede
    // corregir: ni botón muerto ni línea de motivo.
    expect(screen.queryByRole("button", { name: "Corregir" })).not.toBeInTheDocument();
    expect(screen.queryByText(/ventana de corrección/i)).not.toBeInTheDocument();
  });

  /*
   * Regression guard for issue #310 / #27: this test used to assert the
   * OPPOSITE — that a trainer's row kept a 4th, permanently empty "Acciones"
   * cell under a header promising an action that role can never use. That was
   * the defect: 10/10 rows in the real audit had an empty last cell under
   * "ACCIONES". The fix removes the column outright for a non-admin instead
   * of padding it empty; a trainer's row now has exactly the 3 real columns.
   */
  it("does not render the ACCIONES column for a trainer, instead of padding it empty (issue #310)", async () => {
    render(<TrainerAttendanceHistoryPage />);

    const rows = await screen.findAllByRole("row");
    expect(within(rows[0]).queryByText("Acciones")).not.toBeInTheDocument();
    expect(within(rows[1]).getAllByRole("cell")).toHaveLength(3);
  });

  it("refetches with a new range when a preset is picked", async () => {
    render(<TrainerAttendanceHistoryPage />);
    await screen.findAllByRole("row");
    mockFetchAttendanceRecords.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Hoy" }));

    await waitFor(() => {
      expect(mockFetchAttendanceRecords).toHaveBeenCalledTimes(1);
    });
    const params = mockFetchAttendanceRecords.mock.calls[0][0] as {
      fechaInicio: string;
      fechaFin: string;
    };
    expect(params.fechaInicio).toBe(params.fechaFin);
  });

  it("shows an actionable empty state for a period with no lists", async () => {
    mockFetchAttendanceRecords.mockResolvedValue([]);
    render(<TrainerAttendanceHistoryPage />);

    expect(await screen.findByText("No hay listas en este período")).toBeInTheDocument();
    expect(
      within(screen.getByRole("main")).getByRole("link", { name: "Pasar lista" }),
    ).toHaveAttribute("href", "/trainer/attendance");
  });

  it("recovers from a failed load with a retry", async () => {
    mockFetchAttendanceRecords.mockRejectedValueOnce(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(<TrainerAttendanceHistoryPage />);

    expect(await screen.findByText(/No se pudieron cargar los registros/)).toBeInTheDocument();
    mockFetchAttendanceRecords.mockResolvedValue(RECORDS);
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    await waitFor(() => {
      expect(screen.getByText("Lunes 15:00 — 16:00")).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Filter parity with `/attendance` — the three controls the trainer lost
  // -------------------------------------------------------------------------

  it("narrows by horario, with every schedule offered as an option", async () => {
    render(<TrainerAttendanceHistoryPage />);
    await screen.findAllByRole("row");
    await waitFor(() => {
      expect(screen.getByRole("option", { name: /Lunes 15:00 — 16:00/ })).toBeInTheDocument();
    });
    mockFetchAttendanceRecords.mockClear();

    fireEvent.change(screen.getByLabelText("Filtrar por horario"), { target: { value: "9" } });

    await waitFor(() => {
      expect(mockFetchAttendanceRecords).toHaveBeenCalledTimes(1);
    });
    expect(mockFetchAttendanceRecords.mock.calls[0][0]).toMatchObject({ horarioId: 9 });
  });

  it("offers a custom range, and only queries once both ends are set and ordered", async () => {
    render(<TrainerAttendanceHistoryPage />);
    await screen.findAllByRole("row");
    mockFetchAttendanceRecords.mockClear();

    fireEvent.click(screen.getByRole("button", { name: /rango personalizado/i }));
    // Half a range is not a range: no request, and no stale rows left behind.
    await waitFor(() => {
      expect(screen.getByText("No hay listas en este período")).toBeInTheDocument();
    });
    expect(mockFetchAttendanceRecords).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Fecha de inicio"), {
      target: { value: "2026-07-01" },
    });
    // Inverted: named as a problem, still no request.
    fireEvent.change(screen.getByLabelText("Fecha límite"), { target: { value: "2026-06-01" } });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /La fecha límite no puede ser menor/,
    );
    expect(mockFetchAttendanceRecords).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Fecha límite"), { target: { value: "2026-07-20" } });
    await waitFor(() => {
      expect(mockFetchAttendanceRecords).toHaveBeenCalledTimes(1);
    });
    expect(mockFetchAttendanceRecords.mock.calls[0][0]).toMatchObject({
      fechaInicio: "2026-07-01",
      fechaFin: "2026-07-20",
    });
  });

  it("narrows to one student through the alumno search", async () => {
    mockSearchStudents.mockResolvedValue([{ id: 42, nombres: "Ana", apellidos: "García" }]);
    render(<TrainerAttendanceHistoryPage />);
    await screen.findAllByRole("row");
    mockFetchAttendanceRecords.mockClear();

    fireEvent.change(screen.getByLabelText("Buscar alumno"), { target: { value: "Ana" } });
    fireEvent.click(await screen.findByRole("option", { name: /Ana García/ }));

    await waitFor(() => {
      expect(mockFetchAttendanceRecords).toHaveBeenCalledTimes(1);
    });
    expect(mockFetchAttendanceRecords.mock.calls[0][0]).toMatchObject({ personaId: 42 });

    // And the selection can be undone without retyping — the search's own X
    // invalidates it (issue #200): no separate "Limpiar selección" action.
    fireEvent.click(screen.getByRole("button", { name: "Limpiar búsqueda" }));
    await waitFor(() => {
      expect(mockFetchAttendanceRecords).toHaveBeenCalledTimes(2);
    });
    expect(mockFetchAttendanceRecords.mock.calls[1][0]).not.toHaveProperty("personaId");
  });

  it("keeps the history usable when the schedule list cannot be loaded", async () => {
    mockFetchTrainingSchedules.mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(<TrainerAttendanceHistoryPage />);

    // The sessions still render; only the horario select is left with its
    // single "Todos los horarios" option.
    await screen.findByTestId("history-desktop-table");
    expect(within(screen.getByTestId("history-desktop-table")).getByText("Lunes 15:00 — 16:00")).toBeInTheDocument();
    expect(screen.queryByText(/No se pudieron cargar los registros/)).not.toBeInTheDocument();
    expect(within(screen.getByLabelText("Filtrar por horario")).getAllByRole("option")).toHaveLength(
      1,
    );
  });

  // La paridad con `/attendance` incluye el EJE del panel, no solo los tres
  // controles. `/attendance` pasa `layout="row"` (page.tsx:178) y el historial
  // no pasaba nada, o sea el default `column`, contra los 1408px del `measure`
  // por defecto del shell: tres controles amontonados a la izquierda y la mitad
  // derecha de la tarjeta vacía (issue #375).
  //
  // jsdom no calcula layout, así que no se puede medir el ancho. Lo que sí se
  // puede afirmar es lo que el componente EXPRESA: `FilterPanel` traduce
  // `layout` a `AXIS[layout]` (FilterPanel.tsx:127), y esas dos entradas no
  // comparten ninguna clase — `column` es `flex flex-col`, `row` es una grilla.
  // Espeja la forma de "flows the control slots across the width when asked
  // to" en `components/ui/__tests__/FilterPanel.test.tsx`.
  it("dibuja el panel de filtros sobre el eje horizontal, como `/attendance` (issue #375)", async () => {
    render(<TrainerAttendanceHistoryPage />);
    await screen.findAllByRole("row");

    const panel = screen.getByRole("region", { name: "Filtros de registros" });
    const classes = panel.className.split(" ");

    expect(classes).not.toContain("flex-col");
    expect(classes).toContain("grid");
  });

  /*
   * Densidad: "Registró" es una columna de ancho acotado.
   *
   * Un nombre completo ecuatoriano lleva cuatro palabras, y dejándolo crecer
   * libre se comía el ancho que necesita "Resultado" para que la barra de
   * composición se lea. Se topa y se trunca — pero truncar no puede PERDER el
   * dato: el valor entero sigue disponible en el `title`, que es lo que el
   * navegador muestra al pasar el mouse y lo que un lector de pantalla anuncia
   * junto al texto recortado.
   */
  it("topa y trunca «Registró», sin perder el nombre completo", async () => {
    const nombreLargo = "María Fernanda Villavicencio Zambrano";
    mockFetchAttendanceRecords.mockResolvedValue([
      record("present", "Sofia Vera", "2026-07-20", "Lunes 15:00 — 16:00", 12, nombreLargo),
    ]);

    render(<TrainerAttendanceHistoryPage />);

    const rows = await screen.findAllByRole("row");
    const celda = within(rows[1]).getAllByRole("cell")[1];
    const valor = within(celda).getByTitle(nombreLargo);
    expect(valor).toHaveTextContent(nombreLargo);
    expect(valor.className).toContain("truncate");
    // El tope tiene que existir: `truncate` sin ancho máximo no recorta nada.
    expect(valor.className).toMatch(/max-w-\[/);
  });

  it("shows the admin correction expiry and its explanation on the mobile card", async () => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("admin", "Carlos Mendoza"));
    mockFetchAttendanceRecords.mockResolvedValue([record("present", "Sofia Vera", "2026-07-15")]);
    render(<TrainerAttendanceHistoryPage />);
    const mobile = await screen.findByTestId("history-mobile-list");
    const card = within(mobile).getByTestId("history-mobile-card-2026-07-15-12");
    expect(within(card).getByRole("button", { name: "Corregir" })).toBeDisabled();
    expect(card).toHaveTextContent("La ventana de corrección de 30 días ya cerró para esta sesión.");
  });

    it("renders mobile cards below sm and preserves the desktop table", async () => {
    render(<TrainerAttendanceHistoryPage />);
    const mobile = await screen.findByTestId("history-mobile-list");
    const desktop = screen.getByTestId("history-desktop-table");
    expect(mobile).toHaveClass("sm:hidden");
    expect(desktop).toHaveClass("hidden", "sm:block");
    const card = within(mobile).getByTestId("history-mobile-card-2026-07-20-12");
    expect(card).toHaveTextContent(/20\/07\/2026/);
    expect(card).toHaveTextContent(/Carlos Mendoza/);
    expect(card).toHaveTextContent(/2 presentes/);
  });

    it("leads back to Mi día", async () => {
    render(<TrainerAttendanceHistoryPage />);

    await screen.findAllByRole("row");
    expect(screen.getByRole("link", { name: /Volver a Mi día/ })).toHaveAttribute(
      "href",
      "/trainer",
    );
  });
});

// ---------------------------------------------------------------------------
// Issue #346 (regresión de #308 + #310): antes de K1, "la fecha de la sesión"
// y "hoy" eran siempre el mismo valor -- separarlas en la escritura dejó
// expuesta cualquier lectura que todavía asumiera que coinciden.
//
// Cada mock de `fetchAttendanceRecords` de arriba devuelve el mismo array fijo
// sin mirar `fechaInicio`/`fechaFin`, así que ninguno de esos tests puede
// distinguir un rango correcto de uno roto que hubiera pedido la fecha de HOY
// en vez de la de la sesión. Este bloque mockea el fetch como se comporta el
// backend real -- filtrando por el rango recibido -- para que la aserción
// solo pase si la pantalla realmente pide la fecha de la sesión.
// ---------------------------------------------------------------------------
describe("TrainerAttendanceHistoryPage — el conteo de una sesión sale de su propia fecha, no de hoy (issue #346)", () => {
  const SUNDAY_IN_CLUB_TIME = new Date("2026-08-16T15:00:00Z");
  const WEDNESDAY_SESSION_DATE = "2026-08-12";

  const CLOSED_WEDNESDAY_SESSION: AttendanceRecord[] = Array.from({ length: 15 }, (_, i) =>
    record(
      "present",
      `Alumno ${i + 1}`,
      WEDNESDAY_SESSION_DATE,
      "Miércoles 17:00 — 18:00",
      20,
      "Coach Vera",
    ),
  );

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(SUNDAY_IN_CLUB_TIME);
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("trainer", "Carlos Mendoza"));
    mockFetchTrainingSchedules.mockReset().mockResolvedValue(SCHEDULES);
    mockSearchStudents.mockReset().mockResolvedValue([]);
    // Un rango de verdad: solo vuelven los registros cuya PROPIA `fecha` cae
    // dentro de [fechaInicio, fechaFin] -- lo mismo que hace
    // `/api/attendance/records` contra `fecha_entrenamiento` en el backend.
    // Un llamado que (por error) pidiera la fecha de hoy en vez de la de la
    // sesión no recibiría nada.
    mockFetchAttendanceRecords.mockReset().mockImplementation(
      (params?: { fechaInicio?: string; fechaFin?: string; horarioId?: number }) =>
        Promise.resolve(
          CLOSED_WEDNESDAY_SESSION.filter((r) => {
            if (params?.fechaInicio && r.fecha < params.fechaInicio) return false;
            if (params?.fechaFin && r.fecha > params.fechaFin) return false;
            if (params?.horarioId !== undefined && r.horarioId !== params.horarioId) return false;
            return true;
          }),
        ),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("agrupa los 15 registros de la sesión del miércoles, vista un domingo, con el rango por defecto (candado #346)", async () => {
    render(<TrainerAttendanceHistoryPage />);

    // El preset por defecto ("Este mes") tiene que alcanzar una sesión de
    // días antes en la misma semana/mes -- nunca solo hoy.
    await screen.findByTestId("history-desktop-table");
    const desktop = within(screen.getByTestId("history-desktop-table"));
    expect(desktop.getByRole("img", { name: /sobre 15 registros/ })).toBeInTheDocument();
    expect(desktop.getByText("15 presentes")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Las tres cifras del período: listas tomadas, sesiones programadas y la resta.
//
// La tercera cifra es la delicada, y estos tests existen sobre todo por ella.
// No sale del backend: se deriva expandiendo el horario semanal sobre el rango
// del filtro. No existen feriados, ni cancelaciones, ni vigencia de horario en
// el modelo (`HorarioEntrenamiento` guarda categoría, día y horas, nada más),
// así que un horario dado de alta el mes pasado se expande hacia atrás e
// inventa huecos. Encima, issue #313 / hallazgo #56 ya dejó anotado que el
// horario semanal programado y las listas efectivamente tomadas no son el mismo
// universo.
//
// De ahí los dos candados que importan: la palabra que declara la estimación
// tiene que estar en pantalla, y la cifra no puede pintarse como un problema
// confirmado. Un número rojo AFIRMA; este número supone.
// ---------------------------------------------------------------------------
describe("TrainerAttendanceHistoryPage — las tres cifras del período", () => {
  // Agosto de 2026 con "Este mes" mirado el día 15: el rango es 01..15, y ahí
  // caen los lunes 3 y 10 (horario 7) y los viernes 7 y 14 (horario 9). Cuatro
  // sesiones programadas.
  const AUGUST_MIDMONTH = new Date("2026-08-15T15:00:00Z");

  const THREE_LISTS: AttendanceRecord[] = [
    record("present", "Sofia Vera", "2026-08-03", "Lunes 15:00 — 16:00", 7, "Carlos Mendoza"),
    record("present", "Ana Garcia", "2026-08-07", "Viernes 17:00 — 18:00", 9, "Carlos Mendoza"),
    record("late", "Luis Lopez", "2026-08-10", "Lunes 15:00 — 16:00", 7, "Carlos Mendoza"),
  ];

  /** La tarjeta entera a partir de su rótulo — rótulo, cifra y aclaración. */
  function tile(label: string): HTMLElement {
    const rotulo = screen.getByText(label);
    expect(rotulo.parentElement).not.toBeNull();
    return rotulo.parentElement as HTMLElement;
  }

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(AUGUST_MIDMONTH);
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("trainer", "Carlos Mendoza"));
    mockFetchAttendanceRecords.mockReset().mockResolvedValue(THREE_LISTS);
    mockFetchTrainingSchedules.mockReset().mockResolvedValue(SCHEDULES);
    mockSearchStudents.mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("cruza las listas tomadas contra el horario semanal y nombra el hueco", async () => {
    render(<TrainerAttendanceHistoryPage />);

    await screen.findAllByRole("row");
    expect(tile("Listas tomadas")).toHaveTextContent("3");
    expect(tile("Sesiones programadas")).toHaveTextContent("4");
    // El viernes 14: programado y sin lista.
    expect(tile("Sin lista (estimado)")).toHaveTextContent("1");
  });

  it("declara la estimación con una palabra que se lee, no con un asterisco", async () => {
    render(<TrainerAttendanceHistoryPage />);

    await screen.findAllByRole("row");
    const estimado = tile("Sin lista (estimado)");
    // La tarjeta declara que es estimado y la explicación accesible nombra sus límites.
    expect(estimado).toHaveTextContent(/estimado/i);
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent(/Estimación/);
    expect(note).toHaveTextContent(/feriados/);
    expect(note).toHaveTextContent(/cancelaciones/);
  });

  it("no pinta el hueco como un problema confirmado", async () => {
    render(<TrainerAttendanceHistoryPage />);

    await screen.findAllByRole("row");
    const estimado = tile("Sin lista (estimado)");
    // Ni la tarjeta ni nada adentro toma el rojo de estado: ese color afirma un
    // problema, y esta cifra todavía no lo es.
    expect(estimado.className).not.toMatch(/state-bad/);
    expect(estimado.querySelector('[class*="state-bad"]')).toBeNull();
  });

  it("no cruza nada cuando el período se filtra por un alumno", async () => {
    // Filtrando por Ana, "listas tomadas" pasa a ser "listas donde figura Ana",
    // y el horario semanal sigue siendo el del club entero: restar uno del otro
    // daría un hueco enorme y falso. Los dos universos dejan de ser comparables,
    // así que la comparación no se hace — y se dice por qué.
    mockSearchStudents.mockResolvedValue([{ id: 42, nombres: "Ana", apellidos: "García" }]);
    render(<TrainerAttendanceHistoryPage />);
    await screen.findAllByRole("row");
    expect(screen.getByText("Sesiones programadas")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Buscar alumno"), { target: { value: "Ana" } });
    fireEvent.click(await screen.findByRole("option", { name: /Ana García/ }));

    await waitFor(() => {
      expect(screen.queryByText("Sesiones programadas")).not.toBeInTheDocument();
    });
    expect(screen.queryByText("Sin lista (estimado)")).not.toBeInTheDocument();
    expect(
      screen.getByText(/no se compara contra el horario semanal al filtrar por alumno/i),
    ).toBeInTheDocument();
  });
});
