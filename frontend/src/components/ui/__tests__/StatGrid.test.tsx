/**
 * StatGrid — the count grid that replaces a sentence like
 * "17 presente • 4 ausente • 4 tardanza • 4 justificado", where four values
 * hide inside a sentence and have to be READ instead of seen.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import StatGrid, { type StatGridItem } from "@/components/ui/StatGrid";

const ATTENDANCE: StatGridItem[] = [
  { label: "Presente", value: 17, tone: "ok" },
  { label: "Ausente", value: 4, tone: "bad" },
  { label: "Tardanza", value: 4, tone: "warn" },
  { label: "Justificado", value: 4, tone: "neutral" },
];

describe("StatGrid — content", () => {
  it("renders every value and its label", () => {
    render(<StatGrid items={ATTENDANCE} />);
    expect(screen.getByText("17")).toBeInTheDocument();
    expect(screen.getByText("Presente")).toBeInTheDocument();
    // Three items share the value "4" (Ausente, Tardanza, Justificado).
    expect(screen.getAllByText("4", { selector: "span" })).toHaveLength(3);
    expect(screen.getByText("Ausente")).toBeInTheDocument();
    expect(screen.getByText("Tardanza")).toBeInTheDocument();
    expect(screen.getByText("Justificado")).toBeInTheDocument();
  });

  it("boxes every value — the rule that started this whole component family", () => {
    render(<StatGrid items={ATTENDANCE} />);
    expect(screen.getByText("17")).toHaveClass("bg-sunken", "border-line");
  });
});

describe("StatGrid — the number is never a judgment, only the category is", () => {
  it("keeps every value in ink, whatever its category's tone", () => {
    render(<StatGrid items={ATTENDANCE} />);
    for (const value of ["17", "4"]) {
      for (const el of screen.getAllByText(value)) {
        expect(el.className).not.toMatch(/text-(state-|cata-red|ball)/);
      }
    }
  });

  it("colors the category label instead — ok/bad/warn/neutral, the same pairs Badge uses", () => {
    render(<StatGrid items={ATTENDANCE} />);
    expect(screen.getByText("Presente")).toHaveClass("text-state-ok");
    expect(screen.getByText("Ausente")).toHaveClass("text-state-bad");
    expect(screen.getByText("Tardanza")).toHaveClass("text-state-warn");
    expect(screen.getByText("Justificado")).toHaveClass("text-ink-2");
  });

  it("gives every label a colored dot that carries the same tone, out of the accessibility tree", () => {
    render(<StatGrid items={ATTENDANCE} />);
    const presente = screen.getByText("Presente").closest("span") as HTMLElement;
    const dot = presente.querySelector("span[aria-hidden='true']");
    expect(dot).not.toBeNull();
    expect(dot).toHaveClass("bg-current");
  });
});

describe("StatGrid — shows all four, not a truncated subset", () => {
  it("renders exactly as many cells as items given", () => {
    render(<StatGrid items={ATTENDANCE} />);
    expect(screen.getAllByText(/Presente|Ausente|Tardanza|Justificado/)).toHaveLength(4);
  });
});
