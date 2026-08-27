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
import { render, screen, fireEvent, waitFor, within, cleanup, act } from "@testing-library/react";
import ChatWidget, { SHEET_MEDIA_QUERY } from "@/components/chatbot/ChatWidget";
import { getQuickReplies } from "@/components/chatbot/chat-quick-replies";
import {
  registerSmoothScroll,
  resetSmoothScrollForTests,
  type SmoothScrollController,
} from "@/lib/smooth-scroll";
import { CHATBOT_MAX_MESSAGE_LENGTH } from "@/lib/chatbot-contract";

// `src` and `className` are forwarded, not dropped: which asset the header
// avatar points at, and whether it crops with `object-cover`, are behaviours
// these tests assert.
vi.mock("next/image", () => ({
  __esModule: true,
  default: ({ alt, src, className }: { alt: string; src: string; className?: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} src={src} className={className} />
  ),
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
    expect(await enviarYLeerAlerta(429)).toMatch(/espere/i);
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
// The redesign onto "La Paleta" (`docs/archive/prototypes/prototipos/28-chat.html`).
// ---------------------------------------------------------------------------

describe("ChatWidget — design system", () => {
  it("heads the panel with the assistant's own identity and the response promise", () => {
    const { container } = render(<ChatWidget open onClose={vi.fn()} />);

    // The assistant is CATA-BOT, not "Cata Club": named after the club it
    // was indistinguishable from the human channel one row below it.
    expect(screen.getByText("CATA-BOT")).toBeInTheDocument();
    expect(screen.queryByText("Cata Club")).not.toBeInTheDocument();
    expect(screen.getByText("Responde en segundos")).toBeInTheDocument();
    expect(container.querySelector("header")).toHaveClass("bg-white", "text-ink");
  });

  it("wears the club's real logo, cropped to a circle over the disc", () => {
    const { container } = render(<ChatWidget open onClose={vi.fn()} />);

    const avatar = container.querySelector("header img");
    // Issue #512: the purpose-made illustration is gone in favor of the
    // club's actual logo — no new illustration, no AI/external tool. The
    // full `public/brand/cata-club-logo.jpeg` under plain `object-cover`
    // was tried and rejected on inspection: it's wider than tall, so the
    // browser only trims ~4% off each side and the wordmark band survives
    // almost whole inside the circle. `cata-club-crest-256.png` is a
    // pre-sized 256×256 derivative of a deterministic (non-AI) crop of that
    // same JPEG ending above the wordmark, with its background keyed to
    // transparent — served unoptimized, see issue #681. `object-cover`
    // (not `contain`) still fills the disc from that square source.
    expect(avatar).toHaveAttribute("src", "/brand/cata-club-crest-256.png");
    expect(avatar?.className).toContain("object-cover");
  });

  it("introduces itself by name in the opening bubble", () => {
    render(<ChatWidget open onClose={vi.fn()} />);

    expect(screen.getByText(/Pregúntele cómo usar la app/)).toBeInTheDocument();
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
    expect(studentPrompts).not.toContain("¿Quién define los horarios?");
    expect(studentPrompts).not.toContain("¿Cómo valido un pago?");
  });
});

// ---------------------------------------------------------------------------
// #644 — the panel on a phone.
//
// The panel used to be one shape everywhere: a 340px card parked 74px off the
// bottom-right corner, capped at `72vh`. On a phone that is a card floating
// over a page you can no longer read, with a 23px close button, a 14px field
// the browser zooms into on focus, and nothing at all between the composer and
// the virtual keyboard. Below `sm` it is now a sheet that fills the VISUAL
// viewport.
//
// ## What jsdom can and cannot prove here
//
// jsdom has no layout, no CSS media evaluation, no visual viewport and no
// native focus movement. So this file:
//
//   · asserts the CLASSES that carry the geometry, which is structural — it
//     proves the panel asks for the right box, not that the browser drew it.
//     `tests/e2e/chatbot-mobile-panel.spec.ts` measures the real box.
//   · drives a FAKE `visualViewport`, which is a real test of the component's
//     own listeners and arithmetic: the numbers it publishes as CSS variables
//     are the numbers a phone would produce.
//   · tests the focus trap through the component's OWN key handler, which is
//     the whole trap — this panel is a `<div role="dialog">`, not a native
//     `<dialog>`, so there is no browser behaviour underneath it that jsdom
//     could be faking. Forward and backward wrapping are asserted onto two
//     DIFFERENT named controls, because a wrap test whose two directions land
//     on the same element passes against a handler that ignores `shiftKey`.
// ---------------------------------------------------------------------------

interface FakeViewport {
  /** Turn the phone: a new layout viewport, re-evaluated media queries. */
  rotate: (width: number, height: number) => void;
  /** The visual viewport shrinking, which is all a virtual keyboard is to CSS. */
  resizeVisual: (visualHeight: number, offsetTop?: number) => void;
}

/**
 * Stand a fake layout + visual viewport up around the component.
 *
 * `matchMedia` is stubbed rather than left to jsdom, which answers `false` to
 * every query: without this the sheet could never be under test at all.
 */
function installViewport(
  width: number,
  height: number,
  { coarsePointer = true }: { coarsePointer?: boolean } = {},
): FakeViewport {
  const state = { width, height, visualHeight: height, offsetTop: 0 };
  const mediaListeners = new Set<() => void>();
  const viewportListeners = new Set<() => void>();

  vi.stubGlobal("visualViewport", {
    get width(): number {
      return state.width;
    },
    get height(): number {
      return state.visualHeight;
    },
    get offsetTop(): number {
      return state.offsetTop;
    },
    addEventListener: (_type: string, fn: () => void): void => void viewportListeners.add(fn),
    removeEventListener: (_type: string, fn: () => void): void => void viewportListeners.delete(fn),
  });
  vi.stubGlobal("matchMedia", (query: string) => ({
    media: query,
    get matches(): boolean {
      // The two clauses of `SHEET_MEDIA_QUERY`, evaluated by hand because
      // jsdom evaluates none: narrow, or short with a coarse pointer.
      if (query !== SHEET_MEDIA_QUERY) return false;
      return state.width <= 639 || (state.height <= 479 && coarsePointer);
    },
    addEventListener: (_type: string, fn: () => void): void => void mediaListeners.add(fn),
    removeEventListener: (_type: string, fn: () => void): void => void mediaListeners.delete(fn),
  }));
  const publishSize = (): void => {
    vi.stubGlobal("innerWidth", state.width);
    vi.stubGlobal("innerHeight", state.height);
  };
  publishSize();

  return {
    rotate: (nextWidth: number, nextHeight: number): void => {
      state.width = nextWidth;
      state.height = nextHeight;
      state.visualHeight = nextHeight;
      state.offsetTop = 0;
      publishSize();
      act((): void => {
        for (const fn of mediaListeners) fn();
        for (const fn of viewportListeners) fn();
      });
    },
    resizeVisual: (visualHeight: number, offsetTop = 0): void => {
      state.visualHeight = visualHeight;
      state.offsetTop = offsetTop;
      act((): void => {
        for (const fn of viewportListeners) fn();
      });
    },
  };
}

function panel(): HTMLElement {
  return screen.getByRole("dialog", { name: /cata-bot/i });
}

/** The CSS variables the panel publishes for its own mobile geometry. */
function sheetVars(): Record<string, string> {
  const style = panel().style;
  return {
    top: style.getPropertyValue("--chat-sheet-top"),
    height: style.getPropertyValue("--chat-sheet-height"),
    keyboard: style.getPropertyValue("--chat-keyboard-inset"),
  };
}

describe("ChatWidget — the phone sheet (#644)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.style.overflow = "";
  });

  it("fills the visual viewport at 390x844 instead of floating in a corner", () => {
    installViewport(390, 844);
    render(<ChatWidget open onClose={vi.fn()} />);

    // `100vh` would be the LAYOUT viewport, which on a phone browser stays
    // tall behind the URL bar. The height comes from `visualViewport`.
    expect(sheetVars()).toEqual({ top: "0px", height: "844px", keyboard: "0px" });
    expect(panel().className).toContain("inset-x-0");
    expect(panel().className).toContain("h-[var(--chat-sheet-height,100dvh)]");
    expect(panel().className).toContain("top-[var(--chat-sheet-top,0px)]");
  });

  it("is the pre-#644 corner card, character for character, on a desktop", () => {
    installViewport(1440, 900);
    const { container } = render(<ChatWidget open onClose={vi.fn()} />);

    // The literal that shipped before #644. An exact match, not a `toContain`
    // sweep: "desktop is untouched" is only a claim worth making if a single
    // added utility class breaks it.
    expect(panel().className).toBe(
      "fixed bottom-[74px] right-3 z-40 flex max-h-[min(34rem,72vh)] " +
        "w-[min(340px,calc(100vw-1.5rem))] flex-col card overflow-hidden text-left shadow-elevated " +
        "lg:bottom-5 lg:right-5 lg:max-h-[min(34rem,80vh)]",
    );
    expect(container.querySelector("header")?.className).toBe(
      "flex flex-none items-center gap-[11px] border-b border-line-2 bg-white px-[15px] py-3 text-ink",
    );
    expect(container.querySelector("form")?.className).toBe(
      "flex flex-none items-center gap-2 border-t border-line p-3",
    );
    expect(container.querySelector(".overflow-y-auto")?.className).toBe(
      "flex min-h-[250px] flex-1 flex-col gap-2.5 overflow-y-auto bg-canvas p-[15px]",
    );
    // And no geometry is published at all: there is no sheet to place.
    expect(sheetVars()).toEqual({ top: "", height: "", keyboard: "" });
  });

  it("becomes a sheet on a phone lying on its side, not a 281px corner card", () => {
    // 390x844 turned over is 844 CSS pixels WIDE, so a width-only breakpoint
    // hands a landscape phone back to a card capped at 72vh of a 390px screen.
    installViewport(844, 390);
    render(<ChatWidget open onClose={vi.fn()} />);

    expect(sheetVars()).toEqual({ top: "0px", height: "390px", keyboard: "0px" });
    expect(panel()).toHaveAttribute("aria-modal", "true");
  });

  it("leaves a short desktop window alone, because it has a mouse", () => {
    // Same height as the landscape phone above, and also landscape. The only
    // thing separating them is `pointer: coarse`, and it has to be enough.
    installViewport(1440, 450, { coarsePointer: false });
    render(<ChatWidget open onClose={vi.fn()} />);

    expect(sheetVars()).toEqual({ top: "", height: "", keyboard: "" });
    expect(panel()).toHaveAttribute("aria-modal", "false");
    expect(document.body.style.overflow).toBe("");
  });

  it("follows the visual viewport when the virtual keyboard opens", () => {
    const viewport = installViewport(390, 844);
    render(<ChatWidget open onClose={vi.fn()} />);

    // A 444px keyboard: the visual viewport is now 400px tall, and the sheet
    // has to be 400px tall too or the composer is under the keys.
    viewport.resizeVisual(400);

    expect(sheetVars()).toEqual({ top: "0px", height: "400px", keyboard: "444px" });
  });

  it("tracks the visual viewport when the page scrolls under the keyboard", () => {
    const viewport = installViewport(390, 844);
    render(<ChatWidget open onClose={vi.fn()} />);

    // iOS scrolls the layout viewport under the visual one; a sheet pinned at
    // `top: 0` would be that far off the top of what the user can see.
    viewport.resizeVisual(400, 120);

    expect(sheetVars()).toEqual({ top: "120px", height: "400px", keyboard: "324px" });
  });

  it("re-measures when the phone is turned, and stays a sheet through it", () => {
    const viewport = installViewport(390, 844);
    render(<ChatWidget open onClose={vi.fn()} />);
    expect(sheetVars().height).toBe("844px");

    viewport.rotate(844, 390);

    expect(sheetVars()).toEqual({ top: "0px", height: "390px", keyboard: "0px" });
    expect(panel()).toHaveAttribute("aria-modal", "true");
  });

  it("still fills the screen on a viewport narrower than 390", () => {
    installViewport(320, 568);
    render(<ChatWidget open onClose={vi.fn()} />);

    expect(sheetVars()).toEqual({ top: "0px", height: "568px", keyboard: "0px" });
    expect(panel()).toHaveAttribute("aria-modal", "true");
  });

  it("stops the body scrolling behind the sheet, and gives it back on close", () => {
    installViewport(390, 844);
    const { rerender } = render(<ChatWidget open onClose={vi.fn()} />);

    expect(document.body.style.overflow).toBe("hidden");

    rerender(<ChatWidget open={false} onClose={vi.fn()} />);
    expect(document.body.style.overflow).toBe("");
  });

  it("never touches the body's scrolling on a desktop viewport", () => {
    installViewport(1440, 900);
    render(<ChatWidget open onClose={vi.fn()} />);

    // The corner card covers 340px of the page; locking the page behind it
    // would be a regression, not a fix.
    expect(document.body.style.overflow).toBe("");
    expect(panel()).toHaveAttribute("aria-modal", "false");
  });

  it("scrolls the history on its own, inside a sheet that does not scroll", () => {
    installViewport(390, 844);
    const { container } = render(<ChatWidget open onClose={vi.fn()} />);

    const history = container.querySelector(".overflow-y-auto");
    // `min-h-0` is what lets the history shrink when the keyboard takes half
    // the screen; with the old `min-h-[250px]` floor the flex column overflows
    // and the composer leaves the viewport instead.
    expect(history).toHaveClass("flex-1", "min-h-0", "overflow-y-auto", "overscroll-contain");
    expect(history?.className).not.toContain("min-h-[250px]");
    expect(panel()).toHaveClass("overflow-hidden");
  });

  it("gives the close control a 44px touch target without moving the desktop one", () => {
    installViewport(390, 844);
    render(<ChatWidget open onClose={vi.fn()} />);

    const close = screen.getByRole("button", { name: /cerrar cata-bot/i });
    // Structural: jsdom has no layout, so this asserts the box the panel asks
    // for. The measured 44x44 lives in the Playwright spec.
    expect(close).toHaveClass("h-11", "w-11", "inline-flex");

    cleanup();
    installViewport(1440, 900);
    render(<ChatWidget open onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: /cerrar cata-bot/i }).className).toContain(
      "shrink-0 rounded-lg p-1 text-ink-3",
    );
  });

  it("types above the zoom threshold, so the browser has no reason to zoom in", () => {
    installViewport(390, 844);
    render(<ChatWidget open onClose={vi.fn()} />);

    const input = screen.getByLabelText(/mensaje para cata-bot/i);
    // Under 16px, mobile Safari zooms the page on focus and the sheet is
    // suddenly wider than the screen. This ramp has no 16px step — `sm` is
    // 13.5 and `base` is 15 — so the field takes `lg`, the smallest step that
    // clears the threshold. A literal `text-[16px]` is what
    // `arbitrary-style-values.test.ts` exists to keep out.
    expect(input).toHaveClass("text-lg", "h-12");
    expect(screen.getByRole("button", { name: /enviar mensaje/i })).toHaveClass("h-12", "w-12");

    cleanup();
    installViewport(1440, 900);
    render(<ChatWidget open onClose={vi.fn()} />);
    expect(screen.getByLabelText(/mensaje para cata-bot/i)).toHaveClass("h-ctl", "text-sm");
  });

  it("keeps the composer clear of the home indicator, and of nothing while typing", () => {
    installViewport(390, 844);
    const { container } = render(<ChatWidget open onClose={vi.fn()} />);

    const form = container.querySelector("form");
    // The safe-area inset is real estate the browser already reserved; adding
    // it on top of the keyboard inset would strand the composer mid-screen.
    expect(form?.className).toContain(
      "pb-[max(0.75rem,calc(env(safe-area-inset-bottom)_-_var(--chat-keyboard-inset,0px)))]",
    );
    expect(container.querySelector("header")?.className).toContain(
      "pt-[max(0.75rem,env(safe-area-inset-top))]",
    );
    expect(panel().className).toContain("pl-[env(safe-area-inset-left)]");
    expect(panel().className).toContain("pr-[env(safe-area-inset-right)]");
  });
});

describe("ChatWidget — focus trapped in the sheet (#644)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.style.overflow = "";
  });

  /** Types, so the send button is enabled and is therefore the last stop. */
  function openWithADraft(): { close: HTMLElement; send: HTMLElement } {
    render(<ChatWidget open onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/mensaje para cata-bot/i), { target: { value: "hola" } });
    return {
      close: screen.getByRole("button", { name: /cerrar cata-bot/i }),
      send: screen.getByRole("button", { name: /enviar mensaje/i }),
    };
  }

  it("wraps forward from the send button to the close button", () => {
    installViewport(390, 844);
    const { close, send } = openWithADraft();
    send.focus();

    const notCancelled = fireEvent.keyDown(send, { key: "Tab" });

    expect(notCancelled).toBe(false);
    expect(document.activeElement).toBe(close);
  });

  it("wraps backward from the close button to the send button", () => {
    installViewport(390, 844);
    const { close, send } = openWithADraft();
    close.focus();

    const notCancelled = fireEvent.keyDown(close, { key: "Tab", shiftKey: true });

    // Deliberately a DIFFERENT element from the forward case: a wrap test
    // whose two directions land on the same control is green against a
    // handler that never reads `shiftKey`.
    expect(notCancelled).toBe(false);
    expect(document.activeElement).toBe(send);
    expect(document.activeElement).not.toBe(close);
  });

  it("leaves the middle of the panel to the browser", () => {
    installViewport(390, 844);
    const { close } = openWithADraft();
    close.focus();

    // Tab off the FIRST element going forward is an ordinary move.
    expect(fireEvent.keyDown(close, { key: "Tab" })).toBe(true);
    expect(document.activeElement).toBe(close);
  });

  it("pulls focus back in when it has escaped the panel", () => {
    installViewport(390, 844);
    // A control on the page BEHIND the sheet. `document.body.focus()` was the
    // first attempt and proved nothing: the body is not focusable, so focus
    // never actually left the composer and the "outside" branch was never
    // reached.
    render(
      <>
        <button type="button">Un control de la página</button>
        <ChatWidget open onClose={vi.fn()} />
      </>,
    );
    const outside = screen.getByRole("button", { name: "Un control de la página" });
    outside.focus();
    expect(document.activeElement).toBe(outside);

    fireEvent.keyDown(panel(), { key: "Tab" });

    expect(document.activeElement).toBe(screen.getByRole("button", { name: /cerrar cata-bot/i }));
  });

  it("does not trap anything on a desktop viewport", () => {
    installViewport(1440, 900);
    const { send } = openWithADraft();
    send.focus();

    // The corner card is not modal: Tab out of it goes on to the page, which
    // is what it has always done.
    expect(fireEvent.keyDown(send, { key: "Tab" })).toBe(true);
    expect(fireEvent.keyDown(send, { key: "Tab", shiftKey: true })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The scroll lock, and the half of it `overflow: hidden` could never do.
//
// Measured on the landing page at 390x844 with the sheet open: one wheel
// gesture took `window.scrollY` from 0 to 886 BEHIND the sheet. The body lock
// was applied and was working — it stops the user. It does not stop a script,
// and the landing mounts Lenis, which cancels the wheel event and scrolls the
// document itself. Under `prefers-reduced-motion: reduce` Lenis never mounts
// and the identical gesture moved nothing, which is what pinned the cause to
// the smooth-scroll engine rather than to the lock.
// ---------------------------------------------------------------------------

/** A stand-in for Lenis, with the contract `smooth-scroll.ts` consumes. */
function fakeEngine(): SmoothScrollController & { stops: number; starts: number } {
  return {
    stops: 0,
    starts: 0,
    isStopped: false,
    stop(): void {
      this.stops += 1;
      (this as { isStopped: boolean }).isStopped = true;
    },
    start(): void {
      this.starts += 1;
      (this as { isStopped: boolean }).isStopped = false;
    },
  };
}

describe("ChatWidget — the page behind the sheet stays put", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.style.overflow = "";
    resetSmoothScrollForTests();
  });

  it("holds the page's smooth scroll while the sheet is open, and hands it back", () => {
    installViewport(390, 844);
    const engine = fakeEngine();
    registerSmoothScroll(engine);

    const { rerender } = render(<ChatWidget open onClose={vi.fn()} />);
    expect(engine.isStopped).toBe(true);

    rerender(<ChatWidget open={false} onClose={vi.fn()} />);
    expect(engine.isStopped).toBe(false);
    expect(engine.starts).toBe(1);
  });

  it("hands the page back when the panel unmounts while still open", () => {
    // Navigating away with the sheet up: the component never re-renders
    // closed, it simply stops existing. A lock released only on the close
    // transition would leave the landing frozen for the rest of the session.
    installViewport(390, 844);
    const engine = fakeEngine();
    registerSmoothScroll(engine);

    const { unmount } = render(<ChatWidget open onClose={vi.fn()} />);
    expect(engine.isStopped).toBe(true);

    unmount();
    expect(engine.isStopped).toBe(false);
  });

  it("never touches the smooth scroll for the corner card", () => {
    // The card covers 340px of a desktop page; freezing the rest of it would
    // be a regression, not a fix — same reasoning as the body lock's own
    // desktop exemption.
    installViewport(1440, 900);
    const engine = fakeEngine();
    registerSmoothScroll(engine);

    render(<ChatWidget open onClose={vi.fn()} />);

    expect(engine.stops).toBe(0);
    expect(engine.isStopped).toBe(false);
  });

  it("keeps the history's own scrolling out of the engine's hands", () => {
    // A held Lenis cancels every wheel gesture it sees, including the ones
    // aimed at the message list — which, on a sheet that covers the screen, is
    // most of them. `data-lenis-prevent` is Lenis's own opt-out.
    installViewport(390, 844);
    const { container } = render(<ChatWidget open onClose={vi.fn()} />);

    expect(container.querySelector(".overflow-y-auto")).toHaveAttribute("data-lenis-prevent");
  });
});

// ---------------------------------------------------------------------------
// The message limit — enforced where it can still be acted on.
//
// The composer had no `maxLength` at all (`maxLength === -1`), so 2500
// characters were typed, sent, rejected by the BFF with a 400, and reported to
// the user as "No se pudo contactar a CATA-BOT. Inténtelo de nuevo en un
// momento." — which is false twice over: the assistant WAS reached, and the
// advice was to retry the one thing that cannot work.
// ---------------------------------------------------------------------------

const LIMITE = CHATBOT_MAX_MESSAGE_LENGTH;

function renderComposer(): { input: HTMLElement; send: HTMLElement; form: HTMLElement } {
  const { container } = render(<ChatWidget open onClose={vi.fn()} />);
  return {
    input: screen.getByLabelText(/mensaje para cata-bot/i),
    send: screen.getByRole("button", { name: /enviar mensaje/i }),
    form: container.querySelector("form") as HTMLElement,
  };
}

describe("ChatWidget — the message limit", () => {
  it("says nothing while the message is nowhere near the limit", () => {
    const { input } = renderComposer();
    fireEvent.change(input, { target: { value: "¿Cómo veo mis pagos?" } });

    // A running count under a two-word question is noise, and this panel is
    // for two-word questions.
    expect(screen.queryByText(/caracteres/i)).not.toBeInTheDocument();
    expect(input).not.toHaveAttribute("aria-describedby");
  });

  it("shows the count over the last 200 characters, before anything is wrong", () => {
    const { input, send } = renderComposer();
    fireEvent.change(input, { target: { value: "x".repeat(LIMITE - 200) } });

    expect(screen.getByText(/1\.800 \/ 2\.000 caracteres/)).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-describedby");
    // Near is not over: nothing is blocked yet.
    expect(send).toBeEnabled();
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("marks the field invalid and blocks the send past the limit", () => {
    const { input, send } = renderComposer();
    fireEvent.change(input, { target: { value: "x".repeat(2500) } });

    expect(screen.getByText(/2\.500 \/ 2\.000 caracteres — acórtelo para poder enviarlo/)).toBeInTheDocument();
    expect(send).toBeDisabled();
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("never lets an over-length message leave the browser", () => {
    const { input, form } = renderComposer();
    fireEvent.change(input, { target: { value: "x".repeat(2500) } });
    // Submitted through the form, not the button: the guard has to hold even
    // when the disabled button is bypassed (Enter, a stray programmatic
    // submit) — a disabled control is a hint, not an enforcement.
    fireEvent.submit(form);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "El mensaje supera el límite de 2.000 caracteres. Acórtelo e inténtelo de nuevo.",
    );
  });

  it("leaves the draft in the composer so it can be shortened, not retyped", () => {
    const { input, form } = renderComposer();
    fireEvent.change(input, { target: { value: "x".repeat(2500) } });
    fireEvent.submit(form);

    expect((input as HTMLInputElement).value).toHaveLength(2500);
    // And nothing was optimistically added to the conversation.
    expect(screen.queryByText("x".repeat(2500))).not.toBeInTheDocument();
  });

  it("sends a message that sits exactly on the limit", async () => {
    vi.mocked(global.fetch).mockResolvedValue(okResponse({ reply: "Listo." }));
    const { input, send } = renderComposer();
    fireEvent.change(input, { target: { value: "x".repeat(LIMITE) } });

    expect(send).toBeEnabled();
    fireEvent.click(send);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    // The off-by-one worth naming: the BFF accepts exactly this length, so the
    // composer must not round it down to "too long".
    expect(await screen.findByText("Listo.")).toBeInTheDocument();
  });

  it("carries no hard maxLength, so a long paste is never silently truncated", () => {
    const { input } = renderComposer();

    // A browser-enforced cap drops the tail of a paste without saying so. The
    // user is told to shorten it instead — which is why the over-limit state
    // has to be reachable at all.
    expect((input as HTMLInputElement).maxLength).toBe(-1);
  });

  it("names the length problem when the BFF answers 400 with its code", async () => {
    // Defence in depth: the client guard means this 400 should be unreachable
    // from the UI, but the translator must still tell it from the other 400s
    // this route can answer — that is what `code` is for.
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          message: "El mensaje supera el límite de 2.000 caracteres. Acórtelo e inténtelo de nuevo.",
          code: "chatbot_mensaje_demasiado_largo",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      ),
    );
    const { input, send } = renderComposer();
    fireEvent.change(input, { target: { value: "hola" } });
    fireEvent.click(send);

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent(/supera el límite de 2\.000 caracteres/);
    expect(alerta).not.toHaveTextContent(/no se pudo contactar/i);
  });

  it("still says the generic thing for a 400 that names no reason", async () => {
    // A malformed body is a client bug, not something the reader can fix, and
    // it must not borrow the length message just because it shares a status.
    vi.mocked(global.fetch).mockResolvedValue(errorResponse(400));
    const { input, send } = renderComposer();
    fireEvent.change(input, { target: { value: "hola" } });
    fireEvent.click(send);

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent(/no se pudo contactar a cata-bot/i);
  });
});
