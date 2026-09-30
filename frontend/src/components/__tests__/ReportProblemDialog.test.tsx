/** @vitest-environment jsdom */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import ReportProblemDialog from "../ReportProblemDialog";
import { useReportProblem } from "../report-problem/useReportProblem";

const captureViewport = vi.hoisted(() => vi.fn());
vi.mock("../report-problem/capture", async (original) => ({ ...(await original<typeof import("../report-problem/capture")>()), captureViewport }));

beforeAll(() => {
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => { vi.restoreAllMocks(); captureViewport.mockReset(); });

const draft = (): File => new File(["jpg"], "captura-pantalla.jpg", { type: "image/jpeg" });
const send = (): HTMLElement => screen.getByRole("button", { name: "Enviar reporte" });

describe("ReportProblemDialog", () => {
  it("sends description without screenshot or consent", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(new Response("{}", { status: 201 }));
    render(<ReportProblemDialog onClose={vi.fn()} requestId="req-123" />);
    fireEvent.change(screen.getByRole("textbox", { name: /Qué ocurrió/ }), { target: { value: "No se guarda" } });
    fireEvent.click(send());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const [, init] = fetchMock.mock.calls[0];
    expect((init?.body as FormData).get("captura")).toBeNull();
    expect(init?.headers).toEqual({ "X-Request-ID": "req-123" });
  });

  it("requires explicit consent for a selected screenshot", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(new Response("{}", { status: 201 }));
    render(<ReportProblemDialog onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: /Qué ocurrió/ }), { target: { value: "Falla" } });
    fireEvent.change(screen.getByLabelText(/Captura opcional/), { target: { files: [new File(["png"], "foto.png", { type: "image/png" })] } });
    expect(send()).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(send()).toBeEnabled();
    fireEvent.click(send());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect((fetchMock.mock.calls[0][1]?.body as FormData).get("consentimiento_captura")).toBe("true");
  });

  it("holds the automatic capture as an unconsented draft and never sends it without consent", () => {
    const fetchMock = vi.spyOn(global, "fetch");
    render(<ReportProblemDialog onClose={vi.fn()} capture={{ file: draft(), failed: false }} />);
    fireEvent.change(screen.getByRole("textbox", { name: /Qué ocurrió/ }), { target: { value: "Falla" } });
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(send()).toBeDisabled();
    fireEvent.submit(send().closest("form") as HTMLFormElement);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("Sin captura (falta su autorización)")).toBeInTheDocument();
  });

  it("sends the automatic capture once consent is given", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: 42 }), { status: 201 }));
    render(<ReportProblemDialog onClose={vi.fn()} capture={{ file: draft(), failed: false }} />);
    fireEvent.change(screen.getByRole("textbox", { name: /Qué ocurrió/ }), { target: { value: "Falla" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(send());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const body = fetchMock.mock.calls[0][1]?.body as FormData;
    expect((body.get("captura") as File).name).toBe("captura-pantalla.jpg");
    expect(body.get("consentimiento_captura")).toBe("true");
    expect(await screen.findByText("#42")).toBeInTheDocument();
  });

  it("removes the capture and resets consent; replacing it also asks consent again", async () => {
    render(<ReportProblemDialog onClose={vi.fn()} capture={{ file: draft(), failed: false }} />);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByLabelText(/Captura opcional/), { target: { files: [new File(["p"], "otra.png", { type: "image/png" })] } });
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Quitar captura" }));
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByText("Sin captura")).toBeInTheDocument();
  });

  it("previews the full message exactly as it will be sent", () => {
    render(<ReportProblemDialog onClose={vi.fn()} capture={{ file: draft(), failed: false }} />);
    const long = "línea uno\n" + "x".repeat(300);
    fireEvent.change(screen.getByRole("textbox", { name: /Qué ocurrió/ }), { target: { value: long } });
    expect(screen.getByTestId("report-preview-description").textContent).toBe(long.trim());
    expect(screen.getByText(navigator.userAgent)).toBeInTheDocument();
    expect(screen.getByText(window.location.pathname, { selector: "dd" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByText("Con captura")).toBeInTheDocument();
  });

  it("labels the automatic capture in a compact upload row", () => {
    render(<ReportProblemDialog onClose={vi.fn()} capture={{ file: draft(), failed: false }} />);
    expect(screen.getByText("Captura automática · captura-pantalla.jpg")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cambiar" })).toBeInTheDocument();
  });

  it("shows the soft failure message when the capture failed", () => {
    render(<ReportProblemDialog onClose={vi.fn()} capture={{ file: null, failed: true }} />);
    expect(screen.getByText(/No se pudo capturar la pantalla/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Captura opcional/)).toBeInTheDocument();
  });
});

describe("useReportProblem", () => {
  it("captures the page before the dialog renders", async () => {
    captureViewport.mockResolvedValue(draft());
    const { result } = renderHook(() => useReportProblem());
    expect(result.current.dialog).toBeNull();
    act(() => result.current.open());
    await waitFor(() => expect(result.current.dialog).not.toBeNull());
    expect(captureViewport).toHaveBeenCalledOnce();
  });

  it("still opens the dialog, flagged as failed, when capture throws", async () => {
    captureViewport.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useReportProblem());
    act(() => result.current.open());
    await waitFor(() => expect(result.current.dialog).not.toBeNull());
    render(result.current.dialog as React.ReactElement);
    expect(screen.getByText(/No se pudo capturar la pantalla/)).toBeInTheDocument();
  });
});
