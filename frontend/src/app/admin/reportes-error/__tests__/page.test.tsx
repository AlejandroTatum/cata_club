/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import ReportesErrorPage from "../page";
import { fetchReportesError, fetchReporteError } from "@/services/api";

vi.mock("@/components/ProtectedRoute", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/shell/AppShell", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/services/api", () => ({ fetchReportesError: vi.fn(), fetchReporteError: vi.fn() }));

const CHROME = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const report = {
  id: 7, persona_id: 1, descripcion: "El botón de pagar no responde", request_id: "req-7",
  ruta: "/perfil", user_agent: CHROME, captura_mime: "image/png",
  // 02:30 UTC is 21:30 the previous day in America/Guayaquil (UTC-5).
  fecha_creacion: "2026-09-29T02:30:00Z",
};
const other = { ...report, id: 8, descripcion: "Otro problema", ruta: null, request_id: null, user_agent: null, captura_mime: null };

const pagina = (items: typeof report[], total = items.length, skip = 0) => ({ items, total, skip, limit: 10 });
const lote = (desde: number, cantidad: number) =>
  Array.from({ length: cantidad }, (_, i) => ({ ...report, id: desde + i, descripcion: `Problema ${desde + i}` }));

describe("bandeja de reportes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchReportesError).mockResolvedValue(pagina([report, other]));
    vi.mocked(fetchReporteError).mockImplementation(async (id) => (id === 7 ? report : other));
  });
  it("shows a loading state first and never the empty copy", async () => {
    vi.mocked(fetchReportesError).mockReturnValue(new Promise(() => {}));
    render(<ReportesErrorPage />);
    expect(screen.getByText("Cargando reportes…")).toBeInTheDocument();
    expect(screen.queryByText(/Aún no hay reportes/)).not.toBeInTheDocument();
  });
  it("scans each report by date, route and description excerpt", async () => {
    render(<ReportesErrorPage />);
    const row = await screen.findByRole("button", { name: /Reporte #7/ });
    expect(row).toHaveTextContent("/perfil");
    expect(row).toHaveTextContent("El botón de pagar no responde");
  });
  it("formats dates in America/Guayaquil", async () => {
    render(<ReportesErrorPage />);
    const row = await screen.findByRole("button", { name: /Reporte #7/ });
    expect(row).toHaveTextContent(/28 sept 2026.*9:30\s*p\.\s*m\./);
  });
  it("opens the detail with human labels, tracking code in details and keeps the selection visible", async () => {
    render(<ReportesErrorPage />);
    const row = await screen.findByRole("button", { name: /Reporte #7/ });
    fireEvent.click(row);
    const detail = await screen.findByRole("region", { name: "Detalle del reporte 7" });
    expect(row).toHaveAttribute("aria-current", "true");
    expect(within(detail).getByText("Ruta afectada")).toBeInTheDocument();
    expect(within(detail).getByText("/perfil")).toBeInTheDocument();
    expect(within(detail).getByText("Dispositivo / navegador")).toBeInTheDocument();
    expect(within(detail).getByText("Chrome · Linux")).toBeInTheDocument();
    const summary = within(detail).getByText("Código de seguimiento");
    expect(summary.closest("details")).not.toHaveAttribute("open");
    expect(summary.closest("details")).toHaveTextContent("req-7");
    expect(within(detail).getByRole("link", { name: "Ver captura" })).toHaveAttribute("href", "/api/reportes-error/7/captura");
    fireEvent.click(screen.getByRole("button", { name: /Reporte #8/ }));
    await waitFor(() => expect(screen.getByRole("region", { name: "Detalle del reporte 8" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Reporte #8/ })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: /Reporte #7/ })).not.toHaveAttribute("aria-current");
  });
  it("shows a guiding empty state", async () => {
    vi.mocked(fetchReportesError).mockResolvedValue(pagina([]));
    render(<ReportesErrorPage />);
    expect(await screen.findByText("Aún no hay reportes de error")).toBeInTheDocument();
  });
  it("shows an inbox error with retry, without the empty copy", async () => {
    vi.mocked(fetchReportesError).mockRejectedValueOnce(new Error("unavailable"));
    render(<ReportesErrorPage />);
    expect(await screen.findByText("No se pudo cargar la bandeja.")).toBeInTheDocument();
    expect(screen.queryByText(/Aún no hay reportes/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /reintentar/i }));
    expect(await screen.findByRole("button", { name: /Reporte #7/ })).toBeInTheDocument();
  });
  it("keeps a detail failure next to the detail, with retry, and the list intact", async () => {
    vi.mocked(fetchReporteError).mockRejectedValueOnce(new Error("boom"));
    render(<ReportesErrorPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Reporte #7/ }));
    expect(await screen.findByText("No se pudo cargar el reporte.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reporte #8/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /reintentar/i }));
    expect(await screen.findByRole("region", { name: "Detalle del reporte 7" })).toBeInTheDocument();
    expect(screen.queryByText("No se pudo cargar el reporte.")).not.toBeInTheDocument();
  });
  it("guides the reader in the detail column until a report is selected", async () => {
    render(<ReportesErrorPage />);
    await screen.findByRole("button", { name: /Reporte #7/ });

    const detail = screen.getByRole("complementary", { name: "Detalle" });
    expect(within(detail).getByText("Selecciona un reporte de la lista para ver su detalle.")).toBeInTheDocument();
    expect(within(detail).getByText("Hay 2 reportes recibidos.")).toBeInTheDocument();
  });
  it("shows a summary strip derived from the list", async () => {
    render(<ReportesErrorPage />);
    await screen.findByRole("button", { name: /Reporte #7/ });
    const strip = screen.getByLabelText("Resumen de reportes");
    expect(strip).toHaveTextContent("Reportes");
    expect(strip).toHaveTextContent("/perfil");
    expect(strip).toHaveTextContent("Chrome · Linux");
  });
  it("filters the list with the chips", async () => {
    render(<ReportesErrorPage />);
    await screen.findByRole("button", { name: /Reporte #7/ });
    fireEvent.click(screen.getByRole("button", { name: /^\/perfil/ }));
    expect(screen.getByRole("button", { name: /Reporte #7/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reporte #8/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Todos/ }));
    expect(screen.getByRole("button", { name: /Reporte #8/ })).toBeInTheDocument();
  });
  it("explains how reports arrive, also when the inbox is empty", async () => {
    vi.mocked(fetchReportesError).mockResolvedValue(pagina([]));
    render(<ReportesErrorPage />);
    expect(await screen.findByText("Cómo llegan los reportes")).toBeInTheDocument();
    expect(screen.getByText(/solo la administración del club las ve/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Filtrar reportes" })).not.toBeInTheDocument();
  });
  it("shows no filler block under the guide while nothing is selected", async () => {
    render(<ReportesErrorPage />);
    await screen.findByRole("button", { name: /Reporte #7/ });
    expect(screen.queryByTestId("ghost-detail")).not.toBeInTheDocument();
    expect(screen.getByText("Cómo llegan los reportes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Reporte #7/ }));
    await screen.findByRole("region", { name: "Detalle del reporte 7" });
    expect(screen.queryByTestId("ghost-detail")).not.toBeInTheDocument();
    expect(screen.getByText("Cómo llegan los reportes")).toBeInTheDocument();
  });
  it("asks for the first page explicitly and shows the real total in the strip", async () => {
    vi.mocked(fetchReportesError).mockResolvedValue(pagina(lote(100, 10), 25));
    render(<ReportesErrorPage />);
    await screen.findByRole("button", { name: /Reporte #100/ });
    expect(fetchReportesError).toHaveBeenCalledWith({ skip: 0, limit: 10 });
    expect(screen.getByLabelText("Resumen de reportes")).toHaveTextContent("25");
  });
  it("renders a pager when there are more reports than one page and reaches the next page", async () => {
    vi.mocked(fetchReportesError)
      .mockResolvedValueOnce(pagina(lote(100, 10), 25))
      .mockResolvedValueOnce(pagina(lote(200, 10), 25, 10));
    render(<ReportesErrorPage />);
    await screen.findByRole("button", { name: /Reporte #100/ });
    expect(screen.getByText("Página 1 de 3")).toBeInTheDocument();
    expect(screen.getByText(/1–10 de 25 reportes/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Página siguiente" }));
    expect(await screen.findByRole("button", { name: /Reporte #200/ })).toBeInTheDocument();
    expect(fetchReportesError).toHaveBeenLastCalledWith({ skip: 10, limit: 10 });
    expect(screen.getByText("Página 2 de 3")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reporte #100/ })).not.toBeInTheDocument();
  });
  it("shows no pager when everything fits in one page", async () => {
    render(<ReportesErrorPage />);
    await screen.findByRole("button", { name: /Reporte #7/ });
    expect(screen.queryByText(/Página 1 de/)).not.toBeInTheDocument();
  });
  it("keeps the current page and shows a retry when a page change fails", async () => {
    vi.mocked(fetchReportesError)
      .mockResolvedValueOnce(pagina(lote(100, 10), 25))
      .mockRejectedValueOnce(new Error("boom"));
    render(<ReportesErrorPage />);
    await screen.findByRole("button", { name: /Reporte #100/ });
    fireEvent.click(screen.getByRole("button", { name: "Página siguiente" }));
    expect(await screen.findByText("No se pudo cargar la bandeja.")).toBeInTheDocument();
  });
});
