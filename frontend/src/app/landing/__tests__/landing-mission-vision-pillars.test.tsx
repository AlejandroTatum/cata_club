/** @vitest-environment jsdom */

/**
 * Structural lock — the Mission/Vision v2 redesign (typographic pillars,
 * one photo each). The approved prototype
 * (`landing-mision-vision-v2-texto.html`) dropped the icon chip and the
 * centre divider entirely, so no DOM shape for either exists to protect
 * anymore; a single real photograph was later added back below each
 * pillar's body copy, forced through the shared `.landing-pillar-photo`
 * ratio (landing.css) so the two columns stay level as one pair.
 *
 * jsdom cannot lay out CSS Grid or compute a rendered aspect ratio, so real
 * geometry (the two-column layout, the mobile stack, the actual crop) is
 * out of scope here — this suite anchors the DOM shape: two `.landing-pillar`
 * articles, each carrying its index, label, heading, lead, body and photo in
 * order, both photos sharing the same class (and therefore the same CSS
 * ratio — see `landing-vertical-space.test.ts` for the rule itself), and no
 * icon chip or divider.
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

  it("carries index, label, heading, lead, body and photo in that order, in each pillar", (): void => {
    const { container } = render(<LandingPage />);

    const [mission, vision] = Array.from(container.querySelectorAll("#nosotros .landing-pillar"));
    for (const pillar of [mission, vision]) {
      const children = Array.from(pillar.children);
      expect(children.map((child): string => child.tagName.toLowerCase()))
        .toEqual(["span", "span", "h3", "p", "p", "img"]);
      expect(children[0]).toHaveClass("landing-index");
      expect(children[1]).toHaveClass("landing-index-label");
      expect(children[3]).toHaveClass("landing-lead");
      expect(children[5]).toHaveClass("landing-pillar-photo");
    }

    expect(mission.querySelector(".landing-index")?.textContent).toBe("01");
    expect(mission.querySelector(".landing-index-label")?.textContent).toBe("Propósito");
    expect(vision.querySelector(".landing-index")?.textContent).toBe("02");
    expect(vision.querySelector(".landing-index-label")?.textContent).toBe("Horizonte");
  });

  it("gives each pillar exactly one photo, both forced through the same ratio class, and no divider", (): void => {
    const { container } = render(<LandingPage />);

    const section = container.querySelector("#nosotros") as HTMLElement;
    const photos = Array.from(section.querySelectorAll<HTMLImageElement>("img"));
    expect(photos).toHaveLength(2);

    // Both photos share ONE class, so they are governed by the same
    // `aspect-ratio` / `object-fit` rule in landing.css by construction — a
    // per-photo override could not quietly reintroduce the ratio mismatch
    // between the two source files that this class exists to erase.
    photos.forEach((photo): void => {
      expect(photo).toHaveClass("landing-pillar-photo");
      expect(photo.getAttribute("sizes")).toBeTruthy();
      expect(photo.getAttribute("sizes") ?? "").not.toMatch(/vw/);
    });

    // Real, specific alt text in Spanish per photo — never empty, never a
    // generic placeholder, and never the same string reused for both.
    const alts = photos.map((photo): string => photo.getAttribute("alt") ?? "");
    for (const alt of alts) {
      expect(alt.length).toBeGreaterThan(15);
      expect(alt.toLowerCase()).not.toBe("foto");
    }
    expect(alts[0]).not.toBe(alts[1]);

    expect(section.querySelectorAll(".landing-editorial-divider")).toHaveLength(0);
    expect(section.querySelectorAll(".landing-editorial-media")).toHaveLength(0);
    expect(section.querySelectorAll(".landing-rule")).toHaveLength(0);
  });
});
