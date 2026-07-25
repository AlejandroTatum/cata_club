/**
 * Component tests for ReportsPage — "Exportar PDF" button visibility/state.
 * Covers: hidden before search / while loading / on empty results; visible
 * and enabled once results are present; shows a busy state and disables
 * itself while the PDF download is in flight.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ReportsPage from "@/app/reports/page";
import type { PersonaReporte } from "@/types/domain";
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

vi.mock("@/services/api", () => ({
  fetchNuevosPorPeriodo: (...args: unknown[]) => mockFetchNuevosPorPeriodo(...args),
  fetchAttendanceRecords: (...args: unknown[]) => mockFetchAttendanceRecords(...args),
  fetchTrainingSchedules: (...args: unknown[]) => mockFetchTrainingSchedules(...args),
  fetchPagosReporte: (...args: unknown[]) => mockFetchPagosReporte(...args),
  exportNuevosPorPeriodoPdf: (...args: unknown[]) => mockExportNuevosPorPeriodoPdf(...args),
  exportAsistenciaReportePdf: (...args: unknown[]) => mockExportAsistenciaReportePdf(...args),
  exportPagosReportePdf: (...args: unknown[]) => mockExportPagosReportePdf(...args),
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
  proofFileName: "voucher.jpg",
  proofFileType: "image",
  validationStatus: "validado",
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

function setRange(desde: string, hasta: string): void {
  fireEvent.change(screen.getByLabelText("Desde"), { target: { value: desde } });
  fireEvent.change(screen.getByLabelText("Hasta"), { target: { value: hasta } });
}

describe("ReportsPage — preset cards (18-reportes.html)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchTrainingSchedules.mockResolvedValue([]);
    mockFetchAttendanceRecords.mockResolvedValue([]);
    mockFetchPagosReporte.mockResolvedValue([]);
    mockFetchNuevosPorPeriodo.mockResolvedValue([]);
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
  });

  it("tells the user what the empty canvas is waiting for, instead of sitting blank", async () => {
    render(<ReportsPage />);
    await waitFor(() => expect(mockFetchTrainingSchedules).toHaveBeenCalled());

    expect(screen.getByRole("heading", { name: /vista previa — reporte de período/i })).toBeInTheDocument();
    expect(screen.getByText("Elija un rango de fechas")).toBeInTheDocument();
    expect(mockFetchNuevosPorPeriodo).not.toHaveBeenCalled();
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

  it("previews attendance with an open range, because that endpoint allows one", async () => {
    mockFetchAttendanceRecords.mockResolvedValue([ATTENDANCE_RECORD]);
    render(<ReportsPage />);
    await waitFor(() => expect(mockFetchTrainingSchedules).toHaveBeenCalled());

    choosePreset(/asistencia/i);

    await waitFor(() => expect(mockFetchAttendanceRecords).toHaveBeenCalledWith({}));
    expect(await screen.findByText("Ana Pérez")).toBeInTheDocument();
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
    mockFetchNuevosPorPeriodo.mockRejectedValue(new Error("Error al cargar reportes."));
    render(<ReportsPage />);
    await waitFor(() => expect(mockFetchTrainingSchedules).toHaveBeenCalled());

    setRange("2026-01-01", "2026-12-31");
    expect(await screen.findByText("Error al cargar reportes.")).toBeInTheDocument();
  });
});

describe("ReportsPage — date-range validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchTrainingSchedules.mockResolvedValue([]);
    mockFetchAttendanceRecords.mockResolvedValue([]);
    mockFetchPagosReporte.mockResolvedValue([]);
    mockFetchNuevosPorPeriodo.mockResolvedValue([]);
  });

  it("período: never queries with an end date equal to the start date", async () => {
    render(<ReportsPage />);
    await waitFor(() => expect(mockFetchTrainingSchedules).toHaveBeenCalled());

    setRange("2026-05-10", "2026-05-10");
    await waitFor(() => expect(screen.getByText("Elija un rango de fechas")).toBeInTheDocument());
    expect(mockFetchNuevosPorPeriodo).not.toHaveBeenCalled();
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
    await waitFor(() => expect(generateButton()).toBeEnabled());
    fireEvent.click(generateButton());

    await waitFor(() => expect(mockExportAsistenciaReportePdf).toHaveBeenCalledWith({}));
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
