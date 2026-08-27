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
 */

import { useState } from "react";
import type { KeyboardEvent, ClipboardEvent } from "react";
import { capDigits, filterNumericInput, isAllowedChar, type NumericFieldMode } from "./numeric-input";

export interface NumericFieldMasking {
  /** True when the last keystroke/paste/change was truncated by the mode's cap — drive an `aria-live` warning from this, never a silent drop. */
  limitReached: boolean;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  onPaste: (e: ClipboardEvent<HTMLInputElement>) => void;
  /** Wraps the caller's `onChange`: applies `capDigits` first when `mode` is set, then forwards the (possibly capped) value. */
  onChange: (raw: string) => void;
}

/**
 * `mode: undefined` makes every handler a no-op passthrough — the same
 * "plain fields are unaffected" contract `WizardInput` already offers
 * callers that don't pass `numericMode`.
 */
export function useNumericFieldMasking(
  mode: NumericFieldMode | undefined,
  onChange: (value: string) => void,
): NumericFieldMasking {
  const [limitReached, setLimitReached] = useState(false);

  function handleChange(raw: string): void {
    if (!mode) {
      onChange(raw);
      return;
    }
    const result = capDigits(mode, raw);
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
    const result = filterNumericInput(mode, nextRaw);
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
    const result = filterNumericInput(mode, nextRaw);
    setLimitReached(result.limitReached);
    onChange(result.value);
  }

  return { limitReached, onKeyDown: handleKeyDown, onPaste: handlePaste, onChange: handleChange };
}
