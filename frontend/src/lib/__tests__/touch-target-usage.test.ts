/**
 * A surface the product promised to a thumb stays at least 44px tall.
 *
 * The project's accessibility target is WCAG 2.2 **SC 2.5.8 (AA, 24×24)**, not
 * SC 2.5.5 (AAA, 44×44) — the argument, the measurements and the inventory live
 * in `docs/ux/objetivo-tactil.md`. So `h-ctl` stays at 40px: it is the desktop
 * control height, `gap-page` is literally defined as `h-ctl / 2`
 * (`tailwind.config.ts`), and moving it drags the vertical rhythm of every page
 * for a criterion the product does not claim.
 *
 * What this file keeps is the other half of that decision. A handful of
 * surfaces ARE sized for a thumb, deliberately and above the AA floor, and
 * nothing was watching them. One already regressed once: the landing's mobile
 * nav override shrank a 44px link to 40px on the narrowest viewport in the
 * product, and it was found by hand (`landing.css`, the comment above the
 * `max-width: 768px` override). That is the failure this guard exists to catch.
 *
 * ## What counts as a touch surface, and why it is a marker
 *
 * The hard part is not the 44; it is deciding WHICH surfaces owe it. Three
 * criteria were considered and two were measured against the real code:
 *
 *   · **By breakpoint gate** — "anything rendered below `lg` is touch". It
 *     produces both kinds of error here. False positives: the shell's `Menú`
 *     button and the drawer's close button are both `lg:hidden`, and both are
 *     deliberately under 44px (40px and 30px) because AA asks for 24. False
 *     negatives: the attendance state controls carry no breakpoint prefix at
 *     all — they are 44px on a desktop too, because a trainer marks a class
 *     standing in the gym holding a phone.
 *   · **By file** — "the shell and the landing are touch". Wrong at both ends
 *     for the same reasons, and it goes stale the moment a file gains a second
 *     kind of control.
 *   · **By explicit marker** — the surface says so itself. This is the one.
 *
 * The reason is that "touch surface" is not a geometric fact the source can be
 * asked about; it is a PROMISE somebody made, and the person who made it is the
 * one writing the component. So each such control carries `@touch-target` in
 * the comment that already explains it, and this guard measures the base height
 * of the declaration underneath. Marking is a one-line, reviewable act; the
 * roster below makes un-marking one too.
 *
 * ## What this deliberately does NOT check
 *
 * **Desktop surfaces, on purpose.** The sidebar rows and the topbar buttons are
 * `h-ctl`, 40px, and this guard is silent about them. That is not an oversight
 * being deferred: 40px clears SC 2.5.8's 24px floor almost twice over, those
 * controls are driven by a mouse, and raising them is the change the product
 * declined. If this file ever starts failing on them, the criterion was
 * misapplied, not the standard.
 *
 * **Width.** Only height is measured. Every surface in the roster is a full
 * row, a flexed tab or an explicit square, so height is the axis that can
 * silently collapse; a hit area narrow enough to matter would have to be
 * written deliberately.
 *
 * **A new touch surface that never gets marked.** This is the known hole, and
 * it is the price of the criterion: an opt-in guard cannot see a promise nobody
 * wrote down. What it does buy is that no EXISTING promise can be quietly
 * withdrawn — the roster makes deleting a marker fail as loudly as shrinking
 * one. `docs/ux/objetivo-tactil.md` is where the next person is told to mark.
 *
 * **CSS sized by anything but `min-height`.** In a `.css` rule only
 * `min-height` is read, so `.landing-button svg { height: 17px }` is not
 * mistaken for the button. A rule that loses its `min-height` entirely still
 * fails, because a marker with nothing measurable under it is a marker that
 * lies.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import tailwindConfig from "../../../tailwind.config";

const SRC = join(__dirname, "..", "..");

/** WCAG 2.2 SC 2.5.5 (AAA). Not the project's floor — the promised surfaces'. */
const TOUCH_FLOOR_PX = 44;

/** The marker a control writes to say a thumb, not a mouse, is its pointer. */
const MARKER = /@touch-target\b/g;

/**
 * How far past the marker the declaration may sit, in a `.ts`/`.tsx` file. The
 * longest real case is the attendance radio: eight deeply indented JSX
 * attributes stand between the marker and its `className`. A `.css` marker does
 * not use this — its window is its own rule, so a neighbouring rule's
 * `min-height` can never stand in for the one that went missing.
 */
const DECLARATION_WINDOW = 600;

/**
 * Where a base height can be written. `min-h-[44px]`, `h-[62px]`, `h-11` on the
 * spacing scale, `h-ctl` from the theme, `min-height: 44px` in CSS.
 *
 * All of them are BASE values: the lookbehind drops anything carrying a prefix,
 * because `lg:h-[76px]` is what a mouse gets and says nothing about the thumb.
 * A control written 40px at base and 76px from `lg` up is exactly the bug.
 */
const HEIGHT_PATTERNS: readonly { readonly pattern: RegExp; readonly px: (n: number) => number }[] =
  [
    { pattern: /(?<![\w:-])min-h-\[(\d+)px\]/g, px: (n) => n },
    { pattern: /(?<![\w:-])h-\[(\d+)px\]/g, px: (n) => n },
    { pattern: /(?<![\w:-])h-(\d+(?:\.5)?)(?![\w[-])/g, px: (n) => n * 4 },
    { pattern: /(?<![\w:-])min-height:\s*(\d+)px/g, px: (n) => n },
  ];

/** `h-ctl` is a name, so it has to be resolved rather than matched as a number. */
const CONTROL_HEIGHT = /(?<![\w:-])(?:min-)?h-ctl(?![\w-])/g;

const THEME = tailwindConfig.theme as {
  extend: { height: Record<string, string>; spacing: Record<string, string> };
};

/** 40px, read from the theme so the number below is never a second copy of it. */
const CONTROL_HEIGHT_PX = Number.parseInt(THEME.extend.height.ctl, 10);

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__") continue;
      found.push(...sourceFiles(full));
      continue;
    }
    if (/\.(ts|tsx|css)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) found.push(full);
  }
  return found;
}

/** Prose about a height is not a height. */
function stripComments(text: string): string {
  return text
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Every base height written in one declaration, in pixels. */
function baseHeights(code: string): number[] {
  const found: number[] = [];
  for (const { pattern, px } of HEIGHT_PATTERNS) {
    for (const match of code.matchAll(pattern)) found.push(px(Number(match[1])));
  }
  for (const _ of code.matchAll(CONTROL_HEIGHT)) found.push(CONTROL_HEIGHT_PX);
  return found;
}

/**
 * Every `@touch-target` in one file whose declaration does not reach the floor
 * — including the marker that measures nothing at all, which is the same
 * failure wearing a different face.
 */
export function undersizedTouchTargets(code: string, isCss = false): string[] {
  const offenders: string[] = [];
  for (const match of code.matchAll(MARKER)) {
    const rest = code.slice(match.index + match[0].length);
    // The marker lives inside a comment; the declaration starts once it closes.
    const opens = rest.indexOf("*/");
    const from = opens === -1 ? 0 : opens + 2;
    const after = rest.slice(from);
    const closes = after.indexOf("}");
    const declaration = isCss
      ? after.slice(0, closes === -1 ? DECLARATION_WINDOW : closes + 1)
      : stripComments(after.slice(0, DECLARATION_WINDOW));

    const heights = baseHeights(declaration);
    if (heights.length === 0) {
      offenders.push("@touch-target with no base height under it");
      continue;
    }
    const smallest = Math.min(...heights);
    if (smallest < TOUCH_FLOOR_PX) offenders.push(`@touch-target at ${smallest}px`);
  }
  return offenders;
}

const FILES = sourceFiles(SRC).map((path) => ({
  path: path.slice(SRC.length + 1).replace(/\\/g, "/"),
  code: readFileSync(path, "utf8"),
}));

const MARKED = FILES.map(({ path, code }) => ({
  path,
  markers: [...code.matchAll(MARKER)].length,
  offenders: undersizedTouchTargets(code, path.endsWith(".css")),
})).filter(({ markers }) => markers > 0);

/**
 * The roster. Every surface the product has promised to a thumb, and how many
 * promises each file carries. Deleting a marker to silence this guard has to
 * come here and say so, which is the point.
 */
const ROSTER: readonly (readonly [string, number])[] = [
  // The phone tab bar (admin) and the shell's skip link.
  ["components/shell/AppShell.tsx", 2],
  // The floating CATA-BOT disc: 44px on a phone, 76px from `lg` up.
  ["components/chatbot/HelpChatDock.tsx", 1],
  // The four attendance state controls — 44px at every width, on purpose.
  ["app/trainer/attendance/page.tsx", 1],
  // The public landing: two buttons, the skip link, the nav links, the nav CTA
  // and the `max-width: 768px` override that once shrank a link to 40px.
  ["app/landing/landing.css", 6],
];

describe("a promised touch surface stays at 44px", () => {
  it("finds source files to check at all", () => {
    // Guards the guard: a broken walk makes every assertion below vacuous.
    expect(FILES.length).toBeGreaterThan(50);
    expect(MARKED.length).toBeGreaterThan(0);
  });

  it("leaves no marked surface under the floor", () => {
    const offenders = MARKED.filter(({ offenders }) => offenders.length > 0).map(
      ({ path, offenders }) => `${path}: ${offenders.join(", ")}`,
    );

    expect(offenders).toEqual([]);
  });

  it("keeps every promise that was already made", () => {
    // The other half of the canary. Shrinking a surface fails above; DELETING
    // its marker would otherwise pass silently, which is the cheaper way to
    // withdraw a promise.
    const counted = MARKED.map(({ path, markers }) => [path, markers] as const);

    expect(counted.sort()).toEqual([...ROSTER].sort());
  });

  it("still catches a shrunken surface — the assertions above are not vacuous", () => {
    // 44px passes, 40px does not, in both spellings a real surface uses.
    expect(undersizedTouchTargets('/** @touch-target */\nconst A = "min-h-[44px]";')).toEqual([]);
    expect(undersizedTouchTargets('/** @touch-target */\nconst A = "min-h-[40px]";')).toEqual([
      "@touch-target at 40px",
    ]);
    expect(undersizedTouchTargets('/** @touch-target */\nconst A = "flex h-11 w-11";')).toEqual([]);
    expect(undersizedTouchTargets('/** @touch-target */\nconst A = "flex h-10 w-10";')).toEqual([
      "@touch-target at 40px",
    ]);

    // Reaching for the desktop control token is the likeliest way to shrink one
    // by accident, and it has to fail by its resolved height, not its spelling.
    expect(undersizedTouchTargets('/** @touch-target */\nconst A = "flex h-ctl";')).toEqual([
      `@touch-target at ${CONTROL_HEIGHT_PX}px`,
    ]);

    // A desktop-only override cannot launder a base value under the floor.
    expect(
      undersizedTouchTargets('/** @touch-target */\nconst A = "h-10 lg:h-[76px]";'),
    ).toEqual(["@touch-target at 40px"]);

    // And a marker with nothing to measure is not a pass.
    expect(undersizedTouchTargets("/** @touch-target */\nconst A = /* nothing */ 1;")).toEqual([
      "@touch-target with no base height under it",
    ]);
  });

  it("reads a CSS rule and not its neighbour", () => {
    // The window for a `.css` marker ends at its own closing brace. Without
    // that, the 48px of the next rule would cover for a button that lost its
    // own — which is precisely the regression the landing already had once.
    const css =
      "/* @touch-target */\n.a { display: flex; padding: 4px; }\n.b { min-height: 48px; }";

    expect(undersizedTouchTargets(css, true)).toEqual([
      "@touch-target with no base height under it",
    ]);
    // …and an `svg { height: 17px }` inside the same rule is not the control.
    expect(
      undersizedTouchTargets("/* @touch-target */\n.a { min-height: 44px; height: 17px; }", true),
    ).toEqual([]);
  });

  it("only trusts the spacing scale because the scale is really ×4px", () => {
    // `h-11` is read as 44px. That arithmetic is Tailwind's default scale, and
    // `tailwind.config.ts` extends it — so if a custom step ever landed off the
    // ×4 grid, this guard would be measuring a size that does not exist.
    const numeric = Object.entries(THEME.extend.spacing).filter(([step]) => /^\d+$/.test(step));

    expect(numeric.length).toBeGreaterThan(0);
    for (const [step, value] of numeric) {
      expect(`${step} → ${Number.parseFloat(value) * 16}px`).toBe(
        `${step} → ${Number(step) * 4}px`,
      );
    }
  });

  it("leaves the desktop control height alone at 40px", () => {
    // The decision this file is one half of: `h-ctl` does not move. It is the
    // AA-compliant desktop height and `gap-page` is derived from it.
    expect(CONTROL_HEIGHT_PX).toBe(40);
    expect(THEME.extend.spacing.page).toBe(`${CONTROL_HEIGHT_PX / 2}px`);
  });
});
