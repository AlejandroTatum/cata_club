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
import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";
import ChatWidget from "@/components/chatbot/ChatWidget";
import { getQuickReplies } from "@/components/chatbot/chat-quick-replies";

// `src` is forwarded, not dropped: which asset the header avatar points at is
// a behaviour these tests assert (the club wordmark is unreadable at 32px).
vi.mock("next/image", () => ({
  __esModule: true,
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ alt, src }: { alt: string; src: string }) => <img alt={alt} src={src} />,
}));

/** Never resolves — holds the widget in its "enviando" state for inspection. */
function pendingResponse(): Promise<Response> {
  return new Promise<Response>(() => {});
}

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

    expect(screen.queryByRole("dialog", { name: /cata-bot/i })).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the panel when the host opens it", () => {
    render(<ChatWidget open onClose={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: /cata-bot/i })).toBeInTheDocument();
  });

  it("never renders a floating action button of its own", () => {
    render(<ChatWidget open onClose={vi.fn()} />);

    expect(screen.queryByRole("button", { name: /abrir cata-bot/i })).not.toBeInTheDocument();
  });

  it("asks the host to close when the close button is clicked", () => {
    const onClose = vi.fn();
    render(<ChatWidget open onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: /cerrar cata-bot/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("sends a message and renders the assistant reply", async () => {
    vi.mocked(global.fetch).mockResolvedValue(okResponse({ reply: "Podés ver tus pagos en Mi Cuenta." }));

    render(<ChatWidget open onClose={vi.fn()} />);

    const input = screen.getByLabelText(/mensaje para cata-bot/i);
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

    fireEvent.change(screen.getByLabelText(/mensaje para cata-bot/i), { target: { value: "hola" } });
    fireEvent.click(screen.getByRole("button", { name: /enviar mensaje/i }));

    await waitFor(() => {
      expect(screen.getByText(/no se pudo contactar a cata-bot/i)).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// One message per failure class.
//
// The widget used to answer every rejection with the same "no se pudo
// contactar" string, which made a rate limit, a timeout and a dead backend
// indistinguishable — the failures read as random. The backend now maps each
// provider failure to its own status (429/504/503/502) and the BFF forwards it
// verbatim, so the copy can finally tell the user what to do about it.
// ---------------------------------------------------------------------------

describe("ChatWidget — error copy per failure class", () => {
  async function enviarYLeerAlerta(status: number): Promise<string> {
    vi.mocked(global.fetch).mockResolvedValue(errorResponse(status));

    render(<ChatWidget open onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/mensaje para cata-bot/i), { target: { value: "hola" } });
    fireEvent.click(screen.getByRole("button", { name: /enviar mensaje/i }));

    const alerta = await screen.findByRole("alert");
    return alerta.textContent ?? "";
  }

  it("tells the user to wait when they are asking too fast (429)", async () => {
    expect(await enviarYLeerAlerta(429)).toMatch(/espera/i);
  });

  it("says it took too long on a timeout (504)", async () => {
    expect(await enviarYLeerAlerta(504)).toMatch(/tard/i);
  });

  it("says the assistant is unavailable when the backend cannot reach it (503)", async () => {
    expect(await enviarYLeerAlerta(503)).toMatch(/no está disponible/i);
  });

  it("falls back to the generic message on any other failure (502)", async () => {
    expect(await enviarYLeerAlerta(502)).toMatch(/no se pudo contactar a cata-bot/i);
  });

  it("gives each failure class a message of its own", async () => {
    const mensajes: string[] = [];
    for (const status of [429, 504, 503, 502]) {
      mensajes.push(await enviarYLeerAlerta(status));
      cleanup();
      vi.mocked(global.fetch).mockReset();
    }

    expect(new Set(mensajes).size).toBe(mensajes.length);
  });

  it("keeps the alert inside the role=alert block with its error styling", async () => {
    vi.mocked(global.fetch).mockResolvedValue(errorResponse(429));

    render(<ChatWidget open onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/mensaje para cata-bot/i), { target: { value: "hola" } });
    fireEvent.click(screen.getByRole("button", { name: /enviar mensaje/i }));

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveClass("bg-state-bad-bg");
    expect(alerta).toHaveClass("text-state-bad");
  });
});

// ---------------------------------------------------------------------------
// The redesign onto "La Paleta" (`docs/ux/prototipos/28-chat.html`).
// ---------------------------------------------------------------------------

describe("ChatWidget — design system", () => {
  it("heads the panel with the assistant's own identity and the response promise", () => {
    render(<ChatWidget open onClose={vi.fn()} />);

    // The assistant is CATA-BOT, not "Cata Club": named after the club it
    // was indistinguishable from the human channel one row below it.
    expect(screen.getByText("CATA-BOT")).toBeInTheDocument();
    expect(screen.queryByText("Cata Club")).not.toBeInTheDocument();
    expect(screen.getByText("Responde en segundos")).toBeInTheDocument();
  });

  it("wears the purpose-made bot avatar, not the club wordmark that smudges at 32px", () => {
    const { container } = render(<ChatWidget open onClose={vi.fn()} />);

    const avatar = container.querySelector("header img");
    // The 512px master, not the 128px copy. `sizes` is in CSS pixels, so
    // asking for a 32px source made Next serve 32 real pixels and every
    // HiDPI display upscaled them — the avatar rendered as a smudge. The
    // `sizes` value itself is not asserted here: the `next/image` mock in this
    // suite drops that prop, so it can only be checked in the browser.
    expect(avatar).toHaveAttribute("src", "/brand/cata-bot.png");
  });

  it("introduces itself by name in the opening bubble", () => {
    render(<ChatWidget open onClose={vi.fn()} />);

    expect(screen.getByText(/Soy CATA-BOT, el asistente del club/)).toBeInTheDocument();
  });

  it("keeps the human escape hatch named after the club, not the bot", () => {
    render(<ChatWidget open onClose={vi.fn()} />);

    // "Hablar con el club" hands off to a person on WhatsApp — renaming it
    // after the assistant would promise a human and deliver the same bot.
    expect(screen.getByRole("link", { name: "Hablar con el club" })).toBeInTheDocument();
  });

  it("paints the user's turn coal and the bot's grey — never red", async () => {
    vi.mocked(global.fetch).mockResolvedValue(okResponse({ reply: "Claro que sí." }));

    render(<ChatWidget open onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/mensaje para cata-bot/i), {
      target: { value: "¿Cómo veo mis pagos?" },
    });
    fireEvent.click(screen.getByRole("button", { name: /enviar mensaje/i }));

    const userBubble = screen.getByText("¿Cómo veo mis pagos?");
    expect(userBubble).toHaveClass("bg-coal");
    // Red is reserved for the primary CTA and for destructive/error. A red
    // bubble read as an error message.
    expect(userBubble.className).not.toContain("bg-cata-red");

    const botBubble = await screen.findByText("Claro que sí.");
    expect(botBubble).toHaveClass("bg-state-neutral-bg");
  });

  it("keeps the typing indicator's three dots still when the system asks for less motion", () => {
    vi.mocked(global.fetch).mockImplementation(pendingResponse);

    render(<ChatWidget open onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/mensaje para cata-bot/i), { target: { value: "hola" } });
    fireEvent.click(screen.getByRole("button", { name: /enviar mensaje/i }));

    const indicator = screen.getByRole("status", { name: /escribiendo/i });
    const dots = Array.from(indicator.querySelectorAll("span"));
    expect(dots).toHaveLength(3);
    for (const dot of dots) {
      // `motion-safe:` IS `@media (prefers-reduced-motion: no-preference)`.
      // A bare `animate-bounce` would run regardless of the user's setting.
      expect(dot).toHaveClass("motion-safe:animate-bounce");
      expect(dot.className).not.toMatch(/(^|\s)animate-bounce/);
    }
  });

  it("gives the send button the system's 40px control size in red", () => {
    render(<ChatWidget open onClose={vi.fn()} />);

    const send = screen.getByRole("button", { name: /enviar mensaje/i });
    expect(send).toHaveClass("h-ctl", "w-10", "bg-cata-red");
  });
});

describe("ChatWidget — quick replies", () => {
  it("offers the role's own shortcuts, because the FAQ is written per role", () => {
    const { unmount } = render(<ChatWidget open role="trainer" onClose={vi.fn()} />);
    for (const prompt of getQuickReplies("trainer")) {
      expect(screen.getByRole("button", { name: prompt })).toBeInTheDocument();
    }
    // An admin-only shortcut must not be offered to a trainer.
    expect(screen.queryByRole("button", { name: "¿Cómo valido un pago?" })).not.toBeInTheDocument();
    unmount();

    render(<ChatWidget open role="admin" onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "¿Cómo valido un pago?" })).toBeInTheDocument();
  });

  it("sends a quick reply as the user's own message", async () => {
    vi.mocked(global.fetch).mockResolvedValue(okResponse({ reply: "Desde Asistencia." }));

    render(<ChatWidget open role="trainer" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "¿Cómo tomo asistencia?" }));

    // The shortcut button carries the same text, so scope to the bubble.
    expect(screen.getByText("¿Cómo tomo asistencia?", { selector: "p" })).toHaveClass("bg-coal");
    await waitFor(() => {
      expect(screen.getByText("Desde Asistencia.")).toBeInTheDocument();
    });
  });

  it("routes 'Hablar con el club' to a real person, not back to the bot", () => {
    render(<ChatWidget open role="admin" onClose={vi.fn()} />);

    const escapeHatch = screen.getByRole("link", { name: "Hablar con el club" });
    // The club's real WhatsApp, from the same config the landing reads.
    expect(escapeHatch).toHaveAttribute("href", "https://wa.me/593994219619");
    expect(escapeHatch).toHaveAttribute("target", "_blank");
    expect(escapeHatch).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("pre-fills the composer when the host opens it with something to say", () => {
    render(
      <ChatWidget
        open
        role="trainer"
        initialDraft="Luis Lopez suma 3 ausencias este mes."
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByLabelText(/mensaje para cata-bot/i)).toHaveValue(
      "Luis Lopez suma 3 ausencias este mes.",
    );
    expect(screen.getByRole("button", { name: /enviar mensaje/i })).toBeEnabled();
  });

  it("never pre-fills the composer while the panel is closed", () => {
    const { rerender } = render(
      <ChatWidget open={false} role="trainer" initialDraft="algo" onClose={vi.fn()} />,
    );
    expect(screen.queryByLabelText(/mensaje para cata-bot/i)).not.toBeInTheDocument();

    rerender(<ChatWidget open role="trainer" initialDraft="algo" onClose={vi.fn()} />);
    expect(screen.getByLabelText(/mensaje para cata-bot/i)).toHaveValue("algo");
  });
});

describe("getQuickReplies", () => {
  it("gives every role two grounded prompts", () => {
    for (const role of ["admin", "trainer", "representante", "estudiante", "unsupported"] as const) {
      expect(getQuickReplies(role)).toHaveLength(2);
    }
  });

  it("falls back to the role-independent questions when there is no role", () => {
    expect(getQuickReplies(null)).toEqual(getQuickReplies("unsupported"));
    expect(getQuickReplies(undefined)).toEqual(getQuickReplies("unsupported"));
  });

  it("never offers a student a question about a screen they cannot reach", () => {
    const studentPrompts = getQuickReplies("estudiante");
    expect(studentPrompts).not.toContain("¿Cómo asigno un nivel?");
    expect(studentPrompts).not.toContain("¿Cómo valido un pago?");
  });
});
