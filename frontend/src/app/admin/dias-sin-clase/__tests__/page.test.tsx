/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DiasSinClasePage from "../page";

const fetchDiasSinClase = vi.fn();
const crearDiaSinClase = vi.fn();
const actualizarDiaSinClase = vi.fn();
const eliminarDiaSinClase = vi.fn();
const showSuccess = vi.fn();
const showError = vi.fn();

vi.mock("@/contexts/ToastContext", () => ({ useToast: () => ({ showToast: vi.fn(), showSuccess, showError }) }));
vi.mock("@/components/ProtectedRoute", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/shell/AppShell", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/services/api", () => ({
  fetchDiasSinClase: () => fetchDiasSinClase(),
  crearDiaSinClase: (...args: unknown[]) => crearDiaSinClase(...args),
  actualizarDiaSinClase: (...args: unknown[]) => actualizarDiaSinClase(...args),
  eliminarDiaSinClase: (id: number) => eliminarDiaSinClase(id),
}));

const FERIADO = { id: 1, fechaInicio: "2029-07-04", fechaFin: "2029-07-04", motivo: "Feriado" };
const CIERRE = { id: 2, fechaInicio: "2029-07-10", fechaFin: "2029-07-12", motivo: "Cancha cerrada" };

describe("DiasSinClasePage (admin)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchDiasSinClase.mockResolvedValue([FERIADO, CIERRE]);
    crearDiaSinClase.mockResolvedValue(FERIADO);
    actualizarDiaSinClase.mockResolvedValue(FERIADO);
    eliminarDiaSinClase.mockResolvedValue(undefined);
  });

  it("lists published days with a single date or a range, and their reason", async () => {
    render(<DiasSinClasePage />);
    expect(await screen.findByText("04/07/2029")).toBeInTheDocument();
    expect(screen.getByText("10/07/2029 – 12/07/2029")).toBeInTheDocument();
    expect(screen.getByText("Cancha cerrada")).toBeInTheDocument();
  });

  it("creates a single day without sending a final date, then reloads", async () => {
    render(<DiasSinClasePage />);
    await screen.findByText("Feriado");
    fireEvent.change(screen.getByLabelText(/^Desde/), { target: { value: "2029-08-01" } });
    fireEvent.change(screen.getByLabelText(/^Motivo/), { target: { value: "  Evento del club  " } });
    fireEvent.click(screen.getByRole("button", { name: "Publicar día sin clase" }));

    await waitFor(() => expect(crearDiaSinClase).toHaveBeenCalledWith({
      fecha_inicio: "2029-08-01", fecha_fin: null, motivo: "Evento del club",
    }));
    expect(showSuccess).toHaveBeenCalled();
    expect(fetchDiasSinClase).toHaveBeenCalledTimes(2);
  });

  it("creates a range", async () => {
    render(<DiasSinClasePage />);
    await screen.findByText("Feriado");
    fireEvent.change(screen.getByLabelText(/^Desde/), { target: { value: "2029-08-01" } });
    fireEvent.change(screen.getByLabelText(/Hasta/), { target: { value: "2029-08-03" } });
    fireEvent.change(screen.getByLabelText(/^Motivo/), { target: { value: "Vacaciones" } });
    fireEvent.click(screen.getByRole("button", { name: "Publicar día sin clase" }));

    await waitFor(() => expect(crearDiaSinClase).toHaveBeenCalledWith({
      fecha_inicio: "2029-08-01", fecha_fin: "2029-08-03", motivo: "Vacaciones",
    }));
  });

  it("refuses an incomplete or inverted form before calling the API", async () => {
    render(<DiasSinClasePage />);
    await screen.findByText("Feriado");
    fireEvent.click(screen.getByRole("button", { name: "Publicar día sin clase" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Indica la fecha y el motivo.");

    fireEvent.change(screen.getByLabelText(/^Desde/), { target: { value: "2029-08-05" } });
    fireEvent.change(screen.getByLabelText(/Hasta/), { target: { value: "2029-08-01" } });
    fireEvent.change(screen.getByLabelText(/^Motivo/), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Publicar día sin clase" }));
    expect(await screen.findByText("La fecha final no puede ser anterior a la inicial.")).toBeInTheDocument();
    expect(crearDiaSinClase).not.toHaveBeenCalled();
  });

  it("edits a day: loads it into the form and saves without the creation promise", async () => {
    render(<DiasSinClasePage />);
    fireEvent.click(await screen.findByRole("button", { name: "Editar 10/07/2029 – 12/07/2029" }));
    expect(screen.getByLabelText(/^Desde/)).toHaveValue("2029-07-10");
    expect(screen.getByLabelText(/^Motivo/)).toHaveValue("Cancha cerrada");
    expect(screen.getByText("Editar no vuelve a enviar el aviso a los socios.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^Motivo/), { target: { value: "Torneo" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(actualizarDiaSinClase).toHaveBeenCalledWith(2, {
      fecha_inicio: "2029-07-10", fecha_fin: "2029-07-12", motivo: "Torneo",
    }));
    expect(crearDiaSinClase).not.toHaveBeenCalled();
  });

  it("deletes only after the admin confirms", async () => {
    render(<DiasSinClasePage />);
    fireEvent.click(await screen.findByRole("button", { name: "Eliminar 04/07/2029" }));
    expect(eliminarDiaSinClase).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Eliminar" }));

    await waitFor(() => expect(eliminarDiaSinClase).toHaveBeenCalledWith(1));
    expect(showSuccess).toHaveBeenCalledWith("Día sin clase eliminado.");
  });

  it("shows a guiding empty state and a retryable load error", async () => {
    fetchDiasSinClase.mockResolvedValueOnce([]);
    const { unmount } = render(<DiasSinClasePage />);
    expect(await screen.findByText("Aún no hay días sin clase")).toBeInTheDocument();
    unmount();

    fetchDiasSinClase.mockRejectedValueOnce(new Error("boom"));
    render(<DiasSinClasePage />);
    expect(await screen.findByText("No se pudieron cargar los días sin clase.")).toBeInTheDocument();
  });
});
