/**
 * `useNumericFieldMasking`'s `phone` mode — normalize BEFORE the 10-digit
 * cap (issue #855).
 *
 * Autofill and paste hand the hook a WHOLE value in one call (`onChange`'s
 * cap-only backstop, `onPaste`) — that is exactly the shape a mobile
 * browser's `+593991234567` autofill arrives in, and exactly what used to
 * get truncated: the 13-character international form hit the 10-digit cap
 * before anything converted it to the local `09XXXXXXXX` form. These tests
 * drive the hook the same way `WizardInput` (`WizardInput.test.tsx`) does,
 * but through the hook directly so the normalize-before-cap contract is
 * pinned independently of any one field component.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useNumericFieldMasking } from "../use-numeric-field-masking";
import type { NumericFieldMode } from "../numeric-input";

function renderMasking(mode: NumericFieldMode) {
  const onChange = vi.fn();
  const { result } = renderHook(() => useNumericFieldMasking(mode, onChange));
  return { result, onChange };
}

/** A minimal clipboard event — the only shape `handlePaste` reads (`currentTarget`, `clipboardData.getData`). */
function pasteEvent(text: string): React.ClipboardEvent<HTMLInputElement> {
  return {
    preventDefault: () => {},
    clipboardData: { getData: () => text },
    currentTarget: { value: "", selectionStart: 0, selectionEnd: 0 },
  } as unknown as React.ClipboardEvent<HTMLInputElement>;
}

describe("useNumericFieldMasking — phone onChange backstop normalizes before the digit cap (issue #855)", () => {
  it.each([
    ["normalizes an autofilled +593 value instead of truncating it", "+593991234567", "0991234567", false],
    ["normalizes an autofilled 593 value (no plus sign) the same way", "593991234567", "0991234567", false],
    ["passes a manually-typed local 09 value through untouched", "0991234567", "0991234567", false],
    [
      "still caps a manually-typed over-length LOCAL value and warns — normalization never widens the cap",
      "09912345678", // 11 digits, not an international shape
      "0991234567",
      true,
    ],
    [
      "preserves separators on a locally-formatted value — normalization never rewrites a non-matching number",
      "099-123-4567",
      "099-123-4567",
      false,
    ],
    [
      "passes a letter-containing value through unfiltered — same as before #855",
      "099abc1234",
      "099abc1234",
      false,
    ],
  ])("%s", (_description, raw, expectedValue, expectedLimitReached) => {
    const { result, onChange } = renderMasking("phone");

    act(() => result.current.onChange(raw));

    expect(onChange).toHaveBeenCalledWith(expectedValue);
    expect(result.current.limitReached).toBe(expectedLimitReached);
  });
});

describe("useNumericFieldMasking — phone onPaste normalizes before the digit cap (issue #855)", () => {
  it.each([
    [
      "normalizes a pasted +593 value with the typing separators an autofill can include",
      "+593 99 123 4567",
      "0991234567",
    ],
    ["leaves a fijo untouched — the international mapping is mobile-only", "022345678", "022345678"],
  ])("%s", (_description, pasted, expectedValue) => {
    const { result, onChange } = renderMasking("phone");

    act(() => result.current.onPaste(pasteEvent(pasted)));

    expect(onChange).toHaveBeenCalledWith(expectedValue);
  });
});

describe("useNumericFieldMasking — the international mapping is phone-only", () => {
  it("never applies it to cedula mode", () => {
    const { result, onChange } = renderMasking("cedula");

    act(() => result.current.onPaste(pasteEvent("+593991234567")));

    // Cedula strips everything non-digit (including "+") and caps at 10 —
    // the phone-only international-to-local mapping never runs here, so the
    // result is the plain digit cap, NOT "0991234567".
    expect(onChange).toHaveBeenCalledWith("5939912345");
  });
});
