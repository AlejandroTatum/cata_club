/**
 * Keystroke/paste/`onChange` masking for a `NumericFieldMode` field, as a
 * hook — extracted from `WizardInput` (issue #667's emergency-contact parity
 * gap) so `MedicalRecordEditor`'s teléfono de emergencia field gets the
 * exact same tested behavior instead of a second, drifting copy: reject a
 * disallowed character at `keydown`, filter-and-cap a whole pasted chunk,
 * and cap-only (never strip a letter) on any other `onChange` — see
 * `numeric-input.ts`'s own doc comment for why that split exists.
 *
 * `numeric-input.ts` stays framework-agnostic (no React import, easy to
 * unit-test in isolation); this hook is the one place that wires its pure
 * functions to input events and `aria-live` state.
 *
 * ## Normalizing before the cap (issue #855)
 *
 * A celular autofilled by a mobile browser in international format
 * (`+593991234567`, 13 characters) used to reach `capDigits`/
 * `filterNumericInput` BEFORE anything converted it to the local
 * `09XXXXXXXX` it should become — so the 10-digit cap truncated it instead
 * of the international prefix ever getting a chance to resolve. Every path
 * that can hand this hook a whole value (`handleChange`'s onChange
 * backstop, `handlePaste`, and `handleKeyDown`'s next-value check) runs it
 * through `normalizeEcuadorianMobile` FIRST, and only for `mode === "phone"`
 * — `identity-validation.ts`'s own contract already returns a non-matching
 * value untouched, so a local number (with or without separators) or a
 * cédula/amount value is never rewritten by this step.
 */

import { useState } from "react";
import type { KeyboardEvent, ClipboardEvent } from "react";
import { capDigits, filterNumericInput, isAllowedChar, type NumericFieldMode } from "./numeric-input";
import { normalizeEcuadorianMobile } from "./identity-validation";

/** `normalizeEcuadorianMobile` only applies to `phone` — every other mode passes `raw` through untouched. */
function normalizePhone(mode: NumericFieldMode, raw: string): string {
  return mode === "phone" ? normalizeEcuadorianMobile(raw) : raw;
}

export interface NumericFieldMasking {
  /** True when the last keystroke/paste/change was truncated by the mode's cap — drive an `aria-live` warning from this, never a silent drop. */
  limitReached: boolean;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  onPaste: (e: ClipboardEvent<HTMLInputElement>) => void;
  /** Wraps the caller's `onChange`: applies `capDigits` first when `mode` is set, then forwards the (possibly capped) value. */
  onChange: (raw: string) => void;
  /**
   * Clears `limitReached` without touching the field's value. `WizardInput`
   * and `MedicalRecordEditor` never need this — their input unmounts with
   * the rest of the form, which resets the hook's own state for free. A
   * caller whose hook instance OUTLIVES the field it drives — `/tarifas`'s
   * one `precioMasking` shared across every row's edit session — needs it:
   * without a reset, cancelling a cap warning on one row and opening a
   * different row would show a stale warning that row never triggered.
   */
  reset: () => void;
}

export interface NumericFieldMaskingOptions {
  /**
   * `WizardInput`/`MedicalRecordEditor`'s `onChange` is a cap-ONLY backstop
   * (`capDigits`) that deliberately never strips a letter — see
   * `numeric-input.ts`'s doc comment (V01, `enroll-qa.spec.ts`). `/tarifas`'s
   * precio field never had that concern (issue #506's `sanitizePrecioInput`
   * always stripped everything disallowed on every change, with no separate
   * `keydown` guard at the time), and its own test suite already locks that
   * full-strip behavior for a one-shot value set. Passing `true` here keeps
   * that contract: `onChange` runs the full `filterNumericInput` instead of
   * the bare cap.
   */
  fullFilterOnChange?: boolean;
}

/**
 * `mode: undefined` makes every handler a no-op passthrough — the same
 * "plain fields are unaffected" contract `WizardInput` already offers
 * callers that don't pass `numericMode`.
 */
export function useNumericFieldMasking(
  mode: NumericFieldMode | undefined,
  onChange: (value: string) => void,
  options?: NumericFieldMaskingOptions,
): NumericFieldMasking {
  const [limitReached, setLimitReached] = useState(false);

  function handleChange(raw: string): void {
    if (!mode) {
      onChange(raw);
      return;
    }
    const normalized = normalizePhone(mode, raw);
    const result = options?.fullFilterOnChange
      ? filterNumericInput(mode, normalized)
      : capDigits(mode, normalized);
    setLimitReached(result.limitReached);
    onChange(result.value);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if (!mode) return;
    // Modifier combos (Ctrl+V, Cmd+A…) and non-printable keys (Backspace,
    // Tab, arrows…) are never in the way — only a single printable
    // character can be a disallowed letter or an over-the-cap digit.
    if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
    if (!isAllowedChar(mode, e.key)) {
      e.preventDefault();
      return;
    }
    // Simulates the value this keystroke would produce at the current
    // caret/selection — the same splice `handlePaste` below does for a
    // whole pasted chunk — then runs it through `filterNumericInput` to
    // decide whether it fits any of the mode's caps (digit count for
    // cédula/teléfono; integer digits, decimal digits, and separator count
    // for amount).
    const input = e.currentTarget;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    const nextRaw = input.value.slice(0, start) + e.key + input.value.slice(end);
    const result = filterNumericInput(mode, normalizePhone(mode, nextRaw));
    if (result.limitReached) {
      e.preventDefault();
      setLimitReached(true);
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>): void {
    if (!mode) return;
    e.preventDefault();
    const pasted = e.clipboardData.getData("text");
    const input = e.currentTarget;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    const nextRaw = input.value.slice(0, start) + pasted + input.value.slice(end);
    const result = filterNumericInput(mode, normalizePhone(mode, nextRaw));
    setLimitReached(result.limitReached);
    onChange(result.value);
  }

  return {
    limitReached,
    onKeyDown: handleKeyDown,
    onPaste: handlePaste,
    onChange: handleChange,
    reset: () => setLimitReached(false),
  };
}
