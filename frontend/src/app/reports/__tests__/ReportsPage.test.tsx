/**
 * Component tests for ReportsPage — "Exportar PDF" button visibility/state.
 * Covers: hidden before search / while loading / on empty results; visible
 * and enabled once results are present; shows a busy state and disables
 * itself while the PDF download is in flight.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ReportsPage from "@/app/reports/page";
import type { PersonaBusqueda, PersonaReporte } from "@/types/domain";
import type { PaymentValidationRequest } from "@/services/api";

vi.mock("@/components/ProtectedRoute", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// AppShell renders NotificationBell + needs next/navigation, next/link,
// next/image, AuthContext — same minimal mock pattern as PaymentsPage.test.tsx.
vi.mock("next/navigation", () => ({
  usePathname: () => "/reports",
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

const mockFetchNuevosPorPeriodo = vi.fn();
const mockFetchAttendanceRecords = vi.fn();
const mockFetchTrainingSchedules = vi.fn();
const mockFetchPagosReporte = vi.fn();
const mockExportNuevosPorPeriodoPdf = vi.fn();
const mockExportAsistenciaReportePdf = vi.fn();
const mockExportPagosReportePdf = vi.fn();
const mockSearchStudents = vi.fn();

/**
 * The exact shape a failing call reaches a screen as. Every failure route in
 * `services/api.ts` throws `ApiClientError(message, status)`, so an error
 * carrying a message and no status is a shape the client cannot produce.
 */
class MockApiClientError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
  }
}

vi.mock("@/services/api", () => ({
  fetchNuevosPorPeriodo: (...args: unknown[]) => mockFetchNuevosPorPeriodo(...args),
  fetchAttendanceRecords: (...args: unknown[]) => mockFetchAttendanceRecords(...args),
  fetchTrainingSchedules: (...args: unknown[]) => mockFetchTrainingSchedules(...args),
  fetchPagosReporte: (...args: unknown[]) => mockFetchPagosReporte(...args),
  exportNuevosPorPeriodoPdf: (...args: unknown[]) => mockExportNuevosPorPeriodoPdf(...args),
  exportAsistenciaReportePdf: (...args: unknown[]) => mockExportAsistenciaReportePdf(...args),
  exportPagosReportePdf: (...args: unknown[]) => mockExportPagosReportePdf(...args),
  searchStudents: (...args: unknown[]) => mockSearchStudents(...args),
}));

const PERSONA: PersonaReporte = {
  id: 1,
  nombres: "Juan",
  apellidos: "Pérez",
  cedula: "1710034065",
  fechaNacimiento: "2010-05-14",
  telefono: "0991234567",
};

const PAGO: PaymentValidationRequest = {
  id: "1",
  studentName: "Juan Pérez",
  responsablePagoName: "Juan Pérez",
  membershipPeriod: "2026-07-01 – 2026-07-31",
  membershipType: "Adultos (18:00-19:00)",
  expectedAmount: 35,
  paymentMethod: "Transferencia",
  uploadedAt: "2026-07-01T09:00:00Z",
  currentMembershipStatus: "activa",
  proofFileType: "image",
  validationStatus: "validado",
  startDate: "2026-07-01",
  endDate: "2026-07-31",
};

const ALUMNO: PersonaBusqueda = {
  id: 35,
  nombres: "Ana",
  apellidos: "García",
};

const ATTENDANCE_RECORD = {
  id: "a1",
  fecha: "2026-07-01",
  horario: "Lunes 15:00–16:00",
  estudiante: "Ana Pérez",
  estado: "presente" as const,
  entrenador: "Carlos Mendoza",
};

function generateButton(): HTMLElement {
  return screen.getByRole("button", { name: /generar pdf/i });
}

/** Pick one of the three preset cards. */
function choosePreset(name: RegExp): void {
  fireEvent.click(screen.getByRole("radio", { name }));
}

/** Pick one of the six quick date-range pills (issue #201). */
function chooseRangePreset(name: string): void {
  fireEvent.click(screen.getByRole("button", { name }));
}

/**
 * Switches the shared range to "Personalizado" — which is what reveals the
 * "Desde"/"Hasta" pickers, per issue #201 — and fills it in. A no-op click if
 * "Personalizado" is already active, so tests that start there stay correct.
 */
function setRange(desde: string, hasta: string): void {
  const custom = screen.getByRole("button", { name: "Personalizado" });
  if (custom.getAttribute("aria-pressed") !== "true") {
    fireEvent.click(custom);
  }
  fireEvent.change(screen.getByLabelText("Desde"), { target: { value: desde } });
  fireEvent.change(screen.getByLabelText("Hasta"), { target: { value: hasta } });
}

/** Types into the alumno search and picks the first suggestion offered. */
async function pickStudent(): Promise<void> {
  mockSearchStudents.mockResolvedValue([ALUMNO]);
  fireEvent.change(screen.getByLabelText("Buscar alumno"), { target: { value: "Ana" } });
  fireEvent.click(await screen.findByRole("option", { name: /Ana García/i }));
}

describe("ReportsPage — preset cards (18-reportes.html)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchTrainingSchedules.mockResolvedValue([]);
    mockFetchAttendanceRecords.mockResolvedValue([]);
    mockFetchPagosReporte.mockResolvedValue([]);
    mockFetchNuevosPorPeriodo.mockResolvedValue([]);
    mockSearchStudents.mockResolvedValue([]);
  });

  it("offers exactly the three reports the backend can actually produce", async () => {
    render(<ReportsPage />);
    await waitFor(() => expect(mockFetchTrainingSchedules).toHaveBeenCalled());

    const presets = screen.getAllByRole("radio");
    expect(presets).toHaveLength(3);
    expect(presets[0]).toHaveTextContent("Reporte de período");
    expect(presets[1]).toHaveTextContent("Reporte de asistencia");
    expect(presets[2]).toHaveTextContent("Reporte de pagos");
    // There is no etiquetas/label generator in the backend — see the page docstring.
    expect(screen.queryByText(/etiquetas/i)).not.toBeInTheDocument();
  });

  it("marks the selected preset with the coal + ball-dot treatment, never red", async () => {
    render(<ReportsPage />);
    await waitFor(() => expect(mockFetchTrainingSchedules).toHaveBeenCalled());

    const [periodo, asistencia] = screen.getAllByRole("radio");
    expect(periodo).toHaveAttribute("aria-checked", "true");
    expect(periodo.className).toContain("border-coal");
    expect(periodo.className).not.toMatch(/cata-red|border-red/);
    expect(screen.getByTestId("preset-ball-dot")).toBeInTheDocument();

    fireEvent.click(asistencia);
    await waitFor(() => expect(asistencia).toHaveAttribute("aria-checked", "true"));
    expect(periodo).toHaveAttribute("aria-checked", "false");
  });

  it("keeps ONE date range shared across presets instead of a pair per report", async () => {
    render(<ReportsPage />);
    await waitFor(() => expect(mockFetchTrainingSchedules).toHaveBeenCalled());

    setRange("2026-01-01", "2026-12-31");
    choosePreset(/asistencia/i);

    await waitFor(() => {
      expect(mockFetchAttendanceRecords).toHaveBeenCalledWith(
        expect.objectContaining({ fechaInicio: "2026-01-01", fechaFin: "2026-12-31" }),
      );
    });
    // The range survived the preset switch — it is not re-entered per report.
    expect(screen.getByLabelText("Desde")).toHaveValue("2026-01-01");
  });

  it("has no 'Buscar' button — the preview generates itself from the selection", async () => {
    render(<ReportsPage />);
    await waitFor(() => expect(mockFetchTrainingSchedules).toHaveBeenCalled());

    expect(screen.queryByRole("button", { name: /^buscar$/i })).not.toBeInTheDocument();
  });
});

describe("ReportsPage — preview area", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchTrainingSchedules.mockResolvedValue([]);
    mockFetchAttendanceRecords.mockResolvedValue([]);
    mockFetchPagosReporte.mockResolvedValue([]);
    mockFetchNuevosPorPeriodo.mockResolvedValue([]);
    mockSearchStudents.mockResolvedValue([]);
  });

  it("tells the user what the empty canvas is waiting for, instead of sitting blank", async () => {
    render(<ReportsPage />);
    await waitFor(() => expect(mockFetchTrainingSchedules).toHaveBeenCalled());
    mockFetchNuevosPorPeriodo.mockClear();

    // "Este mes" is the default and already resolves a usable range (see the
    // next test) — the still-reachable empty state is "Personalizado" with
    // nothing typed in yet.
    chooseRangePreset("Personalizado");

    expect(screen.getByRole("heading", { name: /vista previa — reporte de período/i })).toBeInTheDocument();
    expect(screen.getByText("Elija un rango de fechas")).toBeInTheDocument();
    expect(mockFetchNuevosPorPeriodo).not.toHaveBeenCalled();
  });

  it("defaults to 'Este mes' and previews it immediately, with no manual entry", async () => {
    mockFetchNuevosPorPeriodo.mockResolvedValue([PERSONA]);
    render(<ReportsPage />);
    await waitFor(() => expect(mockFetchTrainingSchedules).toHaveBeenCalled());

    expect(screen.getByRole("button", { name: "Este mes" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(mockFetchNuevosPorPeriodo).toHaveBeenCalled());
    const [fechaInicio, fechaFin] = mockFetchNuevosPorPeriodo.mock.calls[0] as [string, string];
    expect(fechaInicio).toMatch(/^\d{4}-\d{2}-01$/);
    expect(fechaFin).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Manual "Desde"/"Hasta" are hidden until "Personalizado" is chosen.
    expect(screen.queryByLabelText("Desde")).not.toBeInTheDocument();
  });

  it("never defaults to 'Histórico completo' and never queries it on load", async () => {
    render(<ReportsPage />);
    await waitFor(() => expect(mockFetchTrainingSchedules).toHaveBeenCalled());

    expect(screen.getByRole("button", { name: "Histórico completo" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await waitFor(() => expect(mockFetchNuevosPorPeriodo).toHaveBeenCalled());
    expect(mockFetchNuevosPorPeriodo).not.toHaveBeenCalledWith("2013-10-10", expect.anything());
  });

  it("resolves 'Histórico completo' to the club's founding date only once explicitly chosen", async () => {
    mockFetchNuevosPorPeriodo.mockResolvedValue([PERSONA]);
    render(<ReportsPage />);
    await waitFor(() => expect(mockFetchTrainingSchedules).toHaveBeenCalled());
    mockFetchNuevosPorPeriodo.mockClear();

    chooseRangePreset("Histórico completo");

    await waitFor(() => {
      expect(mockFetchNuevosPorPeriodo).toHaveBeenCalledWith("2013-10-10", expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
    });
    // One click, one effective query — the debounce does not double-fire.
    expect(mockFetchNuevosPorPeriodo).toHaveBeenCalledTimes(1);
  });

  it("shows the named empty state for the pagos histórico, same as any other empty range", async () => {
    mockFetchPagosReporte.mockResolvedValue([]);
    render(<ReportsPage />);
    await waitFor(() => expect(mockFetchTrainingSchedules).toHaveBeenCalled());

    choosePreset(/pagos/i);
    await waitFor(() => expect(mockFetchPagosReporte).toHaveBeenCalled());
    mockFetchPagosReporte.mockClear();

    chooseRangePreset("Histórico completo");

    await waitFor(() => expect(mockFetchPagosReporte).toHaveBeenCalled());
    expect(await screen.findByText("No se encontraron pagos")).toBeInTheDocument();
  });

  it("keeps the chosen range preset when switching report tabs (same vocabulary for all three)", async () => {
    render(<ReportsPage />);
    await waitFor(() => expect(mockFetchTrainingSchedules).toHaveBeenCalled());

    chooseRangePreset("Últimos 3 meses");
    expect(screen.getByRole("button", { name: "Últimos 3 meses" })).toHaveAttribute("aria-pressed", "true");

    choosePreset(/pagos/i);
    expect(screen.getByRole("button", { name: "Últimos 3 meses" })).toHaveAttribute("aria-pressed", "true");
  });

  it("generates the período preview as soon as the range is complete", async () => {
    mockFetchNuevosPorPeriodo.mockResolvedValue([PERSONA]);
    render(<ReportsPage />);
    await waitFor(() => expect(mockFetchTrainingSchedules).toHaveBeenCalled());

    setRange("2026-01-01", "2026-12-31");

    await waitFor(() => {
      expect(mockFetchNuevosPorPeriodo).toHaveBeenCalledWith("2026-01-01", "2026-12-31");
    });
    expect(await screen.findByText("Juan Pérez")).toBeInTheDocument();
  });

  it("states the preview's scope as a count badge", async () => {
    mockFetchNuevosPorPeriodo.mockResolvedValue([PERSONA]);
    render(<ReportsPage />);
    await waitFor(() => expect(mockFetchTrainingSchedules).toHaveBeenCalled());

    setRange("2026-01-01", "2026-12-31");
    expect(await screen.findByText("1 persona")).toBeInTheDocument();
  });

  it("shows a named empty state when the range yields nothing", async () => {
    mockFetchNuevosPorPeriodo.mockResolvedValue([]);
    render(<ReportsPage />);
    await waitFor(() => expect(mockFetchTrainingSchedules).toHaveBeenCalled());

    setRange("2026-01-01", "2026-12-31");
    expect(await screen.findByText("No se encontraron personas")).toBeInTheDocument();
  });

  it("previews attendance with an open range, when 'Personalizado' is chosen with nothing typed", async () => {
    mockFetchAttendanceRecords.mockResolvedValue([ATTENDANCE_RECORD]);
    render(<ReportsPage />);
    await waitFor(() => expect(mockFetchTrainingSchedules).toHaveBeenCalled());

    choosePreset(/asistencia/i);
    chooseRangePreset("Personalizado");

    await waitFor(() => expect(mockFetchAttendanceRecords).toHaveBeenCalledWith({}));
    expect(await screen.findByText("Ana Pérez")).toBeInTheDocument();
  });

  it("narrows the asistencia preview to one alumno through the shared student search (ASI-7)", async () => {
    mockFetchAttendanceRecords.mockResolvedValue([ATTENDANCE_RECORD]);
    render(<ReportsPage />);
    await waitFor(() => expect(mockFetchTrainingSchedules).toHaveBeenCalled());

    choosePreset(/asistencia/i);
    await waitFor(() => expect(mockFetchAttendanceRecords).toHaveBeenCalled());
    mockFetchAttendanceRecords.mockClear();

    await pickStudent();

    await waitFor(() => {
      expect(mockFetchAttendanceRecords).toHaveBeenCalledWith(
        expect.objectContaining({ personaId: 35 }),
      );
    });
  });

  it("drops the alumno from the next preview when the search's X is pressed (issue #200)", async () => {
    mockFetchAttendanceRecords.mockResolvedValue([ATTENDANCE_RECORD]);
    render(<ReportsPage />);
    await waitFor(() => expect(mockFetchTrainingSchedules).toHaveBeenCalled());

    choosePreset(/asistencia/i);
    await waitFor(() => expect(mockFetchAttendanceRecords).toHaveBeenCalled());
    mockFetchAttendanceRecords.mockClear();

    await pickStudent();
    await waitFor(() => {
      expect(mockFetchAttendanceRecords).toHaveBeenCalledWith(
        expect.objectContaining({ personaId: 35 }),
      );
    });
    mockFetchAttendanceRecords.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Limpiar búsqueda" }));

    await waitFor(() => {
      const lastCall = mockFetchAttendanceRecords.mock.calls.at(-1)?.[0];
      expect(lastCall).toBeDefined();
      expect(lastCall).not.toHaveProperty("personaId");
    });
  });

  it("drops the alumno from the next preview when the text is edited after selecting (issue #200)", async () => {
    mockFetchAttendanceRecords.mockResolvedValue([ATTENDANCE_RECORD]);
    render(<ReportsPage />);
    await waitFor(() => expect(mockFetchTrainingSchedules).toHaveBeenCalled());

    choosePreset(/asistencia/i);
    await waitFor(() => expect(mockFetchAttendanceRecords).toHaveBeenCalled());
    mockFetchAttendanceRecords.mockClear();

    await pickStudent();
    await waitFor(() => {
      expect(mockFetchAttendanceRecords).toHaveBeenCalledWith(
        expect.objectContaining({ personaId: 35 }),
      );
    });
    mockFetchAttendanceRecords.mockClear();

    fireEvent.change(screen.getByLabelText("Buscar alumno"), { target: { value: "Ana Garcí" } });

    await waitFor(() => {
      const lastCall = mockFetchAttendanceRecords.mock.calls.at(-1)?.[0];
      expect(lastCall).toBeDefined();
      expect(lastCall).not.toHaveProperty("personaId");
    });
  });

  it("previews pagos with the estado filter applied", async () => {
    mockFetchPagosReporte.mockResolvedValue([PAGO]);
    render(<ReportsPage />);
    await waitFor(() => expect(mockFetchTrainingSchedules).toHaveBeenCalled());

    choosePreset(/pagos/i);
    await waitFor(() => expect(mockFetchPagosReporte).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "APROBADO" } });
    await waitFor(() => {
      expect(mockFetchPagosReporte).toHaveBeenCalledWith(
        expect.objectContaining({ estadoPago: "APROBADO" }),
      );
    });
  });

  it("surfaces a fetch failure instead of showing a stale or empty preview as success", async () => {
    // The report aggregation failed server-side on GET /reportes/nuevos —
    // nothing the user typed into the date range caused it and nothing they
    // can retype fixes it, so the 500's own `detail` has nothing to add.
    mockFetchNuevosPorPeriodo.mockRejectedValue(
      new MockApiClientError("Error al cargar reportes.", 500),
    );
    render(<ReportsPage />);
    await waitFor(() => expect(mockFetchTrainingSchedules).toHaveBeenCalled());

    setRange("2026-01-01", "2026-12-31");
    expect(
      await screen.findByText("Tuvimos un problema de nuestro lado y no pudimos completar esto. Escríbanos por WhatsApp y lo ayudamos: https://wa.me/593994219619"),
    ).toBeInTheDocument();
  });
});

describe("ReportsPage — date-range validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchTrainingSchedules.mockResolvedValue([]);
    mockFetchAttendanceRecords.mockResolvedValue([]);
    mockFetchPagosReporte.mockResolvedValue([]);
    mockFetchNuevosPorPeriodo.mockResolvedValue([]);
    mockSearchStudents.mockResolvedValue([]);
  });

  /**
   * A single day is a legitimate range, not an inverted one: the período
   * endpoint filters inclusively on both ends (see the `>` in
   * `personas_router.py`), so `desde == hasta` asks for exactly that day.
   * This screen used to refuse it locally with `>=` and sit on the "Elija un
   * rango de fechas" empty state, which made the "Hoy" pill a dead end on the
   * report that is selected by default.
   */
  it("período: queries the single day when both ends are the same date", async () => {
    render(<ReportsPage />);
    await waitFor(() => expect(mockFetchTrainingSchedules).toHaveBeenCalled());
    mockFetchNuevosPorPeriodo.mockClear();

    setRange("2026-05-10", "2026-05-10");

    await waitFor(() => {
      expect(mockFetchNuevosPorPeriodo).toHaveBeenCalledWith("2026-05-10", "2026-05-10");
    });
    expect(
      screen.queryByText("La fecha de inicio debe ser anterior a la fecha de fin."),
    ).not.toBeInTheDocument();
  });

  /**
   * The bug a human tester reported in QA round 1: picking "Hoy" answered
   * with "La fecha de inicio debe ser anterior a la fecha de fin." instead of
   * a report. "Hoy" resolves to `desde == hasta` by definition, so every gate
   * it crosses has to accept an equal pair — this screen's own, and the two
   * routers behind it (locked by `test_reportes.py`).
   */
  it("'Hoy' previews a single-day range instead of the inverted-range error", async () => {
    render(<ReportsPage />);
    await waitFor(() => expect(mockFetchTrainingSchedules).toHaveBeenCalled());
    mockFetchNuevosPorPeriodo.mockClear();

    chooseRangePreset("Hoy");

    await waitFor(() => expect(mockFetchNuevosPorPeriodo).toHaveBeenCalled());
    const [fechaInicio, fechaFin] = mockFetchNuevosPorPeriodo.mock.calls[0] as [string, string];
    expect(fechaInicio).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(fechaFin).toBe(fechaInicio);
    expect(
      screen.queryByText("La fecha de inicio debe ser anterior a la fecha de fin."),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Elija un rango de fechas")).not.toBeInTheDocument();
  });

  it("período: never queries with an end date before the start date", async () => {
    render(<ReportsPage />);
    await waitFor(() => expect(mockFetchTrainingSchedules).toHaveBeenCalled());

    setRange("2026-05-20", "2026-05-10");
    expect(await screen.findByText("La fecha de inicio debe ser anterior a la fecha de fin.")).toBeInTheDocument();
    expect(mockFetchNuevosPorPeriodo).not.toHaveBeenCalled();
  });

  it("asistencia: rejects an inverted range, but allows a single-day one", async () => {
    render(<ReportsPage />);
    await waitFor(() => expect(mockFetchTrainingSchedules).toHaveBeenCalled());

    choosePreset(/asistencia/i);
    await waitFor(() => expect(mockFetchAttendanceRecords).toHaveBeenCalled());
    mockFetchAttendanceRecords.mockClear();

    setRange("2026-05-20", "2026-05-10");
    expect(await screen.findByText("La fecha de inicio debe ser anterior a la fecha de fin.")).toBeInTheDocument();
    expect(mockFetchAttendanceRecords).not.toHaveBeenCalled();

    setRange("2026-05-10", "2026-05-10");
    await waitFor(() => {
      expect(mockFetchAttendanceRecords).toHaveBeenCalledWith(
        expect.objectContaining({ fechaInicio: "2026-05-10", fechaFin: "2026-05-10" }),
      );
    });
  });
});

describe("ReportsPage — Generar PDF", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchTrainingSchedules.mockResolvedValue([]);
    mockFetchAttendanceRecords.mockResolvedValue([]);
    mockFetchPagosReporte.mockResolvedValue([]);
    mockFetchNuevosPorPeriodo.mockResolvedValue([]);
    mockSearchStudents.mockResolvedValue([]);
  });

  it("stays disabled until the preview actually has rows to export", async () => {
    mockFetchNuevosPorPeriodo.mockResolvedValue([]);
    render(<ReportsPage />);
    await waitFor(() => expect(mockFetchTrainingSchedules).toHaveBeenCalled());

    expect(generateButton()).toBeDisabled();

    setRange("2026-01-01", "2026-12-31");
    await waitFor(() => expect(mockFetchNuevosPorPeriodo).toHaveBeenCalled());
    expect(generateButton()).toBeDisabled();
  });

  it("exports the período report with the range on screen", async () => {
    mockFetchNuevosPorPeriodo.mockResolvedValue([PERSONA]);
    mockExportNuevosPorPeriodoPdf.mockResolvedValue(undefined);
    render(<ReportsPage />);
    await waitFor(() => expect(mockFetchTrainingSchedules).toHaveBeenCalled());

    setRange("2026-01-01", "2026-12-31");
    await waitFor(() => expect(generateButton()).toBeEnabled());
    fireEvent.click(generateButton());

    await waitFor(() => {
      expect(mockExportNuevosPorPeriodoPdf).toHaveBeenCalledWith("2026-01-01", "2026-12-31");
    });
  });

  it("exports the asistencia report with its horario filter", async () => {
    mockFetchAttendanceRecords.mockResolvedValue([ATTENDANCE_RECORD]);
    mockExportAsistenciaReportePdf.mockResolvedValue(undefined);
    render(<ReportsPage />);
    await waitFor(() => expect(mockFetchTrainingSchedules).toHaveBeenCalled());

    choosePreset(/asistencia/i);
    chooseRangePreset("Personalizado");
    await waitFor(() => expect(generateButton()).toBeEnabled());
    fireEvent.click(generateButton());

    await waitFor(() => expect(mockExportAsistenciaReportePdf).toHaveBeenCalledWith({}));
  });

  it("exports the asistencia PDF scoped to the selected alumno (ASI-7)", async () => {
    mockFetchAttendanceRecords.mockResolvedValue([ATTENDANCE_RECORD]);
    mockExportAsistenciaReportePdf.mockResolvedValue(undefined);
    render(<ReportsPage />);
    await waitFor(() => expect(mockFetchTrainingSchedules).toHaveBeenCalled());

    choosePreset(/asistencia/i);
    await waitFor(() => expect(generateButton()).toBeEnabled());
    await pickStudent();

    await waitFor(() => expect(generateButton()).toBeEnabled());
    fireEvent.click(generateButton());

    await waitFor(() => {
      expect(mockExportAsistenciaReportePdf).toHaveBeenCalledWith(
        expect.objectContaining({ personaId: 35 }),
      );
    });
  });

  it("exports the pagos report", async () => {
    mockFetchPagosReporte.mockResolvedValue([PAGO]);
    mockExportPagosReportePdf.mockResolvedValue(undefined);
    render(<ReportsPage />);
    await waitFor(() => expect(mockFetchTrainingSchedules).toHaveBeenCalled());

    choosePreset(/pagos/i);
    await waitFor(() => expect(generateButton()).toBeEnabled());
    fireEvent.click(generateButton());

    await waitFor(() => expect(mockExportPagosReportePdf).toHaveBeenCalled());
  });

  it("shows a busy state and disables itself while the download is in flight", async () => {
    mockFetchNuevosPorPeriodo.mockResolvedValue([PERSONA]);
    let resolveExport: () => void = () => {};
    mockExportNuevosPorPeriodoPdf.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveExport = resolve;
      }),
    );

    render(<ReportsPage />);
    await waitFor(() => expect(mockFetchTrainingSchedules).toHaveBeenCalled());
    setRange("2026-01-01", "2026-12-31");
    await waitFor(() => expect(generateButton()).toBeEnabled());

    fireEvent.click(generateButton());
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /generando/i })).toBeDisabled();
    });

    resolveExport();
    await waitFor(() => expect(generateButton()).toBeEnabled());
  });

  it("reports a failed download instead of failing silently", async () => {
    mockFetchNuevosPorPeriodo.mockResolvedValue([PERSONA]);
    mockExportNuevosPorPeriodoPdf.mockRejectedValue(new Error("No se pudo generar el PDF del reporte."));

    render(<ReportsPage />);
    await waitFor(() => expect(mockFetchTrainingSchedules).toHaveBeenCalled());
    setRange("2026-01-01", "2026-12-31");
    await waitFor(() => expect(generateButton()).toBeEnabled());
    fireEvent.click(generateButton());

    expect(await screen.findByText("No se pudo generar el PDF del reporte.")).toBeInTheDocument();
  });
});

/**
 * ReportsPage — Descargar CSV.
 *
 * The CSV has no backend endpoint (the whole of `backend/` has no CSV route),
 * so the control builds the file in the browser from the result set the page
 * already holds. These tests pin the two things that make that honest rather
 * than a fake: the button is only live when there is something to export, and
 * what it writes is the FULL result set with the preview's own columns — not
 * the visible page, and not an empty file.
 */
describe("ReportsPage — Descargar CSV", () => {
  let capturedBlob: Blob | null;
  let capturedFilename: string;
  let originalCreateObjectURL: typeof URL.createObjectURL;
  let originalRevokeObjectURL: typeof URL.revokeObjectURL;

  function csvButton(): HTMLElement {
    return screen.getByRole("button", { name: /descargar csv/i });
  }

  /** The text of the file the page just handed to the browser. */
  async function downloadedCsv(): Promise<string> {
    if (capturedBlob === null) throw new Error("no se generó ningún archivo");
    return capturedBlob.text();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchTrainingSchedules.mockResolvedValue([]);
    mockFetchAttendanceRecords.mockResolvedValue([]);
    mockFetchPagosReporte.mockResolvedValue([]);
    mockFetchNuevosPorPeriodo.mockResolvedValue([]);
    mockSearchStudents.mockResolvedValue([]);

    capturedBlob = null;
    capturedFilename = "";
    // jsdom implements neither object-URL method, so the download path needs
    // both stubbed; the Blob itself is real and is what the assertions read.
    originalCreateObjectURL = URL.createObjectURL;
    originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn((blob: Blob): string => {
      capturedBlob = blob;
      return "blob:mock";
    }) as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL;

    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      capturedFilename = this.download;
    });
  });

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    vi.restoreAllMocks();
  });

  it("stays disabled until the preview actually has rows to export", async () => {
    render(<ReportsPage />);
    await waitFor(() => expect(mockFetchTrainingSchedules).toHaveBeenCalled());

    expect(csvButton()).toBeDisabled();

    setRange("2026-01-01", "2026-12-31");
    await waitFor(() => expect(mockFetchNuevosPorPeriodo).toHaveBeenCalled());
    // The range is valid but the report came back empty — still nothing to write.
    expect(csvButton()).toBeDisabled();
  });

  it("writes the período rows with the preview's own columns", async () => {
    mockFetchNuevosPorPeriodo.mockResolvedValue([PERSONA]);
    render(<ReportsPage />);
    await waitFor(() => expect(mockFetchTrainingSchedules).toHaveBeenCalled());

    setRange("2026-01-01", "2026-12-31");
    await waitFor(() => expect(csvButton()).toBeEnabled());
    fireEvent.click(csvButton());

    const csv = await downloadedCsv();
    expect(csv).toContain("Nombres,Apellidos,Cédula");
    expect(csv).toContain("Juan");
    expect(csv).toContain("Pérez");
    expect(csv).toContain("1710034065");
    expect(capturedFilename).toMatch(/^reporte-periodo_\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it("exports every row of the range, not just the visible page", async () => {
    const many = Array.from({ length: 23 }, (_, i) => ({
      ...PERSONA,
      id: i + 1,
      nombres: `Alumno${i}`,
    }));
    mockFetchNuevosPorPeriodo.mockResolvedValue(many);
    render(<ReportsPage />);
    await waitFor(() => expect(mockFetchTrainingSchedules).toHaveBeenCalled());

    setRange("2026-01-01", "2026-12-31");
    await waitFor(() => expect(csvButton()).toBeEnabled());
    fireEvent.click(csvButton());

    // 23 rows + 1 header. The preview only shows 10 of them at a time.
    const csv = await downloadedCsv();
    expect(csv.trim().split("\r\n")).toHaveLength(24);
    expect(csv).toContain("Alumno22");
  });

  it("names the file after the preset that is selected", async () => {
    mockFetchPagosReporte.mockResolvedValue([PAGO]);
    render(<ReportsPage />);
    await waitFor(() => expect(mockFetchTrainingSchedules).toHaveBeenCalled());

    choosePreset(/reporte de pagos/i);
    await waitFor(() => expect(csvButton()).toBeEnabled());
    fireEvent.click(csvButton());

    expect(capturedFilename).toMatch(/^reporte-pagos_\d{4}-\d{2}-\d{2}\.csv$/);
    expect(await downloadedCsv()).toContain("Estudiante,Responsable de pago");
  });
});

/**
 * #821 — the mobile listing container scrolls horizontally but held nothing
 * focusable, so a keyboard user had no way to reach or scroll it: axe flags
 * this as `scrollable-region-focusable` (serious). jsdom cannot compute
 * overflow, so the lock is the container's attributes, not the scroll itself.
 */
describe("ReportsPage — the listing container is keyboard-reachable (#821)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchTrainingSchedules.mockResolvedValue([]);
    mockFetchAttendanceRecords.mockResolvedValue([]);
    mockFetchPagosReporte.mockResolvedValue([]);
    mockFetchNuevosPorPeriodo.mockResolvedValue([]);
    mockSearchStudents.mockResolvedValue([]);
  });

  it("makes the período listing focusable and named for assistive tech", async () => {
    mockFetchNuevosPorPeriodo.mockResolvedValue([PERSONA]);
    render(<ReportsPage />);
    await waitFor(() => expect(mockFetchNuevosPorPeriodo).toHaveBeenCalled());

    const region = await screen.findByRole("region", { name: /tabla desplazable/i });
    expect(region).toHaveAttribute("tabIndex", "0");
  });

  it("makes the asistencia listing focusable and named for assistive tech", async () => {
    mockFetchAttendanceRecords.mockResolvedValue([ATTENDANCE_RECORD]);
    render(<ReportsPage />);
    await waitFor(() => expect(mockFetchTrainingSchedules).toHaveBeenCalled());

    choosePreset(/asistencia/i);
    await waitFor(() => expect(mockFetchAttendanceRecords).toHaveBeenCalled());

    const region = await screen.findByRole("region", { name: /tabla desplazable/i });
    expect(region).toHaveAttribute("tabIndex", "0");
  });

  it("makes the pagos listing focusable and named for assistive tech", async () => {
    mockFetchPagosReporte.mockResolvedValue([PAGO]);
    render(<ReportsPage />);
    await waitFor(() => expect(mockFetchTrainingSchedules).toHaveBeenCalled());

    choosePreset(/pagos/i);
    await waitFor(() => expect(mockFetchPagosReporte).toHaveBeenCalled());

    const region = await screen.findByRole("region", { name: /tabla desplazable/i });
    expect(region).toHaveAttribute("tabIndex", "0");
  });
});
