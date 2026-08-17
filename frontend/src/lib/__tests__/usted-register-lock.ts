/**
 * Shared "usted" register word lists — origin: issue #340. `/profile` was
 * tuteando/voseando ("Revisá", "mantené", "tu cuenta") while every other
 * screen the audit checked uses "usted" consistently.
 *
 * JS's `\b` treats accented letters as non-word characters, so `\brevisá\b`
 * silently fails to match "Revisá " — there is no word/non-word transition
 * between the trailing "á" and the space after it. A lookaround built on an
 * explicit Latin-letter class (including accents) is the boundary that
 * actually works here.
 *
 * The same follow-up audit that widened the check from one screen to the
 * whole app also found this exact list undercounted two shapes that don't
 * share the voseo stress pattern: "te" (a pronoun that, like "tú"/"vos",
 * never belongs to "usted") and specific tú-only conjugations ("entras",
 * "estás", "inténtalo") that read like ordinary prose everywhere else but
 * are unambiguous once you know "usted" would take the impersonal/3rd-person
 * form instead ("entra", "está", "inténtelo").
 *
 * Both copy locks build their regex from these same lists — the per-role
 * render check in ProfilePage.test.tsx and the app-wide source sweep in
 * usted-register.test.ts — so there is exactly one place that decides what
 * counts as voseo/tuteo.
 */

/** Common voseo imperatives (2nd person singular, stressed final vowel). */
export const VOSEO_IMPERATIVOS = [
  "revisá", "revisás", "mantené", "mantenés", "entrá", "entrás", "hacé", "hacés",
  "poné", "ponés", "tené", "tenés", "mirá", "mirás", "elegí", "elegís",
  "seguí", "seguís", "guardá", "guardás", "consultá", "consultás",
  "administrá", "administrás", "escribí", "escribís", "confirmá", "confirmás",
  "actualizá", "actualizás", "cambiá", "cambiás", "agregá", "agregás",
  "seleccioná", "seleccionás", "ingresá", "ingresás", "recordá", "recordás",
  "completá", "completás", "verificá", "verificás", "probá", "probás",
];

/**
 * Tú-specific forms that don't carry the voseo stress pattern above but are
 * still unambiguous tuteo markers: the trailing "-s" (tú indicative) or the
 * attached clitic (tú imperative) rule out an "usted"/impersonal 3rd-person
 * reading, which is why these are safe as literal words and not just
 * suffix rules — "entra"/"está"/"inténtelo" (no "-s", no clitic in the tú
 * shape) are the correct "usted" forms and must NOT be on this list.
 */
export const TUTEO_CONJUGACIONES = ["entras", "estás", "inténtalo"];

/**
 * Pronouns that belong to "tú"/"vos" and never to "usted" (which uses
 * "su"/"sus"/"lo"/"la"/"le" instead).
 */
export const PRONOMBRES = ["vos", "tú", "tu", "tus", "te"];

const LETTER = "a-záéíóúñA-ZÁÉÍÓÚÑ";

/**
 * Builds a fresh, global, case/accent-insensitive lookaround regex from the
 * word lists above. Returns a NEW instance each call — a global regex's
 * `.test()`/`.exec()` keep `lastIndex` state between calls, which corrupts
 * results when the same instance is reused across multiple input strings.
 */
export function buildUstedRegisterRegex(): RegExp {
  const words = [...VOSEO_IMPERATIVOS, ...TUTEO_CONJUGACIONES, ...PRONOMBRES];
  return new RegExp(`(?<![${LETTER}])(${words.join("|")})(?![${LETTER}])`, "giu");
}
