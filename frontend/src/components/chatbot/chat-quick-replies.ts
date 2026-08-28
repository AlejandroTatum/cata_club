/**
 * Quick replies for the help assistant.
 *
 * `docs/archive/prototypes/prototipos/28-chat.html` asks, in its note, to *verify whether the
 * quick replies are served by `ChatbotServicio` or written in the client*.
 * They are written in the client: the backend contract is
 * `ChatbotRespuestaDTO { respuesta: str }`
 * (backend/app/presentacion/schemas/chatbot_schemas.py:24-26) — a single
 * string, with no suggestion list anywhere in the response. So this module is
 * the answer to that question, and the one place the shortcuts are read from.
 *
 * They are no longer WRITTEN here, though. This used to be a third partial
 * transcription of the FAQ (issue #768), and its questions had already drifted
 * out of it: "¿Dónde veo el historial?" and "¿Cuáles son los horarios?" were
 * shortcuts to questions the assistant's own knowledge did not contain under
 * those words. A shortcut the knowledge cannot answer is worse than no
 * shortcut: it teaches the user the assistant is useless.
 *
 * The role-scoped lists now come from the single canonical definition, where
 * the backend suite proves every one of them is verbatim a question the FAQ
 * answers. They stay role-scoped for the reason they always were: the FAQ is
 * written per role, so offering a student a question about an admin-only
 * screen would hand them one they cannot reach.
 */

/*
 * A projection of the canonical `atajos`, not the whole document, and not a
 * hand-kept list either — `backend/scripts/sincronizar_conocimiento.py` writes
 * it and the backend suite fails if it drifts.
 *
 * The separate file is a payload decision, measured rather than assumed. This
 * module is reachable from the root layout (the chat widget mounts app-wide),
 * and the bundler does not drop the unused keys of an imported JSON document —
 * neither through a default import nor a named one. With the whole document
 * here, 7.9 KB of club knowledge rode in `chunks/app/layout-*.js` (25 KB
 * total) on every page in the app, to render two questions.
 */
import quickReplies from "@/data/club-quick-replies.json";
import type { UserRole } from "@/types/domain";

/**
 * The permanent human escape hatch (prototype `28-chat.html`): "cuando el bot
 * no sabe, tiene que haber una persona del otro lado". Rendered as a link to
 * the club's real WhatsApp, not as another prompt for the same bot.
 */
export const TALK_TO_CLUB_LABEL = "Hablar con el club";

const BY_ROLE: Record<UserRole, string[]> = quickReplies;

/**
 * An account with no role can still ask the two things the FAQ answers without
 * one: how to sign in, and when the club trains.
 */
const FALLBACK = BY_ROLE.unsupported;

/**
 * The prompts to offer a given role. Unknown/absent role falls back to the
 * two questions the FAQ answers for anyone.
 */
export function getQuickReplies(role: UserRole | null | undefined): string[] {
  if (!role) return FALLBACK;
  return BY_ROLE[role] ?? FALLBACK;
}
