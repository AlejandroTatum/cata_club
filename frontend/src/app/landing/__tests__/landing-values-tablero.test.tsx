/** @vitest-environment jsdom */

/**
 * Structural lock — the Valores tablero redesign (approved prototype
 * `landing-valores-b-tablero.html`). Replaces the rally: no ball, no guide,
 * no scoreboard counter, no dimming. Four black numeral tiles sit in one
 * grid row, four value articles sit in the row below, and both rows come
 * from the SAME CSS grid — so the four titles share a top edge by
 * construction, not by a scroll choreography that could break on mobile
 * (the reason the rally was rejected).
 *
 * jsdom cannot lay out CSS Grid, so real alignment is out of scope here —
 * this suite anchors only the DOM shape: eight children in tile/tile/tile/
 * tile/item/item/item/item order, indices decorative, titles and copy in
 * document order for assistive technology, and the scroll cue pointing at
 * the real Palmarés section.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import "./landing-render-mocks";
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import LandingPage from "@/app/landing/LandingPage";
import { resetLandingTestEnvironment, stubLandingGlobals } from "./landing-test-doubles";

// jsdom cannot compute a `::before` pseudo-element's background-image or
// opacity, so the crest motif's placement is locked against the authored
// stylesheet directly — the same convention landing-logros-colors.test.ts
// uses for stylesheet-only contracts.
const landingCss = (): string =>
  readFileSync(resolve(process.cwd(), "src/app/landing/landing.css"), "utf8");

/** The first `<selector> { ... }` rule at or after `fromIndex`, as raw text —
 * same convention `landing-vertical-space.test.ts` uses for stylesheet-only
 * contracts. */
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

describe("Valores tablero (rally replacement)", (): void => {
  it("renders four tiles then four items, in that source order", (): void => {
    const { container } = render(<LandingPage />);

    const tablero = container.querySelector("#valores .landing-tablero");
    expect(tablero).not.toBeNull();
    const children = Array.from(tablero!.children);
    expect(children.map((child): string => child.className)).toEqual([
      "landing-tablero-tile",
      "landing-tablero-tile",
      "landing-tablero-tile",
      "landing-tablero-tile",
      "landing-tablero-item",
      "landing-tablero-item",
      "landing-tablero-item",
      "landing-tablero-item",
    ]);
  });

  it("keeps the tile numerals decorative and the titles/copy the only accessible content", (): void => {
    const { container } = render(<LandingPage />);

    const tiles = container.querySelectorAll("#valores .landing-tablero-tile");
    tiles.forEach((tile): void => {
      expect(tile).toHaveAttribute("aria-hidden", "true");
    });

    const items = Array.from(container.querySelectorAll("#valores .landing-tablero-item"));
    expect(items.map((item): string | null => item.querySelector("h3")?.textContent ?? null)).toEqual([
      "Respeto",
      "Disciplina",
      "Esfuerzo",
      "Compañerismo",
    ]);
  });

  it("points the scroll cue at the real Palmarés section", (): void => {
    const { container } = render(<LandingPage />);

    const cue = container.querySelector("#valores .landing-tablero-cue");
    expect(cue).not.toBeNull();
    expect(cue).toHaveAttribute("href", "#logros");
    expect(container.querySelector("#logros")).not.toBeNull();
  });

  it("carries no rally, ball, guide, counter, or dimming machinery", (): void => {
    const { container } = render(<LandingPage />);

    const section = container.querySelector("#valores") as HTMLElement;
    expect(section.querySelector("[data-rally]")).toBeNull();
    expect(section.querySelector("svg")).toBeNull();
    expect(section.querySelectorAll("[data-value]")).toHaveLength(0);
    expect(section.querySelectorAll(".dim, .hit")).toHaveLength(0);
  });

  // The table-tennis / club-identity motif the client asked for, once the
  // section read as flat without the retired rally. It lives behind each
  // tile's numeral as a `::before` background-image — no image element, no
  // inline vector markup, no extra DOM node — so it stays invisible to
  // assistive tech, the "no svg in #valores" lock above holds unchanged,
  // and the tiles' own aria-hidden/textContent locks (this file and
  // LandingPage.test.tsx) do not need a matching DOM node to find.
  it("carries the crest motif behind each tile's numeral, not a corner watermark", (): void => {
    const css = landingCss();
    expect(css).not.toContain(".landing-values-crest");
    expect(css).toContain(
      '.landing-tablero-tile::before { content: ""; position: absolute; inset: 0; z-index: -1; background-image: url("/brand/cata-club-crest-256-light.png"); background-repeat: no-repeat; background-position: center; background-size: contain; opacity: 0.3; pointer-events: none; }',
    );
  });

  // Issue: the dark crest (`cata-club-crest-256.png`, opaque colour
  // rgb(17, 12, 34)) all but disappears over `--landing-brand-black`
  // (`#111111`) — only the red laurel survived, which is what the client
  // reported as no contrast at all. A regression back to that asset, or an
  // opacity that stops keeping the numeral's contrast at or above 4.5:1
  // against the new white-crest composite, must fail here rather than only
  // being caught by eye.
  it("uses the white-silhouette crest, never the dark one, and keeps the numeral at AA contrast (4.5:1) against it", (): void => {
    const css = landingCss();
    const rule = ruleAt(css, ".landing-tablero-tile::before");
    expect(rule).toContain('url("/brand/cata-club-crest-256-light.png")');
    expect(rule).not.toContain('url("/brand/cata-club-crest-256.png")');

    const opacityMatch = rule.match(/opacity:\s*([\d.]+)/);
    expect(opacityMatch).not.toBeNull();
    const opacity = Number.parseFloat(opacityMatch![1]);

    // Worst-case backdrop under the numeral: the crest's fully-opaque white
    // (#ffffff) composited at `opacity` over the tile's `--landing-brand-black`
    // (#111111 = rgb(17,17,17)).
    const black = 17;
    const composite = black + (255 - black) * opacity;

    const linearize = (channel: number): number => {
      const v = channel / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (r: number, g: number, b: number): number =>
      0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
    const contrast = (l1: number, l2: number): number => {
      const [lighter, darker] = l1 > l2 ? [l1, l2] : [l2, l1];
      return (lighter + 0.05) / (darker + 0.05);
    };

    const numeralLuminance = luminance(0xff, 0xd6, 0x00); // --landing-highlight (#ffd600)
    const backdropLuminance = luminance(composite, composite, composite);
    expect(contrast(numeralLuminance, backdropLuminance)).toBeGreaterThanOrEqual(4.5);
  });
});
