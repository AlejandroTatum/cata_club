/**
 * Component tests for `WizardInput`'s `numericMode` — the cédula/teléfono
 * keystroke and paste filtering shared by all three signup wizards.
 *
 * Issue #225: a bare `maxLength={10}` on cédula let the browser eat an 11th
 * digit with no explanation. The fix here still caps the field at 10 (a
 * later QA request: "no puede tipear 11"), but the cap is never silent — a
 * visible, `aria-live` warning fires the moment a keystroke is rejected for
 * being over the limit. A disallowed CHARACTER (a letter) is rejected with
 * no warning at all: it was never a valid input to begin with, unlike a
 * legitimate 11th digit.
 *
 * `capDigits` (the `onChange` backstop, used for a value set by a path
 * `keydown`/`paste` never sees) deliberately does NOT strip letters — see
 * `numeric-input.ts`'s doc comment. `enroll-qa.spec.ts`'s V01 depends on
 * that: a phone value assigned in one shot (Playwright's `.fill()`) must
 * still reach validation with its letters intact, so the existing
 * "solo puede contener dígitos y separadores" message keeps firing from the
 * validation layer, not from a field that already erased the evidence.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WizardInput } from "../wizard-fields";

function renderCedula(value = "") {
  const onChange = vi.fn();
  render(
    <WizardInput
      idPrefix="t"
      label="Cédula de Identidad"
      value={value}
      onChange={onChange}
      disabled={false}
      numericMode="cedula"
    />,
  );
  return { input: screen.getByLabelText(/cédula de identidad/i) as HTMLInputElement, onChange };
}

function renderPhone(value = "") {
  const onChange = vi.fn();
  render(
    <WizardInput
      idPrefix="t"
      label="Teléfono"
      value={value}
      onChange={onChange}
      disabled={false}
      numericMode="phone"
    />,
  );
  return { input: screen.getByLabelText(/teléfono/i) as HTMLInputElement, onChange };
}

describe("WizardInput — numericMode blocks a typed letter (keydown)", () => {
  it("prevents the default insertion for a letter key on a cédula field", () => {
    const { input, onChange } = renderCedula();
    const notCancelled = fireEvent.keyDown(input, { key: "a" });
    expect(notCancelled).toBe(false); // false === preventDefault() was called
    expect(onChange).not.toHaveBeenCalled();
  });

  it("prevents the default insertion for a letter key on a teléfono field", () => {
    const { input, onChange } = renderPhone();
    const notCancelled = fireEvent.keyDown(input, { key: "b" });
    expect(notCancelled).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("lets a digit key through untouched", () => {
    const { input } = renderCedula();
    const notCancelled = fireEvent.keyDown(input, { key: "5" });
    expect(notCancelled).toBe(true);
  });

  it("lets an allowed teléfono separator through", () => {
    const { input } = renderPhone();
    expect(fireEvent.keyDown(input, { key: "-" })).toBe(true);
  });

  it("still blocks a separator on cédula — it never tolerates them", () => {
    const { input } = renderCedula();
    expect(fireEvent.keyDown(input, { key: "-" })).toBe(false);
  });

  it("never blocks Backspace, Tab or arrow keys", () => {
    const { input } = renderCedula("123");
    expect(fireEvent.keyDown(input, { key: "Backspace" })).toBe(true);
    expect(fireEvent.keyDown(input, { key: "Tab" })).toBe(true);
    expect(fireEvent.keyDown(input, { key: "ArrowLeft" })).toBe(true);
  });

  it("never blocks a Ctrl/Cmd shortcut even if the key looks like a letter (Ctrl+V, Ctrl+A)", () => {
    const { input } = renderCedula();
    expect(fireEvent.keyDown(input, { key: "v", ctrlKey: true })).toBe(true);
    expect(fireEvent.keyDown(input, { key: "a", metaKey: true })).toBe(true);
  });
});

describe("WizardInput — numericMode strips letters on paste", () => {
  function paste(input: HTMLInputElement, text: string) {
    return fireEvent.paste(input, {
      clipboardData: { getData: () => text },
    });
  }

  it("strips letters from pasted cédula text and reports the filtered value", () => {
    const { input, onChange } = renderCedula();
    const notCancelled = paste(input, "17ab345678");
    expect(notCancelled).toBe(false); // the raw paste is prevented — we set the filtered value ourselves
    expect(onChange).toHaveBeenCalledWith("17345678");
  });

  it("strips letters from a pasted teléfono while keeping allowed separators", () => {
    const { input, onChange } = renderPhone();
    paste(input, "099abc-123-4567");
    expect(onChange).toHaveBeenCalledWith("099-123-4567");
  });

  it("caps a pasted value that is over the digit limit", () => {
    const { input, onChange } = renderCedula();
    paste(input, "17123456789");
    expect(onChange).toHaveBeenCalledWith("1712345678");
  });
});

describe("WizardInput — the digit cap warns instead of silently truncating", () => {
  it("blocks the 11th digit typed at the cédula cap and shows an aria-live warning", () => {
    const { input } = renderCedula("1234567890"); // already 10 digits
    const notCancelled = fireEvent.keyDown(input, { key: "1" });
    expect(notCancelled).toBe(false);

    const warning = screen.getByText(/alcanzó el máximo de 10 dígitos/i);
    expect(warning).toBeInTheDocument();
    expect(warning.closest("[aria-live]")).toHaveAttribute("aria-live", "polite");
  });

  it("does not warn while still under the cap", () => {
    const { input } = renderCedula("123");
    fireEvent.keyDown(input, { key: "4" });
    expect(screen.queryByText(/alcanzó el máximo/i)).not.toBeInTheDocument();
  });

  it("also caps — and warns about — a value set in one shot (onChange backstop)", () => {
    const { input, onChange } = renderCedula();
    fireEvent.change(input, { target: { value: "17123456789" } });
    expect(onChange).toHaveBeenCalledWith("1712345678");
    expect(screen.getByText(/alcanzó el máximo de 10 dígitos/i)).toBeInTheDocument();
  });
});

describe("WizardInput — the onChange backstop caps digits but never strips letters", () => {
  // This is the load-bearing case for V01 (enroll-qa.spec.ts): a value
  // assigned in one shot — as Playwright's `.fill()` does — must reach
  // `onChange` with its letters intact, so the existing character-class
  // validation error still fires from the validation layer.
  it("passes a letter-containing teléfono value through unfiltered", () => {
    const { input, onChange } = renderPhone();
    fireEvent.change(input, { target: { value: "099abc1234" } });
    expect(onChange).toHaveBeenCalledWith("099abc1234");
  });

  it("leaves a formatted 10-digit teléfono value untouched even with separators", () => {
    const { input, onChange } = renderPhone();
    fireEvent.change(input, { target: { value: "099-123-4567" } });
    expect(onChange).toHaveBeenCalledWith("099-123-4567");
  });
});

describe("WizardInput — plain fields are unaffected by numericMode's absence", () => {
  it("passes every keystroke and change through untouched when numericMode is not set", () => {
    const onChange = vi.fn();
    render(
      <WizardInput idPrefix="t" label="Nombres" value="" onChange={onChange} disabled={false} />,
    );
    const input = screen.getByLabelText(/nombres/i);
    expect(fireEvent.keyDown(input, { key: "a" })).toBe(true);
    fireEvent.change(input, { target: { value: "Ana" } });
    expect(onChange).toHaveBeenCalledWith("Ana");
  });
});
