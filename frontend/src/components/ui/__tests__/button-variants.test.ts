/**
 * Three button levels, and all three have a surface.
 *
 * The client and the product owner rejected the boxless control in as many
 * words — "no me gustan los botones vacíos o sin box". The `ghost` variant is
 * exactly that by construction: `bg-transparent border-transparent`, no chrome
 * at all, a control that borrows whatever is behind it. D5 of
 * `docs/ux/rediseno-visual-2026-08.md` replaces it with a THIRD level that is
 * distinguished by FILL rather than by absence: `sunken` with no border.
 *
 * ## Why a source rule and not a render test
 *
 * Fixing the ten call sites proves nothing about the eleventh. The variant is
 * offered by the shared primitive, so as long as it exists in `ButtonVariant`
 * it is one autocomplete away from coming back — and it came back before: the
 * legacy `.btn-ghost` in `globals.css` outlived the primitive that replaced it
 * and sat there with zero consumers, still spelling out the ghost recipe for
 * anyone who read the sheet. The deletion is the fix; this file is what keeps
 * it deleted.
 *
 * That is the same shape `primary-action.test.ts` guards for the header slot,
 * and the same reason `.badge` was DELETED from `globals.css` rather than
 * deprecated: a variant nobody removed is a variant somebody will use.
 *
 * The scan below is over source rather than over a render tree because the
 * failure is "this screen reached for the retired variant", which no snapshot
 * of today's ten screens can see.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { buttonClasses } from "../Button";
import type { ButtonVariant } from "../Button";

const SRC = join(__dirname, "..", "..", "..");
const BUTTON = join(SRC, "components", "ui", "Button.tsx");

// ---------------------------------------------------------------------------
// The type is the system's vocabulary
// ---------------------------------------------------------------------------

describe("ButtonVariant offers a filled third level and no ghost", () => {
  // Read off the declaration rather than inferred from the runtime map: the
  // union is what a call site autocompletes against, and it is the only part
  // of the primitive a screen can see before it compiles.
  const declaration = /export type ButtonVariant =([^;]+);/.exec(
    readFileSync(BUTTON, "utf8"),
  )?.[1];

  it("declares the union this file can actually read", () => {
    expect(declaration).toBeDefined();
  });

  it("no longer names ghost", () => {
    expect(declaration).not.toMatch(/"ghost"/);
  });

  it("names tertiary", () => {
    expect(declaration).toMatch(/"tertiary"/);
  });

  it("dresses tertiary in a surface of its own, filled and unbordered", () => {
    // The whole point of the level: a resting fill you can see, with the box
    // coming from that fill instead of from a border. `border-transparent` is
    // still declared because `BASE` sets `border` — without a colour the
    // control would inherit `currentColor` and grow the outline the fill is
    // there to replace.
    const classes = buttonClasses("tertiary");
    expect(classes).toContain("bg-sunken");
    expect(classes).toContain("border-transparent");
    expect(classes).toContain("text-ink-2");
    expect(classes).toContain("hover:bg-line");
    expect(classes).toContain("hover:text-ink");
  });

  it("has no skin left to hand out under the ghost name", () => {
    // The cast is what a stale call site looks like once the union drops the
    // member. It must fall through to a bare shape with no fill, not to a
    // surviving entry in the map.
    const classes = buttonClasses("ghost" as ButtonVariant);
    expect(classes).not.toMatch(/\bbg-\S+/);
    expect(classes).not.toMatch(/\bborder-\S+/);
  });
});

// ---------------------------------------------------------------------------
// The sweep — nothing in the tree may still ask for it
// ---------------------------------------------------------------------------

/** Every spelling of the retired variant that can reach a rendered button. */
const RETIRED = [
  // The primitive, as a JSX prop: `variant="ghost"` and `variant={"ghost"}`.
  /variant=(?:"ghost"|\{\s*"ghost"\s*\})/,
  // The same skin worn by an anchor or `next/link` through the exported
  // helper, which is how a link puts on a button without cloning the values.
  /buttonClasses\(\s*"ghost"/,
  // The legacy global class. It had zero consumers in markup when it was
  // deleted, which is precisely why it survived two redesigns unnoticed.
  /\bbtn-ghost\b/,
];

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

/**
 * Prose is not code, and this repo's prose is long. `globals.css` explains at
 * length why `.btn-ghost` was removed, and `payments/page.tsx` explains why a
 * given button is NOT the same weight as its neighbours — a guard that fires
 * on the explanation of its own rule teaches people to delete the explanation.
 *
 * Blanked in place rather than cut out, so the line numbers this file reports
 * are the line numbers an editor will jump to.
 */
function blankComments(text: string): string {
  const blank = (match: string): string => match.replace(/[^\n]/g, " ");
  return text
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:])(\/\/.*)$/gm, (_m, before: string, comment: string) => before + blank(comment));
}

describe("no file in src/ still asks for the ghost button", () => {
  const offenders = sourceFiles(SRC).flatMap((path) =>
    blankComments(readFileSync(path, "utf8"))
      .split("\n")
      .flatMap((line, index) =>
        RETIRED.some((pattern) => pattern.test(line))
          ? [`${path.slice(SRC.length + 1)}:${index + 1}: ${line.trim()}`]
          : [],
      ),
  );

  it("names the file and the line of anything that does", () => {
    // Reported as a list of `path:line` rather than as a count, because the
    // fix is per site: each one is a decision between the filled tertiary
    // level and a LINK, and only whoever reads the site can tell which.
    expect(offenders).toEqual([]);
  });
});
