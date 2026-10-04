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
 *    and for e-mail. It names the SET of fields that could have collided
 *    ("cédula o correo") — that names nothing an attacker doesn't already
 *    know — but never which one actually matched, and never repeats the
 *    identifier (issue #999: an earlier version of this sentence named
 *    neither field, and a visitor who fixed the one they guessed wrong kept
 *    reading the same generic text after colliding on the other).
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
export const MENSAJE_IDENTIDAD_DUPLICADA =
  "Alguno de los datos ingresados, cédula o correo, ya pertenece a una cuenta registrada. Si ya fue socio del club, comuníquese con nosotros para reactivar su cuenta.";

const PATRONES_IDENTIDAD_DUPLICADA = [
  // Generic message — all supported public and representative flows.
  /alguno de los datos ingresados, c[eé]dula o correo, ya pertenece a una cuenta registrada/i,
  // Legacy clients may still return these variants; recognizing them does not
  // expose or restore the retired account-creation capability.
  /ya existe una persona con la c[eé]dula/i,
  /ya existe una cuenta registrada con la c[eé]dula o el correo/i,
  /el correo (del representante )?ya est[aá] en uso/i,
];

export function isDuplicateIdentityError(message: unknown): boolean {
  if (typeof message !== "string" || !message.trim()) return false;
  return PATRONES_IDENTIDAD_DUPLICADA.some((patron) => patron.test(message));
}

/**
 * What a signed-in person reads when the e-mail they typed in "Corregirlo"
 * belongs to another account. The shared sentence above is written for public
 * forms (it also names the cédula, which was never asked here — REG-12).
 */
export const MENSAJE_CORREO_DE_OTRA_CUENTA = "Ese correo ya pertenece a otra cuenta.";
