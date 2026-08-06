/**
 * The one place an error becomes something a person reads.
 *
 * Before this module the product had 28 of them, plus three hand-rolled
 * `getXErrorMessage` helpers and two defaults inside the API client — one of
 * which was in English (`Request failed with status 502`) and one of which
 * printed the HTTP code at the user (`No se pudo generar el PDF (status 504)`).
 * Every one of those sites had made the same decision independently, and they
 * had not all made it the same way.
 *
 * ## The decision this module exists to make
 *
 * **When is the backend's `detail` trustworthy?**
 *
 * The tempting answer is "on 4xx, because 4xx means the user did something".
 * It does not survive the evidence. These two arrive with the same status:
 *
 *   · `Ya existe una persona con la cédula 0912345678`
 *   · `motivo_rechazo es obligatorio al rechazar un pago`
 *
 * The first is the single most useful sentence the system can produce — the
 * frontend has no way to know that cédula was taken, and replacing it with
 * "revise los datos" makes the form unsolvable. The second is addressed to
 * whoever wrote the endpoint. The user never typed the characters
 * `motivo_rechazo`; there is no field by that name on any screen.
 *
 * So status does not separate them, and neither does anything else in the HTTP
 * response. What separates them is **who the sentence was written for**, and
 * the wire carries no such flag. The criterion has to be inferred from the
 * text itself, and inference can be wrong — so the design question becomes
 * which way it should be wrong.
 *
 * That answer is not symmetric. Showing a leaked identifier costs the user an
 * unactionable sentence and costs the product a bug report it cannot explain.
 * Hiding a real business rule costs specificity — but the caller's own
 * fallback ("No se pudo guardar el descuento.") still names the operation and
 * still tells the user what to try. One failure is a dead end; the other is a
 * detour. **So this module requires positive evidence that a message was
 * written for a person, and treats absence of evidence as "not for the user".**
 *
 * That is enforced as two gates, both of which must pass:
 *
 *   1. **The status has to mean "about what you sent".** Only `400`, `409` and
 *      `422` describe the caller's own input, and they are the only statuses
 *      where the server knows something the frontend does not. A `5xx` detail
 *      describes the server's failure; every status in `STATUS_MESSAGES` is
 *      fully determined by the status itself and the frontend says it better.
 *   2. **The text must not name the implementation.** See `isUserFacingText`.
 *
 * ## What this deliberately does NOT do
 *
 * **It does not fix the leak.** The backend should not be putting
 * `motivo_rechazo` in a user-facing `detail` at all, and that repair belongs in
 * `backend/`. Gate 2 is the frontend's last line, not the cure — it means a
 * leak that lands tomorrow reaches a log instead of a screen.
 *
 * **It does not invent context.** Every caller passes the sentence that
 * describes ITS operation, and that sentence is what comes back whenever this
 * module has nothing better. A generic "ocurrió un error" would have been less
 * useful than what the 28 sites already had.
 *
 * **It is not wired up yet.** Only `GENERIC_FAILURE` is live here, through
 * `services/api.ts`; the 28 render sites move onto `toUserMessage` in the
 * follow-up. The present tense above describes the contract offered.
 */

/**
 * The longest a `detail` may be and still be a sentence somebody wrote for a
 * form. Past this it is a log line that escaped — a serialized validation
 * payload, a chained exception, a stack summary. The longest legitimate one
 * measured is about 90 characters, so this leaves room for one longer sentence
 * and no more; a larger ceiling is just an untested window for a Spanish dump.
 */
const MAX_DETAIL_LENGTH = 120;

/**
 * Marks of a message addressed to a developer. Each pattern is here because a
 * real message in this system tripped it; none of them can appear in ordinary
 * Spanish prose written for a member of the club.
 */
const IMPLEMENTATION_VOCABULARY: readonly RegExp[] = [
  // `motivo_rechazo`, `tipo_cuenta`, `representante_id`, `fecha_inicio`.
  // Column and field names, which is the largest family of leaks by far.
  /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/,
  // `TIPO_SANGRE`, `ESTADO_MEMBRESIA` — enum members quoted back at the user.
  /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/,
  // `image/jpeg`, `application/pdf`. The type before the slash must be one of
  // IANA's nine top-level types (a closed list, so this cannot go stale),
  // because `word/word` alone is not a MIME type in Spanish — it is `y/o`,
  // `km/h`, `señor/a`, and above all the weekday pairs this club's schedules
  // are written with (`lunes/miércoles`), which a looser pattern silently ate.
  /\b(?:application|audio|font|image|message|model|multipart|text|video)\/[a-z0-9][a-z0-9.+-]*\b/i,
  // Anything serialized: pydantic's `[{'loc': …}]`, a dict, a generic type.
  /[{}[\]<>]/,
  // The HTTP code echoed into prose, including this client's own defaults.
  /\bstatus\s*\d{3}\b/i,
  // Python and JavaScript runtime vocabulary that reaches `detail` through an
  // unguarded `str(exc)`. `[A-Za-z]+Error` needs a prefix on purpose, so
  // `TypeError` and `IntegrityError` are caught while a Spanish sentence
  // opening with the word "Error" is not.
  /\b(?:Traceback|Exception|NoneType|None|undefined|NaN|null|[A-Za-z]+Error)\b/,
  // An untranslated framework string. The product speaks Spanish to its users,
  // so an English sentence in `detail` always escaped a library rather than
  // being written for anyone. Detecting the LANGUAGE beats listing the
  // messages: `Object of type Decimal is not JSON serializable` matched no
  // hand-picked keyword, but it cannot avoid English function words.
  //
  // Every token below was checked against Spanish: none of them is a Spanish
  // word, and the ones that look close are not reachable — `\binvalid\b` does
  // not match "invalidar", and "válido"/"están" carry accents. Deliberately
  // absent are `a`, `no`, `has`, `son` and `es`, which ARE Spanish.
  /\b(?:the|of|is|are|was|were|be|been|to|for|with|from|and|not|must|should|cannot|this|that|its|an|at|by|in|on|it|does|invalid|valid|required|field|value|type|object|string|number|expected|received|allowed|failed|request|response|internal|unknown|missing|serializable|unsupported|forbidden|unauthorized)\b/i,
];

/**
 * Whether a string looks like it was written for a person rather than for a
 * developer. Exported so the gate can be tested against the sentences the
 * product really shows, independently of any status.
 *
 * This is a heuristic and it is meant to be a strict one — see the asymmetry
 * argument in the module header. A false negative hides a useful detail behind
 * the caller's fallback; a false positive puts a column name on a screen.
 */
export function isUserFacingText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > MAX_DETAIL_LENGTH) return false;
  return !IMPLEMENTATION_VOCABULARY.some((pattern) => pattern.test(trimmed));
}

/**
 * Statuses whose `detail` may describe the caller's own input, and is
 * therefore eligible for gate 2. Nothing else in the response can tell the
 * user WHICH of the values they typed was refused.
 */
const INPUT_STATUSES: readonly number[] = [400, 409, 422];

/**
 * What the frontend says for a status whose meaning is complete on its own.
 * A status missing from this table falls back to the caller's sentence, which
 * names the operation and is strictly more informative than a generic line.
 */
const STATUS_MESSAGES: Readonly<Record<number, string>> = {
  401: "Su sesión expiró. Vuelva a iniciar sesión.",
  403: "No tiene permisos para realizar esta acción.",
  408: "La operación tardó demasiado. Intente nuevamente.",
  413: "El archivo es demasiado grande.",
  415: "El formato del archivo no es válido.",
  429: "Demasiados intentos. Espere un momento e intente nuevamente.",
};

/** Any 5xx. The detail describes the server's failure, never the user's. */
const SERVER_FAILURE = "El servidor no pudo completar la operación. Intente nuevamente en unos minutos.";

/** `fetch` rejected: no server ever answered, so there is no status at all. */
const NETWORK_FAILURE = "No pudimos conectar con el servidor. Revise su conexión e intente nuevamente.";

/** The caller aborted — a navigation, an unmount, a superseded request. */
const CANCELLED = "La operación se canceló.";

/**
 * What an `ApiClientError` carries when the response body named no reason at
 * all — a proxy 502, a gateway 504, a 4xx with an empty body.
 *
 * It is exported because the API client builds the error and this module reads
 * it, and the two must not drift into separate opinions. It is deliberately a
 * complete Spanish sentence rather than a diagnostic: the client throws it
 * before anything here can intervene, so it has to be safe to show as-is.
 */
export const GENERIC_FAILURE = "No se pudo completar la operación.";

/**
 * Reads an error's `status` without importing `ApiClientError` from
 * `services/api`. The check is structural on purpose: it keeps `lib/` free of
 * a dependency on the client, it matches errors that crossed a serialization
 * boundary (a server action, a route handler) and lost their prototype, and it
 * is the same duck-typing the three helpers this module replaces already did.
 */
function statusOf(error: unknown): number | null {
  if (!(error instanceof Error)) return null;
  const status = (error as Error & { status?: unknown }).status;
  return typeof status === "number" && Number.isFinite(status) ? status : null;
}

/**
 * Whether the server said the thing does not exist.
 *
 * A few screens legitimately BRANCH on a 404 rather than report it — a missing
 * medical record means "offer to create one", not "something went wrong". They
 * used to detect it by looking for "not found" inside the message, which was
 * an English substring in a Spanish product and broke the moment the backend
 * reworded anything. Reading the status belongs here for the same reason
 * reading the message does: one place decides what an error is saying.
 */
export function isNotFound(error: unknown): boolean {
  return statusOf(error) === 404;
}

/**
 * Turns anything thrown into a sentence the user can read.
 *
 * @param error    Whatever reached the `catch`. Never assumed to be an `Error`.
 * @param fallback What this operation says when the error carries nothing the
 *                 user can act on. Written by the call site, because only the
 *                 call site knows what was being attempted.
 */
export function toUserMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.name === "AbortError") return CANCELLED;

  const status = statusOf(error);

  if (status === null) {
    // No status means no server answered. A `TypeError: Failed to fetch` is
    // the common case and its message is the browser's, not the product's.
    return error instanceof TypeError ? NETWORK_FAILURE : fallback;
  }

  if (status >= 500) return SERVER_FAILURE;

  const canned = STATUS_MESSAGES[status];
  if (canned) return canned;

  if (INPUT_STATUSES.includes(status)) {
    const detail = (error as Error).message.trim();
    if (isUserFacingText(detail)) return detail;
  }

  return fallback;
}
