/**
 * Component tests for ChatWidget — covers the controlled open/close contract
 * and the send-message flow. Network calls are mocked via `vi.spyOn(global,
 * "fetch")` (ChatWidget calls `consultarChatbot` from src/services/api.ts,
 * which itself calls fetch against /api/chatbot — see that file's own
 * contract tests for the shared client's behavior).
 *
 * The widget no longer owns a floating action button: `AppShell` owns the
 * open state and opens it from the sidebar's "Ayuda y soporte" entry.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ChatWidget from "@/components/chatbot/ChatWidget";

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(status: number): Response {
  return new Response(JSON.stringify({ message: "error" }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.spyOn(global, "fetch");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ChatWidget", () => {
  it("renders nothing while the host reports it closed", () => {
    const { container } = render(<ChatWidget open={false} onClose={vi.fn()} />);

    expect(screen.queryByRole("dialog", { name: /chat de ayuda/i })).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the panel when the host opens it", () => {
    render(<ChatWidget open onClose={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: /chat de ayuda/i })).toBeInTheDocument();
  });

  it("never renders a floating action button of its own", () => {
    render(<ChatWidget open onClose={vi.fn()} />);

    expect(screen.queryByRole("button", { name: /abrir chat de ayuda/i })).not.toBeInTheDocument();
  });

  it("asks the host to close when the close button is clicked", () => {
    const onClose = vi.fn();
    render(<ChatWidget open onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: /cerrar chat de ayuda/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("sends a message and renders the assistant reply", async () => {
    vi.mocked(global.fetch).mockResolvedValue(okResponse({ reply: "Podés ver tus pagos en Mi Cuenta." }));

    render(<ChatWidget open onClose={vi.fn()} />);

    const input = screen.getByLabelText(/mensaje para el asistente/i);
    fireEvent.change(input, { target: { value: "¿Cómo veo mis pagos?" } });
    fireEvent.click(screen.getByRole("button", { name: /enviar mensaje/i }));

    expect(screen.getByText("¿Cómo veo mis pagos?")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Podés ver tus pagos en Mi Cuenta.")).toBeInTheDocument();
    });

    expect(global.fetch).toHaveBeenCalledWith("/api/chatbot", expect.anything());
    const [, init] = vi.mocked(global.fetch).mock.calls[0] as [string, RequestInit];
    const sentBody = JSON.parse(init.body as string) as { mensaje: string; historial?: unknown[] };
    expect(sentBody.mensaje).toBe("¿Cómo veo mis pagos?");
    expect(sentBody.historial).toEqual([]);
  });

  it("shows an inline error when the request fails", async () => {
    vi.mocked(global.fetch).mockResolvedValue(errorResponse(502));

    render(<ChatWidget open onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/mensaje para el asistente/i), { target: { value: "hola" } });
    fireEvent.click(screen.getByRole("button", { name: /enviar mensaje/i }));

    await waitFor(() => {
      expect(screen.getByText(/no se pudo contactar al asistente/i)).toBeInTheDocument();
    });
  });
});
