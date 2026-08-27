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
  /*
   * Second batch — the app-wide sweep is only ever as wide as this list, and
   * "Reducí el monto ingresado." (the #666 cap message, shipped in #679) sat
   * in `student/payments/payments-utils.ts` through every green run of that
   * sweep for one reason: "reducir" was not on it. These are the verbs this
   * product's copy actually gives instructions with — an amount to lower, a
   * receipt to attach, a form to submit, a button to press.
   *
   * Ambiguous first-person preterites are deliberately absent. For -ir verbs
   * the voseo imperative and "yo" preterite are the same word ("subí",
   * "pedí", "recibí"), and this app's FAQ is written as questions a user asks
   * in the first person ("Ya cargué el comprobante") — listing those would
   * make the lock fire on correct usted-register copy. "reducí" carries that
   * same ambiguity but earns its place: it is the defect this batch exists
   * for, and no plausible screen says "yo reducí".
   */
  "reducí", "reducís", "cargá", "cargás", "adjuntá", "adjuntás",
  "enviá", "enviás", "descargá", "descargás", "buscá", "buscás",
  "intentá", "intentás", "esperá", "esperás", "aumentá", "aumentás",
  "asigná", "asignás", "registrá", "registrás", "marcá", "marcás",
  "cancelá", "cancelás", "pagá", "pagás", "usá", "usás",
  "corregí", "corregís", "tocá", "tocás", "andá", "andás",
  "vení", "venís",
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
