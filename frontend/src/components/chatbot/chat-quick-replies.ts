/**
 * Quick replies for the help assistant.
 *
 * `docs/archive/prototypes/prototipos/28-chat.html` asks, in its note, to *verify whether the
 * quick replies are served by `ChatbotServicio` or written in the client*.
 * They are written in the client: the backend contract is
 * `ChatbotRespuestaDTO { respuesta: str }`
 * (backend/app/presentacion/schemas/chatbot_schemas.py:24-26) — a single
 * string, with no suggestion list anywhere in the response. So this module is
 * the answer to that question, and the one place the shortcuts live.
 *
 * Every question below is grounded in `_FAQ_CONTENIDO`
 * (backend/app/servicios_negocio/chatbot_servicio.py:42) — the FAQ text
 * embedded in the system prompt. A shortcut the FAQ cannot answer is worse
 * than no shortcut: it teaches the user the assistant is useless.
 *
 * They are role-scoped for the same reason. The FAQ itself is written per
 * role, so offering a student a question about an admin-only screen would
 * hand them one they cannot reach.
 */

import type { UserRole } from "@/types/domain";

/**
 * The permanent human escape hatch (prototype `28-chat.html`): "cuando el bot
 * no sabe, tiene que haber una persona del otro lado". Rendered as a link to
 * the club's real WhatsApp, not as another prompt for the same bot.
 */
export const TALK_TO_CLUB_LABEL = "Hablar con el club";

/** Role-scoped prompts, most useful first. Never more than two. */
const BY_ROLE: Record<UserRole, string[]> = {
  admin: ["¿Cómo valido un pago?", "¿Quién define los horarios?"],
  trainer: ["¿Cómo tomo asistencia?", "¿Dónde veo el historial?"],
  representante: ["¿Cómo veo mis pagos?", "¿Dónde veo mi asistencia?"],
  estudiante: ["¿Cómo veo mis pagos?", "¿Dónde veo mi asistencia?"],
  // An account with no role can still ask the two things the FAQ answers
  // without one: how to sign in, and when the club trains.
  unsupported: ["¿Cómo inicio sesión?", "¿Cuáles son los horarios?"],
};

const FALLBACK = BY_ROLE.unsupported;

/**
 * The prompts to offer a given role. Unknown/absent role falls back to the
 * two questions the FAQ answers for anyone.
 */
export function getQuickReplies(role: UserRole | null | undefined): string[] {
  if (!role) return FALLBACK;
  return BY_ROLE[role] ?? FALLBACK;
}
