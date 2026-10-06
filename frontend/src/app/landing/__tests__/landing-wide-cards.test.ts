import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// jsdom cannot compute layout, so these pin the authored selectors; the
// rendered result is checked visually at 390 and 1440 px.
const css = readFileSync(resolve(process.cwd(), "src/app/landing/landing.css"), "utf8");
/** Every declaration block authored for the exact selector, concatenated. */
const rule = (selector: string): string => {
  const bodies: string[] = [];
  let from = css.indexOf(`${selector} {`);
  while (from >= 0) {
    bodies.push(css.slice(from, css.indexOf("}", from)));
    from = css.indexOf(`${selector} {`, from + 1);
  }
  expect(bodies.length, `missing rule ${selector}`).toBeGreaterThan(0);
  return bodies.join("\n");
};

describe("full-row help tile (#1657)", (): void => {
  const FULL_ROW = ".landing-schedule-help:nth-child(3n + 1):last-child";

  it("centres its content and enlarges the type only in the full-row state", (): void => {
    // Only the 3-column desktop grid; tablet and phone keep the regular tile.
    const at = css.indexOf(`  ${FULL_ROW} { align-items: center`);
    expect(css.slice(css.lastIndexOf("@media", at), at)).toMatch(/@media \(min-width: 1025px\)/);
    expect(rule(FULL_ROW)).toMatch(/align-items: center/);
    expect(rule(FULL_ROW)).toMatch(/text-align: center/);
    expect(rule(`${FULL_ROW} h3`)).toMatch(/align-self: center; font-size: 40px/);
    expect(rule(`${FULL_ROW} p`)).toMatch(/font-size: 19px/);
    expect(rule(`${FULL_ROW} a`)).toMatch(/align-self: center/);
    // The single-cell tile keeps its left-aligned 28px look.
    expect(rule(".landing-schedule-help h3")).toMatch(/font-size: 28px/);
    expect(rule(".landing-schedule-help a")).toMatch(/align-self: flex-start/);
  });
});

describe("mensualidad cards with one or two tariffs (#1658)", (): void => {
  it("caps and centres the list only when there are at most two cards, on desktop", (): void => {
    const start = css.indexOf(".landing-prices-list:has(> .landing-price:first-child:nth-last-child(-n + 2))");
    expect(start).toBeGreaterThanOrEqual(0);
    const media = css.lastIndexOf("@media", start);
    expect(css.slice(media, start)).toMatch(/@media \(min-width: 769px\)/);
    const body = css.slice(start, css.indexOf("}", start));
    expect(body).toMatch(/justify-content: center/);
    expect(body).toMatch(/minmax\(240px, 420px\)/);
    // The base rule (3+ tariffs, mobile) is untouched.
    expect(rule(".landing-prices-list")).toMatch(/repeat\(auto-fit, minmax\(240px, 1fr\)\)/);
  });
});
