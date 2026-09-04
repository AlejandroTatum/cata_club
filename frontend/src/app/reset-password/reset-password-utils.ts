/**
 * Pure helpers for `/reset-password`.
 *
 * Separate module because an App Router `page.tsx` may only export `default`
 * plus Next's own reserved names (`metadata`, `generateStaticParams`, …) — a
 * stray named export fails the build's generated route types, not just lint.
 */
import { PASSWORD_MIN_LENGTH, isCommonPassword } from "@/lib/identity-validation";

/** The minimum the backend itself enforces — nothing more is invented here. */
export const MIN_PASSWORD_LENGTH = PASSWORD_MIN_LENGTH;

export interface PasswordRule {
  label: string;
  met: boolean;
}

/**
 * The live checklist under the password field. Pure so the rule set can be
 * asserted directly, and so "what the user sees" and "what blocks submit"
 * cannot drift: the page's submit gate is exactly `rules.every(r => r.met)`.
 *
 * `docs/archive/prototypes/prototipos/04-restablecer-contrasenia.html` lists a fourth rule,
 * "Una mayúscula y un número". It is deliberately NOT enforced: the backend's
 * contract is length + the shared denylist (issue #1017, ADR-5) — not
 * composition rules. Issue #230 (CLOSED) already settled that shape; a
 * stricter client would reject passwords the server accepts.
 *
 * The denylist rule reuses `COMMON_PASSWORDS`/`isCommonPassword` from
 * `identity-validation.ts` — the same list the enrollment wizard already
 * enforces, and the same list `backend/app/dominio/contrasenia.py` ported
 * server-side. A public reset that skipped this rule could install a
 * password the create-side floor already refuses, on the very account that
 * floor is meant to protect.
 */
export function buildPasswordRules(password: string, confirmPassword: string): PasswordRule[] {
  // Trimmed once up front, same reasoning as `identity-validation.ts`'s
  // `passwordRule`: measuring the raw value for length and the trimmed
  // value for the denylist would let `"a"` padded to 8 with spaces clear the
  // floor and then dodge the common-list check as the 1-character password
  // it really is.
  const trimmed = password.trim();
  return [
    {
      label: `Al menos ${MIN_PASSWORD_LENGTH} caracteres`,
      met: trimmed.length >= MIN_PASSWORD_LENGTH,
    },
    {
      // Two empty strings are not a match — otherwise the checklist would show
      // this satisfied before anything was typed.
      label: "Las dos contraseñas coinciden",
      met: password.length > 0 && password === confirmPassword,
    },
    {
      label: "No es una de las contraseñas más usadas",
      met: trimmed.length > 0 && !isCommonPassword(trimmed),
    },
  ];
}
