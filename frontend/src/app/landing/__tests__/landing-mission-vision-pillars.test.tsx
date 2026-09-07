/** @vitest-environment jsdom */

/**
 * Structural lock — the Mission/Vision v2 redesign (typographic pillars,
 * no photography). Replaces the photo/divider symmetry lock this section
 * used to need: the approved prototype
 * (`landing-mision-vision-v2-texto.html`) drops the editorial photos, the
 * centre divider and the shared-row subgrid entirely, so none of that DOM
 * shape exists to protect anymore.
 *
 * jsdom cannot lay out CSS Grid, so real geometry (the two-column layout,
 * the mobile stack) is out of scope here — this suite anchors only the DOM
 * shape: two `.landing-pillar` articles, each carrying its index, label,
 * heading, lead and body in order, and no image anywhere in the section.
 *
 * `data-reveal-together` (issue #1009) still matters: `LandingMotion.tsx`
 * reads it to skip the default reveal stagger between the two `data-reveal`
 * halves, and losing it is a silent regression no browser test would catch
 * as cheaply as this one does.
 */

// Registers next/image/LandingMap/LandingMotion mocks as a side effect — see
// the doc comment there for why that is safe under Vitest's hoisting. This
// MUST come before `LandingPage` (or anything that imports it) below: sibling
// imports evaluate in source order, so a later position here would let
// `LandingPage`'s own `next/image` import resolve to the real module first.
// This file must not declare its own `vi.mock` for any of those three paths.
import "./landing-render-mocks";
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import LandingPage from "@/app/landing/LandingPage";
import { resetLandingTestEnvironment, stubLandingGlobals } from "./landing-test-doubles";

beforeEach((): void => {
  stubLandingGlobals();
});

afterEach((): void => {
  resetLandingTestEnvironment();
});

describe("Mission/Vision pillars (v2 redesign)", (): void => {
  it("opts the section out of the default reveal stagger (issue #1009)", (): void => {
    const { container } = render(<LandingPage />);

    const section = container.querySelector("#nosotros");
    expect(section).not.toBeNull();
    expect(
      section?.hasAttribute("data-reveal-together"),
      "Mission and Vision are a symmetric pair, not a list — they must enter the reveal together",
    ).toBe(true);
  });

  it("renders exactly two pillars, each its own reveal target", (): void => {
    const { container } = render(<LandingPage />);

    const pillars = container.querySelectorAll("#nosotros .landing-pillar");
    expect(pillars).toHaveLength(2);
    pillars.forEach((pillar): void => {
      expect(pillar.hasAttribute("data-reveal")).toBe(true);
    });
  });

  it("carries index, label, heading, lead and body in that order, in each pillar", (): void => {
    const { container } = render(<LandingPage />);

    const [mission, vision] = Array.from(container.querySelectorAll("#nosotros .landing-pillar"));
    for (const pillar of [mission, vision]) {
      const children = Array.from(pillar.children);
      expect(children.map((child): string => child.tagName.toLowerCase())).toEqual(["span", "span", "h3", "p", "p"]);
      expect(children[0]).toHaveClass("landing-index");
      expect(children[1]).toHaveClass("landing-index-label");
      expect(children[3]).toHaveClass("landing-lead");
    }

    expect(mission.querySelector(".landing-index")?.textContent).toBe("01");
    expect(mission.querySelector(".landing-index-label")?.textContent).toBe("Propósito");
    expect(vision.querySelector(".landing-index")?.textContent).toBe("02");
    expect(vision.querySelector(".landing-index-label")?.textContent).toBe("Horizonte");
  });

  it("carries no photography and no divider — the v2 redesign drops both", (): void => {
    const { container } = render(<LandingPage />);

    const section = container.querySelector("#nosotros") as HTMLElement;
    expect(section.querySelectorAll("img")).toHaveLength(0);
    expect(section.querySelectorAll(".landing-editorial-divider")).toHaveLength(0);
    expect(section.querySelectorAll(".landing-editorial-media")).toHaveLength(0);
    expect(section.querySelectorAll(".landing-rule")).toHaveLength(0);
  });
});
