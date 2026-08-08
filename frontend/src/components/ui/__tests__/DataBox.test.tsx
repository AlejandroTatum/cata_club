/**
 * DataBox — the box every standalone value sits in (age in a list, a count in
 * a table cell, a stat in the attendance grid). A number never floats as bare
 * text; it lives here.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import DataBox from "@/components/ui/DataBox";
import { committedRadius, RADIUS_TOKENS } from "./ui-test-utils";

describe("DataBox — default variant", () => {
  it("renders its value", () => {
    render(<DataBox>32 años</DataBox>);
    expect(screen.getByText("32 años")).toBeInTheDocument();
  });

  it("wears the sunken fill, the line border and ink-2 text", () => {
    render(<DataBox>32 años</DataBox>);
    expect(screen.getByText("32 años")).toHaveClass("bg-sunken", "border-line", "text-ink-2");
  });

  it("uses the 3px corner, not the card or control radius", () => {
    // There is no named 3px token — `rounded-card` is 14px and `rounded-ctl`
    // is 10px (see `RADIUS_TOKENS`) — so this is deliberately an arbitrary
    // value, and `committedRadius` (which only resolves NAMED tokens) would
    // resolve to `undefined` here and prove nothing. The exact class is the
    // only faithful assertion of the box's own 3px scale.
    render(<DataBox>32 años</DataBox>);
    expect(screen.getByText("32 años")).toHaveClass("rounded-[3px]");
    expect(committedRadius(screen.getByText("32 años"))).toBeUndefined();
    expect(RADIUS_TOKENS.card).not.toBe("3px");
    expect(RADIUS_TOKENS.ctl).not.toBe("3px");
  });

  it("does not wear the numeric treatment", () => {
    render(<DataBox>32 años</DataBox>);
    const box = screen.getByText("32 años");
    expect(box.className).not.toMatch(/font-mono|tabular-nums/);
  });
});

describe("DataBox — numeric variant", () => {
  it("switches to a monospaced, tabular-nums, centered figure in ink", () => {
    render(<DataBox variant="numeric">86</DataBox>);
    const box = screen.getByText("86");
    expect(box).toHaveClass("font-mono", "tabular-nums", "text-ink", "justify-center");
  });

  it("keeps the box's own fill and border — the variant changes the figure, not the box", () => {
    render(<DataBox variant="numeric">86</DataBox>);
    expect(screen.getByText("86")).toHaveClass("bg-sunken", "border-line", "rounded-[3px]");
  });

  it("carries a minimum width so single- and double-digit values line up", () => {
    render(<DataBox variant="numeric">7</DataBox>);
    expect(screen.getByText("7").className).toMatch(/min-w-/);
  });

  it("never colors the figure — StatCard's own rule: a number is ink, never a judgment", () => {
    render(<DataBox variant="numeric">86</DataBox>);
    expect(screen.getByText("86").className).not.toMatch(/text-(state-|cata-red|ball)/);
  });
});

describe("DataBox — passthrough", () => {
  it("accepts an extra className without dropping the base classes", () => {
    render(<DataBox className="ml-2">32 años</DataBox>);
    expect(screen.getByText("32 años")).toHaveClass("ml-2", "bg-sunken");
  });

  it("is readable as plain text content — the accessible name is the value itself", () => {
    render(<DataBox>17</DataBox>);
    expect(screen.getByText("17").textContent).toBe("17");
  });
});
