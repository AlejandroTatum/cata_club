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
 *
 * ## A third mode: `amount`
 *
 * Issue #667 — the price/valor fields on `/tarifas` and `/discounts` need
 * the same keystroke-level discipline cédula/teléfono already have, but a
 * currency amount isn't "N digits": it is an integer part, an optional
 * single decimal separator, and up to two decimal digits (cents). `amount`
 * reuses `NUMERIC_FIELD_MAX_DIGITS` for the INTEGER part's cap only —
 * `AMOUNT_MAX_DECIMAL_DIGITS` is the separate cents cap, and a second `.`
 * is dropped the same way an 11th cédula digit is: silently truncated by
 * `capDigits`/`filterNumericInput`, surfaced by the caller's `limitReached`
 * warning.
 */

export type NumericFieldMode = "cedula" | "phone" | "amount";

const ALLOWED_CHAR: Record<NumericFieldMode, RegExp> = {
  cedula: /[0-9]/,
  phone: /[0-9\s\-()]/,
  amount: /[0-9.]/,
};

/**
 * Cédula and teléfono cap at 10 (see above). `amount`'s entry is the
 * INTEGER part's cap only — six digits is $999,999, well past any real club
 * fee, and generous enough that a typo is still caught while a legitimate
 * price never brushes it. See `AMOUNT_MAX_DECIMAL_DIGITS` for the cents cap.
 */
export const NUMERIC_FIELD_MAX_DIGITS: Record<NumericFieldMode, number> = {
  cedula: 10,
  phone: 10,
  amount: 6,
};

/** How many digits an `amount` value keeps after its decimal separator — currency cents. */
export const AMOUNT_MAX_DECIMAL_DIGITS = 2;

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
  if (mode === "amount") return capAmount(raw);
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
 * `capDigits`'s `amount` branch: an integer-part digit cap
 * (`NUMERIC_FIELD_MAX_DIGITS.amount`), a decimal-part digit cap
 * (`AMOUNT_MAX_DECIMAL_DIGITS`), and at most one decimal separator. A digit
 * or a second `.` past its cap is dropped, mirroring `capDigits`'s own
 * per-character drop — never a whole-value rejection, and never a letter
 * (there are none to drop; `amount`'s `ALLOWED_CHAR` never let one through
 * `filterNumericInput`, and the `onChange` backstop doesn't strip them
 * either — same "never silently correct a character class" rule as cédula
 * and teléfono).
 */
function capAmount(raw: string): NumericInputResult {
  const maxIntegerDigits = NUMERIC_FIELD_MAX_DIGITS.amount;
  let integerDigits = 0;
  let decimalDigits = 0;
  let seenSeparator = false;
  let value = "";
  let limitReached = false;
  for (const char of raw) {
    if (char === ".") {
      if (seenSeparator) {
        limitReached = true;
        continue;
      }
      seenSeparator = true;
    } else if (isDigit(char)) {
      if (seenSeparator) {
        if (decimalDigits >= AMOUNT_MAX_DECIMAL_DIGITS) {
          limitReached = true;
          continue;
        }
        decimalDigits++;
      } else {
        if (integerDigits >= maxIntegerDigits) {
          limitReached = true;
          continue;
        }
        integerDigits++;
      }
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
