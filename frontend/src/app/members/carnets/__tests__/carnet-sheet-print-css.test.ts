/**
 * The batch sheet's print geometry (issue #1670), read off `globals.css`:
 * jsdom applies no layout, so the numbers the owner chose are asserted where
 * they are written. The real A4 check is the Playwright spec
 * `tests/e2e/carnets-print.spec.ts`.
 *
 * @vitest-environment node
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { A4_PRINT_PAGE_CSS } from "../CarnetSheet";
import { CARDS_PER_SHEET, chunkIntoSheets, describeSheets, parseCarnetIds } from "../carnet-sheet-utils";

const css = readFileSync(join(__dirname, "../../../globals.css"), "utf8");

function rule(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `rule ${selector}`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start));
}

describe("carnet sheet CSS", () => {
  it("cells are the standard 85,6 × 54 mm card, three across", () => {
    expect(rule(".carnet-sheet")).toContain("--carnet-card-w: 54mm");
    expect(rule(".carnet-sheet")).toContain("--carnet-card-h: 85.6mm");
    expect(rule(".carnet-sheet")).toContain("grid-template-columns: repeat(3, var(--carnet-card-w))");
    expect(rule(".carnet-sheet")).toContain("grid-auto-rows: var(--carnet-card-h)");
    expect(rule(".carnet-sheet-cell")).toMatch(/width: var\(--carnet-card-w\)[\s\S]*height: var\(--carnet-card-h\)/);
    expect(CARDS_PER_SHEET).toBe(9);
  });

  it("scales the 72mm single design uniformly onto the card (54/72)", () => {
    expect(rule(".carnet-sheet-scale")).toContain("width: 72mm");
    expect(rule(".carnet-sheet-scale")).toContain("scale(0.75)");
    expect(rule(".carnet-sheet-credential")).toContain("width: 72mm");
    expect(rule(".carnet-sheet-credential")).toContain("height: calc(var(--carnet-card-h) / 0.75)");
  });

  it("draws eight crop marks per card and prints them", () => {
    const before = rule(".carnet-sheet-cell::before");
    expect(before.match(/linear-gradient/g)).toHaveLength(8);
    expect(css).toMatch(/#carnet-batch \*\s*\{[^}]*print-color-adjust: exact/);
  });

  it("breaks between sheets and paginates: the batch is absolute, never fixed", () => {
    expect(rule("  .carnet-sheet")).toContain("break-after: page");
    // `fixed` never paginates.
    expect(rule("#carnet-batch")).toContain("position: absolute");
  });

  it("leaves the single carnet's own page alone: A4 is the batch component's, not a global", () => {
    expect(css).not.toMatch(/size:\s*A4/);
    expect(css).toMatch(/@page\s*\{[^}]*size: auto/);
    expect(A4_PRINT_PAGE_CSS).toContain("size: A4");
    expect(A4_PRINT_PAGE_CSS).toContain("margin: 10mm");
  });
});

describe("carnet sheet utils", () => {
  it("parses ids: positive integers, unique, in order, malformed dropped", () => {
    expect(parseCarnetIds("5,3,5, 9,x,-1,0,2.5")).toEqual([5, 3, 9]);
    expect(parseCarnetIds(null)).toEqual([]);
    expect(parseCarnetIds("")).toEqual([]);
  });

  it("caps the batch", () => {
    const many = Array.from({ length: 90 }, (_, index) => index + 1).join(",");
    expect(parseCarnetIds(many)).toHaveLength(60);
  });

  it("chunks into sheets of nine, the last one short", () => {
    expect(chunkIntoSheets(Array.from({ length: 19 }, (_, i) => i)).map((sheet) => sheet.length)).toEqual([9, 9, 1]);
    expect(chunkIntoSheets([])).toEqual([]);
  });

  it("describes sheets", () => {
    expect(describeSheets(1)).toBe("1 carnet · 1 hoja A4");
    expect(describeSheets(10)).toBe("10 carnets · 2 hojas A4");
  });
});
