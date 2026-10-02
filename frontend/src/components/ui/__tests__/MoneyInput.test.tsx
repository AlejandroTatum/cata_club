import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MoneyInput } from "@/components/ui";

describe("MoneyInput", () => {
  it("draws an aria-hidden $ and keeps the input labelled", () => {
    const { container } = render(
      <label>
        Precio
        <MoneyInput defaultValue="10" />
      </label>,
    );
    const input = screen.getByLabelText(/^Precio/);
    expect(input).toHaveAttribute("inputmode", "decimal");
    const glyph = container.querySelector('[aria-hidden="true"]');
    expect(glyph).toHaveTextContent("$");
    expect(input.className).toContain("pl-7");
  });

  it("supports a trailing % adornment", () => {
    render(<MoneyInput aria-label="Valor" symbol="%" symbolPosition="end" />);
    expect(screen.getByLabelText("Valor").className).toContain("pr-7");
    expect(screen.getByText("%")).toHaveAttribute("aria-hidden", "true");
  });
});
