/**
 * The one place the assistant's message limit is written down.
 *
 * It used to live only in `src/app/api/chatbot/route.ts`, where the browser
 * could not read it: the composer had no `maxLength` at all, so a 2500-character
 * message was typed, sent, and rejected with a 400 — after the round trip, and
 * with copy that blamed the connection ("No se pudo contactar a CATA-BOT"). The
 * user was told to retry the exact thing that cannot work.
 *
 * Both halves of the fix need the same number, and a limit that lives in two
 * files is a limit that will be edited in one. The BFF route imports it, the
 * composer imports it, and the sentence the user reads is built from it too, so
 * raising the cap moves the guard, the counter and the copy together.
 */

/** Longest message the BFF will forward to the backend, in characters. */
export const CHATBOT_MAX_MESSAGE_LENGTH = 2_000;

/**
 * Machine-readable reason on the BFF's over-length 400, so the client can tell
 * it from the OTHER 400s that route can answer (a body that is not JSON, a
 * message that is empty or the wrong shape) and from any 400 the backend itself
 * passes through. Status alone cannot distinguish them, and guessing is how a
 * length problem came to be reported as a connectivity problem.
 */
export const CHATBOT_MESSAGE_TOO_LONG_CODE = "chatbot_mensaje_demasiado_largo";

/**
 * A character count as a reader sees it: `2.000`, not `2000`. `es-EC` is the
 * locale the rest of the app formats numbers in (see `formatCurrency` in
 * `format-utils.ts`) — the counter and the limit beside it must group digits
 * the same way every other number on the screen does.
 */
export function formatCharacterCount(count: number): string {
  return count.toLocaleString("es-EC");
}

/** The limit, spelled the way the counter spells it. */
export const CHATBOT_MAX_MESSAGE_LENGTH_LABEL = formatCharacterCount(CHATBOT_MAX_MESSAGE_LENGTH);

/**
 * What the user is told when the message is too long — the same sentence
 * whether the composer caught it before sending or the BFF answered 400.
 */
export const CHATBOT_MESSAGE_TOO_LONG_TEXT =
  `El mensaje supera el límite de ${CHATBOT_MAX_MESSAGE_LENGTH_LABEL} caracteres. ` +
  `Acórtelo e inténtelo de nuevo.`;
