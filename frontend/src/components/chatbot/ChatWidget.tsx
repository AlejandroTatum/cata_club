/**
 * ChatWidget — CATA-BOT, the club's help assistant panel.
 *
 * ## The assistant has a name and a face
 *
 * It used to introduce itself as "Cata Club" behind the club's own JPEG
 * wordmark, which was wrong: it made the bot indistinguishable from the
 * human channel one row below it ("Hablar con el club"). The assistant is
 * CATA-BOT everywhere it identifies itself (header, greeting, ARIA labels,
 * failure copy). "Hablar con el club" keeps the club's name on purpose: that
 * link hands off to a person.
 *
 * A purpose-made circular illustration was explored for the avatar and
 * dropped (issue #512): the product owner's call is the club's own logo, not
 * a new illustration and not any AI/external image-generation tool. Running
 * the full `/brand/cata-club-logo.jpeg` (1080×996, wordmark below the
 * wreath) through plain `object-cover` was tried first and failed on
 * inspection: the source is wider than tall, so the browser scales it down
 * by height and only trims ~4% off each side — the "CATA CLUB / TENIS DE
 * MESA" band survives almost whole inside the circle and reads as noise at
 * 32/40px, not as a crest. `/brand/cata-club-logo-avatar.png` is a
 * deterministic derivative of that same JPEG — a 620×620 crop of the wreath
 * and player silhouette ending above the wordmark band, background
 * chroma-keyed to transparent (Python/Pillow: threshold + edge unblend, no
 * AI) so `bg-white` shows through instead of the JPEG's light-grey square.
 * See the header's own comment below for the exact crop and why the source
 * JPEG stays untouched (the landing and other pages still use it whole).
 *
 * Talks to the backend's FAQ chatbot (no RAG, no persistence) via the BFF
 * proxy at POST /api/chatbot (see src/app/api/chatbot/route.ts), which itself
 * proxies the public, rate-limited `POST /chatbot/consultar` on FastAPI.
 *
 * Open/closed state is OWNED BY THE HOST, not by this component. There is now
 * exactly ONE host — `HelpChatDock`, mounted once in the root layout — and
 * every trigger in the product opens that one panel through `help-chat-store`.
 * The floating launcher lives on the dock, not here: this component still
 * renders no trigger of its own, so nothing about the panel can park itself
 * over the login form, the landing's WhatsApp block or the trainer's
 * attendance controls the way the old FAB did.
 *
 * Visual contract from `docs/archive/prototypes/prototipos/28-chat.html` + `_sistema.css`
 * (`.chat`, `.bub`, `.typing`, `.quicks`, `.sendb`): 340px panel, coal header
 * with the logo disc and "Responde en segundos", GREY bot bubbles and COAL
 * user bubbles (the user's turn used to be red — red is reserved for the
 * primary CTA and for destructive/error, and a red bubble read as an error),
 * 32px quick replies, a three-dot typing indicator, and a 40px input beside a
 * 40px red send button.
 */

"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import { X, Send, AlertTriangle } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { holdSmoothScroll } from "@/lib/smooth-scroll";
import {
  CHATBOT_MAX_MESSAGE_LENGTH,
  CHATBOT_MAX_MESSAGE_LENGTH_LABEL,
  CHATBOT_MESSAGE_TOO_LONG_CODE,
  CHATBOT_MESSAGE_TOO_LONG_TEXT,
  formatCharacterCount,
} from "@/lib/chatbot-contract";
import { consultarChatbot, ApiClientError, type ChatbotTurno } from "@/services/api";
import { landingConfig, toWhatsAppLink } from "@/app/landing/landing-config";
import { getQuickReplies, TALK_TO_CLUB_LABEL } from "./chat-quick-replies";
import { ASSISTANT_FOCUS_RING } from "./chat-focus-ring";
import type { UserRole } from "@/types/domain";

/** How many prior turns to send as `historial` on each request — mirrors the backend's own cap. */
const MAX_TURNOS_HISTORIAL = 6;

/**
 * How close to the limit the counter appears.
 *
 * Not always on: a running count under a field nobody is near the end of is
 * noise, and it would sit under every two-word question the assistant is
 * actually for. It shows for the last 200 characters, which is long enough to
 * finish a sentence and notice.
 */
const CONTADOR_DESDE = CHATBOT_MAX_MESSAGE_LENGTH - 200;

/** The assistant's name, in the one place it is spelled. */
export const BOT_NAME = "CATA-BOT";

/**
 * The club's real WhatsApp, from the same config the landing's contact block
 * reads. "Hablar con el club" has to reach an actual person; sending the
 * phrase to the bot would just get another bot answer.
 */
const CLUB_WHATSAPP_LINK = toWhatsAppLink(landingConfig.contact.whatsapp[0]);

interface MensajeChat extends ChatbotTurno {
  id: number;
}

let proximoId = 0;

/**
 * One message per failure class, keyed by the status the BFF forwards from the
 * backend (see src/app/api/chatbot/route.ts and the backend's
 * chatbot_servicio.py, which maps each provider failure to its own status).
 *
 * This used to be a single string for every rejection, which is why the
 * failures read as random: a rate limit, a timeout and an unreachable gateway
 * all came out as "no se pudo contactar". Each case now says what the user can
 * actually do — wait, retry, or come back later.
 *
 * 429 is NOT handled here (issue #708): see `mensajeLimiteConsultas` below —
 * it needs the actual wait from `Retry-After`, which this function's plain
 * `string` return can't carry, and it drives the composer lock/countdown too.
 */
function mensajeDeError(error: unknown): string {
  // The named reason first, and only then the status. A `400` from this route
  // can be a malformed body, an empty message OR a message over the limit, and
  // the last one is the only one the person typing can do anything about — it
  // used to fall through to "No se pudo contactar a CATA-BOT", which sent them
  // to retry the one thing that cannot work. `code` is what tells them apart
  // (see `src/app/api/chatbot/route.ts`); a 400 that carries no code is still
  // a client bug and still gets the generic line.
  if (error instanceof ApiClientError && error.code === CHATBOT_MESSAGE_TOO_LONG_CODE) {
    return CHATBOT_MESSAGE_TOO_LONG_TEXT;
  }
  const status = error instanceof ApiClientError ? error.status : null;
  switch (status) {
    case 504:
      return `${BOT_NAME} tardó demasiado en responder. Vuelva a intentarlo.`;
    case 503:
      return `${BOT_NAME} no está disponible en este momento. Inténtelo más tarde.`;
    default:
      return `No se pudo contactar a ${BOT_NAME}. Inténtelo de nuevo en un momento.`;
  }
}

/**
 * How long to lock the composer when a 429 carries no `Retry-After` at all
 * (the backend's own handler only skips it if computing it itself throws —
 * see `_manejador_limite_excedido`'s last `except`, `backend/main.py` — so
 * this is a defensive floor, not the expected case). Matches the burst
 * window's own size ("4/10second", `LIMITE_CONSULTAS` in
 * `chatbot_router.py`): whatever the real remaining time was, it was at
 * most this.
 */
const RATE_LIMIT_FALLBACK_SECONDS = 10;

/** "1 segundo" vs "2 segundos" — the counter beside the composer does the same singular/plural split. */
function formatearSegundos(segundos: number): string {
  return segundos === 1 ? "1 segundo" : `${segundos} segundos`;
}

/**
 * What a visitor reads after tripping the burst limit (issue #708, `LIMITE_
 * CONSULTAS` in `chatbot_router.py` — deliberately left unchanged, see that
 * issue: it is real protection once a paid provider is configured, and this
 * fix is only about what the 429 SAYS).
 *
 * Before this, every failure funneled through `mensajeDeError` and 429 was
 * indistinguishable in spirit from a dead backend: "no está disponible" —
 * which stopped being true the moment the no-provider fallback (#635)
 * started answering in ~6ms, because then five ordinary questions typed at
 * human speed could trip the limit on their own. This says what actually
 * happened (several questions arrived close together, not a bot that is
 * down) and the REAL wait, taken from `Retry-After` — never a constant,
 * because the one number that could be wrong is exactly the one nobody
 * should guess at. Deliberately not scolding: someone asking five quick
 * questions is an interested visitor, not someone to reprimand.
 */
function mensajeLimiteConsultas(segundosRestantes: number): string {
  return `Hizo varias consultas seguidas. Espere ${formatearSegundos(segundosRestantes)} y vuelva a intentarlo.`;
}

/** `.bub` — 12px radius, 86% max width, with the tail corner squared off. */
const BUBBLE_BASE =
  "max-w-[86%] whitespace-pre-line rounded-xl px-3 py-2.5 text-sm";

/** The one failure-alert box style — shared by the generic error and the 429 lock so they read as the same kind of thing. */
const ALERT_CLASS =
  "flex items-start gap-2 rounded-ctl border border-state-bad/25 bg-state-bad-bg px-3 py-2.5 text-xs text-state-bad";

/**
 * When the panel is a sheet rather than the corner card.
 *
 * The first clause is Tailwind's `sm` prefix inverted (`sm` is `min-width:
 * 640px`, so everything it does not reach is `max-width: 639.98px`) and it is
 * the phone held upright.
 *
 * The second clause is that same phone turned sideways, and it is not
 * redundant: a 390x844 device in landscape is 844 CSS pixels WIDE, so the
 * width clause hands it back to a corner card that is capped at `72vh` — 281px
 * of panel on a 390px-tall screen, and perhaps 130px once the keyboard is up.
 * Short-and-landscape is exactly where the sheet is worth most.
 *
 * `pointer: coarse` is what keeps that second clause off a desktop: a browser
 * window dragged down to 1440x450 is also short and also landscape, and it has
 * a mouse. Nothing with a fine pointer ever becomes a sheet.
 *
 * Read through `matchMedia` and not through `window.innerWidth`, because
 * `innerWidth` is the visual viewport under pinch-zoom while the CSS
 * breakpoint is not — a panel whose JavaScript and whose stylesheet disagreed
 * about which shape it is would trap focus inside a 340px corner card.
 *
 * Exported for the tests: jsdom answers `false` to every media query, so the
 * sheet can only be put under test by a stub that answers this exact string.
 */
export const SHEET_MEDIA_QUERY =
  "(max-width: 639.98px), (max-height: 479.98px) and (pointer: coarse)";

/** Everything inside the panel a browser will let the user Tab to. */
const FOCUSABLE_SELECTOR =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),' +
  'textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** `.quick` — 32px pill. */
const QUICK_REPLY =
  "inline-flex h-ctl-sm items-center rounded-full border border-line-2 bg-paper px-3 " +
  "text-xs font-semibold text-ink-2 transition-colors hover:border-ink-3 hover:text-ink " +
  `${ASSISTANT_FOCUS_RING} disabled:cursor-not-allowed disabled:opacity-45`;

/**
 * Which of the two panels this is.
 *
 * ONE answer drives everything — the classes, `aria-modal`, the focus trap and
 * the body scroll lock. The first draft split it: Tailwind's `sm:` prefix
 * carried the geometry and this boolean carried the behaviour, and the two
 * disagreed the moment `SHEET_MEDIA_QUERY` grew its landscape clause. A phone
 * on its side was then a 340px corner card that had trapped focus and stopped
 * the page scrolling. A breakpoint written down twice is a breakpoint that will
 * be edited once.
 *
 * The initial value is read eagerly rather than left `false` until an effect
 * runs, so the sheet is a sheet on its first paint and never flashes the card.
 * That is safe here even though it reads the browser during render: the panel
 * returns `null` while closed, it can only open from a click, and hydration
 * therefore always compares `null` against `null`.
 */
function useSheetPresentation(): boolean {
  const [isSheet, setIsSheet] = useState(matchesSheet);

  useEffect((): undefined | (() => void) => {
    if (typeof window.matchMedia !== "function") return undefined;
    const query = window.matchMedia(SHEET_MEDIA_QUERY);
    const sync = (): void => setIsSheet(query.matches);
    sync();
    query.addEventListener("change", sync);
    return (): void => query.removeEventListener("change", sync);
  }, []);

  return isSheet;
}

function matchesSheet(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(SHEET_MEDIA_QUERY).matches;
}

interface SheetGeometry {
  /** Where the visible area starts inside the layout viewport. */
  top: number;
  /** How tall the visible area is right now. */
  height: number;
  /** How much of the layout viewport the virtual keyboard is eating. */
  keyboardInset: number;
}

/**
 * The sheet's box, measured from `visualViewport` rather than assumed.
 *
 * `100vh` — and `100%`, and `inset-0` — are the LAYOUT viewport, which on a
 * phone browser is deliberately not what the user can see: it stays tall behind
 * a collapsed URL bar, and it does not move at all when the virtual keyboard
 * opens. A sheet sized to it puts its own composer under the keys, which is the
 * exact complaint in #644. `100dvh` fixes the URL bar and still says nothing
 * about the keyboard.
 *
 * `visualViewport` is the only surface that answers both questions, so the two
 * numbers it gives — `offsetTop` and `height` — become the sheet's `top` and
 * `height`, republished as CSS variables so the `sm:` breakpoint can still
 * override them (an inline style cannot carry a media query, a variable it
 * reads can be left unread).
 */
function useSheetGeometry(active: boolean): SheetGeometry | null {
  const [geometry, setGeometry] = useState<SheetGeometry | null>(null);

  useEffect((): undefined | (() => void) => {
    if (!active) {
      setGeometry(null);
      return undefined;
    }
    const viewport = window.visualViewport;
    if (!viewport) return undefined;

    function measure(): void {
      const visible = viewport as VisualViewport;
      const top = Math.max(0, visible.offsetTop);
      setGeometry({
        top,
        height: visible.height,
        // What is left of the layout viewport once the visible area and the
        // offset above it are accounted for: on a phone that is the keyboard.
        keyboardInset: Math.max(0, window.innerHeight - visible.height - top),
      });
    }

    measure();
    viewport.addEventListener("resize", measure);
    viewport.addEventListener("scroll", measure);
    return (): void => {
      viewport.removeEventListener("resize", measure);
      viewport.removeEventListener("scroll", measure);
    };
  }, [active]);

  return geometry;
}

/**
 * Stop the page scrolling behind the sheet — and only behind the sheet.
 *
 * TWO locks, because `overflow: hidden` only stops one of the two ways this
 * page can scroll. It stops the USER. It does not stop a SCRIPT, and the
 * landing page mounts Lenis, which cancels the wheel event and then scrolls
 * the document itself: with the sheet open at 390x844, one wheel gesture took
 * the page from `scrollY 0` to `886` behind it. So the smooth-scroll engine is
 * held too, through `src/lib/smooth-scroll.ts` — Lenis's own documented
 * `stop()`, not a CSS workaround, and a no-op on every surface that has no
 * Lenis (the app pages, `/login`).
 *
 * The body's previous value is restored rather than cleared, so this composes
 * with anything else that had already locked it (a modal that opened the
 * assistant from inside itself, for one), and the hold is released the same
 * way — including when the panel unmounts while still open.
 */
function usePageScrollLock(locked: boolean): void {
  useEffect((): undefined | (() => void) => {
    if (!locked) return undefined;
    const { body } = document;
    const previous = body.style.overflow;
    body.style.overflow = "hidden";
    const releaseSmoothScroll = holdSmoothScroll();
    return (): void => {
      releaseSmoothScroll();
      body.style.overflow = previous;
    };
  }, [locked]);
}

/** The classes that differ between the two panels, and only those. */
interface PanelSkin {
  panel: string;
  header: string;
  close: string;
  history: string;
  form: string;
  input: string;
  send: string;
}

/**
 * The corner card, unchanged.
 *
 * Every string here is the one that shipped before #644, character for
 * character. That is the whole "desktop is untouched" claim, and it is
 * asserted as an exact match in `ChatWidget.test.tsx` — a claim written in a
 * comment is a claim nobody can check.
 */
const CARD: PanelSkin = {
  panel:
    "fixed bottom-[74px] right-3 z-40 flex max-h-[min(34rem,72vh)] " +
    "w-[min(340px,calc(100vw-1.5rem))] flex-col card overflow-hidden text-left shadow-elevated " +
    "lg:bottom-5 lg:right-5 lg:max-h-[min(34rem,80vh)]",
  header:
    "flex flex-none items-center gap-[11px] border-b border-line-2 bg-white px-[15px] py-3 text-ink",
  close: "shrink-0 rounded-lg p-1 text-ink-3 transition-colors hover:bg-paper hover:text-ink",
  history: "flex min-h-[250px] flex-1 flex-col gap-2.5 overflow-y-auto bg-canvas p-[15px]",
  form: "flex flex-none items-center gap-2 border-t border-line p-3",
  input:
    "h-ctl min-w-0 flex-1 rounded-ctl border border-line-2 bg-paper px-[13px] text-sm text-ink " +
    "transition-colors placeholder:text-ink-3 focus:border-cata-red " +
    "disabled:cursor-not-allowed disabled:opacity-50",
  send:
    "flex h-ctl w-10 flex-none items-center justify-center rounded-ctl bg-cata-red text-white " +
    "transition-colors hover:bg-cata-red-dark",
};

/**
 * The sheet: the panel IS the screen.
 *
 * Pinned to the VISUAL viewport rather than to `100vh`, square-cornered, inset
 * from the notch on both sides, and with a composer sized for a thumb. `card`
 * stays — it is the `@layer components` class that carries the surface — while
 * `rounded-none` and `border-0` overrule its radius and hairline from the
 * utilities layer, which sits above components in the cascade.
 *
 * `z-modal` and NOT the card's `z-furniture`, which is the whole of #725. The
 * two panels shared one z-index because they are one component, but they are
 * not one kind of thing: the card is a float that coexists with the page, and
 * the sheet IS the page while it is up. At `z-40` the landing's sticky navbar
 * (`z-index: 50`) painted straight through it — measured in WebKit at 390x844,
 * 0 of the close button's 1936 pixels answered `elementFromPoint`, and the tap
 * that should have closed the sheet followed the nav's "ENTRAR" link to
 * `/login` with the sheet still open on top. On a phone that is a trap and not
 * a cosmetic one: the sheet covers the viewport exactly, so there is no
 * backdrop to tap; nothing in this component listens for a swipe; opening it
 * pushes no history entry, so the hardware back button leaves the site rather
 * than closing the sheet; and `HelpChatDock` withdraws the launcher to
 * `pointer-events: none` while the panel is open, so it cannot be toggled
 * shut. Escape works and is the only way out — which a phone does not have.
 *
 * The band and not a bigger number: `z-modal` sits above `chrome` and below
 * `toast`, and `tailwind.config.ts` carries the reasoning for both edges. The
 * corner card stays on `z-40` verbatim — `ChatWidget.test.tsx` pins that string
 * character for character, and "desktop is untouched" is the point.
 */
const SHEET: PanelSkin = {
  panel:
    "fixed inset-x-0 top-[var(--chat-sheet-top,0px)] z-modal flex " +
    "h-[var(--chat-sheet-height,100dvh)] flex-col card overflow-hidden rounded-none border-0 " +
    "text-left pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]",
  // The sheet's top edge IS the top of the screen, so the header clears the
  // status bar itself; the card never touched a safe area.
  header:
    "flex flex-none items-center gap-[11px] border-b border-line-2 bg-white px-[15px] pb-3 " +
    "pt-[max(0.75rem,env(safe-area-inset-top))] text-ink",
  // 44x44 — the touch-target floor in `docs/ux/objetivo-tactil.md`, which a
  // 15px glyph in 4px of padding (23px square) was half of.
  close:
    "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-ink-3 " +
    "transition-colors hover:bg-paper hover:text-ink",
  // `min-h-0` instead of the 250px floor: a flex child will not shrink below
  // its content without it, so with the keyboard open the column overflowed a
  // panel that is `overflow-hidden` and took the composer off screen with it.
  // `overscroll-contain` keeps a flick at the top of the history from
  // scrolling the page behind.
  history:
    "flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto overscroll-contain bg-canvas p-[15px]",
  // Clear of the home indicator — but not on top of the keyboard, which has
  // already taken that space: `max(12px, safe-area − keyboard)` collapses back
  // to the ordinary padding while typing.
  form:
    "flex flex-none items-center gap-2 border-t border-line p-3 " +
    "pb-[max(0.75rem,calc(env(safe-area-inset-bottom)_-_var(--chat-keyboard-inset,0px)))]",
  // `text-lg`, and the reason is the platform rather than the type system:
  // mobile Safari zooms the page whenever a focused field is under 16px, and
  // that zoom is the "escribir resulta incómodo" in #644 — it magnifies the
  // sheet past the screen edge and never zooms back out. `maximum-scale=1`
  // would also stop it and would break pinch-zoom for everyone, which is
  // WCAG 1.4.4, so the field has to carry the floor itself.
  //
  // 16px is not a step on this ramp: `text-sm` is 13.5 and `text-base` is 15,
  // both under the threshold, and `text-lg` (20px) is the smallest step at or
  // above it. A literal `text-[16px]` would clear the threshold by less, and
  // `arbitrary-style-values.test.ts` forbids it — the typography allowlist was
  // emptied on purpose and reopening it for one field is how it refills. A
  // named step it is.
  input:
    "h-12 min-w-0 flex-1 rounded-ctl border border-line-2 bg-paper px-[13px] text-lg " +
    "text-ink transition-colors placeholder:text-ink-3 focus:border-cata-red " +
    "disabled:cursor-not-allowed disabled:opacity-50",
  send:
    "flex h-12 w-12 flex-none items-center justify-center rounded-ctl bg-cata-red text-white " +
    "transition-colors hover:bg-cata-red-dark",
};

export interface ChatWidgetProps {
  /** Whether the panel is visible. Owned by the host (see `AppShell`). */
  open: boolean;
  /** Called by the panel's own close control. */
  onClose: () => void;
  /**
   * Whose shortcuts to offer. The FAQ is written per role, so the prompts are
   * too — see `chat-quick-replies.ts`.
   */
  role?: UserRole | null;
  /**
   * Text to pre-fill the composer with when the panel opens. No current call
   * site sets this — every trigger opens the assistant empty — but the seam
   * stays cheap for the next screen that knows exactly what needs saying.
   */
  initialDraft?: string;
}

export default function ChatWidget({
  open,
  onClose,
  role,
  initialDraft,
}: ChatWidgetProps): React.ReactElement | null {
  const [mensajes, setMensajes] = useState<MensajeChat[]>([]);
  const [borrador, setBorrador] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // `rateLimitedUntil` (epoch ms) and `segundosRestantes` together drive the
  // 429 lock (issue #708). They are deliberately separate from `error`: a
  // 429 needs the composer disabled AND a countdown that ticks — a plain
  // string can't do either, and reusing `error` for it would have left the
  // input looking editable while every keystroke was still going nowhere.
  const [rateLimitedUntil, setRateLimitedUntil] = useState<number | null>(null);
  const [segundosRestantes, setSegundosRestantes] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const contadorId = useId();
  const isSheet = useSheetPresentation();
  const skin = isSheet ? SHEET : CARD;
  const sheet = useSheetGeometry(open && isSheet);
  usePageScrollLock(open && isSheet);

  // Opening moves focus into the panel. Without it the panel appears but the
  // caret stays on whatever trigger was clicked — which, now that the trigger
  // can be a launcher floating in a corner, leaves a keyboard user tabbing
  // through the whole page to reach the composer they just asked for.
  // `preventScroll` because the panel is `fixed`: scrolling to it would move
  // the page underneath for no reason.
  useEffect((): void => {
    if (open) inputRef.current?.focus({ preventScroll: true });
  }, [open]);

  useEffect((): void => {
    if (!open || !listRef.current) return;
    // jsdom (unit tests) doesn't implement Element.scrollTo — guard it.
    if (typeof listRef.current.scrollTo === "function") {
      listRef.current.scrollTo({ top: listRef.current.scrollHeight });
    }
  }, [open, mensajes, enviando]);

  // Ticks the 429 countdown down to zero, then lifts the lock itself — the
  // composer re-enables on its own the moment the real wait is over, with no
  // action needed from the visitor. `segundosRestantes` is seeded directly
  // where the lock is first set (see `enviarTexto`'s catch block), so the
  // very first render already shows the right number instead of a stale one
  // this effect hasn't had a chance to correct yet.
  useEffect((): undefined | (() => void) => {
    if (rateLimitedUntil === null) return undefined;
    const id = setInterval((): void => {
      const restantes = Math.max(0, Math.ceil((rateLimitedUntil - Date.now()) / 1000));
      setSegundosRestantes(restantes);
      if (restantes <= 0) setRateLimitedUntil(null);
    }, 1000);
    return (): void => clearInterval(id);
  }, [rateLimitedUntil]);

  // Seed the composer when the host opens the panel with something to say.
  // Only on the open transition, so it never overwrites what the user is
  // typing, and never re-appears after they clear it.
  useEffect((): void => {
    if (open && initialDraft) setBorrador(initialDraft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialDraft]);

  async function enviarTexto(texto: string): Promise<void> {
    const limpio = texto.trim();
    // `rateLimitedUntil !== null` guards Enter/quick-reply too, in case some
    // future entry point forgets to check `disabled` itself — belt-and-
    // braces against submitting into a window already known to answer 429.
    if (!limpio || enviando || rateLimitedUntil !== null) return;

    // The limit is enforced HERE, not only by the BFF. An over-length message
    // used to make the round trip, come back 400, and be reported as a
    // connection failure; now it never leaves the browser, and the draft is
    // left in the composer so it can be shortened instead of retyped.
    if (limpio.length > CHATBOT_MAX_MESSAGE_LENGTH) {
      setError(CHATBOT_MESSAGE_TOO_LONG_TEXT);
      return;
    }

    const historial: ChatbotTurno[] = mensajes
      .slice(-MAX_TURNOS_HISTORIAL)
      .map(({ rol, texto: t }) => ({ rol, texto: t }));
    const mensajeUsuario: MensajeChat = { id: proximoId++, rol: "usuario", texto: limpio };

    setMensajes((prev) => [...prev, mensajeUsuario]);
    setBorrador("");
    setError(null);
    setEnviando(true);

    try {
      const { reply } = await consultarChatbot(limpio, historial);
      setMensajes((prev) => [...prev, { id: proximoId++, rol: "asistente", texto: reply }]);
    } catch (err: unknown) {
      // 429 gets its own path (issue #708): the wait comes from the
      // backend's real `Retry-After` when it sent one, and the fallback
      // below only covers the one case that omits it (see
      // `RATE_LIMIT_FALLBACK_SECONDS`'s own comment) — never a guess dressed
      // up as the real number.
      if (err instanceof ApiClientError && err.status === 429) {
        const espera = err.retryAfterSeconds ?? RATE_LIMIT_FALLBACK_SECONDS;
        setSegundosRestantes(espera);
        setRateLimitedUntil(Date.now() + espera * 1000);
      } else {
        setError(mensajeDeError(err));
      }
    } finally {
      setEnviando(false);
    }
  }

  function handleSubmit(e: FormEvent): void {
    e.preventDefault();
    void enviarTexto(borrador);
  }

  /**
   * The focus trap, and the whole of it.
   *
   * This panel is a `<div role="dialog">`, not a native `<dialog>`, so nothing
   * underneath keeps Tab inside it — the wrapping IS this handler. It only
   * arms in the sheet, where the panel covers the page: trapping focus inside
   * a 340px corner card that leaves two thirds of the screen usable would
   * strand a keyboard user in it.
   */
  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (!isSheet || event.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;

    const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    const inside = active instanceof HTMLElement && panel.contains(active);

    // `!inside` on both branches: focus can leave through a click on the page
    // behind, and the next Tab has to come back rather than resume from the
    // top of the document.
    if (event.shiftKey ? !inside || active === first : !inside || active === last) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  }

  if (!open) return null;

  // Measured on what would actually be SENT — `enviarTexto` trims before it
  // counts, and a counter that disagrees with the guard beside it would be a
  // send button disabled for no visible reason.
  const largo = borrador.trim().length;
  const excedido = largo > CHATBOT_MAX_MESSAGE_LENGTH;
  const mostrarContador = largo >= CONTADOR_DESDE;

  return (
    <div
      ref={panelRef}
      role="dialog"
      /* A sheet owns the screen, so it says so and traps focus; the corner
         card does neither, exactly as before. */
      aria-modal={isSheet}
      onKeyDown={handleKeyDown}
      style={
        sheet
          ? ({
              "--chat-sheet-top": `${sheet.top}px`,
              "--chat-sheet-height": `${sheet.height}px`,
              "--chat-keyboard-inset": `${sheet.keyboardInset}px`,
            } as React.CSSProperties)
          : undefined
      }
      aria-label={`${BOT_NAME}, asistente del club`}
      /* From `sm` up: lifted clear of the phone tab bar (62px + breathing
         room); back to the corner from `lg` up, where it is not rendered. */
      /* `text-left` is not decoration: the panel is rendered as a sibling of
         whatever trigger opened it, so a centred host (AuthShell's small
         print) was centring every message bubble inside it. */
      /* `shadow-elevated` is the rung the system reserves for something
         floating over the page, and it replaces a hand-picked
         `0 14px 40px rgba(0,0,0,.12)` that came straight from `_sistema.css`'s
         `.chat`. Measured, the swap changes nothing: this panel writes BOTH
         `rounded-card` and `bg-paper`, and the shared elevation rule in
         `globals.css` matches on those two classes at specificity 0,2,0 —
         which no single `shadow-*` utility can outrank, whatever layer it
         sits in. So the panel renders `shadow-card` today and rendered
         `shadow-card` before. Naming the intent is still worth it; making the
         intent win is a separate change to that shared rule, and it would
         move every card in the product. */
      className={skin.panel}
    >
      {/* `.chat > header` — white, avatar disc, "Responde en segundos". */}
      <header className={skin.header}>
        {/*
          `unoptimized`: this is `cata-club-crest-256.png`, a pre-sized
          256×256 (23.6KB) derivative of `cata-club-logo-avatar.png` — see
          issue #681. A real CI trace showed Next's `/_next/image` optimizer
          can get one specific request/cache key stuck forever (`status: -1`,
          confirmed across three separate fresh page loads on the same
          server), and no client-side retry outran it. Serving this asset
          unoptimized means no consumer ever asks the optimizer for it, so
          that cache key never exists to get stuck. 256 already covers this
          32px box at well beyond 3x, so there is no size left to ask for —
          `width`/`height={96}` here are just the element's box hint now, not
          a srcset lever; `object-cover` on the `<img>` itself still scales
          it down to fill the 32px box.

          `cata-club-crest-256.png`, not the raw `cata-club-logo.jpeg`: the
          source is 1080×996 (wider than tall), so `object-cover` alone
          scales it by height and barely trims the sides — the "CATA CLUB /
          TENIS DE MESA" wordmark below the wreath survives almost whole
          inside the circle and stays legible-but-wrong at 32px. The crest PNG
          is a 620×620 crop of the same source, cut above the wordmark band,
          with the JPEG's light-grey background chroma-keyed to transparent —
          `object-cover` is still correct here (a square source into a square
          box needs no cropping, just scaling), and the transparent margin
          around the wreath's oval lets this header's own `bg-white` show
          through instead of that light-grey square.
        */}
        <span className="relative block h-8 w-8 shrink-0 overflow-hidden rounded-full">
          <Image
            src="/brand/cata-club-crest-256.png"
            alt=""
            width={96}
            height={96}
            unoptimized
            className="h-full w-full object-cover"
          />
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-sm font-bold">{BOT_NAME}</span>
          <span className="block truncate text-2xs tracking-flat text-ink-3">Responde en segundos</span>
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={`Cerrar ${BOT_NAME}`}
          className={`${skin.close} ${ASSISTANT_FOCUS_RING}`}
        >
          <X size={ICON.sm} strokeWidth={2} aria-hidden="true" />
        </button>
      </header>

      {/* `.chat .msgs` */}
      {/*
        `data-lenis-prevent` is the other half of the scroll lock, and it is
        Lenis's own opt-out: while the engine is held (see `usePageScrollLock`)
        it swallows every wheel gesture, INCLUDING the ones aimed at this list
        — which on a sheet that covers the screen is most of them. The
        attribute tells Lenis to keep its hands off anything inside here, so
        the history scrolls natively while the page behind stays put. On a
        surface with no Lenis it means nothing at all.
      */}
      <div
        ref={listRef}
        data-lenis-prevent
        className={skin.history}
      >
        {mensajes.length === 0 && (
          <p className={`${BUBBLE_BASE} self-start rounded-bl-[4px] bg-state-neutral-bg text-ink-2`}>
            Hola 👋 Soy {BOT_NAME}, el asistente del club. Pregúntele cómo usar la app — o toque
            «{TALK_TO_CLUB_LABEL}» si prefiere hablar con una persona.
          </p>
        )}

        {mensajes.map((m) => (
          <p
            key={m.id}
            data-rol={m.rol}
            className={`${BUBBLE_BASE} ${
              m.rol === "usuario"
                ? "self-end rounded-br-[4px] bg-coal text-white"
                : "self-start rounded-bl-[4px] bg-state-neutral-bg text-ink-2"
            }`}
          >
            {m.texto}
          </p>
        ))}

        {enviando && (
          /*
           * `.typing` — three dots. The bounce is behind `motion-safe:`, i.e.
           * `@media (prefers-reduced-motion: no-preference)`: if the system
           * asks for less motion the dots hold still, exactly as
           * `_sistema.css:474-483` specifies. The label is what carries the
           * meaning either way.
           *
           * A design detector flags `animate-bounce` as bounce easing, and it
           * is right about the keyframe — but it stays, for three reasons that
           * are specific to this element. The dot is 6px, and the keyframe
           * translates 25%, so the whole authored motion is 1.5px of travel:
           * at that amplitude it reads as a wave, not as a bouncing ball. It
           * is the only motion in the panel, which is what the craft floor
           * asks for — one authored moment. And the alternative (a custom
           * ease-out keyframe) would have to be declared in `globals.css` or
           * `tailwind.config.ts`, i.e. a shared token file, to replace 1.5px
           * of movement inside an `aria-hidden`, reduced-motion-gated
           * indicator. Not worth a system-wide edit.
           */
          <span
            role="status"
            aria-label={`${BOT_NAME} está escribiendo`}
            className="inline-flex items-center gap-1 self-start rounded-xl bg-state-neutral-bg px-[13px] py-[11px]"
          >
            {[0, 180, 360].map((delay) => (
              <span
                key={delay}
                aria-hidden="true"
                style={{ animationDelay: `${delay}ms` }}
                className="h-1.5 w-1.5 rounded-full bg-ink-3 motion-safe:animate-bounce"
              />
            ))}
          </span>
        )}

        {/*
          The 429 lock (issue #708) takes priority over `error`: while it's
          active this IS the failure the visitor needs to see, and it ticks
          — `error` is a static string set once and can't.
        */}
        {rateLimitedUntil !== null ? (
          <div role="alert" className={ALERT_CLASS}>
            <AlertTriangle size={ICON.sm} strokeWidth={2} className="mt-px shrink-0" aria-hidden="true" />
            <span>{mensajeLimiteConsultas(segundosRestantes)}</span>
          </div>
        ) : (
          error && (
            <div role="alert" className={ALERT_CLASS}>
              <AlertTriangle size={ICON.sm} strokeWidth={2} className="mt-px shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )
        )}
      </div>

      {/* `.quicks` — the shortcuts, plus the permanent way to reach a person. */}
      <div className="flex flex-none flex-wrap gap-1.5 bg-canvas px-[15px] pb-3">
        {getQuickReplies(role).map((prompt) => (
          <button
            key={prompt}
            type="button"
            disabled={enviando || rateLimitedUntil !== null}
            onClick={(): void => void enviarTexto(prompt)}
            className={QUICK_REPLY}
          >
            {prompt}
          </button>
        ))}
        {/*
         * The way OUT of asking. A chat can only answer a question you already
         * thought of; someone who does not know what to ask needs to browse,
         * and until now the product had no browsable answers at all.
         */}
        <Link href="/ayuda" className={QUICK_REPLY}>
          Ver todas las preguntas
        </Link>
        <a
          href={CLUB_WHATSAPP_LINK}
          target="_blank"
          rel="noopener noreferrer"
          className={QUICK_REPLY}
        >
          {TALK_TO_CLUB_LABEL}
        </a>
      </div>

      {/*
        The limit, where it can still be acted on.

        It appears for the last 200 characters and turns red past the cap,
        which is the whole point: the message used to be typed to any length,
        sent, rejected with a 400 by the BFF and reported to the user as a
        failure to reach the assistant. There is deliberately no `maxLength` on
        the field — a hard cap silently swallows the tail of a pasted message,
        and a message quietly shortened by the browser is worse than one the
        user is told to shorten. `aria-live="polite"` so this is heard, not
        only seen.
      */}
      {mostrarContador && (
        <p
          id={contadorId}
          aria-live="polite"
          className={`flex-none bg-canvas px-[15px] pb-2 text-right text-2xs tabular-nums ${
            excedido ? "font-semibold text-state-bad" : "text-ink-3"
          }`}
        >
          {formatCharacterCount(largo)} / {CHATBOT_MAX_MESSAGE_LENGTH_LABEL} caracteres
          {excedido ? " — acórtelo para poder enviarlo" : ""}
        </p>
      )}

      {/* `.chat .inputrow` — 40px field, 40px red send button. */}
      <form onSubmit={handleSubmit} className={skin.form}>
        <input
          ref={inputRef}
          type="text"
          value={borrador}
          onChange={(e): void => setBorrador(e.target.value)}
          placeholder="Escriba su pregunta…"
          aria-label={`Mensaje para ${BOT_NAME}`}
          aria-invalid={excedido || undefined}
          aria-describedby={mostrarContador ? contadorId : undefined}
          disabled={enviando || rateLimitedUntil !== null}
          enterKeyHint="send"
          className={skin.input}
        />
        <button
          type="submit"
          disabled={enviando || largo === 0 || excedido || rateLimitedUntil !== null}
          aria-label="Enviar mensaje"
          /* `outline-ball` used to draw this ring. #FFD600 is 1.42:1 on the
             panel's white footer — a focus indicator that fails 2.4.11 by a
             factor of two. See `chat-focus-ring.ts`. */
          className={`${skin.send} ${ASSISTANT_FOCUS_RING} disabled:cursor-not-allowed disabled:opacity-45`}
        >
          <Send size={ICON.sm} strokeWidth={2} aria-hidden="true" />
        </button>
      </form>
    </div>
  );
}
