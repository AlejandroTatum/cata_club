/** @vitest-environment jsdom */

/**
 * Structural lock — the Mission/Vision v2 redesign (typographic pillars,
 * one photo each). The approved prototype
 * (`landing-mision-vision-v2-texto.html`) dropped the icon chip and the
 * centre divider entirely, so no DOM shape for either exists to protect
 * anymore; a single real photograph sits beside each pillar's body copy on
 * desktop (below it on mobile), forced through the shared
 * `.landing-pillar-photo` ratio (landing.css) so the two columns stay level
 * as one pair. The copy itself is wrapped in `.landing-pillar-copy` so the
 * photo, as the pillar's second child, lands in the second column of
 * `.landing-pillar`'s own `1fr 1fr` grid by plain two-item auto-placement.
 *
 * jsdom cannot lay out CSS Grid or compute a rendered aspect ratio, so real
 * geometry (the two-column layout, the mobile stack, the actual crop) is
 * out of scope here — this suite anchors the DOM shape: two `.landing-pillar`
 * articles, each carrying a `.landing-pillar-copy` wrapper (index, label,
 * heading, lead, body, in order) followed by the photo, both photos sharing
 * the same class (and therefore the same CSS ratio — see
 * `landing-vertical-space.test.ts` for the rule itself), and no icon chip or
 * divider. `landing-vertical-space.test.ts` also locks that the CSS actually
 * places the photo in the SECOND grid column on desktop and reverts to one
 * column on mobile — this file cannot see that layout, only the DOM shape
 * that makes it possible.
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
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import LandingPage from "@/app/landing/LandingPage";
import { resetLandingTestEnvironment, stubLandingGlobals } from "./landing-test-doubles";

// jsdom cannot lay out CSS Grid, so the actual "beside, not below" placement
// is locked against the authored stylesheet directly — same convention
// `landing-values-tablero.test.tsx` uses for stylesheet-only contracts.
const landingCss = (): string =>
  readFileSync(resolve(process.cwd(), "src/app/landing/landing.css"), "utf8");

const ruleAt = (css: string, selector: string, fromIndex = 0): string => {
  const start = css.indexOf(`${selector} {`, fromIndex);
  if (start === -1) throw new Error(`rule not found: ${selector} (from ${fromIndex})`);
  const end = css.indexOf("}", start);
  return css.slice(start, end + 1);
};

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

  it("wraps the copy (index, label, heading, lead, body) in its own column, then the photo, in each pillar", (): void => {
    const { container } = render(<LandingPage />);

    const [mission, vision] = Array.from(container.querySelectorAll("#nosotros .landing-pillar"));
    for (const pillar of [mission, vision]) {
      const children = Array.from(pillar.children);
      // Exactly two grid items: the copy wrapper, then the photo — so plain
      // two-item auto-placement is what puts the photo in the second column
      // of `.landing-pillar`'s `1fr 1fr` grid (locked in
      // `landing-vertical-space.test.ts`), with no per-child `grid-column`
      // to drift out of sync.
      expect(children.map((child): string => child.tagName.toLowerCase()))
        .toEqual(["div", "img"]);
      expect(children[0]).toHaveClass("landing-pillar-copy");
      expect(children[1]).toHaveClass("landing-pillar-photo");

      const copyChildren = Array.from(children[0].children);
      expect(copyChildren.map((child): string => child.tagName.toLowerCase()))
        .toEqual(["span", "span", "h3", "p", "p"]);
      expect(copyChildren[0]).toHaveClass("landing-index");
      expect(copyChildren[1]).toHaveClass("landing-index-label");
      expect(copyChildren[3]).toHaveClass("landing-lead");
    }

    expect(mission.querySelector(".landing-index")?.textContent).toBe("01");
    expect(mission.querySelector(".landing-index-label")?.textContent).toBe("Propósito");
    expect(vision.querySelector(".landing-index")?.textContent).toBe("02");
    expect(vision.querySelector(".landing-index-label")?.textContent).toBe("Horizonte");
  });

  it("places the photo in the second column of the pillar's own grid on desktop, and reverts to one column below the mobile breakpoint", (): void => {
    const css = landingCss();

    const pillarRule = ruleAt(css, ".landing-pillar");
    expect(pillarRule).toContain("display: grid");
    expect(pillarRule).toContain("grid-template-columns: 1fr 1fr");

    // `.landing-pillar-photo` must not carry the old stacked layout's
    // `margin-top` outside the mobile block — that spacing only makes sense
    // once the photo is back below the copy, not beside it.
    const photoBaseRule = ruleAt(css, ".landing-pillar-photo");
    expect(photoBaseRule).not.toContain("margin-top");

    const mobileBlock = css.indexOf("@media (max-width: 768px)");
    expect(mobileBlock).toBeGreaterThan(-1);
    const mobilePillarRule = ruleAt(css, ".landing-pillar", mobileBlock);
    expect(mobilePillarRule).toContain("grid-template-columns: 1fr");
    expect(mobilePillarRule).not.toContain("1fr 1fr");
    const mobilePhotoRule = ruleAt(css, ".landing-pillar-photo", mobileBlock);
    expect(mobilePhotoRule).toContain("margin-top: 24px");
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
