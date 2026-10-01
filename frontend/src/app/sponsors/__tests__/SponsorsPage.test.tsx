/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SponsorsPage from "../page";

const fetchSponsors = vi.fn(); const crearSponsor = vi.fn(); const eliminarSponsor = vi.fn();
const showSuccess = vi.fn(); const showError = vi.fn();
vi.mock("@/contexts/ToastContext", () => ({ useToast: () => ({ showToast: vi.fn(), showSuccess, showError }) }));
vi.mock("@/components/ProtectedRoute", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/shell/AppShell", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/services/api", () => ({ fetchSponsors: () => fetchSponsors(), crearSponsor: (...args: unknown[]) => crearSponsor(...args), eliminarSponsor: (id: number) => eliminarSponsor(id) }));

const fail = (message: string, status: number): Error => Object.assign(new Error(message), { status });
const logo = () => new File(["logo"], "logo.png", { type: "image/png" });

describe("SponsorsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchSponsors.mockResolvedValue([{ id: 1, nombre: "Municipio", logoUrl: "https://cdn/logo.png" }]);
    crearSponsor.mockResolvedValue({}); eliminarSponsor.mockResolvedValue(undefined);
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:preview"), revokeObjectURL: vi.fn() }));
  });
  it("lists uploaded logos with meaningful alt text, lazy loading and dimensions", async () => {
    render(<SponsorsPage />);
    const img = await screen.findByRole("img", { name: "Logo de Municipio" });
    expect(img).toHaveAttribute("src", "https://cdn/logo.png");
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img).toHaveAttribute("width"); expect(img).toHaveAttribute("height");
  });
  it("shows each logo on a tile with the landing strip's 5:2 proportions, name below", async () => {
    render(<SponsorsPage />);
    const img = await screen.findByRole("img", { name: "Logo de Municipio" });
    expect(img).toHaveClass("object-contain");
    expect(img.parentElement?.style.aspectRatio).toBe("5 / 2");
    expect(screen.getByText("Municipio")).toBeInTheDocument();
  });
  it("lays the logos out as a grid, not full-width rows", async () => {
    render(<SponsorsPage />);
    const img = await screen.findByRole("img", { name: "Logo de Municipio" });
    expect(img.closest("ul")).toHaveClass("grid");
  });
  it("frames the preview like the landing tile and shows the chosen file name", async () => {
    render(<SponsorsPage />); await screen.findByText("Municipio");
    expect(screen.getByTestId("sponsor-preview").style.aspectRatio).toBe("5 / 2");
    fireEvent.change(screen.getByLabelText("Logo (JPG o PNG)"), { target: { files: [logo()] } });
    expect(screen.getByText("logo.png")).toBeInTheDocument();
    expect(screen.getByAltText("Vista previa del logo seleccionado").parentElement).toBe(screen.getByTestId("sponsor-preview"));
  });
  it("shows a loading state and never the empty copy while loading", async () => {
    fetchSponsors.mockReturnValue(new Promise(() => {}));
    render(<SponsorsPage />);
    expect(screen.getByText("Cargando patrocinadores…")).toBeInTheDocument();
    expect(screen.queryByText(/Aún no hay patrocinadores/)).not.toBeInTheDocument();
  });
  it("shows a guiding empty state when there are no sponsors", async () => {
    fetchSponsors.mockResolvedValue([]);
    render(<SponsorsPage />);
    expect(await screen.findByText("Aún no hay patrocinadores cargados")).toBeInTheDocument();
    expect(screen.getByText("Los logos cargados aparecen aquí y en la landing.")).toBeInTheDocument();
    expect(screen.getByTestId("empty-grid-tiles").firstElementChild).toHaveStyle({ aspectRatio: "5 / 2" });
    expect(screen.getByRole("region", { name: "Logos cargados" })).not.toHaveClass("lg:self-stretch");
  });
  it("shows an error with retry on load failure, without the empty copy", async () => {
    fetchSponsors.mockRejectedValueOnce(new Error("boom"));
    render(<SponsorsPage />);
    expect(await screen.findByText("No se pudieron cargar los patrocinadores.")).toBeInTheDocument();
    expect(screen.queryByText(/Aún no hay patrocinadores/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /reintentar/i }));
    expect(await screen.findByRole("img", { name: "Logo de Municipio" })).toBeInTheDocument();
  });
  it("requires both the name and logo before upload and focuses the error", async () => {
    render(<SponsorsPage />); await screen.findByText("Municipio");
    fireEvent.click(screen.getByRole("button", { name: "Subir logo" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/nombre y seleccione/i);
    expect(alert).toHaveFocus();
    expect(crearSponsor).not.toHaveBeenCalled();
  });
  it("previews the chosen logo, uploads, resets the form and toasts success", async () => {
    render(<SponsorsPage />); await screen.findByText("Municipio");
    fireEvent.change(screen.getByLabelText("Nombre corto"), { target: { value: "Club Sol" } });
    fireEvent.change(screen.getByLabelText("Logo (JPG o PNG)"), { target: { files: [logo()] } });
    expect(screen.getByAltText("Vista previa del logo seleccionado")).toHaveAttribute("src", "blob:preview");
    fireEvent.click(screen.getByRole("button", { name: "Subir logo" }));
    await waitFor(() => expect(crearSponsor).toHaveBeenCalledWith("Club Sol", expect.any(File)));
    await waitFor(() => expect(showSuccess).toHaveBeenCalledWith("Logo de Club Sol subido."));
    expect(screen.getByLabelText("Nombre corto")).toHaveValue("");
    expect(screen.queryByAltText("Vista previa del logo seleccionado")).not.toBeInTheDocument();
  });
  it("asks for confirmation naming the sponsor, and deletes on confirm", async () => {
    render(<SponsorsPage />); await screen.findByText("Municipio");
    fireEvent.click(screen.getByRole("button", { name: "Eliminar Municipio" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Municipio");
    expect(eliminarSponsor).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Eliminar" }));
    await waitFor(() => expect(eliminarSponsor).toHaveBeenCalledWith(1));
    await waitFor(() => expect(showSuccess).toHaveBeenCalledWith("Logo de Municipio eliminado."));
  });
  it("does not delete when the dialog is cancelled", async () => {
    render(<SponsorsPage />); await screen.findByText("Municipio");
    fireEvent.click(screen.getByRole("button", { name: "Eliminar Municipio" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: /cancelar/i }));
    expect(eliminarSponsor).not.toHaveBeenCalled();
  });
  it("toasts an error when deletion fails", async () => {
    eliminarSponsor.mockRejectedValue(new Error("boom"));
    render(<SponsorsPage />); await screen.findByText("Municipio");
    fireEvent.click(screen.getByRole("button", { name: "Eliminar Municipio" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Eliminar" }));
    await waitFor(() => expect(showError).toHaveBeenCalledWith("No se pudo eliminar el patrocinador."));
  });
  async function intentarSubir(): Promise<void> {
    render(<SponsorsPage />); await screen.findByText("Municipio");
    fireEvent.change(screen.getByLabelText("Nombre corto"), { target: { value: "Club Sol" } });
    fireEvent.change(screen.getByLabelText("Logo (JPG o PNG)"), { target: { files: [logo()] } });
    fireEvent.click(screen.getByRole("button", { name: "Subir logo" }));
  }
  it("reports a provider outage (503) as a service problem, not the 5 MB copy", async () => {
    crearSponsor.mockRejectedValueOnce(fail("ServicioNoDisponible", 503));
    await intentarSubir();
    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("El servicio de imágenes no está disponible en este momento. Intente de nuevo más tarde.");
    expect(alerta.textContent).not.toMatch(/5 MB|JPG|PNG/);
  });
  it("shows the backend's validation message on a 400", async () => {
    crearSponsor.mockRejectedValueOnce(fail("El logo no puede superar 5 MB.", 400));
    await intentarSubir();
    expect(await screen.findByRole("alert")).toHaveTextContent("El logo no puede superar 5 MB.");
  });
  it("reports a network failure as a connection problem", async () => {
    crearSponsor.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await intentarSubir();
    expect(await screen.findByRole("alert")).toHaveTextContent(/conexión/);
  });
  it("uses a neutral generic message for an unknown failure", async () => {
    crearSponsor.mockRejectedValueOnce(new Error("boom"));
    await intentarSubir();
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo subir el logo. Intente de nuevo.");
  });
  it("blames the size client-side only for an actually oversized logo, without calling the backend", async () => {
    render(<SponsorsPage />); await screen.findByText("Municipio");
    const pesado = new File([new ArrayBuffer(5 * 1024 * 1024 + 1)], "logo.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Logo (JPG o PNG)"), { target: { files: [pesado] } });
    expect(await screen.findByRole("alert")).toHaveTextContent(/supera el límite de 5 MB/);
    expect(screen.queryByAltText("Vista previa del logo seleccionado")).not.toBeInTheDocument();
    expect(crearSponsor).not.toHaveBeenCalled();
  });
  it("rejects a logo that is neither JPG nor PNG client-side", async () => {
    render(<SponsorsPage />); await screen.findByText("Municipio");
    fireEvent.change(screen.getByLabelText("Logo (JPG o PNG)"), { target: { files: [new File(["gif"], "logo.gif", { type: "image/gif" })] } });
    expect(await screen.findByRole("alert")).toHaveTextContent(/debe ser un archivo JPG o PNG/);
  });
});
