/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ReportesErrorPage from "../page";
import { fetchReportesError, fetchReporteError } from "@/services/api";

vi.mock("@/components/ProtectedRoute", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/shell/AppShell", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/services/api", () => ({ fetchReportesError: vi.fn(), fetchReporteError: vi.fn() }));

const report = {
  id: 7, persona_id: 1, descripcion: "Datos privados", request_id: "req-7",
  ruta: "/perfil", user_agent: "Browser", captura_mime: "image/png", fecha_creacion: "2026-09-29T09:00:00Z",
};

describe("bandeja de reportes", () => {
  beforeEach(() => { vi.mocked(fetchReportesError).mockResolvedValue([report]); vi.mocked(fetchReporteError).mockResolvedValue(report); });
  it("lists metadata without revealing sensitive description before opening detail", async () => {
    render(<ReportesErrorPage />);
    const button = await screen.findByRole("button", { name: /Reporte #7/ });
    expect(screen.queryByText("Datos privados")).not.toBeInTheDocument();
    fireEvent.click(button);
    expect(await screen.findByText("Datos privados")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver captura" })).toHaveAttribute("href", "/api/reportes-error/7/captura");
  });
  it("reports a failed inbox request", async () => {
    vi.mocked(fetchReportesError).mockRejectedValueOnce(new Error("unavailable"));
    render(<ReportesErrorPage />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("No se pudo cargar la bandeja."));
  });
});
