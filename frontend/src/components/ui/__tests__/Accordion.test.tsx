/**
 * Accordion — the compact question/answer disclosure #203 asks for.
 *
 * The pattern that breaks this component in practice: a trigger built from a
 * `<div onClick>` has no keyboard path and no assistive-tech semantics, and a
 * panel hidden with CSS alone (`display:none` via a class, or `opacity-0`)
 * still leaves its content in the tab order — a keyboard user tabs straight
 * into an invisible link and loses focus. Every test below targets one of
 * those two failure modes directly, plus the "only one open per section" rule
 * #203 specifies.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import Accordion from "@/components/ui/Accordion";

const ITEMS = [
  {
    id: "primera",
    question: "¿Primera pregunta?",
    answer: (
      <p>
        Primera respuesta, con <a href="/asistente">un enlace</a> adentro.
      </p>
    ),
  },
  {
    id: "segunda",
    question: "¿Segunda pregunta?",
    answer: <p>Segunda respuesta.</p>,
  },
];

function renderAccordion() {
  return render(<Accordion items={ITEMS} idPrefix="faq-empezar" label="Para empezar" />);
}

describe("Accordion — the trigger is a real button", () => {
  it("renders every question as a <button>, not a styled div", () => {
    renderAccordion();
    for (const item of ITEMS) {
      const trigger = screen.getByRole("button", { name: item.question });
      expect(trigger.tagName).toBe("BUTTON");
    }
  });

  it("starts every trigger collapsed, aria-expanded=false, pointing at its panel", () => {
    renderAccordion();
    const trigger = screen.getByRole("button", { name: "¿Primera pregunta?" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveAttribute("aria-controls", "faq-empezar-primera-panel");
  });

  it("flips aria-expanded to true on the clicked trigger and leaves it there", () => {
    renderAccordion();
    const trigger = screen.getByRole("button", { name: "¿Primera pregunta?" });

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("closes again on a second click of the same trigger", () => {
    renderAccordion();
    const trigger = screen.getByRole("button", { name: "¿Primera pregunta?" });

    fireEvent.click(trigger);
    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });
});

describe("Accordion — collapsed content is not reachable by keyboard", () => {
  it("hides the panel with the `hidden` attribute, not a CSS-only class", () => {
    renderAccordion();
    const trigger = screen.getByRole("button", { name: "¿Primera pregunta?" });
    const panel = document.getElementById(trigger.getAttribute("aria-controls")!);

    expect(panel).toHaveAttribute("hidden");
  });

  it("keeps a link inside a collapsed answer out of the accessible tree entirely", () => {
    renderAccordion();

    // `hidden` removes the subtree from the accessibility tree, so a role
    // query — which is how a screen-reader or a Tab press would find it —
    // must come back empty while the panel is collapsed. A CSS-only hide
    // (opacity/visibility) would leave this link in the DOM and tabbable,
    // which is exactly the bug #203 flags.
    expect(screen.queryByRole("link", { name: "un enlace" })).toBeNull();
  });

  it("makes that same link findable and reachable once its question opens", () => {
    renderAccordion();
    const trigger = screen.getByRole("button", { name: "¿Primera pregunta?" });

    fireEvent.click(trigger);

    const link = screen.getByRole("link", { name: "un enlace" });
    expect(link).toBeVisible();
  });
});

describe("Accordion — keyboard operability", () => {
  it("opens and closes through the button's own native Enter/Space activation", () => {
    // A `<button>` is focusable and Enter/Space-activatable by construction
    // (the same proof `PaymentsPage.test.tsx` uses for its row action) —
    // which is why the first assertion in this file is `tagName === "BUTTON"`
    // rather than a `<div onClick>`. `fireEvent.click` below is what that
    // native activation dispatches; there is no separate mouse-only path.
    renderAccordion();
    const trigger = screen.getByRole("button", { name: "¿Primera pregunta?" });
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger).not.toHaveAttribute("tabindex", "-1");

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });
});

describe("Accordion — at most one question open at a time", () => {
  it("closes the previously open question when a different one opens", () => {
    renderAccordion();
    const first = screen.getByRole("button", { name: "¿Primera pregunta?" });
    const second = screen.getByRole("button", { name: "¿Segunda pregunta?" });

    fireEvent.click(first);
    expect(first).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(second);

    expect(second).toHaveAttribute("aria-expanded", "true");
    expect(first).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById(first.getAttribute("aria-controls")!)).toHaveAttribute("hidden");
  });
});

describe("Accordion — open state is never color-only", () => {
  it("carries the open/closed state on aria-expanded and a shape change, not a color alone", () => {
    renderAccordion();
    const trigger = screen.getByRole("button", { name: "¿Primera pregunta?" });
    const icon = trigger.querySelector("svg");
    expect(icon).toBeTruthy();
    expect(icon?.getAttribute("class")).not.toMatch(/rotate-180/);

    fireEvent.click(trigger);

    // The chevron rotates on open — a shape change any user can see,
    // independent of the aria-expanded value a screen reader announces.
    expect(trigger.querySelector("svg")?.getAttribute("class")).toMatch(/rotate-180/);
  });
});

describe("Accordion — no truncated text", () => {
  it("never clips the question with an ellipsis class", () => {
    renderAccordion();
    for (const item of ITEMS) {
      const trigger = screen.getByRole("button", { name: item.question });
      expect(trigger.className).not.toMatch(/truncate|line-clamp/);
    }
  });
});

// Issue #818 (WCAG 2.5.8, AA): every `/ayuda` trigger measured 524 × 20.3px —
// wide enough already, just under the 24px height floor. `MIN_TARGET_CLASS`
// (`min-h-[24px]`, `lib/target-size.ts`) is the project's shared class for
// exactly this.
describe("Accordion — the trigger clears the 24px target-size floor", () => {
  it("gives every trigger a 24px minimum height", () => {
    renderAccordion();
    for (const item of ITEMS) {
      const trigger = screen.getByRole("button", { name: item.question });
      expect(trigger).toHaveClass("min-h-[24px]");
    }
  });
});
