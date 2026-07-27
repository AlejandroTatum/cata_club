/**
 * Detects the backend's "this identity is already registered" errors so the
 * wizards can offer a way forward instead of a dead end.
 *
 * The backend raises `EntidadDuplicada` (HTTP 400) with one of a small set of
 * Spanish phrasings when a cédula or an e-mail is already taken
 * (`enrollment_servicio`, `persona_servicio`, `admin_cuenta_servicio`). Those
 * messages reach the user verbatim, and from a signup wizard they used to be
 * terminal: no link to sign in, no password recovery, nothing.
 *
 * Matching is on the message text because that is all the BFF forwards; every
 * duplicate case shares the same HTTP 400 as a dozen unrelated validation
 * errors, so the status alone cannot tell them apart. The patterns are
 * accent- and case-insensitive so a backend message that loses its accents in
 * transit still matches.
 */

const PATRONES_IDENTIDAD_DUPLICADA = [
  /ya existe una persona con la c[eé]dula/i,
  /el correo (del representante )?ya est[aá] en uso/i,
];

export function isDuplicateIdentityError(message: unknown): boolean {
  if (typeof message !== "string" || !message.trim()) return false;
  return PATRONES_IDENTIDAD_DUPLICADA.some((patron) => patron.test(message));
}
