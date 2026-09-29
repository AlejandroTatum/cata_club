/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ReportProblemDialog from "../ReportProblemDialog";

afterEach(() => vi.restoreAllMocks());

describe("ReportProblemDialog", () => {
  it("sends description without screenshot or consent", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(new Response("{}", { status: 201 }));
    render(<ReportProblemDialog onClose={vi.fn()} requestId="req-123" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "No se guarda" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar reporte" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const [, init] = fetchMock.mock.calls[0];
    expect((init?.body as FormData).get("captura")).toBeNull();
    expect(init?.headers).toEqual({ "X-Request-ID": "req-123" });
  });

  it("requires explicit consent for a selected screenshot", () => {
    render(<ReportProblemDialog onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Falla" } });
    fireEvent.change(screen.getByLabelText(/Captura opcional/), { target: { files: [new File(["png"], "foto.png", { type: "image/png" })] } });
    expect(screen.getByRole("button", { name: "Enviar reporte" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "Enviar reporte" })).toBeEnabled();
  });
});
