/**
 * No new arbitrary style values.
 *
 * The redesign shipped hundreds of hand-picked values — `size={21}`, an
 * off-scale `min-[980px]` breakpoint, ten one-off elevations — because the
 * type and metric scale was transcribed by eye instead of being read off a
 * token. Every example here is deliberately drawn from an axis #29 does NOT
 * retire: the typography examples this comment used to carry had to be
 * rewritten by every link of the chain. The migration issues
 * (#29–#32) undo that. The problem is arithmetic: while three hundred uses are
 * being rewritten, use number three hundred and one lands in a PR the same
 * week and the count never falls.
 *
 * So this test is a ratchet, not a cleanup. It starts from
 * `arbitrary-style-values.allowlist.ts` — the COMPLETE inventory of what was
 * already there — which is why it is green without a single line of product
 * code changing. It only fires on a value that is not in that inventory, and
 * each migration issue deletes entries so the door closes one value at a time.
 *
 * ## Why a file walk and not a spawned `rg`
 *
 * `focus-ring-usage.test.ts` and `ui-vocabulary.test.ts` already walk `src/`
 * with `node:fs`, so the walk is the house pattern and costs no dependency, no
 * subprocess, and no assumption that `rg` is on the CI image. It also keeps
 * the offending value, its file and the suggested token in one place, which is
 * what makes the failure message actionable.
 *
 * ## What counts as a violation
 *
 * The eight axes below, and only those. Five of them catch a value written
 * between brackets. `weight` catches a factory class by name, because the
 * weight scale is the one part of the type system that drifts without ever
 * writing an arbitrary value; `icon` and `rhythm` capture a whole expression
 * and exempt only the correct form, because on those two axes the drift is
 * the shape of what is written, not the number in it. Arbitrary COLOURS (`text-[#B9B9C1]`) are
 * deliberately out of scope: `color-contrast.test.ts` owns the palette, and
 * folding two rules into one guard makes both harder to shrink.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ALLOWLIST, type Axis } from "./arbitrary-style-values.allowlist";
import { ICON_STEPS } from "../icon-size";

const SRC = join(__dirname, "..", "..");

/** A named step of a scale, used to name the token a raw value should become. */
interface Step {
  readonly token: string;
  readonly value: number;
}

interface AxisRule {
  /** How the value is written back to the developer, e.g. `text-[19px]`. */
  readonly spell: (value: string) => string;
  /** Finds candidate values in a file's source. Must capture the raw value. */
  readonly pattern: RegExp;
  /** Named steps to snap a numeric value to, nearest wins. */
  readonly scale?: readonly Step[];
  /** Said when no scale can name a token for the value. */
  readonly advice: string;
  /** Only scan files that match. Absent means every source file. */
  readonly onlyIn?: RegExp;
  /** A captured value this axis accepts outright, whatever the allowlist says. */
  readonly exempt?: (value: string) => boolean;
}

/**
 * The scales a value is snapped to, in the unit each axis is written in. These
 * are the targets the migration issues aim at, so naming the nearest one turns
 * a failure into an instruction instead of a complaint.
 *
 * Typography is the project's OWN eight steps, not Tailwind's stock ten:
 * `tailwind.config.ts` redefines `xs`…`2xl` and adds `2xs` and `display`, so
 * the stock table would now hand out wrong advice — it would answer `text-2xl`
 * for a 24px value that `text-2xl` renders at 32px. `text-3xl` and up are left
 * out on purpose: they survive as Tailwind defaults but they are not part of
 * the scale, and suggesting one would migrate a value off the system.
 *
 * The other three tables stay stock, because those axes are extended with new
 * names rather than redefined.
 */
const TEXT_SCALE: readonly Step[] = [
  { token: "text-2xs", value: 10.5 },
  { token: "text-xs", value: 12.5 },
  { token: "text-sm", value: 13.5 },
  { token: "text-base", value: 15 },
  { token: "text-lg", value: 20 },
  { token: "text-xl", value: 26 },
  { token: "text-2xl", value: 32 },
  { token: "text-display", value: 46 },
];

const LEADING_SCALE: readonly Step[] = [
  { token: "leading-none", value: 1 },
  { token: "leading-tight", value: 1.25 },
  { token: "leading-snug", value: 1.375 },
  { token: "leading-normal", value: 1.5 },
  { token: "leading-relaxed", value: 1.625 },
  { token: "leading-loose", value: 2 },
];

const TRACKING_SCALE: readonly Step[] = [
  { token: "tracking-tighter", value: -0.05 },
  { token: "tracking-tight", value: -0.025 },
  { token: "tracking-normal", value: 0 },
  { token: "tracking-wide", value: 0.025 },
  { token: "tracking-wider", value: 0.05 },
  { token: "tracking-widest", value: 0.1 },
];

/**
 * The icon scale, imported rather than transcribed: `icon-size.ts` declares
 * the three steps and this table only borrows them, so the lock can never
 * suggest a size the product does not export.
 */
const ICON_SCALE: readonly Step[] = ICON_STEPS;

const BREAKPOINT_SCALE: readonly Step[] = [
  { token: "sm:", value: 640 },
  { token: "md:", value: 768 },
  { token: "lg:", value: 1024 },
  { token: "xl:", value: 1280 },
  { token: "2xl:", value: 1536 },
];

export const AXES: Record<Axis, AxisRule> = {
  typography: {
    spell: (v) => `text-[${v}]`,
    // Lengths only. `text-[#B9B9C1]` is a colour and belongs to another guard.
    pattern: /\btext-\[(-?\d*\.?\d+(?:px|rem|em|pt))\]/g,
    scale: TEXT_SCALE,
    advice: "use a step of the `text-*` scale",
  },
  leading: {
    spell: (v) => `leading-[${v}]`,
    pattern: /\bleading-\[([^\]\s]+)\]/g,
    scale: LEADING_SCALE,
    advice: "use a step of the `leading-*` scale",
  },
  tracking: {
    spell: (v) => `tracking-[${v}]`,
    pattern: /\btracking-\[([^\]\s]+)\]/g,
    scale: TRACKING_SCALE,
    advice: "use a step of the `tracking-*` scale",
  },
  weight: {
    spell: (v) => `font-${v}`,
    // The only axis matched by NAME rather than by brackets. Weights are
    // factory utilities, so nothing here is arbitrary in the syntactic sense
    // the other six rules look for — and that is exactly why the weight scale
    // was the one axis of the type system that drifted without the lock
    // noticing. `font-sans` and `font-mono` are family, not weight, and the
    // alternation leaves them out on purpose.
    pattern: /\bfont-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)\b/g,
    advice:
      "use `font-semibold`, `font-bold` or `font-extrabold` — `font-normal` only to undo an inherited weight",
  },
  icon: {
    spell: (v) => `size={${v}}`,
    // The SECOND axis that does not look for brackets, and the only one that
    // captures an expression rather than a value. `#30` emptied the icon
    // allowlist, so a numeric literal already failed — but a literal escapes
    // through any name (`size={iconSize}`, `size={big ? 24 : 16}`), and a
    // fourteen-size inventory is exactly what one such name grows back into.
    // So the rule inverts, the way the weight axis does: everything is a
    // violation except an expression built out of `ICON` steps.
    pattern: /\bsize=\{([^{}]*)\}/g,
    // Free of digits AND naming a step: `ICON.base` passes, and so does a
    // ternary between two steps, because neither can smuggle a size in.
    exempt: (v) => /\bICON\.(sm|base|lg)\b/.test(v) && !/\d/.test(v),
    advice: "use a step of the `ICON` scale from `@/lib/icon-size`",
    scale: ICON_SCALE,
    // Every `size={n}` in the product today is a lucide icon, and every file
    // that writes one imports lucide. Scoping by import keeps the rule true to
    // its name instead of policing any component that happens to take `size`.
    onlyIn: /from ["']lucide-react["']/,
  },
  rhythm: {
    // The captured value is already the whole class, so it spells itself.
    spell: (v) => v,
    // The THIRD axis that does not look for brackets, and the second that
    // captures an expression rather than a value: `space-y-4` is a factory
    // utility, so nothing here is arbitrary in the syntactic sense. A closed
    // palette would not have helped — the drift was five different FORMS of
    // saying "separate these", not one wrong number — so the rule inverts the
    // way `icon` does and demands the right form instead.
    pattern: /\b(?:[a-z0-9]+:)?((?:space-y|gap-y)-[\w.[\]/-]+)/g,
    // Naming a step of the rhythm, or `0` to undo an inherited one.
    exempt: (v) => /^(?:space-y|gap-y)-(?:page|section|field|0)$/.test(v),
    advice:
      "use a step of the vertical rhythm — `page` (20px), `section` (14px) or `field` (7px)",
    // Only a screen. A `ui/` primitive spaces its own insides and the page
    // rhythm is not its business, exactly as the icon axis only reads files
    // that import lucide.
    onlyIn: /<AppShell\b/,
  },
  shadow: {
    spell: (v) => `shadow-[${v}]`,
    pattern: /\bshadow-\[([^\]\s]+)\]/g,
    advice: "use `shadow-soft`, `shadow-card` or `shadow-elevated`",
  },
  breakpoint: {
    spell: (v) => `min-[${v}]`,
    pattern: /\bmin-\[([^\]\s]+)\]/g,
    scale: BREAKPOINT_SCALE,
    advice: "use a named breakpoint prefix",
  },
};

const AXIS_IDS = Object.keys(AXES) as Axis[];

/** The number inside a raw value, whatever unit it carries. */
export function numericValue(raw: string): number | null {
  const match = /^(-?\d*\.?\d+)(px|rem|em|pt)?$/.exec(raw);
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isFinite(n)) return null;
  // `rem` is written in root ems; the scales are in px, so bring it over.
  return match[2] === "rem" ? n * 16 : n;
}

/** The token a raw value should have been, named whenever a scale can name it. */
export function suggestionFor(axis: Axis, raw: string): string {
  const rule = AXES[axis];
  const n = numericValue(raw);
  if (rule.scale && n !== null) {
    const nearest = rule.scale.reduce((best, step) =>
      Math.abs(step.value - n) < Math.abs(best.value - n) ? step : best,
    );
    return `${rule.advice} — nearest is \`${nearest.token}\``;
  }
  return rule.advice;
}

/**
 * Comments quote the values they explain — `tailwind.config.ts` and this very
 * file name banned spellings on purpose. Scanning prose would make the guard
 * fire on its own documentation.
 */
export function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

export interface Violation {
  readonly axis: Axis;
  readonly file: string;
  readonly value: string;
  readonly message: string;
}

/** Every arbitrary value in one file that the allowlist does not cover. */
export function findViolations(file: string, code: string): Violation[] {
  const found: Violation[] = [];
  for (const axis of AXIS_IDS) {
    const rule = AXES[axis];
    if (rule.onlyIn && !rule.onlyIn.test(code)) continue;
    const pattern = new RegExp(rule.pattern.source, "g");
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(code)) !== null) {
      const value = match[1];
      if (rule.exempt?.(value)) continue;
      if (ALLOWLIST[axis].includes(value)) continue;
      found.push({
        axis,
        file,
        value,
        message: `${file}: ${rule.spell(value)} is not an allowed ${axis} value — ${suggestionFor(axis, value)}`,
      });
    }
  }
  return found;
}

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

const FILES = sourceFiles(SRC).map((path) => ({
  path: path.slice(SRC.length + 1),
  code: stripComments(readFileSync(path, "utf8")),
}));

const VIOLATIONS = FILES.flatMap(({ path, code }) => findViolations(path, code));

/** Allowlist entries no file uses any more — lines that are ready to go. */
const STALE = AXIS_IDS.flatMap((axis) => {
  const live = new Set<string>();
  for (const { code } of FILES) {
    const rule = AXES[axis];
    if (rule.onlyIn && !rule.onlyIn.test(code)) continue;
    const pattern = new RegExp(rule.pattern.source, "g");
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(code)) !== null) live.add(match[1]);
  }
  return ALLOWLIST[axis]
    .filter((value) => !live.has(value))
    .map((value) => `${axis}: "${value}" — no longer used, delete this line`);
});

describe("no new arbitrary style values", () => {
  it("finds source files to check at all", () => {
    // Guards the guard: a broken walk would make every assertion below vacuous.
    expect(FILES.length).toBeGreaterThan(50);
  });

  it("lets nothing in that the frozen inventory does not already cover", () => {
    expect(VIOLATIONS.map((v) => v.message)).toEqual([]);
  });

  it("keeps the allowlist down to what is still in use", () => {
    // The list only shrinks if migrating actually deletes lines. Without this,
    // #29-#32 could each land, leave their entries behind, and the door would
    // stay open on a value nothing writes any more.
    expect(STALE).toEqual([]);
  });
});

describe("the detector itself", () => {
  it("catches an invented text size and says file, value and token", () => {
    // The acceptance criterion, asserted directly: `text-[19px]` is not in the
    // inventory, so planting one anywhere under `src/` has to fail the suite.
    const [violation, ...rest] = findViolations("app/admin/page.tsx", 'className="text-[19px]"');

    expect(rest).toEqual([]);
    expect(violation.file).toBe("app/admin/page.tsx");
    expect(violation.value).toBe("19px");
    expect(violation.message).toContain("app/admin/page.tsx");
    expect(violation.message).toContain("text-[19px]");
    expect(violation.message).toContain("text-lg");
  });

  it("stays quiet on a value the inventory covers", () => {
    // Deliberately NOT a text size. Every migration link deletes typography
    // entries, so a `text-[…]` fixture has to be rewritten each time the band
    // it cites retires. `min-[980px]` is the admin shell breakpoint, which
    // #29 never touches, so this fixture stops churning.
    expect(findViolations("x.tsx", 'className="min-[980px]:flex"')).toEqual([]);
  });

  it("catches every axis, not only typography", () => {
    const axes = [
      'className="leading-[1.99]"',
      'className="tracking-[0.37em]"',
      'className="font-medium"',
      'className="shadow-[0_0_0_9px_#123456]"',
      'className="min-[977px]:flex"',
      'import { X } from "lucide-react";\n<X size={99} />',
    ];

    expect(axes.map((code) => findViolations("x.tsx", code).length)).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it("reads the weight scale as a closed set, not as a bracket", () => {
    // The four the product may write stay quiet; `font-sans` is a family and
    // belongs to no axis at all.
    const allowed = ["font-normal", "font-semibold", "font-bold", "font-extrabold", "font-sans"];
    expect(allowed.flatMap((c) => findViolations("x.tsx", `className="${c}"`))).toEqual([]);

    // `medium` is the weight this chain retired, and `black` one it never had.
    const [violation] = findViolations("app/x.tsx", 'className="text-sm font-black"');
    expect(violation.value).toBe("black");
    expect(violation.message).toContain("font-black");
    expect(violation.message).toContain("font-semibold");
  });

  it("reads `size` as an icon size only where lucide is imported", () => {
    // A chart or an avatar taking `size={99}` is not this rule's business.
    expect(findViolations("x.tsx", "<Avatar size={99} />")).toEqual([]);
  });

  it("accepts a step of the icon scale and nothing else that is numeric", () => {
    const lucide = 'import { X } from "lucide-react";\n';

    // The three steps, alone or inside an expression built only out of them.
    const written = [
      "<X size={ICON.sm} />",
      "<X size={ICON.base} />",
      "<X size={ICON.lg} />",
      '<X size={variant === "landing" ? ICON.base : ICON.sm} />',
    ];
    expect(written.flatMap((code) => findViolations("x.tsx", lucide + code))).toEqual([]);

    // A literal is the drift the scale replaces, and an opaque expression is
    // the loophole a literal escapes through. Both fail.
    const [literal] = findViolations("app/x.tsx", `${lucide}<X size={16} />`);
    expect(literal.value).toBe("16");
    expect(literal.message).toContain("ICON.sm");

    const [opaque] = findViolations("app/x.tsx", `${lucide}<X size={iconSize} />`);
    expect(opaque.value).toBe("iconSize");
    expect(opaque.message).toContain("a step of the `ICON` scale");
  });

  it("reads vertical rhythm as a form, and only inside a screen", () => {
    const screen = "<AppShell title=\"x\">\n";

    // The three steps and an explicit reset are the whole legal vocabulary.
    const written = [
      '<div className="space-y-page" />',
      '<div className="space-y-section" />',
      '<div className="gap-y-field" />',
      '<div className="space-y-0" />',
      '<div className="sm:gap-y-section" />',
    ];
    expect(written.flatMap((c) => findViolations("x.tsx", screen + c))).toEqual([]);

    // A number is the drift the scale replaces, whichever family writes it.
    const [step] = findViolations("app/x.tsx", `${screen}<div className="space-y-4" />`);
    expect(step.value).toBe("space-y-4");
    expect(step.message).toContain("space-y-4");
    expect(step.message).toContain("section");

    const [sibling] = findViolations("app/x.tsx", `${screen}<div className="gap-y-1.5" />`);
    expect(sibling.value).toBe("gap-y-1.5");

    // `gap-*` on a row is horizontal, so it is not this axis's business, and a
    // component that no screen shell wraps is not policed at all.
    expect(findViolations("x.tsx", `${screen}<div className="gap-4" />`)).toEqual([]);
    expect(findViolations("ui/Card.tsx", '<div className="space-y-4" />')).toEqual([]);
  });

  it("leaves arbitrary colours to the palette guard", () => {
    expect(findViolations("x.tsx", 'className="text-[#B9B9C1]"')).toEqual([]);
  });

  it("does not fire on prose that quotes a banned value", () => {
    expect(stripComments("// never write text-[19px] here").trim()).toBe("");
    expect(findViolations("x.tsx", stripComments("/* text-[19px] */"))).toEqual([]);
  });

  it("names the nearest token across units and scales", () => {
    expect(numericValue("1.5rem")).toBe(24);
    // 24px snaps to `xl` (26px), two away, not to `2xl` — which the scale
    // moved to 32px, eight away.
    expect(suggestionFor("typography", "1.5rem")).toContain("text-xl");
    expect(suggestionFor("leading", "1.24")).toContain("leading-tight");
    expect(suggestionFor("tracking", "-0.048em")).toContain("tracking-tighter");
    expect(suggestionFor("breakpoint", "980px")).toContain("lg:");
    // 20px snaps to `ICON.base` (18px), two away, not to `ICON.lg` (24px).
    expect(suggestionFor("icon", "20")).toContain("ICON.base");
    // An expression carries no number, so the advice stands on its own.
    expect(suggestionFor("icon", "iconSize")).toBe(AXES.icon.advice);
  });
});
