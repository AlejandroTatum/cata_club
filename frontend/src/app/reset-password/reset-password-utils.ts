/**
 * Pure helpers for `/reset-password`.
 *
 * Separate module because an App Router `page.tsx` may only export `default`
 * plus Next's own reserved names (`metadata`, `generateStaticParams`, …) — a
 * stray named export fails the build's generated route types, not just lint.
 */

/** The minimum the backend itself enforces — nothing more is invented here. */
export const MIN_PASSWORD_LENGTH = 8;

export interface PasswordRule {
  label: string;
  met: boolean;
}

/**
 * The live checklist under the password field. Pure so the rule set can be
 * asserted directly, and so "what the user sees" and "what blocks submit"
 * cannot drift: the page's submit gate is exactly `rules.every(r => r.met)`.
 *
 * `docs/archive/prototypes/prototipos/04-restablecer-contrasenia.html` lists a third rule,
 * "Una mayúscula y un número". It is deliberately NOT enforced: the backend's
 * only constraint is
 * `nueva_contrasenia: str = Field(..., min_length=8)`
 * (backend/app/presentacion/schemas/auth_schemas.py:94). A stricter client
 * would reject passwords the server accepts, and inventing a password policy
 * is a product decision, not a design one.
 */
export function buildPasswordRules(password: string, confirmPassword: string): PasswordRule[] {
  return [
    {
      label: `Al menos ${MIN_PASSWORD_LENGTH} caracteres`,
      met: password.length >= MIN_PASSWORD_LENGTH,
    },
    {
      // Two empty strings are not a match — otherwise the checklist would show
      // this satisfied before anything was typed.
      label: "Las dos contraseñas coinciden",
      met: password.length > 0 && password === confirmPassword,
    },
  ];
}
