/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ToastProvider } from "@/contexts/ToastContext";
import CorrectionRequestsInbox from "@/components/attendance/CorrectionRequestsInbox";
import type { CorrectionRequest } from "@/services/api";

const mockFetchCorrectionRequests = vi.fn();
const mockApprove = vi.fn();
const mockReject = vi.fn();

vi.mock("@/services/api", () => ({
  fetchCorrectionRequests: (filters?: unknown) => mockFetchCorrectionRequests(filters),
  approveCorrectionRequest: (id: number) => mockApprove(id),
  rejectCorrectionRequest: (id: number, motivo: string) => mockReject(id, motivo),
}));

function pending(id: number, overrides: Partial<CorrectionRequest> = {}): CorrectionRequest {
  return {
    id,
    asistenciaId: 900 + id,
    personaId: id,
    personaNombre: `Alumno ${id}`,
    horarioId: 12,
    fecha: "2026-07-21",
    horarioEtiqueta: "Juvenil · martes 18:00",
    estadoActual: "present",
    estadoSolicitado: "absent",
    motivo: "Debía figurar como ausente.",
    solicitadoPorId: 3,
    solicitadoPorNombre: "Coach Torres",
    solicitadoEn: "2026-07-21T20:00:00Z",
    estado: "PENDIENTE",
    resueltoPorNombre: null,
    resueltoEn: null,
    motivoResolucion: null,
    ...overrides,
  };
}

function renderInbox(onResolved = vi.fn()): { onResolved: ReturnType<typeof vi.fn> } {
  render(
    <ToastProvider>
      <CorrectionRequestsInbox onResolved={onResolved} />
    </ToastProvider>,
  );
  return { onResolved };
}

beforeEach(() => {
  mockFetchCorrectionRequests.mockReset().mockResolvedValue([]);
  mockApprove.mockReset();
  mockReject.mockReset();
});

describe("CorrectionRequestsInbox (QA4 ENT-25)", () => {
  it("asks only for pending requests and draws nothing when there are none", async () => {
    const { container } = render(
      <ToastProvider>
        <CorrectionRequestsInbox onResolved={vi.fn()} />
      </ToastProvider>,
    );

    await waitFor(() => expect(mockFetchCorrectionRequests).toHaveBeenCalledWith({ estado: "PENDIENTE" }));
    expect(screen.queryByText("Solicitudes de corrección")).not.toBeInTheDocument();
    expect(container.querySelector("section")).toBeNull();
  });

  it("lists each pending request with who asked, the change and the reason, and a count badge", async () => {
    mockFetchCorrectionRequests.mockResolvedValue([pending(1), pending(2, { estadoSolicitado: "late" })]);
    renderInbox();

    expect(await screen.findByText("Solicitudes de corrección")).toBeInTheDocument();
    expect(screen.getByLabelText("2 solicitudes pendientes")).toBeInTheDocument();
    const first = screen.getByText("Alumno 1").closest("li") as HTMLElement;
    expect(within(first).getByText(/Juvenil · martes 18:00/)).toBeInTheDocument();
    expect(within(first).getByText(/Figura Presente · pide Ausente/)).toBeInTheDocument();
    expect(within(first).getByText(/Debía figurar como ausente\./)).toBeInTheDocument();
    expect(within(first).getByText(/Coach Torres/)).toBeInTheDocument();
  });

  it("approves: applies it, removes the row and tells the page to reload", async () => {
    mockFetchCorrectionRequests.mockResolvedValue([pending(1), pending(2)]);
    mockApprove.mockResolvedValue(pending(1, { estado: "APROBADA" }));
    const { onResolved } = renderInbox();

    const row = (await screen.findByText("Alumno 1")).closest("li") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Aprobar" }));

    await waitFor(() => expect(mockApprove).toHaveBeenCalledWith(1));
    await waitFor(() => expect(screen.queryByText("Alumno 1")).not.toBeInTheDocument());
    expect(screen.getByText("Alumno 2")).toBeInTheDocument();
    expect(onResolved).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("1 solicitud pendiente")).toBeInTheDocument();
  });

  it("keeps the row and says why when approving fails", async () => {
    mockFetchCorrectionRequests.mockResolvedValue([pending(1)]);
    mockApprove.mockRejectedValue(new Error("No se puede corregir una asistencia de hace más de 30 días."));
    const { onResolved } = renderInbox();

    const row = (await screen.findByText("Alumno 1")).closest("li") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Aprobar" }));

    expect(await within(row).findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Alumno 1")).toBeInTheDocument();
    expect(onResolved).not.toHaveBeenCalled();
  });

  it("rejects only with a reason, which the trainer will read", async () => {
    mockFetchCorrectionRequests.mockResolvedValue([pending(1)]);
    mockReject.mockResolvedValue(pending(1, { estado: "RECHAZADA", motivoResolucion: "Estaba presente." }));
    renderInbox();

    const row = (await screen.findByText("Alumno 1")).closest("li") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Rechazar" }));
    fireEvent.click(within(row).getByRole("button", { name: "Confirmar rechazo" }));
    expect(await within(row).findByRole("alert")).toHaveTextContent("Indique por qué se rechaza.");
    expect(mockReject).not.toHaveBeenCalled();

    fireEvent.change(within(row).getByPlaceholderText("Motivo que verá el entrenador"), {
      target: { value: "Estaba presente." },
    });
    fireEvent.click(within(row).getByRole("button", { name: "Confirmar rechazo" }));

    await waitFor(() => expect(mockReject).toHaveBeenCalledWith(1, "Estaba presente."));
    await waitFor(() => expect(screen.queryByText("Alumno 1")).not.toBeInTheDocument());
  });
});
