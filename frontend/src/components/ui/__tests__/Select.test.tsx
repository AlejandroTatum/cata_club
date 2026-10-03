/**
 * @vitest-environment jsdom
 */

import { createRef } from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Select } from "@/components/ui";

describe("Select", () => {
  it("is still a native, labelled select", () => {
    render(
      <>
        <label htmlFor="s">Tipo de sangre</label>
        <Select id="s" required defaultValue="">
          <option value="">Seleccione una opción</option>
          <option value="O_POSITIVO">O+</option>
        </Select>
      </>,
    );

    const select = screen.getByLabelText("Tipo de sangre");
    expect(select.tagName).toBe("SELECT");
    expect(select).toBeRequired();
  });

  it("wears the input-field skin without the native chevron", () => {
    render(
      <Select aria-label="Mes" className="border-state-bad">
        <option value="">Mes</option>
      </Select>,
    );

    const select = screen.getByLabelText("Mes");
    expect(select.className).toMatch(/\binput-field\b/);
    expect(select.className).toMatch(/\bappearance-none\b/);
    expect(select.className).toMatch(/\bborder-state-bad\b/);
  });

  it("hides the decorative chevron from assistive technology", () => {
    const { container } = render(<Select aria-label="Mes" />);

    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("forwards its ref and change events", () => {
    const ref = createRef<HTMLSelectElement>();
    const onChange = vi.fn();
    render(
      <Select ref={ref} aria-label="Mes" onChange={onChange}>
        <option value="01">Enero</option>
        <option value="02">Febrero</option>
      </Select>,
    );

    fireEvent.change(screen.getByLabelText("Mes"), { target: { value: "02" } });

    expect(ref.current).toBe(screen.getByLabelText("Mes"));
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
