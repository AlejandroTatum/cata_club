/**
 * Shared register word lists — origin: issue #340, flipped by QA4 S6 / W3-6.
 * The app speaks «tú» ("Inscríbete", "tu cuenta") everywhere, never voseo
 * ("Revisá", "mantené") and never "usted" ("Inscríbase", "su cuenta" as a
 * form of address). The lock bans voseo and "usted" shapes; tú forms pass.
 *
 * JS's `\b` treats accented letters as non-word characters, so `\brevisá\b`
 * silently fails to match "Revisá " — there is no word/non-word transition
 * between the trailing "á" and the space after it. A lookaround built on an
 * explicit Latin-letter class (including accents) is the boundary that
 * actually works here.
 *
 * Both copy locks build their regex from these same lists — the per-role
 * render check in ProfilePage.test.tsx and the app-wide source sweep in
 * usted-register.test.ts — so there is exactly one place that decides what
 * counts as a register violation.
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

/** Voseo pronoun — "tú"/"tu"/"tus"/"te" are the app's register and are NOT banned. */
export const VOSEO_PRONOMBRES = ["vos"];

/**
 * "Usted" address forms. "su"/"sus" are deliberately NOT listed: they are
 * also the ordinary third-person possessive ("su equipo", "sus datos").
 */
export const USTED_PRONOMBRES = ["usted", "ustedes"];

/**
 * Usted imperatives (subjunctive-shaped) this product's copy gives
 * instructions with — the tú counterpart is "Inscríbete", "Ingresa", ….
 * Only forms whose tú shape differs; "cree" is excluded because it is
 * also the ordinary indicative "cree que" ("believes").
 *
 * These same shapes are ordinary third-person subjunctives in tú copy
 * ("para que el club revise", "cuando se complete"), and a few collide with
 * English code ("use", "complete"). So they only count in an IMPERATIVE
 * POSITION — see `IMPERATIVE_POSITION` — never mid-clause.
 */
export const USTED_IMPERATIVOS = [
  "inscríbase", "ingrese", "revise", "intente", "inténtelo", "elija",
  "seleccione", "escriba", "complete", "verifique", "comuníquese", "corrija",
  "adjunte", "registre", "espere", "consulte", "pruebe", "vuelva",
  "pida", "contacte", "confirme", "acepte", "cambie", "use", "suba",
  "descargue", "cargue", "envíe", "guarde", "actualice",
  "cancele", "reduzca", "busque", "agregue", "recuerde",
  "presione", "continúe", "regístrese",
  "inicie", "elimine", "abra", "valide", "indique",
  "evite", "mezcle", "gestione", "reasigne",
];

/**
 * Imperative + clitic ("alárguela", "apruébelas", "revíselo"): the stressed
 * vowel gains an accent, so a bare "-ela"/"-elo" suffix rule would also hit
 * "escuela" and "vela". Listed by hand instead. The clitic makes these
 * unambiguous (never a subjunctive, never English), so they match anywhere.
 */
export const USTED_IMPERATIVOS_CON_CLITICO = [
  "alárguela", "alárguelo", "apruébela", "apruébelas", "apruébelo", "apruébelos",
  "revísela", "revíselo", "corríjala", "corríjalo", "guárdela", "guárdelo",
  "verifíquela", "verifíquelo", "cámbiela", "cámbielo", "elimínela", "elimínelo",
  "descárguela", "descárguelo", "envíela", "envíelo", "pídala", "pídalo",
];

const LETTER = "a-záéíóúñA-ZÁÉÍÓÚÑ";

/**
 * Builds a fresh, global, case/accent-insensitive lookaround regex from the
 * word lists above. Returns a NEW instance each call — a global regex's
 * `.test()`/`.exec()` keep `lastIndex` state between calls, which corrupts
 * results when the same instance is reused across multiple input strings.
 */
export function buildUstedRegisterRegex(): RegExp {
  const always = [
    ...VOSEO_IMPERATIVOS,
    ...VOSEO_PRONOMBRES,
    ...USTED_PRONOMBRES,
    ...USTED_IMPERATIVOS_CON_CLITICO,
  ];
  // A bare usted imperative opens the string or a sentence/clause, follows
  // «por favor», or continues a coordinated instruction («alárguela o mezcle»).
  // "para que el club revise" / "cuando se complete" have a subject or
  // «se» in front and so stay out.
  const imperative = `(?<=(?:^|[.!?¿¡:;,"'\`>()\\n]|\\b(?:y|o|u|e|favor|luego|después|también))\\s*)(?:${USTED_IMPERATIVOS.join("|")})`;
  return new RegExp(
    `(?<![${LETTER}])(${always.join("|")}|${imperative})(?![${LETTER}])`,
    "giu",
  );
}
