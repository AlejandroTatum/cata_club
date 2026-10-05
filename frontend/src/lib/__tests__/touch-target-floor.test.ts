/**
 * The coarse-pointer touch floor (QA4 mobile audit).
 *
 * `h-ctl` stays 40px for a mouse (see `touch-target-usage.test.ts`), but a
 * phone gets 44px through one `@media (pointer: coarse)` block in
 * `globals.css`. jsdom performs no layout, so this guard reads the rule rather
 * than a measurement: the real measurement is `tests/e2e/mobile-audit.mobile.spec.ts`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

/** The body of every `@media (pointer: coarse) { … }` block, braces balanced. */
function coarseBlocks(source: string): string[] {
  const blocks: string[] = [];
  const opener = /@media \(pointer: coarse\) \{/g;
  for (let m = opener.exec(source); m; m = opener.exec(source)) {
    let depth = 1;
    let i = opener.lastIndex;
    while (depth > 0 && i < source.length) {
      if (source[i] === "{") depth += 1;
      if (source[i] === "}") depth -= 1;
      i += 1;
    }
    blocks.push(source.slice(opener.lastIndex, i - 1));
  }
  return blocks;
}

describe("coarse-pointer touch floor", () => {
  const floor = coarseBlocks(css).find((block) => block.includes("min-height: 44px"));

  it("exists, and only inside a coarse-pointer media query", () => {
    expect(floor).toBeDefined();
    const outside = css.replace(/@media \(pointer: coarse\) \{[\s\S]*?\n\}\n/g, "");
    expect(outside).not.toMatch(/\[class\*="h-ctl"\]/);
  });

  it("raises the control tokens and the text field to 44px", () => {
    expect(floor).toMatch(/\[class\*="h-ctl"\],\s*\.input-field\s*\{\s*min-height: 44px;/);
  });

  it("offers a square for icon-only controls and an invisible hit area for fixed ones", () => {
    expect(floor).toMatch(/\.touch-target\s*\{\s*min-width: 44px;\s*min-height: 44px;/);
    expect(floor).toMatch(/\.touch-target-reach::after\s*\{[^}]*width: 44px;[^}]*height: 44px;/);
  });

  it("offers row classes for the text controls under the floor (#1567)", () => {
    expect(floor).toMatch(/\.touch-target-row\s*\{\s*min-height: 44px;\s*\}/);
    expect(floor).toMatch(/\.touch-target-pad\s*\{\s*min-height: 44px;\s*padding-block: 0\.75rem;/);
  });

  it("never reaches for links or a universal selector", () => {
    expect(floor).not.toMatch(/(^|[\s,])a\b[^-]/);
    expect(floor).not.toMatch(/(^|[\s,])\*\s*[,{]/);
  });
});
