/**
 * ChatWidget — FAQ chatbot panel for logged-in users.
 *
 * Talks to the backend's FAQ chatbot (no RAG, no persistence) via the BFF
 * proxy at POST /api/chatbot (see src/app/api/chatbot/route.ts), which itself
 * proxies the public, rate-limited `POST /chatbot/consultar` on FastAPI.
 *
 * Open/closed state is OWNED BY THE HOST, not by this component: `AppShell`
 * mounts it once, gated on `session`, and opens it from the sidebar's
 * "Ayuda y soporte" entry (plan, Fase 1 item 3 / Fase 4 item 7). It used to
 * carry its own `fixed bottom-5 right-5` floating action button and was
 * mounted unconditionally in `layout.tsx`, so the FAB floated over the login
 * form, over the landing's WhatsApp block and over the trainer's attendance
 * controls. There is no FAB any more.
 */

"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { X, Send, Loader2, AlertTriangle } from "lucide-react";
import { consultarChatbot, type ChatbotTurno } from "@/services/api";

/** How many prior turns to send as `historial` on each request — mirrors the backend's own cap. */
const MAX_TURNOS_HISTORIAL = 6;

interface MensajeChat extends ChatbotTurno {
  id: number;
}

let proximoId = 0;

export interface ChatWidgetProps {
  /** Whether the panel is visible. Owned by the host (see `AppShell`). */
  open: boolean;
  /** Called by the panel's own close control. */
  onClose: () => void;
}

export default function ChatWidget({ open, onClose }: ChatWidgetProps): React.ReactElement | null {
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

  async function enviarMensaje(e: FormEvent): Promise<void> {
    e.preventDefault();
    const texto = borrador.trim();
    if (!texto || enviando) return;

    const historial: ChatbotTurno[] = mensajes.slice(-MAX_TURNOS_HISTORIAL).map(({ rol, texto: t }) => ({ rol, texto: t }));
    const mensajeUsuario: MensajeChat = { id: proximoId++, rol: "usuario", texto: texto };

    setMensajes((prev) => [...prev, mensajeUsuario]);
    setBorrador("");
    setError(null);
    setEnviando(true);

    try {
      const { reply } = await consultarChatbot(texto, historial);
      setMensajes((prev) => [...prev, { id: proximoId++, rol: "asistente", texto: reply }]);
    } catch {
      setError("No se pudo contactar al asistente. Inténtalo de nuevo en un momento.");
    } finally {
      setEnviando(false);
    }
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="Chat de ayuda"
      className="card fixed bottom-5 right-5 z-40 flex h-[min(28rem,70vh)] w-[min(22rem,90vw)] flex-col overflow-hidden"
    >
      <div className="flex items-center justify-between border-b border-cata-border bg-cata-black px-4 py-3 text-white">
        <div>
          <p className="text-sm font-bold">Asistente de Cata Club</p>
          <p className="text-xs text-white/55">Pregúntame cómo usar la app</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar chat de ayuda"
          className="rounded-lg p-1 text-white/60 hover:bg-white/10 hover:text-white"
        >
          <X size={16} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>

      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-4">
        {mensajes.length === 0 && (
          <p className="px-2 text-center text-xs text-cata-text/45">
            Hola 👋 Pregúntame cómo tomar asistencia, ver tus pagos, consultar horarios, y más.
          </p>
        )}

        {mensajes.map((m) => (
          <div key={m.id} className={`flex ${m.rol === "usuario" ? "justify-end" : "justify-start"}`}>
            <p
              className={`max-w-[85%] whitespace-pre-line rounded-2xl px-3.5 py-2 text-sm ${
                m.rol === "usuario"
                  ? "rounded-br-sm bg-cata-red text-white"
                  : "rounded-bl-sm bg-cata-bg text-cata-text"
              }`}
            >
              {m.texto}
            </p>
          </div>
        ))}

        {enviando && (
          <div className="flex justify-start">
            <p className="flex items-center gap-1.5 rounded-2xl rounded-bl-sm bg-cata-bg px-3.5 py-2 text-sm text-cata-text/55">
              <Loader2 size={14} strokeWidth={1.5} className="animate-spin" aria-hidden="true" />
              Escribiendo…
            </p>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-cata-red/30 bg-cata-red/5 px-3 py-2.5 text-xs text-cata-red">
            <AlertTriangle size={15} strokeWidth={1.5} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}
      </div>

      <form onSubmit={(e): void => void enviarMensaje(e)} className="flex items-center gap-2 border-t border-cata-border p-3">
        <input
          type="text"
          value={borrador}
          onChange={(e): void => setBorrador(e.target.value)}
          placeholder="Escribe tu pregunta…"
          aria-label="Mensaje para el asistente"
          disabled={enviando}
          className="input-field flex-1"
        />
        <button
          type="submit"
          disabled={enviando || borrador.trim().length === 0}
          aria-label="Enviar mensaje"
          className="btn-primary h-10 w-10 shrink-0 rounded-full p-0"
        >
          <Send size={16} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </form>
    </div>
  );
}
