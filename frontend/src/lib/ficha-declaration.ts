/**
 * Issue #1574: alergias and enfermedades are required on every ficha médica.
 * A person with none types «Ninguno», which the backend stores as an explicit
 * declaration («Ninguna» allergies, an empty illness list) — never as an
 * illness called «Ninguno».
 *
 * Because the backend writes both fields together, a stored ficha with
 * non-empty alergias also declared its illnesses; a ficha with empty alergias
 * predates the rule and has declared nothing.
 */

export const NINGUNO_HELP = "Si no tiene, escribe Ninguno.";
export const ALERGIAS_REQUIRED = 'Escribe tus alergias o "Ninguno" si no tienes.';
export const ENFERMEDADES_REQUIRED = 'Escribe tus enfermedades o "Ninguno" si no tienes.';

/** Shown for a stored ficha whose fields are empty (written before the rule). */
export const SIN_DECLARAR = "Sin declarar";

/** What a declared «no allergies / no illnesses» reads as. */
export const NINGUNA = "Ninguna";

function isFilled(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** Required-field rule shared by every ficha form: `null` when filled. */
export function requiredFichaTextError(value: string, message: string): string | null {
  return value.trim() === "" ? message : null;
}

/** Whether a comma-separated illness input names at least one illness. */
export function hasEnfermedadesInput(raw: string): boolean {
  return raw.split(",").some((part) => part.trim() !== "");
}

/** Read-only text for the stored alergias: the declaration, or «Sin declarar». */
export function describeAlergias(alergias: string | null | undefined): string {
  return isFilled(alergias) ? alergias.trim() : SIN_DECLARAR;
}

/** Read-only text for the stored illnesses: names, «Ninguna» if declared, else «Sin declarar». */
export function describeEnfermedades(
  nombres: readonly string[],
  alergias: string | null | undefined,
): string {
  if (nombres.length > 0) return nombres.join(", ");
  return isFilled(alergias) ? NINGUNA : SIN_DECLARAR;
}

/** Editor prefill for the illness input: a declared «none» comes back as «Ninguno». */
export function enfermedadesInputValue(
  nombres: readonly string[],
  alergias: string | null | undefined,
): string {
  if (nombres.length > 0) return nombres.join(", ");
  return isFilled(alergias) ? "Ninguno" : "";
}
