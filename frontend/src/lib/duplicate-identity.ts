/**
 * Detects the backend's "this identity is already registered" errors so the
 * wizards can offer a way forward instead of a dead end.
 *
 * The backend raises `EntidadDuplicada` (HTTP 400) when a cédula or an e-mail
 * is already taken. Those messages reach the user verbatim, and from a signup
 * wizard they used to be terminal: no link to sign in, no password recovery,
 * nothing.
 *
 * There are two wordings, by design (backend `app/dominio/mensajes.py`):
 *
 *  - Public and representative-facing flows (enrollment, registration, adding
 *    a dependent) answer with ONE fixed generic sentence, identical for cédula
 *    and for e-mail. Repeating the identifier, or naming which field matched,
 *    turned an unauthenticated endpoint into a membership oracle.
 *  - The admin panel (`POST /personas/admin/cuentas`, ADMINISTRADOR-only)
 *    keeps the precise wording — an operator who can already list the whole
 *    roster learns nothing new from it, and needs to know what to correct.
 *
 * Matching is still on the message text because that is all the BFF forwards:
 * every duplicate case shares HTTP 400 with a dozen unrelated validation
 * errors, so the status alone cannot tell them apart. Carrying a machine
 * readable error code instead would mean widening the error envelope through
 * `_respuesta_error`, every Route Handler and `request()` — worth doing, but
 * not as part of a wording fix. Until then the coupling is pinned from the
 * other side too: `backend/tests/test_mensajes_identidad_duplicada.py` fails
 * if the backend text drifts away from the constant below.
 *
 * The legacy patterns are accent- and case-insensitive so a message that loses
 * its accents in transit still matches.
 */

/** Verbatim copy of `MENSAJE_IDENTIDAD_DUPLICADA` (backend `app/dominio/mensajes.py`). */
export const MENSAJE_IDENTIDAD_DUPLICADA = "Ya existe una cuenta registrada con los datos ingresados.";

const PATRONES_IDENTIDAD_DUPLICADA = [
  // Generic message — public, representative and registration flows.
  /ya existe una cuenta registrada con los datos ingresados/i,
  // Precise messages — kept for the admin panel.
  /ya existe una persona con la c[eé]dula/i,
  /el correo (del representante )?ya est[aá] en uso/i,
];

export function isDuplicateIdentityError(message: unknown): boolean {
  if (typeof message !== "string" || !message.trim()) return false;
  return PATRONES_IDENTIDAD_DUPLICADA.some((patron) => patron.test(message));
}
