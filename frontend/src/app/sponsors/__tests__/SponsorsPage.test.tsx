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
});
