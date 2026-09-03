/**
 * Shared "grafía prohibida" word list for the copy-ortografía sweep — issue
 * #865. Sibling of `usted-register-lock.ts`: same shape (a short word list
 * plus a fresh-regex builder), a different defect class.
 *
 * Only misspellings that are unambiguous ANYWHERE they appear make this
 * list: "inscripto"/"inscriptos" never legitimately spell a Spanish word
 * other than the one this app standardizes on "inscrito"/"inscritos", so a
 * word-boundary match is safe without needing to look at surrounding code.
 * A word like "categoria" (missing tilde) does NOT belong here — it is also
 * a legitimate technical identifier throughout the codebase
 * (`CategoriaHorario`, `actualizarCategoria`, `categoria: string`), so
 * flagging it app-wide would fail on the code itself, not on copy. That
 * class of fix stays as a targeted, per-message regression check instead
 * (see the backend's `tests/test_copy_ortografia_contract.py`).
 */

/** Grafía prohibida → forma corregida que la sustituye en este producto. */
export const GRAFIAS_PROHIBIDAS: Record<string, string> = {
  inscripto: "inscrito",
  inscriptos: "inscritos",
  inscrpicion: "inscripción",
};

const LETTER = "a-záéíóúñA-ZÁÉÍÓÚÑ";

/**
 * Builds a fresh, global, case/accent-insensitive lookaround regex from the
 * word list above. Returns a NEW instance each call, same reason
 * `buildUstedRegisterRegex()` does: a global regex's `.test()` keeps
 * `lastIndex` state between calls, which corrupts results when the same
 * instance is reused across multiple input strings.
 */
export function buildGrafiaProhibidaRegex(): RegExp {
  const words = Object.keys(GRAFIAS_PROHIBIDAS);
  return new RegExp(`(?<![${LETTER}])(${words.join("|")})(?![${LETTER}])`, "giu");
}
