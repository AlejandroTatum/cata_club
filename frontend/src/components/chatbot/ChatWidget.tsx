/**
 * ChatWidget — the club's help assistant panel.
 *
 * Talks to the backend's FAQ chatbot (no RAG, no persistence) via the BFF
 * proxy at POST /api/chatbot (see src/app/api/chatbot/route.ts), which itself
 * proxies the public, rate-limited `POST /chatbot/consultar` on FastAPI.
 *
 * Open/closed state is OWNED BY THE HOST, not by this component. There are
 * exactly two hosts: `AppShell`, which mounts it gated on `session` and opens
 * it from the sidebar's "Ayuda y soporte" entry, and `/unauthorized`, which
 * has no sidebar to open it from and therefore carries its own trigger
 * (`docs/ux/prototipos/26-sin-rol.html`). There is no floating action button
 * anywhere — it used to float over the login form, the landing's WhatsApp
 * block and the trainer's attendance controls.
 *
 * Visual contract from `docs/ux/prototipos/28-chat.html` + `_sistema.css`
 * (`.chat`, `.bub`, `.typing`, `.quicks`, `.sendb`): 340px panel, coal header
 * with the logo disc and "Responde en segundos", GREY bot bubbles and COAL
 * user bubbles (the user's turn used to be red — red is reserved for the
 * primary CTA and for destructive/error, and a red bubble read as an error),
 * 32px quick replies, a three-dot typing indicator, and a 40px input beside a
 * 40px red send button.
 */

"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import { X, Send, AlertTriangle } from "lucide-react";
import { consultarChatbot, type ChatbotTurno } from "@/services/api";
import { landingConfig, toWhatsAppLink } from "@/app/landing/landing-config";
import { getQuickReplies, TALK_TO_CLUB_LABEL } from "./chat-quick-replies";
import type { UserRole } from "@/types/domain";

/** How many prior turns to send as `historial` on each request — mirrors the backend's own cap. */
const MAX_TURNOS_HISTORIAL = 6;

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

/** `.bub` — 12px radius, 86% max width, with the tail corner squared off. */
const BUBBLE_BASE =
  "max-w-[86%] whitespace-pre-line rounded-xl px-3 py-2.5 text-[13px] leading-[1.45]";

/** `.quick` — 32px pill. */
const QUICK_REPLY =
  "inline-flex h-ctl-sm items-center rounded-full border border-line-2 bg-paper px-3 " +
  "text-xs font-semibold text-ink-2 transition-colors hover:border-ink-3 hover:text-ink " +
  "disabled:cursor-not-allowed disabled:opacity-45";

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
   * Text to pre-fill the composer with when the panel opens. Used by the
   * trainer's "Avisar al club", which knows exactly what needs saying.
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
  const listRef = useRef<HTMLDivElement>(null);

  useEffect((): void => {
    if (!open || !listRef.current) return;
    // jsdom (unit tests) doesn't implement Element.scrollTo — guard it.
    if (typeof listRef.current.scrollTo === "function") {
      listRef.current.scrollTo({ top: listRef.current.scrollHeight });
    }
  }, [open, mensajes, enviando]);

  // Seed the composer when the host opens the panel with something to say.
  // Only on the open transition, so it never overwrites what the user is
  // typing, and never re-appears after they clear it.
  useEffect((): void => {
    if (open && initialDraft) setBorrador(initialDraft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialDraft]);

  async function enviarTexto(texto: string): Promise<void> {
    const limpio = texto.trim();
    if (!limpio || enviando) return;

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
    } catch {
      setError("No se pudo contactar al asistente. Inténtalo de nuevo en un momento.");
    } finally {
      setEnviando(false);
    }
  }

  function handleSubmit(e: FormEvent): void {
    e.preventDefault();
    void enviarTexto(borrador);
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="Chat de ayuda"
      /* Lifted clear of the phone tab bar (62px + breathing room); back to the
         corner from `lg` up, where the tab bar is not rendered. */
      className="fixed bottom-[74px] right-3 z-40 flex max-h-[min(34rem,72vh)] w-[min(340px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-card border border-line bg-paper shadow-[0_14px_40px_rgba(0,0,0,0.12)] lg:bottom-5 lg:right-5 lg:max-h-[min(34rem,80vh)]"
    >
      {/* `.chat > header` — coal, logo disc, "Responde en segundos". */}
      <header className="flex flex-none items-center gap-[11px] bg-coal px-[15px] py-3 text-white">
        <span className="relative block h-8 w-8 shrink-0 overflow-hidden rounded-full bg-white">
          <Image
            src="/brand/cata-club-logo.jpeg"
            alt=""
            fill
            sizes="32px"
            className="object-cover"
          />
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-[13.5px] font-bold">Cata Club</span>
          <span className="block truncate text-[11px] text-white/55">Responde en segundos</span>
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar chat de ayuda"
          className="shrink-0 rounded-lg p-1 text-white/55 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X size={16} strokeWidth={2} aria-hidden="true" />
        </button>
      </header>

      {/* `.chat .msgs` */}
      <div
        ref={listRef}
        className="flex min-h-[250px] flex-1 flex-col gap-2.5 overflow-y-auto bg-canvas p-[15px]"
      >
        {mensajes.length === 0 && (
          <p className={`${BUBBLE_BASE} self-start rounded-bl-[4px] bg-state-neutral-bg text-ink-2`}>
            Hola 👋 Soy el asistente del club. Pregúntame cómo usar la app — o toca
            «{TALK_TO_CLUB_LABEL}» si prefieres hablar con una persona.
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
           */
          <span
            role="status"
            aria-label="El asistente está escribiendo"
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

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-ctl border border-state-bad/25 bg-state-bad-bg px-3 py-2.5 text-xs text-state-bad"
          >
            <AlertTriangle size={14} strokeWidth={2} className="mt-px shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* `.quicks` — the shortcuts, plus the permanent way to reach a person. */}
      <div className="flex flex-none flex-wrap gap-1.5 bg-canvas px-[15px] pb-3">
        {getQuickReplies(role).map((prompt) => (
          <button
            key={prompt}
            type="button"
            disabled={enviando}
            onClick={(): void => void enviarTexto(prompt)}
            className={QUICK_REPLY}
          >
            {prompt}
          </button>
        ))}
        <a
          href={CLUB_WHATSAPP_LINK}
          target="_blank"
          rel="noopener noreferrer"
          className={QUICK_REPLY}
        >
          {TALK_TO_CLUB_LABEL}
        </a>
      </div>

      {/* `.chat .inputrow` — 40px field, 40px red send button. */}
      <form onSubmit={handleSubmit} className="flex flex-none items-center gap-2 border-t border-line p-3">
        <input
          type="text"
          value={borrador}
          onChange={(e): void => setBorrador(e.target.value)}
          placeholder="Escribe tu pregunta…"
          aria-label="Mensaje para el asistente"
          disabled={enviando}
          className="h-ctl min-w-0 flex-1 rounded-ctl border border-line-2 bg-paper px-[13px] text-[13.5px] text-ink transition-colors placeholder:text-ink-3 focus:border-cata-red focus:outline-none focus:ring-[3px] focus:ring-cata-red/10 disabled:cursor-not-allowed disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={enviando || borrador.trim().length === 0}
          aria-label="Enviar mensaje"
          className="flex h-ctl w-10 flex-none items-center justify-center rounded-ctl bg-cata-red text-white transition-colors hover:bg-cata-red-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ball disabled:cursor-not-allowed disabled:opacity-45"
        >
          <Send size={16} strokeWidth={2} aria-hidden="true" />
        </button>
      </form>
    </div>
  );
}
