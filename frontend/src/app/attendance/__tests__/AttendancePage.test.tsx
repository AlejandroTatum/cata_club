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
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import AttendancePage from "@/app/attendance/page";
import { ToastProvider } from "@/contexts/ToastContext";
import ToastContainer from "@/components/ToastContainer";
import type { TrainingSchedule, AttendanceRecord } from "@/app/attendance/attendance-utils";

const mockProtectedRouteProps = vi.fn();
vi.mock("@/components/ProtectedRoute", () => ({
  default: ({ children, ...props }: { children: React.ReactNode } & Record<string, unknown>) => {
    mockProtectedRouteProps(props);
    return <>{children}</>;
  },
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
  { id: 1, diaSemana: "lun", horaInicio: "15:00", horaFin: "16:30" },
];

function buildRecords(count: number): AttendanceRecord[] {
  return Array.from({ length: count }, (_, i) => ({
    // Numeric-string, same shape `buildAttendanceRecord` actually sends
    // (`String(asistencia.id)`) — `AttendanceCorrectionAction` does
    // `Number(record.id)` before calling `correctAttendance`, so an id like
    // the old `"att-1"` fixture would NaN that call silently.
    id: String(i + 1),
    fecha: "2026-07-01",
    horario: "Lunes 15:00",
    horarioId: 1,
    personaId: i + 1,
    estudiante: `Jugador ${i + 1}`,
    estado: "present" as const,
    correctable: true,
  }));
}

/** Renders with `ToastProvider` — required now that every row's
 *  `AttendanceCorrectionAction` calls `useToast()` (issue #663). */
function renderPage(): ReturnType<typeof render> {
  return render(
    <ToastProvider>
      <AttendancePage />
      <ToastContainer />
    </ToastProvider>,
  );
}

const mockFetchTrainingSchedules = vi.fn();
const mockFetchAttendanceRecords = vi.fn();
const mockFetchConteos = vi.fn();
const mockSearchStudents = vi.fn().mockResolvedValue([]);
const mockFetchNotificaciones = vi.fn().mockResolvedValue({ items: [], total: 0, skip: 0, limit: 20 });
const mockMarcarNotificacionLeida = vi.fn().mockResolvedValue(undefined);
const mockCorrectAttendance = vi.fn();

vi.mock("@/services/api", () => ({
  fetchTrainingSchedules: () => mockFetchTrainingSchedules(),
  fetchAttendanceRecords: (params?: unknown) => mockFetchAttendanceRecords(params),
  fetchCorrectionRequests: (filters?: unknown) => mockFetchCorrectionRequests(filters),
  // QA4 PERF-01: the screen reads counts, never the ~500 KB roster. Fixtures
  // keep the roster-row shape; this folds them into the counts the API returns.
  fetchConteosPorHorario: async () => {
    const rows = (await mockFetchConteos()) as { horarioId: number }[];
    const byHorario = new Map<number, number>();
    for (const row of rows) byHorario.set(row.horarioId, (byHorario.get(row.horarioId) ?? 0) + 1);
    return [...byHorario].map(([horarioId, inscritos]) => ({ horarioId, inscritos }));
  },
  searchStudents: (query: string) => mockSearchStudents(query),
  fetchNotificaciones: () => mockFetchNotificaciones(),
  marcarNotificacionLeida: (id: number) => mockMarcarNotificacionLeida(id),
  correctAttendance: (asistenciaId: number, data: unknown) => mockCorrectAttendance(asistenciaId, data),
}));

beforeEach(() => {
  mockFetchTrainingSchedules.mockReset().mockResolvedValue(SCHEDULES);
  mockFetchAttendanceRecords.mockReset().mockResolvedValue(buildRecords(5));
  mockFetchConteos.mockReset().mockResolvedValue([]);
  mockCorrectAttendance.mockReset();
  mockProtectedRouteProps.mockReset();
});

const mockFetchCorrectionRequests = vi.fn();

describe("AttendancePage — trainers' correction requests (QA4 ENT-25)", () => {
  it("mounts the admin inbox with the pending requests above the records", async () => {
    mockFetchCorrectionRequests.mockReset().mockResolvedValue([
      {
        id: 1, asistenciaId: 901, personaId: 1, personaNombre: "Jugador Uno", horarioId: 12, fecha: "2026-07-21",
        horarioEtiqueta: "Juvenil · martes 18:00", estadoActual: "present", estadoSolicitado: "absent",
        motivo: "Debía figurar como ausente.", solicitadoPorId: 3, solicitadoPorNombre: "Coach Torres",
        solicitadoEn: "2026-07-21T20:00:00Z", estado: "PENDIENTE", resueltoPorNombre: null, resueltoEn: null,
        motivoResolucion: null,
      },
    ]);
    renderPage();

    expect(await screen.findByText("Solicitudes de corrección")).toBeInTheDocument();
    expect(mockFetchCorrectionRequests).toHaveBeenCalledWith({ estado: "PENDIENTE" });
    expect(screen.getByText("Jugador Uno")).toBeInTheDocument();
  });
});

describe("AttendancePage — Horarios section removed, Tomar asistencia in the header", () => {
  it("removes the Horarios table and keeps a Tomar asistencia entry point", async () => {
    renderPage();

    await screen.findAllByRole("row");
    expect(screen.queryByText("Horarios de Entrenamiento")).not.toBeInTheDocument();

    const links = screen.getAllByRole("link", { name: /tomar asistencia/i });
    expect(links.length).toBeGreaterThan(0);
    expect(links[0]).toHaveAttribute("href", "/trainer/attendance");
  });

  it("offers a back link to the Panel de Control", async () => {
    renderPage();
    await screen.findAllByRole("row");

    expect(screen.getByRole("link", { name: /volver al panel de control/i })).toHaveAttribute(
      "href",
      "/dashboard",
    );
  });
});

describe("AttendancePage — filters reach the records endpoint", () => {
  it("queries a bounded range on first load instead of the whole table", async () => {
    renderPage();

    await waitFor(() => expect(mockFetchAttendanceRecords).toHaveBeenCalled());
    const params = mockFetchAttendanceRecords.mock.calls[0][0];
    expect(params).toMatchObject({
      fechaInicio: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      fechaFin: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
  });

  it("passes the chosen day of a slot through as horarioId", async () => {
    renderPage();
    await screen.findAllByRole("row");
    expect(screen.getByLabelText("Filtrar por día")).toBeDisabled();

    fireEvent.change(await screen.findByLabelText("Filtrar por horario"), {
      target: { value: "Sin categoría|15:00|16:30" },
    });
    fireEvent.change(screen.getByLabelText("Filtrar por día"), { target: { value: "1" } });

    await waitFor(() => {
      const lastCall = mockFetchAttendanceRecords.mock.calls.at(-1)?.[0];
      expect(lastCall).toMatchObject({ horarioId: 1 });
    });
  });

  it("filters a slot's 'Todos los días' client-side, never sending horarioIds", async () => {
    mockFetchTrainingSchedules.mockResolvedValue([
      ...SCHEDULES,
      { id: 2, diaSemana: "vie", horaInicio: "15:00", horaFin: "16:30" },
    ]);
    mockFetchAttendanceRecords.mockResolvedValue([
      ...buildRecords(1),
      { ...buildRecords(2)[1], id: "9", horarioId: 99, estudiante: "Otro Horario" },
    ]);
    renderPage();
    await screen.findAllByRole("row");

    fireEvent.change(await screen.findByLabelText("Filtrar por horario"), {
      target: { value: "Sin categoría|15:00|16:30" },
    });

    await waitFor(() => {
      const lastCall = mockFetchAttendanceRecords.mock.calls.at(-1)?.[0];
      expect(lastCall).not.toHaveProperty("horarioIds");
      expect(lastCall).not.toHaveProperty("horarioId");
    });
    expect(screen.queryByText("Otro Horario")).not.toBeInTheDocument();
  });

  it("narrows the range to a single day when 'Hoy' is chosen", async () => {
    renderPage();
    await screen.findAllByRole("row");

    fireEvent.click(screen.getByRole("button", { name: /^hoy$/i }));

    await waitFor(() => {
      const lastCall = mockFetchAttendanceRecords.mock.calls.at(-1)?.[0];
      expect(lastCall.fechaInicio).toBe(lastCall.fechaFin);
    });
  });

  it("refuses to query an inverted custom range and says why", async () => {
    renderPage();
    await screen.findAllByRole("row");

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

/** Rows of the history table, header excluded. */
async function sessionRows(): Promise<HTMLElement[]> {
  const rows = await screen.findAllByRole("row");
  return rows.slice(1);
}

describe("AttendancePage — session history (same format as the trainer's)", () => {
  it("groups the records into one row per session, not one per student", async () => {
    renderPage();

    const rows = await sessionRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("01/07/2026");
    expect(rows[0]).toHaveTextContent("Lunes 15:00");
    expect(screen.getByRole("columnheader", { name: "Registró" })).toBeInTheDocument();
    expect(screen.queryByText("Jugador 1")).not.toBeInTheDocument();
  });

  it("draws the session's result as the shared composition bar", async () => {
    renderPage();
    await sessionRows();

    expect(screen.getAllByRole("img", { name: /5 presentes/i }).length).toBeGreaterThan(0);
  });

  it("offers a way out when the filters match nothing", async () => {
    mockFetchAttendanceRecords.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText("No hay listas en este período")).toBeInTheDocument();
    expect(screen.getByTestId("history-ghost-rows")).toBeInTheDocument();
  });
});

describe("AttendancePage — session pagination", () => {
  function manySessions(count: number): AttendanceRecord[] {
    return Array.from({ length: count }, (_, i) => ({
      ...buildRecords(1)[0],
      id: String(i + 1),
      fecha: `2026-06-${String(i + 1).padStart(2, "0")}`,
    }));
  }

  beforeEach(() => {
    mockFetchAttendanceRecords.mockReset().mockResolvedValue(manySessions(15));
  });

  it("shows labeled Anterior/Siguiente controls (visible text, not icon-only) and a prominent page count", async () => {
    renderPage();

    expect(await screen.findByText("Página 1 de 2")).toBeInTheDocument();

    const prevButton = screen.getByRole("button", { name: /anterior/i });
    const nextButton = screen.getByRole("button", { name: /siguiente/i });
    expect(prevButton).toHaveTextContent("Anterior");
    expect(nextButton).toHaveTextContent("Siguiente");
    expect(prevButton).toBeDisabled();
    expect(nextButton).toBeEnabled();
  });

  it("advances to the next page and back when the labeled buttons are clicked", async () => {
    renderPage();

    await screen.findByText("Página 1 de 2");
    fireEvent.click(screen.getByRole("button", { name: /siguiente/i }));

    expect(await screen.findByText((_content, element) => element?.textContent === "Página 2 de 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /siguiente/i })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /anterior/i }));
    expect(await screen.findByText((_content, element) => element?.textContent === "Página 1 de 2")).toBeInTheDocument();
  });

  it("pads a short list with ghost rows and drops them once it paginates", async () => {
    mockFetchAttendanceRecords.mockResolvedValue(buildRecords(5));
    renderPage();
    expect(await screen.findByTestId("history-ghost-rows")).toBeInTheDocument();

    mockFetchAttendanceRecords.mockResolvedValue(manySessions(15));
    fireEvent.click(screen.getByRole("button", { name: /^hoy$/i }));
    await screen.findByText("Página 1 de 2");
    expect(screen.queryByTestId("history-ghost-rows")).not.toBeInTheDocument();
  });
});

// --- Issue #663: correction lives in the session drill-down -----------------
describe("AttendancePage — per-record correction inside the session drill-down", () => {
  async function openSession(): Promise<void> {
    await sessionRows();
    fireEvent.click(screen.getAllByRole("button", { name: /^Registros/ })[0]);
  }

  it("still gates the whole screen to admin only — the drill-down adds no second door", async () => {
    renderPage();
    await sessionRows();

    // `AttendanceCorrectionAction` does no role check of its own — it trusts
    // the page-level gate, so THIS is the one assertion standing between
    // "admin-only" and a regression that quietly widens `allowedRoles`.
    expect(mockProtectedRouteProps).toHaveBeenCalledWith(
      expect.objectContaining({ allowedRoles: ["admin"] }),
    );
  });

  it("keeps records and Corregir hidden until the session is expanded, then lists each student", async () => {
    renderPage();
    await sessionRows();
    expect(screen.queryByRole("button", { name: "Corregir" })).not.toBeInTheDocument();

    const toggle = screen.getAllByRole("button", { name: /^Registros/ })[0];
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Jugador 1")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Corregir" })).toHaveLength(5);

    fireEvent.click(toggle);
    expect(screen.queryByText("Jugador 1")).not.toBeInTheDocument();
  });

  it("shows a disabled Corregir with the reason stated once the 30-day window closed", async () => {
    mockFetchAttendanceRecords.mockResolvedValue([
      { ...buildRecords(1)[0], id: "101", estudiante: "Dentro de ventana", correctable: true },
      { ...buildRecords(1)[0], id: "102", estudiante: "Fuera de ventana", correctable: false },
    ]);
    renderPage();
    await openSession();

    const buttons = screen.getAllByRole("button", { name: "Corregir" });
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toBeEnabled();
    expect(buttons[1]).toBeDisabled();

    const reasonId = buttons[1].getAttribute("aria-describedby");
    expect(reasonId).toBeTruthy();
    expect(document.getElementById(reasonId as string)).toHaveTextContent(
      "La ventana de corrección de 30 días ya cerró para esta sesión.",
    );
  });

  it("opens the shared correction dialog and patches the session in place on submit, without a refetch", async () => {
    mockFetchAttendanceRecords.mockResolvedValue([buildRecords(1)[0]]);
    mockCorrectAttendance.mockResolvedValue({
      asistencia: { ...buildRecords(1)[0], estado: "absent" },
      corregidoPorId: 1,
      corregidoPorNombre: "Admin Test",
      corregidoEn: "2026-08-26T12:00:00Z",
      motivo: "",
      estadoAnterior: "present",
    });
    renderPage();
    await openSession();

    const callsBeforeCorrection = mockFetchAttendanceRecords.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Corregir" }));

    expect(await screen.findByText("Corregir asistencia de Jugador 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Ausente" }));
    // Issue #1578: no motivo field for the admin; pick the state and save.
    expect(screen.queryByPlaceholderText("Por qué se corrige este registro")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Guardar corrección" }));

    await waitFor(() => expect(mockCorrectAttendance).toHaveBeenCalledWith(1, expect.objectContaining({
      estado: "absent",
    })));
    expect(mockCorrectAttendance.mock.calls[0][1]).not.toHaveProperty("motivo");
    expect(await screen.findByText("Corrección guardada.")).toBeInTheDocument();
    // Patched from the PATCH response directly — the log never re-fetched, and
    // the session's bar now counts the absence.
    expect(screen.getAllByText("Ausente").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("img", { name: /1 ausente/i }).length).toBeGreaterThan(0);
    expect(mockFetchAttendanceRecords.mock.calls.length).toBe(callsBeforeCorrection);
  });
});

describe("AttendancePage — rail", () => {
  it("shares the trainer's rail: period stats, distribution, sessions without list and the guide", async () => {
    mockFetchAttendanceRecords.mockResolvedValue([
      ...buildRecords(3),
      { ...buildRecords(1)[0], id: "9", estado: "absent" as const },
    ]);
    renderPage();

    const rail = await screen.findByRole("complementary", { name: "Resumen del período" });
    expect(rail).toHaveTextContent("Listas tomadas");
    expect(rail).toHaveTextContent("Distribución del período");
    expect(rail).toHaveTextContent("3 presentes");
    expect(rail).toHaveTextContent("1 ausente");
    expect(within(rail).getByRole("region", { name: "Sin lista en el período" })).toBeInTheDocument();
    expect(within(rail).getByRole("heading", { name: "Cómo leer el historial" })).toBeInTheDocument();
    expect(rail).toHaveTextContent("últimos 30 días");
  });
});

describe("AttendancePage — partial lists on the rail (ENT-13)", () => {
  it("lists a partly-filled list as «N de M registrados» using the roster", async () => {
    // The rail only lists a Monday (the schedule's day) that is already past.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-07-20T15:00:00Z"));
    mockFetchAttendanceRecords.mockResolvedValue(
      buildRecords(2).map((r) => ({ ...r, fecha: "2026-07-06" })),
    );
    mockFetchConteos.mockResolvedValue(
      [1, 2, 3, 4, 5].map((personaId) => ({ personaId, horarioId: 1 })),
    );
    renderPage();

    try {
      expect(await screen.findByText("2 de 5 registrados")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps working when the counts fetch fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockFetchAttendanceRecords.mockResolvedValue(buildRecords(2));
    mockFetchConteos.mockRejectedValue(new Error("boom"));
    renderPage();

    await screen.findAllByRole("row");
    expect(screen.queryByText(/de 5 registrados/)).not.toBeInTheDocument();
  });
});
