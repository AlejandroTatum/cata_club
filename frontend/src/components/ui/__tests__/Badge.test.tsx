/**
 * Badge — 26px pill with a dot. This is the one place in the system where
 * color is allowed to carry meaning.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Badge, { type BadgeTone } from "@/components/ui/Badge";
import { committedHeight } from "./ui-test-utils";

function renderBadge(tone?: BadgeTone, label = "Activa"): HTMLElement {
  render(<Badge tone={tone}>{label}</Badge>);
  return screen.getByText(label);
}

describe("Badge — committed dimensions", () => {
  it("is 26px tall", () => {
    expect(committedHeight(renderBadge())).toBe("26px");
  });

  it("stays 26px in every tone", () => {
    for (const tone of ["neutral", "ok", "warn", "bad"] as const) {
      const { unmount } = render(<Badge tone={tone}>Estado</Badge>);
      expect(committedHeight(screen.getByText("Estado"))).toBe("26px");
      unmount();
    }
  });
});

describe("Badge — tones", () => {
  it("defaults to the neutral state pair", () => {
    expect(renderBadge()).toHaveClass("bg-state-neutral-bg", "text-state-neutral");
  });

  it("maps ok / warn / bad onto their state pairs", () => {
    const cases: Array<[BadgeTone, string, string]> = [
      ["ok", "bg-state-ok-bg", "text-state-ok"],
      ["warn", "bg-state-warn-bg", "text-state-warn"],
      ["bad", "bg-state-bad-bg", "text-state-bad"],
    ];
    for (const [tone, bg, fg] of cases) {
      const { unmount } = render(<Badge tone={tone}>Estado</Badge>);
      expect(screen.getByText("Estado")).toHaveClass(bg, fg);
      unmount();
    }
  });
});

describe("Badge — dot", () => {
  it("renders a decorative dot that inherits the tone color", () => {
    const badge = renderBadge("ok");
    const dot = badge.querySelector("span[aria-hidden='true']");
    expect(dot).not.toBeNull();
    expect(dot).toHaveClass("bg-current", "rounded-full");
  });

  it("keeps the dot out of the accessibility tree", () => {
    // The dot is redundant with the label; announcing it would be noise.
    expect(renderBadge("bad").querySelector("span")).toHaveAttribute("aria-hidden", "true");
  });
});
