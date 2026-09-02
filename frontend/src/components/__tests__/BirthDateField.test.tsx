/**
 * Component tests for `BirthDateField` — the Día/Mes/Año guided replacement
 * for the birth-date `<input type="date">` (issue #853).
 *
 * On some mobile browsers the native date picker only steps month by month,
 * so entering a birth date a few decades back could take roughly 480 taps —
 * desktop was never affected. The fix keeps the field's external contract
 * exactly what `WizardInput type="date"` already had: it still emits the
 * ISO `YYYY-MM-DD` string every caller's own validation checks, and an
 * empty/partial/impossible date emits `""`, the same as an empty native
 * field did — so `studentBirthDateRule`, `crear-cuenta-utils` and
 * `enroll-utils` keep firing unchanged.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { BirthDateField, type BirthDateFieldProps } from "../wizard-fields";

function renderField(overrides: Partial<BirthDateFieldProps> = {}) {
  const onChange = overrides.onChange ?? vi.fn();
  render(
    <BirthDateField
      idPrefix="t"
      label="Fecha de nacimiento"
      value=""
      onChange={onChange}
      disabled={false}
      {...overrides}
    />,
  );
  return {
    day: screen.getByLabelText(/^Día/) as HTMLInputElement,
    month: screen.getByLabelText(/^Mes/) as HTMLSelectElement,
    year: screen.getByLabelText(/^Año/) as HTMLInputElement,
    onChange,
  };
}

describe("BirthDateField — emits the ISO value only for a real calendar date", () => {
  it.each([
    ["a complete real date", "15", "03", "1986", "1986-03-15"],
    ["Feb 31, which does not exist in any year", "31", "02", "2024", ""],
    ["Feb 29 on a leap year", "29", "02", "2024", "2024-02-29"],
    ["Feb 29 on a non-leap year", "29", "02", "2023", ""],
    ["Apr 31, which does not exist (30-day month)", "31", "04", "2020", ""],
  ])("%s", (_description, day, month, year, expectedIso) => {
    const { day: dayInput, month: monthInput, year: yearInput, onChange } = renderField();
    fireEvent.change(dayInput, { target: { value: day } });
    fireEvent.change(monthInput, { target: { value: month } });
    fireEvent.change(yearInput, { target: { value: year } });
    expect(onChange).toHaveBeenLastCalledWith(expectedIso);
  });

  it("emits an empty string while any part is still missing", () => {
    const { day, month, onChange } = renderField();
    fireEvent.change(day, { target: { value: "15" } });
    fireEvent.change(month, { target: { value: "03" } });
    expect(onChange).toHaveBeenLastCalledWith("");
  });

  it("emits an empty string while the year is still incomplete", () => {
    const { day, month, year, onChange } = renderField();
    fireEvent.change(day, { target: { value: "15" } });
    fireEvent.change(month, { target: { value: "03" } });
    fireEvent.change(year, { target: { value: "198" } });
    expect(onChange).toHaveBeenLastCalledWith("");
  });

  it("caps the day at 2 digits and the year at 4, ignoring non-digit characters", () => {
    const { day, year, onChange } = renderField();
    fireEvent.change(day, { target: { value: "1a5c" } });
    expect(day.value).toBe("15");
    fireEvent.change(year, { target: { value: "19a8b6c" } });
    expect(year.value).toBe("1986");
    expect(onChange).not.toHaveBeenCalledWith(expect.stringContaining("a"));
  });
});

describe("BirthDateField — an initial ISO value populates the three parts", () => {
  it("splits value=\"2015-06-15\" into day/month/year on mount", () => {
    const { day, month, year } = renderField({ value: "2015-06-15" });
    expect(day.value).toBe("15");
    expect(month.value).toBe("06");
    expect(year.value).toBe("2015");
  });

  it("resyncs the three parts when the value prop changes externally (a restored draft)", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <BirthDateField idPrefix="t" label="Fecha de nacimiento" value="" onChange={onChange} disabled={false} />,
    );
    rerender(
      <BirthDateField idPrefix="t" label="Fecha de nacimiento" value="1998-03-20" onChange={onChange} disabled={false} />,
    );
    expect((screen.getByLabelText(/^Día/) as HTMLInputElement).value).toBe("20");
    expect((screen.getByLabelText(/^Mes/) as HTMLSelectElement).value).toBe("03");
    expect((screen.getByLabelText(/^Año/) as HTMLInputElement).value).toBe("1998");
  });
});

describe("BirthDateField — one labelled group, not three unrelated fields", () => {
  it("names the group with the field's own label", () => {
    renderField();
    expect(screen.getByRole("group", { name: /^Fecha de nacimiento/ })).toBeInTheDocument();
  });

  it("exposes the hint via aria-describedby on the group", () => {
    renderField({ hint: "Día, mes y año de cuatro dígitos (por ejemplo, 15 marzo 2015)." });
    const group = screen.getByRole("group", { name: /^Fecha de nacimiento/ });
    const describedBy = group.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)?.textContent).toMatch(/cuatro dígitos/i);
  });

  it("exposes the error and marks the group invalid instead of the hint", () => {
    renderField({
      error: "La fecha de nacimiento ingresada no es válida.",
      hint: "Día, mes y año de cuatro dígitos (por ejemplo, 15 marzo 2015).",
    });
    const group = screen.getByRole("group", { name: /^Fecha de nacimiento/ });
    expect(group).toHaveAttribute("aria-invalid", "true");
    const describedBy = group.getAttribute("aria-describedby") as string;
    expect(document.getElementById(describedBy)?.textContent).toMatch(/no es válida/i);
    expect(screen.queryByText(/cuatro dígitos/i)).not.toBeInTheDocument();
  });
});

describe("BirthDateField — inputMode and autofill tokens on each part", () => {
  it("marks día/año as numeric and carries the bday-* autofill tokens", () => {
    const { day, month, year } = renderField();
    expect(day).toHaveAttribute("inputMode", "numeric");
    expect(year).toHaveAttribute("inputMode", "numeric");
    expect(day).toHaveAttribute("autoComplete", "bday-day");
    expect(month).toHaveAttribute("autoComplete", "bday-month");
    expect(year).toHaveAttribute("autoComplete", "bday-year");
  });

  it("offers the twelve months in Spanish, direct selection — no month-stepping", () => {
    const { month } = renderField();
    const optionLabels = Array.from(month.options).map((o) => o.textContent);
    expect(optionLabels).toEqual([
      "Mes", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
      "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
    ]);
  });
});

describe("BirthDateField — keyboard", () => {
  it("keeps the source order Día → Mes → Año so a plain Tab reaches them in that order", () => {
    const { day, month, year } = renderField();
    expect(day.compareDocumentPosition(month) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(month.compareDocumentPosition(year) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("moves focus to Mes once Día carries 2 digits", () => {
    const { day, month } = renderField();
    fireEvent.change(day, { target: { value: "15" } });
    expect(month).toHaveFocus();
  });

  it("never moves focus back on Backspace", () => {
    const { day, month } = renderField({ value: "2015-06-15" });
    day.focus();
    fireEvent.change(day, { target: { value: "1" } });
    expect(month).not.toHaveFocus();
    expect(day).toHaveFocus();
  });
});

describe("BirthDateField — disabled and required propagate to the whole group", () => {
  it("disables every part when disabled", () => {
    const { day, month, year } = renderField({ disabled: true });
    expect(day).toBeDisabled();
    expect(month).toBeDisabled();
    expect(year).toBeDisabled();
  });

  it("marks the group aria-required when required", () => {
    renderField({ required: true });
    expect(screen.getByRole("group", { name: /^Fecha de nacimiento/ })).toHaveAttribute(
      "aria-required",
      "true",
    );
  });
});
