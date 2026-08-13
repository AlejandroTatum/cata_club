/**
 * Keystroke/paste-level filtering for the cédula and teléfono inputs shared
 * by all three signup wizards (`/student/enroll`, `/student/add-dependent`,
 * `/admin/crear-cuenta`).
 *
 * ## Why not a bare `maxLength`
 *
 * Issue #225: a bare `maxLength={10}` on the cédula input let the browser
 * silently swallow an 11th keystroke — the field looked fine, showed 10
 * digits, and gave no sign that they were not what the visitor typed. PR
 * #255 removed it for exactly that reason. This module still caps the field
 * at 10 (a later QA pass asked for that back: "no puede tipear 11"), but
 * pairs the cap with an explicit, `aria-live` warning from the caller
 * (`WizardInput`) — the cap is real, but it is never silent again.
 *
 * ## Two independent character sets
 *
 *   - cédula: digits only. `cedulaError` (identity-validation.ts) never
 *     tolerates separators (`/^\d{10}$/`), so neither does this.
 *   - teléfono: digits plus the same typing separators `phoneError` already
 *     strips before validating — space, hyphen, parenthesis
 *     (`PHONE_SEPARATOR_PATTERN`). Separators don't count against the digit
 *     cap: "099-123-4567" is 10 digits and 2 separators, not 12 characters.
 *
 * ## Why `capDigits` and `filterNumericInput` are two different functions
 *
 * `capDigits` enforces ONLY the digit cap — it never drops a letter. It is
 * the `onChange` backstop `WizardInput` runs on every value, including one
 * that arrived by a path a `keydown`/`paste` handler never sees: browser
 * autofill, IME composition, or a test harness setting `.value` directly.
 * If it also stripped letters, a value set that way would silently lose them
 * — exactly the kind of invisible correction issue #225 was about in the
 * first place, just relocated to a different character class.
 *
 * `filterNumericInput` does both (strip disallowed characters, then cap) and
 * is for the `paste` handler, which receives the clipboard's raw text and
 * needs the full treatment in one pass. Typed letters are rejected by
 * `WizardInput`'s `keydown` handler before they ever reach either function.
 */

export type NumericFieldMode = "cedula" | "phone";

const ALLOWED_CHAR: Record<NumericFieldMode, RegExp> = {
  cedula: /[0-9]/,
  phone: /[0-9\s\-()]/,
};

/** Both fields cap at 10: a cédula IS 10 digits, and 10 is the longer of the two valid teléfono shapes (celular). */
export const NUMERIC_FIELD_MAX_DIGITS: Record<NumericFieldMode, number> = {
  cedula: 10,
  phone: 10,
};

export function isAllowedChar(mode: NumericFieldMode, char: string): boolean {
  return ALLOWED_CHAR[mode].test(char);
}

function isDigit(char: string): boolean {
  return char >= "0" && char <= "9";
}

export interface NumericInputResult {
  value: string;
  /** True when `raw` carried more digits than the mode's cap allows and some were dropped. */
  limitReached: boolean;
}

/**
 * Truncates `raw` so it never carries more than the mode's digit cap,
 * dropping digits (never other characters) once the cap is reached,
 * wherever in the string they fall. Does not touch non-digit characters —
 * see the module doc comment for why.
 */
export function capDigits(mode: NumericFieldMode, raw: string): NumericInputResult {
  const max = NUMERIC_FIELD_MAX_DIGITS[mode];
  let digits = 0;
  let value = "";
  let limitReached = false;
  for (const char of raw) {
    if (isDigit(char)) {
      if (digits >= max) {
        limitReached = true;
        continue;
      }
      digits++;
    }
    value += char;
  }
  return { value, limitReached };
}

/**
 * Strips every character `mode` doesn't allow, then applies `capDigits`.
 * Used for a whole incoming chunk of text at once — paste content — where
 * letters and an over-the-cap length can both need handling in one pass.
 */
export function filterNumericInput(mode: NumericFieldMode, raw: string): NumericInputResult {
  const allowedOnly = Array.from(raw)
    .filter((char) => isAllowedChar(mode, char))
    .join("");
  return capDigits(mode, allowedOnly);
}
