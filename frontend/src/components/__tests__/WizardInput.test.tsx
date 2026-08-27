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

function renderAmount(value = "") {
  const onChange = vi.fn();
  render(
    <WizardInput
      idPrefix="t"
      label="Precio"
      value={value}
      onChange={onChange}
      disabled={false}
      numericMode="amount"
    />,
  );
  return { input: screen.getByLabelText(/precio/i) as HTMLInputElement, onChange };
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

describe("WizardInput — numericMode blocks a second decimal separator on amount (keydown)", () => {
  it("lets a digit and the first decimal point through", () => {
    const { input } = renderAmount("45");
    expect(fireEvent.keyDown(input, { key: "." })).toBe(true);
  });

  it("blocks a second decimal point and warns", () => {
    const { input } = renderAmount("45.5");
    const notCancelled = fireEvent.keyDown(input, { key: "." });
    expect(notCancelled).toBe(false);
    expect(screen.getByText(/alcanzó el máximo/i)).toBeInTheDocument();
  });

  it("blocks a 3rd decimal digit past the cents cap", () => {
    const { input } = renderAmount("45.67"); // 2 decimal digits already
    expect(fireEvent.keyDown(input, { key: "8" })).toBe(false);
  });

  it("blocks a letter on an amount field", () => {
    const { input, onChange } = renderAmount();
    expect(fireEvent.keyDown(input, { key: "a" })).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
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

  it("strips a currency symbol from a pasted amount", () => {
    const { input, onChange } = renderAmount();
    paste(input, "$45.00");
    expect(onChange).toHaveBeenCalledWith("45.00");
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

/**
 * Issue #661: the credentials step of every wizard (`crear-cuenta`,
 * `add-dependent`, `enroll`) masks its password field with no way to
 * temporarily reveal it. The toggle lifts the pattern already shipped and
 * tested on `/login` and `/reset-password` verbatim — same `aria-label`
 * wording, same real `<button type="button">`, same masked-by-default
 * start — rather than inventing a second one. It is keyed off
 * `type="password"`: every real caller already passes that, so no caller
 * needs a new prop, and a plain text field never grows a toggle it never
 * asked for.
 */
describe("WizardInput — password reveal toggle (issue #661)", () => {
  function renderPassword(value = "") {
    const onChange = vi.fn();
    render(
      <WizardInput
        idPrefix="t"
        label="Contraseña"
        value={value}
        onChange={onChange}
        disabled={false}
        type="password"
        // Every real caller (crear-cuenta, add-dependent, enroll) marks its
        // password field required — `required` keeps the accessible name
        // exactly "Contraseña" (the asterisk span is `aria-hidden`), rather
        // than growing the "(opcional)" marker the optional-field style adds.
        required
      />,
    );
    return {
      // Anchored to the start: the label's own text is "Contraseña *", and a
      // bare `/contraseña/i` would also match the toggle button's own
      // `aria-label` ("Mostrar/Ocultar contraseña"), which contains the same
      // word but never starts with it.
      input: screen.getByLabelText(/^contraseña/i) as HTMLInputElement,
      onChange,
    };
  }

  it("masks the field by default", () => {
    const { input } = renderPassword("secreto8");
    expect(input).toHaveAttribute("type", "password");
  });

  it("exposes a real, focusable button with a dynamic aria-label", () => {
    renderPassword();
    const toggle = screen.getByRole("button", { name: "Mostrar contraseña" });
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle).toHaveAttribute("type", "button");
  });

  it("flips the input's type and the button's label when clicked", () => {
    const { input } = renderPassword("secreto8");
    const toggle = screen.getByRole("button", { name: "Mostrar contraseña" });

    fireEvent.click(toggle);

    expect(input).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Ocultar contraseña" })).toBe(toggle);
  });

  it("re-masks on a second click", () => {
    const { input } = renderPassword("secreto8");
    const toggle = screen.getByRole("button", { name: "Mostrar contraseña" });

    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "Ocultar contraseña" }));

    expect(input).toHaveAttribute("type", "password");
  });

  it("keeps the value and caret position across the toggle — no onChange fires and no value is lost", () => {
    const { input, onChange } = renderPassword("secreto8");
    input.setSelectionRange(3, 3);

    fireEvent.click(screen.getByRole("button", { name: "Mostrar contraseña" }));

    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe("secreto8");
    expect(input.selectionStart).toBe(3);
    expect(input.selectionEnd).toBe(3);
  });

  it("keeps the input before the toggle button in the DOM, preserving Tab order", () => {
    renderPassword();
    const input = screen.getByLabelText(/^contraseña/i);
    const toggle = screen.getByRole("button", { name: "Mostrar contraseña" });
    // The button must come after the input in source order for a plain Tab
    // to reach it next — DOCUMENT_POSITION_FOLLOWING = 4.
    expect(input.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("never grows a toggle on a non-password field", () => {
    render(
      <WizardInput idPrefix="t" label="Nombres" value="" onChange={vi.fn()} disabled={false} />,
    );
    expect(screen.queryByRole("button", { name: /contraseña/i })).not.toBeInTheDocument();
  });
});
