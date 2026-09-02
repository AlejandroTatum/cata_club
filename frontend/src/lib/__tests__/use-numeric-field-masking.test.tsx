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

function renderPhoneMasking() {
  const onChange = vi.fn();
  const { result } = renderHook(() => useNumericFieldMasking("phone", onChange));
  return { result, onChange };
}

describe("useNumericFieldMasking — phone normalizes before the digit cap (issue #855)", () => {
  it("normalizes an autofilled +593 value on the onChange backstop instead of truncating it", () => {
    const { result, onChange } = renderPhoneMasking();

    act(() => result.current.onChange("+593991234567"));

    expect(onChange).toHaveBeenCalledWith("0991234567");
    expect(result.current.limitReached).toBe(false);
  });

  it("normalizes an autofilled 593 value (no plus sign) the same way", () => {
    const { result, onChange } = renderPhoneMasking();

    act(() => result.current.onChange("593991234567"));

    expect(onChange).toHaveBeenCalledWith("0991234567");
    expect(result.current.limitReached).toBe(false);
  });

  it("normalizes a pasted +593 value with the typing separators an autofill can include", () => {
    const { result, onChange } = renderPhoneMasking();

    act(() =>
      result.current.onPaste({
        preventDefault: () => {},
        clipboardData: { getData: () => "+593 99 123 4567" },
        currentTarget: { value: "", selectionStart: 0, selectionEnd: 0 },
      } as unknown as React.ClipboardEvent<HTMLInputElement>),
    );

    expect(onChange).toHaveBeenCalledWith("0991234567");
    expect(result.current.limitReached).toBe(false);
  });

  it("still passes a manually-typed local 09 value through untouched", () => {
    const { result, onChange } = renderPhoneMasking();

    act(() => result.current.onChange("0991234567"));

    expect(onChange).toHaveBeenCalledWith("0991234567");
    expect(result.current.limitReached).toBe(false);
  });

  it("still caps a manually-typed over-length LOCAL value and warns — normalization never widens the cap", () => {
    const { result, onChange } = renderPhoneMasking();

    act(() => result.current.onChange("09912345678")); // 11 digits, not an international shape

    expect(onChange).toHaveBeenCalledWith("0991234567");
    expect(result.current.limitReached).toBe(true);
  });

  it("still preserves separators on a locally-formatted value — normalization never rewrites a non-matching number", () => {
    const { result, onChange } = renderPhoneMasking();

    act(() => result.current.onChange("099-123-4567"));

    expect(onChange).toHaveBeenCalledWith("099-123-4567");
    expect(result.current.limitReached).toBe(false);
  });

  it("still passes a letter-containing value through unfiltered on the onChange backstop", () => {
    const { result, onChange } = renderPhoneMasking();

    act(() => result.current.onChange("099abc1234"));

    expect(onChange).toHaveBeenCalledWith("099abc1234");
  });

  it("leaves a fijo untouched — the international mapping is mobile-only", () => {
    const { result, onChange } = renderPhoneMasking();

    act(() => result.current.onPaste({
      preventDefault: () => {},
      clipboardData: { getData: () => "022345678" },
      currentTarget: { value: "", selectionStart: 0, selectionEnd: 0 },
    } as unknown as React.ClipboardEvent<HTMLInputElement>));

    expect(onChange).toHaveBeenCalledWith("022345678");
  });

  it("never applies the international mobile mapping to cedula mode", () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useNumericFieldMasking("cedula", onChange));

    act(() =>
      result.current.onPaste({
        preventDefault: () => {},
        clipboardData: { getData: () => "+593991234567" },
        currentTarget: { value: "", selectionStart: 0, selectionEnd: 0 },
      } as unknown as React.ClipboardEvent<HTMLInputElement>),
    );

    // Cedula strips everything non-digit (including "+") and caps at 10 —
    // the phone-only international-to-local mapping never runs here, so the
    // result is the plain digit cap, NOT "0991234567".
    expect(onChange).toHaveBeenCalledWith("5939912345");
  });
});
