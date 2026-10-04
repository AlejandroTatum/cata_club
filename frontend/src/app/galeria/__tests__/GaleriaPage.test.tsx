/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import GaleriaPage from "../page";
import { ApiClientError } from "@/services/api";

const fetchGaleria = vi.fn(); const crearEntradaGaleria = vi.fn(); const eliminarEntradaGaleria = vi.fn();
const actualizarEntradaGaleria = vi.fn(); const moverEntradaGaleria = vi.fn();
// jsdom cannot decode images or draw on a canvas: the crop geometry is covered by crop.test.ts.
const recortarImagen = vi.fn(async (file: File, _view?: unknown) => file);
vi.mock("../crop", async (importOriginal) => ({ ...(await importOriginal<typeof import("../crop")>()), recortarImagen: (file: File, view: unknown) => recortarImagen(file, view) }));
const showSuccess = vi.fn(); const showError = vi.fn();
vi.mock("@/contexts/ToastContext", () => ({ useToast: () => ({ showToast: vi.fn(), showSuccess, showError }) }));
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
  return {
    ApiClientError,
    fetchGaleriaAdmin: () => fetchGaleria(),
    crearEntradaGaleria: (...args: unknown[]) => crearEntradaGaleria(...args),
    eliminarEntradaGaleria: (id: number) => eliminarEntradaGaleria(id),
    actualizarEntradaGaleria: (...args: unknown[]) => actualizarEntradaGaleria(...args),
    moverEntradaGaleria: (...args: unknown[]) => moverEntradaGaleria(...args),
  };
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

const ENTRADAS = [
  { id: 1, titulo: "En juego", descripcion: "Una jugada frente al público.", imagenUrl: "https://cdn/foto.png", orden: 0, visible: true },
  { id: 2, titulo: "Podio", descripcion: "Los ganadores del torneo.", imagenUrl: "https://cdn/podio.png", orden: 1, visible: false },
];

describe("GaleriaPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchGaleria.mockResolvedValue(ENTRADAS);
    crearEntradaGaleria.mockResolvedValue({});
    actualizarEntradaGaleria.mockResolvedValue({}); moverEntradaGaleria.mockResolvedValue([]);
    eliminarEntradaGaleria.mockResolvedValue(undefined);
    vi.stubGlobal("confirm", vi.fn(() => true));
    URL.createObjectURL = vi.fn(() => "blob:preview"); URL.revokeObjectURL = vi.fn();
  });
  it("puts the upload form before the list and the guide below lg", async () => {
    render(<GaleriaPage />); await screen.findByText("En juego");
    const form = screen.getByRole("heading", { name: "Subir foto" }).closest("form")!;
    const list = screen.getByRole("region", { name: "Fotos publicadas" });
    const guide = screen.getByRole("complementary", { name: "Cómo se publica en el sitio" });
    expect(form).toHaveClass("max-lg:order-1");
    expect(list).toHaveClass("max-lg:order-2");
    expect(guide).toHaveClass("max-lg:order-3");
    // On lg the instructions card sits BELOW the upload form in the same column.
    expect(form.compareDocumentPosition(guide) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it("explains what the reorder controls do", async () => {
    render(<GaleriaPage />); await screen.findByText("En juego");
    expect(screen.getByText(/cambian el orden en que se muestran las fotos en la landing/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mover antes En juego" })).toHaveAttribute("title", "Mover antes");
  });
  it("lists published photos with their accessible descriptions", async () => {
    render(<GaleriaPage />);
    expect(await screen.findByRole("img", { name: "En juego" })).toHaveAttribute("src", "https://cdn/foto.png");
    expect(screen.getByText("En juego")).toBeInTheDocument();
  });
  it("requires the title, the description and a photo before publishing", async () => {
    render(<GaleriaPage />); await screen.findByText("En juego");
    fireEvent.change(screen.getByLabelText("Foto (JPG o PNG)"), { target: { files: [fotoValida()] } });
    fireEvent.click(screen.getByRole("button", { name: "Publicar foto" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/título, la descripción y selecciona/i);
    expect(crearEntradaGaleria).not.toHaveBeenCalled();
  });
  it("keeps Publicar foto disabled until a photo is chosen", async () => {
    render(<GaleriaPage />); await screen.findByText("En juego");
    expect(screen.getByRole("button", { name: "Publicar foto" })).toBeDisabled();
  });
  it("enables Publicar foto once a valid photo is chosen, without needing title or description", async () => {
    render(<GaleriaPage />); await screen.findByText("En juego");
    fireEvent.change(screen.getByLabelText("Foto (JPG o PNG)"), { target: { files: [fotoValida()] } });
    expect(screen.getByRole("button", { name: "Publicar foto" })).toBeEnabled();
  });
  it("keeps Publicar foto disabled after an invalid photo is rejected", async () => {
    render(<GaleriaPage />); await screen.findByText("En juego");
    fireEvent.change(screen.getByLabelText("Foto (JPG o PNG)"), { target: { files: [new File(["gif"], "foto.gif", { type: "image/gif" })] } });
    expect(await screen.findByRole("alert")).toHaveTextContent(/debe ser un archivo JPG o PNG/);
    expect(screen.getByRole("button", { name: "Publicar foto" })).toBeDisabled();
    const pesada = new File([new ArrayBuffer(5 * 1024 * 1024 + 1)], "foto.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("Foto (JPG o PNG)"), { target: { files: [pesada] } });
    expect(await screen.findByRole("alert")).toHaveTextContent(/supera el límite de 5 MB/);
    expect(screen.getByRole("button", { name: "Publicar foto" })).toBeDisabled();
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
    // The 5xx detail itself never reaches the screen — the shared upload
    // helper's service-outage sentence does.
    crearEntradaGaleria.mockRejectedValueOnce(new ApiClientError("Fallo del proveedor de imágenes.", 503));
    fireEvent.click(screen.getByRole("button", { name: "Publicar foto" }));
    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("El servicio de imágenes no está disponible en este momento. Intenta de nuevo más tarde.");
    expect(alerta.textContent).not.toMatch(/5 MB|JPG|PNG|proveedor/);
  });
  it("keeps actionable backend 4xx messages visible", async () => {
    render(<GaleriaPage />);
    await completarFormularioValido();
    crearEntradaGaleria.mockRejectedValueOnce(new ApiClientError("La imagen no puede superar 5 MB.", 400));
    fireEvent.click(screen.getByRole("button", { name: "Publicar foto" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("La imagen no puede superar 5 MB.");
  });
  it("deletes a published photo through the confirm dialog, not window.confirm", async () => {
    render(<GaleriaPage />); await screen.findByText("En juego");
    fireEvent.click(screen.getByRole("button", { name: "Eliminar En juego" }));
    expect(window.confirm).not.toHaveBeenCalled();
    expect(eliminarEntradaGaleria).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("En juego");
    fireEvent.click(within(dialog).getByRole("button", { name: "Eliminar" }));
    await waitFor(() => expect(eliminarEntradaGaleria).toHaveBeenCalledWith(1));
    await waitFor(() => expect(showSuccess).toHaveBeenCalled());
  });
  it("does not delete when the dialog is cancelled", async () => {
    render(<GaleriaPage />); await screen.findByText("En juego");
    fireEvent.click(screen.getByRole("button", { name: "Eliminar En juego" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancelar" }));
    expect(eliminarEntradaGaleria).not.toHaveBeenCalled();
  });
  it("mirrors the typed title, description and chosen photo in the preview figcaption", async () => {
    render(<GaleriaPage />); await completarFormularioValido();
    const preview = screen.getByTestId("galeria-preview");
    expect(within(preview).getByText("La final")).toBeInTheDocument();
    expect(within(preview).getByText("El punto decisivo.")).toBeInTheDocument();
    expect(preview.querySelector("img")).toHaveAttribute("src", "blob:preview");
  });
  it("gives every published card the slide's 3:2 image frame", async () => {
    render(<GaleriaPage />);
    expect((await screen.findByRole("img", { name: "En juego" })).style.aspectRatio).toBe("3 / 2");
  });
  it("frames the preview at the landing slide's default 3:2 ratio before and after a photo is chosen", async () => {
    render(<GaleriaPage />); await screen.findByText("En juego");
    const frame = () => screen.getByTestId("galeria-preview").querySelector("figure") as HTMLElement;
    expect(frame().style.aspectRatio).toMatch(/^1\.5/);
    expect(screen.getByText("Así se verá en la galería del sitio")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Foto (JPG o PNG)"), { target: { files: [fotoValida()] } });
    expect(frame().style.aspectRatio).toMatch(/^1\.5/);
  });
  it("keeps the preview at 3:2 for a photo of another ratio: that is the crop frame (ADMB-37)", async () => {
    render(<GaleriaPage />); await screen.findByText("En juego");
    fireEvent.change(screen.getByLabelText("Foto (JPG o PNG)"), { target: { files: [fotoValida()] } });
    const img = screen.getByTestId("galeria-preview").querySelector("img") as HTMLImageElement;
    Object.defineProperty(img, "naturalWidth", { value: 800 }); Object.defineProperty(img, "naturalHeight", { value: 1000 });
    fireEvent.load(img);
    expect((screen.getByTestId("galeria-preview").querySelector("figure") as HTMLElement).style.aspectRatio).toMatch(/^1\.5/);
  });
  it("offers a zoom control for the crop only once a photo is chosen", async () => {
    render(<GaleriaPage />); await screen.findByText("En juego");
    expect(screen.queryByLabelText("Zoom del recorte")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Foto (JPG o PNG)"), { target: { files: [fotoValida()] } });
    expect(screen.getByLabelText("Zoom del recorte")).toBeInTheDocument();
  });
  it("uploads the cropped file, not the original", async () => {
    const recortada = new File(["recorte"], "foto.png", { type: "image/png" });
    recortarImagen.mockResolvedValueOnce(recortada);
    render(<GaleriaPage />); await completarFormularioValido();
    fireEvent.change(screen.getByLabelText("Zoom del recorte"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Publicar foto" }));
    await waitFor(() => expect(crearEntradaGaleria).toHaveBeenCalledWith("La final", "El punto decisivo.", recortada));
    expect(recortarImagen).toHaveBeenCalledWith(expect.any(File), expect.objectContaining({ zoom: 2 }));
  });
  it("reports a photo that cannot be cropped without calling the API", async () => {
    recortarImagen.mockRejectedValueOnce(new Error("boom"));
    render(<GaleriaPage />); await completarFormularioValido();
    fireEvent.click(screen.getByRole("button", { name: "Publicar foto" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/No se pudo recortar la foto/);
    expect(crearEntradaGaleria).not.toHaveBeenCalled();
  });
  it("lists hidden photos too, marked as hidden (ADMB-34)", async () => {
    render(<GaleriaPage />);
    expect(await screen.findByRole("img", { name: "Podio" })).toBeInTheDocument();
    expect(screen.getAllByText("Oculta")).toHaveLength(1);
  });
  it("moves a photo down and up and reloads the list", async () => {
    render(<GaleriaPage />); await screen.findByText("En juego");
    expect(screen.getByRole("button", { name: "Mover antes En juego" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Mover después Podio" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Mover después En juego" }));
    await waitFor(() => expect(moverEntradaGaleria).toHaveBeenCalledWith(1, "bajar"));
    fireEvent.click(screen.getByRole("button", { name: "Mover antes Podio" }));
    await waitFor(() => expect(moverEntradaGaleria).toHaveBeenCalledWith(2, "subir"));
    await waitFor(() => expect(fetchGaleria).toHaveBeenCalledTimes(3));
  });
  it("hides a visible photo without deleting it, and shows a hidden one again", async () => {
    render(<GaleriaPage />); await screen.findByText("En juego");
    fireEvent.click(screen.getByRole("button", { name: "Ocultar En juego" }));
    await waitFor(() => expect(actualizarEntradaGaleria).toHaveBeenCalledWith(1, { titulo: "En juego", descripcion: "Una jugada frente al público.", visible: false }, undefined));
    fireEvent.click(screen.getByRole("button", { name: "Mostrar Podio" }));
    await waitFor(() => expect(actualizarEntradaGaleria).toHaveBeenCalledWith(2, { titulo: "Podio", descripcion: "Los ganadores del torneo.", visible: true }, undefined));
    expect(eliminarEntradaGaleria).not.toHaveBeenCalled();
  });
  it("edits an existing entry: loads it into the form and saves title and description", async () => {
    render(<GaleriaPage />); await screen.findByText("En juego");
    fireEvent.click(screen.getByRole("button", { name: "Editar En juego" }));
    expect(screen.getByRole("heading", { name: "Editar foto" })).toBeInTheDocument();
    expect(screen.getByLabelText("Título")).toHaveValue("En juego");
    expect(screen.getByLabelText("Descripción de la foto")).toHaveValue("Una jugada frente al público.");
    // The current photo stays; a new one is optional.
    expect(screen.getByTestId("galeria-preview").querySelector("img")).toHaveAttribute("src", "https://cdn/foto.png");
    fireEvent.change(screen.getByLabelText("Título"), { target: { value: "La final" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(actualizarEntradaGaleria).toHaveBeenCalledWith(1, { titulo: "La final", descripcion: "Una jugada frente al público.", visible: true }, undefined));
    await waitFor(() => expect(showSuccess).toHaveBeenCalled());
    expect(screen.getByRole("heading", { name: "Subir foto" })).toBeInTheDocument();
    expect(crearEntradaGaleria).not.toHaveBeenCalled();
  });
  it("replaces the photo of an entry with its cropped version", async () => {
    const recortada = new File(["recorte"], "nueva.png", { type: "image/png" });
    recortarImagen.mockResolvedValueOnce(recortada);
    render(<GaleriaPage />); await screen.findByText("En juego");
    fireEvent.click(screen.getByRole("button", { name: "Editar En juego" }));
    fireEvent.change(screen.getByLabelText("Cambiar foto (JPG o PNG)"), { target: { files: [new File(["x"], "nueva.png", { type: "image/png" })] } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(actualizarEntradaGaleria).toHaveBeenCalledWith(1, expect.objectContaining({ titulo: "En juego" }), recortada));
  });
  it("applies the word limits when saving an edit", async () => {
    render(<GaleriaPage />); await screen.findByText("En juego");
    fireEvent.click(screen.getByRole("button", { name: "Editar En juego" }));
    fireEvent.change(screen.getByLabelText("Descripción de la foto"), { target: { value: palabras(46) } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/45 palabras/);
    expect(actualizarEntradaGaleria).not.toHaveBeenCalled();
  });
  it("cancels an edit and goes back to uploading", async () => {
    render(<GaleriaPage />); await screen.findByText("En juego");
    fireEvent.click(screen.getByRole("button", { name: "Editar En juego" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar edición" }));
    expect(screen.getByRole("heading", { name: "Subir foto" })).toBeInTheDocument();
    expect(screen.getByLabelText("Título")).toHaveValue("");
  });
  it("shows the chosen file name in the drop zone", async () => {
    render(<GaleriaPage />); await completarFormularioValido();
    expect(screen.getByText("foto.png")).toBeInTheDocument();
  });
  it("guides the admin with an empty state after a successful empty load", async () => {
    fetchGaleria.mockResolvedValue([]);
    render(<GaleriaPage />);
    expect(await screen.findByText("Aún no hay fotos en la galería")).toBeInTheDocument();
    expect(screen.getByText("Las fotos publicadas aparecen aquí y en la galería del sitio.")).toBeInTheDocument();
    expect(screen.getByTestId("empty-grid-tiles").firstElementChild).toHaveStyle({ aspectRatio: "3 / 2" });
    expect(screen.getByRole("region", { name: "Fotos publicadas" })).toHaveClass("lg:self-stretch");
  });
  it("shows a loading state, not the empty copy, while the list loads", async () => {
    let resolver: (v: unknown[]) => void = () => undefined;
    fetchGaleria.mockReturnValue(new Promise((r) => { resolver = r; }));
    render(<GaleriaPage />);
    expect(screen.getByRole("status")).toHaveTextContent(/Cargando/);
    expect(screen.queryByText(/Aún no hay fotos/)).not.toBeInTheDocument();
    resolver([]);
    expect(await screen.findByText("Aún no hay fotos en la galería")).toBeInTheDocument();
  });
  it("shows a retryable error state when the list fails to load", async () => {
    fetchGaleria.mockRejectedValueOnce(new Error("boom"));
    render(<GaleriaPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo cargar la galería.");
    expect(screen.queryByText(/Aún no hay fotos/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("En juego")).toBeInTheDocument();
  });
  it("confirms a publish with a toast and clears the form and preview", async () => {
    render(<GaleriaPage />); await completarFormularioValido();
    fireEvent.click(screen.getByRole("button", { name: "Publicar foto" }));
    await waitFor(() => expect(showSuccess).toHaveBeenCalled());
    // The preview URL is cleared by an effect after the success toast, so wait for it.
    await waitFor(() => expect(screen.getByTestId("galeria-preview").querySelector("img")).toBeNull());
    expect(screen.getByLabelText("Título")).toHaveValue("");
  });
  it("keeps the publishing indications visible beside the form, even with photos listed", async () => {
    render(<GaleriaPage />);
    await screen.findByText("En juego");
    expect(screen.getByRole("heading", { name: "Cómo se publica en el sitio" })).toBeInTheDocument();
    expect(screen.getByText("JPG o PNG, hasta 5 MB.")).toBeInTheDocument();
    expect(screen.getByText(/en el orden de esta lista/)).toBeInTheDocument();
    expect(screen.getByText(/no se puede recuperar/)).toBeInTheDocument();
  });
});
