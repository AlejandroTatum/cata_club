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

// Fixed "today" for the clock-dependent correction gate (issue #262): without
// this pin the 30-day window shifts with whatever day the CI happens to run on.
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
    // Header: Sesión, Registró, Resultado, acciones.
    expect(within(rows[0]).getByText("Registró")).toBeInTheDocument();
    expect(within(rows[0]).getAllByRole("columnheader")).toHaveLength(4);

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
    expect(screen.getAllByRole("img", { name: /sobre \d+ registros/ })).toHaveLength(2);
  });

  it("shows Corregir for every session within 30 days when the user is admin", async () => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("admin", "Carlos Mendoza"));
    render(<TrainerAttendanceHistoryPage />);

    const links = await screen.findAllByRole("link", { name: "Corregir" });
    expect(links).toHaveLength(2);
  });

  it("deep-links Corregir into that session's roll call, not the picker", async () => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("admin", "Carlos Mendoza"));
    render(<TrainerAttendanceHistoryPage />);

    const links = await screen.findAllByRole("link", { name: "Corregir" });
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

  it("does not show Corregir to an admin for a session older than 30 days", async () => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("admin", "Carlos Mendoza"));
    const oldRecords: AttendanceRecord[] = [
      record("present", "Sofia Vera", "2026-07-15"),
    ];
    mockFetchAttendanceRecords.mockResolvedValue(oldRecords);

    render(<TrainerAttendanceHistoryPage />);

    await screen.findAllByRole("row");
    expect(screen.queryByRole("link", { name: "Corregir" })).not.toBeInTheDocument();
  });

  it("keeps the table aligned with an empty action cell when Corregir is hidden", async () => {
    render(<TrainerAttendanceHistoryPage />);

    const rows = await screen.findAllByRole("row");
    expect(within(rows[1]).getAllByRole("cell")).toHaveLength(4);
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
    expect(await screen.findByText("Lunes 15:00 — 16:00")).toBeInTheDocument();
    expect(screen.queryByText(/No se pudieron cargar los registros/)).not.toBeInTheDocument();
    expect(within(screen.getByLabelText("Filtrar por horario")).getAllByRole("option")).toHaveLength(
      1,
    );
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
