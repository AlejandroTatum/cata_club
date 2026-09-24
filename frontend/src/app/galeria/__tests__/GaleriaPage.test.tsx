/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import GaleriaPage from "../page";
import { ApiClientError } from "@/services/api";

const fetchGaleria = vi.fn(); const crearEntradaGaleria = vi.fn(); const eliminarEntradaGaleria = vi.fn();
vi.mock("@/components/ProtectedRoute", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/shell/AppShell", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/services/api", () => {
  // Mirrors the real ApiClientError contract (message, status, no safe
  // marker) so the page's translator-routed 4xx/5xx handling is exercised
  // against the same shape.
  class ApiClientError extends Error {
    status: number;
    constructor(message: string, status: number) { super(message); this.name = "ApiClientError"; this.status = status; }
  }
  return { ApiClientError, fetchGaleria: () => fetchGaleria(), crearEntradaGaleria: (...args: unknown[]) => crearEntradaGaleria(...args), eliminarEntradaGaleria: (id: number) => eliminarEntradaGaleria(id) };
});

const fotoValida = () => new File(["foto"], "foto.png", { type: "image/png" });
const palabras = (n: number): string => Array.from({ length: n }, (_, i) => `p${i}`).join(" ");

/** Fills the form with a valid small PNG and in-limit texts. */
async function completarFormularioValido(archivo: File = fotoValida()): Promise<void> {
  await screen.findByText("En juego");
  fireEvent.change(screen.getByLabelText("Título"), { target: { value: "La final" } });
  fireEvent.change(screen.getByLabelText("Descripción de la foto"), { target: { value: "El punto decisivo." } });
  fireEvent.change(screen.getByLabelText("Foto (JPG o PNG)"), { target: { files: [archivo] } });
}

describe("GaleriaPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchGaleria.mockResolvedValue([{ id: 1, titulo: "En juego", descripcion: "Una jugada frente al público.", imagenUrl: "https://cdn/foto.png" }]);
    crearEntradaGaleria.mockResolvedValue({});
    eliminarEntradaGaleria.mockResolvedValue(undefined);
    vi.stubGlobal("confirm", vi.fn(() => true));
  });
  it("lists published photos with their accessible descriptions", async () => {
    render(<GaleriaPage />);
    expect(await screen.findByRole("img", { name: "Una jugada frente al público." })).toHaveAttribute("src", "https://cdn/foto.png");
    expect(screen.getByText("En juego")).toBeInTheDocument();
  });
  it("requires the title, the description and a photo before publishing", async () => {
    render(<GaleriaPage />); await screen.findByText("En juego");
    fireEvent.click(screen.getByRole("button", { name: "Publicar foto" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/título, la descripción y seleccione/i);
    expect(crearEntradaGaleria).not.toHaveBeenCalled();
  });
  it("publishes a filled form and reloads the list", async () => {
    render(<GaleriaPage />); await completarFormularioValido();
    fireEvent.click(screen.getByRole("button", { name: "Publicar foto" }));
    await waitFor(() => expect(crearEntradaGaleria).toHaveBeenCalledWith("La final", "El punto decisivo.", expect.any(File)));
  });
  it("shows the word-limit guidance with live counters", async () => {
    render(<GaleriaPage />); await screen.findByText("En juego");
    expect(screen.getByText(/Máximo 8 palabras/)).toBeInTheDocument();
    expect(screen.getByText(/Máximo 45 palabras/)).toBeInTheDocument();
    expect(screen.getByText("Máximo 8 palabras · 0/8")).toBeInTheDocument();
  });
  it("rejects a title over the 8-word limit without calling the API", async () => {
    render(<GaleriaPage />); await screen.findByText("En juego");
    fireEvent.change(screen.getByLabelText("Título"), { target: { value: "una dos tres cuatro cinco seis siete ocho nueve" } });
    fireEvent.change(screen.getByLabelText("Descripción de la foto"), { target: { value: "El punto decisivo." } });
    fireEvent.change(screen.getByLabelText("Foto (JPG o PNG)"), { target: { files: [fotoValida()] } });
    fireEvent.click(screen.getByRole("button", { name: "Publicar foto" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/El título no puede superar las 8 palabras/);
    expect(crearEntradaGaleria).not.toHaveBeenCalled();
  });
  it("rejects a description over the 45-word limit without calling the API", async () => {
    render(<GaleriaPage />); await screen.findByText("En juego");
    fireEvent.change(screen.getByLabelText("Título"), { target: { value: "La final" } });
    fireEvent.change(screen.getByLabelText("Descripción de la foto"), { target: { value: palabras(46) } });
    fireEvent.change(screen.getByLabelText("Foto (JPG o PNG)"), { target: { files: [fotoValida()] } });
    fireEvent.click(screen.getByRole("button", { name: "Publicar foto" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/La descripción no puede superar las 45 palabras/);
    expect(crearEntradaGaleria).not.toHaveBeenCalled();
  });
  it("blames the size only for an actually oversized photo", async () => {
    render(<GaleriaPage />); await screen.findByText("En juego");
    const pesada = new File([new ArrayBuffer(5 * 1024 * 1024 + 1)], "foto.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("Foto (JPG o PNG)"), { target: { files: [pesada] } });
    expect(await screen.findByRole("alert")).toHaveTextContent(/supera el límite de 5 MB/);
    expect(crearEntradaGaleria).not.toHaveBeenCalled();
  });
  it("rejects a photo that is neither JPG nor PNG", async () => {
    render(<GaleriaPage />); await screen.findByText("En juego");
    fireEvent.change(screen.getByLabelText("Foto (JPG o PNG)"), { target: { files: [new File(["gif"], "foto.gif", { type: "image/gif" })] } });
    expect(await screen.findByRole("alert")).toHaveTextContent(/debe ser un archivo JPG o PNG/);
    expect(crearEntradaGaleria).not.toHaveBeenCalled();
  });
  it("reports a provider outage as the service failure, not a size or provider error", async () => {
    render(<GaleriaPage />);
    await completarFormularioValido();
    // A valid small image failing upstream (e.g. absent Cloudinary credentials
    // in the preview) must NOT read as "your photo is too big/formatted badly".
    // The 5xx detail itself never reaches the screen — the translator's
    // SERVER FAILURE sentence does (only a backend safe-marker can change
    // that, and an unmarked provider outage has none).
    crearEntradaGaleria.mockRejectedValueOnce(new ApiClientError("Fallo del proveedor de imágenes.", 503));
    fireEvent.click(screen.getByRole("button", { name: "Publicar foto" }));
    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent(/Tuvimos un problema de nuestro lado/);
    expect(alerta.textContent).not.toMatch(/5 MB|JPG|PNG|proveedor/);
  });
  it("keeps actionable backend 4xx messages visible", async () => {
    render(<GaleriaPage />);
    await completarFormularioValido();
    crearEntradaGaleria.mockRejectedValueOnce(new ApiClientError("La imagen no puede superar 5 MB.", 400));
    fireEvent.click(screen.getByRole("button", { name: "Publicar foto" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("La imagen no puede superar 5 MB.");
  });
  it("deletes a published photo after confirmation", async () => {
    render(<GaleriaPage />); await screen.findByText("En juego");
    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));
    await waitFor(() => expect(eliminarEntradaGaleria).toHaveBeenCalledWith(1));
  });
});
